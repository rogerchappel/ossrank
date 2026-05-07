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
    <nav><a href="/countries/australia/top-github-contributors/">Countries</a><a href="/projects/">Projects</a><a href="/data/latest/manifest.json">JSON</a></nav>
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
  const rows = [...snapshot.entries].sort((a, b) => (b.observed_public_commits ?? 0) - (a.observed_public_commits ?? 0) || (b.observed_public_pull_requests ?? 0) - (a.observed_public_pull_requests ?? 0) || b.followers - a.followers || a.login.localeCompare(b.login));
  return `<table id="contributors" aria-label="Top GitHub contributors in ${escapeHtml(snapshot.name)}"><thead><tr><th>Rank</th><th>Username</th><th><button data-sort="commits">Commits</button></th><th><button data-sort="prs">Public PRs</button></th><th><button data-sort="followers">Followers</button></th><th>Location</th></tr></thead><tbody>${rows.map((entry, index) => `<tr data-commits="${entry.observed_public_commits ?? 0}" data-prs="${entry.observed_public_pull_requests ?? 0}" data-followers="${entry.followers}"><td class="rank">#${index + 1}</td><td><a href="${entry.profile_url}">${escapeHtml(entry.login)}</a><small>${escapeHtml(entry.name ?? '')}</small></td><td>${(entry.observed_public_commits ?? 0).toLocaleString()}</td><td>${(entry.observed_public_pull_requests ?? 0).toLocaleString()}</td><td>${entry.followers.toLocaleString()}</td><td>${escapeHtml(entry.location ?? 'Unknown')}</td></tr>`).join('')}</tbody></table><script>
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
  return `<table><thead><tr><th>Rank</th><th>Project</th><th>Public PRs</th><th>Active contributors</th><th>Stars</th></tr></thead><tbody>${snapshot.entries.map((entry) => `<tr><td>#${entry.rank}</td><td><a href="${entry.url}">${escapeHtml(entry.full_name)}</a><small>${escapeHtml(entry.primary_language ?? '')}</small></td><td>${entry.pull_requests_merged_7d.toLocaleString()}</td><td>${entry.active_contributors_30d.toLocaleString()}</td><td>${entry.stars.toLocaleString()}</td></tr>`).join('')}</tbody></table>`;
}

function countryPage(snapshot: RankingSnapshot<RankedContributor>): string {
  const description = `Top GitHub contributors in ${snapshot.name}, sorted by public commit activity with public PR and follower columns.`;
  return layout(`Top GitHub contributors in ${snapshot.name}`, description, `<main class="page"><section class="hero compact"><p class="eyebrow">Country rankings</p><h1>Top GitHub contributors in ${escapeHtml(snapshot.name)}</h1><p>Sorted by commits by default. Click the column buttons to sort by public PRs or followers instead.</p><div class="stats"><span>${snapshot.entries.length} contributors</span><span>${snapshot.candidate_count} candidates checked</span><span>Updated ${escapeHtml(snapshot.generated_at.slice(0, 10))}</span></div></section><section class="panel">${contributorTable(snapshot)}<p class="note">Commit and PR counts are currently observed from recent public GitHub events. Country matching uses free-text GitHub profile location and is not verified geography.</p><p class="note"><a href="/data/latest/countries-${snapshot.slug}.json">Raw JSON snapshot</a></p></section></main>`);
}

function projectsPage(snapshot: RankingSnapshot<RankedProject>): string {
  return layout('Open-source projects by public activity', 'A simple OSSRank project page with public PR, contributor, and star signals.', `<main class="page"><section class="hero compact"><p class="eyebrow">Projects</p><h1>Open-source projects by public activity</h1><p>One project table for now: public PR signal, active contributor proxy, and stars.</p><div class="stats"><span>${snapshot.entries.length} projects</span><span>${snapshot.candidate_count} candidates checked</span><span>Updated ${escapeHtml(snapshot.generated_at.slice(0, 10))}</span></div></section><section class="panel">${projectTable(snapshot)}<p class="note"><a href="/data/latest/projects-${snapshot.slug}.json">Raw JSON snapshot</a></p></section></main>`);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'assets'), { recursive: true });
await mkdir(join(outDir, 'data/latest'), { recursive: true });

const manifest = await readJson<Manifest>(join(dataDir, 'manifest.json'));
const australia = await readJson<RankingSnapshot<RankedContributor>>(join(dataDir, 'countries-australia.json'));
const projects = await readJson<RankingSnapshot<RankedProject>>(join(dataDir, 'projects-fastest-growing-open-source-projects.json'));
const countries = [{ name: australia.name, slug: australia.slug, entries: australia.entries.length, status: australia.status }];

await writeFile(join(outDir, 'assets/style.css'), `:root{color-scheme:dark;--bg:#070a12;--card:#10192b;--muted:#95a3b8;--text:#edf4ff;--line:#23324d;--accent:#7dd3fc;--good:#34d399}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at top left,#172554 0,#070a12 42rem),var(--bg);color:var(--text)}a{color:inherit}.site-header{display:flex;justify-content:space-between;align-items:center;padding:1.1rem clamp(1rem,4vw,4rem);position:sticky;top:0;background:rgba(7,10,18,.82);backdrop-filter:blur(18px);border-bottom:1px solid var(--line);z-index:2}.brand{text-decoration:none;font-weight:900;font-size:1.3rem}.brand span{color:var(--accent)}nav{display:flex;gap:1rem;flex-wrap:wrap}nav a{color:var(--muted);text-decoration:none;font-size:.95rem}.hero{padding:clamp(4rem,8vw,8rem) clamp(1rem,5vw,5rem);max-width:1120px;margin:auto}.hero.compact{padding-bottom:2rem}.eyebrow{color:var(--accent);text-transform:uppercase;letter-spacing:.16em;font-weight:800;font-size:.78rem}h1{font-size:clamp(2.4rem,6vw,5.8rem);line-height:.94;margin:.2rem 0 1rem;max-width:980px}h2{font-size:1.5rem;margin-top:0}p{color:#cbd5e1;font-size:1.08rem;line-height:1.7;max-width:820px}.page{max-width:1180px;margin:auto;padding:0 clamp(1rem,4vw,4rem) 4rem}.panel,.country-card{background:linear-gradient(180deg,rgba(16,25,43,.94),rgba(10,16,29,.94));border:1px solid var(--line);border-radius:24px;padding:1.25rem;margin:1rem 0;box-shadow:0 20px 60px rgba(0,0,0,.24)}.country-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem;margin-top:2rem}.country-card{text-decoration:none;display:block}.country-card strong{font-size:1.35rem}.country-card span,small,.note{display:block;color:var(--muted);margin-top:.3rem}.stats{display:flex;gap:.75rem;flex-wrap:wrap}.stats span{border:1px solid var(--line);border-radius:999px;padding:.45rem .7rem;background:rgba(125,211,252,.08);color:#dbeafe}table{width:100%;border-collapse:collapse;overflow:hidden}th,td{padding:1rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.08em}th button{all:unset;cursor:pointer;color:var(--accent);border-bottom:1px dotted var(--accent)}footer{border-top:1px solid var(--line);padding:2rem clamp(1rem,4vw,4rem);color:var(--muted)}@media(max-width:720px){.site-header{align-items:flex-start;flex-direction:column}.page{padding-bottom:2rem}table{display:block;overflow-x:auto}h1{font-size:3rem}}`);

await writePage('', layout('Top GitHub contributors by country', 'Choose a country to see top GitHub contributors ranked by commits, public PRs, and followers.', `<main><section class="hero"><p class="eyebrow">GitHub country rankings</p><h1>Top GitHub contributors by country.</h1><p>Pick a country, then compare contributors by commits, public pull requests, and followers. No blended score needed for the main flow.</p>${countrySelector(countries)}</section><section class="page"><section class="panel"><h2>Projects</h2><p>There is also one simple projects page for public project activity.</p><a href="/projects/">View projects</a></section><section class="panel"><h2>Data status</h2><p>Generated ${escapeHtml(manifest.generated_at)} from ${escapeHtml(manifest.api_budget.mode)} data.</p><a href="/data/latest/manifest.json">Open manifest JSON</a></section></section></main>`));
await writePage('countries/australia', countryPage(australia));
await writePage('countries/australia/top-github-contributors', countryPage(australia));
await writePage('projects', projectsPage(projects));
await writePage('methodology', layout('Methodology', 'OSSRank methodology and limitations.', `<main class="page"><section class="hero compact"><p class="eyebrow">Methodology</p><h1>Simple public GitHub signals.</h1><p>Country pages are based on official GitHub APIs, public profile location text, and visible public activity signals. No GitHub HTML scraping, no token pools, and no claims of complete coverage.</p></section></main>`));

await mkdir(join(outDir, 'badges/users/octo-kiwi'), { recursive: true });
await writeFile(join(outDir, 'badges/users/octo-kiwi/au.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="310" height="28" role="img" aria-label="Top GitHub contributor in Australia"><rect width="310" height="28" rx="14" fill="#0f172a"/><rect width="94" height="28" rx="14" fill="#0369a1"/><text x="47" y="18" text-anchor="middle" fill="#fff" font-family="Verdana" font-size="11">OSSRank</text><text x="202" y="18" text-anchor="middle" fill="#e0f2fe" font-family="Verdana" font-size="11">Top AU contributor</text></svg>`);
await cp(dataDir, join(outDir, 'data/latest'), { recursive: true, force: true });
console.log(`Built OSSRank site to ${outDir}`);
