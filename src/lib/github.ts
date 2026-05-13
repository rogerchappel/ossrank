import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rankContributors, rankProjectMomentum, rankProjects, rankRisingContributors } from './ranking.js';
import { COUNTRY_CONFIGS, type CountryConfig } from './countries.js';
import { snapshotBase } from './snapshots.js';
import { createTokenProvider, type GitHubTokenProvider } from './token-provider.js';
import type { RankedContributor, RankedProject, RankingSnapshot } from './types.js';

export interface GitHubCollectorSaveDir {
  latestDir: string;
  historyDir: string;
}

export interface GitHubCollectorOptions {
  token?: string;
  limit: number;
  generatedAt?: string;
  maxCountries?: number;
  saveDir?: GitHubCollectorSaveDir;
}

interface GitHubSearchResponse<T> {
  total_count: number;
  items: T[];
}

interface GitHubUserSearchItem { login: string; html_url: string; type?: string; }
interface GitHubRepoSearchItem {
  full_name: string;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  open_issues_count: number;
  pushed_at: string;
  owner: { login: string };
}
interface GitHubUserDetail {
  login: string;
  name: string | null;
  html_url: string;
  public_repos: number;
  public_gists: number;
  followers: number;
  location: string | null;
}
interface GitHubRate { rate?: { remaining?: number } }
interface GitHubPublicEvent {
  type: string;
  payload?: {
    commits?: unknown[];
    action?: string;
  };
}
interface GitHubGraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}
interface GitHubUserSearchResponse {
  search: {
    userCount: number;
    nodes: Array<{
      login: string;
    } | null>;
  };
  rateLimit?: { remaining?: number; cost?: number };
}

interface CandidateQueryStat {
  query: string;
  total: number;
  accepted: number;
}

interface UserCandidate {
  user: GitHubUserDetail;
  activity: { commits: number; pullRequests: number };
  discoveredByQuery: string;
}

interface RepoCandidate {
  repo: GitHubRepoSearchItem;
  discoveredByQuery: string;
}

interface GitHubRelease { published_at: string | null; }
interface GitHubPullRequest { merged_at: string | null; updated_at: string; }

interface GitHubRepoActivityResponse {
  repository: {
    defaultBranchRef: { target: { history?: { totalCount: number } } | null } | null;
    pullRequests: { nodes: Array<{ mergedAt: string | null }> };
    releases: { nodes: Array<{ publishedAt: string | null }> };
    issues: { totalCount: number };
  } | null;
  rateLimit?: { remaining?: number; cost?: number };
}

// ---------------------------------------------------------------------------
// Smart throttler — single shared instance across the refresh cycle
// ---------------------------------------------------------------------------

interface RateLimitState {
  graphqlRemaining: number | null;   // GraphQL points remaining (5000/hr for PAT)
  graphqlLimit: number | null;
  graphqlReset: number | null;        // epoch-ms when GraphQL budget resets
  restRemaining: number | null;       // REST/search requests remaining
  restLimit: number | null;
  restReset: number | null;           // epoch-ms when REST/search budget resets
}

class SmartThrottler {
  private state: RateLimitState = { graphqlRemaining: null, graphqlLimit: null, graphqlReset: null, restRemaining: null, restLimit: null, restReset: null };

  private readonly concurrency: number;
  /** Minimum gap between sequential API calls (ms). */
  private readonly minGapMs: number;
  private lastCallTs = 0;

  constructor(options: { concurrency?: number; minGapMs?: number } = {}) {
    this.concurrency = options.concurrency ?? 2;
    this.minGapMs = options.minGapMs ?? 800;
  }

  getConcurrency(): number {
    return this.concurrency;
  }

  /** Update rate-limit state from response headers. */
  updateFromHeaders(headers: Headers, apiType: 'graphql' | 'rest'): void {
    const remaining = headers.get('x-ratelimit-remaining');
    const limit = headers.get('x-ratelimit-limit');
    const reset = headers.get('x-ratelimit-reset');
    if (remaining !== null) {
      const val = Number(remaining);
      if (apiType === 'graphql') this.state.graphqlRemaining = val;
      else this.state.restRemaining = val;
    }
    if (limit !== null) {
      const val = Number(limit);
      if (apiType === 'graphql') this.state.graphqlLimit = val;
      else this.state.restLimit = val;
    }
    if (reset !== null) {
      const epochSec = Number(reset);
      if (apiType === 'graphql') this.state.graphqlReset = epochSec * 1000;
      else this.state.restReset = epochSec * 1000;
    }
  }

  /**
   * Call before making a request. Returns ms to wait (0 if OK).
   * GraphQL: keep a larger safety buffer. REST/search buckets vary a lot
   * (GitHub search is often only 30/min), so scale the buffer to the
   * advertised bucket size instead of assuming a 5k core REST limit.
   */
  msToWait(apiType: 'graphql' | 'rest'): number {
    const remaining = apiType === 'graphql' ? this.state.graphqlRemaining : this.state.restRemaining;
    const limit = apiType === 'graphql' ? this.state.graphqlLimit : this.state.restLimit;
    const reset = apiType === 'graphql' ? this.state.graphqlReset : this.state.restReset;
    const threshold = apiType === 'graphql'
      ? 150
      : Math.max(1, Math.min(100, Math.floor((limit ?? 5000) * 0.1)));

    if (remaining === null || reset === null) return 0;
    if (remaining > threshold) return 0;

    const waitMs = reset - Date.now() + 1000;
    return Math.max(0, waitMs);
  }

  /**
   * Enforce minimum gap between calls AND sleep if we're near a rate limit.
   * Call this immediately before issuing an API request.
   */
  async beforeCall(apiType: 'graphql' | 'rest'): Promise<void> {
    // Check if we need to sleep because we're near the limit.
    const limitWait = this.msToWait(apiType);
    if (limitWait > 0) {
      const seconds = Math.ceil(limitWait / 1000);
      process.stderr.write(
        `[throttle] Approaching ${apiType} rate limit — sleeping ${seconds}s until reset.\n`
      );
      await this._sleep(Math.min(limitWait, 3_600_000)); // cap at 1h
    }

    // Enforce minimum inter-call gap.
    const gap = Date.now() - this.lastCallTs;
    if (gap < this.minGapMs) {
      await this._sleep(this.minGapMs - gap);
    }
    this.lastCallTs = Date.now();
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Rate-limit-aware GitHub client
// ---------------------------------------------------------------------------

export class GitHubClient {
  remaining?: number;
  private tokenProvider: GitHubTokenProvider;
  private throttler: SmartThrottler;

  constructor(tokenProvider: GitHubTokenProvider, throttler: SmartThrottler) {
    this.tokenProvider = tokenProvider;
    this.throttler = throttler;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const { token } = await this.tokenProvider.getToken();
    return { Authorization: `Bearer ${token}` };
  }

  async get<T>(path: string, useRest = true): Promise<T> {
    const apiType = useRest ? 'rest' : 'graphql';
    await this.throttler.beforeCall(apiType);
    const auth = await this.authHeaders();
    const response = await fetchWithRetry(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ossrank/0.1.0',
        ...auth
      }
    });
    this.throttler.updateFromHeaders(response.headers, 'rest');
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining) this.remaining = Number(remaining);
    if (!response.ok) {
      const text = await response.text();
      // Handle 403 primary/secondary rate limit
      if (response.status === 403) {
        const reset = response.headers.get('x-ratelimit-reset');
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const sleepMs = Math.min(Number(retryAfter) * 1000, 3_600_000);
          process.stderr.write(`[throttle] ${path} hit 403 — sleeping ${Math.ceil(sleepMs / 1000)}s.\n`);
          await new Promise((resolve) => setTimeout(resolve, sleepMs));
          return this.get<T>(path, useRest); // retry once after sleep
        }
        if (reset) {
          const sleepMs = Math.max(Number(reset) * 1000 - Date.now() + 1000, 0);
          process.stderr.write(`[throttle] ${path} hit 403 — sleeping ${Math.ceil(sleepMs / 1000)}s until reset.\n`);
          await new Promise((resolve) => setTimeout(resolve, Math.min(sleepMs, 3_600_000)));
          return this.get<T>(path, useRest);
        }
      }
      throw new Error(`GitHub ${response.status} for ${path}: ${text}`);
    }
    return await response.json() as T;
  }

  async rawGet(path: string): Promise<Response> {
    await this.throttler.beforeCall('rest');
    const auth = await this.authHeaders();
    const response = await fetchWithRetry(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ossrank/0.1.0',
        ...auth
      }
    });
    this.throttler.updateFromHeaders(response.headers, 'rest');
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining) this.remaining = Number(remaining);
    if (!response.ok) throw new Error(`GitHub ${response.status} for ${path}: ${await response.text()}`);
    return response;
  }

  async search<T>(path: string): Promise<GitHubSearchResponse<T>> {
    return await this.get<GitHubSearchResponse<T>>(path);
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    await this.throttler.beforeCall('graphql');
    const auth = await this.authHeaders();
    const response = await fetchWithRetry('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'ossrank/0.1.0',
        ...auth
      },
      body: JSON.stringify({ query, variables })
    });
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining) this.remaining = Number(remaining);
    this.throttler.updateFromHeaders(response.headers, 'graphql');
    const body = await response.json() as GitHubGraphqlResponse<T>;
    if (!response.ok || body.errors?.length) {
      const message = body.errors?.map((error) => error.message).join('; ') ?? response.statusText;
      // If it's a rate-limit error from GraphQL, sleep and retry once
      if (response.status === 403 || message.includes('rate limit')) {
        const reset = response.headers.get('x-ratelimit-reset');
        const retryAfter = response.headers.get('retry-after');
        const sleepMs = retryAfter
          ? Math.min(Number(retryAfter) * 1000, 3_600_000)
          : reset
            ? Math.max(Number(reset) * 1000 - Date.now() + 1000, 0)
            : 60_000;
        process.stderr.write(`[throttle] GraphQL hit rate limit — sleeping ${Math.ceil(sleepMs / 1000)}s.\n`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(sleepMs, 3_600_000)));
        return this.graphql<T>(query, variables);
      }
      throw new Error(`GitHub GraphQL failed: ${message}`);
    }
    if (!body.data) throw new Error('GraphQL returned no data');
    return body.data;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgoIso(generatedAt: string, days: number): string {
  const date = new Date(generatedAt);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function yyyyMmDd(iso: string): string {
  return iso.slice(0, 10);
}

async function mapLimit<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function countFromLink(response: Response, fallback: number): number {
  const link = response.headers.get('link');
  const match = link?.match(/[?&]page=(\d+)>; rel="last"/);
  return match ? Number(match[1]) : fallback;
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.status === 403) return response; // let caller handle rate limit
      if (response.status !== 502 && response.status !== 503 && response.status !== 504 && response.status !== 429) return response;
      lastError = new Error(`GitHub ${response.status} for ${url}`);
      const retryAfter = Number(response.headers.get('retry-after') ?? 0) * 1000;
      await new Promise((resolve) => setTimeout(resolve, retryAfter || attempt * 1000));
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ---------------------------------------------------------------------------
// REST user profile + public activity
// ---------------------------------------------------------------------------

async function publicActivityViaSearch(
  client: GitHubClient,
  login: string,
  generatedAt: string
): Promise<{ commits: number; pullRequests: number }> {
  const fromDate = yyyyMmDd(daysAgoIso(generatedAt, 365));
  const toDate = yyyyMmDd(generatedAt);
  const commitQuery = `author:${login} committer-date:${fromDate}..${toDate}`;
  const pullRequestQuery = `type:pr author:${login} created:${fromDate}..${toDate}`;

  const commitSearch = await client.search<unknown>(`/search/commits?${encodeQuery(commitQuery, 1, 'committer-date')}`);
  const pullRequestSearch = await client.search<unknown>(`/search/issues?${encodeQuery(pullRequestQuery, 1, 'created')}`);

  return {
    commits: commitSearch.total_count,
    pullRequests: pullRequestSearch.total_count
  };
}

async function userProfileWithActivity(
  client: GitHubClient,
  login: string,
  generatedAt: string
): Promise<{ user: GitHubUserDetail; activity: { commits: number; pullRequests: number } } | null> {
  const profile = await client.get<GitHubUserDetail>(`/users/${login}`);
  if (!profile?.login) return null;

  return {
    user: {
      login: profile.login,
      name: profile.name,
      html_url: profile.html_url,
      public_repos: profile.public_repos,
      public_gists: profile.public_gists,
      followers: profile.followers,
      location: profile.location
    },
    activity: await publicActivityViaSearch(client, profile.login, generatedAt)
  };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function encodeQuery(query: string, limit: number, sort?: string, order = 'desc'): string {
  return `q=${encodeURIComponent(query)}&per_page=${Math.min(100, Math.max(1, limit))}${sort ? `&sort=${encodeURIComponent(sort)}&order=${encodeURIComponent(order)}` : ''}`;
}

function userQuery(query: string): string {
  return /(^|\s)type:user(\s|$)/.test(query) ? query : `${query} type:user`;
}

function matchingLocationTerms(location: string | null, terms: string[]): string[] {
  if (!location) return [];
  const lower = location.toLowerCase();
  return terms.filter((term) => lower.includes(term.toLowerCase()));
}

function matchesLocation(location: string | null, terms: string[]): boolean {
  return matchingLocationTerms(location, terms).length > 0;
}

function locationConfidence(location: string | null, terms: string[], countryName: string): RankedContributor['location_confidence'] {
  if (!location) return 'unknown';
  const lower = location.toLowerCase();
  const parts = location.split(/[,&/;|]+|\band\b/i).map((part) => part.trim()).filter(Boolean);
  const matched = matchingLocationTerms(location, terms);
  if (parts.length > 1 && matched.length > 0) return 'multi-location';
  if (lower.includes(countryName.toLowerCase())) return 'exact-country';
  if (matched.length > 0) return 'city-match';
  return 'profile-text-match';
}

// ---------------------------------------------------------------------------
// GraphQL user search (required — user search is not in the search API)
// ---------------------------------------------------------------------------

async function searchUsers(client: GitHubClient, query: string, limit: number): Promise<{ total: number; items: GitHubUserSearchItem[] }> {
  const data = await client.graphql<GitHubUserSearchResponse>(`query OssrankUserSearch($query: String!, $limit: Int!) {
    search(type: USER, query: $query, first: $limit) {
      userCount
      nodes { ... on User { login } }
    }
    rateLimit { remaining cost }
  }`, { query, limit: Math.min(100, Math.max(1, limit)) });
  return {
    total: data.search.userCount,
    items: (data as any).search?.nodes?.filter((node: any): node is { login: string } => Boolean(node?.login)).map((node: any) => ({ login: node.login, html_url: `https://github.com/${node.login}`, type: 'User' })) ?? []
  };
}

// ---------------------------------------------------------------------------
// Collect users — now uses REST for profiles (separate rate limit bucket)
// ---------------------------------------------------------------------------

async function collectUsers(client: GitHubClient, queries: string | string[], limit: number, generatedAt: string, throttler: SmartThrottler, locationTerms?: string[], countryName?: string, candidateLimit = Math.max(50, limit * 5)): Promise<{ total: number; users: RankedContributor[]; queryStats: CandidateQueryStat[] }> {
  const searchQueries = Array.isArray(queries) ? queries : [queries];
  const concurrency = throttler.getConcurrency();
  const details = new Map<string, UserCandidate>();
  const queryStats: CandidateQueryStat[] = [];
  let total = 0;
  const perQueryLimit = Math.min(100, Math.max(limit, Math.ceil(candidateLimit / searchQueries.length)));

  for (const query of searchQueries) {
    const search = await searchUsers(client, userQuery(query), perQueryLimit);
    total += search.total;
    const before = details.size;
    const unseen = search.items.filter((item) => item.type !== 'Organization' && !details.has(item.login.toLowerCase()));
    const fetched = await mapLimit(unseen, concurrency, async (item) => userProfileWithActivity(client, item.login, generatedAt));
    for (const detail of fetched) {
      if (detail && (!locationTerms || matchesLocation(detail.user.location, locationTerms))) {
        details.set(detail.user.login.toLowerCase(), { ...detail, discoveredByQuery: userQuery(query) });
      }
    }
    queryStats.push({ query: userQuery(query), total: search.total, accepted: details.size - before });
  }

  const entries = [...details.values()].map(({ user, activity, discoveredByQuery }) => ({
    login: user.login,
    name: user.name ?? undefined,
    profile_url: user.html_url,
    public_contributions: activity.commits,
    public_repos: user.public_repos,
    public_gists: user.public_gists,
    observed_public_commits: activity.commits,
    observed_public_pull_requests: activity.pullRequests,
    followers: user.followers,
    location: user.location ?? undefined,
    location_confidence: locationTerms && countryName ? locationConfidence(user.location, locationTerms, countryName) : 'unknown' as const,
    discovered_by_query: discoveredByQuery,
    notable_repositories: []
  }));

  const ranked = rankContributors(entries).slice(0, limit);
  return { total, users: ranked, queryStats };
}

// ---------------------------------------------------------------------------
// Repo helpers
// ---------------------------------------------------------------------------

async function mergedPullRequestCount(client: GitHubClient, fullName: string, sinceIso: string): Promise<number> {
  let count = 0;
  const sinceMs = Date.parse(sinceIso);
  for (let page = 1; page <= 10; page += 1) {
    const pulls = await client.get<GitHubPullRequest[]>(`/repos/${fullName}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
    if (pulls.length === 0) break;
    for (const pull of pulls) if (pull.merged_at && Date.parse(pull.merged_at) >= sinceMs) count += 1;
    const oldestUpdated = Math.min(...pulls.map((pull) => Date.parse(pull.updated_at)));
    if (pulls.length < 100 || oldestUpdated < sinceMs) break;
  }
  return count;
}

async function repoActivity(client: GitHubClient, fullName: string, generatedAt: string): Promise<{ merged7: number; merged30: number; commits30: number; releases90: number; openIssues?: number }> {
  const [owner, name] = fullName.split('/');
  const since7Ms = Date.parse(daysAgoIso(generatedAt, 7));
  const since30Iso = daysAgoIso(generatedAt, 30);
  const since30Ms = Date.parse(since30Iso);
  const since90Ms = Date.parse(daysAgoIso(generatedAt, 90));
  const data = await client.graphql<GitHubRepoActivityResponse>(`query OssrankRepoActivity($owner: String!, $name: String!, $since30: GitTimestamp!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef { target { ... on Commit { history(since: $since30) { totalCount } } } }
      pullRequests(states: MERGED, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { mergedAt } }
      releases(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { publishedAt } }
      issues(states: OPEN) { totalCount }
    }
    rateLimit { remaining cost }
  }`, { owner, name, since30: since30Iso });
  const repo = data.repository;
  if (!repo) return { merged7: 0, merged30: 0, commits30: 0, releases90: 0 };
  const mergedDates = repo.pullRequests.nodes.map((pull) => pull.mergedAt).filter((date): date is string => Boolean(date)).map(Date.parse);
  return {
    merged7: mergedDates.filter((date) => date >= since7Ms).length,
    merged30: mergedDates.filter((date) => date >= since30Ms).length,
    commits30: repo.defaultBranchRef?.target?.history?.totalCount ?? 0,
    releases90: repo.releases.nodes.filter((release) => release.publishedAt && Date.parse(release.publishedAt) >= since90Ms).length,
    openIssues: repo.issues.totalCount
  };
}

async function commitCount(client: GitHubClient, fullName: string, since: string): Promise<number> {
  const response = await client.rawGet(`/repos/${fullName}/commits?since=${encodeURIComponent(since)}&per_page=1`);
  const body = await response.json() as unknown[];
  return countFromLink(response, body.length);
}

async function contributorCount(client: GitHubClient, fullName: string): Promise<number> {
  const response = await client.rawGet(`/repos/${fullName}/contributors?anon=false&per_page=1`);
  const body = await response.json() as unknown[];
  return countFromLink(response, body.length);
}

async function releaseCount(client: GitHubClient, fullName: string, since: string): Promise<number> {
  const releases = await client.get<GitHubRelease[]>(`/repos/${fullName}/releases?per_page=100`);
  return releases.filter((release) => release.published_at && release.published_at >= since).length;
}

async function collectRepos(client: GitHubClient, queries: string[], limit: number, generatedAt: string, throttler: SmartThrottler, candidateLimit = Math.max(50, limit * 5)): Promise<{ total: number; projects: RankedProject[]; queryStats: CandidateQueryStat[] }> {
  const concurrency = throttler.getConcurrency();
  const byName = new Map<string, RepoCandidate>();
  const queryStats: CandidateQueryStat[] = [];
  let total = 0;
  const perQueryLimit = Math.min(100, Math.max(limit, Math.ceil(candidateLimit / queries.length)));

  for (const query of queries) {
    const search = await client.search<GitHubRepoSearchItem>(`/search/repositories?${encodeQuery(query, perQueryLimit, 'stars')}`);
    total += search.total_count;
    const before = byName.size;
    for (const repo of search.items) if (!byName.has(repo.full_name)) byName.set(repo.full_name, { repo, discoveredByQuery: query });
    queryStats.push({ query, total: search.total_count, accepted: byName.size - before });
  }

  const since7 = yyyyMmDd(daysAgoIso(generatedAt, 7));
  const since30Iso = daysAgoIso(generatedAt, 30);
  const since30 = yyyyMmDd(since30Iso);
  const since90Iso = daysAgoIso(generatedAt, 90);

  const measured = await mapLimit([...byName.values()], concurrency, async ({ repo, discoveredByQuery }) => {
    const fullName = repo.full_name;
    const [activity, contributors] = await Promise.all([
      repoActivity(client, fullName, generatedAt).catch(() => ({ merged7: 0, merged30: 0, commits30: 0, releases90: 0, openIssues: repo.open_issues_count })),
      contributorCount(client, fullName).catch(() => 0)
    ]);
    return {
      full_name: fullName,
      url: repo.html_url,
      stars: repo.stargazers_count,
      pull_requests_merged_7d: activity.merged7,
      pull_requests_merged_30d: activity.merged30,
      recent_commits_30d: activity.commits30,
      active_contributors_30d: contributors,
      total_contributors_observed: contributors,
      releases_90d: activity.releases90,
      open_issues: activity.openIssues ?? repo.open_issues_count,
      pushed_at: repo.pushed_at,
      discovered_by_query: discoveredByQuery,
      primary_language: repo.language ?? undefined
    };
  });

  const projects = rankProjects(measured).slice(0, limit);
  return { total, projects, queryStats };
}

// ---------------------------------------------------------------------------
// Per-country incremental save helper
// ---------------------------------------------------------------------------

interface CountryResult {
  config: CountryConfig;
  total: number;
  users: RankedContributor[];
  queryStats: CandidateQueryStat[];
}

async function saveCountrySnapshot(
  saveDir: GitHubCollectorSaveDir,
  generatedAt: string,
  result: CountryResult
): Promise<void> {
  const { config, total, users, queryStats } = result;
  const snapshot: RankingSnapshot<RankedContributor> = {
    ...snapshotBase('country', config.slug, config.name, `Top observed GitHub contributors in ${config.name}`, generatedAt, 'fresh', 'github-rest-search-one-year-public-activity'),
    code: config.code,
    candidate_count: total,
    caveats: [
      'Live data uses GitHub REST search plus public profile fields; it is an observed sample, not a complete census.',
      'Location matching uses free-text GitHub profile locations and must not be treated as verified nationality or residence.'
    ],
    discovery_queries: config.queries.map(userQuery),
    candidate_count_by_query: queryStats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [users.length], top_10_signal: [users.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: users
  };

  const filename = `countries-${config.slug}.json`;
  await mkdir(saveDir.latestDir, { recursive: true });
  await writeFile(join(saveDir.latestDir, filename), JSON.stringify(snapshot, null, 2) + '\n');

  const runId = generatedAt.slice(0, 10);
  const runDir = join(saveDir.historyDir, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, filename), JSON.stringify(snapshot, null, 2) + '\n');

  process.stderr.write(`  ✓ Saved ${config.name} → ${filename}\n`);
}

async function loadSavedCountrySnapshots(saveDir: GitHubCollectorSaveDir, generatedAt: string): Promise<Map<string, RankingSnapshot<RankedContributor>>> {
  const { readdir } = await import('node:fs/promises');
  const saved = new Map<string, RankingSnapshot<RankedContributor>>();
  const runDir = join(saveDir.historyDir, generatedAt.slice(0, 10));
  try {
    const files = await readdir(runDir);
    for (const file of files) {
      const match = file.match(/^countries-(.+)\.json$/);
      if (!match) continue;
      const snapshot = JSON.parse(await readFile(join(runDir, file), 'utf8')) as RankingSnapshot<RankedContributor>;
      if (snapshot.kind === 'country' && snapshot.slug === match[1] && snapshot.generated_at === generatedAt) saved.set(match[1], snapshot);
    }
  } catch {
    // No resumable country snapshots for this run yet.
  }
  return saved;
}

// ---------------------------------------------------------------------------
// Main entry — orchestrates all snapshots
// ---------------------------------------------------------------------------

export async function collectLiveSnapshots(options: GitHubCollectorOptions): Promise<{ snapshots: RankingSnapshot<unknown>[]; remaining?: number }> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  // Create token provider — supports PAT now, GitHub App later when env vars are set.
  const provider = createTokenProvider(options.token);
  if (!provider) throw new Error('No GitHub token found. Set OSSRANK_GITHUB_TOKEN or APP_ID + PRIVATE_KEY + INSTALLATION_ID.');

  // Smart throttler — concurrency 2 (was 8), ~800ms gap between calls.
  const throttler = new SmartThrottler({ concurrency: 2, minGapMs: 800 });
  const client = new GitHubClient(provider, throttler);

  const limit = Math.max(1, options.limit);

  // Incremental save: load already-saved country snapshots for this run so
  // interrupted refreshes can resume without dropping skipped countries from
  // the final manifest/site build.
  const saveDir = options.saveDir;
  const savedCountrySnapshots = saveDir ? await loadSavedCountrySnapshots(saveDir, generatedAt) : new Map<string, RankingSnapshot<RankedContributor>>();
  if (savedCountrySnapshots.size > 0) {
    process.stderr.write(`[resume] Found ${savedCountrySnapshots.size} previously saved countries for this run, skipping and reusing them.\n`);
  }

  const countryResults: CountryResult[] = [];
  const countryConfigs = COUNTRY_CONFIGS.slice(0, options.maxCountries ?? COUNTRY_CONFIGS.length);

  for (const config of countryConfigs) {
    // Skip already-saved countries for this run only (resume support).
    if (saveDir && savedCountrySnapshots.has(config.slug)) {
      process.stderr.write(`Skipping ${config.name} (already saved for this run).\n`);
      continue;
    }

    process.stderr.write(`Refreshing ${config.name}...\n`);
    const result = await collectUsers(client, config.queries, limit, generatedAt, throttler, config.locationTerms, config.name, config.candidateLimit ?? Math.max(50, limit * 5));
    countryResults.push({ config, ...result });

    // Save immediately after each country completes
    if (saveDir) {
      await saveCountrySnapshot(saveDir, generatedAt, { config, ...result });
    }
  }

  const global = await collectUsers(client, ['followers:>1000 repos:>20', 'repos:>100 followers:>500'], limit, generatedAt, throttler, undefined, undefined, Math.max(100, limit * 8));
  const ts = await collectUsers(client, 'language:TypeScript repos:>10 followers:>25', limit, generatedAt, throttler, undefined, undefined, Math.max(50, limit * 5));
  const devtools = await collectRepos(client, ['topic:developer-tools archived:false', 'topic:cli archived:false', 'topic:devtools archived:false'], limit, generatedAt, throttler);
  const growing = await collectRepos(client, ['stars:>500 pushed:>=2026-04-01 archived:false', 'created:>=2025-01-01 stars:>1000 archived:false'], limit, generatedAt, throttler, Math.max(100, limit * 8));
  const agentic = await collectRepos(client, ['agentic archived:false pushed:>=2026-04-01', 'topic:ai-agents archived:false', 'topic:llm-agents archived:false', 'topic:mcp archived:false', 'agent framework archived:false stars:>100'], limit, generatedAt, throttler, Math.max(80, limit * 5));
  const claude = await collectRepos(client, ['claude archived:false pushed:>=2026-04-01', 'claude-code archived:false', 'topic:claude archived:false', 'anthropic claude archived:false stars:>50'], limit, generatedAt, throttler, Math.max(60, limit * 4));
  const codex = await collectRepos(client, ['codex archived:false pushed:>=2026-04-01', 'openai codex archived:false', 'topic:codex archived:false', 'codex cli archived:false'], limit, generatedAt, throttler, Math.max(60, limit * 4));
  const openclaw = await collectRepos(client, ['openclaw archived:false', 'topic:openclaw archived:false', 'openclaw agent archived:false'], limit, generatedAt, throttler, Math.max(40, limit * 3));

  const contributorCaveats = [
    'Live data uses GitHub REST search plus public profile fields; it is an observed sample, not a complete census.',
    'Location matching uses free-text GitHub profile locations and must not be treated as verified nationality or residence.',
    'Contributor pages expose public repository counts plus one-year public commit and pull request activity from GitHub REST search. These are not all-time totals and may differ from private/authenticated GitHub profile contribution graphs.',
    'The OSSRank score is retained only as a combined proxy; raw commits, pull requests, and repository tables are preferred for review and SEO pages.'
  ];
  const projectCaveats = [
    'Live data uses GitHub repository search and public repository fields; it is an observed sample, not a complete census.',
    'Project PR counts use recent merged pull requests visible through GitHub GraphQL; high-volume repositories may be capped by the first 100 recently updated merged PRs per snapshot.',
    'Recent commit, release, issue, and star fields come from official GitHub APIs. Contributor count is observed all-time contributors when the REST budget permits, not unique 30-day contributors.',
    'Project momentum prioritises recent merged PRs, recent commits, observed contributors, then stars.'
  ];

  const savedCountryEntries = [...savedCountrySnapshots.values()].flatMap((snapshot) => snapshot.entries);
  const globalContributorPool = [
    ...global.users,
    ...ts.users,
    ...savedCountryEntries,
    ...countryResults.flatMap((result) => result.users)
  ];
  const globalEntries = rankContributors([...new Map(globalContributorPool.map((user) => [user.login.toLowerCase(), user])).values()]).slice(0, limit);
  const derivedGlobalStat = { query: 'derived from current country, language, and global contributor snapshots', total: globalContributorPool.length, accepted: Math.max(0, globalEntries.length - global.users.length) };
  const globalContributors: RankingSnapshot<RankedContributor> = {
    ...snapshotBase('global', 'contributors', 'Global', 'Top observed GitHub contributors globally', generatedAt, 'fresh', 'github-rest-search-one-year-public-activity'),
    candidate_count: global.total, caveats: contributorCaveats, discovery_queries: ['followers:>1000 repos:>20 type:user', 'repos:>100 followers:>500 type:user', 'derived from current country and language contributor snapshots'], candidate_count_by_query: [...global.queryStats, derivedGlobalStat],
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [globalEntries.length], top_10_signal: [globalEntries.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: globalEntries
  };
  const refreshedCountries: Array<RankingSnapshot<RankedContributor>> = countryResults.map(({ config, total, users }) => ({
    ...snapshotBase('country', config.slug, config.name, `Top observed GitHub contributors in ${config.name}`, generatedAt, 'fresh', 'github-rest-search-one-year-public-activity'),
    code: config.code, candidate_count: total, caveats: contributorCaveats, discovery_queries: config.queries.map(userQuery), candidate_count_by_query: (countryResults.find((r) => r.config.slug === config.slug)?.queryStats ?? []),
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [users.length], top_10_signal: [users.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: users
  }));
  const countrySnapshotBySlug = new Map<string, RankingSnapshot<RankedContributor>>([
    ...[...savedCountrySnapshots.entries()],
    ...refreshedCountries.map((snapshot) => [snapshot.slug, snapshot] as const)
  ]);
  const countries = countryConfigs.map((config) => countrySnapshotBySlug.get(config.slug)).filter((snapshot): snapshot is RankingSnapshot<RankedContributor> => Boolean(snapshot));
  const language: RankingSnapshot<RankedContributor> = {
    ...snapshotBase('language', 'typescript', 'TypeScript', 'Top observed TypeScript open-source contributors', generatedAt, 'fresh', 'github-rest-raw-public-metrics'),
    candidate_count: ts.total, caveats: contributorCaveats, discovery_queries: ['language:TypeScript repos:>10 followers:>25 type:user'], candidate_count_by_query: ts.queryStats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [ts.users.length], top_10_signal: [ts.users.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: ts.users
  };
  const category: RankingSnapshot<RankedProject> = {
    ...snapshotBase('category', 'developer-tools', 'Developer Tools', 'Top observed developer tools open-source projects', generatedAt, 'fresh', 'github-rest-search-real-recent-project-signals'),
    candidate_count: devtools.total, caveats: projectCaveats, discovery_queries: ['topic:developer-tools archived:false', 'topic:cli archived:false', 'topic:devtools archived:false'], candidate_count_by_query: devtools.queryStats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [devtools.projects.length], top_10_signal: [devtools.projects.slice(0, 10).reduce((sum, project) => sum + project.pull_requests_merged_7d, 0)] },
    entries: devtools.projects
  };
  const projects: RankingSnapshot<RankedProject> = {
    ...snapshotBase('projects', 'fastest-growing-open-source-projects', 'Fastest Growing Open Source Projects', 'Fastest growing observed open-source projects', generatedAt, 'fresh', 'github-rest-search-real-recent-project-signals'),
    candidate_count: growing.total, caveats: projectCaveats, discovery_queries: ['stars:>500 pushed:>=2026-04-01 archived:false', 'created:>=2025-01-01 stars:>1000 archived:false'], candidate_count_by_query: growing.queryStats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [growing.projects.length], top_10_signal: [growing.projects.slice(0, 10).reduce((sum, project) => sum + project.pull_requests_merged_7d, 0)] },
    entries: growing.projects
  };
  const agenticProjects: RankingSnapshot<RankedProject> = {
    ...snapshotBase('category', 'agentic-projects', 'Agentic Projects', 'Top observed agentic open-source projects', generatedAt, 'fresh', 'github-rest-search-agentic-project-signals'),
    candidate_count: agentic.total, caveats: projectCaveats, discovery_queries: agentic.queryStats.map((stat) => stat.query), candidate_count_by_query: agentic.queryStats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [agentic.projects.length], top_10_signal: [agentic.projects.slice(0, 10).reduce((sum, project) => sum + (project.pull_requests_merged_30d ?? project.pull_requests_merged_7d), 0)] },
    entries: agentic.projects
  };
  const claudeProjects: RankingSnapshot<RankedProject> = {
    ...snapshotBase('category', 'claude-projects', 'Claude Projects', 'Top observed Claude-related open-source projects', generatedAt, 'fresh', 'github-rest-search-agentic-project-signals'),
    candidate_count: claude.total, caveats: projectCaveats, discovery_queries: claude.queryStats.map((stat) => stat.query), candidate_count_by_query: claude.queryStats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [claude.projects.length], top_10_signal: [claude.projects.slice(0, 10).reduce((sum, project) => sum + (project.pull_requests_merged_30d ?? project.pull_requests_merged_7d), 0)] },
    entries: claude.projects
  };
  const codexProjects: RankingSnapshot<RankedProject> = {
    ...snapshotBase('category', 'codex-projects', 'Codex Projects', 'Top observed Codex-related open-source projects', generatedAt, 'fresh', 'github-rest-search-agentic-project-signals'),
    candidate_count: codex.total, caveats: projectCaveats, discovery_queries: codex.queryStats.map((stat) => stat.query), candidate_count_by_query: codex.queryStats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [codex.projects.length], top_10_signal: [codex.projects.slice(0, 10).reduce((sum, project) => sum + (project.pull_requests_merged_30d ?? project.pull_requests_merged_7d), 0)] },
    entries: codex.projects
  };
  const openclawProjects: RankingSnapshot<RankedProject> = {
    ...snapshotBase('category', 'openclaw-projects', 'OpenClaw Projects', 'Top observed OpenClaw-related open-source projects', generatedAt, 'fresh', 'github-rest-search-agentic-project-signals'),
    candidate_count: openclaw.total, caveats: projectCaveats, discovery_queries: openclaw.queryStats.map((stat) => stat.query), candidate_count_by_query: openclaw.queryStats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [openclaw.projects.length], top_10_signal: [openclaw.projects.slice(0, 10).reduce((sum, project) => sum + (project.pull_requests_merged_30d ?? project.pull_requests_merged_7d), 0)] },
    entries: openclaw.projects
  };
  const allProjects = [...growing.projects, ...devtools.projects, ...agentic.projects, ...claude.projects, ...codex.projects, ...openclaw.projects];
  const uniqueProjects = [...new Map(allProjects.map((project) => [project.full_name, project])).values()];
  const momentumProjects = rankProjectMomentum(uniqueProjects).slice(0, limit);
  const momentum: RankingSnapshot<RankedProject> = {
    ...snapshotBase('momentum', 'project-momentum-map', 'Project Momentum Map', 'Momentum versus legitimacy map for observed open-source projects', generatedAt, 'fresh', 'derived-github-public-project-signals'),
    candidate_count: uniqueProjects.length, caveats: projectCaveats, discovery_queries: ['derived from current project/category snapshots'], candidate_count_by_query: [],
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [momentumProjects.length], top_10_signal: [momentumProjects.slice(0, 10).reduce((sum, project) => sum + (project.pull_requests_merged_30d ?? project.pull_requests_merged_7d), 0)] },
    entries: momentumProjects
  };
  const allUsers = [...global.users, ...ts.users, ...savedCountryEntries, ...countryResults.flatMap((result) => result.users)];
  const uniqueUsers = [...new Map(allUsers.map((user) => [user.login.toLowerCase(), user])).values()];
  const risingUsers = rankRisingContributors(uniqueUsers).slice(0, limit);
  const rising: RankingSnapshot<RankedContributor> = {
    ...snapshotBase('rising', 'contributors', 'Rising Contributors', 'High-signal observed GitHub contributors with strong activity relative to audience size', generatedAt, 'fresh', 'derived-github-rest-search-one-year-public-activity'),
    candidate_count: uniqueUsers.length, caveats: contributorCaveats, discovery_queries: ['derived from current contributor snapshots'], candidate_count_by_query: [],
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [risingUsers.length], top_10_signal: [risingUsers.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: risingUsers
  };

  return { snapshots: [globalContributors, ...countries, language, category, projects, agenticProjects, claudeProjects, codexProjects, openclawProjects, momentum, rising], remaining: client.remaining };
}
