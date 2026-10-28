import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSuitePaths, suiteRuntimeApi, suiteRuntimeEnvOverrides } from './run-e2e.mjs';

test('1000-question suite uses isolated test-only identity and bounded pool', () => {
  const [path] = resolveSuitePaths('public-random-exam');
  assert.deepEqual(suiteRuntimeEnvOverrides(path), { DB_POOL_SIZE: '2', NODE_ENV: 'test', SERVER_DEBUG_LOGIN_ENABLED: 'true', SMS_PROVIDER: 'disabled', IDENTITY_PROVIDER: 'disabled' });
  assert.match(suiteRuntimeApi(path).apiArgs[0], /server\/test\/identity-e2e-main\.ts$/);
  assert.ok(resolveSuitePaths('all').includes(path));
});

for (const name of ['training-attempts', 'training-submissions', 'training-records', 'training-full-flow']) {
  test(`${name} uses isolated mobile debug login and test-only identity provider`, () => {
    const [path] = resolveSuitePaths(name);
    assert.deepEqual(suiteRuntimeEnvOverrides(path), { NODE_ENV: 'test', SERVER_DEBUG_LOGIN_ENABLED: 'true', SMS_PROVIDER: 'disabled', IDENTITY_PROVIDER: 'disabled' });
    assert.match(suiteRuntimeApi(path).apiEntry, /server\/node_modules\/tsx\/dist\/cli\.mjs$/);
    assert.match(suiteRuntimeApi(path).apiArgs[0], /server\/test\/identity-e2e-main\.ts$/);
    const allPath = resolveSuitePaths('all').find((value) => value === path);
    assert.deepEqual(suiteRuntimeApi(allPath), suiteRuntimeApi(path));
  });
}
