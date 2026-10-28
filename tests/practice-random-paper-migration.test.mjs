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
const TARGET = '043_practice_random_exam';
const baseSql = execFileSync('git', ['show', '1f07cd731661f146d95a7ad1d92b4ed8dd454b8c:database/init.sql'], { encoding: 'utf8' });
const databases = new Set();
let migrations, services, admin;

before(async () => {
  migrations = await listMigrations();
  assert.ok(migrations.some(row => row.id === TARGET), 'practice migration must exist');
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
  const database = `ruleexam_test_practice_${randomBytes(5).toString('hex')}`;
  databases.add(database);
  await admin.query(renderSchemaForDatabase(current ? await readFile(new URL('../database/init.sql', import.meta.url), 'utf8') : baseSql, database));
  const connection = await mysql.createConnection({ ...services.mysql, database });
  if (!current) await applyMigrations({ connection, database, migrations: migrations.filter(row => row.id < TARGET) });
  return { connection, database };
}

async function seed(connection) {
  await connection.query("INSERT INTO exam_paper(id,business_scope,mode,category_id,title,created_by,updated_at) VALUES(501,'training','random',7,'existing category random',1,'2026-10-20 12:00:00.000')");
  await connection.query("INSERT INTO paper_release(id,paper_id,version_no,business_scope,mode,category_id,rule_snapshot,created_by) VALUES(601,501,1,'training','random',7,JSON_OBJECT('maxAttempts',3),1)");
  await connection.query("INSERT INTO exam_record(id,paper_id,user_id,release_id,rule_snapshot,score,status,grading_state,started_at,deadline_at) VALUES(801,501,1,601,JSON_OBJECT('maxAttempts',3),60.00,'passed','finalized','2026-10-20 12:00:00','2026-10-20 12:30:00')");
  await connection.query("INSERT INTO exam_assignment(id,paper_id,user_id,release_id,difficulty,rule_snapshot,snapshot_origin) VALUES(701,501,1,601,'easy',JSON_OBJECT('maxAttempts',3),'release')");
}

async function columns(connection, table) {
  return (await connection.query('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [table]))[0];
}

test('043 defaults historical purposes to formal, preserves facts, matches init and safely reapplies', async () => {
  const state = await stateFor(), installed = await stateFor(true);
  try {
    await seed(state.connection);
    const before = {};
    for (const table of ['exam_paper', 'paper_release', 'exam_record', 'exam_assignment', 'schema_migration']) before[table] = (await state.connection.query(`SELECT * FROM ${table}`))[0];
    await applyMigrations({ ...state, migrations });
    for (const table of ['exam_paper', 'paper_release', 'exam_record']) {
      const [rows] = await state.connection.query(`SELECT * FROM ${table}`);
      assert.equal(rows[0].exam_purpose, 'formal');
      assert.deepEqual(rows.map(({ exam_purpose, ...row }) => row), before[table]);
      assert.deepEqual(await columns(state.connection, table), await columns(installed.connection, table));
    }
    assert.deepEqual((await state.connection.query('SELECT * FROM exam_assignment'))[0], before.exam_assignment);
    assert.deepEqual((await state.connection.query('SELECT * FROM schema_migration WHERE migration_id < ?', [TARGET]))[0], before.schema_migration);
    await state.connection.query("INSERT INTO exam_paper(id,business_scope,exam_purpose,mode,pool_scope,category_id,title,max_attempts,created_by) VALUES(502,'training','practice','random','public',NULL,'practice',NULL,1)");
    const [[practice]] = await state.connection.query('SELECT max_attempts FROM exam_paper WHERE id=502');
    assert.equal(practice.max_attempts, null);
    await state.connection.query("INSERT INTO paper_release(id,paper_id,version_no,business_scope,mode,pool_scope,category_id,rule_snapshot,created_by) VALUES(602,502,1,'training','random','public',NULL,JSON_OBJECT('maxAttempts',3),1)");
    const [papers] = await state.connection.query('SELECT * FROM exam_paper ORDER BY id');
    const [releases] = await state.connection.query('SELECT * FROM paper_release ORDER BY id');
    assert.deepEqual((await applyMigrations({ ...state, migrations })).applied, []);
    assert.deepEqual((await state.connection.query('SELECT * FROM exam_paper ORDER BY id'))[0], papers);
    assert.deepEqual((await state.connection.query('SELECT * FROM paper_release ORDER BY id'))[0], releases);
    await applyMigrations({ ...installed, migrations });
  } finally { await state.connection.end(); await installed.connection.end(); }
});

for (const index of [0, 1, 2]) test(`043 resumes after purpose DDL step ${index + 1} commits`, async () => {
  const state = await stateFor(), target = migrations.find(row => row.id === TARGET);
  const stepId = target.steps[index].id;
  try {
    await seed(state.connection);
    await assert.rejects(() => applyMigrations({ ...state, migrations, onCheckpoint(event) {
      if (event.event === 'after-step-sql' && event.migrationId === TARGET && event.stepId === stepId) throw new Error('purpose DDL crash');
    } }), /purpose DDL crash/);
    await applyMigrations({ ...state, migrations, onCheckpoint(event) {
      assert.ok(!(event.event === 'after-step-sql' && event.migrationId === TARGET && event.stepId === stepId), 'committed DDL must not replay');
    } });
    const [[row]] = await state.connection.query('SELECT status,progress FROM schema_migration WHERE migration_id=?', [TARGET]);
    assert.equal(row.status, 'applied');
    assert.deepEqual(row.progress, target.steps.map(step => step.id));
  } finally { await state.connection.end(); }
});

for (const [name, sql] of [
  ['paper purpose default', "ALTER TABLE exam_paper MODIFY exam_purpose VARCHAR(16) NOT NULL DEFAULT 'practice'"],
  ['release purpose nullable', "ALTER TABLE paper_release MODIFY exam_purpose VARCHAR(16) NULL DEFAULT 'formal'"],
  ['record purpose width', "ALTER TABLE exam_record MODIFY exam_purpose VARCHAR(32) NOT NULL DEFAULT 'formal'"],
  ['paper max attempts nullability', 'ALTER TABLE exam_paper MODIFY max_attempts INT NOT NULL DEFAULT 3'],
  ['old paper index', 'ALTER TABLE exam_paper DROP INDEX idx_paper_training_pool'],
  ['old release index', 'ALTER TABLE paper_release DROP INDEX idx_paper_release_category'],
  ['old record index', 'ALTER TABLE exam_record DROP INDEX uk_active_assignment'],
]) test(`043 rejects ${name} drift without rewriting registry`, async () => {
  const state = await stateFor();
  try {
    await applyMigrations({ ...state, migrations });
    await state.connection.query(sql);
    const [before] = await state.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    await assert.rejects(() => applyMigrations({ ...state, migrations }), /probe|invariant|check/i);
    assert.deepEqual((await state.connection.query('SELECT * FROM schema_migration ORDER BY migration_id'))[0], before);
  } finally { await state.connection.end(); }
});
