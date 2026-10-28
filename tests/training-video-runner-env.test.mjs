import assert from 'node:assert/strict';
import test from 'node:test';

import * as runner from './run-e2e.mjs';

function suiteEnvFor(path) {
  assert.equal(typeof runner.suiteRuntimeEnvOverrides, 'function');
  return runner.suiteRuntimeEnvOverrides(path);
}

function suiteApiFor(path) {
  assert.equal(typeof runner.suiteRuntimeApi, 'function');
  return runner.suiteRuntimeApi(path);
}

test('course progress reads use mobile debug login without a fake identity provider', () => {
  const [courseSuite] = runner.resolveSuitePaths('training-courses');
  assert.deepEqual(suiteEnvFor(courseSuite), {
    NODE_ENV: 'test', SERVER_DEBUG_LOGIN_ENABLED: 'true', SMS_PROVIDER: 'disabled',
  });
  assert.deepEqual(suiteApiFor(courseSuite), {});
  const allPath = runner.resolveSuitePaths('all').find((path) => path === courseSuite);
  assert.deepEqual(suiteEnvFor(allPath), suiteEnvFor(courseSuite));
});

test('video suite supplies its isolated identity runtime and pool size 2 without mutating caller environment', () => {
  const original = process.env.DB_POOL_SIZE;
  process.env.DB_POOL_SIZE = 'caller-value';
  try {
    const [videoSuite] = runner.resolveSuitePaths('training-video-learning');
    assert.deepEqual(suiteEnvFor(videoSuite), {
      DB_POOL_SIZE: '2', NODE_ENV: 'test', SERVER_DEBUG_LOGIN_ENABLED: 'true',
      SMS_PROVIDER: 'disabled', IDENTITY_PROVIDER: 'disabled',
    });
    assert.match(suiteApiFor(videoSuite).apiEntry, /server\/node_modules\/tsx\/dist\/cli\.mjs$/);
    assert.match(suiteApiFor(videoSuite).apiArgs[0].replaceAll('\\', '/'), /server\/test\/identity-e2e-main\.ts$/);
    assert.equal(process.env.DB_POOL_SIZE, 'caller-value');
  } finally {
    if (original === undefined) delete process.env.DB_POOL_SIZE;
    else process.env.DB_POOL_SIZE = original;
  }
});

test('all selection gives the video suite the same override and leaves other suites unforced', () => {
  const [selectedVideoSuite] = runner.resolveSuitePaths('training-video-learning');
  const [selectedMobileAuthSuite] = runner.resolveSuitePaths('mobile-auth');
  const [selectedCourseSuite] = runner.resolveSuitePaths('training-courses');
  const allSuites = runner.resolveSuitePaths('all');
  const enumeratedVideoSuite = allSuites.find((path) => path === selectedVideoSuite);
  const enumeratedMobileAuthSuite = allSuites.find((path) => path === selectedMobileAuthSuite);

  assert.ok(enumeratedVideoSuite);
  assert.ok(enumeratedMobileAuthSuite);
  assert.deepEqual(suiteEnvFor(enumeratedVideoSuite), suiteEnvFor(selectedVideoSuite));
  assert.deepEqual(suiteEnvFor(enumeratedVideoSuite), {
    DB_POOL_SIZE: '2', NODE_ENV: 'test', SERVER_DEBUG_LOGIN_ENABLED: 'true',
    SMS_PROVIDER: 'disabled', IDENTITY_PROVIDER: 'disabled',
  });
  assert.deepEqual(suiteEnvFor(enumeratedMobileAuthSuite), {
    NODE_ENV: 'test', SERVER_DEBUG_LOGIN_ENABLED: 'true', SMS_PROVIDER: 'disabled',
  });
  const identitySuites = ['mobile-identity', 'mobile-media-ticket', 'training-attempts', 'training-submissions', 'training-records', 'training-full-flow', 'mobile-h5'].map((name) => runner.resolveSuitePaths(name)[0]);
  for (const suitePath of identitySuites) {
    assert.deepEqual(suiteEnvFor(suitePath), {
      NODE_ENV: 'test', SERVER_DEBUG_LOGIN_ENABLED: 'true', SMS_PROVIDER: 'disabled', IDENTITY_PROVIDER: 'disabled',
    });
    assert.match(suiteApiFor(suitePath).apiEntry, /server\/node_modules\/tsx\/dist\/cli\.mjs$/);
    const apiArgs = suiteApiFor(suitePath).apiArgs.map((value) => value.replaceAll('\\', '/'));
    assert.equal(apiArgs.length, 1);
    assert.match(apiArgs[0], /server\/test\/identity-e2e-main\.ts$/);
  }
  // New suites may intentionally supply their own isolated runtime. Unknown
  // paths must still receive no overrides; known suites are tested by contract.
  assert.deepEqual(suiteEnvFor('/not-a-registered-suite.mjs'), {});
  assert.deepEqual(suiteApiFor('/not-a-registered-suite.mjs'), {});
  assert.ok(allSuites.includes(selectedCourseSuite));
});
