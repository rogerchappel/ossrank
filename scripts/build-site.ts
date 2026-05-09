import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { escapeHtml } from '../src/lib/html.js';
import { legitimacyScore, momentumScore } from '../src/lib/ranking.js';
import type { Manifest, ManifestShard, RankedContributor, RankedProject, RankingSnapshot } from '../src/lib/types.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const dataDir = args.get('--data') ?? 'data/latest';
const outDir = args.get('--out') ?? 'dist';
const siteUrl = (process.env.OSSRANK_SITE_URL ?? 'https://ossrank.dev').replace(/\/+$/g, '');
const sitemapEntries: Array<{ path: string; priority: string; changefreq: string }> = [];
const assetVersion = '20260509-polish1';
const updateCadenceLabel = 'Weekly refresh';
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="OSSRank"><defs><linearGradient id="g" x1="18" y1="112" x2="110" y2="16" gradientUnits="userSpaceOnUse"><stop stop-color="#dc614f"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="128" height="128" rx="30" fill="#07111f"/><path d="M31 88h18V58H31v30Zm24 0h18V40H55v48Zm24 0h18V26H79v62Z" fill="url(#g)"/><path d="M28 96h74" stroke="#fff8ed" stroke-width="8" stroke-linecap="round" opacity=".9"/></svg>`;

function normalizeRoute(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return clean ? `/${clean}/` : '/';
}

function absoluteUrl(path: string): string {
  return `${siteUrl}${normalizeRoute(path)}`;
}

function sitemapXml(entries: Array<{ path: string; priority: string; changefreq: string }>, lastmod: string): string {
  const uniqueEntries = [...new Map(entries.map((entry) => [normalizeRoute(entry.path), entry])).values()].sort((a, b) => normalizeRoute(a.path).localeCompare(normalizeRoute(b.path)));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${uniqueEntries.map((entry) => `  <url>
    <loc>${escapeHtml(absoluteUrl(entry.path))}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writePage(path: string, html: string, options: { sitemap?: boolean; priority?: string; changefreq?: string } = {}): Promise<void> {
  const file = join(outDir, path, 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
  if (options.sitemap !== false) {
    sitemapEntries.push({ path, priority: options.priority ?? (path === '' ? '1.0' : '0.7'), changefreq: options.changefreq ?? 'daily' });
  }
}

function layout(title: string, description: string, body: string, path = ''): string {
  const canonicalUrl = absoluteUrl(path);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · OSSRank</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="index, follow" />
  <meta name="theme-color" content="#07111f" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="preload" href="/assets/logo.svg" as="image" type="image/svg+xml" />
  <script>try{document.documentElement.dataset.theme=localStorage.getItem('ossrank-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch{document.documentElement.dataset.theme='light'}</script>
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:site_name" content="OSSRank" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <link rel="stylesheet" href="/assets/style.css?v=${assetVersion}" />
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="/"><img class="brand-mark" src="/assets/logo.svg" alt="" width="28" height="28" /><span>OSS</span>Rank</a>
      <div class="header-actions">
        <button class="theme-toggle" type="button" aria-label="Switch to dark mode" aria-live="polite">Dark</button>
        <button class="nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="site-nav"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></button>
      </div>
    </div>
    <nav id="site-nav"><a href="/">Countries</a><a href="/global/">Global</a><a href="/projects/">Projects</a><a href="/agentic/">Agentic</a><a href="/momentum/">Momentum</a><a href="/rising/">Rising</a><a href="/methodology/">Methodology</a></nav>
  </header>
  ${body}
  <footer><strong>OSSRank</strong> tracks public open-source momentum with auditable GitHub signals. Country pages use visible profile location text and public activity only.</footer>
  <script src="/assets/site.js?v=${assetVersion}" defer></script>
</body>
</html>`;
}

function statusPill(label: string, tone = 'neutral'): string {
  return `<span class="status-pill status-pill-${tone}">${escapeHtml(label)}</span>`;
}

function countrySelector(countries: Array<{ name: string; slug: string; entries: number; status: string }>): string {
  return `<div class="country-grid">${countries.map((country) => `<a class="country-card" href="/countries/${country.slug}/top-github-contributors/"><span class="card-kicker">${statusPill(country.status, country.status === 'current' ? 'good' : 'neutral')}</span><strong>${escapeHtml(country.name)}</strong><span>${country.entries.toLocaleString()} ranked contributors</span><span class="card-link">Open leaderboard →</span></a>`).join('')}</div>`;
}

function iconSvg(icon?: string): string {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  if (icon === 'countries') return `<svg ${common}><circle cx="12" cy="12" r="8.5"/><path d="M3.8 9h16.4M3.8 15h16.4M12 3.5c2.1 2.3 3.2 5.1 3.2 8.5S14.1 18.2 12 20.5C9.9 18.2 8.8 15.4 8.8 12S9.9 5.8 12 3.5Z"/></svg>`;
  if (icon === 'agentic') return `<svg ${common}><path d="M12 3v3M6.5 6.5l2.1 2.1M17.5 6.5l-2.1 2.1"/><rect x="5" y="9" width="14" height="10" rx="3"/><path d="M9 13h.01M15 13h.01M9.5 16h5"/></svg>`;
  if (icon === 'momentum') return `<svg ${common}><path d="M4 19h16"/><path d="M6 16l4-4 3 3 5-7"/><path d="M15 8h3v3"/></svg>`;
  if (icon === 'rising') return `<svg ${common}><path d="M12 20V5"/><path d="M7 10l5-5 5 5"/><path d="M5 19c5-5 9-5 14 0"/></svg>`;
  if (icon === 'agentic-board') return `<svg ${common}><path d="M4 7h16M4 12h16M4 17h16"/><path d="M8 5v4M15 10v4M11 15v4"/></svg>`;
  return `<svg ${common}><path d="M7 17 17 7"/><path d="M9 7h8v8"/></svg>`;
}

function boardCards(cards: Array<{ title: string; text: string; href: string; icon?: string }>): string {
  return `<div class="board-grid">${cards.map((card) => `<a class="board-card" href="${card.href}"><span class="board-icon" aria-hidden="true">${iconSvg(card.icon)}</span><strong>${escapeHtml(card.title)}</strong><span>${escapeHtml(card.text)}</span></a>`).join('')}</div>`;
}

function rankMovementBadge(entry: RankedContributor): string {
  if (!entry.previous_rank) return `<span class="rank-delta rank-delta-new" title="New in the latest weekly OSSRank snapshot" aria-label="New in the latest weekly OSSRank snapshot">New</span>`;
  const delta = entry.previous_rank - entry.rank;
  if (delta === 0) return `<span class="rank-delta rank-delta-steady" title="No rank change since the previous weekly OSSRank snapshot">→</span>`;
  if (delta > 0) return `<span class="rank-delta rank-delta-up" title="Up ${delta} place${delta === 1 ? '' : 's'} since the previous weekly OSSRank snapshot">↑${delta}</span>`;
  const down = Math.abs(delta);
  return `<span class="rank-delta rank-delta-down" title="Down ${down} place${down === 1 ? '' : 's'} since the previous weekly OSSRank snapshot">↓${down}</span>`;
}

function contributorTable(snapshot: RankingSnapshot<RankedContributor>): string {
  const rows = [...snapshot.entries].sort((a, b) => a.rank - b.rank);
  return `<div class="table-wrap"><table id="contributors" aria-label="Top GitHub contributors in ${escapeHtml(snapshot.name)}"><thead><tr><th>Rank</th><th>Username</th><th><button data-sort="commits">Commits (1y)</button></th><th><button data-sort="prs">Public PRs (1y)</button></th><th><button data-sort="repos">Repos</button></th><th><button data-sort="followers">Followers</button></th><th>Location</th><th>Discovery</th></tr></thead><tbody>${rows.map((entry) => `<tr data-commits="${entry.observed_public_commits ?? 0}" data-prs="${entry.observed_public_pull_requests ?? 0}" data-repos="${entry.public_repos ?? 0}" data-followers="${entry.followers}"><td class="rank"><span class="rank-pill">#${entry.rank}</span></td><td><div class="contributor-name"><a href="${entry.profile_url}">${escapeHtml(entry.login)}</a> ${rankMovementBadge(entry)}</div><small>${escapeHtml(entry.name ?? 'Public GitHub profile')}</small></td><td><strong class="metric">${(entry.observed_public_commits ?? 0).toLocaleString()}</strong></td><td><strong class="metric">${(entry.observed_public_pull_requests ?? 0).toLocaleString()}</strong></td><td>${(entry.public_repos ?? 0).toLocaleString()}</td><td>${entry.followers.toLocaleString()}</td><td>${escapeHtml(entry.location ?? 'Unknown')}<small>${escapeHtml(entry.location_confidence ?? 'unknown')}</small></td><td>${statusPill(entry.discovered_by_query ?? 'query', 'source')}</td></tr>`).join('')}</tbody></table></div><script>
const table = document.querySelector('#contributors');
const tbody = table?.querySelector('tbody');
function sortRows(metric) {
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.sort((a, b) => Number(b.dataset[metric] || 0) - Number(a.dataset[metric] || 0));
  rows.forEach((row) => tbody.appendChild(row));
}
document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => sortRows(button.dataset.sort)));
</script>`;
}

function capped(value: number | undefined): string {
  if (!value) return '0';
  return value >= 100 ? '100+' : value.toLocaleString();
}

function projectTable(snapshot: RankingSnapshot<RankedProject>): string {
  return `<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Project</th><th>Merged PRs 30d</th><th>Commits 30d</th><th>Contributors</th><th>Releases 90d</th><th>Stars</th><th>Discovery</th></tr></thead><tbody>${snapshot.entries.map((entry) => `<tr><td class="rank"><span class="rank-pill">#${entry.rank}</span></td><td><a href="${entry.url}">${escapeHtml(entry.full_name)}</a><div class="project-meta">${statusPill(entry.primary_language ?? 'mixed', 'language')}</div></td><td><strong class="metric">${capped(entry.pull_requests_merged_30d ?? entry.pull_requests_merged_7d)}</strong><small>${capped(entry.pull_requests_merged_7d)} in 7d</small></td><td>${(entry.recent_commits_30d ?? 0).toLocaleString()}</td><td>${(entry.total_contributors_observed ?? entry.active_contributors_30d).toLocaleString()}</td><td>${(entry.releases_90d ?? 0).toLocaleString()}</td><td>${entry.stars.toLocaleString()}</td><td>${statusPill(entry.discovered_by_query ?? 'query', 'source')}</td></tr>`).join('')}</tbody></table></div>`;
}

function queryStats(snapshot: RankingSnapshot<unknown>): string {
  const stats = snapshot.candidate_count_by_query ?? [];
  if (stats.length === 0) return '';
  return `<details class="query-details"><summary>Discovery queries</summary><ul>${stats.map((stat) => `<li><code>${escapeHtml(stat.query)}</code> — ${stat.accepted.toLocaleString()} accepted from ${stat.total.toLocaleString()} GitHub matches</li>`).join('')}</ul></details>`;
}

function contributorPage(snapshot: RankingSnapshot<RankedContributor>, options?: { global?: boolean; rising?: boolean; path?: string }): string {
  const isGlobal = options?.global ?? false;
  const isRising = options?.rising ?? false;
  const scope = isGlobal ? 'globally' : isRising ? 'with rising public OSS signal' : `in ${snapshot.name}`;
  const description = isRising ? 'Rising GitHub contributors ranked by public activity relative to audience size.' : `Top GitHub contributors ${scope}, sorted by public commit activity with public PR, repo, and follower columns.`;
  const rawPath = isGlobal ? `/data/latest/global-${snapshot.slug}.json` : isRising ? `/data/latest/rising-${snapshot.slug}.json` : `/data/latest/countries-${snapshot.slug}.json`;
  const path = options?.path ?? (isGlobal ? 'global' : isRising ? 'rising' : `countries/${snapshot.slug}/top-github-contributors`);
  return layout(isRising ? 'Rising GitHub contributors' : `Top GitHub contributors ${scope}`, description, `<main class="page"><section class="hero compact"><p class="eyebrow">${isRising ? 'Rising contributors' : isGlobal ? 'Global rankings' : 'Country rankings'}</p><div class="hero-shell"><div class="hero-copy"><h1>${isRising ? 'Rising GitHub contributors.' : `Top GitHub contributors ${escapeHtml(scope)}.`}</h1><p>${isRising ? 'A discovery board for active maintainers and builders whose public commits, PRs, and repositories are strong relative to follower count.' : 'Movement compares each contributor’s current rank with their previous OSSRank measurement when a prior snapshot exists. Click the column buttons to sort by public PRs, repos, or followers instead.'}</p><div class="stats"><span>${snapshot.entries.length} contributors</span><span>${snapshot.candidate_count} candidates checked</span><span>${updateCadenceLabel}</span><span>Latest ${escapeHtml(snapshot.generated_at.slice(0, 10))}</span></div></div><aside class="hero-card"><h2>${isGlobal ? 'How to use this board' : 'Signal at a glance'}</h2><ul><li><span>Default rank</span> <strong>Commits in the last year</strong></li><li><span>Trend</span> <strong>Movement vs previous snapshot</strong></li><li><span>Scope</span> <strong>${escapeHtml(isGlobal ? 'Observed global sample' : isRising ? 'Emerging contributors' : snapshot.name)}</strong></li></ul></aside></div></section><section class="panel">${contributorTable(snapshot)}<p class="note">Commit and PR counts are one-year public contribution totals from the official GitHub GraphQL API. Repo and follower counts come from public GitHub profile metadata. ${isRising ? 'Rising rank discounts large existing audiences to surface under-discovered activity.' : isGlobal ? 'The global page is still an observed candidate sample, not a complete census.' : 'Country matching uses free-text GitHub profile location and is not verified geography.'}</p>${queryStats(snapshot)}<p class="note"><a href="${rawPath}">Raw JSON snapshot</a> · <a href="/methodology/">Methodology</a></p></section></main>`, path);
}

function projectsPage(snapshot: RankingSnapshot<RankedProject>, options?: { title?: string; eyebrow?: string; description?: string; intro?: string; rawPrefix?: string; path?: string }): string {
  const title = options?.title ?? snapshot.title;
  const description = options?.description ?? 'A simple OSSRank project page with public PR, contributor, and star signals.';
  const intro = options?.intro ?? 'Real recent project signals from official GitHub APIs: merged PRs, recent commits, observed contributors, releases, and stars.';
  const rawPrefix = options?.rawPrefix ?? (snapshot.kind === 'category' ? 'categories' : snapshot.kind === 'momentum' ? 'momentum' : 'projects');
  const path = options?.path ?? (snapshot.kind === 'category' ? `categories/${snapshot.slug}` : snapshot.kind === 'momentum' ? 'momentum' : 'projects');
  return layout(title, description, `<main class="page"><section class="hero compact"><p class="eyebrow">${escapeHtml(options?.eyebrow ?? 'Projects')}</p><h1>${escapeHtml(title)}.</h1><p>${escapeHtml(intro)}</p><div class="stats"><span>${snapshot.entries.length} projects</span><span>${snapshot.candidate_count} candidates checked</span><span>${updateCadenceLabel}</span><span>Latest ${escapeHtml(snapshot.generated_at.slice(0, 10))}</span></div></section><section class="panel">${projectTable(snapshot)}${queryStats(snapshot)}<p class="note"><a href="/data/latest/${rawPrefix}-${snapshot.slug}.json">Raw JSON snapshot</a> · <a href="/methodology/">Methodology</a></p></section></main>`, path);
}

function momentumMap(snapshot: RankingSnapshot<RankedProject>): string {
  const items = snapshot.entries.slice(0, 40);
  const maxMomentum = Math.max(...items.map(momentumScore), 1);
  const maxLegitimacy = Math.max(...items.map(legitimacyScore), 1);
  return `<div class="map" role="img" aria-label="Project momentum versus legitimacy scatter plot"><span class="axis y">Momentum ↑</span><span class="axis x">Legitimacy →</span>${items.map((entry) => {
    const x = Math.max(4, Math.min(94, (legitimacyScore(entry) / maxLegitimacy) * 90));
    const y = Math.max(4, Math.min(92, 96 - (momentumScore(entry) / maxMomentum) * 90));
    const size = Math.max(0.9, Math.min(2.2, Math.log10(entry.stars + 10) / 2));
    return `<a class="dot" href="${entry.url}" aria-label="${escapeHtml(entry.full_name)}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--s:${size.toFixed(2)}rem"><span role="tooltip">${escapeHtml(entry.full_name.split('/').pop() ?? entry.full_name)}</span></a>`;
  }).join('')}</div>`;
}

function momentumPage(snapshot: RankingSnapshot<RankedProject>): string {
  return layout('Project Momentum Map', 'Momentum versus legitimacy map for observed open-source projects.', `<main class="page"><section class="hero compact"><p class="eyebrow">Momentum map</p><div class="hero-shell"><div class="hero-copy"><h1>Project momentum versus legitimacy.</h1><p>A visual radar for projects that are heating up. Up means recent PR, commit, and release velocity; right means durable public signals like contributors, releases, issues, and stars.</p><div class="stats"><span>${snapshot.entries.length} projects</span><span>${snapshot.candidate_count} candidates mapped</span><span>${updateCadenceLabel}</span><span>Latest ${escapeHtml(snapshot.generated_at.slice(0, 10))}</span></div></div><aside class="hero-card"><h2>Read the axes</h2><ul><li><span>Upward</span> <strong>Recent activity spike</strong></li><li><span>Rightward</span> <strong>Stronger long-term legitimacy</strong></li><li><span>Each dot</span> <strong>A public GitHub project snapshot</strong></li></ul></aside></div></section><section class="panel">${momentumMap(snapshot)}<p class="note">This is a derived view over the current project snapshots, not a separate GitHub identity claim. It is meant for discovery and comparison.</p></section><section class="panel"><div class="section-heading"><div><h2>Momentum ranking</h2><p>Use the table when you want sortable detail after scanning the map.</p></div></div>${projectTable(snapshot)}<p class="note"><a href="/data/latest/momentum-${snapshot.slug}.json">Raw JSON snapshot</a> · <a href="/methodology/">Methodology</a></p></section></main>`, 'momentum');
}

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'assets'), { recursive: true });
await writeFile(join(outDir, 'assets/logo.svg'), logoSvg);
await writeFile(join(outDir, 'favicon.svg'), logoSvg);
await mkdir(join(outDir, 'data/latest'), { recursive: true });

const manifest = await readJson<Manifest>(join(dataDir, 'manifest.json'));
const countryShards = manifest.completed_shards.filter((shard) => shard.kind === 'country').sort((a, b) => a.title.localeCompare(b.title));
const categoryShards = manifest.completed_shards.filter((shard) => shard.kind === 'category').sort((a, b) => a.title.localeCompare(b.title));
function shardPath(shard: ManifestShard): string { return join(dataDir, shard.path.replace('/data/latest/', '')); }
const countrySnapshots = await Promise.all(countryShards.map((shard) => readJson<RankingSnapshot<RankedContributor>>(shardPath(shard))));
const categorySnapshots = await Promise.all(categoryShards.map((shard) => readJson<RankingSnapshot<RankedProject>>(shardPath(shard))));
const globalContributors = await readJson<RankingSnapshot<RankedContributor>>(join(dataDir, 'global-contributors.json'));
const projects = await readJson<RankingSnapshot<RankedProject>>(join(dataDir, 'projects-fastest-growing-open-source-projects.json'));
const rising = await readJson<RankingSnapshot<RankedContributor>>(join(dataDir, 'rising-contributors.json')).catch(() => undefined);
const momentum = await readJson<RankingSnapshot<RankedProject>>(join(dataDir, 'momentum-project-momentum-map.json')).catch(() => undefined);
const countries = countrySnapshots.map((country) => ({ name: country.name, slug: country.slug, entries: country.entries.length, status: country.status }));
const agenticCards = ['agentic-projects', 'claude-projects', 'codex-projects', 'openclaw-projects'].map((slug) => categorySnapshots.find((snapshot) => snapshot.slug === slug)).filter((snapshot): snapshot is RankingSnapshot<RankedProject> => Boolean(snapshot));

await writeFile(join(outDir, 'assets/style.css'), `:root{color-scheme:light;--bg:#fff8ed;--bg-soft:#f6eddf;--surface:rgba(255,252,246,.88);--surface-strong:#fffaf1;--surface-alt:rgba(255,248,237,.94);--text:#221c13;--muted:#6d6253;--line:rgba(91,74,50,.18);--accent:#dc614f;--accent-strong:#8b5cf6;--accent-warm:#c66a00;--success:#0f9f6e;--shadow:rgba(73,54,25,.14);--max:1200px}html[data-theme="dark"]{color-scheme:dark;--bg:#07111f;--bg-soft:#0c1a2b;--surface:rgba(11,24,40,.82);--surface-strong:#12243b;--surface-alt:rgba(17,34,54,.94);--text:#e8f0ff;--muted:#93a4bf;--line:rgba(148,173,206,.16);--accent:#dc614f;--accent-strong:#8b5cf6;--accent-warm:#f59e0b;--success:#34d399;--shadow:rgba(2,8,23,.45)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at top,color-mix(in srgb,var(--accent) 12%,transparent),transparent 34%),linear-gradient(180deg,var(--bg),var(--bg-soft) 68%,var(--bg));color:var(--text);min-height:100vh}body:before{content:"";position:fixed;inset:0;background:radial-gradient(circle at 20% 0,color-mix(in srgb,var(--accent) 12%,transparent),transparent 30%),radial-gradient(circle at 85% 15%,color-mix(in srgb,var(--accent-strong) 12%,transparent),transparent 26%);pointer-events:none;z-index:-1}a{color:inherit}main{display:block}.site-header{position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1rem clamp(1rem,4vw,3rem);background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:blur(18px);border-bottom:1px solid var(--line)}.header-inner{display:flex;align-items:center;gap:1rem}.header-actions{display:flex;align-items:center;gap:.5rem}.brand{text-decoration:none;font-weight:900;font-size:1.2rem;letter-spacing:-.02em;display:inline-flex;align-items:center;gap:.5rem}.brand-mark{width:1.75rem;height:1.75rem;border-radius:.55rem;box-shadow:0 8px 20px var(--shadow)}.brand span{color:var(--accent)}nav{display:flex;gap:.5rem;flex-wrap:wrap}.theme-toggle,.nav-toggle{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:999px;cursor:pointer}.theme-toggle{min-width:4.8rem;height:2.45rem;padding:0 .8rem;font-size:.86rem;font-weight:800}.nav-toggle{display:none;width:2.45rem;height:2.45rem;align-items:center;justify-content:center;flex-direction:column;gap:.22rem}.nav-toggle span{display:block;width:1rem;height:2px;background:currentColor;border-radius:999px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}nav a{text-decoration:none;color:var(--muted);font-size:.94rem;padding:.55rem .8rem;border-radius:999px;transition:.18s background,.18s color}nav a:hover,nav a:focus-visible{background:color-mix(in srgb,var(--muted) 12%,transparent);color:var(--text);outline:none}.hero,.page{max-width:var(--max);margin:0 auto}.hero{padding:clamp(3rem,7vw,6rem) clamp(1rem,4vw,3rem) 2.25rem}.hero.home{padding-bottom:1.45rem}.hero.home .hero-shell{grid-template-columns:minmax(0,780px)}.hero.home .hero-copy{max-width:780px}.hero.home h1{max-width:11ch}.hero.home .board-grid{margin-top:2.1rem}.hero.compact{padding-top:2.5rem}.eyebrow{display:inline-flex;align-items:center;gap:.5rem;margin:0 0 1rem;color:var(--accent);text-transform:uppercase;letter-spacing:.18em;font-weight:800;font-size:.76rem}.eyebrow:before{content:"";width:2.25rem;height:1px;background:currentColor;opacity:.7}h1{margin:.15rem 0 1rem;max-width:13ch;font-size:clamp(2.6rem,6vw,5.8rem);line-height:.95;letter-spacing:-.05em}h2{margin:0 0 1rem;font-size:clamp(1.35rem,2vw,1.7rem);letter-spacing:-.03em}p{margin:0;color:var(--muted);font-size:1.04rem;line-height:1.75;max-width:760px}.hero p + p,.hero p + .stats,.hero p + .board-grid,.panel p + p,.panel p + .note{margin-top:1rem}.hero-shell{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,.9fr);gap:1.4rem;align-items:end}.hero-copy{display:grid;gap:1rem}.hero-card,.panel,.country-card,.board-card,.stat-card{background:linear-gradient(180deg,rgba(17,34,54,.92),rgba(10,20,36,.92));border:1px solid var(--line);border-radius:24px;box-shadow:0 24px 80px var(--shadow)}.hero-card{padding:1.3rem}.hero-card h2{font-size:1rem;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-bottom:1rem}.hero-card ul{list-style:none;padding:0;margin:0;display:grid;gap:.85rem}.hero-card li{display:grid;grid-template-columns:minmax(7rem,.8fr) minmax(0,1.2fr);align-items:start;gap:1.1rem;padding-bottom:.85rem;border-bottom:1px solid rgba(148,173,206,.12)}.hero-card li:last-child{padding-bottom:0;border-bottom:0}.hero-card strong{font-size:1.05rem;text-align:right;line-height:1.35}.hero-card span,.hero-card small,.country-card span,.board-card span,small,.note{display:block;color:var(--muted)}.hero-card span{line-height:1.35}.hero-card strong{display:block}.hero-actions{display:flex;flex-wrap:wrap;gap:.8rem}.button-link{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;padding:.82rem 1.05rem;border-radius:999px;text-decoration:none;font-weight:700;background:linear-gradient(135deg,var(--accent),var(--accent-warm));color:#fff;box-shadow:0 12px 32px rgba(220,97,79,.22)}.button-link.secondary{background:rgba(148,173,206,.1);color:var(--text);box-shadow:none;border:1px solid var(--line)}.stats{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1rem}.stats span{display:inline-flex;align-items:center;gap:.45rem;border:1px solid color-mix(in srgb,var(--accent) 22%,transparent);border-radius:999px;padding:.55rem .8rem;background:color-mix(in srgb,var(--accent) 10%,transparent);color:#d8e8ff;font-size:.94rem}.proof-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin-top:.4rem;max-width:760px}.proof-strip span{display:grid;gap:.15rem;padding:.9rem 1rem;border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,color-mix(in srgb,var(--surface-strong) 88%,transparent),color-mix(in srgb,var(--surface-alt) 76%,transparent));color:var(--muted);font-size:.83rem;line-height:1.35;box-shadow:0 14px 38px color-mix(in srgb,var(--shadow) 62%,transparent)}.proof-strip strong{color:var(--text);font-size:1.05rem;letter-spacing:-.02em}.mini-link{display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;text-decoration:none;color:var(--accent);font-weight:800;border:1px solid color-mix(in srgb,var(--accent) 24%,transparent);border-radius:999px;padding:.68rem .9rem;background:color-mix(in srgb,var(--accent) 8%,transparent)}.data-panel{display:flex;align-items:center;justify-content:space-between;gap:1.25rem}.card-kicker{margin-bottom:.15rem}.card-link{margin-top:.2rem;color:var(--accent)!important;font-weight:800}.status-pill{display:inline-flex;align-items:center;max-width:18rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:.25rem .58rem;background:color-mix(in srgb,var(--surface-strong) 70%,transparent);color:var(--muted);font-size:.7rem;font-weight:900;letter-spacing:.06em;text-transform:uppercase;line-height:1}.status-pill-good{border-color:color-mix(in srgb,var(--success) 32%,transparent);background:color-mix(in srgb,var(--success) 12%,transparent);color:var(--success)}.status-pill-language{border-color:color-mix(in srgb,var(--accent-warm) 26%,transparent);background:color-mix(in srgb,var(--accent-warm) 10%,transparent);color:var(--accent-warm)}.status-pill-source{max-width:13rem;text-transform:none;letter-spacing:0;font-weight:700}.rank-pill{display:inline-flex;align-items:center;justify-content:center;min-width:3.1rem;border-radius:999px;padding:.34rem .58rem;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 18%,transparent),color-mix(in srgb,var(--accent-warm) 15%,transparent));border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}.metric{font-size:1.02rem;letter-spacing:-.02em}.project-meta{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.45rem}.page{padding:0 clamp(1rem,4vw,3rem) 4rem}.section-heading{display:flex;justify-content:space-between;align-items:end;gap:1rem;margin:1.2rem 0 1.4rem}.section-heading p{max-width:620px}.panel{padding:1.3rem 1.35rem;margin:1rem 0}.country-grid,.board-grid,.stats-grid{display:grid;gap:1rem}.country-grid{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.board-grid,.stats-grid{grid-template-columns:repeat(auto-fit,minmax(270px,1fr));margin-top:1.4rem}.country-card,.board-card,.stat-card{text-decoration:none;display:block;padding:1.25rem 1.25rem;transition:transform .18s ease,border-color .18s ease,background .18s ease}.country-card{display:grid;gap:.45rem}.board-card{display:grid;grid-template-columns:auto 1fr;column-gap:1.05rem;row-gap:.48rem;align-items:start;padding:1.45rem 1.45rem 1.6rem}.board-icon{grid-row:span 2;display:inline-grid;place-items:center;width:2.65rem;height:2.65rem;border-radius:.95rem;background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}.board-icon svg{width:1.3rem;height:1.3rem}.board-card strong,.board-card span:not(.board-icon){grid-column:2}.board-card span:not(.board-icon){line-height:1.65;font-size:.98rem;max-width:34ch}.country-card span{line-height:1.45}.country-card:hover,.board-card:hover,.stat-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--accent) 34%,transparent);background:linear-gradient(180deg,rgba(22,43,68,.96),rgba(11,24,40,.96))}.country-card strong,.board-card strong,.stat-card strong{font-size:1.1rem;letter-spacing:-.02em}.board-card strong{font-size:1.16rem;line-height:1.25}.stat-card em{display:block;margin-top:.35rem;font-style:normal;color:var(--text);font-size:1.5rem;font-weight:800;letter-spacing:-.03em}.table-wrap{overflow:auto;border-radius:18px;border:1px solid var(--line);background:rgba(7,17,31,.36)}table{width:100%;border-collapse:collapse;min-width:940px}th,td{padding:1rem .9rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}tbody tr:nth-child(even){background:color-mix(in srgb,var(--surface-strong) 30%,transparent)}tbody tr:hover{background:color-mix(in srgb,var(--accent) 7%,transparent)}th{position:sticky;top:0;background:rgba(11,24,40,.96);color:var(--muted);font-size:.76rem;text-transform:uppercase;letter-spacing:.12em;z-index:1}th button{all:unset;cursor:pointer;color:var(--accent)}td a{color:#f7fbff;text-decoration:none;font-weight:700}td a:hover{text-decoration:underline}.rank{font-weight:800;color:var(--accent)}.contributor-name{display:flex;align-items:center;gap:.55rem;min-width:12rem;flex-wrap:wrap}.rank-delta{display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:999px;padding:.18rem .52rem;font-size:.68rem;font-weight:900;letter-spacing:.08em;line-height:1;text-transform:uppercase;white-space:nowrap;vertical-align:middle}.rank-delta-up{color:#052e1a;background:rgba(52,211,153,.95)}.rank-delta-down{color:#fff;background:rgba(248,113,113,.82)}.rank-delta-steady{color:var(--muted);background:rgba(148,173,206,.14)}.rank-delta-new{color:#083344;background:#a7f3d0;border-color:#6ee7b7}.note{margin-top:1rem;font-size:.95rem;line-height:1.7}.query-details{margin-top:1rem;border:1px solid var(--line);border-radius:18px;padding:.9rem 1rem;background:rgba(148,173,206,.04)}.query-details summary{cursor:pointer;color:var(--text);font-weight:700}.query-details ul{margin:.8rem 0 0;padding-left:1rem;color:var(--muted)}.query-details code{color:var(--accent)}.map{position:relative;min-height:540px;border-radius:28px;border:1px solid var(--line);background:radial-gradient(circle at top,color-mix(in srgb,var(--accent) 14%,transparent),transparent 38%),linear-gradient(180deg,rgba(17,34,54,.9),rgba(9,19,33,.96));overflow:hidden}.map:before,.map:after{content:"";position:absolute;background:rgba(148,173,206,.18)}.map:before{left:50%;top:0;bottom:0;width:1px}.map:after{top:50%;left:0;right:0;height:1px}.axis{position:absolute;color:var(--muted);font-weight:800;font-size:.76rem;text-transform:uppercase;letter-spacing:.16em}.axis.y{left:1rem;top:1rem}.axis.x{right:1rem;bottom:1rem}.dot{position:absolute;transform:translate(-50%,-50%);width:var(--s);height:var(--s);border-radius:999px;background:linear-gradient(135deg,var(--accent),var(--accent-strong));box-shadow:0 10px 28px rgba(220,97,79,.22);text-decoration:none;border:2px solid rgba(255,255,255,.82)}.dot span{position:absolute;left:1.15rem;top:-.35rem;white-space:nowrap;font-size:.76rem;font-weight:800;background:var(--surface-strong);border:1px solid var(--line);border-radius:999px;padding:.22rem .55rem;color:var(--text);box-shadow:0 10px 28px var(--shadow);opacity:0;pointer-events:none;transition:opacity .15s,transform .15s;transform:translateY(2px)}.dot:hover span,.dot:focus-visible span{opacity:1;transform:translateY(0)}ul{color:var(--muted);line-height:1.7}html:not([data-theme="dark"]) .hero-card,html:not([data-theme="dark"]) .panel,html:not([data-theme="dark"]) .country-card,html:not([data-theme="dark"]) .board-card,html:not([data-theme="dark"]) .stat-card{background:linear-gradient(180deg,rgba(255,253,248,.96),rgba(255,248,237,.96))}html:not([data-theme="dark"]) .table-wrap{background:rgba(255,252,246,.7)}html:not([data-theme="dark"]) th{background:rgba(255,248,237,.98)}html:not([data-theme="dark"]) td a{color:var(--text)}html:not([data-theme="dark"]) .stats span{color:var(--text);background:color-mix(in srgb,var(--accent) 10%,transparent);border-color:color-mix(in srgb,var(--accent) 22%,transparent)}html:not([data-theme="dark"]) .button-link{color:#fff;background:linear-gradient(135deg,#dc614f,#c04737);box-shadow:0 12px 32px rgba(220,97,79,.22)}html:not([data-theme="dark"]) .button-link.secondary{color:var(--text);background:rgba(255,255,255,.5)}html:not([data-theme="dark"]) .country-card:hover,html:not([data-theme="dark"]) .board-card:hover,html:not([data-theme="dark"]) .stat-card:hover{background:linear-gradient(180deg,#fff,#fff8ed)}footer{max-width:var(--max);margin:0 auto;padding:1.5rem clamp(1rem,4vw,3rem) 2.2rem;color:var(--muted);border-top:1px solid var(--line)}@media(max-width:960px){.hero-shell{grid-template-columns:1fr}.hero-card{order:-1}nav{overflow:auto;max-width:100%}}@media(max-width:760px){.proof-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.data-panel{display:block}.mini-link{width:100%;margin-top:.6rem}}@media(max-width:560px){.hero.home .board-grid{margin-top:1.35rem}.proof-strip{grid-template-columns:1fr}.site-header{align-items:stretch;flex-direction:column;padding:.85rem 1rem}.header-inner{justify-content:space-between}.nav-toggle{display:inline-flex}nav{display:none;grid-template-columns:1fr;gap:.35rem;padding:.35rem 0 .1rem}nav.open{display:grid}nav a{display:block;padding:.8rem .9rem;background:color-mix(in srgb,var(--surface-strong) 86%,transparent);border:1px solid var(--line);border-radius:14px}.hero{padding-top:2.6rem}.page{padding-bottom:2.5rem}.section-heading{flex-direction:column;align-items:flex-start}.board-grid,.stats-grid,.country-grid{grid-template-columns:1fr}.panel,.country-card,.board-card,.stat-card,.hero-card{border-radius:20px}table{min-width:760px}.hero-card li{grid-template-columns:1fr;gap:.2rem}.hero-card strong{text-align:left}h1{max-width:none;font-size:clamp(2.2rem,13vw,3.6rem)}.map{min-height:400px}.dot span{display:none}}`);


await writeFile(join(outDir, 'assets/site.js'), `(() => {
  const root = document.documentElement;
  const navToggle = document.querySelector('.nav-toggle');
  const siteNav = document.querySelector('#site-nav');
  const themeToggle = document.querySelector('.theme-toggle');

  function setTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem('ossrank-theme', next); } catch {}
    if (themeToggle) {
      themeToggle.textContent = next === 'dark' ? 'Light' : 'Dark';
      themeToggle.setAttribute('aria-label', next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#07111f' : '#fff8ed');
  }

  navToggle?.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!open));
    navToggle.setAttribute('aria-label', open ? 'Open navigation' : 'Close navigation');
    siteNav?.classList.toggle('open', !open);
  });

  setTheme(root.dataset.theme || 'light');
  themeToggle?.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
})();
`);

await writePage('', layout('Top GitHub contributors by country', 'Choose a country to see top GitHub contributors ranked by commits, public PRs, repos, and followers.', `<main><section class="hero home"><p class="eyebrow">Public OSS radar</p><div class="hero-shell"><div class="hero-copy"><h1>Find real OSS signal.</h1><p>Weekly GitHub snapshots for active contributors, rising builders, and fast-moving projects. ${countries.length} country boards · ${categorySnapshots.length} project categories · ${updateCadenceLabel}, latest ${escapeHtml(manifest.generated_at.slice(0, 10))}.</p><div class="hero-actions"><a class="button-link" href="#countries">Browse country boards</a><a class="button-link secondary" href="/global/">Open global leaderboard</a></div><div class="proof-strip" aria-label="Current OSSRank coverage"><span><strong>${globalContributors.entries.length.toLocaleString()}</strong> global contributors</span><span><strong>${projects.entries.length.toLocaleString()}</strong> active projects</span><span><strong>${countries.length.toLocaleString()}</strong> country boards</span><span><strong>${updateCadenceLabel}</strong> cadence</span></div></div></div>${boardCards([{ title: 'Countries', text: `${countries.length} observed country leaderboards ranked by public GitHub contribution activity.`, href: '#countries', icon: 'countries' }, { title: 'Agentic projects', text: 'Focused boards for agent frameworks, Claude, Codex, and OpenClaw-related repositories.', href: '/agentic/', icon: 'agentic' }, { title: 'Momentum map', text: 'A visual read on project velocity versus longer-term legitimacy signals.', href: '/momentum/', icon: 'momentum' }, { title: 'Rising contributors', text: 'Discover active builders whose public activity is high relative to audience size.', href: '/rising/', icon: 'rising' }])}</section><section id="countries" class="page"><div class="section-heading"><div><h2>Country boards</h2><p>Pick a geography to see who is shipping consistently, then jump into raw snapshots or methodology when you need to verify the signal.</p></div><a class="mini-link" href="/methodology/">How rankings work →</a></div>${countrySelector(countries)}<section class="panel data-panel"><div><h2>Data status</h2><p>Generated ${escapeHtml(manifest.generated_at)} from ${escapeHtml(manifest.api_budget.mode)} data. OSSRank refreshes on a weekly cadence from public GitHub API snapshots, with occasional manual refreshes when needed.</p></div><p class="note"><a href="/data/latest/manifest.json">Open manifest JSON</a></p></section></section></main>`, ''), { priority: '1.0' });
for (const country of countrySnapshots) {
  await writePage(`countries/${country.slug}`, contributorPage(country), { sitemap: false });
  await writePage(`countries/${country.slug}/top-github-contributors`, contributorPage(country), { priority: '0.8' });
}
await writePage('global', contributorPage(globalContributors, { global: true }), { priority: '0.9' });
await writePage('global/top-github-contributors', contributorPage(globalContributors, { global: true }), { sitemap: false });
await writePage('projects', projectsPage(projects, { title: 'Open-source projects by public activity' }), { priority: '0.9' });
for (const category of categorySnapshots) {
  await writePage(`categories/${category.slug}`, projectsPage(category, { eyebrow: 'Category', rawPrefix: 'categories' }), { priority: '0.8' });
}
await writePage('agentic', layout('Agentic open-source projects', 'Agentic, Claude, Codex, and OpenClaw open-source project boards.', `<main class="page"><section class="hero compact"><p class="eyebrow">Agentic projects</p><div class="hero-shell"><div class="hero-copy"><h1>Agentic open-source radar.</h1><p>First-class boards for agent frameworks and workflows, plus Claude, Codex, and OpenClaw-related subcategories.</p><div class="stats"><span>${agenticCards.length} focused boards</span><span>${updateCadenceLabel}</span><span>Fresh snapshot from public GitHub data</span></div></div><aside class="hero-card"><h2>Included views</h2><ul><li><span>Frameworks</span> <strong>Agentic OSS projects</strong></li><li><span>Model ecosystems</span> <strong>Claude and Codex boards</strong></li><li><span>Tooling</span> <strong>OpenClaw and workflow infra</strong></li></ul></aside></div>${boardCards(agenticCards.map((snapshot) => ({ title: snapshot.name, text: `${snapshot.entries.length} projects · ${snapshot.candidate_count} candidates`, href: `/categories/${snapshot.slug}/`, icon: 'agentic-board' })))}</section></main>`, 'agentic'), { priority: '0.9' });
if (momentum) await writePage('momentum', momentumPage(momentum), { priority: '0.9' });
if (rising) await writePage('rising', contributorPage(rising, { rising: true }), { priority: '0.9' });
await writePage('methodology', layout('Methodology', 'OSSRank methodology and limitations.', `<main class="page"><section class="hero compact"><p class="eyebrow">Methodology</p><div class="hero-shell"><div class="hero-copy"><h1>How OSSRank works.</h1><p>OSSRank is an observed public GitHub ranking built from official GitHub APIs. It refreshes weekly from point-in-time snapshots and is designed to be auditable and useful, not a complete census of every developer or repository on GitHub.</p></div><aside class="hero-card"><h2>Principles</h2><ul><li><span>Transparent</span> <strong>Queries are shown in every snapshot</strong></li><li><span>Cadence</span> <strong>Weekly public GitHub snapshots</strong></li><li><span>Consistent</span> <strong>Shared ranking inputs across boards</strong></li><li><span>Limited</span> <strong>Public GitHub data only</strong></li></ul></aside></div></section><section class="panel"><h2>Update cadence</h2><p>OSSRank is refreshed weekly from public GitHub API data. Each board shows the latest snapshot date in its header, and raw JSON snapshots include their exact generation timestamp and discovery query counts.</p></section><section class="panel"><h2>Discovery</h2><p>Contributor and project candidates come from saved GitHub search queries. Each snapshot stores the exact discovery queries and accepted candidate counts. There are no manually curated username or repository ranking seeds.</p></section><section class="panel"><h2>Agentic boards</h2><p>Agentic, Claude, Codex, and OpenClaw boards use GitHub repository search queries around public project text, topics, and recent pushes. They are category views over observable repository metadata, not endorsements or affiliation claims.</p></section><section class="panel"><h2>Rising contributors</h2><p>The rising contributor board is derived from current contributor snapshots. It weights public commits, pull requests, and repositories against follower count to surface under-discovered active contributors.</p></section><section class="panel"><h2>Momentum map</h2><p>The momentum map is derived from project snapshots. The vertical axis emphasizes recent merged PRs, commits, and releases; the horizontal axis emphasizes observed contributors, releases, issues, and stars.</p></section><section class="panel"><h2>Country matching</h2><p>Country pages use public, free-text GitHub profile locations. Location labels are confidence hints only: exact country, city match, multi-location, profile text match, or unknown. They are not verified nationality, residence, or identity claims.</p></section><section class="panel"><h2>Project metrics</h2><p>Project pages use GitHub repository search plus recent merged PR counts, recent commit counts, observed contributor counts, release counts, issue counts, and stars from official APIs. GraphQL recent merged PR and release windows are capped at the first 100 recently updated items, so high-volume repositories are displayed as 100+. Contributor count is observed all-time contributors when the REST budget permits, not unique contributors in the last 30 days.</p></section><section class="panel"><h2>Limitations</h2><ul><li>GitHub search is capped and relevance/ranking are controlled by GitHub.</li><li>Private contributions and private repositories are invisible.</li><li>Profiles with missing or playful locations may be absent or misclassified.</li><li>Snapshots are point-in-time weekly refreshes and may change as GitHub APIs update.</li></ul><p><a href="/data/latest/manifest.json">Open the latest manifest JSON</a></p></section></main>`, 'methodology'), { priority: '0.6', changefreq: 'weekly' });

await cp(dataDir, join(outDir, 'data/latest'), { recursive: true, force: true });

const lastmod = manifest.generated_at.slice(0, 10);
await writeFile(join(outDir, 'sitemap.xml'), sitemapXml(sitemapEntries, lastmod));
await writeFile(join(outDir, 'robots.txt'), `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`);
await writeFile(join(outDir, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/data/latest/*
  Cache-Control: public, max-age=300

/sitemap.xml
  Content-Type: application/xml; charset=utf-8
  Cache-Control: public, max-age=300

/robots.txt
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=300
`);
await writeFile(join(outDir, '_redirects'), `/countries/:country/ /countries/:country/top-github-contributors/ 301
/global/top-github-contributors/ /global/ 301
`);

console.log(`Built OSSRank site to ${outDir} with ${sitemapEntries.length} sitemap URLs for ${siteUrl}`);
