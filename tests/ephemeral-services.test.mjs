import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createEphemeralServices } from './support/ephemeral-services.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const Redis = require('ioredis');

test('ephemeral mode serves only dedicated loopback MySQL and Redis endpoints', async () => {
  const services = await createEphemeralServices();
  try {
    assert.equal(services.mysql.host, '127.0.0.1');
    assert.equal(services.redis.host, '127.0.0.1');
    assert.notEqual(services.mysql.port, Number(process.env.DB_PORT || 3306));
    assert.notEqual(services.redis.port, Number(process.env.REDIS_PORT || 6379));
    const db = await mysql.createConnection({ ...services.mysql });
    await db.query('CREATE DATABASE `ruleexam_test_ephemeral`');
    const [[row]] = await db.query('SELECT DATABASE() AS current_db');
    assert.equal(row.current_db, null);
    await db.end();
    const redis = new Redis({ host: services.redis.host, port: services.redis.port });
    assert.equal(await redis.ping(), 'PONG');
    await redis.quit();
  } finally {
    await services.cleanup();
  }
});
