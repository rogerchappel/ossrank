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
  return user.public_repos * 25 + user.public_gists * 5 + user.followers;
}

async function collectUsers(client: GitHubClient, query: string, limit: number, locationTerms?: string[]): Promise<{ total: number; users: RankedContributor[] }> {
  const search = await client.search<GitHubUserSearchItem>(`/search/users?${encodeQuery(query, limit)}`);
  const details: GitHubUserDetail[] = [];
  for (const item of search.items.slice(0, limit)) {
    const detail = await client.get<GitHubUserDetail>(`/users/${encodeURIComponent(item.login)}`);
    if (!locationTerms || matchesLocation(detail.location, locationTerms)) details.push(detail);
  }
  const ranked = rankContributors(details.map((user) => ({
    login: user.login,
    name: user.name ?? undefined,
    profile_url: user.html_url,
    public_contributions: contributionScore(user),
    followers: user.followers,
    location: user.location ?? undefined,
    location_confidence: locationTerms ? 'profile-text-match' as const : 'unknown' as const,
    notable_repositories: []
  })));
  return { total: search.total_count, users: ranked };
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

  const au = await collectUsers(client, 'location:Australia repos:>5 followers:>10', limit, ['Australia', 'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Hobart', 'Darwin']);
  const ts = await collectUsers(client, 'language:TypeScript repos:>10 followers:>25', limit);
  const devtools = await collectRepos(client, ['topic:developer-tools archived:false', 'topic:cli archived:false', 'topic:devtools archived:false'], limit);
  const growing = await collectRepos(client, ['stars:>500 pushed:>=2026-04-01 archived:false'], limit);

  const contributorCaveats = [
    'Live data uses GitHub REST search plus public profile fields; it is an observed sample, not a complete census.',
    'Location matching uses free-text GitHub profile locations and must not be treated as verified nationality or residence.',
    'Contribution score is a transparent proxy from public repos, public gists, and followers; deeper GraphQL event scoring is planned.'
  ];
  const projectCaveats = [
    'Live data uses GitHub repository search and public repository fields; it is an observed sample, not a complete census.',
    'Merged PR and active contributor values are conservative proxies until deeper GraphQL collection lands.',
    'Project momentum prioritises recent activity, rough collaboration signal, then stars.'
  ];

  const country: RankingSnapshot<RankedContributor> = {
    ...snapshotBase('country', 'australia', 'Australia', 'Top observed GitHub contributors in Australia', generatedAt, 'fresh', 'github-rest-search-profile-score'),
    code: 'AU', candidate_count: au.total, caveats: contributorCaveats,
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [au.users.length], top_10_signal: [au.users.slice(0, 10).reduce((sum, user) => sum + user.public_contributions, 0)] },
    entries: au.users
  };
  const language: RankingSnapshot<RankedContributor> = {
    ...snapshotBase('language', 'typescript', 'TypeScript', 'Top observed TypeScript open-source contributors', generatedAt, 'fresh', 'github-rest-search-profile-score'),
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
