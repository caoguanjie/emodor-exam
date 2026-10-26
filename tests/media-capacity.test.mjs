import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimateCapacity, main, runCapacity } from './performance/media-capacity.mjs';

const fixtureNow = 1700000000000;
const cosOrigin = 'https://unusable-fixture-1234567890.cos.ap-guangzhou.myqcloud.com';
const cosPrefix = 'ruleexam/test/media/';
const capacityOptions = { profile: 'exam', users: 1, durationSeconds: 0.1 };

// Deliberately unusable signature: tests exercise local validation and never contact COS.
function signedFixture({ key = `${cosPrefix}fixture/video.mp4`, query = {}, origin = cosOrigin } = {}) {
  return `${origin}/${key}?${new URLSearchParams({
    'response-cache-control': 'private, no-store', versionId: 'null',
    'q-sign-algorithm': 'sha1', 'q-ak': 'UnusableCosFixtureAk',
    'q-sign-time': '1699999999;1700000120', 'q-key-time': '1699999999;1700000120',
    'q-header-list': 'host', 'q-url-param-list': 'response-cache-control;versionid',
    'q-signature': '0000000000000000000000000000000000000000', ...query,
  })}`;
}

function cosScenario(steps = [{ url: signedFixture() }], overrides = {}) {
  return { environment: 'test', baseUrl: 'http://127.0.0.1:1', cosMediaOrigin: cosOrigin, cosMediaPrefix: cosPrefix,
    users: [{ steps }], ...overrides };
}

test('capacity planning distinguishes online users from heartbeat requests and does not send traffic', () => {
  const plan = estimateCapacity({ profile: 'heartbeat', users: 3000, durationSeconds: 60 });
  assert.equal(plan.estimatedRequests, 6000);
  assert.equal(plan.estimatedRequestsPerSecond, 100);
  assert.equal(plan.executed, false);
});

test('capacity runner refuses a production label before any HTTP request', async () => {
  let calls = 0;
  await assert.rejects(runCapacity({ profile: 'authz', users: 1, durationSeconds: 1 }, {
    environment: 'production', baseUrl: 'http://127.0.0.1:1', users: [{ steps: [{ path: '/api/v1/media/tickets/batch', method: 'POST' }] }],
  }, { fetchImpl: async () => { calls++; } }), /测试环境/);
  assert.equal(calls, 0);
});

test('generator deadline cancellation is reported separately from a service error', async () => {
  const report = await runCapacity({ profile: 'exam', users: 1, durationSeconds: 0.02 }, {
    environment: 'test', baseUrl: 'http://127.0.0.1:1', users: [{ steps: [{ path: '/api/v1/media' }] }],
  }, { fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('test deadline')), { once: true });
  }) });
  assert.equal(report.attemptedRequests, 1);
  assert.equal(report.completedRequests, 0);
  assert.equal(report.deadlineAbortedRequests, 1);
  assert.equal(report.errorRequests, 0);
});

test('capacity measurement counts streamed bytes and errors without reporting private request inputs', async (t) => {
  const server = createServer((req, res) => {
    res.statusCode = req.url === '/api/v1/ok' ? 200 : 503;
    res.end('12345678');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const secret = 'unusable-private-fixture';
  const report = await runCapacity({ profile: 'exam', users: 2, durationSeconds: 0.1 }, {
    environment: 'test', baseUrl: `http://127.0.0.1:${server.address().port}`,
    users: [{ steps: [{ path: '/api/v1/ok', headers: { Authorization: secret } }] },
      { steps: [{ path: '/api/v1/error', headers: { Authorization: secret } }] }],
  });
  assert.equal(report.completedRequests, 2);
  assert.equal(report.errorRequests, 1);
  assert.equal(report.responseBytes, 16);
  assert.equal(report.activeUsers, 2);
  assert.ok(report.peakInFlight >= 1);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(JSON.stringify(report).includes('/api/v1/ok'), false);
});

test('COS capacity steps stream exact GET bytes alongside HEAD and existing API steps without leaking signed inputs', async () => {
  const signedUrl = signedFixture({ query: { 'x-cos-security-token': 'unusable-temporary-fixture' } });
  const calls = [];
  const report = await runCapacity(capacityOptions, cosScenario([
    { path: '/api/v1/media/tickets/batch', method: 'POST', headers: { Authorization: 'unusable-api-fixture' }, body: { asset_ids: [1] } },
    { url: signedUrl, headers: { Range: 'bytes=0-7' } },
    { url: signedFixture(), method: 'HEAD' },
  ]), { nowMs: () => fixtureNow, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.redirect, 'error');
    if (init.method === 'POST') return new Response('ok');
    if (init.method === 'HEAD') return new Response(null);
    assert.equal(init.headers.Range, 'bytes=0-7');
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6, 7, 8]));
      controller.close();
    } }), { status: 206 });
  } });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, signedUrl);
  assert.equal(calls[0].init.body, '{"asset_ids":[1]}');
  assert.equal(report.responseBytes, 10);
  assert.equal(report.completedRequests, 3);
  assert.equal(report.errorRequests, 0);
  assert.deepEqual(report.statuses, { 200: 2, 206: 1 });
  const output = JSON.stringify(report);
  for (const privateValue of [signedUrl, cosOrigin, '0000000000000000000000000000000000000000', 'unusable-api-fixture', 'unusable-temporary-fixture']) {
    assert.equal(output.includes(privateValue), false);
  }
});

test('COS targets and all later steps are checked before any API or COS request', async (t) => {
  const invalid = [
    ['missing origin', { cosMediaOrigin: undefined }],
    ['HTTP origin', { cosMediaOrigin: cosOrigin.replace('https:', 'http:') }],
    ['nonstandard origin', { cosMediaOrigin: 'https://cdn.test.example.com' }],
    ['origin userinfo', { cosMediaOrigin: cosOrigin.replace('https://', 'https://user:pass@') }],
    ['origin query', { cosMediaOrigin: `${cosOrigin}?token=fixture` }],
    ['bucket root prefix', { cosMediaPrefix: '' }],
    ['production prefix', { cosMediaPrefix: 'ruleexam/prod/media/' }],
    ['identity prefix', { cosMediaPrefix: 'ruleexam/test/identity/' }],
    ['upload prefix', { cosMediaPrefix: 'ruleexam/test/staging/' }],
    ['unbounded prefix', { cosMediaPrefix: 'ruleexam/test/media' }],
    ['other origin', {}, signedFixture({ origin: 'https://other-fixture-1234567890.cos.ap-guangzhou.myqcloud.com' })],
    ['other prefix', {}, signedFixture({ key: 'ruleexam/dev/media/video.mp4' })],
    ['identity object', {}, signedFixture({ key: 'ruleexam/test/identity/video.mp4' })],
    ['upload object', {}, signedFixture({ key: 'ruleexam/test/staging/video.mp4' })],
    ['identity nested object', {}, signedFixture({ key: `${cosPrefix}identity/video.mp4` })],
    ['dot traversal', {}, signedFixture({ key: `${cosPrefix}../media/video.mp4` })],
    ['encoded traversal', {}, signedFixture({ key: `${cosPrefix}%2e%2e/media/video.mp4` })],
    ['encoded slash', {}, signedFixture({ key: `${cosPrefix}fixture%2fvideo.mp4` })],
    ['double encoded slash', {}, signedFixture({ key: `${cosPrefix}fixture%252fvideo.mp4` })],
    ['URL userinfo', {}, signedFixture().replace('https://', 'https://user:pass@')],
    ['URL fragment', {}, `${signedFixture()}#fragment`],
    ['ambiguous API and COS step', {}, signedFixture(), { path: '/api/v1/media' }],
  ];
  for (const [name, overrides, url = signedFixture(), extra = {}] of invalid) await t.test(name, async () => {
    let calls = 0;
    await assert.rejects(runCapacity(capacityOptions, cosScenario([
      { path: '/api/v1/media' }, { url, ...extra },
    ], overrides), { nowMs: () => fixtureNow, fetchImpl: async () => { calls++; return new Response(); } }), /COS|媒体|请求/);
    assert.equal(calls, 0);
  });
});

test('COS steps reject writes, credential headers and malformed signature queries before HTTP', async (t) => {
  const invalid = [
    ['POST', { method: 'POST' }], ['DELETE', { method: 'DELETE' }], ['body', { body: 'fixture' }],
    ['Authorization', { headers: { Authorization: 'Bearer unusable-api-fixture' } }],
    ['lowercase authorization', { headers: { authorization: 'fixture' } }],
    ['Cookie', { headers: { Cookie: 'session=fixture' } }],
    ['API token header', { headers: { 'x-api-token': 'fixture' } }],
    ['Bearer in a read header', { headers: { Accept: 'Bearer unusable-api-fixture' } }],
    ['JWT in a read header', { headers: { 'If-Range': 'eyJfixture.payload.signature' } }],
    ['object ACL header', { headers: { 'x-cos-acl': 'public-read' } }],
    ['false headers', { headers: false }],
    ['null headers', { headers: null }],
    ['header newline', { headers: { Range: 'bytes=0-1\r\nAuthorization: fixture' } }],
    ['wrong algorithm', {}, { 'q-sign-algorithm': 'sha256' }],
    ['empty access id', {}, { 'q-ak': '' }],
    ['short signature', {}, { 'q-signature': 'fixture' }],
    ['invalid time', {}, { 'q-sign-time': 'not-a-time' }],
    ['reversed time', {}, { 'q-key-time': '1700000120;1699999999' }],
    ['signature exceeds key window', {}, { 'q-key-time': '1699999999;1700000010' }],
    ['Authorization signed header', {}, { 'q-header-list': 'authorization;host' }],
    ['missing signed header', {}, { 'q-header-list': 'host;range' }],
    ['unknown signed parameter', {}, { 'q-url-param-list': 'access_token;response-cache-control;versionid' }],
    ['unbound response query', {}, { 'q-url-param-list': 'versionid' }],
    ['API token query', {}, { access_token: 'unusable-api-fixture' }],
    ['Authorization query', {}, { Authorization: 'Bearer unusable-api-fixture' }],
    ['JWT substituted for COS token', {}, { 'x-cos-security-token': 'eyJfixture.payload.signature' }],
    ['duplicate signature', { url: `${signedFixture()}&q-signature=${'1'.repeat(40)}` }],
    ['missing signature', { url: signedFixture().replace(/&q-signature=[^&]*/, '') }],
  ];
  for (const [name, step, query] of invalid) await t.test(name, async () => {
    let calls = 0;
    await assert.rejects(runCapacity(capacityOptions, cosScenario([{ url: signedFixture({ query }), ...step }]), {
      nowMs: () => fixtureNow, fetchImpl: async () => { calls++; return new Response(); },
    }), /COS|媒体|请求/);
    assert.equal(calls, 0);
  });
});

test('COS accepts an exact staging-environment media subdirectory and signed Range without response overrides', async () => {
  const prefix = 'ruleexam/staging/media/capacity-fixture/';
  const url = new URL(signedFixture({ key: `${prefix}video.mp4`, query: { 'q-header-list': 'host;range', 'q-url-param-list': '' } }));
  url.searchParams.delete('response-cache-control');
  url.searchParams.delete('versionId');
  const report = await runCapacity(capacityOptions, cosScenario([{ url: url.href, headers: { Range: 'bytes=0-1' } }], {
    cosMediaPrefix: prefix,
  }), { nowMs: () => fixtureNow, fetchImpl: async () => new Response(new Uint8Array([1, 2]), { status: 206 }) });
  assert.equal(report.completedRequests, 1);
  assert.equal(report.responseBytes, 2);
});

test('COS signatures must already be valid and outlive the whole run according to the injected clock', async (t) => {
  for (const [name, query, now] of [
    ['expired', { 'q-sign-time': '1699999900;1699999999', 'q-key-time': '1699999900;1699999999' }, fixtureNow],
    ['not yet valid', { 'q-sign-time': '1700000001;1700000120', 'q-key-time': '1700000001;1700000120' }, fixtureNow],
    ['expires at run deadline', { 'q-sign-time': '1699999999;1700000001', 'q-key-time': '1699999999;1700000001' }, fixtureNow + 900],
    ['key expired first', { 'q-key-time': '1699999900;1699999999' }, fixtureNow],
    ['clock advanced beyond expiry', {}, fixtureNow + 121000],
  ]) await t.test(name, async () => {
    let calls = 0;
    await assert.rejects(runCapacity(capacityOptions, cosScenario([{ url: signedFixture({ query }) }]), {
      nowMs: () => now, fetchImpl: async () => { calls++; return new Response(); },
    }), /COS|签名|有效/);
    assert.equal(calls, 0);
  });
  const report = await runCapacity(capacityOptions, cosScenario([{ url: signedFixture({ query: {
    'q-sign-time': '1699999999;1700000002', 'q-key-time': '1699999999;1700000002',
  } }) }]), { nowMs: () => fixtureNow + 900, fetchImpl: async () => new Response() });
  assert.equal(report.completedRequests, 1);
});

test('a COS stream interrupted at the generator deadline counts partial bytes without a service error', async () => {
  const report = await runCapacity({ ...capacityOptions, durationSeconds: 0.02 }, cosScenario(), {
    nowMs: () => fixtureNow,
    fetchImpl: async (_url, { signal }) => ({ ok: true, status: 206, body: (async function* () {
      yield new Uint8Array([1, 2, 3]);
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('deadline')), { once: true }));
    })() }),
  });
  assert.equal(report.responseBytes, 3);
  assert.equal(report.deadlineAbortedRequests, 1);
  assert.equal(report.completedRequests, 0);
  assert.equal(report.errorRequests, 0);
});

test('CLI requires a regular 0600 private scenario before using a signed URL', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ruleexam-media-capacity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'scenario.json');
  await writeFile(path, JSON.stringify(cosScenario()), { mode: 0o644 });
  await chmod(path, 0o644);
  let calls = 0;
  const dependencies = { nowMs: () => fixtureNow, fetchImpl: async () => { calls++; return new Response(); } };
  const args = ['--run', '--scenario', path, '--profile', 'exam', '--users', '1', '--duration-seconds', '0.1'];
  await assert.rejects(main(args, dependencies), /0600|私有/);
  assert.equal(calls, 0);
  await chmod(path, 0o600);
  const report = await main(args, dependencies);
  assert.equal(report.completedRequests, 1);
  assert.equal(calls, 1);
});
