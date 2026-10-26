import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { applyMigrations, listMigrations } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const mysql = createRequire(new URL('../server/package.json', import.meta.url))('mysql2/promise');
// Frozen pre-025 baseline, including 024. Never use a moving HEAD for upgrade evidence.
const BASE = '9471cc9164c9d79e8a140cb9f68ab0e7b74fb706';
const TARGET = '025_question_bank_without_scores';
const databases = new Set();
let services;
let admin;
let migrations;

before(async () => {
  migrations = await listMigrations();
  services = await createEphemeralServices();
  admin = await mysql.createConnection({ ...services.mysql, multipleStatements: true });
});

after(async () => {
  for (const database of databases) await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
  await admin?.end().catch(() => undefined);
  await services?.stopProcesses();
  for (const pid of [services?.mysqlPid, services?.redisPid]) {
    if (pid) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
  await services?.cleanup();
  if (services) assert.equal(existsSync(services.root), false);
});

async function databaseFor(label, current = false) {
  const database = `ruleexam_test_scoreless_${label}_${randomBytes(4).toString('hex')}`;
  databases.add(database);
  const sql = current
    ? await readFile(new URL('../database/init.sql', import.meta.url), 'utf8')
    : execFileSync('git', ['show', `${BASE}:database/init.sql`], { encoding: 'utf8' });
  await admin.query(renderSchemaForDatabase(sql, database));
  const connection = await mysql.createConnection({ ...services.mysql, database });
  if (!current) await applyMigrations({ connection, database, migrations: migrations.filter((item) => item.id < TARGET) });
  return { connection, database };
}

async function seedHistory(connection) {
  await connection.query("INSERT INTO question (id,type,stem,options,answer,score,status,source,created_by,difficulty,current_version_id) VALUES (501,'single','历史题',JSON_ARRAY(JSON_OBJECT('key','A','text','甲'),JSON_OBJECT('key','B','text','乙')),JSON_ARRAY(0),5,'approved','manual',9,'easy',601)");
  await connection.query("INSERT INTO question_version (id,question_id,revision,type,stem,options,answer,score_cents,status,source,created_by,difficulty,authoring_schema_version,authoring_json) VALUES (601,501,1,'single','不可变原题',JSON_ARRAY(JSON_OBJECT('key','A','text','甲'),JSON_OBJECT('key','B','text','乙')),JSON_ARRAY(0),500,'approved','manual',9,'easy',1,JSON_OBJECT('legacy_score_cents',500))");
  await connection.query("INSERT INTO exam_paper (id,title,status,created_by,business_scope,mode) VALUES (701,'历史已发布卷','published',9,'training','fixed')");
  await connection.query("INSERT INTO paper_release (id,paper_id,version_no,business_scope,mode,rule_snapshot,created_by) VALUES (801,701,1,'training','fixed',JSON_OBJECT('passCents',6000),9)");
  await connection.query("INSERT INTO paper_release_question (id,release_id,question_id,question_version_id,type,difficulty,score_cents,snapshot_json) VALUES (901,801,501,601,'single','easy',2000,JSON_OBJECT('stem','发布原题','answer',JSON_ARRAY(0),'score',2000))");
  await connection.query("INSERT INTO exam_record (id,paper_id,user_id,status,score,started_at,deadline_at,submitted_at,grading_state,graded_at) VALUES (1001,701,11,'passed',20,'2026-01-01 10:00:00.000','2026-01-01 10:30:00.000','2026-01-01 10:05:00.000','finalized','2026-01-01 10:05:00.000')");
  await connection.query("INSERT INTO exam_record_question (id,record_id,question_id,question_version_id,type,difficulty,score_cents,position,display_to_original,snapshot_json) VALUES (1101,1001,501,601,'single','easy',2000,0,JSON_ARRAY(1,0),JSON_OBJECT('stem','个人冻结题','answer',JSON_ARRAY(0),'score',2000))");
  await connection.query("INSERT INTO exam_answer (exam_record_id,question_id,record_question_id,selected,is_correct,gained_score) VALUES (1001,501,1101,JSON_ARRAY(0),1,20)");
}

async function historyDigest(connection) {
  const facts = {};
  for (const table of ['question', 'question_version', 'exam_paper', 'paper_release', 'paper_release_question', 'exam_record', 'exam_record_question', 'exam_answer']) {
    [facts[table]] = await connection.query(`SELECT * FROM \`${table}\` ORDER BY id`);
  }
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

async function scoreColumns(connection) {
  const [rows] = await connection.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='question' AND COLUMN_NAME='score') OR (TABLE_NAME='question_version' AND COLUMN_NAME='score_cents')) ORDER BY TABLE_NAME");
  return rows;
}

test('025 upgrades and re-runs without changing legacy questions, authoring, releases or results', async () => {
  const upgraded = await databaseFor('upgrade');
  const installed = await databaseFor('init', true);
  try {
    await seedHistory(upgraded.connection);
    const digest = await historyDigest(upgraded.connection);
    await applyMigrations({ ...upgraded, migrations });
    assert.equal(await historyDigest(upgraded.connection), digest);
    assert.deepEqual(await scoreColumns(upgraded.connection), await scoreColumns(installed.connection));
    assert.ok((await scoreColumns(upgraded.connection)).every((column) => column.IS_NULLABLE === 'YES' && column.COLUMN_DEFAULT === null));
    const [registry] = await upgraded.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    await applyMigrations({ ...upgraded, migrations });
    const [repeated] = await upgraded.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    assert.deepEqual(repeated, registry);
    assert.equal(await historyDigest(upgraded.connection), digest);
    // Fresh installation must adopt the whole historical chain, not replay old ALTERs.
    await applyMigrations({ ...installed, migrations });
    const [[adopted]] = await installed.connection.query('SELECT status FROM schema_migration WHERE migration_id=?', [TARGET]);
    assert.equal(adopted.status, 'applied');
  } finally {
    await upgraded.connection.end();
    await installed.connection.end();
  }
});

test('025 resumes each DDL-before-progress crash and keeps all old values', async () => {
  const target = migrations.find((item) => item.id === TARGET);
  assert.ok(target);
  for (const step of target.steps) {
    const state = await databaseFor(`resume_${step.id}`);
    try {
      await seedHistory(state.connection);
      const digest = await historyDigest(state.connection);
      await assert.rejects(() => applyMigrations({ ...state, migrations,
        onCheckpoint({ event, migrationId, stepId }) {
          if (event === 'after-step-sql' && migrationId === TARGET && stepId === step.id) throw new Error('simulated 025 DDL crash');
        },
      }), /simulated 025 DDL crash/);
      await applyMigrations({ ...state, migrations,
        onCheckpoint({ event, migrationId, stepId }) {
          assert.ok(!(event === 'after-step-sql' && migrationId === TARGET && stepId === step.id), 'completed DDL was replayed');
        },
      });
      assert.equal(await historyDigest(state.connection), digest);
      const [[row]] = await state.connection.query('SELECT status,progress FROM schema_migration WHERE migration_id=?', [TARGET]);
      assert.equal(row.status, 'applied');
      assert.deepEqual(row.progress, target.steps.map((item) => item.id));
    } finally { await state.connection.end(); }
  }
});

test('025 successor probes retain old index and column shape checks', async () => {
  for (const [label, alter] of [
    ['index', 'ALTER TABLE question DROP INDEX idx_question_category_pool'],
    ['authoring', 'ALTER TABLE question_version MODIFY authoring_json LONGTEXT NULL'],
  ]) {
    const state = await databaseFor(label, true);
    try {
      await seedHistory(state.connection);
      await state.connection.query(alter);
      const digest = await historyDigest(state.connection);
      await assert.rejects(() => applyMigrations({ ...state, migrations }));
      assert.equal(await historyDigest(state.connection), digest, 'invalid structure must not rewrite history');
    } finally { await state.connection.end(); }
  }
});
