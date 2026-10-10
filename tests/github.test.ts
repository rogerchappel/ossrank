import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectLiveSnapshots } from '../src/lib/github.js';

const logins = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
const generatedAt = '2026-10-10T00:00:00.000Z';
const secret = 'test-secret-must-not-appear';
function success(batch: string[]) {
  return Response.json({ data: Object.fromEntries(batch.map((login, i) => [`u${i}`, {
    login, name: login, url: `https://github.com/${login}`, location: null,
    repositories: { totalCount: 10 }, gists: { totalCount: 2 }, followers: { totalCount: 30 },
    contributionsCollection: { totalCommitContributions: 100, totalPullRequestContributions: 5 }
  }])) });
}

for (const scenario of ['transient502', 'transient504', 'split502', 'split504', 'split503', 'resource',
  'single504', 'partial504', 'missing', 'rateRecovery', 'rate429', 'rate403', 'rateGraphql', 'forbidden', 'invalid', 'transport'] as const) {
  test(`live collection: ${scenario}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'ossrank-github-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const latestDir = join(root, 'latest');
    await mkdir(latestDir);
    const previous = JSON.stringify({ entries: logins.map(login => ({ login })) });
    const snapshotPath = join(latestDir, 'global-contributors.json');
    await writeFile(snapshotPath, previous);
    const batches: string[][] = [];
    const delays: number[] = [];
    const logs: string[] = [];
    t.mock.method(globalThis, 'setTimeout', (callback: () => void, ms: number) => {
      delays.push(ms);
      queueMicrotask(callback);
      return 0;
    });
    t.mock.method(process.stderr, 'write', (chunk: string) => { logs.push(chunk); return true; });
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(init.body as string);
      if (query.includes('OssrankUserSearch')) return Response.json({ data: { search: { userCount: 0, nodes: [] } } });
      const batch = Object.entries(variables).filter(([key]) => /^login\d+$/.test(key)).map(([, value]) => value as string);
      batches.push(batch);
      const headers = { 'x-github-request-id': 'request-123' };
      if (scenario.startsWith('transient') && batches.length === 1) return new Response('<html>bad gateway</html>', { status: Number(scenario.slice(-3)), headers });
      if (scenario.startsWith('split') && batch.length > 1) return new Response(secret, { status: Number(scenario.slice(-3)), headers });
      if (scenario === 'missing') return Response.json({ data: { u0: null } });
      if (scenario === 'partial504' && (batch.length > 1 || batch[0] === 'echo')) return new Response(secret, { status: 504, headers });
      if (scenario === 'rateRecovery' && batches.length === 1) return new Response(secret, { status: 429, headers: { ...headers, 'retry-after': '1' } });
      if (scenario === 'single504') return new Response(secret, { status: 504, headers });
      if (scenario === 'resource' && batch.length > 1) return Response.json({ data: { u0: {} }, errors: [{ message: 'Resource limits for this query exceeded' }] }, { headers });
      if (scenario === 'rate429' || scenario === 'rate403') return new Response(secret, { status: Number(scenario.slice(-3)), headers: { ...headers, 'retry-after': '99999999' } });
      if (scenario === 'rateGraphql') return Response.json({ errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }, { headers: { ...headers, 'retry-after': 'invalid' } });
      if (scenario === 'forbidden') return new Response(secret, { status: 403, headers });
      if (scenario === 'invalid') return new Response(secret, { headers });
      if (scenario === 'transport') throw new Error(secret);
      return success(batch);
    });
    const run = collectLiveSnapshots({ token: secret, generatedAt, limit: 5, scope: 'global', saveDir: { latestDir, historyDir: join(root, 'history') } });
    const fails = ['single504', 'partial504', 'missing', 'rate429', 'rate403', 'rateGraphql', 'forbidden', 'invalid', 'transport'].includes(scenario);
    if (fails) await assert.rejects(run, error => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    });
    else {
      const result = await run;
      assert.deepEqual(result.snapshots[0].entries.map(entry => (entry as { login: string }).login).sort(), logins);
      if (scenario.startsWith('transient')) assert.equal(batches.length, 2);
      if (scenario.startsWith('split')) assert.equal(batches.length, 17); // four internal nodes * three attempts + five leaves
      if (scenario === 'resource') assert.equal(batches.length, 9);
    }
    if (scenario === 'single504') assert.deepEqual(batches.map(batch => batch.length), [5, 5, 5, 3, 3, 3, 2, 2, 2, 1, 1, 1]);
    if ((scenario.startsWith('rate') && scenario !== 'rateRecovery') || scenario === 'transport') {
      assert.equal(batches.length, 3);
      assert.ok(batches.every(batch => batch.length === 5));
    }
    if (scenario === 'forbidden' || scenario === 'invalid') assert.equal(batches.length, 1);
    assert.equal(await readFile(snapshotPath, 'utf8'), previous);
    assert.ok(delays.every(delay => delay <= 60_000));
    assert.ok(!logs.join('').includes(secret));
    const events = logs.filter(line => line.startsWith('[github]')).map(line => JSON.parse(line.slice(9)));
    const requests = events.filter(event => event.event === 'request');
    assert.equal(requests.length, batches.length + (fails ? 0 : 2));
    assert.ok(requests.every(event => typeof event.durationMs === 'number' && event.attempt >= 1 && event.operation));
    if (scenario.startsWith('transient') || scenario.startsWith('split')) assert.equal(requests[0].requestId, 'request-123');
  });
}
