import type { RankedContributor, RankedProject } from './types.js';

export function rankContributors(entries: Omit<RankedContributor, 'rank'>[]): RankedContributor[] {
  return [...entries]
    .sort((a, b) => (b.observed_public_commits ?? b.public_contributions) - (a.observed_public_commits ?? a.public_contributions) || (b.observed_public_pull_requests ?? 0) - (a.observed_public_pull_requests ?? 0) || (b.public_repos ?? 0) - (a.public_repos ?? 0) || b.followers - a.followers || a.login.localeCompare(b.login))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function rankProjects(entries: Omit<RankedProject, 'rank'>[]): RankedProject[] {
  return [...entries]
    .sort((a, b) => b.pull_requests_merged_7d - a.pull_requests_merged_7d || b.active_contributors_30d - a.active_contributors_30d || b.stars - a.stars || a.full_name.localeCompare(b.full_name))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function movement(entry: { rank: number; previous_rank?: number }): string {
  if (!entry.previous_rank) return 'new';
  const delta = entry.previous_rank - entry.rank;
  if (delta === 0) return 'steady';
  return delta > 0 ? `↑ ${delta}` : `↓ ${Math.abs(delta)}`;
}
