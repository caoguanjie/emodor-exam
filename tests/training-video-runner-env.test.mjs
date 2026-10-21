import assert from 'node:assert/strict';
import test from 'node:test';

import * as runner from './run-e2e.mjs';

function suiteEnvFor(path) {
  assert.equal(typeof runner.suiteRuntimeEnvOverrides, 'function');
  return runner.suiteRuntimeEnvOverrides(path);
}

test('standard video suite supplies pool size 2 without mutating caller environment', () => {
  const original = process.env.DB_POOL_SIZE;
  process.env.DB_POOL_SIZE = 'caller-value';
  try {
    const [videoSuite] = runner.resolveSuitePaths('training-video-learning');
    assert.deepEqual(suiteEnvFor(videoSuite), { DB_POOL_SIZE: '2' });
    assert.equal(process.env.DB_POOL_SIZE, 'caller-value');
  } finally {
    if (original === undefined) delete process.env.DB_POOL_SIZE;
    else process.env.DB_POOL_SIZE = original;
  }
});

test('all selection gives the video suite the same override and leaves other suites unforced', () => {
  const [selectedVideoSuite] = runner.resolveSuitePaths('training-video-learning');
  const allSuites = runner.resolveSuitePaths('all');
  const enumeratedVideoSuite = allSuites.find((path) => path === selectedVideoSuite);

  assert.ok(enumeratedVideoSuite);
  assert.deepEqual(suiteEnvFor(enumeratedVideoSuite), suiteEnvFor(selectedVideoSuite));
  assert.deepEqual(suiteEnvFor(enumeratedVideoSuite), { DB_POOL_SIZE: '2' });
  for (const suitePath of allSuites.filter((path) => path !== enumeratedVideoSuite)) {
    assert.deepEqual(suiteEnvFor(suitePath), {});
  }
});
