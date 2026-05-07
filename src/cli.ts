#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { collectLiveSnapshots } from './lib/github.js';
import { rankContributors, rankProjects } from './lib/ranking.js';
import { writeSnapshots } from './lib/snapshots.js';
import type { RankedContributor, RankedProject, RankingSnapshot } from './lib/types.js';

interface CliOptions {
  command: string;
  kind?: string;
  input?: string;
  output?: string;
  limit: number;
  format: 'json' | 'table';
  mode: 'fixture' | 'live';
  token?: string;
  maxCountries?: number;
}

function usage(): string {
  return `OSSRank CLI

Usage:
  ossrank rank contributors --input fixtures/contributors.json --output out.json
  ossrank rank projects --input fixtures/projects.json --format table
  ossrank refresh --mode live --limit 20
  ossrank token-check

Options:
  --input <path>        JSON array, or snapshot JSON with entries
  --output <path>       Write result JSON to a file instead of stdout
  --limit <number>      Limit rows/candidates per shard (default: 50)
  --format <json|table> Output format (default: json)
  --mode <fixture|live> Refresh mode (default: live for refresh)
  --token <token>       GitHub token; defaults to OSSRANK_GITHUB_TOKEN or GITHUB_TOKEN
  --max-countries <n>   Refresh only the first n configured countries

Live mode uses GitHub REST search with conservative limits and writes the same
OSSRank data/latest snapshot contract used by the static website.
`;
}

function parseArgs(argv: string[]): CliOptions {
  const command = argv[0] ?? 'help';
  const kind = argv[1]?.startsWith('-') ? undefined : argv[1];
  const rest = argv.slice(kind ? 2 : 1);
  const options: CliOptions = { command, kind, limit: 50, format: 'json', mode: 'live' };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const value = rest[index + 1];
    if (arg === '--input') { options.input = value; index += 1; continue; }
    if (arg === '--output') { options.output = value; index += 1; continue; }
    if (arg === '--limit') { options.limit = Number(value); index += 1; continue; }
    if (arg === '--format') { options.format = value === 'table' ? 'table' : 'json'; index += 1; continue; }
    if (arg === '--mode') { options.mode = value === 'fixture' ? 'fixture' : 'live'; index += 1; continue; }
    if (arg === '--token') { options.token = value; index += 1; continue; }
    if (arg === '--max-countries') { options.maxCountries = Number(value); index += 1; continue; }
    if (arg === '--help' || arg === '-h') options.command = 'help';
  }
  return options;
}

async function readEntries<T>(path: string): Promise<T[]> {
  const payload = JSON.parse(await readFile(path, 'utf8')) as T[] | RankingSnapshot<T>;
  return Array.isArray(payload) ? payload : payload.entries;
}

function table(entries: Array<Record<string, unknown>>): string {
  return entries.map((entry) => {
    const label = entry.login ?? entry.full_name ?? 'unknown';
    const signal = entry.public_contributions ?? entry.pull_requests_merged_7d ?? 0;
    return `${entry.rank}\t${label}\t${signal}`;
  }).join('\n') + '\n';
}

async function emit(data: unknown, options: CliOptions): Promise<void> {
  const text = options.format === 'table' && Array.isArray(data)
    ? table(data as Array<Record<string, unknown>>)
    : JSON.stringify(data, null, 2) + '\n';
  if (options.output) {
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, text);
  } else {
    process.stdout.write(text);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help') {
    process.stdout.write(usage());
    return;
  }

  if (options.command === 'token-check') {
    const token = options.token ?? process.env.OSSRANK_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
    await emit({ ok: Boolean(token), provider: 'github', mode: token ? 'token-present' : 'missing-token' }, options);
    process.exitCode = token ? 0 : 2;
    return;
  }

  if (options.command === 'refresh') {
    if (options.mode === 'fixture') {
      process.stderr.write('Use pnpm run refresh:fixtures for fixture refreshes.\n');
      process.exitCode = 1;
      return;
    }
    const started = Date.now();
    const token = options.token ?? process.env.OSSRANK_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
    const { snapshots, remaining } = await collectLiveSnapshots({ token, limit: options.limit, maxCountries: options.maxCountries });
    const manifest = await writeSnapshots(snapshots, { method: 'github-live-refresh', mode: 'live', durationMs: Date.now() - started, remaining });
    await emit(manifest, options);
    return;
  }

  if (options.command !== 'rank' || !options.kind || !options.input) {
    process.stderr.write(usage());
    process.exitCode = 1;
    return;
  }

  if (options.kind === 'contributors') {
    const ranked = rankContributors(await readEntries<Omit<RankedContributor, 'rank'>>(options.input));
    await emit(ranked.slice(0, options.limit), options);
    return;
  }

  if (options.kind === 'projects') {
    const ranked = rankProjects(await readEntries<Omit<RankedProject, 'rank'>>(options.input));
    await emit(ranked.slice(0, options.limit), options);
    return;
  }

  process.stderr.write(`Unknown rank kind: ${options.kind}\n`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
