import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { applyMigrations, listMigrations } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const ROOT = join(import.meta.dirname, '..');
const BASE = 'a5955da4bf8022757008322d49b2db58d15aef74';
let services;
let admin;
let trainingIdentityMigration;
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

async function assertProbeIncomplete(connection, stepId) {
  const step = trainingIdentityMigration.steps.find((candidate) => candidate.id === stepId);
  assert.ok(step, `missing migration step ${stepId}`);
  const [[row]] = await connection.query(step.checkSql);
  assert.equal(Number(row.complete), 0, `${stepId} probe accepted a drifted schema`);
}

before(async () => {
  trainingIdentityMigration = (await listMigrations()).find(({ id }) => id === '001_training_identity');
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

test('A2 migration refuses engine, key-shape, and index drift', async () => {
  const legacySql = execFileSync('git', ['show', `${BASE}:database/init.sql`], { cwd: ROOT, encoding: 'utf8' });
  const wrongCategoryDatabase = await createDatabase('a2_drift_category');
  await admin.query(renderSchemaForDatabase(legacySql, wrongCategoryDatabase));
  const wrongCategory = await connectionFor(wrongCategoryDatabase);
  await wrongCategory.execute(
    "CREATE TABLE training_category (id BIGINT UNSIGNED NOT NULL, name VARCHAR(128) NOT NULL, description TEXT NULL, status TINYINT NOT NULL DEFAULT 1, created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",
  );
  await assert.rejects(
    () => applyMigrations({ connection: wrongCategory, database: wrongCategoryDatabase }),
    /migration probe .*create_training_category .*incomplete|remained incomplete/,
  );
  await wrongCategory.end();

  const currentSql = await readFile(join(ROOT, 'database', 'init.sql'), 'utf8');

  const wrongEngineDatabase = await createDatabase('a2_drift_engine');
  await admin.query(renderSchemaForDatabase(currentSql, wrongEngineDatabase));
  const wrongEngine = await connectionFor(wrongEngineDatabase);
  await wrongEngine.execute('ALTER TABLE training_category ENGINE=MyISAM');
  await assertProbeIncomplete(wrongEngine, 'create_training_category');
  await assert.rejects(
    () => applyMigrations({ connection: wrongEngine, database: wrongEngineDatabase }),
    /migration probe .*create_training_category .*incomplete|remained incomplete/,
  );
  await wrongEngine.end();

  const wrongCategoryIndexDatabase = await createDatabase('a2_drift_category_index');
  await admin.query(renderSchemaForDatabase(currentSql, wrongCategoryIndexDatabase));
  const wrongCategoryIndex = await connectionFor(wrongCategoryIndexDatabase);
  await wrongCategoryIndex.execute(
    'ALTER TABLE training_category DROP INDEX uk_training_category_name, ADD UNIQUE INDEX uk_training_category_name (name, status)',
  );
  await assertProbeIncomplete(wrongCategoryIndex, 'create_training_category');
  await assert.rejects(
    () => applyMigrations({ connection: wrongCategoryIndex, database: wrongCategoryIndexDatabase }),
    /migration probe .*create_training_category .*incomplete|remained incomplete/,
  );
  await wrongCategoryIndex.end();

  const wrongIdentityIndexDatabase = await createDatabase('a2_drift_identity_index');
  await admin.query(renderSchemaForDatabase(currentSql, wrongIdentityIndexDatabase));
  const wrongIdentityIndex = await connectionFor(wrongIdentityIndexDatabase);
  await wrongIdentityIndex.execute(
    'ALTER TABLE sys_user DROP INDEX idx_training_identity, ADD INDEX idx_training_identity (category_id, source, status)',
  );
  await assertProbeIncomplete(wrongIdentityIndex, 'add_sys_user_training_index');
  await assert.rejects(
    () => applyMigrations({ connection: wrongIdentityIndex, database: wrongIdentityIndexDatabase }),
    /migration probe .*add_sys_user_training_index .*incomplete|remained incomplete|Duplicate key name/,
  );
  await wrongIdentityIndex.end();

  const wrongIndexDatabase = await createDatabase('a2_drift_index');
  await admin.query(renderSchemaForDatabase(currentSql, wrongIndexDatabase));
  const wrongIndex = await connectionFor(wrongIndexDatabase);
  await wrongIndex.execute(
    'ALTER TABLE import_batch DROP INDEX idx_import_batch_owner_kind, ADD INDEX idx_import_batch_owner_kind (owner_id, kind, status)',
  );
  await wrongIndex.execute(
    'ALTER TABLE import_batch DROP INDEX idx_import_batch_status, ADD INDEX idx_import_batch_status (status, kind)',
  );
  await assertProbeIncomplete(wrongIndex, 'create_import_batch');
  await assert.rejects(
    () => applyMigrations({ connection: wrongIndex, database: wrongIndexDatabase }),
    /migration probe .*create_import_batch .*incomplete|remained incomplete|Duplicate key name/,
  );
  await wrongIndex.end();
});
