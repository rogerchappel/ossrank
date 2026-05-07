# PRD: ossrank

Status: ready
Decision: greenlit for next OSS cron

## Scorecard

Total: 86/100
Band: build now
Last scored: 2026-05-07
Scored by: Roger + Neo

| Criterion | Points | Notes |
|---|---:|---|
| Problem pain | 16/20 | Existing GitHub/OSS ranking sites are useful but often stale, opaque about freshness, and weak on methodology. |
| Demand signal | 18/20 | `ashkulz/committers.top` and `lauripiispanen/most-active-github-users-counter` prove durable interest in contributor leaderboards; SEO demand exists for country/language/project rankings. |
| V1 buildability | 18/20 | A static-first site plus precomputed JSON, mocked GitHub API tests, and scheduled Actions refreshes is very buildable if the initial data scope is constrained. |
| Differentiation | 13/15 | Differentiate through freshness, reproducibility, transparent caveats, historical snapshots, charts, badges, and route/product breadth beyond country-only contributor tables. |
| Agentic workflow leverage | 11/15 | Useful for OSS discovery, ecosystem research, outreach lists, agent-generated weekly refreshes, and maintaining public data products. |
| Distribution potential | 10/10 | `ossrank.dev` is short, memorable, SEO-aligned, and broad enough for contributors, projects, languages, categories, badges, and trend pages. |

## Naming / Domain

Public product name: `OSSRank`.

Purchased domain: `ossrank.dev`.

Internal history: this idea was previously tracked as `contribatlas`; do not ship that as the public name. The implementation repo should be `ossrank` unless Roger explicitly changes it before the next OSS cron.

Why this name works:

- Short and easy to remember.
- Does not depend on GitHub trademark usage.
- Broad enough for contributors, maintainers, projects, languages, categories, countries, badges, trends, and API/data snapshots.
- Better than a country-only name because V1 can start narrow while the brand still supports project/category surfaces later.

Avoid these now:

- `contributors.top` — already taken / not the purchased domain.
- `contribatlas` — acceptable internal/backlog codename only, but not the public brand.
- Names containing `GitHub` as the primary brand.

## Pitch

A self-updating static data product for ranking visible open-source contributors and projects, starting with country contributor leaderboards and expanding into languages, categories, projects, trend charts, badges, and transparent raw snapshots.

## Why It Matters

People like public OSS leaderboards, but old attempts often go dead in the water because the hard part is not rendering a table — it is keeping data fresh, reproducible, rate-limit-safe, and honest about GitHub’s imperfect location and activity signals.

`OSSRank` should make freshness and methodology the product. Every generated page should show when it was generated, which data snapshot it came from, what GitHub API/query method was used, whether the data is fresh/stale/failed, and what caveats apply.

This can become a genuinely useful SEO-native OSS discovery surface if every page has real data, historical context, caveats, canonical URLs, and raw snapshot links rather than thin generated spam.

## Qualification

### Pub Test

Can this be explained clearly in one sentence? Yes: “A weekly refreshed public ranking site for OSS contributors, projects, languages, and ecosystem momentum.”

### Competitors / Adjacent Tools

- `ashkulz/committers.top` — active inspiration: GitHub GraphQL-powered rankings and a static website; proves demand for country/region rankings, but freshness/methodology/staleness can be a stronger product focus.
- `lauripiispanen/most-active-github-users-counter` — archived predecessor; proves long-running interest and the maintenance/staleness trap.
- GitHub search/profile contribution graphs — authoritative source surfaces, but no ranked country/category/project data product with historical public snapshots.
- Star-history/ranking sites — adjacent demand for OSS trend pages, but often focused on repositories rather than contributors/maintainers.

### Star / Demand Signal

- Roger noticed the stale-data gap directly and bought `ossrank.dev` for this build.
- Existing contributor ranking projects have enough visibility to show the idea lands.
- SEO surface is strong: “top GitHub contributors in Australia,” “top Rust open source contributors,” “fastest growing OSS projects,” “top developer tools projects,” “most active maintainers this week,” etc.
- Badges and shareable country/project pages create natural distribution through GitHub READMEs, profiles, local communities, and social posts.

### Real Problem

GitHub does not provide a direct, perfect “top contributors by country/category/language” product. User locations are free text and unverified, contribution counts are nuanced, Search API results cap out, and scheduled data jobs can fail silently. Existing sites tend to decay when refresh jobs, tokens, sharding, or methodology are not treated as first-class product features.

### V1 Buildability

A tight V1 is realistic:

- Static-first frontend generated from JSON snapshots.
- GitHub Actions scheduled refreshes.
- Small initial country/language subset with fixtures and mocked GitHub responses.
- Transparent `data/latest`, `data/runs`, and `data/history` outputs.
- No runtime browser calls to GitHub.
- No HTML scraping.
- Last-known-good deploy if refresh fails.

## V1 Scope

### Public Frontend

- Homepage for `ossrank.dev` with global highlights, freshness state, and links to methodology.
- Country pages for top visible OSS contributors by country/location preset.
- Contributor pages with rank history, visible public activity, notable repos where available, badges, and share links.
- Language/ecosystem pages for at least a small initial set such as TypeScript, Python, Rust, Go, AI/ML, and developer tools.
- Project ranking pages for public OSS momentum metrics where feasible from API data.
- Category pages for project groups such as developer tools, CLIs, frameworks, databases, AI tools, and security.
- Search/navigation for users, countries, projects, languages, and categories.
- Methodology and limitations pages that are prominent, not buried.
- Responsive mobile/social sharing and generated OpenGraph metadata/images where feasible.

### Data Pipeline

- Versioned presets for countries, languages, categories, and project queries.
- GitHub API collection using official REST Search and GraphQL APIs only.
- Candidate discovery first, then ranking; no claim of complete global coverage.
- Contribution ranking defaults to visible/public contribution signals only.
- Configurable candidate windows, e.g. top N users by followers/location query then sort by public contribution/activity data.
- Per-shard refresh jobs so one failed country/category/language does not break the whole deploy.
- Backoff, jitter, low concurrency, checkpoint/resume, and clear failure recording.
- Preserve last-known-good data if refresh fails.

### Artifacts

- `data/latest/<country>.json`
- `data/runs/<date>/<country>.json`
- `data/history/<country>.json`
- `data/history/users/<login>.json`
- `data/latest/manifest.json`
- Equivalent language/category/project latest and history files as V1 capacity allows.
- Raw snapshot links exposed from generated pages.

### CLI

- Validate presets.
- Refresh one country/language/category locally with mocked or live GitHub API mode.
- Refresh all configured shards with resume/checkpoint support.
- Build the static site from fixture or latest data.
- Compact historical data.
- Generate badge SVGs/static assets from snapshots.

## Required Routes / URL Model

Prefer canonical, descriptive, SEO-safe routes. Keep compatibility redirects for common mistakes and previously discussed shapes.

Canonical V1 routes:

- `/`
- `/countries/<country>/top-github-contributors/`
- `/countries/<country>/fastest-rising-github-contributors/`
- `/contributors/<login>/`
- `/languages/<language>/top-open-source-contributors/`
- `/categories/<category>/top-open-source-projects/`
- `/projects/most-pull-requests-this-week/`
- `/projects/fastest-growing-open-source-projects/`
- `/badges/users/<login>/<country>.svg`
- `/badges/projects/<owner>/<repo>/pr-activity.svg`
- `/methodology/`
- `/data/latest/manifest.json`

Explicit route issue to handle from earlier planning:

- Avoid ambiguous generated route conflicts between `/category/language` and `/language/category`.
- If short routes are added, define them deliberately as redirects or aliases, not competing page types.
- `/category/language` should redirect to the relevant canonical category/language page or return a clear 404 if ambiguous.
- `/language/category` should redirect to the relevant canonical language/category page or return a clear 404 if ambiguous.
- `/bots/query` is not a human SEO page in V1; reserve it for a future read-only bot/API query surface or return a documented 404/501 with no indexing.

## Freshness / Automation Strategy

Use GitHub Actions as the default updater:

- `refresh-weekly.yml`: scheduled full refresh and deploy.
- `refresh-daily-hot-pages.yml`: daily refresh for homepage, fastest movers, stale/high-demand pages, and small hot shards.
- `validate-data.yml`: validate presets, generated snapshots, compact history, route generation, and site build on PR.
- `manual-refresh.yml`: `workflow_dispatch` inputs for country/category/language/project/user.

Data safety pattern:

1. Fetch candidates and contribution/project data into immutable run paths under `data/runs/<date>/raw/`.
2. Normalize into `data/runs/<date>/<shard>.json`.
3. Validate schema, rank consistency, duplicate users, impossible values, suspicious empty results, and route generation.
4. Merge into compact history under `data/history/`.
5. Promote to `data/latest/` only after quality gates pass.
6. Build and deploy from the latest valid snapshot.
7. If a refresh partially fails, keep serving last-known-good data and surface stale/failure status publicly.

`data/latest/manifest.json` must include completed shards, failed shards, stale pages, API budget, duration, source commit, generated time, and last successful deploy.

## GitHub API Constraints / Risk

Nothing obvious prevents this if it uses official GitHub APIs respectfully, but the API constraints shape the product:

- GitHub does not provide a direct “sort users by contributions in country” API.
- User location is free text and unverified; do not overclaim exact geography, nationality, residence, or completeness.
- REST Search API returns at most 1,000 results per search query, so broad country/category queries need deterministic shards such as location terms, follower ranges, language/activity slices, or curated preset splits.
- REST Search has a custom rate limit: authenticated Search is limited to 30 requests/minute; unauthenticated is lower.
- GraphQL has point-based hourly limits, commonly around 5,000 points/hour for a user token and 1,000 points/hour for `GITHUB_TOKEN` in Actions, plus secondary limits.
- Secondary abuse/rate limits punish high concurrency and bursty endpoint usage.
- Do not use token pools or token sharing to bypass limits.
- Do not scrape GitHub HTML.
- Do not sell personal information or position the product as a recruiter/headhunter lead-extraction database.
- Prefer public contribution/activity signals and clear methodology; private/restricted contributions should not be default leaderboard material.

Likely reason older projects stall: not because the idea is forbidden, but because the data pipeline is annoying — rate limits, query sharding, free-text locations, failed scheduled jobs, token expiry, and no last-known-good/staleness product layer.

## SEO / Content Guardrails

`OSSRank` can have a large SEO footprint, but only if pages are useful:

- Every indexable page must include freshness, methodology, caveats, canonical URL, and raw snapshot links.
- Avoid thin pages with empty or low-confidence data.
- Prefer canonical route families and structured metadata to avoid duplicate SEO sludge.
- Do not imply endorsement, employment status, nationality, exact location, or identity attributes from GitHub free-text profile data.
- Use `noindex` for ambiguous aliases, low-data pages, experimental bot/API pages, and any route that only exists for compatibility.

Possible high-value pages:

- `/countries/australia/top-github-contributors/`
- `/countries/australia/fastest-rising-github-contributors/`
- `/languages/typescript/top-open-source-contributors/`
- `/projects/most-pull-requests-this-week/`
- `/projects/fastest-growing-open-source-projects/`
- `/categories/developer-tools/top-open-source-projects/`
- `/badges/users/example/au.svg`
- `/badges/projects/example/repo/pr-activity.svg`

## Badges and Embeds

Badges should make the project spread naturally through GitHub profiles, READMEs, and project docs:

- Contributor rank badge: “Top 50 observed OSS contributor in Australia”.
- Language/category badge: “Top TypeScript OSS contributor”.
- Project badge: “Top 100 OSS project by PR activity this week”.
- Momentum badge: “Fastest rising OSS project”.
- Freshness badge: “Data refreshed weekly”.

Implementation notes:

- Generate SVG badges from static JSON; do not trigger GitHub API calls per badge request.
- Badge pages must link to methodology and the exact data snapshot used.
- Badge text should avoid overclaiming and include observed rank/source/freshness semantics.
- Cache aggressively via static assets or edge cache.

Example:

```md
[![Observed top OSS contributor in Australia](https://ossrank.dev/badges/users/example/au.svg)](https://ossrank.dev/contributors/example/)
```

## Historical Charts

Charts are core differentiation:

- Country trend: number of ranked contributors captured each week.
- Country trend: aggregate observed public contributions for top 10 / top 100.
- Contributor rank movement over time within a country/category/language.
- Contribution velocity or observed activity delta.
- New entrants and drop-offs per country/language/category.
- Project momentum over time: PR volume, contributor growth, release cadence, issue health, or star velocity where API data supports it.

Label charts carefully. If using cumulative GitHub contribution totals, call them “observed public contribution total at refresh time” unless a date-bounded API query is implemented and verified.

## Out of Scope

- Perfect geographic truth from GitHub profile locations.
- Claims that rankings include every contributor in a country/category/language.
- Scraping GitHub HTML.
- Private contribution ranking as the default public leaderboard.
- Real-time updates; weekly is the intended reliable cadence.
- Hosted user accounts or OAuth claim flows in V1.
- Paid recruiting, lead scraping, or selling user data.
- Copying `ashkulz/committers.top` implementation, branding, README, website copy, or preset data verbatim.

## CLI/API Sketch

```bash
ossrank validate-presets
ossrank refresh --country AU --limit 500 --candidate-window 2000
ossrank refresh --language typescript --limit 500
ossrank refresh --category developer-tools --limit 250
ossrank refresh-all --changed-first --resume .cache/ossrank/run.json
ossrank build-site --data data/latest --history data/history --out dist
ossrank dev-site --data fixtures/demo
ossrank compact-history --keep-weekly 104 --keep-monthly 60
ossrank generate-badges --data data/latest --out dist/badges
```

Example country JSON:

```json
{
  "country": "AU",
  "name": "Australia",
  "generated_at": "2026-05-07T20:00:00Z",
  "fresh_until": "2026-05-14T20:00:00Z",
  "method": "github-search-followers-then-graphql-public-contributions",
  "candidate_count": 2000,
  "rate_limit_remaining": 1342,
  "history": {
    "country_ranked_users": [420, 438, 451],
    "top_100_public_contributions": [912345, 945678, 990123],
    "weeks": ["2026-04-23", "2026-04-30", "2026-05-07"]
  },
  "entries": [
    {
      "rank": 1,
      "login": "example",
      "profile_url": "https://github.com/example",
      "public_contributions": 12345,
      "followers": 999,
      "location": "Brisbane, Australia",
      "location_confidence": "profile-text-match"
    }
  ]
}
```

## Verification

- Unit tests for country/language/category preset parsing and query expansion.
- Fixture tests for ranking, stale labels, manifest generation, and history compaction.
- CLI smoke tests for `validate-presets`, single-shard refresh with mocked GitHub responses, `build-site`, and badge generation.
- GitHub Actions workflow dry-run using mocked data.
- Rate-limit behavior tests for backoff, partial failure recording, retry budget, and resumable refresh.
- Snapshot tests for generated country/project/contributor/language/category pages, chart data, badge pages, redirects, `noindex` aliases, and methodology pages.
- Route tests covering `/category/language`, `/language/category`, and `/bots/query` so these do not accidentally become conflicting thin SEO pages.
- Privacy/network test asserting site build and fixture refresh do not make hidden network calls.

## Agent Prompt

Build `ossrank`, a static-first public data product at `ossrank.dev` for ranking visible open-source contributors and projects. Start with country contributor leaderboards and expand the architecture to languages, categories, projects, badges, charts, and raw JSON snapshots. Use official GitHub APIs only; never scrape GitHub HTML. Store presets in versioned files, generate immutable run snapshots plus compact history, preserve last-known-good data when refreshes fail, and show freshness/staleness/methodology on every page. Include scheduled GitHub Actions (`refresh-weekly.yml`, `refresh-daily-hot-pages.yml`, `validate-data.yml`, and `manual-refresh.yml`) with mocked-data tests before live API use. Be explicit about free-text location limitations and avoid overclaiming geographic accuracy.
