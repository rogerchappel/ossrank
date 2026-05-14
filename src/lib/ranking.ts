import type { ContributorBurstAdjustment, RankedContributor, RankedProject } from './types.js';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function robustDailyBaseline(dailyCounts: number[]): number {
  const activeDays = dailyCounts.filter((count) => count > 0);
  if (activeDays.length === 0) return 0;
  const trimCount = Math.min(activeDays.length - 1, Math.max(1, Math.ceil(activeDays.length * 0.02)));
  const trimmed = [...activeDays].sort((a, b) => a - b).slice(0, activeDays.length - trimCount);
  return Math.max(1, median(trimmed));
}

function adaptiveDailyBurstCap(baseline: number): number {
  return Math.ceil(Math.max(baseline * 20, baseline * baseline * 15));
}

export function contributionBurstAdjustment(rawPublicCommits: number, dailyContributionCounts: number[]): ContributorBurstAdjustment | undefined {
  if (rawPublicCommits <= 0 || dailyContributionCounts.length === 0) return undefined;
  const baseline = robustDailyBaseline(dailyContributionCounts);
  if (baseline <= 0) return undefined;

  const cap = adaptiveDailyBurstCap(baseline);
  let excessContributions = 0;
  let cappedDays = 0;
  for (const count of dailyContributionCounts) {
    if (count > cap) {
      excessContributions += count - cap;
      cappedDays += 1;
    }
  }
  if (cappedDays === 0 || excessContributions <= 0) return undefined;

  return {
    raw_public_commits: rawPublicCommits,
    adjusted_public_commits: Math.max(0, rawPublicCommits - Math.round(excessContributions)),
    baseline_daily_contributions: Number(baseline.toFixed(2)),
    daily_burst_cap: cap,
    capped_days: cappedDays,
    excess_contributions: Math.round(excessContributions),
    reason: 'per-user daily contribution burst exceeded an adaptive baseline cap; raw public commits are preserved for audit'
  };
}

export function contributorCommitSignal(entry: Omit<RankedContributor, 'rank'>): number {
  return entry.contribution_burst_adjustment?.adjusted_public_commits ?? entry.observed_public_commits ?? entry.public_contributions;
}

export function rankContributors(entries: Omit<RankedContributor, 'rank'>[]): RankedContributor[] {
  return [...entries]
    .sort((a, b) => contributorCommitSignal(b) - contributorCommitSignal(a) || (b.observed_public_pull_requests ?? 0) - (a.observed_public_pull_requests ?? 0) || (b.public_repos ?? 0) - (a.public_repos ?? 0) || b.followers - a.followers || a.login.localeCompare(b.login))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function rankProjects(entries: Omit<RankedProject, 'rank'>[]): RankedProject[] {
  return [...entries]
    .sort((a, b) => (b.pull_requests_merged_30d ?? b.pull_requests_merged_7d) - (a.pull_requests_merged_30d ?? a.pull_requests_merged_7d) || (b.recent_commits_30d ?? 0) - (a.recent_commits_30d ?? 0) || (b.total_contributors_observed ?? b.active_contributors_30d) - (a.total_contributors_observed ?? a.active_contributors_30d) || b.stars - a.stars || a.full_name.localeCompare(b.full_name))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function rankRisingContributors(entries: Omit<RankedContributor, 'rank'>[]): RankedContributor[] {
  const score = (entry: Omit<RankedContributor, 'rank'>): number => {
    const commits = contributorCommitSignal(entry);
    const prs = entry.observed_public_pull_requests ?? 0;
    const repos = entry.public_repos ?? 0;
    const followers = entry.followers;
    return (commits + prs * 4 + repos * 8) / Math.sqrt(followers + 8);
  };
  return [...entries]
    .sort((a, b) => score(b) - score(a) || contributorCommitSignal(b) - contributorCommitSignal(a) || a.login.localeCompare(b.login))
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
