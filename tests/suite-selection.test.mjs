import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SUITE_REGISTRY,
  parseArgs,
  resolveSuitePaths,
  runSelectedSuites,
  runSuiteInRuntime,
} from './run-e2e.mjs';

const SUITE_A = '/owned/suite-a.mjs';
const SUITE_B = '/owned/suite-b.mjs';

test('student administrator boundary suite is registered once in aggregate selection', () => {
  const expected = fileURLToPath(new URL('./training-student-admin-boundary.mjs', import.meta.url));
  assert.deepEqual(resolveSuitePaths('training-student-admin-boundary'), [expected]);
  assert.equal(resolveSuitePaths('all').filter((path) => path === expected).length, 1);
});

test('training courses suite is registered once in aggregate selection', () => {
  const expected = fileURLToPath(new URL('./training-courses.mjs', import.meta.url));
  assert.deepEqual(resolveSuitePaths('training-courses'), [expected]);
  assert.equal(resolveSuitePaths('all').filter((path) => path === expected).length, 1);
});

test('training video learning suite is registered once in aggregate selection', () => {
  const expected = fileURLToPath(new URL('./training-video-learning.mjs', import.meta.url));
  assert.deepEqual(resolveSuitePaths('training-video-learning'), [expected]);
  assert.equal(resolveSuitePaths('all').filter((path) => path === expected).length, 1);
});

test('all is an aggregate selector and aliases deduplicate explicit module paths', () => {
  const registry = {
    smoke: SUITE_A,
    'e2e-smoke': SUITE_A,
    identity: SUITE_B,
    'identity-alias': SUITE_B,
  };

  assert.deepEqual(resolveSuitePaths('all', registry), [SUITE_A, SUITE_B]);
  assert.deepEqual(resolveSuitePaths('e2e-smoke', registry), [SUITE_A]);
  assert.equal(Object.hasOwn(SUITE_REGISTRY, 'all'), false);
  assert.throws(() => parseArgs(['--suite', 'all']), /--suite all.*--ephemeral/);
  assert.deepEqual(parseArgs(['--suite', 'all', '--ephemeral']), { suite: 'all', ephemeral: true });
  assert.deepEqual(parseArgs(['--suite', 'smoke']), { suite: 'smoke', ephemeral: false });
});

test('suite selection rejects unknown names without deriving a path from input', () => {
  const registry = { smoke: SUITE_A };

  assert.throws(
    () => resolveSuitePaths('../secret-suite', registry),
    /未知测试套件/,
  );
  assert.throws(
    () => parseArgs(['--suite', '../secret-suite']),
    /未知测试套件/,
  );
});

test('suite selection stops after the first suite failure', async () => {
  const started = [];

  await assert.rejects(
    runSelectedSuites([SUITE_A, SUITE_B], {
      runSuite: async (suitePath) => {
        started.push(suitePath);
        throw new Error('first suite failed');
      },
    }),
    /first suite failed/,
  );
  assert.deepEqual(started, [SUITE_A]);
});

test('suite selection stops before the next suite after interruption', async () => {
  const started = [];
  let interrupted = false;

  await runSelectedSuites([SUITE_A, SUITE_B], {
    isInterrupted: () => interrupted,
    runSuite: async (suitePath) => {
      started.push(suitePath);
      interrupted = true;
    },
  });
  assert.deepEqual(started, [SUITE_A]);
});

test('ephemeral Mock AI binds a real kernel-selected port', { concurrency: false }, async () => {
  const previousPort = process.env.MOCK_AI_PORT;
  const previousMode = process.env.MOCK_AI_PORT_MODE;
  process.env.MOCK_AI_PORT = '0';
  process.env.MOCK_AI_PORT_MODE = 'ephemeral';
  try {
    const { startMockAi } = await import('./e2e-smoke.mjs?mock-port-test');
    const server = await startMockAi();
    const address = server.address();
    assert.equal(typeof address, 'object');
    assert.ok(address?.port >= 1024);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  } finally {
    if (previousPort === undefined) delete process.env.MOCK_AI_PORT;
    else process.env.MOCK_AI_PORT = previousPort;
    if (previousMode === undefined) delete process.env.MOCK_AI_PORT_MODE;
    else process.env.MOCK_AI_PORT_MODE = previousMode;
  }
});

test('an actual signal during one runtime prevents the next distinct suite', { concurrency: false, timeout: 120_000 }, async () => {
  const runnerUrl = new URL('./run-e2e.mjs', import.meta.url).href;
  const childScript = `
    import { runSelectedSuites, runSuiteInRuntime } from ${JSON.stringify(runnerUrl)};
    const firstPath = '/controlled/first-suite.mjs';
    const secondPath = '/controlled/second-suite.mjs';
    const runState = { interrupted: false };
    const firstSuite = {
      async run() {
        process.send?.({ type: 'suite-started', suite: 'first' });
        await new Promise((resolve) => process.once('SIGTERM', resolve));
      },
    };
    const secondSuite = {
      async run() {
        process.send?.({ type: 'suite-started', suite: 'second' });
      },
    };
    const suites = new Map([[firstPath, firstSuite], [secondPath, secondSuite]]);
    try {
      await runSelectedSuites([firstPath, secondPath], {
        isInterrupted: () => runState.interrupted,
        runSuite: (suitePath) => runSuiteInRuntime(suitePath, true, runState, { suiteModule: suites.get(suitePath) }),
      });
      process.send?.({ type: 'done', code: process.exitCode ?? 0 });
    } catch (error) {
      process.send?.({ type: 'error', message: error.message });
      process.exitCode = 1;
    }
  `;
  const childEnv = { ...process.env };
  delete childEnv.MOCK_AI_PORT;
  delete childEnv.MOCK_AI_PORT_MODE;
  const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  const messages = [];
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  child.on('message', (message) => messages.push(message));
  const firstStarted = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`first suite did not start: ${output.slice(-1200)}`)), 60_000);
    const onMessage = (message) => {
      if (message?.type === 'error') {
        clearTimeout(timer);
        child.removeListener('message', onMessage);
        reject(new Error(message.message));
      } else if (message?.type === 'suite-started' && message.suite === 'first') {
        clearTimeout(timer);
        child.removeListener('message', onMessage);
        resolve();
      }
    };
    child.on('message', onMessage);
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  let exitTimer;
  try {
    await firstStarted;
    child.kill('SIGTERM');
    const result = await Promise.race([
      exited,
      new Promise((_, reject) => {
        exitTimer = setTimeout(() => reject(new Error(`runner did not exit: ${output.slice(-1200)}`)), 30_000);
      }),
    ]);
    clearTimeout(exitTimer);
    assert.equal(result.signal, null, output);
    assert.equal(result.code, 143, output);
    assert.deepEqual(messages.filter((message) => message?.type === 'suite-started').map((message) => message.suite), ['first']);
    assert.equal(messages.some((message) => message?.type === 'error'), false, output);
  } finally {
    clearTimeout(exitTimer);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    if (child.connected) child.disconnect();
  }
});

test('production runtime wrapper gives explicit fixture suites fresh databases', { concurrency: false, timeout: 120_000 }, async () => {
  const contexts = [];
  const firstSuite = {
    async run(ctx) {
      const [databaseRow] = await ctx.queryTestDb('SELECT DATABASE() AS database_name');
      contexts.push({
        database: databaseRow.database_name,
        baseUrl: ctx.baseUrl,
        mockPort: ctx.env.MOCK_AI_PORT,
        mockPortMode: ctx.env.MOCK_AI_PORT_MODE,
      });
      await ctx.queryTestDb('CREATE TABLE suite_selection_probe (marker VARCHAR(32) NOT NULL)');
      await ctx.queryTestDb('INSERT INTO suite_selection_probe(marker) VALUES (?)', ['first-runtime']);
    },
  };
  const secondSuite = {
    async run(ctx) {
      const [databaseRow] = await ctx.queryTestDb('SELECT DATABASE() AS database_name');
      const markerTables = await ctx.queryTestDb(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suite_selection_probe'",
      );
      contexts.push({
        database: databaseRow.database_name,
        baseUrl: ctx.baseUrl,
        mockPort: ctx.env.MOCK_AI_PORT,
        mockPortMode: ctx.env.MOCK_AI_PORT_MODE,
      });
      assert.equal(markerTables.length, 0, 'second runtime must not inherit first suite tables');
    },
  };
  const runState = { interrupted: false };

  await runSuiteInRuntime('/controlled/first-suite.mjs', true, runState, { suiteModule: firstSuite });
  await runSuiteInRuntime('/controlled/second-suite.mjs', true, runState, { suiteModule: secondSuite });

  assert.equal(contexts.length, 2);
  assert.match(contexts[0].database, /^ruleexam_test_/);
  assert.match(contexts[1].database, /^ruleexam_test_/);
  assert.notEqual(contexts[0].database, contexts[1].database);
  assert.equal(contexts[0].mockPort, '0');
  assert.equal(contexts[1].mockPort, '0');
  assert.equal(contexts[0].mockPortMode, 'ephemeral');
  assert.equal(contexts[1].mockPortMode, 'ephemeral');
});
