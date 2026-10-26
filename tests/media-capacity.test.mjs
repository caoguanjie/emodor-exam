import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { estimateCapacity, runCapacity } from './performance/media-capacity.mjs';

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
