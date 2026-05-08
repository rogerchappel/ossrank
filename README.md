# OSSRank

A static-first public data product for finding top GitHub contributors by country using simple public metrics: commits, public pull requests, repositories, and followers.

OSSRank is designed for <https://ossrank.dev/>. Set `OSSRANK_SITE_URL` in Cloudflare Pages if the production host changes so generated canonical URLs, Open Graph URLs, `robots.txt`, and `sitemap.xml` stay aligned with the live domain. V1 includes a conservative live GitHub REST/GraphQL collector plus fixture mode for deterministic tests. The primary user flow is home page country selection → country contributor table, sorted by commits by default and sortable by public PRs, repo count, or followers. A single projects page is included separately.

## What it builds

- A polished static website in `dist/` ready for Cloudflare Pages.
- Generated SEO assets: per-route canonical URLs, Open Graph/Twitter metadata, `robots.txt`, `sitemap.xml`, Cloudflare Pages `_headers`, and duplicate-route `_redirects`.
- Versioned JSON snapshots under `data/latest/` and immutable run snapshots under `data/runs/<date>/`.
- A public manifest at `/data/latest/manifest.json` with completed shards, failed shards, stale pages, API mode, duration, and source commit.
- A focused country-selection homepage, country contributor pages, one projects page, methodology, badges, and raw JSON.
- GitHub Actions for validation, weekly refresh, daily hot-page refresh, and manual shard refresh.

## Current routes

- `/`
- `/countries/australia/top-github-contributors/`
- `/countries/australia/` redirects to `/countries/australia/top-github-contributors/`
- `/global/`
- `/projects/`
- `/agentic/`
- `/momentum/`
- `/rising/`
- `/sitemap.xml`
- `/robots.txt`
- `/methodology/`
- `/badges/users/octo-kiwi/au.svg`
- `/data/latest/manifest.json`

## Data contract

Each ranking snapshot includes:

- `kind`, `slug`, `name`, and `title`
- `generated_at`, `fresh_until`, and `status`
- `method`, `source_run`, and `candidate_count`
- explicit `caveats`
- compact `history`
- ranked `entries`

The public site copies `data/latest/*` into `dist/data/latest/*` so pages and API-like JSON stay in sync.

## Local development

```sh
pnpm install
pnpm test
pnpm run build
```

Useful scripts:

```sh
pnpm run refresh:fixtures   # create deterministic demo snapshots
pnpm run refresh:live       # collect live GitHub API snapshots using OSSRANK_GITHUB_TOKEN
pnpm run validate:data      # validate manifest + shard integrity
pnpm run build              # generate dist site
pnpm run deploy:cloudflare  # deploy dist with Wrangler
bash scripts/validate.sh    # StackForge validation wrapper
```

Live refreshes use GitHub GraphQL search and contribution APIs. GitHub Actions' default `GITHUB_TOKEN` is an integration token and can return `Resource not accessible by integration`; configure a repository secret named `OSSRANK_GITHUB_TOKEN` with a classic or fine-grained PAT that can read public repository/user metadata.

### GitHub Actions secrets and environment

Configure these repository secrets before running refresh/deploy workflows:

- `OSSRANK_GITHUB_TOKEN` — GitHub PAT used by weekly/manual live refresh. Needs read-only access to public repository/user metadata and GraphQL search/contribution APIs.
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account id for Pages deploys. Stored as a secret so the public repo does not hardcode account metadata.
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token for Wrangler Pages deploys. Scope it to the `ossrank` Pages project where possible.

Optional runtime/build variables:

- `OSSRANK_SITE_URL` — canonical production URL, defaults to `https://ossrank.dev`.
- `OSSRANK_LIMIT` — candidate limit for live refresh runs; workflow dispatch defaults to `20`.

## Cloudflare Pages

`wrangler.toml` sets `pages_build_output_dir = "dist"` and the deploy script runs:

```sh
wrangler pages deploy dist --project-name ossrank
```

For a connected Git deployment, configure Cloudflare Pages with:

- Build command: `pnpm run build`
- Build output directory: `dist`
- Node version: `22`
- Environment variable: `OSSRANK_SITE_URL=https://ossrank.dev`

## Methodology guardrails

OSSRank must stay honest:

- Use official GitHub APIs only; never scrape GitHub HTML.
- Treat GitHub profile location text as unverified free text.
- Rank observed public signals, not private contributions. V1 contributor pages prioritize one-year GitHub GraphQL commit totals, one-year public pull request totals, repository count, and followers.
- Preserve last-known-good data when refreshes fail.
- Keep the product flow simple: choose a country, view contributors, sort by commits/public PRs/repos/followers, or view the single projects page.
- Avoid claims of complete global coverage, endorsement, nationality, employment status, or identity attributes.

## Roadmap

- Add deeper GitHub GraphQL contribution and pull-request collection with low-concurrency backoff and checkpoint/resume.
- Generate contributor detail pages and full project badges.
- Add compact historical charts and route tests for ambiguous aliases.
- Connect `ossrank.dev` to Cloudflare Pages.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes should be small, reviewable, and verified before review.

## License

MIT
