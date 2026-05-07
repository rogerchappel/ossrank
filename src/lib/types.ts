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
  location_confidence?: 'exact-country' | 'city-match' | 'multi-location' | 'profile-text-match' | 'unknown';
  discovered_by_query?: string;
  notable_repositories?: string[];
  previous_rank?: number;
}

export interface RankedProject {
  rank: number;
  full_name: string;
  url: string;
  stars: number;
  pull_requests_merged_7d: number;
  pull_requests_merged_30d?: number;
  recent_commits_30d?: number;
  active_contributors_30d: number;
  total_contributors_observed?: number;
  releases_90d?: number;
  open_issues?: number;
  pushed_at?: string;
  discovered_by_query?: string;
  primary_language?: string;
  previous_rank?: number;
}

export interface TrendSeries {
  weeks: string[];
  ranked_items: number[];
  top_10_signal: number[];
}

export interface RankingSnapshot<TEntry> {
  kind: 'country' | 'global' | 'language' | 'category' | 'projects' | 'rising' | 'momentum';
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
  discovery_queries?: string[];
  candidate_count_by_query?: Array<{ query: string; total: number; accepted: number }>;
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
