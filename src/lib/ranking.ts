import type { RankedContributor, RankedProject } from './types.js';

export function rankContributors(entries: Omit<RankedContributor, 'rank'>[]): RankedContributor[] {
  return [...entries]
    .sort((a, b) => (b.observed_public_commits ?? b.public_contributions) - (a.observed_public_commits ?? a.public_contributions) || (b.observed_public_pull_requests ?? 0) - (a.observed_public_pull_requests ?? 0) || (b.public_repos ?? 0) - (a.public_repos ?? 0) || b.followers - a.followers || a.login.localeCompare(b.login))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function rankProjects(entries: Omit<RankedProject, 'rank'>[]): RankedProject[] {
  return [...entries]
    .sort((a, b) => (b.pull_requests_merged_30d ?? b.pull_requests_merged_7d) - (a.pull_requests_merged_30d ?? a.pull_requests_merged_7d) || (b.recent_commits_30d ?? 0) - (a.recent_commits_30d ?? 0) || (b.total_contributors_observed ?? b.active_contributors_30d) - (a.total_contributors_observed ?? a.active_contributors_30d) || b.stars - a.stars || a.full_name.localeCompare(b.full_name))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function rankRisingContributors(entries: Omit<RankedContributor, 'rank'>[]): RankedContributor[] {
  const score = (entry: Omit<RankedContributor, 'rank'>): number => {
    const commits = entry.observed_public_commits ?? entry.public_contributions;
    const prs = entry.observed_public_pull_requests ?? 0;
    const repos = entry.public_repos ?? 0;
    const followers = entry.followers;
    return (commits + prs * 4 + repos * 8) / Math.sqrt(followers + 8);
  };
  return [...entries]
    .sort((a, b) => score(b) - score(a) || (b.observed_public_commits ?? b.public_contributions) - (a.observed_public_commits ?? a.public_contributions) || a.login.localeCompare(b.login))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function momentumScore(project: Omit<RankedProject, 'rank'>): number {
  return (project.pull_requests_merged_30d ?? project.pull_requests_merged_7d) * 20 + (project.recent_commits_30d ?? 0) * 1.4 + (project.releases_90d ?? 0) * 12 + Math.log10(project.stars + 10) * 20;
}

export function legitimacyScore(project: Omit<RankedProject, 'rank'>): number {
  return (project.total_contributors_observed ?? project.active_contributors_30d) * 5 + Math.log10(project.stars + 10) * 45 + (project.releases_90d ?? 0) * 8 + Math.log10((project.open_issues ?? 0) + 10) * 10;
}

export function rankProjectMomentum(entries: Omit<RankedProject, 'rank'>[]): RankedProject[] {
  return [...entries]
    .sort((a, b) => momentumScore(b) - momentumScore(a) || legitimacyScore(b) - legitimacyScore(a) || b.stars - a.stars || a.full_name.localeCompare(b.full_name))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function movement(entry: { rank: number; previous_rank?: number }): string {
  if (!entry.previous_rank) return 'new';
  const delta = entry.previous_rank - entry.rank;
  if (delta === 0) return 'steady';
  return delta > 0 ? `↑ ${delta}` : `↓ ${Math.abs(delta)}`;
}
