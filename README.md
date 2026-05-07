# OSSRank

A static-first public data product for ranking observed open-source contributors, projects, languages, and ecosystem momentum — with freshness, methodology, caveats, and raw JSON shown on every generated page.

OSSRank is designed for <https://ossrank.dev>. V1 includes a conservative live GitHub REST collector plus fixture mode for deterministic tests. The collector powers country, language, project category, and project momentum snapshots while preserving freshness, methodology, caveats, and raw JSON on every generated page.

## What it builds

- A polished static website in `dist/` ready for Cloudflare Pages.
- Versioned JSON snapshots under `data/latest/` and immutable run snapshots under `data/runs/<date>/`.
- A public manifest at `/data/latest/manifest.json` with completed shards, failed shards, stale pages, API mode, duration, and source commit.
- SEO-safe route families for countries, languages, project categories, project momentum, methodology, and badges.
- GitHub Actions for validation, weekly refresh, daily hot-page refresh, and manual shard refresh.

## Current routes

- `/`
- `/countries/australia/top-github-contributors/`
- `/countries/australia/fastest-rising-github-contributors/`
- `/languages/typescript/top-open-source-contributors/`
- `/categories/developer-tools/top-open-source-projects/`
- `/projects/most-pull-requests-this-week/`
- `/projects/fastest-growing-open-source-projects/`
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
pnpm run refresh:live       # collect live GitHub REST snapshots using OSSRANK_GITHUB_TOKEN/GITHUB_TOKEN
pnpm run validate:data      # validate manifest + shard integrity
pnpm run build              # generate dist site
pnpm run deploy:cloudflare  # deploy dist with Wrangler
bash scripts/validate.sh    # StackForge validation wrapper
```

## Cloudflare Pages

`wrangler.toml` sets `pages_build_output_dir = "dist"` and the deploy script runs:

```sh
wrangler pages deploy dist --project-name ossrank
```

For a connected Git deployment, configure Cloudflare Pages with:

- Build command: `pnpm run build`
- Build output directory: `dist`
- Node version: `22`

## Methodology guardrails

OSSRank must stay honest:

- Use official GitHub APIs only; never scrape GitHub HTML.
- Treat GitHub profile location text as unverified free text.
- Rank observed public signals, not private contributions. V1 contributor rankings use an OSSRank proxy score, not GitHub profile commit/contribution counts.
- Preserve last-known-good data when refreshes fail.
- Show freshness, caveats, methodology, and raw JSON on every indexable ranking page.
- Avoid claims of complete global coverage, endorsement, nationality, employment status, or identity attributes.

## Roadmap

- Add deeper GitHub GraphQL event scoring with low-concurrency backoff and checkpoint/resume.
- Generate contributor detail pages and full project badges.
- Add compact historical charts and route tests for ambiguous aliases.
- Connect `ossrank.dev` to Cloudflare Pages.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes should be small, reviewable, and verified before review.

## License

MIT
