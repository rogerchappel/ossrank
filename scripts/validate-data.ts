import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest, RankingSnapshot } from '../src/lib/types.js';

const dataDir = process.argv[2] ?? 'data/latest';
const errors: string[] = [];

function assert(condition: unknown, message: string): void {
  if (!condition) errors.push(message);
}

function isIso(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

const manifest = JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8')) as Manifest;
assert(isIso(manifest.generated_at), 'manifest.generated_at must be ISO');
assert(Array.isArray(manifest.completed_shards), 'manifest.completed_shards must be an array');
assert(manifest.completed_shards.length > 0, 'manifest must include at least one completed shard');

for (const shard of manifest.completed_shards) {
  const filename = shard.path.replace('/data/latest/', '');
  const snapshot = JSON.parse(await readFile(join(dataDir, filename), 'utf8')) as RankingSnapshot<{ rank: number; login?: string; full_name?: string }>;
  assert(snapshot.kind === shard.kind, `${filename}: kind must match manifest`);
  assert(snapshot.slug === shard.slug, `${filename}: slug must match manifest`);
  assert(isIso(snapshot.generated_at), `${filename}: generated_at must be ISO`);
  assert(isIso(snapshot.fresh_until), `${filename}: fresh_until must be ISO`);
  assert(snapshot.entries.length === shard.entries, `${filename}: entry count must match manifest`);
  assert(snapshot.caveats.length > 0, `${filename}: caveats are required`);
  const seen = new Set<string>();
  snapshot.entries.forEach((entry, index) => {
    assert(entry.rank === index + 1, `${filename}: rank ${entry.rank} should equal row ${index + 1}`);
    const key = entry.login ?? entry.full_name;
    assert(key, `${filename}: entry ${index + 1} needs login or full_name`);
    if (key) {
      assert(!seen.has(key), `${filename}: duplicate entry ${key}`);
      seen.add(key);
    }
  });
}

const files = await readdir(dataDir);
assert(files.includes('manifest.json'), 'manifest.json must exist');

if (errors.length > 0) {
  console.error(errors.map((error) => `FAIL: ${error}`).join('\n'));
  process.exit(1);
}
console.log(`Validated ${manifest.completed_shards.length} shards from ${dataDir}`);
