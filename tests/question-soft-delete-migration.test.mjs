import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { applyMigrations, listMigrations } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const mysql = createRequire(new URL('../server/package.json', import.meta.url))('mysql2/promise');
const TARGET = '029_question_soft_delete';
const BASE = '75cdc5b27ac781f545a8641f4a80a01c9b393db0';
const baseSql = execFileSync('git', ['show', `${BASE}:database/init.sql`], { encoding: 'utf8' });
let migrations;
let services;
let admin;
const databases = new Set();

before(async () => {
  migrations = await listMigrations();
  assert.ok(migrations.some((item) => item.id === TARGET));
  services = await createEphemeralServices();
  admin = await mysql.createConnection({ ...services.mysql, multipleStatements: true });
});
after(async () => {
  for (const database of databases) await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
  await admin?.end().catch(() => undefined);
  await services?.stopProcesses();
  await services?.cleanup();
});

async function stateFor(current = false) {
  const database = `ruleexam_test_question_delete_${randomBytes(5).toString('hex')}`;
  databases.add(database);
  const sql = current ? await readFile(new URL('../database/init.sql', import.meta.url), 'utf8') : baseSql;
  await admin.query(renderSchemaForDatabase(sql, database));
  const connection = await mysql.createConnection({ ...services.mysql, database });
  if (!current) await applyMigrations({ connection, database, migrations: migrations.filter((item) => item.id < TARGET) });
  return { connection, database };
}

async function columns(connection) {
  const [rows] = await connection.query("SELECT COLUMN_NAME,COLUMN_TYPE,DATETIME_PRECISION,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='question' ORDER BY ORDINAL_POSITION");
  return rows;
}

async function seed(connection) {
  await connection.query("INSERT INTO question (id,type,stem,options,answer,score,status,is_enabled,source,created_by,created_at,updated_at,concept_id) VALUES (501,'single','旧题',JSON_ARRAY(JSON_OBJECT('key','A','text','甲'),JSON_OBJECT('key','B','text','乙')),JSON_ARRAY(0),7.25,'pending',0,'manual',9,'2026-01-01 00:00:00.000','2026-01-02 00:00:00.000',7)");
}

test('029 adds only a nullable plain timestamp and preserves old facts and registry across repeat applies', async () => {
  const state = await stateFor(); const installed = await stateFor(true);
  try {
    await seed(state.connection);
    const [before] = await state.connection.query('SELECT * FROM question ORDER BY id');
    const [registry] = await state.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    await applyMigrations({ ...state, migrations });
    const [after] = await state.connection.query('SELECT * FROM question ORDER BY id');
    assert.deepEqual(after.map(({ deleted_at, ...row }) => row), before);
    assert.equal(after[0].deleted_at, null);
    const [oldRegistry] = await state.connection.query('SELECT * FROM schema_migration WHERE migration_id < ? ORDER BY migration_id', [TARGET]);
    assert.deepEqual(oldRegistry, registry);
    assert.deepEqual(await columns(state.connection), await columns(installed.connection));
    const deleted = (await columns(state.connection)).find((column) => column.COLUMN_NAME === 'deleted_at');
    assert.deepEqual(deleted, { COLUMN_NAME: 'deleted_at', COLUMN_TYPE: 'datetime(3)', DATETIME_PRECISION: 3,
      IS_NULLABLE: 'YES', COLUMN_DEFAULT: null, EXTRA: '', COLUMN_COMMENT: '' });
    await state.connection.query("UPDATE question SET deleted_at='2026-10-26 02:00:00.123' WHERE id=501");
    const [marked] = await state.connection.query('SELECT * FROM question ORDER BY id');
    await applyMigrations({ ...state, migrations });
    const [repeated] = await state.connection.query('SELECT * FROM question ORDER BY id');
    assert.deepEqual(repeated, marked);
    await applyMigrations({ ...installed, migrations });
  } finally { await state.connection.end(); await installed.connection.end(); }
});

test('029 resumes after DDL commits before progress is recorded without re-adding the column', async () => {
  const state = await stateFor();
  try {
    await seed(state.connection);
    await assert.rejects(() => applyMigrations({ ...state, migrations, onCheckpoint({ event, migrationId }) {
      if (event === 'after-step-sql' && migrationId === TARGET) throw new Error('question-delete crash');
    } }), /question-delete crash/);
    assert.ok((await columns(state.connection)).some((column) => column.COLUMN_NAME === 'deleted_at'));
    await applyMigrations({ ...state, migrations });
    const [[row]] = await state.connection.query('SELECT status,progress FROM schema_migration WHERE migration_id=?', [TARGET]);
    assert.equal(row.status, 'applied'); assert.deepEqual(row.progress, ['question_soft_delete']);
    const [[question]] = await state.connection.query('SELECT score,status,is_enabled,concept_id,deleted_at FROM question WHERE id=501');
    assert.deepEqual(question, { score: '7.25', status: 'pending', is_enabled: 0, concept_id: 7, deleted_at: null });
  } finally { await state.connection.end(); }
});

test('029 rejects a same-name timestamp with the wrong precision', async () => {
  const state = await stateFor();
  try {
    await state.connection.query('ALTER TABLE question ADD COLUMN deleted_at DATETIME(6) NULL');
    await assert.rejects(() => applyMigrations({ ...state, migrations }), /duplicate column|probe|invariant|check/i);
    const [[column]] = await state.connection.query("SELECT DATETIME_PRECISION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='question' AND COLUMN_NAME='deleted_at'");
    assert.equal(column.DATETIME_PRECISION, 6);
  } finally { await state.connection.end(); }
});

for (const [name, sql] of [
  ['timestamp precision', 'ALTER TABLE question MODIFY deleted_at DATETIME(6) NULL'],
  ['timestamp default', "ALTER TABLE question MODIFY deleted_at DATETIME(3) NULL DEFAULT '2000-01-01 00:00:00.000'"],
  ['legacy nullable score', "ALTER TABLE question MODIFY score DECIMAL(5,2) NOT NULL DEFAULT 5.00 COMMENT '历史兼容列；新题及修订为 NULL，实际分值另存试卷'"],
  ['legacy pool index', 'ALTER TABLE question DROP INDEX idx_question_category_pool'],
  ['full column count', 'ALTER TABLE question ADD COLUMN accidental_column INT NULL'],
]) test(`029 full successor probe rejects applied drift in ${name}`, async () => {
  const state = await stateFor();
  try {
    await applyMigrations({ ...state, migrations });
    await state.connection.query(sql);
    const [before] = await state.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    await assert.rejects(() => applyMigrations({ ...state, migrations }), /probe|invariant|check/i);
    const [after] = await state.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    assert.deepEqual(after, before);
  } finally { await state.connection.end(); }
});
