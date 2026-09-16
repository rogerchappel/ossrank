import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeSnapshots } from '../src/lib/snapshots.js';
import type { Manifest, RankedContributor, RankingSnapshot } from '../src/lib/types.js';

function globalSnapshot(generatedAt: string): RankingSnapshot<RankedContributor> {
  return {
    kind: 'global',
    slug: 'contributors',
    name: 'Global',
    title: 'Top observed GitHub contributors globally',
    generated_at: generatedAt,
    fresh_until: '2026-09-23T00:00:00.000Z',
    status: 'fresh',
    method: 'test',
    source_run: generatedAt.slice(0, 10),
    candidate_count: 1,
    caveats: [],
    history: { weeks: [generatedAt.slice(0, 10)], ranked_items: [1], top_10_signal: [10] },
    entries: [{ rank: 1, login: 'builder', profile_url: 'https://github.com/builder', public_contributions: 10, followers: 1 }]
  };
}

test('scoped writes replace their shard and preserve unrelated manifest shards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ossrank-snapshots-'));
  const latestDir = join(root, 'data/latest');
  const historyDir = join(root, 'data/history');
  const runDir = join(root, 'data/runs/2026-09-16');
  await mkdir(latestDir, { recursive: true });

  const previousGeneratedAt = '2026-09-09T00:00:00.000Z';
  const previousGlobal = globalSnapshot(previousGeneratedAt);
  const existingManifest: Manifest = {
    generated_at: previousGeneratedAt,
    source_commit: 'old',
    method: 'test',
    status: 'fresh',
    completed_shards: [
      { kind: 'global', slug: 'contributors', title: previousGlobal.title, path: '/data/latest/global-contributors.json', status: 'fresh', generated_at: previousGeneratedAt, fresh_until: previousGlobal.fresh_until, entries: 1 },
      { kind: 'country', slug: 'australia', title: 'Australia', path: '/data/latest/countries-australia.json', status: 'stale', generated_at: previousGeneratedAt, fresh_until: previousGlobal.fresh_until, entries: 20 }
    ],
    failed_shards: [],
    stale_pages: ['australia'],
    api_budget: { provider: 'github', mode: 'live', remaining: 100 },
    duration_ms: 1
  };
  await writeFile(join(latestDir, 'global-contributors.json'), JSON.stringify(previousGlobal));
  await writeFile(join(latestDir, 'manifest.json'), JSON.stringify(existingManifest));

  try {
    const generatedAt = '2026-09-16T00:00:00.000Z';
    const manifest = await writeSnapshots([globalSnapshot(generatedAt)], {
      root,
      latestDir,
      historyDir,
      runDir,
      generatedAt,
      method: 'test-global-refresh',
      mode: 'live',
      durationMs: 2,
      mergeExistingManifest: true
    });

    assert.equal(manifest.completed_shards.length, 2);
    assert.equal(manifest.completed_shards.find((shard) => shard.kind === 'global')?.generated_at, generatedAt);
    assert.equal(manifest.completed_shards.find((shard) => shard.kind === 'country')?.slug, 'australia');
    assert.deepEqual(manifest.stale_pages, ['australia']);

    const written = JSON.parse(await readFile(join(latestDir, 'manifest.json'), 'utf8')) as Manifest;
    assert.deepEqual(written.completed_shards, manifest.completed_shards);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
