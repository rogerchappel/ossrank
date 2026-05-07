export type FreshnessState = 'fresh' | 'stale' | 'failed' | 'demo';

export interface RankedContributor {
  rank: number;
  login: string;
  name?: string;
  profile_url: string;
  public_contributions: number;
  public_repos?: number;
  public_gists?: number;
  observed_public_commits?: number;
  observed_public_pull_requests?: number;
  followers: number;
  location?: string;
  location_confidence?: 'profile-text-match' | 'unknown';
  notable_repositories?: string[];
  previous_rank?: number;
}

export interface RankedProject {
  rank: number;
  full_name: string;
  url: string;
  stars: number;
  pull_requests_merged_7d: number;
  active_contributors_30d: number;
  primary_language?: string;
  previous_rank?: number;
}

export interface TrendSeries {
  weeks: string[];
  ranked_items: number[];
  top_10_signal: number[];
}

export interface RankingSnapshot<TEntry> {
  kind: 'country' | 'global' | 'language' | 'category' | 'projects';
  slug: string;
  code?: string;
  name: string;
  title: string;
  generated_at: string;
  fresh_until: string;
  status: FreshnessState;
  method: string;
  source_run: string;
  candidate_count: number;
  caveats: string[];
  history: TrendSeries;
  entries: TEntry[];
}

export interface ManifestShard {
  kind: RankingSnapshot<unknown>['kind'];
  slug: string;
  title: string;
  path: string;
  status: FreshnessState;
  generated_at: string;
  fresh_until: string;
  entries: number;
}

export interface Manifest {
  generated_at: string;
  source_commit: string;
  method: string;
  status: FreshnessState;
  completed_shards: ManifestShard[];
  failed_shards: Array<{ slug: string; reason: string }>;
  stale_pages: string[];
  api_budget: { provider: 'github'; mode: 'fixture' | 'live'; remaining?: number; cost?: number };
  duration_ms: number;
}
