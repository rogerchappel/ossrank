import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { addDays } from './freshness.js';
import type { Manifest, ManifestShard, RankedContributor, RankingSnapshot } from './types.js';

export interface SnapshotWriteOptions {
  root?: string;
  latestDir?: string;
  historyDir?: string;
  runDir?: string;
  generatedAt?: string;
  method: string;
  mode: 'fixture' | 'live';
  durationMs: number;
  remaining?: number;
  failedShards?: Array<{ slug: string; reason: string }>;
}

export function sourceCommit(root = process.cwd()): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'uncommitted';
  }
}

export function shardFilename(snapshot: RankingSnapshot<unknown>): string {
  const prefix = snapshot.kind === 'country' ? 'countries' : snapshot.kind === 'global' ? 'global' : snapshot.kind === 'language' ? 'languages' : snapshot.kind === 'category' ? 'categories' : snapshot.kind === 'rising' ? 'rising' : snapshot.kind === 'momentum' ? 'momentum' : 'projects';
  return `${prefix}-${snapshot.slug}.json`;
}

function isContributorSnapshot(snapshot: RankingSnapshot<unknown>): snapshot is RankingSnapshot<RankedContributor> {
  return (snapshot.kind === 'global' || snapshot.kind === 'country' || snapshot.kind === 'rising') && snapshot.entries.every((entry) => typeof (entry as Partial<RankedContributor>).login === 'string');
}

function isBeforeRun(snapshot: RankingSnapshot<RankedContributor>, currentRunId: string): boolean {
  return snapshot.generated_at.slice(0, 10) < currentRunId;
}

async function readPreviousSnapshot(filename: string, latestDir: string, historyDir: string, currentRunId: string): Promise<RankingSnapshot<RankedContributor> | undefined> {
  try {
    const latest = JSON.parse(await readFile(join(latestDir, filename), 'utf8')) as RankingSnapshot<RankedContributor>;
    if (isBeforeRun(latest, currentRunId)) return latest;
  } catch {
    // Fall back to dated history when latest is unavailable, e.g. a fresh checkout
    // with only archived runs present.
  }

  try {
    const runIds = (await readdir(historyDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));
    for (const runId of runIds) {
      if (runId >= currentRunId) continue;
      try {
        const snapshot = JSON.parse(await readFile(join(historyDir, runId, filename), 'utf8')) as RankingSnapshot<RankedContributor>;
        if (isBeforeRun(snapshot, currentRunId)) return snapshot;
      } catch {
        // Keep walking backwards until a shard for this board exists.
      }
    }
  } catch {
    // No history yet. New boards should simply render without movement.
  }
  return undefined;
}

async function addPreviousContributorRanks(snapshot: RankingSnapshot<unknown>, latestDir: string, historyDir: string, currentRunId: string): Promise<RankingSnapshot<unknown>> {
  if (!isContributorSnapshot(snapshot)) return snapshot;
  const previous = await readPreviousSnapshot(shardFilename(snapshot), latestDir, historyDir, currentRunId);
  if (!previous?.entries?.length) return snapshot;

  const previousRanks = new Map(previous.entries.map((entry) => [entry.login.toLowerCase(), entry.rank]));
  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) => ({
      ...entry,
      previous_rank: previousRanks.get(entry.login.toLowerCase())
    }))
  };
}

export async function writeSnapshots(snapshots: RankingSnapshot<unknown>[], options: SnapshotWriteOptions): Promise<Manifest> {
  const root = options.root ?? process.cwd();
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const runId = generatedAt.slice(0, 10);
  const latestDir = options.latestDir ?? join(root, 'data/latest');
  const runDir = options.runDir ?? join(root, 'data/runs', runId);
  const historyDir = options.historyDir ?? join(root, 'data/history');

  await mkdir(latestDir, { recursive: true });
  await mkdir(runDir, { recursive: true });
  await mkdir(historyDir, { recursive: true });

  const snapshotsWithMovement = await Promise.all(snapshots.map((snapshot) => addPreviousContributorRanks(snapshot, latestDir, historyDir, runId)));

  const completed: ManifestShard[] = [];
  for (const snapshot of snapshotsWithMovement) {
    const filename = shardFilename(snapshot);
    const pretty = JSON.stringify(snapshot, null, 2) + '\n';
    await writeFile(join(latestDir, filename), pretty);
    await writeFile(join(runDir, filename), pretty);
    completed.push({
      kind: snapshot.kind,
      slug: snapshot.slug,
      title: snapshot.title,
      path: `/data/latest/${filename}`,
      status: snapshot.status,
      generated_at: snapshot.generated_at,
      fresh_until: snapshot.fresh_until,
      entries: snapshot.entries.length
    });
  }

  const stalePages = snapshotsWithMovement.filter((snapshot) => snapshot.status === 'stale' || snapshot.status === 'failed').map((snapshot) => snapshot.slug);
  const manifest: Manifest = {
    generated_at: generatedAt,
    source_commit: sourceCommit(root),
    method: options.method,
    status: options.failedShards?.length ? 'failed' : options.mode === 'live' ? 'fresh' : 'demo',
    completed_shards: completed,
    failed_shards: options.failedShards ?? [],
    stale_pages: stalePages,
    api_budget: { provider: 'github', mode: options.mode, remaining: options.remaining },
    duration_ms: options.durationMs
  };

  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(join(latestDir, 'manifest.json'), manifestJson);
  await writeFile(join(runDir, 'manifest.json'), manifestJson);
  await cp(latestDir, join(historyDir, runId), { recursive: true, force: true });
  return manifest;
}

export function snapshotBase(kind: RankingSnapshot<unknown>['kind'], slug: string, name: string, title: string, generatedAt: string, status: RankingSnapshot<unknown>['status'], method: string): Pick<RankingSnapshot<unknown>, 'kind' | 'slug' | 'name' | 'title' | 'generated_at' | 'fresh_until' | 'status' | 'method' | 'source_run' | 'history'> {
  const runId = generatedAt.slice(0, 10);
  return {
    kind,
    slug,
    name,
    title,
    generated_at: generatedAt,
    fresh_until: addDays(new Date(generatedAt), 7),
    status,
    method,
    source_run: runId,
    history: { weeks: [runId], ranked_items: [0], top_10_signal: [0] }
  };
}
