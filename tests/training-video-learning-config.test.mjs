import test from 'node:test';
import assert from 'node:assert/strict';
import * as suite from './training-video-learning.mjs';

const validContext = () => ({
  env: {
    DB_HOST: 'db.internal',
    DB_PORT: '4407',
    DB_USERNAME: 'ephemeral_runner',
    DB_PASSWORD: 'runtime-only-secret',
    DB_DATABASE: 'ruleexam_test_b2config',
  },
});

test('video learning direct DB configuration has no implicit connection fallback', () => {
  assert.equal(typeof suite.strictTestDbConfig, 'function');
  assert.deepEqual(suite.strictTestDbConfig(validContext()), {
    host: 'db.internal',
    port: 4407,
    user: 'ephemeral_runner',
    password: 'runtime-only-secret',
    database: 'ruleexam_test_b2config',
  });
});

for (const field of ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE']) {
  test(`video learning direct DB configuration rejects missing ${field} before connecting`, () => {
    const ctx = validContext();
    delete ctx.env[field];
    assert.throws(() => suite.strictTestDbConfig(ctx), new RegExp(field));
  });
}

test('video learning direct DB configuration rejects a non-ephemeral database before connecting', () => {
  const ctx = validContext();
  ctx.env.DB_DATABASE = 'ruleexam';
  assert.throws(() => suite.strictTestDbConfig(ctx), /ruleexam_test_/);
});

test('video learning direct DB configuration rejects an invalid port before connecting', () => {
  const ctx = validContext();
  ctx.env.DB_PORT = 'not-a-port';
  assert.throws(() => suite.strictTestDbConfig(ctx), /DB_PORT/);
});
