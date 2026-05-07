import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { escapeHtml } from '../src/lib/html.js';
import { movement } from '../src/lib/ranking.js';
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
    <nav><a href="/countries/australia/top-github-contributors/">Countries</a><a href="/languages/typescript/top-open-source-contributors/">Languages</a><a href="/categories/developer-tools/top-open-source-projects/">Categories</a><a href="/methodology/">Methodology</a><a href="/data/latest/manifest.json">JSON</a></nav>
  </header>
  ${body}
  <footer><strong>OSSRank</strong> ranks observed public OSS signals. Every page links to methodology and raw JSON so stale data is visible, not hidden.</footer>
</body>
</html>`;
}

type ContributorTableMode = 'repos' | 'commits' | 'pull-requests' | 'score';

function contributorTable(snapshot: RankingSnapshot<RankedContributor>, mode: ContributorTableMode = 'repos'): string {
  const configs = {
    repos: { label: 'Public repos', value: (entry: RankedContributor) => entry.public_repos ?? 0, note: 'raw GitHub profile count' },
    commits: { label: 'Observed commits', value: (entry: RankedContributor) => entry.observed_public_commits ?? 0, note: 'recent public events sample' },
    'pull-requests': { label: 'Opened PRs', value: (entry: RankedContributor) => entry.observed_public_pull_requests ?? 0, note: 'recent public events sample' },
    score: { label: 'OSSRank score', value: (entry: RankedContributor) => entry.public_contributions, note: 'combined proxy' }
  } satisfies Record<ContributorTableMode, { label: string; value: (entry: RankedContributor) => number; note: string }>;
  const config = configs[mode];
  const rows = [...snapshot.entries].sort((a, b) => config.value(b) - config.value(a) || b.followers - a.followers || a.login.localeCompare(b.login));
  return `<table><thead><tr><th>Rank</th><th>Contributor</th><th>${config.label}</th><th>Repos</th><th>Followers</th><th>Location signal</th></tr></thead><tbody>${rows.map((entry, index) => `<tr><td>#${index + 1}</td><td><a href="${entry.profile_url}">${escapeHtml(entry.login)}</a><small>${escapeHtml(entry.name ?? '')}</small></td><td>${config.value(entry).toLocaleString()}<small>${config.note}</small></td><td>${(entry.public_repos ?? 0).toLocaleString()}</td><td>${entry.followers.toLocaleString()}</td><td>${escapeHtml(entry.location ?? 'Unknown')}<small>${escapeHtml(entry.location_confidence ?? 'unknown')}</small></td></tr>`).join('')}</tbody></table>`;
}

function projectTable(snapshot: RankingSnapshot<RankedProject>): string {
  return `<table><thead><tr><th>Rank</th><th>Project</th><th>Merged PRs / 7d</th><th>Active contributors / 30d</th><th>Stars</th><th>Move</th></tr></thead><tbody>${snapshot.entries.map((entry) => `<tr><td>#${entry.rank}</td><td><a href="${entry.url}">${escapeHtml(entry.full_name)}</a><small>${escapeHtml(entry.primary_language ?? '')}</small></td><td>${entry.pull_requests_merged_7d.toLocaleString()}</td><td>${entry.active_contributors_30d.toLocaleString()}</td><td>${entry.stars.toLocaleString()}</td><td>${movement(entry)}</td></tr>`).join('')}</tbody></table>`;
}

function caveatBlock(snapshot: RankingSnapshot<unknown>): string {
  return `<section class="panel"><h2>Freshness and caveats</h2><dl><dt>Status</dt><dd><span class="pill ${snapshot.status}">${snapshot.status}</span></dd><dt>Generated</dt><dd>${escapeHtml(snapshot.generated_at)}</dd><dt>Fresh until</dt><dd>${escapeHtml(snapshot.fresh_until)}</dd><dt>Method</dt><dd>${escapeHtml(snapshot.method)}</dd><dt>Raw JSON</dt><dd><a href="/data/latest/${snapshot.kind === 'country' ? 'countries' : snapshot.kind === 'language' ? 'languages' : snapshot.kind === 'category' ? 'categories' : 'projects'}-${snapshot.slug}.json">download snapshot</a></dd></dl><ul>${snapshot.caveats.map((caveat) => `<li>${escapeHtml(caveat)}</li>`).join('')}</ul></section>`;
}

function rankingPage(snapshot: RankingSnapshot<RankedContributor | RankedProject>, table: string, heading = 'Ranking'): string {
  return layout(snapshot.title, `${snapshot.title} with freshness, methodology, caveats, and raw JSON snapshot links.`, `<main class="page"><section class="hero compact"><p class="eyebrow">${escapeHtml(snapshot.kind)} ranking</p><h1>${escapeHtml(snapshot.title)}</h1><p>Ranked data should be useful without pretending to be perfect. This page exposes the data source, freshness state, caveats, and the raw snapshot behind the table.</p><div class="stats"><span>${snapshot.entries.length} ranked entries</span><span>${snapshot.candidate_count} candidates</span><span>${escapeHtml(snapshot.status)} snapshot</span></div></section>${caveatBlock(snapshot)}<section class="panel"><h2>${escapeHtml(heading)}</h2>${table}</section></main>`);
}

function contributorMetricsPage(snapshot: RankingSnapshot<RankedContributor>): string {
  return layout(snapshot.title, `${snapshot.title} ranked by raw public repositories, observed commits, observed pull requests, and transparent OSSRank score.`, `<main class="page"><section class="hero compact"><p class="eyebrow">${escapeHtml(snapshot.kind)} contributor data</p><h1>${escapeHtml(snapshot.title)}</h1><p>This page favours raw public GitHub signals over a blended score. Use the repository, commit, and pull-request tables separately depending on what you want to compare.</p><div class="stats"><span>${snapshot.entries.length} ranked entries</span><span>${snapshot.candidate_count} candidates</span><span>${escapeHtml(snapshot.status)} snapshot</span></div></section>${caveatBlock(snapshot)}<section class="panel"><h2>By public repositories</h2>${contributorTable(snapshot, 'repos')}</section><section class="panel"><h2>By observed recent public commits</h2>${contributorTable(snapshot, 'commits')}</section><section class="panel"><h2>By observed recent opened pull requests</h2>${contributorTable(snapshot, 'pull-requests')}</section><section class="panel"><h2>By OSSRank score</h2>${contributorTable(snapshot, 'score')}</section></main>`);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'assets'), { recursive: true });
await mkdir(join(outDir, 'data/latest'), { recursive: true });

const manifest = await readJson<Manifest>(join(dataDir, 'manifest.json'));
const country = await readJson<RankingSnapshot<RankedContributor>>(join(dataDir, 'countries-australia.json'));
const language = await readJson<RankingSnapshot<RankedContributor>>(join(dataDir, 'languages-typescript.json'));
const category = await readJson<RankingSnapshot<RankedProject>>(join(dataDir, 'categories-developer-tools.json'));
const projects = await readJson<RankingSnapshot<RankedProject>>(join(dataDir, 'projects-fastest-growing-open-source-projects.json'));

await writeFile(join(outDir, 'assets/style.css'), `:root{color-scheme:dark;--bg:#070a12;--card:#10192b;--muted:#95a3b8;--text:#edf4ff;--line:#23324d;--accent:#7dd3fc;--hot:#a78bfa;--good:#34d399}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at top left,#172554 0,#070a12 42rem),var(--bg);color:var(--text)}a{color:inherit}.site-header{display:flex;justify-content:space-between;align-items:center;padding:1.1rem clamp(1rem,4vw,4rem);position:sticky;top:0;background:rgba(7,10,18,.78);backdrop-filter:blur(18px);border-bottom:1px solid var(--line);z-index:2}.brand{text-decoration:none;font-weight:900;font-size:1.3rem}.brand span{color:var(--accent)}nav{display:flex;gap:1rem;flex-wrap:wrap}nav a{color:var(--muted);text-decoration:none;font-size:.95rem}.hero{padding:clamp(4rem,8vw,8rem) clamp(1rem,5vw,5rem);max-width:1180px;margin:auto}.hero.compact{padding-bottom:2rem}.eyebrow{color:var(--accent);text-transform:uppercase;letter-spacing:.16em;font-weight:800;font-size:.78rem}h1{font-size:clamp(2.6rem,7vw,6.6rem);line-height:.9;margin:.2rem 0 1rem;max-width:980px}h2{font-size:1.5rem;margin-top:0}p{color:#cbd5e1;font-size:1.08rem;line-height:1.7;max-width:780px}.cta{display:flex;gap:1rem;flex-wrap:wrap;margin-top:2rem}.button{padding:.9rem 1.1rem;border:1px solid var(--line);border-radius:999px;background:#e0f2fe;color:#06121f;text-decoration:none;font-weight:800}.button.secondary{background:transparent;color:var(--text)}.grid,.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem}.page{max-width:1180px;margin:auto;padding:0 clamp(1rem,4vw,4rem) 4rem}.panel,.card{background:linear-gradient(180deg,rgba(16,25,43,.94),rgba(10,16,29,.94));border:1px solid var(--line);border-radius:24px;padding:1.25rem;margin:1rem 0;box-shadow:0 20px 60px rgba(0,0,0,.24)}.card{text-decoration:none;display:block}.card strong{font-size:1.15rem}.card span,.card small,small,dd{display:block;color:var(--muted);margin-top:.25rem}.stats{display:flex;gap:.75rem;flex-wrap:wrap}.stats span,.pill{border:1px solid var(--line);border-radius:999px;padding:.45rem .7rem;background:rgba(125,211,252,.08);color:#dbeafe}.pill.demo{border-color:#a78bfa;color:#ddd6fe}.pill.fresh{border-color:#34d399;color:#bbf7d0}table{width:100%;border-collapse:collapse;overflow:hidden}th,td{padding:1rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.08em}dl{display:grid;grid-template-columns:minmax(120px,180px) 1fr;gap:.6rem}dt{color:var(--muted)}footer{border-top:1px solid var(--line);padding:2rem clamp(1rem,4vw,4rem);color:var(--muted)}@media(max-width:720px){.site-header{align-items:flex-start;flex-direction:column}.page{padding-bottom:2rem}table{display:block;overflow-x:auto}h1{font-size:3rem}}`);

await writePage('', layout('Public OSS rankings that stay fresh', 'OSSRank is a static-first public ranking site for observed open-source contributors, projects, languages, categories, badges, and raw JSON snapshots.', `<main><section class="hero"><p class="eyebrow">Freshness-first OSS leaderboards</p><h1>Public OSS rankings that show their work.</h1><p>OSSRank turns scheduled GitHub API snapshots into static pages, badges, charts, and JSON data. It is designed to stay up to date, preserve last-known-good data, and make caveats impossible to miss.</p><div class="cta"><a class="button" href="/countries/australia/top-github-contributors/">View Australia contributors</a><a class="button secondary" href="/methodology/">Read methodology</a></div></section><section class="page"><div class="grid"><a class="card" href="/countries/australia/top-github-contributors/"><strong>Country contributor rankings</strong><span>${country.entries.length} entries · ${country.status}</span></a><a class="card" href="/languages/typescript/top-open-source-contributors/"><strong>Language contributor rankings</strong><span>${language.entries.length} entries · ${language.status}</span></a><a class="card" href="/categories/developer-tools/top-open-source-projects/"><strong>Category project rankings</strong><span>${category.entries.length} entries · ${category.status}</span></a><a class="card" href="/projects/fastest-growing-open-source-projects/"><strong>Project momentum</strong><span>${projects.entries.length} entries · ${projects.status}</span></a></div><section class="panel"><h2>Latest data manifest</h2><p>Generated ${escapeHtml(manifest.generated_at)} from ${manifest.api_budget.mode} data. The manifest records completed shards, failed shards, stale pages, API budget, duration, and source commit.</p><a class="button secondary" href="/data/latest/manifest.json">Open manifest JSON</a></section></section></main>`));
await writePage('countries/australia/top-github-contributors', contributorMetricsPage(country));
await writePage('countries/australia/top-github-users-by-repositories', rankingPage(country, contributorTable(country, 'repos'), 'Top Australian GitHub users by public repositories'));
await writePage('countries/australia/top-github-users-by-commits', rankingPage(country, contributorTable(country, 'commits'), 'Top Australian GitHub users by observed recent public commits'));
await writePage('countries/australia/top-github-users-by-pull-requests', rankingPage(country, contributorTable(country, 'pull-requests'), 'Top Australian GitHub users by observed recent opened pull requests'));
await writePage('countries/australia/top-github-users-by-score', rankingPage(country, contributorTable(country, 'score'), 'Top Australian GitHub users by OSSRank score'));
await writePage('countries/australia/fastest-rising-github-contributors', rankingPage(country, contributorTable(country, 'commits'), 'Fastest rising Australian GitHub contributors by observed recent commits'));
await writePage('languages/typescript/top-open-source-contributors', contributorMetricsPage(language));
await writePage('languages/typescript/top-github-users-by-repositories', rankingPage(language, contributorTable(language, 'repos'), 'Top TypeScript GitHub users by public repositories'));
await writePage('languages/typescript/top-github-users-by-commits', rankingPage(language, contributorTable(language, 'commits'), 'Top TypeScript GitHub users by observed recent public commits'));
await writePage('languages/typescript/top-github-users-by-pull-requests', rankingPage(language, contributorTable(language, 'pull-requests'), 'Top TypeScript GitHub users by observed recent opened pull requests'));
await writePage('categories/developer-tools/top-open-source-projects', rankingPage(category, projectTable(category)));
await writePage('projects/fastest-growing-open-source-projects', rankingPage(projects, projectTable(projects)));
await writePage('projects/most-pull-requests-this-week', rankingPage(projects, projectTable(projects)));
await writePage('methodology', layout('Methodology', 'How OSSRank ranks observed public OSS contributor and project data without overclaiming.', `<main class="page"><section class="hero compact"><p class="eyebrow">Methodology</p><h1>Useful rankings, honest caveats.</h1><p>OSSRank uses official GitHub APIs only. V1 discovers candidates from configured presets, exposes raw public data tables, validates snapshots, and deploys the last valid static dataset.</p></section><section class="panel"><h2>What the ranks mean</h2><ul><li>Country pages use free-text GitHub profile location signals and are not verified geography.</li><li>Contributor pages prioritize raw public repositories, observed recent public commits, and observed recent opened pull requests in separate tables.</li><li>Observed commit and pull-request counts come from recent GitHub public events, not GitHub's all-time profile contribution graph.</li><li>The OSSRank score remains as a transparent combined proxy, but it is secondary to raw metric pages.</li><li>Project pages rank public repository momentum signals such as merged PRs, active contributors, and stars.</li><li>Every shard keeps immutable run data, compact history, a freshness window, and explicit failure state.</li></ul></section><section class="panel"><h2>What OSSRank will not do</h2><ul><li>No GitHub HTML scraping.</li><li>No token pools or rate-limit bypassing.</li><li>No claims of complete global coverage.</li><li>No recruiting lead database positioning or sale of personal information.</li></ul></section></main>`));

await mkdir(join(outDir, 'badges/users/octo-kiwi'), { recursive: true });
await writeFile(join(outDir, 'badges/users/octo-kiwi/au.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="310" height="28" role="img" aria-label="Observed top OSS contributor in Australia"><rect width="310" height="28" rx="14" fill="#0f172a"/><rect width="94" height="28" rx="14" fill="#0369a1"/><text x="47" y="18" text-anchor="middle" fill="#fff" font-family="Verdana" font-size="11">OSSRank</text><text x="202" y="18" text-anchor="middle" fill="#e0f2fe" font-family="Verdana" font-size="11">#1 observed AU contributor</text></svg>`);
await cp(dataDir, join(outDir, 'data/latest'), { recursive: true, force: true });
console.log(`Built OSSRank site to ${outDir}`);
