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
const TARGET = '026_question_lifecycle_slimming';
const PERMISSION_TARGET = '027_question_review_permission_cleanup';
const BASE = '9471cc9164c9d79e8a140cb9f68ab0e7b74fb706';
let migrations;
let services;
let admin;
const databases = new Set();

before(async () => {
  migrations = await listMigrations();
  assert.ok(migrations.find((item) => item.id === TARGET), 'lifecycle migration must be shipped');
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
  const database = `ruleexam_test_lifecycle_${randomBytes(5).toString('hex')}`;
  databases.add(database);
  const sql = current ? await readFile(new URL('../database/init.sql', import.meta.url), 'utf8')
    : execFileSync('git', ['show', `${BASE}:database/init.sql`], { encoding: 'utf8' });
  await admin.query(renderSchemaForDatabase(sql, database));
  const connection = await mysql.createConnection({ ...services.mysql, database });
  if (!current) await applyMigrations({ connection, database, migrations: migrations.filter((item) => item.id < TARGET) });
  return { connection, database };
}
async function columns(connection) {
  const [rows] = await connection.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='question' AND COLUMN_NAME IN ('is_enabled','score')) OR (TABLE_NAME='question_version' AND COLUMN_NAME='score_cents')) ORDER BY TABLE_NAME,COLUMN_NAME");
  return rows;
}
async function seed(connection) {
  for (const [index, status] of ['approved', 'pending', 'rejected', 'unknown'].entries()) {
    await connection.execute("INSERT INTO question (id,type,stem,options,answer,score,status,source,created_by,created_at,updated_at,concept_id) VALUES (?,'single','旧题',JSON_ARRAY(JSON_OBJECT('key','A','text','甲'),JSON_OBJECT('key','B','text','乙')),JSON_ARRAY(0),?,?,?,?,?, ?,7)", [501 + index, index === 3 ? null : '7.25', status, 'manual', 9, '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000']);
  }
  for (const code of ['questions:review', 'ai:review', 'papers:review']) {
    await connection.execute('INSERT INTO sys_permission (code,name) VALUES (?,?)', [code, code]);
    await connection.execute('INSERT INTO sys_role_permission (role_id,permission_id) SELECT 91,id FROM sys_permission WHERE code=?', [code]);
    await connection.execute("INSERT INTO sys_menu (name,type,permission_code,sort,status) VALUES (?,'button',?,1,1)", [code, code]);
  }
}

test('026 upgrades nullable-score candidates, maps only approved rows and preserves historical fields', async () => {
  const state = await stateFor(); const installed = await stateFor(true);
  try {
    await seed(state.connection);
    const [before] = await state.connection.query('SELECT id,status,concept_id,score,created_at,updated_at FROM question ORDER BY id');
    await applyMigrations({ ...state, migrations });
    const [after] = await state.connection.query('SELECT id,status,concept_id,score,created_at,updated_at FROM question ORDER BY id');
    assert.deepEqual(after, before);
    const [enabled] = await state.connection.query('SELECT id,is_enabled FROM question ORDER BY id');
    assert.deepEqual(enabled.map((row) => row.is_enabled), [1, 0, 0, 0]);
    assert.deepEqual(await columns(state.connection), await columns(installed.connection));
    assert.ok((await columns(state.connection)).filter((column) => column.COLUMN_NAME !== 'is_enabled').every((column) => column.IS_NULLABLE === 'YES' && column.COLUMN_DEFAULT === null));
    const [index] = await state.connection.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='question' AND INDEX_NAME='idx_question_enabled_pool' ORDER BY SEQ_IN_INDEX");
    assert.deepEqual(index.map((row) => row.COLUMN_NAME), ['is_enabled', 'category_id', 'type', 'difficulty', 'current_version_id']);
    await state.connection.query('UPDATE question SET is_enabled=0 WHERE id=501');
    await state.connection.query('UPDATE question SET is_enabled=1 WHERE id=502');
    await applyMigrations({ ...state, migrations });
    const [repeated] = await state.connection.query('SELECT id,is_enabled FROM question ORDER BY id');
    assert.deepEqual(repeated.map((row) => row.is_enabled), [0, 1, 0, 0]);
    await applyMigrations({ ...installed, migrations });
  } finally { await state.connection.end(); await installed.connection.end(); }
});

test('026 resumes every DDL/data checkpoint without remapping completed lifecycle facts', async () => {
  const target = migrations.find((item) => item.id === TARGET);
  for (const step of target.steps) {
    const state = await stateFor();
    try {
      await seed(state.connection);
      await assert.rejects(() => applyMigrations({ ...state, migrations, onCheckpoint({ event, migrationId, stepId }) {
        if (event === 'after-step-sql' && migrationId === TARGET && stepId === step.id) throw new Error('lifecycle crash');
      } }), /lifecycle crash/);
      await applyMigrations({ ...state, migrations });
      const [[row]] = await state.connection.query('SELECT status,progress FROM schema_migration WHERE migration_id=?', [TARGET]);
      assert.equal(row.status, 'applied');
      assert.deepEqual(row.progress, target.steps.map((item) => item.id));
      const [questions] = await state.connection.query('SELECT is_enabled,score,concept_id FROM question ORDER BY id');
      assert.deepEqual(questions.map((row) => row.is_enabled), [1, 0, 0, 0]);
      assert.equal(questions[0].score, '7.25'); assert.equal(String(questions[0].concept_id), '7');
    } finally { await state.connection.end(); }
  }
});

test('027 removes only questions review permission, role links and button entries', async () => {
  const state = await stateFor();
  try {
    await seed(state.connection);
    await applyMigrations({ ...state, migrations });
    for (const table of ['sys_permission', 'sys_role_permission', 'sys_menu']) {
      const sql = table === 'sys_role_permission'
        ? 'SELECT p.code AS code FROM sys_role_permission rp INNER JOIN sys_permission p ON p.id=rp.permission_id WHERE rp.role_id=91 ORDER BY p.code'
        : `SELECT ${table === 'sys_menu' ? 'permission_code' : 'code'} AS code FROM ${table} WHERE ${table === 'sys_menu' ? 'permission_code' : 'code'} IN ('questions:review','ai:review','papers:review') ORDER BY code`;
      const [rows] = await state.connection.query(sql);
      assert.deepEqual(rows.map((row) => row.code), ['ai:review', 'papers:review']);
    }
    assert.ok(migrations.some((migration) => migration.id === PERMISSION_TARGET));
  } finally { await state.connection.end(); }
});
