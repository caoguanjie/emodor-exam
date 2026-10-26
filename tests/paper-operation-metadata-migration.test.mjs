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
const TARGET = '032_paper_operation_metadata';
const baseSql = execFileSync('git', ['show', 'a69d2dfa8598fa92c5b55fef106f81e0c35bdfe5:database/init.sql'], { encoding: 'utf8' });
const databases = new Set();
let migrations;
let services;
let admin;

before(async () => {
  migrations = await listMigrations();
  assert.ok(migrations.some((item) => item.id === TARGET), 'paper operation-metadata migration must be registered');
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
  const database = `ruleexam_test_paper_operator_${randomBytes(5).toString('hex')}`;
  databases.add(database);
  const sql = current ? await readFile(new URL('../database/init.sql', import.meta.url), 'utf8') : baseSql;
  await admin.query(renderSchemaForDatabase(sql, database));
  const connection = await mysql.createConnection({ ...services.mysql, database });
  if (!current) await applyMigrations({ connection, database, migrations: migrations.filter((item) => item.id < TARGET) });
  return { connection, database };
}

async function columns(connection) {
  const [rows] = await connection.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='exam_paper' ORDER BY ORDINAL_POSITION");
  return rows;
}

async function seed(connection) {
  await connection.query("INSERT INTO exam_paper (id,business_scope,mode,category_id,requires_learning,course_ids,title,remark,sort_order,status,created_by,created_at,updated_at) VALUES (501,'training','fixed',9,0,JSON_ARRAY(),'历史试卷','历史备注',3,'draft',9,'2026-01-01 00:00:00.000','2026-01-02 00:00:00.000')");
}

test('032 preserves historical rows with unknown updater, matches init schema and safely reapplies', async () => {
  const state = await stateFor();
  const installed = await stateFor(true);
  try {
    await seed(state.connection);
    const [beforeRows] = await state.connection.query('SELECT * FROM exam_paper');
    const [registryBefore] = await state.connection.query('SELECT * FROM schema_migration WHERE migration_id < ? ORDER BY migration_id', [TARGET]);

    await applyMigrations({ ...state, migrations });

    const [afterRows] = await state.connection.query('SELECT * FROM exam_paper');
    assert.deepEqual(afterRows.map(({ updated_by, ...row }) => row), beforeRows);
    assert.equal(afterRows[0].updated_by, null);
    assert.deepEqual(await columns(state.connection), await columns(installed.connection));
    const [registryAfter] = await state.connection.query('SELECT * FROM schema_migration WHERE migration_id < ? ORDER BY migration_id', [TARGET]);
    assert.deepEqual(registryAfter, registryBefore);

    await state.connection.query('UPDATE exam_paper SET updated_by=? WHERE id=?', [10, 501]);
    const [saved] = await state.connection.query('SELECT * FROM exam_paper');
    await applyMigrations({ ...state, migrations });
    assert.deepEqual((await state.connection.query('SELECT * FROM exam_paper'))[0], saved);
    await applyMigrations({ ...installed, migrations });
  } finally {
    await state.connection.end();
    await installed.connection.end();
  }
});

test('032 resumes after committed DDL without replaying it', async () => {
  const state = await stateFor();
  const target = migrations.find((migration) => migration.id === TARGET);
  try {
    await seed(state.connection);
    await assert.rejects(() => applyMigrations({ ...state, migrations, onCheckpoint({ event, migrationId, stepId }) {
      if (event === 'after-step-sql' && migrationId === TARGET && stepId === 'paper_updated_by') {
        throw new Error('paper operator DDL crash');
      }
    } }), /paper operator DDL crash/);
    await applyMigrations({ ...state, migrations, onCheckpoint({ event, migrationId, stepId }) {
      assert.ok(!(event === 'after-step-sql' && migrationId === TARGET && stepId === 'paper_updated_by'), 'committed DDL must not be replayed');
    } });
    const [[row]] = await state.connection.query('SELECT status,progress FROM schema_migration WHERE migration_id=?', [TARGET]);
    assert.equal(row.status, 'applied');
    assert.deepEqual(row.progress, target.steps.map((step) => step.id));
    const [[paper]] = await state.connection.query('SELECT created_by,updated_by FROM exam_paper WHERE id=501');
    assert.deepEqual(paper, { created_by: 9, updated_by: null });
  } finally {
    await state.connection.end();
  }
});

test('032 rejects a drifted updated_by shape without modifying migration history', async () => {
  const state = await stateFor();
  try {
    await applyMigrations({ ...state, migrations });
    await state.connection.query('ALTER TABLE exam_paper MODIFY updated_by BIGINT NULL');
    const [beforeRows] = await state.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    await assert.rejects(() => applyMigrations({ ...state, migrations }), /probe|invariant|check/i);
    const [afterRows] = await state.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    assert.deepEqual(afterRows, beforeRows);
  } finally {
    await state.connection.end();
  }
});
