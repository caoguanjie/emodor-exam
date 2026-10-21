import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUITE_REGISTRY,
  parseArgs,
  resolveSuitePaths,
  runSelectedSuites,
  runSuiteInRuntime,
} from './run-e2e.mjs';

const SUITE_A = '/owned/suite-a.mjs';
const SUITE_B = '/owned/suite-b.mjs';

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
  assert.deepEqual(parseArgs(['--suite', 'all']), { suite: 'all', ephemeral: false });
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

test('production runtime wrapper gives explicit fixture suites fresh databases', { concurrency: false, timeout: 120_000 }, async () => {
  const contexts = [];
  const firstSuite = {
    async run(ctx) {
      const [databaseRow] = await ctx.queryTestDb('SELECT DATABASE() AS database_name');
      contexts.push({
        database: databaseRow.database_name,
        baseUrl: ctx.baseUrl,
        mockPort: Number(ctx.env.MOCK_AI_PORT),
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
        mockPort: Number(ctx.env.MOCK_AI_PORT),
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
  assert.ok(Number.isInteger(contexts[0].mockPort) && contexts[0].mockPort >= 1024);
  assert.ok(Number.isInteger(contexts[1].mockPort) && contexts[1].mockPort >= 1024);
  assert.notEqual(contexts[0].mockPort, contexts[1].mockPort);
});
