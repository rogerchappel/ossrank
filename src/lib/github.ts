import { rankContributors, rankProjectMomentum, rankProjects, rankRisingContributors } from './ranking.js';
import { COUNTRY_CONFIGS, type CountryConfig } from './countries.js';
import { snapshotBase } from './snapshots.js';
import type { RankedContributor, RankedProject, RankingSnapshot } from './types.js';

export interface GitHubCollectorOptions {
  token?: string;
  limit: number;
  generatedAt?: string;
  maxCountries?: number;
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
interface GitHubUserProfileResponse {
  user: {
    login: string;
    name: string | null;
    url: string;
    repositories: { totalCount: number };
    gists: { totalCount: number };
    followers: { totalCount: number };
    location: string | null;
    contributionsCollection: {
      totalCommitContributions: number;
      totalPullRequestContributions: number;
    };
  } | null;
  rateLimit?: { remaining?: number; cost?: number };
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

export class GitHubClient {
  remaining?: number;
  constructor(private readonly token?: string) {}

  async get<T>(path: string): Promise<T> {
    const response = await fetchWithRetry(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ossrank/0.1.0',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      }
    });
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining) this.remaining = Number(remaining);
    if (!response.ok) throw new Error(`GitHub ${response.status} for ${path}: ${await response.text()}`);
    return await response.json() as T;
  }

  async rawGet(path: string): Promise<Response> {
    const response = await fetchWithRetry(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ossrank/0.1.0',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      }
    });
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining) this.remaining = Number(remaining);
    if (!response.ok) throw new Error(`GitHub ${response.status} for ${path}: ${await response.text()}`);
    return response;
  }

  async search<T>(path: string): Promise<GitHubSearchResponse<T>> {
    return await this.get<GitHubSearchResponse<T>>(path);
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (!this.token) throw new Error('GitHub GraphQL requires OSSRANK_GITHUB_TOKEN');
    const response = await fetchWithRetry('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'ossrank/0.1.0',
        Authorization: `Bearer ${this.token}`
      },
      body: JSON.stringify({ query, variables })
    });
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining) this.remaining = Number(remaining);
    const body = await response.json() as GitHubGraphqlResponse<T>;
    if (!response.ok || body.errors?.length) throw new Error(`GitHub GraphQL failed: ${body.errors?.map((error) => error.message).join('; ') ?? response.statusText}`);
    if (!body.data) throw new Error('GitHub GraphQL returned no data');
    return body.data;
  }
}

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

function oneYearWindow(generatedAt: string): { from: string; to: string } {
  const to = new Date(generatedAt);
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function userProfileAndContributions(client: GitHubClient, login: string, generatedAt: string): Promise<{ user: GitHubUserDetail; activity: { commits: number; pullRequests: number } } | null> {
  const window = oneYearWindow(generatedAt);
  const data = await client.graphql<GitHubUserProfileResponse>(`query OssrankUserProfile($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      login
      name
      url
      repositories(ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount }
      gists(privacy: PUBLIC) { totalCount }
      followers { totalCount }
      location
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
      }
    }
    rateLimit { remaining cost }
  }`, { login, from: window.from, to: window.to });
  if (data.rateLimit?.remaining !== undefined) client.remaining = data.rateLimit.remaining;
  if (!data.user) return null;
  return {
    user: {
      login: data.user.login,
      name: data.user.name,
      html_url: data.user.url,
      public_repos: data.user.repositories.totalCount,
      public_gists: data.user.gists.totalCount,
      followers: data.user.followers.totalCount,
      location: data.user.location
    },
    activity: {
      commits: data.user.contributionsCollection.totalCommitContributions,
      pullRequests: data.user.contributionsCollection.totalPullRequestContributions
    }
  };
}

async function searchUsers(client: GitHubClient, query: string, limit: number): Promise<{ total: number; items: GitHubUserSearchItem[] }> {
  const data = await client.graphql<GitHubUserSearchResponse>(`query OssrankUserSearch($query: String!, $limit: Int!) {
    search(type: USER, query: $query, first: $limit) {
      userCount
      nodes { ... on User { login } }
    }
    rateLimit { remaining cost }
  }`, { query, limit: Math.min(100, Math.max(1, limit)) });
  if (data.rateLimit?.remaining !== undefined) client.remaining = data.rateLimit.remaining;
  return {
    total: data.search.userCount,
    items: data.search.nodes.filter((node): node is { login: string } => Boolean(node?.login)).map((node) => ({ login: node.login, html_url: `https://github.com/${node.login}`, type: 'User' }))
  };
}

async function collectUsers(client: GitHubClient, queries: string | string[], limit: number, generatedAt: string, locationTerms?: string[], countryName?: string, candidateLimit = Math.max(50, limit * 5)): Promise<{ total: number; users: RankedContributor[]; queryStats: CandidateQueryStat[] }> {
  const searchQueries = Array.isArray(queries) ? queries : [queries];
  const details = new Map<string, UserCandidate>();
  const queryStats: CandidateQueryStat[] = [];
  let total = 0;
  const perQueryLimit = Math.min(100, Math.max(limit, Math.ceil(candidateLimit / searchQueries.length)));
  for (const query of searchQueries) {
    const search = await searchUsers(client, userQuery(query), perQueryLimit);
    total += search.total;
    const before = details.size;
    const unseen = search.items.filter((item) => item.type !== 'Organization' && !details.has(item.login.toLowerCase()));
    const fetched = await mapLimit(unseen, 8, async (item) => userProfileAndContributions(client, item.login, generatedAt));
    for (const detail of fetched) {
      if (detail && (!locationTerms || matchesLocation(detail.user.location, locationTerms))) details.set(detail.user.login.toLowerCase(), { ...detail, discoveredByQuery: userQuery(query) });
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
  if (data.rateLimit?.remaining !== undefined) client.remaining = data.rateLimit.remaining;
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

async function collectRepos(client: GitHubClient, queries: string[], limit: number, generatedAt: string, candidateLimit = Math.max(50, limit * 5)): Promise<{ total: number; projects: RankedProject[]; queryStats: CandidateQueryStat[] }> {
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
  const measured = await mapLimit([...byName.values()], 8, async ({ repo, discoveredByQuery }) => {
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

export async function collectLiveSnapshots(options: GitHubCollectorOptions): Promise<{ snapshots: RankingSnapshot<unknown>[]; remaining?: number }> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const client = new GitHubClient(options.token);
  const limit = Math.max(1, options.limit);

  const countryResults: Array<{ config: CountryConfig; total: number; users: RankedContributor[]; queryStats: CandidateQueryStat[] }> = [];
  const countryConfigs = COUNTRY_CONFIGS.slice(0, options.maxCountries ?? COUNTRY_CONFIGS.length);
  for (const config of countryConfigs) {
    process.stderr.write(`Refreshing ${config.name}...\n`);
    const result = await collectUsers(client, config.queries, limit, generatedAt, config.locationTerms, config.name, config.candidateLimit ?? Math.max(50, limit * 5));
    countryResults.push({ config, ...result });
  }
  const global = await collectUsers(client, ['followers:>1000 repos:>20', 'repos:>100 followers:>500'], limit, generatedAt, undefined, undefined, Math.max(100, limit * 8));
  const ts = await collectUsers(client, 'language:TypeScript repos:>10 followers:>25', limit, generatedAt, undefined, undefined, Math.max(50, limit * 5));
  const devtools = await collectRepos(client, ['topic:developer-tools archived:false', 'topic:cli archived:false', 'topic:devtools archived:false'], limit, generatedAt);
  const growing = await collectRepos(client, ['stars:>500 pushed:>=2026-04-01 archived:false', 'created:>=2025-01-01 stars:>1000 archived:false'], limit, generatedAt, Math.max(100, limit * 8));
  const agentic = await collectRepos(client, ['agentic archived:false pushed:>=2026-04-01', 'topic:ai-agents archived:false', 'topic:llm-agents archived:false', 'topic:mcp archived:false', 'agent framework archived:false stars:>100'], limit, generatedAt, Math.max(80, limit * 5));
  const claude = await collectRepos(client, ['claude archived:false pushed:>=2026-04-01', 'claude-code archived:false', 'topic:claude archived:false', 'anthropic claude archived:false stars:>50'], limit, generatedAt, Math.max(60, limit * 4));
  const codex = await collectRepos(client, ['codex archived:false pushed:>=2026-04-01', 'openai codex archived:false', 'topic:codex archived:false', 'codex cli archived:false'], limit, generatedAt, Math.max(60, limit * 4));
  const openclaw = await collectRepos(client, ['openclaw archived:false', 'topic:openclaw archived:false', 'openclaw agent archived:false'], limit, generatedAt, Math.max(40, limit * 3));

  const contributorCaveats = [
    'Live data uses GitHub REST search plus public profile fields; it is an observed sample, not a complete census.',
    'Location matching uses free-text GitHub profile locations and must not be treated as verified nationality or residence.',
    'Contributor pages expose public repository counts plus one-year GitHub contribution totals for commits and pull requests from the official GitHub GraphQL API. These are not all-time totals.',
    'The OSSRank score is retained only as a combined proxy; raw commits, pull requests, and repository tables are preferred for review and SEO pages.'
  ];
  const projectCaveats = [
    'Live data uses GitHub repository search and public repository fields; it is an observed sample, not a complete census.',
    'Project PR counts use recent merged pull requests visible through GitHub GraphQL; high-volume repositories may be capped by the first 100 recently updated merged PRs per snapshot.',
    'Recent commit, release, issue, and star fields come from official GitHub APIs. Contributor count is observed all-time contributors when the REST budget permits, not unique 30-day contributors.',
    'Project momentum prioritises recent merged PRs, recent commits, observed contributors, then stars.'
  ];

  const globalContributors: RankingSnapshot<RankedContributor> = {
    ...snapshotBase('global', 'contributors', 'Global', 'Top observed GitHub contributors globally', generatedAt, 'fresh', 'github-graphql-one-year-contribution-totals'),
    candidate_count: global.total, caveats: contributorCaveats, discovery_queries: ['followers:>1000 repos:>20 type:user', 'repos:>100 followers:>500 type:user'], candidate_count_by_query: global.queryStats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [global.users.length], top_10_signal: [global.users.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: global.users
  };
  const countries: Array<RankingSnapshot<RankedContributor>> = countryResults.map(({ config, total, users }) => ({
    ...snapshotBase('country', config.slug, config.name, `Top observed GitHub contributors in ${config.name}`, generatedAt, 'fresh', 'github-graphql-one-year-contribution-totals'),
    code: config.code, candidate_count: total, caveats: contributorCaveats, discovery_queries: config.queries.map(userQuery), candidate_count_by_query: (countryResults.find((r) => r.config.slug === config.slug)?.queryStats ?? []),
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [users.length], top_10_signal: [users.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: users
  }));
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
  const allUsers = [...global.users, ...ts.users, ...countryResults.flatMap((result) => result.users)];
  const uniqueUsers = [...new Map(allUsers.map((user) => [user.login.toLowerCase(), user])).values()];
  const risingUsers = rankRisingContributors(uniqueUsers).slice(0, limit);
  const rising: RankingSnapshot<RankedContributor> = {
    ...snapshotBase('rising', 'contributors', 'Rising Contributors', 'High-signal observed GitHub contributors with strong activity relative to audience size', generatedAt, 'fresh', 'derived-github-graphql-one-year-contribution-totals'),
    candidate_count: uniqueUsers.length, caveats: contributorCaveats, discovery_queries: ['derived from current contributor snapshots'], candidate_count_by_query: [],
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [risingUsers.length], top_10_signal: [risingUsers.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: risingUsers
  };

  return { snapshots: [globalContributors, ...countries, language, category, projects, agenticProjects, claudeProjects, codexProjects, openclawProjects, momentum, rising], remaining: client.remaining };
}
