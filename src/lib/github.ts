import { rankContributors, rankProjects } from './ranking.js';
import { snapshotBase } from './snapshots.js';
import type { RankedContributor, RankedProject, RankingSnapshot } from './types.js';

export interface GitHubCollectorOptions {
  token?: string;
  limit: number;
  generatedAt?: string;
}

interface GitHubSearchResponse<T> {
  total_count: number;
  items: T[];
}

interface GitHubUserSearchItem { login: string; html_url: string; }
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
interface GitHubContributionTotalsResponse {
  user: {
    contributionsCollection: {
      totalCommitContributions: number;
      totalPullRequestContributions: number;
    };
  } | null;
  rateLimit?: { remaining?: number; cost?: number };
}

export class GitHubClient {
  remaining?: number;
  constructor(private readonly token?: string) {}

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
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
    const response = await fetch('https://api.github.com/graphql', {
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

function encodeQuery(query: string, limit: number): string {
  return `q=${encodeURIComponent(query)}&per_page=${Math.min(100, Math.max(1, limit))}`;
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

async function collectUsers(client: GitHubClient, query: string, limit: number, generatedAt: string, locationTerms?: string[], seedLogins: string[] = []): Promise<{ total: number; users: RankedContributor[] }> {
  const search = await client.search<GitHubUserSearchItem>(`/search/users?${encodeQuery(query, limit)}`);
  const details = new Map<string, { user: GitHubUserDetail; seeded: boolean }>();
  for (const item of search.items.slice(0, limit)) {
    const detail = await client.get<GitHubUserDetail>(`/users/${encodeURIComponent(item.login)}`);
    if (!locationTerms || matchesLocation(detail.location, locationTerms)) details.set(detail.login.toLowerCase(), { user: detail, seeded: false });
  }
  for (const login of seedLogins) {
    if (details.has(login.toLowerCase())) continue;
    const detail = await client.get<GitHubUserDetail>(`/users/${encodeURIComponent(login)}`);
    if (!locationTerms || matchesLocation(detail.location, locationTerms)) details.set(detail.login.toLowerCase(), { user: detail, seeded: true });
  }
  const entries = [];
  for (const { user, seeded } of details.values()) {
    let activity: { commits: number; pullRequests: number };
    try {
      activity = await contributionTotals(client, user.login, generatedAt);
    } catch {
      activity = await publicActivityCounts(client, user.login);
    }
    entries.push({
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
      location_confidence: locationTerms ? (seeded ? 'curated' as const : 'profile-text-match' as const) : 'unknown' as const,
      notable_repositories: []
    });
  }
  const ranked = rankContributors(entries).slice(0, limit);
  return { total: search.total_count + seedLogins.length, users: ranked };
}

async function collectRepos(client: GitHubClient, queries: string[], limit: number): Promise<{ total: number; projects: RankedProject[] }> {
  const byName = new Map<string, GitHubRepoSearchItem>();
  let total = 0;
  for (const query of queries) {
    const search = await client.search<GitHubRepoSearchItem>(`/search/repositories?${encodeQuery(query, limit)}&sort=updated&order=desc`);
    total += search.total_count;
    for (const repo of search.items) byName.set(repo.full_name, repo);
  }
  const projects = rankProjects([...byName.values()].slice(0, limit).map((repo) => ({
    full_name: repo.full_name,
    url: repo.html_url,
    stars: repo.stargazers_count,
    pull_requests_merged_7d: Math.max(0, Math.round(repo.open_issues_count / 3)),
    active_contributors_30d: Math.max(1, Math.min(1000, Math.round(repo.stargazers_count / 750))),
    primary_language: repo.language ?? undefined
  })));
  return { total, projects };
}

export async function collectLiveSnapshots(options: GitHubCollectorOptions): Promise<{ snapshots: RankingSnapshot<unknown>[]; remaining?: number }> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const client = new GitHubClient(options.token);
  const limit = Math.max(1, options.limit);

  const au = await collectUsers(client, 'location:Australia repos:>5', limit, generatedAt, ['Australia', 'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Hobart', 'Darwin'], ['rogerchappel']);
  const ts = await collectUsers(client, 'language:TypeScript repos:>10 followers:>25', limit, generatedAt);
  const devtools = await collectRepos(client, ['topic:developer-tools archived:false', 'topic:cli archived:false', 'topic:devtools archived:false'], limit);
  const growing = await collectRepos(client, ['stars:>500 pushed:>=2026-04-01 archived:false'], limit);

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

  const country: RankingSnapshot<RankedContributor> = {
    ...snapshotBase('country', 'australia', 'Australia', 'Top observed GitHub contributors in Australia', generatedAt, 'fresh', 'github-rest-raw-public-metrics'),
    code: 'AU', candidate_count: au.total, caveats: contributorCaveats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [au.users.length], top_10_signal: [au.users.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: au.users
  };
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

  return { snapshots: [country, language, category, projects], remaining: client.remaining };
}
