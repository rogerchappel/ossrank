import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addDays } from '../src/lib/freshness.js';
import { rankContributors, rankProjects } from '../src/lib/ranking.js';
import { writeSnapshots } from '../src/lib/snapshots.js';
import type { RankedContributor, RankedProject, RankingSnapshot } from '../src/lib/types.js';

const root = process.cwd();
const started = Date.now();
const now = new Date();
const generatedAt = now.toISOString();
const freshUntil = addDays(now, 7);
const runId = generatedAt.slice(0, 10);

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

const contributors = rankContributors(await readJson<Omit<RankedContributor, 'rank'>[]>(join(root, 'fixtures/contributors.json')));
const projects = rankProjects(await readJson<Omit<RankedProject, 'rank'>[]>(join(root, 'fixtures/projects.json')));

const caveats = [
  'Fixture data is demo-only until a live GitHub token-backed refresh is enabled.',
  'Location matching uses free-text GitHub profile locations and must not be treated as verified nationality or residence.',
  'Ranks are observed public signals from the configured snapshot, not a complete census of every OSS contributor.'
];

const countrySnapshot: RankingSnapshot<RankedContributor> = {
  kind: 'country', slug: 'australia', code: 'AU', name: 'Australia', title: 'Top observed GitHub contributors in Australia',
  generated_at: generatedAt, fresh_until: freshUntil, status: 'demo', method: 'fixture-github-search-followers-then-public-contribution-score', source_run: runId,
  candidate_count: 500, caveats,
  history: { weeks: ['2026-04-23', '2026-04-30', runId], ranked_items: [91, 96, contributors.length], top_10_signal: [61400, 67500, contributors.reduce((sum, item) => sum + item.public_contributions, 0)] },
  entries: contributors
};
const languageSnapshot: RankingSnapshot<RankedContributor> = { ...countrySnapshot, kind: 'language', slug: 'typescript', code: undefined, name: 'TypeScript', title: 'Top observed TypeScript open-source contributors', candidate_count: 500 };
const categorySnapshot: RankingSnapshot<RankedProject> = {
  kind: 'category', slug: 'developer-tools', name: 'Developer Tools', title: 'Top observed developer tools open-source projects',
  generated_at: generatedAt, fresh_until: freshUntil, status: 'demo', method: 'fixture-github-repository-search-then-project-momentum-score', source_run: runId,
  candidate_count: 300,
  caveats: ['Fixture data is demo-only until a live GitHub token-backed refresh is enabled.', 'Project momentum prioritises recent merged pull requests, active contributors, then stars.', 'Ranks are observed public repository signals from the configured snapshot.'],
  history: { weeks: ['2026-04-23', '2026-04-30', runId], ranked_items: [72, 80, projects.length], top_10_signal: [188, 244, projects.reduce((sum, item) => sum + item.pull_requests_merged_7d, 0)] },
  entries: projects
};
const projectSnapshot: RankingSnapshot<RankedProject> = { ...categorySnapshot, kind: 'projects', slug: 'fastest-growing-open-source-projects', name: 'Fastest Growing Open Source Projects', title: 'Fastest growing observed open-source projects' };

const manifest = await writeSnapshots([countrySnapshot, languageSnapshot, categorySnapshot, projectSnapshot], { root, generatedAt, method: 'fixture-refresh', mode: 'fixture', durationMs: Date.now() - started });
console.log(`Generated ${manifest.completed_shards.length} demo shards in ${Date.now() - started}ms`);
