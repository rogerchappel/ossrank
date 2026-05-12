#!/usr/bin/env node
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  requireGraphqlSearch: boolean;
}

function usage(): string {
  return `OSSRank CLI

Usage:
  ossrank rank contributors --input fixtures/contributors.json --output out.json
  ossrank rank projects --input fixtures/projects.json --format table
  ossrank refresh --mode live --limit 20
  ossrank token-check
  ossrank token-check --require-graphql-search

Options:
  --input <path>        JSON array, or snapshot JSON with entries
  --output <path>       Write result JSON to a file instead of stdout
  --limit <number>      Limit rows/candidates per shard (default: 50)
  --format <json|table> Output format (default: json)
  --mode <fixture|live> Refresh mode (default: live for refresh)
  --token <token>       GitHub token; defaults to OSSRANK_GITHUB_TOKEN or GITHUB_TOKEN
  --max-countries <n>   Refresh only the first n configured countries
  --require-graphql-search  Validate that the token can run the GraphQL user search used by live refresh

Live mode uses GitHub REST and GraphQL APIs with conservative limits and writes
the same OSSRank data/latest snapshot contract used by the static website.
`;
}

function parseArgs(argv: string[]): CliOptions {
  const command = argv[0] ?? 'help';
  const kind = argv[1]?.startsWith('-') ? undefined : argv[1];
  const rest = argv.slice(kind ? 2 : 1);
  const options: CliOptions = { command, kind, limit: 50, format: 'json', mode: 'live', requireGraphqlSearch: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const value = rest[index + 1];
    if (arg === '--input') { options.input = value; index += 1; continue; }
    if (arg === '--output') { options.output = value; index += 1; continue; }
    if (arg === '--limit') { options.limit = parsePositiveInteger(value, '--limit'); index += 1; continue; }
    if (arg === '--format') { options.format = parseChoice(value, '--format', ['json', 'table']); index += 1; continue; }
    if (arg === '--mode') { options.mode = parseChoice(value, '--mode', ['fixture', 'live']); index += 1; continue; }
    if (arg === '--token') { options.token = value; index += 1; continue; }
    if (arg === '--max-countries') { options.maxCountries = parsePositiveInteger(value, '--max-countries'); index += 1; continue; }
    if (arg === '--require-graphql-search') { options.requireGraphqlSearch = true; continue; }
    if (arg === '--help' || arg === '-h') options.command = 'help';
  }
  return options;
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseChoice<T extends string>(value: string | undefined, flag: string, choices: readonly T[]): T {
  if (choices.includes(value as T)) return value as T;
  throw new Error(`${flag} must be one of: ${choices.join(', ')}`);
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

async function validateGraphqlSearchToken(token: string): Promise<void> {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ossrank/0.1.0',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      query: `query OssrankTokenCheck($query: String!) {
        search(type: USER, query: $query, first: 1) { userCount }
        rateLimit { remaining cost }
      }`,
      variables: { query: 'type:user repos:>0' }
    })
  });
  const body = await response.json() as { errors?: Array<{ message: string }>; data?: unknown };
  if (!response.ok || body.errors?.length) {
    const message = body.errors?.map((error) => error.message).join('; ') ?? response.statusText;
    throw new Error(`GitHub token cannot run OSSRank GraphQL search: ${message}`);
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
    if (!token) {
      await emit({ ok: false, provider: 'github', mode: 'missing-token', message: 'Set OSSRANK_GITHUB_TOKEN to a GitHub PAT for live refreshes.' }, options);
      process.exitCode = 2;
      return;
    }
    if (options.requireGraphqlSearch) {
      await validateGraphqlSearchToken(token);
    }
    await emit({ ok: true, provider: 'github', mode: options.requireGraphqlSearch ? 'graphql-search-access' : 'token-present' }, options);
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
    // Incremental save setup — country results are saved immediately so a
    // crash/interruption doesn't lose hours of work. Re-run resumes where left off.
    const root = process.cwd();
    const { snapshots, remaining } = await collectLiveSnapshots({ token, limit: options.limit, maxCountries: options.maxCountries, saveDir: { latestDir: join(root, 'data/latest'), historyDir: join(root, 'data/history') } });
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
