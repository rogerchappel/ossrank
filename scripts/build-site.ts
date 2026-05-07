import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { escapeHtml } from '../src/lib/html.js';
import type { Manifest, RankedContributor, RankedProject, RankingSnapshot } from '../src/lib/types.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const dataDir = args.get('--data') ?? 'data/latest';
const outDir = args.get('--out') ?? 'dist';

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writePage(path: string, html: string): Promise<void> {
  const file = join(outDir, path, 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}

function layout(title: string, description: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · OSSRank</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <link rel="canonical" href="https://ossrank.dev/" />
  <link rel="stylesheet" href="/assets/style.css" />
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/"><span>OSS</span>Rank</a>
    <nav><a href="/">Countries</a><a href="/global/">Global</a><a href="/projects/">Projects</a><a href="/methodology/">Methodology</a><a href="/data/latest/manifest.json">JSON</a></nav>
  </header>
  ${body}
  <footer><strong>OSSRank</strong> uses official GitHub APIs only. Country pages use public profile location text and visible public activity signals.</footer>
</body>
</html>`;
}

function countrySelector(countries: Array<{ name: string; slug: string; entries: number; status: string }>): string {
  return `<div class="country-grid">${countries.map((country) => `<a class="country-card" href="/countries/${country.slug}/top-github-contributors/"><strong>${escapeHtml(country.name)}</strong><span>${country.entries} contributors · ${escapeHtml(country.status)}</span></a>`).join('')}</div>`;
}

function contributorTable(snapshot: RankingSnapshot<RankedContributor>): string {
  const rows = [...snapshot.entries].sort((a, b) => (b.observed_public_commits ?? 0) - (a.observed_public_commits ?? 0) || (b.observed_public_pull_requests ?? 0) - (a.observed_public_pull_requests ?? 0) || (b.public_repos ?? 0) - (a.public_repos ?? 0) || b.followers - a.followers || a.login.localeCompare(b.login));
  return `<table id="contributors" aria-label="Top GitHub contributors in ${escapeHtml(snapshot.name)}"><thead><tr><th>Rank</th><th>Username</th><th><button data-sort="commits">Commits (1y)</button></th><th><button data-sort="prs">Public PRs (1y)</button></th><th><button data-sort="repos">Repos</button></th><th><button data-sort="followers">Followers</button></th><th>Location</th><th>Discovered by</th></tr></thead><tbody>${rows.map((entry, index) => `<tr data-commits="${entry.observed_public_commits ?? 0}" data-prs="${entry.observed_public_pull_requests ?? 0}" data-repos="${entry.public_repos ?? 0}" data-followers="${entry.followers}"><td class="rank">#${index + 1}</td><td><a href="${entry.profile_url}">${escapeHtml(entry.login)}</a><small>${escapeHtml(entry.name ?? '')}</small></td><td>${(entry.observed_public_commits ?? 0).toLocaleString()}</td><td>${(entry.observed_public_pull_requests ?? 0).toLocaleString()}</td><td>${(entry.public_repos ?? 0).toLocaleString()}</td><td>${entry.followers.toLocaleString()}</td><td>${escapeHtml(entry.location ?? 'Unknown')}<small>${escapeHtml(entry.location_confidence ?? 'unknown')}</small></td><td><small>${escapeHtml(entry.discovered_by_query ?? 'unknown')}</small></td></tr>`).join('')}</tbody></table><script>
const table = document.querySelector('#contributors');
const tbody = table?.querySelector('tbody');
function sortRows(metric) {
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.sort((a, b) => Number(b.dataset[metric] || 0) - Number(a.dataset[metric] || 0));
  rows.forEach((row, index) => { row.querySelector('.rank').textContent = '#' + (index + 1); tbody.appendChild(row); });
}
document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => sortRows(button.dataset.sort)));
</script>`;
}

function projectTable(snapshot: RankingSnapshot<RankedProject>): string {
  return `<table><thead><tr><th>Rank</th><th>Project</th><th>Merged PRs 30d</th><th>Commits 30d</th><th>Contributors</th><th>Releases 90d</th><th>Stars</th><th>Discovered by</th></tr></thead><tbody>${snapshot.entries.map((entry) => `<tr><td>#${entry.rank}</td><td><a href="${entry.url}">${escapeHtml(entry.full_name)}</a><small>${escapeHtml(entry.primary_language ?? '')}</small></td><td>${(entry.pull_requests_merged_30d ?? entry.pull_requests_merged_7d).toLocaleString()}<small>${entry.pull_requests_merged_7d.toLocaleString()} in 7d</small></td><td>${(entry.recent_commits_30d ?? 0).toLocaleString()}</td><td>${(entry.total_contributors_observed ?? entry.active_contributors_30d).toLocaleString()}</td><td>${(entry.releases_90d ?? 0).toLocaleString()}</td><td>${entry.stars.toLocaleString()}</td><td><small>${escapeHtml(entry.discovered_by_query ?? 'unknown')}</small></td></tr>`).join('')}</tbody></table>`;
}

function queryStats(snapshot: RankingSnapshot<unknown>): string {
  const stats = snapshot.candidate_count_by_query ?? [];
  if (stats.length === 0) return '';
  return `<details class="query-details"><summary>Discovery queries</summary><ul>${stats.map((stat) => `<li><code>${escapeHtml(stat.query)}</code> — ${stat.accepted.toLocaleString()} accepted from ${stat.total.toLocaleString()} GitHub matches</li>`).join('')}</ul></details>`;
}

function contributorPage(snapshot: RankingSnapshot<RankedContributor>, options?: { global?: boolean }): string {
  const isGlobal = options?.global ?? false;
  const scope = isGlobal ? 'globally' : `in ${snapshot.name}`;
  const description = `Top GitHub contributors ${scope}, sorted by public commit activity with public PR, repo, and follower columns.`;
  const rawPath = isGlobal ? `/data/latest/global-${snapshot.slug}.json` : `/data/latest/countries-${snapshot.slug}.json`;
  return layout(`Top GitHub contributors ${scope}`, description, `<main class="page"><section class="hero compact"><p class="eyebrow">${isGlobal ? 'Global rankings' : 'Country rankings'}</p><h1>Top GitHub contributors ${escapeHtml(scope)}</h1><p>Sorted by one-year commit totals by default. Click the column buttons to sort by public PRs, repos, or followers instead.</p><div class="stats"><span>${snapshot.entries.length} contributors</span><span>${snapshot.candidate_count} candidates checked</span><span>Updated ${escapeHtml(snapshot.generated_at.slice(0, 10))}</span></div></section><section class="panel">${contributorTable(snapshot)}<p class="note">Commit and PR counts are one-year public contribution totals from the official GitHub GraphQL API. Repo and follower counts come from public GitHub profile metadata. ${isGlobal ? 'The global page is still an observed candidate sample, not a complete census.' : 'Country matching uses free-text GitHub profile location and is not verified geography.'}</p>${queryStats(snapshot)}<p class="note"><a href="${rawPath}">Raw JSON snapshot</a> · <a href="/methodology/">Methodology</a></p></section></main>`);
}

function projectsPage(snapshot: RankingSnapshot<RankedProject>): string {
  return layout('Open-source projects by public activity', 'A simple OSSRank project page with public PR, contributor, and star signals.', `<main class="page"><section class="hero compact"><p class="eyebrow">Projects</p><h1>Open-source projects by public activity</h1><p>Real recent project signals from official GitHub APIs: merged PRs, recent commits, observed contributors, releases, and stars.</p><div class="stats"><span>${snapshot.entries.length} projects</span><span>${snapshot.candidate_count} candidates checked</span><span>Updated ${escapeHtml(snapshot.generated_at.slice(0, 10))}</span></div></section><section class="panel">${projectTable(snapshot)}${queryStats(snapshot)}<p class="note"><a href="/data/latest/projects-${snapshot.slug}.json">Raw JSON snapshot</a> · <a href="/methodology/">Methodology</a></p></section></main>`);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'assets'), { recursive: true });
await mkdir(join(outDir, 'data/latest'), { recursive: true });

const manifest = await readJson<Manifest>(join(dataDir, 'manifest.json'));
const countryShards = manifest.completed_shards.filter((shard) => shard.kind === 'country').sort((a, b) => a.title.localeCompare(b.title));
const countrySnapshots = await Promise.all(countryShards.map((shard) => readJson<RankingSnapshot<RankedContributor>>(join(dataDir, `countries-${shard.slug}.json`))));
const globalContributors = await readJson<RankingSnapshot<RankedContributor>>(join(dataDir, 'global-contributors.json'));
const projects = await readJson<RankingSnapshot<RankedProject>>(join(dataDir, 'projects-fastest-growing-open-source-projects.json'));
const countries = countrySnapshots.map((country) => ({ name: country.name, slug: country.slug, entries: country.entries.length, status: country.status }));

await writeFile(join(outDir, 'assets/style.css'), `:root{color-scheme:dark;--bg:#070a12;--card:#10192b;--muted:#95a3b8;--text:#edf4ff;--line:#23324d;--accent:#7dd3fc;--good:#34d399}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at top left,#172554 0,#070a12 42rem),var(--bg);color:var(--text)}a{color:inherit}.site-header{display:flex;justify-content:space-between;align-items:center;padding:1.1rem clamp(1rem,4vw,4rem);position:sticky;top:0;background:rgba(7,10,18,.82);backdrop-filter:blur(18px);border-bottom:1px solid var(--line);z-index:2}.brand{text-decoration:none;font-weight:900;font-size:1.3rem}.brand span{color:var(--accent)}nav{display:flex;gap:1rem;flex-wrap:wrap}nav a{color:var(--muted);text-decoration:none;font-size:.95rem}.hero{padding:clamp(4rem,8vw,8rem) clamp(1rem,5vw,5rem);max-width:1120px;margin:auto}.hero.compact{padding-bottom:2rem}.eyebrow{color:var(--accent);text-transform:uppercase;letter-spacing:.16em;font-weight:800;font-size:.78rem}h1{font-size:clamp(2.4rem,6vw,5.8rem);line-height:.94;margin:.2rem 0 1rem;max-width:980px}h2{font-size:1.5rem;margin-top:0}p{color:#cbd5e1;font-size:1.08rem;line-height:1.7;max-width:820px}.page{max-width:1180px;margin:auto;padding:0 clamp(1rem,4vw,4rem) 4rem}.panel,.country-card{background:linear-gradient(180deg,rgba(16,25,43,.94),rgba(10,16,29,.94));border:1px solid var(--line);border-radius:24px;padding:1.25rem;margin:1rem 0;box-shadow:0 20px 60px rgba(0,0,0,.24)}.country-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem;margin-top:2rem}.country-card{text-decoration:none;display:block}.country-card strong{font-size:1.35rem}.country-card span,small,.note{display:block;color:var(--muted);margin-top:.3rem}.stats{display:flex;gap:.75rem;flex-wrap:wrap}.query-details{margin-top:1rem}.query-details code{color:var(--accent)}.stats span{border:1px solid var(--line);border-radius:999px;padding:.45rem .7rem;background:rgba(125,211,252,.08);color:#dbeafe}table{width:100%;border-collapse:collapse;overflow:hidden}th,td{padding:1rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.08em}th button{all:unset;cursor:pointer;color:var(--accent);border-bottom:1px dotted var(--accent)}footer{border-top:1px solid var(--line);padding:2rem clamp(1rem,4vw,4rem);color:var(--muted)}@media(max-width:720px){.site-header{align-items:flex-start;flex-direction:column}.page{padding-bottom:2rem}table{display:block;overflow-x:auto}h1{font-size:3rem}}`);

await writePage('', layout('Top GitHub contributors by country', 'Choose a country to see top GitHub contributors ranked by commits, public PRs, repos, and followers.', `<main><section class="hero"><p class="eyebrow">GitHub country rankings</p><h1>Top GitHub contributors by country.</h1><p>Pick a country, then compare contributors by commits, public pull requests, repositories, and followers. No blended score needed for the main flow.</p>${countrySelector(countries)}</section><section class="page"><section class="panel"><h2>Global ranking</h2><p>There is also a global observed contributor ranking for high-activity accounts that do not fit neatly into one country.</p><a href="/global/">View global ranking</a></section><section class="panel"><h2>Projects</h2><p>Project rankings now use real recent GitHub signals rather than star-derived proxies.</p><a href="/projects/">View projects</a></section><section class="panel"><h2>Methodology</h2><p>OSSRank is transparent about query-based discovery, public API limits, and free-text location caveats.</p><a href="/methodology/">Read methodology</a></section><section class="panel"><h2>Data status</h2><p>Generated ${escapeHtml(manifest.generated_at)} from ${escapeHtml(manifest.api_budget.mode)} data.</p><a href="/data/latest/manifest.json">Open manifest JSON</a></section></section></main>`));
for (const country of countrySnapshots) {
  await writePage(`countries/${country.slug}`, contributorPage(country));
  await writePage(`countries/${country.slug}/top-github-contributors`, contributorPage(country));
}
await writePage('global', contributorPage(globalContributors, { global: true }));
await writePage('global/top-github-contributors', contributorPage(globalContributors, { global: true }));
await writePage('projects', projectsPage(projects));
await writePage('methodology', layout('Methodology', 'OSSRank methodology and limitations.', `<main class="page"><section class="hero compact"><p class="eyebrow">Methodology</p><h1>How OSSRank works.</h1><p>OSSRank is an observed public GitHub ranking built from official GitHub APIs. It is designed to be auditable and useful, not a complete census of every developer or repository on GitHub.</p></section><section class="panel"><h2>Discovery</h2><p>Contributor and project candidates come from saved GitHub search queries. Each snapshot stores the exact discovery queries and accepted candidate counts. There are no manually curated username or repository ranking seeds.</p></section><section class="panel"><h2>Contributor metrics</h2><p>Commit and pull request counts use GitHub GraphQL contribution collections over a one-year window. Repository and follower counts come from public user profile metadata.</p></section><section class="panel"><h2>Country matching</h2><p>Country pages use public, free-text GitHub profile locations. Location labels are confidence hints only: exact country, city match, multi-location, profile text match, or unknown. They are not verified nationality, residence, or identity claims.</p></section><section class="panel"><h2>Project metrics</h2><p>Project pages use GitHub repository search plus recent merged PR counts, recent commit counts, observed contributor counts, release counts, issue counts, and stars from official APIs. Contributor count is observed all-time contributors, not unique contributors in the last 30 days.</p></section><section class="panel"><h2>Limitations</h2><ul><li>GitHub search is capped and relevance/ranking are controlled by GitHub.</li><li>Private contributions and private repositories are invisible.</li><li>Profiles with missing or playful locations may be absent or misclassified.</li><li>Snapshots are point-in-time and may change as GitHub APIs update.</li></ul><p><a href="/data/latest/manifest.json">Open the latest manifest JSON</a></p></section></main>`));

await cp(dataDir, join(outDir, 'data/latest'), { recursive: true, force: true });
console.log(`Built OSSRank site to ${outDir}`);
