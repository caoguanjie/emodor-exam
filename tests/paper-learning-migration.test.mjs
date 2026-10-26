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
const TARGET = '030_paper_learning_requirement';
const baseSql = execFileSync('git', ['show', 'a69d2dfa8598fa92c5b55fef106f81e0c35bdfe5:database/init.sql'], { encoding: 'utf8' });
const databases = new Set();
let migrations;
let services;
let admin;

before(async () => {
  migrations = await listMigrations();
  assert.ok(migrations.some((item) => item.id === TARGET), 'learning requirement migration must be registered');
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
  const database = `ruleexam_test_paper_learning_${randomBytes(5).toString('hex')}`;
  databases.add(database);
  const sql = current ? await readFile(new URL('../database/init.sql', import.meta.url), 'utf8') : baseSql;
  await admin.query(renderSchemaForDatabase(sql, database));
  const connection = await mysql.createConnection({ ...services.mysql, database });
  if (!current) await applyMigrations({ connection, database, migrations: migrations.filter((item) => item.id < TARGET) });
  return { connection, database };
}

async function columns(connection, table) {
  const [rows] = await connection.query('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [table]);
  return rows;
}

async function seed(connection) {
  await connection.query("INSERT INTO exam_paper (id,business_scope,mode,category_id,requires_learning,course_ids,title,created_by,created_at,updated_at) VALUES (501,'training','fixed',9,1,JSON_ARRAY('9'),'原有学习开关',9,'2026-01-01 00:00:00.000','2026-01-02 00:00:00.000')");
  await connection.query("INSERT INTO paper_release (id,paper_id,version_no,business_scope,mode,category_id,requires_learning,rule_snapshot,course_ids,created_by) VALUES (601,501,1,'training','fixed',9,1,JSON_OBJECT('maxAttempts',3),JSON_ARRAY('9'),9)");
}

test('030 keeps old facts and registry intact, matches init schema and safely reapplies', async () => {
  const state = await stateFor(); const installed = await stateFor(true);
  try {
    await seed(state.connection);
    const [papersBefore] = await state.connection.query('SELECT * FROM exam_paper');
    const [releasesBefore] = await state.connection.query('SELECT * FROM paper_release');
    const [registryBefore] = await state.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    await applyMigrations({ ...state, migrations });
    const [papers] = await state.connection.query('SELECT * FROM exam_paper');
    const [releases] = await state.connection.query('SELECT * FROM paper_release');
    assert.deepEqual(papers.map(({ required_learning_minutes, remark, ...row }) => row), papersBefore);
    assert.deepEqual(releases.map(({ required_learning_minutes, ...row }) => row), releasesBefore);
    assert.equal(papers[0].required_learning_minutes, null);
    assert.equal(papers[0].remark, null);
    assert.equal(releases[0].required_learning_minutes, null);
    const [registryAfter] = await state.connection.query('SELECT * FROM schema_migration WHERE migration_id < ? ORDER BY migration_id', [TARGET]);
    assert.deepEqual(registryAfter, registryBefore);
    for (const table of ['exam_paper', 'paper_release']) {
      assert.deepEqual(await columns(state.connection, table), await columns(installed.connection, table));
    }
    await state.connection.query("UPDATE exam_paper SET required_learning_minutes=60,remark='请携带学习笔记' WHERE id=501");
    await state.connection.query('UPDATE paper_release SET required_learning_minutes=60 WHERE id=601');
    const [savedPapers] = await state.connection.query('SELECT * FROM exam_paper');
    const [savedReleases] = await state.connection.query('SELECT * FROM paper_release');
    await applyMigrations({ ...state, migrations });
    assert.deepEqual((await state.connection.query('SELECT * FROM exam_paper'))[0], savedPapers);
    assert.deepEqual((await state.connection.query('SELECT * FROM paper_release'))[0], savedReleases);
    await applyMigrations({ ...installed, migrations });
  } finally { await state.connection.end(); await installed.connection.end(); }
});

for (const index of [0, 1]) test(`030 resumes after step ${index + 1} commits without replaying DDL`, async () => {
  const state = await stateFor();
  const target = migrations.find((migration) => migration.id === TARGET);
  const interrupted = target.steps[index].id;
  try {
    await seed(state.connection);
    await assert.rejects(() => applyMigrations({ ...state, migrations, onCheckpoint({ event, migrationId, stepId }) {
      if (event === 'after-step-sql' && migrationId === TARGET && stepId === interrupted) throw new Error('learning DDL crash');
    } }), /learning DDL crash/);
    await applyMigrations({ ...state, migrations, onCheckpoint({ event, migrationId, stepId }) {
      assert.ok(!(event === 'after-step-sql' && migrationId === TARGET && stepId === interrupted), 'committed DDL must not be replayed');
    } });
    const [[row]] = await state.connection.query('SELECT status,progress FROM schema_migration WHERE migration_id=?', [TARGET]);
    assert.equal(row.status, 'applied');
    assert.deepEqual(row.progress, target.steps.map((step) => step.id));
    const [[release]] = await state.connection.query('SELECT requires_learning,required_learning_minutes FROM paper_release WHERE id=601');
    assert.deepEqual(release, { requires_learning: 1, required_learning_minutes: null });
  } finally { await state.connection.end(); }
});

for (const [name, sql] of [
  ['threshold type', 'ALTER TABLE exam_paper MODIFY required_learning_minutes INT NULL'],
  ['remark length', 'ALTER TABLE exam_paper MODIFY remark VARCHAR(100) NULL'],
  ['release threshold default', 'ALTER TABLE paper_release MODIFY required_learning_minutes INT UNSIGNED NULL DEFAULT 1'],
  ['legacy paper index', 'ALTER TABLE exam_paper DROP INDEX idx_paper_training_pool'],
  ['legacy release index', 'ALTER TABLE paper_release DROP INDEX idx_paper_release_category'],
]) test(`030 rejects drift in ${name} without modifying migration history`, async () => {
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
