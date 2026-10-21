import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createEphemeralServices, getFreePort } from './support/ephemeral-services.mjs';
import { createTrainingHarness } from './support/training-harness.mjs';
import { renderSchemaForDatabase, isSafeTestDatabase } from './support/test-target.mjs';
import { SUITE_REGISTRY } from './run-e2e.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const JSZip = require('jszip');
const mysql = require('mysql2/promise');
const ROOT = join(import.meta.dirname, '..');
const API_ENTRY = join(ROOT, 'server', 'dist', 'main.js');

let services;
let harness;
let database;

before(async () => {
  services = await createEphemeralServices();
  database = `ruleexam_test_harness_${randomBytes(5).toString('hex')}`;
  assert.ok(isSafeTestDatabase(database));
  const initSql = await readFile(join(ROOT, 'database', 'init.sql'), 'utf8');
  const admin = await mysql.createConnection({
    host: services.mysql.host,
    port: services.mysql.port,
    user: services.mysql.user,
    password: services.mysql.password,
    multipleStatements: true,
  });
  try {
    await admin.query(renderSchemaForDatabase(initSql, database));
  } finally {
    await admin.end();
  }

  const port = await getFreePort();
  harness = await createTrainingHarness({
    port,
    database,
    db: services.mysql,
    redis: services.redis,
    apiEntry: API_ENTRY,
    env: {
      DB_HOST: services.mysql.host,
      DB_PORT: String(services.mysql.port),
      DB_USERNAME: services.mysql.user,
      DB_PASSWORD: services.mysql.password,
      DB_DATABASE: database,
      REDIS_HOST: services.redis.host,
      REDIS_PORT: String(services.redis.port),
      REDIS_PASSWORD: '',
    },
  });
  await harness.restartApi();
});

after(async () => {
  await harness?.cleanup();
  await services?.cleanup();
});

test('training harness supports JSON, multipart, targeted queries, and restart preservation', async () => {
  const loginActor = {};
  const login = await harness.request(loginActor, 'POST', '/auth/login', {
    username: 'admin',
    password: harness.adminPassword,
  });
  assert.equal(login.status, 200);
  assert.equal(login.code, 0);
  assert.ok(login.data?.access_token);
  assert.ok(login.headers);
  assert.ok(login.headers['set-cookie']);
  assert.equal(typeof loginActor.accessToken, 'undefined');
  assert.ok(loginActor.cookie);

  const updatedPassword = `A9${randomBytes(10).toString('hex')}`;
  const changed = await harness.request({ accessToken: login.data.access_token, cookie: loginActor.cookie }, 'PUT', '/auth/password', {
    old_password: harness.adminPassword,
    new_password: updatedPassword,
  });
  assert.equal(changed.status, 200);
  const relogin = await harness.request(loginActor, 'POST', '/auth/login', {
    username: 'admin',
    password: updatedPassword,
  });
  assert.equal(relogin.status, 200);
  const actor = { accessToken: relogin.data.access_token, cookie: loginActor.cookie };
  const department = await harness.request(actor, 'POST', '/departments', {
    parent_id: '1',
    name: `Harness ${randomBytes(4).toString('hex')}`,
  });
  assert.equal(department.status, 200);
  const departmentId = String(department.data.id);

  const regulation = await harness.request(actor, 'POST', '/regulations', {
    title: 'Harness multipart regulation',
    category: '测试',
  });
  assert.equal(regulation.status, 200);
  const regulationId = String(regulation.data.id);

  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
  const upload = await harness.upload(actor, `/regulations/${regulationId}/versions`, await zip.generateAsync({ type: 'nodebuffer' }), 'harness.docx');
  assert.equal(upload.status, 200);
  assert.equal(upload.code, 0);
  assert.ok(upload.data?.version_id);

  const [rows] = await harness.queryTestDb(
    'SELECT id, name FROM sys_department WHERE id = ?',
    [departmentId],
  );
  assert.equal(String(rows.id), departmentId);

  await harness.restartApi();
  const profile = await harness.request(actor, 'GET', '/auth/profile');
  assert.equal(profile.status, 200);
  assert.equal(profile.data?.username, 'admin');
  const [persistedRows] = await harness.queryTestDb(
    'SELECT id, name FROM sys_department WHERE id = ?',
    [departmentId],
  );
  assert.equal(String(persistedRows.id), departmentId);
});

test('registered suites expose run(ctx) and unknown suites are rejected', async () => {
  assert.ok(Object.hasOwn(SUITE_REGISTRY, 'smoke'));
  const suite = await import(`file://${SUITE_REGISTRY.smoke}`);
  assert.equal(typeof suite.run, 'function');
  const result = spawnSync(process.execPath, ['tests/run-e2e.mjs', '--suite', 'not-registered'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /未知测试套件/);
});

test('harness database helpers reject a development target before connecting', async () => {
  const unsafe = await createTrainingHarness({ env: { DB_DATABASE: 'ruleexam' } });
  try {
    await assert.rejects(() => unsafe.queryTestDb('SELECT 1'), /ruleexam_test/);
    await assert.rejects(() => unsafe.restartApi(), /ruleexam_test/);
  } finally {
    await unsafe.cleanup();
  }
});
