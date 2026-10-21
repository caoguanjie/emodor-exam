import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { applyMigrations } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const ROOT = join(import.meta.dirname, '..');
const BASE = 'a5955da4bf8022757008322d49b2db58d15aef74';
let services;
let admin;
const databases = new Set();

async function createDatabase(prefix) {
  const database = `ruleexam_test_${prefix}_${randomBytes(4).toString('hex')}`;
  databases.add(database);
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  return database;
}

async function connectionFor(database) {
  return mysql.createConnection({
    host: services.mysql.host,
    port: services.mysql.port,
    user: services.mysql.user,
    password: services.mysql.password,
    database,
  });
}

async function schemaSnapshot(connection) {
  const [tables] = await connection.query(
    "SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('sys_user', 'training_category', 'import_batch') ORDER BY TABLE_NAME",
  );
  const [columns] = await connection.query(
    "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('sys_user', 'training_category', 'import_batch') ORDER BY TABLE_NAME, ORDINAL_POSITION",
  );
  const [indexes] = await connection.query(
    "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('sys_user', 'training_category', 'import_batch') ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
  );
  return { tables, columns, indexes };
}

before(async () => {
  services = await createEphemeralServices();
  admin = await mysql.createConnection({
    host: services.mysql.host,
    port: services.mysql.port,
    user: services.mysql.user,
    password: services.mysql.password,
    multipleStatements: true,
  });
});

after(async () => {
  for (const database of databases) await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
  await admin?.end().catch(() => undefined);
  await services?.cleanup();
});

test('A2 upgrades accepted A1 schema, preserves legacy null provenance, and converges to init', async () => {
  const currentDatabase = await createDatabase('a2_init');
  const legacyDatabase = await createDatabase('a2_upgrade');
  const currentSql = await readFile(join(ROOT, 'database', 'init.sql'), 'utf8');
  const legacySql = execFileSync('git', ['show', `${BASE}:database/init.sql`], { cwd: ROOT, encoding: 'utf8' });
  await admin.query(renderSchemaForDatabase(currentSql, currentDatabase));
  await admin.query(renderSchemaForDatabase(legacySql, legacyDatabase));

  const legacy = await connectionFor(legacyDatabase);
  await legacy.execute(
    "INSERT INTO sys_user (username, password_hash, real_name, employee_no, department_id, role, status, last_login_at) VALUES ('legacy-a2', ?, '旧用户', NULL, NULL, 'employee', 1, NULL)",
    ['x'.repeat(60)],
  );
  await applyMigrations({ connection: legacy, database: legacyDatabase });
  const [[user]] = await legacy.query("SELECT category_id, source, status FROM sys_user WHERE username = 'legacy-a2'");
  assert.equal(user.category_id, null);
  assert.equal(user.source, null);
  assert.equal(Number(user.status), 1);

  const initialized = await connectionFor(currentDatabase);
  assert.deepEqual(await schemaSnapshot(legacy), await schemaSnapshot(initialized));
  await initialized.end();
  await legacy.end();
});
