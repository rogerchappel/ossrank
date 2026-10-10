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
  'single504', 'partial504', 'missing', 'rateRecovery', 'rate429', 'rate403', 'rateGraphql', 'forbidden', 'invalid', 'transport', 'decodeRecovery', 'streamRecovery', 'nullEnvelope', 'badEnvelope'] as const) {
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
      if (scenario === 'decodeRecovery' && batches.length === 1) return new Response('{"data":' + secret, { headers });
      if (scenario === 'streamRecovery' && batches.length === 1) return new Response(new ReadableStream({
        start(controller) { controller.error(new TypeError(secret)); }
      }), { headers });
      if (scenario === 'nullEnvelope') return Response.json(null, { headers });
      if (scenario === 'badEnvelope') return Response.json({ errors: { message: secret } }, { headers });
      if (scenario === 'invalid') return new Response(secret, { headers });
      if (scenario === 'transport') throw new Error(secret);
      return success(batch);
    });
    const run = collectLiveSnapshots({ token: secret, generatedAt, limit: 5, scope: 'global', saveDir: { latestDir, historyDir: join(root, 'history') } });
    const fails = ['single504', 'partial504', 'missing', 'rate429', 'rate403', 'rateGraphql', 'forbidden', 'invalid', 'transport', 'nullEnvelope', 'badEnvelope'].includes(scenario);
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
    if (scenario === 'single504') assert.deepEqual(batches.map(batch => batch.length), [5, 5, 5, 3, 3, 3, 2, 2, 2, ...Array(12).fill(1)]);
    if ((scenario.startsWith('rate') && scenario !== 'rateRecovery') || scenario === 'transport') {
      assert.equal(batches.length, 3);
      assert.ok(batches.every(batch => batch.length === 5));
    }
    if (scenario === 'forbidden' || scenario === 'nullEnvelope' || scenario === 'badEnvelope') assert.equal(batches.length, 1);
    if (scenario === 'invalid') assert.equal(batches.length, 3);
    if (scenario === 'decodeRecovery' || scenario === 'streamRecovery') assert.equal(batches.length, 2);
    assert.equal(await readFile(snapshotPath, 'utf8'), previous);
    assert.ok(delays.every(delay => delay <= 60_000));
    assert.ok(!logs.join('').includes(secret));
    const events = logs.filter(line => line.startsWith('[github]')).map(line => JSON.parse(line.slice(9)));
    const requests = events.filter(event => event.event === 'request');
    assert.equal(requests.length, batches.length + (fails ? 0 : 2));
    if (scenario === 'invalid' || scenario === 'decodeRecovery' || scenario === 'streamRecovery') {
      assert.equal(requests[0].outcome, 'response_decode');
      assert.equal(requests[0].stage, 'body_decode');
      assert.equal(requests[0].failureReason, scenario === 'streamRecovery' ? 'body_read' : 'json_syntax');
      assert.equal(requests[0].requestId, 'request-123');
      assert.equal(requests[0].retry, true);
    }
    if (scenario === 'invalid') {
      assert.equal(requests[2].retry, false);
      assert.equal(requests[2].delayMs, 0);
      assert.ok(!events.some(event => event.event === 'split'));
    }
    if (scenario === 'nullEnvelope' || scenario === 'badEnvelope') {
      assert.equal(requests[0].outcome, 'invalid_response');
      assert.equal(requests[0].failureReason, 'invalid_envelope');
    }
    assert.ok(requests.every(event => typeof event.durationMs === 'number' && event.attempt >= 1 && event.operation));
    if (scenario.startsWith('transient') || scenario.startsWith('split')) assert.equal(requests[0].requestId, 'request-123');
  });
}

for (const scenario of ['windowResource', 'windowGateway', 'windowExhausted', 'overlapFailure', 'badOverlap', 'badCount', 'windowRateLimit'] as const) {
  test(`single-user window recovery: ${scenario}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'ossrank-window-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const latestDir = join(root, 'latest');
    await mkdir(latestDir);
    const snapshotPath = join(latestDir, 'global-contributors.json');
    const previous = JSON.stringify({ entries: [{ login: 'colinhacks' }] });
    await writeFile(snapshotPath, previous);
    // Preserve arbitrary outer timestamps, including leap day and milliseconds.
    const to = '2024-03-01T12:34:56.789Z';
    const end = Date.parse(to);
    const start = end - 365 * 86_400_000;
    const day = 86_400_000;
    const eventTimes = new Set<number>([start, end, Date.parse('2024-02-29T00:00:00.000Z')]);
    function addBoundaryEvents(a: number, b: number, depth: number) {
      if (depth === 3) return;
      const middle = Math.floor((a + b) / 2);
      for (const boundary of [middle - day / 2, middle + day / 2]) {
        for (const delta of [-1, 0, 1]) eventTimes.add(boundary + delta);
      }
      addBoundaryEvents(a, middle + day / 2, depth + 1);
      addBoundaryEvents(middle - day / 2, b, depth + 1);
    }
    addBoundaryEvents(start, end, 0);
    // Different contributions to the SAME repository across windows count as
    // separate events. The profile repository total must not be summed.
    const events = [...eventTimes].sort((a, b) => a - b).map((time, i) => ({
      time, repository: 'same/repo', commits: i % 4 + 1, prs: i % 2
    }));
    const calls: Array<{ from: number; to: number }> = [];
    const logs: string[] = [];
    t.mock.method(globalThis, 'setTimeout', (callback: () => void) => { queueMicrotask(callback); return 0; });
    t.mock.method(process.stderr, 'write', (chunk: string) => { logs.push(chunk); return true; });
    t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(init.body as string);
      if (query.includes('OssrankUserSearch')) return Response.json({ data: { search: { userCount: 0, nodes: [] } } });
      const from = Date.parse(variables.from);
      const toMs = Date.parse(variables.to);
      calls.push({ from, to: toMs });
      const width = toMs - from;
      if (scenario === 'windowRateLimit' && width < end - start) return new Response('', { status: 429, headers: { 'retry-after': '1' } });
      if (width > 50 * day || scenario === 'windowExhausted' || (scenario === 'overlapFailure' && width === day)) {
        if (scenario === 'windowGateway') return new Response('gateway body omitted', { status: 504 });
        // Structured type works independently of the legacy English message;
        // deliberately supplied partial data must never be accepted.
        return Response.json({ data: { u0: { login: 'colinhacks' } }, errors: [{ type: 'RESOURCE_LIMITS_EXCEEDED', message: 'resource exhausted' }] });
      }
      const included = events.filter(event => event.time >= from && event.time <= toMs);
      const body = await success(['colinhacks']).json();
      body.data.u0.contributionsCollection = {
        totalCommitContributions: included.reduce((sum, event) => sum + event.commits, 0),
        totalPullRequestContributions: included.reduce((sum, event) => sum + event.prs, 0)
      };
      if (scenario === 'badOverlap' && width === day) body.data.u0.contributionsCollection.totalCommitContributions = 1_000_000;
      if (scenario === 'badCount') body.data.u0.contributionsCollection.totalPullRequestContributions = null;
      return Response.json(body);
    });
    const run = collectLiveSnapshots({ token: secret, generatedAt: to, limit: 1, scope: 'global', saveDir: { latestDir, historyDir: join(root, 'history') } });
    if (scenario === 'windowResource' || scenario === 'windowGateway') {
      const result = await run;
      const entry = result.snapshots[0].entries[0] as Record<string, unknown>;
      assert.equal(entry.observed_public_commits, events.reduce((sum, event) => sum + event.commits, 0));
      assert.equal(entry.observed_public_pull_requests, events.reduce((sum, event) => sum + event.prs, 0));
      assert.equal(entry.public_repos, 10);
      assert.equal(entry.public_gists, 2);
      assert.equal(entry.followers, 30);
      assert.equal(calls.length, scenario === 'windowResource' ? 22 : 36);
      assert.equal(Math.min(...calls.map(call => call.from)), start);
      assert.equal(Math.max(...calls.map(call => call.to)), end);
      assert.equal(calls.filter(call => call.to - call.from === day).length, 7);
    } else {
      await assert.rejects(run);
      assert.ok(calls.length <= 22);
      if (scenario === 'windowExhausted') assert.equal(calls.length, 4);
      if (scenario === 'windowRateLimit') assert.equal(calls.length, 4);
    }
    assert.equal(await readFile(snapshotPath, 'utf8'), previous);
    assert.ok(!logs.join('').includes(secret));
    const requests = logs.filter(line => line.startsWith('[github]')).map(line => JSON.parse(line.slice(9)));
    assert.ok(requests.some(event => event.event === 'split_window'));
    assert.ok(requests.filter(event => event.event === 'request' && event.operation === 'OssrankUserActivityBatch').every(event => event.window.from && event.window.to));
  });
}
