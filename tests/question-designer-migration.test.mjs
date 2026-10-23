import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { applyMigrations, listMigrations } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const ROOT = join(import.meta.dirname, '..');
// The actual execution baseline already contains 021. Never load a moving HEAD.
const BASE = '525790a62ac0654a2e4d91facc5cff5242ae33d9';
const MIGRATION_ID = '022_question_designer_storage';
const TABLES = ['question_version', 'exam_paper', 'question_authoring_commit'];
const databases = new Set();
let services;
let admin;

before(async () => {
  services = await createEphemeralServices();
  console.log(`[owned-ephemeral] root=${services.root} mysqlPid=${services.mysqlPid} redisPid=${services.redisPid}`);
  admin = await mysql.createConnection({ ...services.mysql, multipleStatements: true });
});

after(async () => {
  for (const database of databases) await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
  await admin?.end().catch(() => undefined);
  await services?.stopProcesses();
  for (const pid of [services?.mysqlPid, services?.redisPid]) {
    if (!pid) continue;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
  await services?.cleanup();
  if (services) {
    assert.equal(existsSync(services.root), false);
    console.log(`[owned-ephemeral] stopped mysqlPid=${services.mysqlPid} redisPid=${services.redisPid}; removed exact root=${services.root}`);
  }
});

async function createDatabase(label, current = false) {
  const database = `ruleexam_test_designer_${label}_${randomBytes(4).toString('hex')}`;
  databases.add(database);
  const sql = current
    ? await readFile(join(ROOT, 'database/init.sql'), 'utf8')
    : execFileSync('git', ['show', `${BASE}:database/init.sql`], { cwd: ROOT, encoding: 'utf8' });
  await admin.query(renderSchemaForDatabase(sql, database));
  const connection = await mysql.createConnection({ ...services.mysql, database });
  return { database, connection };
}

function runCli(database, mode) {
  // These values come only from this test's owned services, never from .env.
  return spawnSync(process.execPath, ['database/migrate.mjs', mode], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_HOST: services.mysql.host,
      DB_PORT: String(services.mysql.port),
      DB_USERNAME: services.mysql.user,
      DB_PASSWORD: services.mysql.password,
      DB_DATABASE: database,
    },
    encoding: 'utf8',
  });
}

async function storageSchema(connection) {
  const params = TABLES.map(() => '?').join(',');
  const [tables] = await connection.query(
    `SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${params}) ORDER BY TABLE_NAME`, TABLES,
  );
  const [columns] = await connection.query(
    `SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLUMN_COMMENT,CHARACTER_SET_NAME,COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${params}) ORDER BY TABLE_NAME,ORDINAL_POSITION`, TABLES,
  );
  const [indexes] = await connection.query(
    `SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${params}) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`, TABLES,
  );
  return { tables, columns, indexes };
}

async function seedHistory(connection) {
  await connection.query("INSERT INTO question (id,type,stem,options,answer,score,status,source,created_by,difficulty,current_version_id) VALUES (501,'single','历史中级题',JSON_ARRAY(JSON_OBJECT('key','A','text','甲'),JSON_OBJECT('key','B','text','乙')),JSON_ARRAY(0),100,'approved','manual',9,'medium',601)");
  await connection.query("INSERT INTO question_version (id,question_id,revision,type,stem,options,answer,score_cents,status,source,created_by,difficulty) VALUES (601,501,1,'single','不可变原题',JSON_ARRAY(JSON_OBJECT('key','A','text','甲'),JSON_OBJECT('key','B','text','乙')),JSON_ARRAY(0),10000,'approved','manual',9,'medium')");
  await connection.query("INSERT INTO exam_paper (id,title,status,created_by,business_scope,mode) VALUES (701,'历史已发布卷','published',9,'training','fixed')");
  await connection.query("INSERT INTO paper_release (id,paper_id,version_no,business_scope,mode,rule_snapshot,created_by) VALUES (801,701,1,'training','fixed',JSON_OBJECT('passCents',6000),9)");
  await connection.query("INSERT INTO paper_release_question (id,release_id,question_id,question_version_id,type,difficulty,score_cents,snapshot_json) VALUES (901,801,501,601,'single','medium',10000,JSON_OBJECT('stem','发布原题','answer',JSON_ARRAY(0),'difficulty','medium'))");
  await connection.query("INSERT INTO exam_record (id,paper_id,user_id,status,score,started_at,deadline_at,submitted_at,grading_state,graded_at) VALUES (1001,701,11,'passed',100,'2026-01-01 10:00:00.000','2026-01-01 10:30:00.000','2026-01-01 10:05:00.000','finalized','2026-01-01 10:05:00.000')");
  await connection.query("INSERT INTO exam_record_question (id,record_id,question_id,question_version_id,type,difficulty,score_cents,position,display_to_original,snapshot_json) VALUES (1101,1001,501,601,'single','medium',10000,0,JSON_ARRAY(1,0),JSON_OBJECT('stem','个人冻结题','answer',JSON_ARRAY(0)))");
  await connection.query("INSERT INTO exam_answer (exam_record_id,question_id,record_question_id,selected,is_correct,gained_score) VALUES (1001,501,1101,JSON_ARRAY(0),1,100)");
}

async function historyDigest(connection) {
  const facts = {};
  for (const table of ['question', 'question_version', 'exam_paper', 'paper_release', 'paper_release_question', 'exam_record', 'exam_record_question', 'exam_answer']) {
    const [rows] = await connection.query(`SELECT * FROM \`${table}\` ORDER BY id`);
    facts[table] = rows.map(({ authoring_schema_version, authoring_json, designer_layout, ...legacy }) => legacy);
  }
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}

test('022 upgrade preserves history, check is read-only, and repeat apply matches new installation', async () => {
  const upgraded = await createDatabase('upgrade');
  const installed = await createDatabase('init', true);
  try {
    await seedHistory(upgraded.connection);
    const beforeDigest = await historyDigest(upgraded.connection);
    const beforeSchema = await storageSchema(upgraded.connection);
    const [beforeRegistry] = await upgraded.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    const check = runCli(upgraded.database, '--check');
    assert.equal(check.status, 0, check.stderr);
    assert.deepEqual(await storageSchema(upgraded.connection), beforeSchema, '--check must not change storage');
    const [afterCheckRegistry] = await upgraded.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    assert.deepEqual(afterCheckRegistry, beforeRegistry, '--check must not write registry');

    const applied = runCli(upgraded.database, '--apply');
    assert.equal(applied.status, 0, applied.stderr);
    const schema = await storageSchema(upgraded.connection);
    for (const [table, column] of [['question_version', 'authoring_schema_version'], ['question_version', 'authoring_json'], ['exam_paper', 'designer_layout']]) {
      assert.ok(schema.columns.some((row) => row.TABLE_NAME === table && row.COLUMN_NAME === column), `missing ${table}.${column}`);
    }
    assert.ok(schema.tables.some((row) => row.TABLE_NAME === 'question_authoring_commit'), 'missing durable authoring receipts');
    assert.ok(JSON.parse(check.stdout).pending.includes(MIGRATION_ID));
    assert.equal(await historyDigest(upgraded.connection), beforeDigest);
    const [[oldVersion]] = await upgraded.connection.query('SELECT authoring_schema_version,authoring_json FROM question_version WHERE id=601');
    assert.deepEqual(oldVersion, { authoring_schema_version: null, authoring_json: null });
    const [[oldPaper]] = await upgraded.connection.query('SELECT designer_layout FROM exam_paper WHERE id=701');
    assert.equal(oldPaper.designer_layout, null);
    assert.deepEqual(schema, await storageSchema(installed.connection));
    const [[copies]] = await upgraded.connection.query("SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='question' AND COLUMN_NAME IN ('authoring_json','authoring_schema_version')");
    assert.equal(Number(copies.count), 0, 'authoring belongs only to immutable versions');
    const [beforeRepeat] = await upgraded.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    const repeated = runCli(upgraded.database, '--apply');
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(JSON.parse(repeated.stdout).applied, []);
    const [afterRepeat] = await upgraded.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
    assert.deepEqual(afterRepeat, beforeRepeat);
    assert.equal(await historyDigest(upgraded.connection), beforeDigest);
    console.log(`[022-history] before=${beforeDigest} after=${await historyDigest(upgraded.connection)}`);
  } finally {
    await upgraded.connection.end();
    await installed.connection.end();
  }
});

test('022 resumes every DDL-before-progress interruption without replaying completed DDL', async () => {
  const migrations = await listMigrations();
  const target = migrations.find((item) => item.id === MIGRATION_ID);
  assert.ok(target, 'missing 022 storage migration');
  for (const interruptedStep of target.steps) {
    const { connection, database } = await createDatabase(`resume_${interruptedStep.id}`);
    try {
      await assert.rejects(() => applyMigrations({
        connection, database, migrations,
        onCheckpoint({ event, migrationId, stepId }) {
          if (event === 'after-step-sql' && migrationId === target.id && stepId === interruptedStep.id) throw new Error('simulated DDL crash');
        },
      }), /simulated DDL crash/);
      const [[interrupted]] = await connection.query('SELECT status,progress FROM schema_migration WHERE migration_id=?', [target.id]);
      assert.equal(interrupted.status, 'failed');
      assert.ok(!interrupted.progress.includes(interruptedStep.id));
      await applyMigrations({
        connection, database, migrations,
        onCheckpoint({ event, migrationId, stepId }) {
          assert.ok(!(event === 'after-step-sql' && migrationId === target.id && stepId === interruptedStep.id), 'completed DDL must be detected, not replayed');
        },
      });
      const [[completed]] = await connection.query('SELECT status,progress FROM schema_migration WHERE migration_id=?', [target.id]);
      assert.equal(completed.status, 'applied');
      assert.deepEqual(completed.progress, target.steps.map((step) => step.id));
    } finally {
      await connection.end();
    }
  }
});

test('022 rejects wrong same-name columns, index and timestamps without rewriting rows', async () => {
  const cases = [
    ['version_type', 'ALTER TABLE question_version MODIFY authoring_schema_version BIGINT NULL'],
    ['authoring_type', 'ALTER TABLE question_version MODIFY authoring_json LONGTEXT NULL'],
    ['layout_type', 'ALTER TABLE exam_paper MODIFY designer_layout LONGTEXT NULL'],
    ['receipt_index', 'ALTER TABLE question_authoring_commit DROP INDEX uk_question_authoring_commit_owner_request, ADD UNIQUE KEY uk_question_authoring_commit_owner_request (request_id,content_hash)'],
    ['receipt_time', "ALTER TABLE question_authoring_commit MODIFY created_at DATETIME(3) NOT NULL DEFAULT '2000-01-01 00:00:00.000'"],
  ];
  for (const [label, alter] of cases) {
    const { connection, database } = await createDatabase(label, true);
    try {
      await seedHistory(connection);
      const digest = await historyDigest(connection);
      await connection.query(alter);
      const wrong = await storageSchema(connection);
      const applied = runCli(database, '--apply');
      assert.notEqual(applied.status, 0, `accepted wrong ${label}`);
      assert.equal(await historyDigest(connection), digest);
      assert.deepEqual(await storageSchema(connection), wrong, `rewrote wrong ${label} instead of refusing it`);
    } finally {
      await connection.end();
    }
  }
});

test('022 receipts round-trip results, enforce owner/request uniqueness, and retain old success facts', async () => {
  const { connection, database } = await createDatabase('receipt', true);
  try {
    const receipt = { request_id: 'same-request', bundle: { document: {}, option_ids: {}, identities: {}, layouts: {} }, items: [{ client_id: 'q1', question_id: '501', saved_version_id: '601', revision: 1 }] };
    await connection.execute('INSERT INTO question_authoring_commit (owner_id,request_id,content_hash,result_json,created_at) VALUES (9,?,?,?,?)', ['same-request', 'a'.repeat(64), JSON.stringify(receipt), '2000-01-01 00:00:00.123']);
    await assert.rejects(() => connection.execute('INSERT INTO question_authoring_commit (owner_id,request_id,content_hash,result_json) VALUES (9,?,?,?)', ['same-request', 'b'.repeat(64), JSON.stringify(receipt)]), { code: 'ER_DUP_ENTRY' });
    await connection.execute('INSERT INTO question_authoring_commit (owner_id,request_id,content_hash,result_json) VALUES (10,?,?,?)', ['same-request', 'a'.repeat(64), JSON.stringify(receipt)]);
    const [before] = await connection.query('SELECT * FROM question_authoring_commit ORDER BY id');
    const result = runCli(database, '--apply');
    assert.equal(result.status, 0, result.stderr);
    const [afterApply] = await connection.query('SELECT * FROM question_authoring_commit ORDER BY id');
    assert.deepEqual(afterApply, before, 'receipts must not expire during migration');
    assert.deepEqual(afterApply[0].result_json, receipt);
    const [[foreignKeys]] = await connection.query("SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='question_authoring_commit'");
    assert.equal(Number(foreignKeys.count), 0);
  } finally {
    await connection.end();
  }
});

test('022 supports rollback and completion of a transaction-local receipt reservation', async () => {
  const { connection } = await createDatabase('reservation', true);
  const requestId = '5e8f3339-00d7-45f9-8e90-a4629e0b4974';
  try {
    const [[column]] = await connection.query("SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='question_authoring_commit' AND COLUMN_NAME='result_json'");
    assert.equal(column.IS_NULLABLE, 'YES', 'receipt reservation requires nullable result_json');
    await connection.beginTransaction();
    await connection.execute('INSERT INTO question_authoring_commit (owner_id,request_id,content_hash,result_json) VALUES (9,?,?,NULL)', [requestId, 'a'.repeat(64)]);
    await connection.rollback();
    const [[rolledBack]] = await connection.query('SELECT COUNT(*) AS count FROM question_authoring_commit');
    assert.equal(Number(rolledBack.count), 0, 'failed writes must not retain reservations');

    const receipt = { request_id: requestId, bundle: { document: { schema_version: 1, content: { type: 'doc', content: [] }, questions: {} }, option_ids: {}, identities: {}, layouts: {} }, items: [] };
    await connection.beginTransaction();
    await connection.execute('INSERT INTO question_authoring_commit (owner_id,request_id,content_hash,result_json) VALUES (9,?,?,NULL)', [requestId, 'a'.repeat(64)]);
    await connection.execute('UPDATE question_authoring_commit SET result_json=? WHERE owner_id=9 AND request_id=?', [JSON.stringify(receipt), requestId]);
    await connection.commit();
    const [[saved]] = await connection.query('SELECT result_json FROM question_authoring_commit WHERE owner_id=9 AND request_id=?', [requestId]);
    assert.deepEqual(saved.result_json, receipt);
  } finally {
    await connection.rollback();
    await connection.end();
  }
});
