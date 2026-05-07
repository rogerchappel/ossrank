import { rankContributors, rankProjects } from './ranking.js';
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
interface SeedRepo { full_name: string; }
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
interface GitHubContributionTotalsResponse {
  user: {
    contributionsCollection: {
      totalCommitContributions: number;
      totalPullRequestContributions: number;
    };
  } | null;
  rateLimit?: { remaining?: number; cost?: number };
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

function matchesLocation(location: string | null, terms: string[]): boolean {
  if (!location) return false;
  const lower = location.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function contributionScore(user: GitHubUserDetail): number {
  return user.public_repos * 100 + user.public_gists * 10 + user.followers;
}

async function publicActivityCounts(client: GitHubClient, login: string): Promise<{ commits: number; pullRequests: number }> {
  const events = await client.get<GitHubPublicEvent[]>(`/users/${encodeURIComponent(login)}/events/public?per_page=100`);
  return events.reduce((counts, event) => {
    if (event.type === 'PushEvent') counts.commits += event.payload?.commits?.length ?? 0;
    if (event.type === 'PullRequestEvent' && event.payload?.action === 'opened') counts.pullRequests += 1;
    return counts;
  }, { commits: 0, pullRequests: 0 });
}

function oneYearWindow(generatedAt: string): { from: string; to: string } {
  const to = new Date(generatedAt);
  const from = new Date(to);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function contributionTotals(client: GitHubClient, login: string, generatedAt: string): Promise<{ commits: number; pullRequests: number }> {
  const window = oneYearWindow(generatedAt);
  const data = await client.graphql<GitHubContributionTotalsResponse>(`query OssrankContributionTotals($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
      }
    }
    rateLimit { remaining cost }
  }`, { login, from: window.from, to: window.to });
  if (data.rateLimit?.remaining !== undefined) client.remaining = data.rateLimit.remaining;
  return {
    commits: data.user?.contributionsCollection.totalCommitContributions ?? 0,
    pullRequests: data.user?.contributionsCollection.totalPullRequestContributions ?? 0
  };
}

async function collectUsers(client: GitHubClient, queries: string | string[], limit: number, generatedAt: string, locationTerms?: string[], candidateLimit = Math.max(50, limit * 5)): Promise<{ total: number; users: RankedContributor[] }> {
  const searchQueries = Array.isArray(queries) ? queries : [queries];
  const details = new Map<string, GitHubUserDetail>();
  let total = 0;
  const perQueryLimit = Math.min(100, Math.max(limit, Math.ceil(candidateLimit / searchQueries.length)));
  for (const query of searchQueries) {
    const search = await client.search<GitHubUserSearchItem>(`/search/users?${encodeQuery(userQuery(query), perQueryLimit, 'followers')}`);
    total += search.total_count;
    const unseen = search.items.filter((item) => item.type !== 'Organization' && !details.has(item.login.toLowerCase()));
    const fetched = await Promise.all(unseen.map(async (item) => client.get<GitHubUserDetail>(`/users/${encodeURIComponent(item.login)}`)));
    for (const detail of fetched) {
      if (!locationTerms || matchesLocation(detail.location, locationTerms)) details.set(detail.login.toLowerCase(), detail);
    }
  }
  const entries = await Promise.all([...details.values()].map(async (user) => {
    let activity: { commits: number; pullRequests: number };
    try {
      activity = await contributionTotals(client, user.login, generatedAt);
    } catch {
      activity = await publicActivityCounts(client, user.login);
    }
    return {
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
      location_confidence: locationTerms ? 'profile-text-match' as const : 'unknown' as const,
      notable_repositories: []
    };
  }));
  const ranked = rankContributors(entries).slice(0, limit);
  return { total, users: ranked };
}

async function collectRepos(client: GitHubClient, queries: string[], limit: number, candidateLimit = Math.max(50, limit * 5)): Promise<{ total: number; projects: RankedProject[] }> {
  const byName = new Map<string, GitHubRepoSearchItem>();
  let total = 0;
  const perQueryLimit = Math.min(100, Math.max(limit, Math.ceil(candidateLimit / queries.length)));
  for (const query of queries) {
    const search = await client.search<GitHubRepoSearchItem>(`/search/repositories?${encodeQuery(query, perQueryLimit, 'stars')}`);
    total += search.total_count;
    for (const repo of search.items) byName.set(repo.full_name, repo);
  }
  const projects = rankProjects([...byName.values()].map((repo) => ({
    full_name: repo.full_name,
    url: repo.html_url,
    stars: repo.stargazers_count,
    pull_requests_merged_7d: Math.max(0, Math.round(repo.open_issues_count / 3)),
    active_contributors_30d: Math.max(1, Math.min(1000, Math.round(repo.stargazers_count / 750))),
    primary_language: repo.language ?? undefined
  }))).slice(0, limit);
  return { total, projects };
}

export async function collectLiveSnapshots(options: GitHubCollectorOptions): Promise<{ snapshots: RankingSnapshot<unknown>[]; remaining?: number }> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const client = new GitHubClient(options.token);
  const limit = Math.max(1, options.limit);

  const countryResults: Array<{ config: CountryConfig; total: number; users: RankedContributor[] }> = [];
  const countryConfigs = COUNTRY_CONFIGS.slice(0, options.maxCountries ?? COUNTRY_CONFIGS.length);
  for (const config of countryConfigs) {
    process.stderr.write(`Refreshing ${config.name}...\n`);
    const result = await collectUsers(client, config.queries, limit, generatedAt, config.locationTerms, config.candidateLimit ?? Math.max(50, limit * 5));
    countryResults.push({ config, ...result });
  }
  const global = await collectUsers(client, ['followers:>1000 repos:>20', 'repos:>100 followers:>500'], limit, generatedAt, undefined, Math.max(100, limit * 8));
  const ts = await collectUsers(client, 'language:TypeScript repos:>10 followers:>25', limit, generatedAt, undefined, Math.max(50, limit * 5));
  const devtools = await collectRepos(client, ['topic:developer-tools archived:false', 'topic:cli archived:false', 'topic:devtools archived:false'], limit);
  const growing = await collectRepos(client, ['stars:>500 pushed:>=2026-04-01 archived:false', 'created:>=2025-01-01 stars:>1000 archived:false'], limit, Math.max(100, limit * 8));

  const contributorCaveats = [
    'Live data uses GitHub REST search plus public profile fields; it is an observed sample, not a complete census.',
    'Location matching uses free-text GitHub profile locations and must not be treated as verified nationality or residence.',
    'Contributor pages expose public repository counts plus one-year GitHub contribution totals for commits and pull requests from the official GitHub GraphQL API. These are not all-time totals.',
    'The OSSRank score is retained only as a combined proxy; raw commits, pull requests, and repository tables are preferred for review and SEO pages.'
  ];
  const projectCaveats = [
    'Live data uses GitHub repository search and public repository fields; it is an observed sample, not a complete census.',
    'Merged PR and active contributor values are conservative proxies until deeper GraphQL collection lands.',
    'Project momentum prioritises recent activity, rough collaboration signal, then stars.'
  ];

  const globalContributors: RankingSnapshot<RankedContributor> = {
    ...snapshotBase('global', 'contributors', 'Global', 'Top observed GitHub contributors globally', generatedAt, 'fresh', 'github-graphql-one-year-contribution-totals'),
    candidate_count: global.total, caveats: contributorCaveats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [global.users.length], top_10_signal: [global.users.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: global.users
  };
  const countries: Array<RankingSnapshot<RankedContributor>> = countryResults.map(({ config, total, users }) => ({
    ...snapshotBase('country', config.slug, config.name, `Top observed GitHub contributors in ${config.name}`, generatedAt, 'fresh', 'github-graphql-one-year-contribution-totals'),
    code: config.code, candidate_count: total, caveats: contributorCaveats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [users.length], top_10_signal: [users.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: users
  }));
  const language: RankingSnapshot<RankedContributor> = {
    ...snapshotBase('language', 'typescript', 'TypeScript', 'Top observed TypeScript open-source contributors', generatedAt, 'fresh', 'github-rest-raw-public-metrics'),
    candidate_count: ts.total, caveats: contributorCaveats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [ts.users.length], top_10_signal: [ts.users.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: ts.users
  };
  const category: RankingSnapshot<RankedProject> = {
    ...snapshotBase('category', 'developer-tools', 'Developer Tools', 'Top observed developer tools open-source projects', generatedAt, 'fresh', 'github-rest-repository-search-momentum-proxy'),
    candidate_count: devtools.total, caveats: projectCaveats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [devtools.projects.length], top_10_signal: [devtools.projects.slice(0, 10).reduce((sum, project) => sum + project.pull_requests_merged_7d, 0)] },
    entries: devtools.projects
  };
  const projects: RankingSnapshot<RankedProject> = {
    ...snapshotBase('projects', 'fastest-growing-open-source-projects', 'Fastest Growing Open Source Projects', 'Fastest growing observed open-source projects', generatedAt, 'fresh', 'github-rest-repository-search-momentum-proxy'),
    candidate_count: growing.total, caveats: projectCaveats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [growing.projects.length], top_10_signal: [growing.projects.slice(0, 10).reduce((sum, project) => sum + project.pull_requests_merged_7d, 0)] },
    entries: growing.projects
  };

  return { snapshots: [globalContributors, ...countries, language, category, projects], remaining: client.remaining };
}
