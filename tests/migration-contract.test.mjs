import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  applyMigrations,
  getMigrationChecksum,
  getMigrationLockName,
  inspectMigrations,
  listMigrations,
  parseMigrationText,
  validateMigrationTarget,
  REGISTRY_TABLE,
} from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const ROOT = join(import.meta.dirname, '..');
const initSql = readFileSync(join(ROOT, 'database', 'init.sql'), 'utf8');
const migrationTable = 'schema_migration';

let services;
let admin;
const databases = new Set();

before(async () => {
  services = await createEphemeralServices();
  console.log(`[owned-ephemeral] root=${services.root} mysqlPid=${services.mysqlPid} redisPid=${services.redisPid}`);
  admin = await mysql.createConnection({
    host: services.mysql.host,
    port: services.mysql.port,
    user: services.mysql.user,
    password: services.mysql.password,
    multipleStatements: true,
  });
});

after(async () => {
  const owned = services && {
    root: services.root,
    mysqlPid: services.mysqlPid,
    redisPid: services.redisPid,
  };
  for (const database of databases) {
    await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
  }
  await admin?.end().catch(() => undefined);
  await services?.stopProcesses();
  if (owned) {
    for (const [name, pid] of [['mysql', owned.mysqlPid], ['redis', owned.redisPid]]) {
      assert.equal(isProcessRunning(pid), false, `owned ephemeral ${name} process ${pid} must stop before cleanup`);
    }
  }
  await services?.cleanup();
  if (owned) {
    assert.equal(existsSync(owned.root), false, `owned ephemeral root must be removed exactly: ${owned.root}`);
    console.log(`[owned-ephemeral] stopped mysqlPid=${owned.mysqlPid} redisPid=${owned.redisPid}; removed exact root=${owned.root}`);
  }
});

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function createDatabase(suffix = randomBytes(5).toString('hex')) {
  const database = `ruleexam_test_${suffix}`;
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
    multipleStatements: true,
  });
}

async function migration(id = '000_migration_registry') {
  return (await listMigrations()).find((item) => item.id === id);
}

function fixtureMigration(id, text) {
  return parseMigrationText(id, text);
}

function emptySchemaConnection(database) {
  return {
    async query(sql) {
      assert.match(sql, /SELECT DATABASE\(\)/i);
      return [[{ database_name: database }]];
    },
    async execute(sql) {
      assert.match(sql, /INFORMATION_SCHEMA\.TABLES/i);
      return [[{ present: 0 }]];
    },
  };
}

function replacementFixture(id, stepId, target = undefined) {
  const replacement = target ? `\n-- @replaces-check ${target}` : '';
  return fixtureMigration(id, `
-- @step ${stepId}${replacement}
-- @check SELECT 0 AS complete;
CREATE TABLE ${stepId} (id INT PRIMARY KEY);
`);
}

test('replacement-check metadata is parsed and preserved on a migration step', () => {
  const successor = replacementFixture('002_successor', 'successor_shape', '001_target/target_shape');
  assert.equal(successor.steps[0].replacesCheck, '001_target/target_shape');

  for (const sql of [
    `-- @step successor\n-- @replaces-check\n-- @check SELECT 0 AS complete;\nCREATE TABLE successor (id INT PRIMARY KEY);`,
    `-- @step successor\n-- @replaces-check 001_target/target_shape/extra\n-- @check SELECT 0 AS complete;\nCREATE TABLE successor (id INT PRIMARY KEY);`,
    `-- @step successor\n-- @replaces-check 001_target/target_shape\n-- @replaces-check 001_target/other_shape\n-- @check SELECT 0 AS complete;\nCREATE TABLE successor (id INT PRIMARY KEY);`,
  ]) {
    assert.throws(() => parseMigrationText('002_successor', sql), /replaces-check|replacement/i);
  }
});

test('replacement-check definitions accept one linear predecessor chain', async () => {
  const database = 'ruleexam_test_replacement_chain';
  const target = replacementFixture('001_target', 'target_shape');
  const successor = replacementFixture('002_successor', 'successor_shape', '001_target/target_shape');
  const latest = replacementFixture('003_latest', 'latest_shape', '002_successor/successor_shape');
  const inspected = await inspectMigrations({
    connection: emptySchemaConnection(database),
    database,
    migrations: [target, successor, latest],
  });
  assert.deepEqual(inspected.pending.map((migrationDefinition) => migrationDefinition.id), [
    '001_target', '002_successor', '003_latest',
  ]);
});

test('replacement-check definitions reject unknown, same-level, forward, cyclic, and forked targets', async () => {
  const database = 'ruleexam_test_replacement_validation';
  const connection = emptySchemaConnection(database);
  const target = replacementFixture('001_target', 'target_shape');
  const unknown = replacementFixture('002_unknown', 'unknown_shape', '001_target/missing_shape');
  await assert.rejects(
    () => inspectMigrations({ connection, database, migrations: [target, unknown] }),
    /unknown.*replaces-check|replaces-check.*unknown|target.*not found/i,
  );

  const sameLevel = fixtureMigration('002_same_level', `
-- @step first_shape
-- @check SELECT 0 AS complete;
CREATE TABLE first_shape (id INT PRIMARY KEY);
-- @step second_shape
-- @replaces-check 002_same_level/first_shape
-- @check SELECT 0 AS complete;
CREATE TABLE second_shape (id INT PRIMARY KEY);
`);
  await assert.rejects(
    () => inspectMigrations({ connection, database, migrations: [sameLevel] }),
    /same migration|earlier migration|same-level/i,
  );

  const forward = replacementFixture('001_forward', 'forward_shape', '002_later/later_shape');
  const later = replacementFixture('002_later', 'later_shape');
  await assert.rejects(
    () => inspectMigrations({ connection, database, migrations: [forward, later] }),
    /earlier migration|forward|reverse/i,
  );

  const reversedIdTarget = replacementFixture('002_reversed_target', 'reversed_target');
  const reversedIdSuccessor = replacementFixture(
    '001_reversed_successor',
    'reversed_successor',
    '002_reversed_target/reversed_target',
  );
  await assert.rejects(
    () => inspectMigrations({
      connection,
      database,
      migrations: [reversedIdTarget, reversedIdSuccessor],
    }),
    /earlier migration|file order|migration id|forward|reverse/i,
  );

  const cycleA = replacementFixture('001_cycle_a', 'cycle_a', '002_cycle_b/cycle_b');
  const cycleB = replacementFixture('002_cycle_b', 'cycle_b', '001_cycle_a/cycle_a');
  await assert.rejects(
    () => inspectMigrations({ connection, database, migrations: [cycleA, cycleB] }),
    /cycle|cyclic/i,
  );

  const branchA = replacementFixture('002_branch_a', 'branch_a', '001_target/target_shape');
  const branchB = replacementFixture('003_branch_b', 'branch_b', '001_target/target_shape');
  await assert.rejects(
    () => inspectMigrations({ connection, database, migrations: [target, branchA, branchB] }),
    /fork|branch|multiple.*successor|already replaced/i,
  );

  const malformedDefinition = {
    id: '002_malformed',
    checksum: 'a'.repeat(64),
    steps: [{
      id: 'malformed_shape',
      sql: 'CREATE TABLE malformed_shape (id INT PRIMARY KEY)',
      checkSql: 'SELECT 0 AS complete',
      replacesCheck: 42,
    }],
  };
  await assert.rejects(
    () => inspectMigrations({ connection, database, migrations: [target, malformedDefinition] }),
    /replaces-check|replacement/i,
  );
});

test('010 answer migration exposes stable probed steps without reinterpreting legacy rows', async () => {
  const answers = await migration('010_answers');
  assert.ok(answers);
  assert.deepEqual(answers.steps.map((step) => step.id), [
    'extend_exam_answer_draft',
    'extend_exam_record_submission',
    'copy_snapshot_item_identity',
    'index_exam_answer_item',
    'drop_legacy_record_question_index',
    'restore_snapshot_source_identity',
    'restore_legacy_record_question_index',
    'mark_proven_legacy_finalized',
  ]);
  assert.equal(
    answers.steps.find((step) => step.id === 'extend_exam_record_submission').replacesCheck,
    '009_attempt_snapshot/extend_exam_record_attempt_snapshot',
  );
});

const correctMediaAssetFixture = `CREATE TABLE media_asset (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  purpose VARCHAR(32) NOT NULL,
  media_kind VARCHAR(16) NOT NULL,
  original_name VARCHAR(255) NULL,
  mime_type VARCHAR(128) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'processing',
  duration_ms BIGINT UNSIGNED NULL,
  probe_error VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_media_asset_storage_key (storage_key),
  KEY idx_media_asset_owner_purpose (owner_id, purpose),
  KEY idx_media_asset_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

const correctMediaReferenceFixture = `CREATE TABLE media_reference (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  asset_id BIGINT UNSIGNED NOT NULL,
  owner_type VARCHAR(64) NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_media_reference_owner (asset_id, owner_type, owner_id),
  KEY idx_media_reference_asset (asset_id),
  KEY idx_media_reference_owner (owner_type, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

test('010 upgrades completed C2 answers by record-scoped item identity without changing legacy collisions or scores', async () => {
  const database = await createDatabase('answers_' + randomBytes(3).toString('hex'));
  const c2Sql = execFileSync(
    'git',
    ['show', 'f2bc634498561077b9c1f8d435ea8fc3483e6c56:database/init.sql'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  await admin.query(renderSchemaForDatabase(c2Sql, database));
  const conn = await connectionFor(database);
  try {
    await conn.query(
      "INSERT INTO exam_assignment (id, paper_id, user_id, release_id, source, category_id, difficulty, rule_snapshot, snapshot_origin) VALUES (31, 11, 9, NULL, NULL, NULL, 'unknown', ?, 'legacy_start')",
      [JSON.stringify({ totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5, rules: [] })],
    );
    await conn.query(
      "INSERT INTO exam_record (id, paper_id, regulation_id, user_id, assignment_id, active_assignment_id, release_id, source, category_id, difficulty, rule_snapshot, snapshot_origin, attempt_no, status, score, started_at, deadline_at, submitted_at, switch_count) VALUES (41, 11, 2, 9, 31, NULL, NULL, NULL, NULL, 'unknown', ?, 'legacy_start', 1, 'passed', 50.00, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 0), (42, 12, 2, 10, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'legacy_unavailable', 1, 'failed', 0.00, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 0)",
      [JSON.stringify({ totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5, rules: [] })],
    );
    await conn.query(
      "INSERT INTO exam_record_question (id, record_id, question_id, question_version_id, type, difficulty, score_cents, position, display_to_original, snapshot_json) VALUES (500, 41, 501, NULL, 'single', 'unknown', 2500, 0, ?, ?), (501, 41, 500, NULL, 'single', 'unknown', 2500, 1, ?, ?)",
      [
        JSON.stringify([1, 0]), JSON.stringify({ questionId: '501', versionId: null, revision: 1, categoryId: null, difficulty: 'unknown', type: 'single', stem: 'frozen-501', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer: [1], analysis: null, rubric: null, scoreCents: 2500, source: 'manual', approvedBy: null, approvedAt: null }),
        JSON.stringify([0, 1]), JSON.stringify({ questionId: '500', versionId: null, revision: 1, categoryId: null, difficulty: 'unknown', type: 'single', stem: 'frozen-500', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer: [0], analysis: null, rubric: null, scoreCents: 2500, source: 'manual', approvedBy: null, approvedAt: null }),
      ],
    );
    await conn.query(
      'INSERT INTO exam_answer (exam_record_id, question_id, selected, is_correct, gained_score) VALUES (41, 500, ?, 1, 25.00), (41, 501, ?, 1, 25.00), (42, 500, ?, 0, 0.00)',
      [JSON.stringify([1]), JSON.stringify([0]), JSON.stringify([0])],
    );

    const attempts = await migration('009_attempt_snapshot');
    const answers = await migration('010_answers');
    await assert.rejects(
      () => applyMigrations({
        connection: conn,
        database,
        migrations: [attempts, answers],
        onCheckpoint: ({ event, migrationId, stepId }) => {
          if (event === 'after-step-sql' && migrationId === answers.id && stepId === 'drop_legacy_record_question_index') {
            throw new Error('injected failure after legacy index drop');
          }
        },
      }),
      /injected failure after legacy index drop/,
    );
    const [[droppedIndex]] = await conn.query(
      "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer' AND INDEX_NAME = 'uk_record_question'",
    );
    assert.equal(Number(droppedIndex.count), 0);
    const [[failedAfterDrop]] = await conn.query(
      `SELECT status, progress FROM \`${migrationTable}\` WHERE migration_id = ?`,
      [answers.id],
    );
    assert.equal(failedAfterDrop.status, 'failed');
    assert.deepEqual(failedAfterDrop.progress, [
      'extend_exam_answer_draft', 'extend_exam_record_submission',
      'copy_snapshot_item_identity', 'index_exam_answer_item',
    ]);
    const [beforeRestore] = await conn.query(
      'SELECT exam_record_id, question_id, record_question_id, selected, gained_score FROM exam_answer ORDER BY exam_record_id, id',
    );
    assert.deepEqual(beforeRestore.map((row) => ({
      record: String(row.exam_record_id), question: String(row.question_id),
      item: row.record_question_id === null ? null : String(row.record_question_id),
      selected: typeof row.selected === 'string' ? JSON.parse(row.selected) : row.selected,
      gained: Number(row.gained_score),
    })), [
      { record: '41', question: '500', item: '500', selected: [1], gained: 25 },
      { record: '41', question: '501', item: '501', selected: [0], gained: 25 },
      { record: '42', question: '500', item: null, selected: [0], gained: 0 },
    ]);

    await assert.rejects(
      () => applyMigrations({
        connection: conn,
        database,
        migrations: [attempts, answers],
        onCheckpoint: ({ event, migrationId, stepId }) => {
          if (event === 'after-step-sql' && migrationId === answers.id && stepId === 'restore_snapshot_source_identity') {
            throw new Error('injected failure after source identity restore');
          }
        },
      }),
      /injected failure after source identity restore/,
    );
    const [[stillDroppedIndex]] = await conn.query(
      "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer' AND INDEX_NAME = 'uk_record_question'",
    );
    assert.equal(Number(stillDroppedIndex.count), 0);
    const [[failedAfterRestore]] = await conn.query(
      `SELECT status, progress FROM \`${migrationTable}\` WHERE migration_id = ?`,
      [answers.id],
    );
    assert.equal(failedAfterRestore.status, 'failed');
    assert.deepEqual(failedAfterRestore.progress, [
      'extend_exam_answer_draft', 'extend_exam_record_submission',
      'copy_snapshot_item_identity', 'index_exam_answer_item',
      'drop_legacy_record_question_index',
    ]);

    const applied = await applyMigrations({ connection: conn, database, migrations: [attempts, answers] });
    assert.deepEqual(applied.applied, ['010_answers']);
    const [rows] = await conn.query(
      'SELECT exam_record_id, question_id, record_question_id, selected, gained_score FROM exam_answer ORDER BY exam_record_id, id',
    );
    assert.deepEqual(rows.map((row) => ({
      record: String(row.exam_record_id), question: String(row.question_id),
      item: row.record_question_id === null ? null : String(row.record_question_id),
      selected: typeof row.selected === 'string' ? JSON.parse(row.selected) : row.selected,
      gained: Number(row.gained_score),
    })), [
      { record: '41', question: '501', item: '500', selected: [1], gained: 25 },
      { record: '41', question: '500', item: '501', selected: [0], gained: 25 },
      { record: '42', question: '500', item: null, selected: [0], gained: 0 },
    ]);
    const [records] = await conn.query(
      'SELECT id, grading_state, submission_method, graded_at, score FROM exam_record ORDER BY id',
    );
    assert.deepEqual(records.map((row) => ({
      id: String(row.id), grading: row.grading_state, method: row.submission_method,
      gradedAt: row.graded_at, score: Number(row.score),
    })), [
      { id: '41', grading: 'finalized', method: null, gradedAt: null, score: 50 },
      { id: '42', grading: 'finalized', method: null, gradedAt: null, score: 0 },
    ]);
    const [answerIndexes] = await conn.query(
      "SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE, SUB_PART FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer' AND INDEX_NAME IN ('uk_record_item','uk_record_question') ORDER BY INDEX_NAME, SEQ_IN_INDEX",
    );
    assert.deepEqual(answerIndexes.map((row) => ({
      name: row.INDEX_NAME, unique: Number(row.NON_UNIQUE) === 0,
      order: Number(row.SEQ_IN_INDEX), column: row.COLUMN_NAME,
      type: row.INDEX_TYPE, prefix: row.SUB_PART,
    })), [
      { name: 'uk_record_item', unique: true, order: 1, column: 'exam_record_id', type: 'BTREE', prefix: null },
      { name: 'uk_record_item', unique: true, order: 2, column: 'record_question_id', type: 'BTREE', prefix: null },
      { name: 'uk_record_question', unique: true, order: 1, column: 'exam_record_id', type: 'BTREE', prefix: null },
      { name: 'uk_record_question', unique: true, order: 2, column: 'question_id', type: 'BTREE', prefix: null },
    ]);
    const [[completed]] = await conn.query(
      `SELECT status, progress, attempts FROM \`${migrationTable}\` WHERE migration_id = ?`,
      [answers.id],
    );
    assert.equal(completed.status, 'applied');
    assert.deepEqual(completed.progress, answers.steps.map((step) => step.id));
    assert.ok(Number(completed.attempts) >= 3);
    const repeated = await applyMigrations({ connection: conn, database, migrations: [attempts, answers] });
    assert.deepEqual(repeated.applied, []);
  } finally {
    await conn.end();
  }
});

test('000 through 010 upgrades once from the accepted A1 schema and then reapplies as a no-op', async () => {
  const database = await createDatabase('succession_a1_' + randomBytes(3).toString('hex'));
  const acceptedA1Sql = execFileSync(
    'git',
    ['show', 'a5955da4bf8022757008322d49b2db58d15aef74:database/init.sql'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  await admin.query(renderSchemaForDatabase(acceptedA1Sql, database));
  const conn = await connectionFor(database);
  try {
    const throughAnswers = (await listMigrations())
      .filter((item) => Number(item.id.slice(0, 3)) <= 10);
    assert.deepEqual(throughAnswers.map((item) => item.id), [
      '000_migration_registry', '001_training_identity', '002_access', '003_media',
      '004_system', '005_courses', '006_video_learning', '007_question_bank',
      '008_paper_release', '009_attempt_snapshot', '010_answers',
    ]);

    const first = await applyMigrations({ connection: conn, database, migrations: throughAnswers });
    assert.deepEqual(first.applied, throughAnswers.map((item) => item.id));
    const [[columns]] = await conn.query(
      "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_record'",
    );
    assert.equal(Number(columns.count), 30);
    const [before] = await conn.query(
      `SELECT migration_id, checksum, status, attempts, progress FROM \`${migrationTable}\` ORDER BY migration_id`,
    );

    const repeated = await applyMigrations({ connection: conn, database, migrations: throughAnswers });
    assert.deepEqual(repeated.applied, []);
    const [afterRows] = await conn.query(
      `SELECT migration_id, checksum, status, attempts, progress FROM \`${migrationTable}\` ORDER BY migration_id`,
    );
    assert.deepEqual(afterRows, before);
  } finally {
    await conn.end();
  }
});

test('latest init with an empty registry records 009 and 010 independently and tolerates later columns', async () => {
  const database = await createDatabase('succession_fresh_' + randomBytes(3).toString('hex'));
  await admin.query(renderSchemaForDatabase(initSql, database));
  const conn = await connectionFor(database);
  try {
    const attempts = await migration('009_attempt_snapshot');
    const answers = await migration('010_answers');
    const definitions = [attempts, answers];
    const first = await applyMigrations({ connection: conn, database, migrations: definitions });
    assert.deepEqual(first.applied, ['009_attempt_snapshot', '010_answers']);
    const [registered] = await conn.query(
      `SELECT migration_id, status, progress FROM \`${migrationTable}\` WHERE migration_id IN (?, ?) ORDER BY migration_id`,
      [attempts.id, answers.id],
    );
    assert.deepEqual(registered.map((row) => [row.migration_id, row.status, row.progress]), [
      [attempts.id, 'applied', attempts.steps.map((step) => step.id)],
      [answers.id, 'applied', answers.steps.map((step) => step.id)],
    ]);

    const repeated = await applyMigrations({ connection: conn, database, migrations: definitions });
    assert.deepEqual(repeated.applied, []);
    await conn.query('ALTER TABLE exam_record ADD COLUMN post_010_extension INT NULL');
    const afterExtension = await applyMigrations({ connection: conn, database, migrations: definitions });
    assert.deepEqual(afterExtension.applied, []);
  } finally {
    await conn.end();
  }
});

test('010 resumes when its exam_record ALTER committed before successor progress was saved', async () => {
  const database = await createDatabase('succession_crash_' + randomBytes(3).toString('hex'));
  const c2Sql = execFileSync(
    'git',
    ['show', 'f2bc634498561077b9c1f8d435ea8fc3483e6c56:database/init.sql'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  await admin.query(renderSchemaForDatabase(c2Sql, database));
  const conn = await connectionFor(database);
  try {
    const attempts = await migration('009_attempt_snapshot');
    const answers = await migration('010_answers');
    const definitions = [attempts, answers];
    await assert.rejects(
      () => applyMigrations({
        connection: conn,
        database,
        migrations: definitions,
        onCheckpoint: ({ event, migrationId, stepId }) => {
          if (event === 'before-progress'
            && migrationId === answers.id
            && stepId === 'extend_exam_record_submission') {
            throw new Error('injected failure before successor progress');
          }
        },
      }),
      /injected failure before successor progress/,
    );
    const [[failed]] = await conn.query(
      `SELECT status, progress FROM \`${migrationTable}\` WHERE migration_id = ?`,
      [answers.id],
    );
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.progress, ['extend_exam_answer_draft']);
    const [[columns]] = await conn.query(
      "SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_record'",
    );
    assert.equal(Number(columns.count), 30);

    const resumed = await applyMigrations({ connection: conn, database, migrations: definitions });
    assert.deepEqual(resumed.applied, ['010_answers']);
    const [[completed]] = await conn.query(
      `SELECT status, progress FROM \`${migrationTable}\` WHERE migration_id = ?`,
      [answers.id],
    );
    assert.equal(completed.status, 'applied');
    assert.deepEqual(completed.progress, answers.steps.map((step) => step.id));
  } finally {
    await conn.end();
  }
});

test('confirmed 010 progress makes its full probe authoritative for old shape and column or index drift', async (t) => {
  const variants = [
    {
      name: 'restored_old_shape',
      sql: `ALTER TABLE exam_record
        DROP COLUMN graded_at,
        DROP COLUMN grading_revision,
        DROP COLUMN grading_state,
        DROP COLUMN submission_method,
        DROP COLUMN device_summary,
        DROP COLUMN last_heartbeat_at,
        DROP COLUMN draft_saved_at,
        DROP COLUMN draft_payload_hash,
        DROP COLUMN draft_revision`,
      oldProbe: 1,
    },
    {
      name: 'old_column_drift',
      sql: 'ALTER TABLE exam_record MODIFY COLUMN assignment_id BIGINT UNSIGNED NOT NULL',
      oldProbe: 0,
    },
    {
      name: 'old_index_drift',
      sql: 'ALTER TABLE exam_record DROP INDEX uk_assignment_attempt, ADD UNIQUE KEY uk_assignment_attempt (attempt_no, assignment_id)',
      oldProbe: 0,
    },
    {
      name: 'old_index_uniqueness_drift',
      sql: 'ALTER TABLE exam_record DROP INDEX uk_assignment_attempt, ADD KEY uk_assignment_attempt (assignment_id, attempt_no)',
      oldProbe: 0,
    },
    {
      name: 'legacy_index_missing',
      sql: 'ALTER TABLE exam_record DROP INDEX idx_status_deadline',
      oldProbe: 0,
    },
    {
      name: 'legacy_column_missing',
      sql: 'ALTER TABLE exam_record DROP COLUMN started_at',
      oldProbe: 0,
    },
    {
      name: 'new_column_drift',
      sql: 'ALTER TABLE exam_record MODIFY COLUMN draft_revision INT NOT NULL DEFAULT 0',
      oldProbe: 0,
    },
  ];

  for (const variant of variants) {
    await t.test(variant.name, async () => {
      const database = await createDatabase(`${variant.name}_${randomBytes(3).toString('hex')}`);
      await admin.query(renderSchemaForDatabase(initSql, database));
      const conn = await connectionFor(database);
      try {
        const attempts = await migration('009_attempt_snapshot');
        const answers = await migration('010_answers');
        const definitions = [attempts, answers];
        await applyMigrations({ connection: conn, database, migrations: definitions });
        await conn.query(variant.sql);

        const predecessorStep = attempts.steps.find((step) => step.id === 'extend_exam_record_attempt_snapshot');
        const successorStep = answers.steps.find((step) => step.id === 'extend_exam_record_submission');
        const [[oldCompletion]] = await conn.execute(predecessorStep.checkSql);
        const [[newCompletion]] = await conn.execute(successorStep.checkSql);
        assert.equal(Number(oldCompletion.complete), variant.oldProbe, `${variant.name} predecessor fixture`);
        assert.equal(Number(newCompletion.complete), 0, `${variant.name} successor fixture`);
        const [before] = await conn.query(
          `SELECT migration_id, status, attempts, progress FROM \`${migrationTable}\` WHERE migration_id IN (?, ?) ORDER BY migration_id`,
          [attempts.id, answers.id],
        );

        await assert.rejects(
          () => applyMigrations({ connection: conn, database, migrations: definitions }),
          /009_attempt_snapshot\/extend_exam_record_attempt_snapshot.*confirmed successor 010_answers\/extend_exam_record_submission.*invariant is false/i,
        );
        const [afterRows] = await conn.query(
          `SELECT migration_id, status, attempts, progress FROM \`${migrationTable}\` WHERE migration_id IN (?, ?) ORDER BY migration_id`,
          [attempts.id, answers.id],
        );
        assert.deepEqual(afterRows, before);
      } finally {
        await conn.end();
      }
    });
  }
});

test('successor checksum conflicts reject before predecessor probes or registry writes', async () => {
  const database = await createDatabase('succession_checksum_' + randomBytes(3).toString('hex'));
  await admin.query(renderSchemaForDatabase(initSql, database));
  const conn = await connectionFor(database);
  try {
    const attempts = await migration('009_attempt_snapshot');
    const answers = await migration('010_answers');
    const definitions = [attempts, answers];
    await applyMigrations({ connection: conn, database, migrations: definitions });
    await conn.query('ALTER TABLE exam_record MODIFY COLUMN assignment_id BIGINT UNSIGNED NOT NULL');
    await conn.execute(
      `UPDATE \`${migrationTable}\` SET checksum = ? WHERE migration_id = ?`,
      ['0'.repeat(64), answers.id],
    );
    const [before] = await conn.query(
      `SELECT migration_id, checksum, status, attempts, progress FROM \`${migrationTable}\` WHERE migration_id IN (?, ?) ORDER BY migration_id`,
      [attempts.id, answers.id],
    );

    await assert.rejects(
      () => applyMigrations({ connection: conn, database, migrations: definitions }),
      /checksum conflict: 010_answers/i,
    );
    const [afterRows] = await conn.query(
      `SELECT migration_id, checksum, status, attempts, progress FROM \`${migrationTable}\` WHERE migration_id IN (?, ?) ORDER BY migration_id`,
      [attempts.id, answers.id],
    );
    assert.deepEqual(afterRows, before);
  } finally {
    await conn.end();
  }
});

test('active in-progress exam records block check and apply before registry writes', async () => {
  const database = await createDatabase();
  const conn = await connectionFor(database);
  await conn.query('CREATE TABLE exam_record (id INT PRIMARY KEY, status VARCHAR(16) NOT NULL)');
  await conn.execute("INSERT INTO exam_record (id, status) VALUES (1, 'in_progress')");
  await assert.rejects(() => inspectMigrations({ connection: conn, database }), /active exam|in.progress/i);
  await assert.rejects(() => applyMigrations({ connection: conn, database }), /active exam|in.progress/i);
  const [[registry]] = await conn.query(`SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${REGISTRY_TABLE}'`);
  assert.equal(Number(registry.count), 0);
  await conn.end();
});

test('ended exam records do not block registry bootstrap', async () => {
  const database = await createDatabase();
  const conn = await connectionFor(database);
  await conn.query('CREATE TABLE exam_record (id INT PRIMARY KEY, status VARCHAR(16) NOT NULL)');
  await conn.execute("INSERT INTO exam_record (id, status) VALUES (1, 'submitted')");
  await applyMigrations({ connection: conn, database, migrations: [await migration()] });
  const [[registry]] = await conn.query(`SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${REGISTRY_TABLE}'`);
  assert.equal(Number(registry.count), 1);
  await conn.end();
});

test('legacy registry without progress is upgraded before normal step bookkeeping', async () => {
  const database = await createDatabase();
  const conn = await connectionFor(database);
  const base = await migration();
  await conn.query(`CREATE TABLE \`${migrationTable}\` (
    migration_id VARCHAR(128) NOT NULL,
    checksum CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'applied',
    started_at DATETIME(3) NULL,
    applied_at DATETIME(3) NULL,
    attempts INT NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    PRIMARY KEY (migration_id),
    KEY idx_schema_migration_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
  await conn.execute(`INSERT INTO \`${migrationTable}\` (migration_id, checksum, status, attempts) VALUES (?, ?, 'applied', 1)`, [base.id, base.checksum]);
  await applyMigrations({ connection: conn, database, migrations: [await migration()] });
  const [[column]] = await conn.query(`SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${migrationTable}' AND COLUMN_NAME = 'progress'`);
  assert.equal(column.DATA_TYPE, 'json');
  const [[row]] = await conn.query(`SELECT status, progress FROM \`${migrationTable}\` WHERE migration_id = ?`, [base.id]);
  assert.equal(row.status, 'applied');
  assert.deepEqual(row.progress, ['create_registry', 'add_progress']);
  await conn.end();
});

test('registry shape drift is rejected by check and apply before changing registry data', async () => {
  const base = await migration();
  const variants = [
    { name: 'json_not_null', progressDefinition: '`progress` JSON NOT NULL', progressValue: JSON.stringify([]) },
    { name: 'non_json', progressDefinition: '`progress` VARCHAR(16) NULL', progressValue: '[]' },
  ];
  for (const variant of variants) {
    const database = await createDatabase(`${variant.name}_${randomBytes(3).toString('hex')}`);
    const conn = await connectionFor(database);
    await conn.query(`CREATE TABLE \`${migrationTable}\` (
      \`migration_id\` VARCHAR(128) NOT NULL,
      \`checksum\` CHAR(64) NOT NULL,
      \`status\` VARCHAR(16) NOT NULL DEFAULT 'applied',
      \`started_at\` DATETIME(3) NULL,
      \`applied_at\` DATETIME(3) NULL,
      \`attempts\` INT NOT NULL DEFAULT 0,
      \`error_message\` TEXT NULL,
      ${variant.progressDefinition},
      PRIMARY KEY (\`migration_id\`),
      KEY \`idx_schema_migration_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    await conn.execute(`INSERT INTO \`${migrationTable}\` (migration_id, checksum, status, attempts, progress) VALUES (?, ?, 'applied', 7, ?)`, [base.id, base.checksum, variant.progressValue]);
    const [[before]] = await conn.query(`SELECT status, attempts, progress FROM \`${migrationTable}\` WHERE migration_id = ?`, [base.id]);
    await assert.rejects(() => inspectMigrations({ connection: conn, database }), /schema_migration|progress|nullable|incompatible|drift/i);
    await assert.rejects(() => applyMigrations({ connection: conn, database, migrations: [base] }), /schema_migration|progress|nullable|incompatible|drift/i);
    const [[after]] = await conn.query(`SELECT status, attempts, progress FROM \`${migrationTable}\` WHERE migration_id = ?`, [base.id]);
    assert.deepEqual(after, before);
    await conn.end();
  }
});

test('upgrade preserves existing rows and converges INFORMATION_SCHEMA with initialization', async () => {
  const initDb = await createDatabase('init_' + randomBytes(3).toString('hex'));
  const upgradeDb = await createDatabase('upgrade_' + randomBytes(3).toString('hex'));

  await admin.query(`${renderSchemaForDatabase(initSql, initDb)}`);
  // Upgrade fixture is the accepted A1 schema, not the current init.sql;
  // otherwise a new table already present in init would not exercise 002_access.
  const acceptedA1Sql = execFileSync('git', ['show', 'a5955da4bf8022757008322d49b2db58d15aef74:database/init.sql'], { cwd: ROOT, encoding: 'utf8' });
  const oldSql = acceptedA1Sql.replace(/\n-- ---------------------------------------------------------------------\n-- 5\. 迁移元数据[\s\S]*$/u, '\n');
  await admin.query(renderSchemaForDatabase(oldSql, upgradeDb));
  const upgrade = await connectionFor(upgradeDb);
  await upgrade.execute("INSERT INTO sys_department (name, sort, status) VALUES ('保留数据', 1, 1)");
  await applyMigrations({ connection: upgrade, database: upgradeDb });
  const [[row]] = await upgrade.query("SELECT name FROM sys_department WHERE name = '保留数据'");
  assert.equal(row.name, '保留数据');
  const [[accessMigration]] = await upgrade.query(`SELECT status, progress FROM \`${migrationTable}\` WHERE migration_id = '002_access'`);
  assert.equal(accessMigration.status, 'applied');
  assert.deepEqual(accessMigration.progress, [
    'create_sys_role', 'create_sys_permission', 'create_sys_role_permission', 'create_sys_user_role',
    'create_auth_session', 'add_auth_session_expires_at', 'backfill_auth_session_expires_at',
    'finalize_auth_session_expires_at', 'add_auth_version', 'add_force_password_change', 'add_login_count',
    'add_last_login_ip', 'add_roles_configured', 'backfill_force_password_change',
  ]);
  const [initTables] = await admin.query('SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [initDb]);
  const [upgradeTables] = await admin.query('SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [upgradeDb]);
  assert.deepEqual(upgradeTables, initTables);
  const [initColumns] = await admin.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [initDb]);
  const [upgradeColumns] = await admin.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [upgradeDb]);
  assert.deepEqual(upgradeColumns, initColumns);
  const indexShape = 'TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, COLLATION, SUB_PART, INDEX_TYPE';
  const [initIndexes] = await admin.query(`SELECT ${indexShape} FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [initDb]);
  const [upgradeIndexes] = await admin.query(`SELECT ${indexShape} FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [upgradeDb]);
  assert.deepEqual(upgradeIndexes, initIndexes);
  await upgrade.end();
});

test('005 courses check/apply/recheck upgrades the accepted A4 schema without losing rows', async () => {
  const database = await createDatabase('a4_courses_' + randomBytes(3).toString('hex'));
  const acceptedA4Sql = execFileSync('git', ['show', 'c81ebe045cb25bb46f6ab5be077b68143b224a25:database/init.sql'], { cwd: ROOT, encoding: 'utf8' });
  await admin.query(renderSchemaForDatabase(acceptedA4Sql, database));
  const conn = await connectionFor(database);
  await conn.query("INSERT INTO sys_department (name, sort, status) VALUES ('B1迁移保留数据', 1, 1)");
  const courses = await migration('005_courses');

  const before = await inspectMigrations({ connection: conn, database, migrations: [courses] });
  assert.deepEqual(before.pending.map((item) => item.id), ['005_courses']);

  const applied = await applyMigrations({ connection: conn, database, migrations: [courses] });
  assert.deepEqual(applied.applied, ['005_courses']);

  const after = await inspectMigrations({ connection: conn, database, migrations: [courses] });
  assert.deepEqual(after.pending, []);
  const [[preserved]] = await conn.query("SELECT COUNT(*) AS count FROM sys_department WHERE name = 'B1迁移保留数据'");
  assert.equal(Number(preserved.count), 1);
  const [tables] = await conn.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('training_course','course_chapter','course_lesson','lesson_version') ORDER BY TABLE_NAME");
  assert.deepEqual(tables.map((row) => row.TABLE_NAME), ['course_chapter', 'course_lesson', 'lesson_version', 'training_course']);
  const [[categoryColumn]] = await conn.query("SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'regulation' AND COLUMN_NAME = 'category_id' AND COLUMN_TYPE = 'bigint unsigned' AND IS_NULLABLE = 'YES'");
  assert.equal(Number(categoryColumn.count), 1);
  const [[permissions]] = await conn.query("SELECT COUNT(*) AS count FROM sys_permission WHERE code IN ('courses:read','courses:write','courses:publish')");
  assert.equal(Number(permissions.count), 3);
  const [[migrationRow]] = await conn.query("SELECT status, progress FROM schema_migration WHERE migration_id = '005_courses'");
  assert.equal(migrationRow.status, 'applied');
  assert.deepEqual(migrationRow.progress, [
    'add_regulation_category_id', 'add_regulation_category_index', 'create_training_course',
    'create_course_chapter', 'create_course_lesson', 'create_lesson_version', 'register_course_permissions',
  ]);
  await conn.end();
});

test('005 course table probes reject same-count index drift without destroying rows', async () => {
  const base = await migration();
  const courses = await migration('005_courses');
  const variants = [
    {
      name: 'course_wrong_index_order',
      stepId: 'create_training_course',
      table: 'training_course',
      indexRows: 5,
      driftSql: 'ALTER TABLE training_course DROP INDEX idx_training_course_category_status, ADD KEY idx_training_course_category_status (status, category_id)',
      insertSql: "INSERT INTO training_course (id, title, category_id, created_by) VALUES (1, '保留课程', 7, 9)",
    },
    {
      name: 'course_prefix_index',
      stepId: 'create_training_course',
      table: 'training_course',
      indexRows: 5,
      driftSql: 'ALTER TABLE training_course DROP INDEX idx_training_course_category_status, ADD KEY idx_training_course_category_status (category_id, status(1))',
      insertSql: "INSERT INTO training_course (id, title, category_id, created_by) VALUES (1, '保留课程', 7, 9)",
    },
    {
      name: 'chapter_wrong_index_order',
      stepId: 'create_course_chapter',
      table: 'course_chapter',
      indexRows: 3,
      driftSql: 'ALTER TABLE course_chapter DROP INDEX idx_course_chapter_course_sort, ADD KEY idx_course_chapter_course_sort (sort_order, course_id)',
      insertSql: "INSERT INTO course_chapter (id, course_id, title) VALUES (1, 1, '保留章节')",
    },
    {
      name: 'lesson_wrong_index_field',
      stepId: 'create_course_lesson',
      table: 'course_lesson',
      indexRows: 4,
      driftSql: 'ALTER TABLE course_lesson DROP INDEX idx_course_lesson_course, ADD KEY idx_course_lesson_course (chapter_id)',
      insertSql: "INSERT INTO course_lesson (id, course_id, chapter_id, title) VALUES (1, 1, 1, '保留课时')",
    },
    {
      name: 'version_loses_unique_constraint',
      stepId: 'create_lesson_version',
      table: 'lesson_version',
      indexRows: 4,
      driftSql: 'ALTER TABLE lesson_version DROP INDEX uk_lesson_version_number, ADD KEY uk_lesson_version_number (lesson_id, version_no)',
      insertSql: 'INSERT INTO lesson_version (id, lesson_id, version_no, asset_id, duration_ms, created_by) VALUES (1, 1, 1, 8, 60000, 9)',
    },
  ];

  for (const variant of variants) {
    const database = await createDatabase(`${variant.name}_${randomBytes(3).toString('hex')}`);
    const conn = await connectionFor(database);
    try {
      await applyMigrations({ connection: conn, database, migrations: [base] });
      await conn.query(`CREATE TABLE regulation (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        category VARCHAR(32) NOT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
      for (const step of courses.steps.filter((item) => item.id !== 'register_course_permissions')) {
        await conn.query(step.sql);
      }
      await conn.query(variant.driftSql);
      await conn.query(variant.insertSql);

      const [[sameCount]] = await conn.query('SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [variant.table]);
      assert.equal(Number(sameCount.count), variant.indexRows, `${variant.name} fixture must preserve the old index-row count`);
      const step = courses.steps.find((item) => item.id === variant.stepId);
      assert.ok(step, `missing course migration step ${variant.stepId}`);
      const [[completion]] = await conn.execute(step.checkSql);
      assert.equal(Number(completion.complete), 0, `${variant.name} must fail its completion check`);

      await assert.rejects(
        () => applyMigrations({ connection: conn, database, migrations: [courses] }),
        /005_courses|create_(?:training_course|course_chapter|course_lesson|lesson_version)|probe|invariant|incomplete/i,
        `${variant.name} must reject apply instead of recording completion`,
      );
      const [[registry]] = await conn.query(`SELECT status, progress FROM \`${migrationTable}\` WHERE migration_id = ?`, [courses.id]);
      assert.equal(registry.status, 'failed');
      assert.equal(Array.isArray(registry.progress) && registry.progress.includes(variant.stepId), false);
      const [[preserved]] = await conn.query(`SELECT COUNT(*) AS count FROM \`${variant.table}\` WHERE id = 1`);
      assert.equal(Number(preserved.count), 1, `${variant.name} must preserve pre-existing rows`);
    } finally {
      await conn.end();
    }
  }
});

test('012 course navigation applies after registered predecessors, preserves customization, and matches fresh init', async () => {
  const upgradeDb = await createDatabase('course_nav_upgrade_' + randomBytes(3).toString('hex'));
  const freshDb = await createDatabase('course_nav_fresh_' + randomBytes(3).toString('hex'));
  const preNavigationSql = execFileSync(
    'git',
    ['show', 'd36c3ecb7294b0e5ca4e5bdeb2d9cfa442617032:database/init.sql'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  await admin.query(renderSchemaForDatabase(preNavigationSql, upgradeDb));
  const conn = await connectionFor(upgradeDb);
  const definitions = await listMigrations();
  const predecessorIds = [
    '000_migration_registry', '001_training_identity', '002_access', '003_media',
    '004_system', '005_courses', '007_question_bank',
  ];
  const predecessors = predecessorIds.map((id) => definitions.find((item) => item.id === id));
  assert.equal(predecessors.every(Boolean), true, 'all accepted predecessor migrations must be present');
  const navigation = definitions.find((item) => item.id === '012_course_navigation');
  assert.ok(navigation, '012_course_navigation must be registered as an independent migration');

  await applyMigrations({ connection: conn, database: upgradeDb, migrations: predecessors });
  const [registryBefore] = await conn.query(
    `SELECT migration_id, checksum, status FROM \`${migrationTable}\` WHERE migration_id IN (?) ORDER BY migration_id`,
    [predecessorIds],
  );
  assert.deepEqual(registryBefore.map((row) => row.migration_id), predecessorIds);

  const first = await applyMigrations({
    connection: conn, database: upgradeDb, migrations: [...predecessors, navigation],
  });
  assert.deepEqual(first.applied, ['012_course_navigation']);
  const [registryAfter] = await conn.query(
    `SELECT migration_id, checksum, status FROM \`${migrationTable}\` WHERE migration_id IN (?) ORDER BY migration_id`,
    [predecessorIds],
  );
  assert.deepEqual(registryAfter, registryBefore, 'adding 012 must not rewrite accepted migration checksums');

  const [[seeded]] = await conn.query(
    "SELECT id, parent_id, name, type, route_path, permission_code, icon, sort, status FROM sys_menu WHERE route_path = '/admin/courses'",
  );
  assert.deepEqual({
    id: String(seeded.id), parent_id: String(seeded.parent_id), name: seeded.name, type: seeded.type,
    route_path: seeded.route_path, permission_code: seeded.permission_code, icon: seeded.icon,
    sort: Number(seeded.sort), status: Number(seeded.status),
  }, {
    id: '19', parent_id: '1', name: '课程管理', type: 'menu', route_path: '/admin/courses',
    permission_code: null, icon: 'Notebook', sort: 85, status: 1,
  });

  await conn.query("UPDATE sys_menu SET name = '自定义课程入口', icon = 'Reading', sort = 815, status = 0 WHERE route_path = '/admin/courses'");
  await conn.execute(`DELETE FROM \`${migrationTable}\` WHERE migration_id = ?`, [navigation.id]);
  const recovered = await applyMigrations({ connection: conn, database: upgradeDb, migrations: [navigation] });
  assert.deepEqual(recovered.applied, ['012_course_navigation']);
  const [[customized]] = await conn.query(
    "SELECT COUNT(*) AS count, MIN(name) AS name, MIN(icon) AS icon, MIN(sort) AS sort, MIN(status) AS status FROM sys_menu WHERE route_path = '/admin/courses'",
  );
  assert.deepEqual({
    count: Number(customized.count), name: customized.name, icon: customized.icon,
    sort: Number(customized.sort), status: Number(customized.status),
  }, { count: 1, name: '自定义课程入口', icon: 'Reading', sort: 815, status: 0 });
  const repeated = await applyMigrations({ connection: conn, database: upgradeDb, migrations: [navigation] });
  assert.deepEqual(repeated.applied, []);
  const [[repeatCount]] = await conn.query("SELECT COUNT(*) AS count FROM sys_menu WHERE route_path = '/admin/courses'");
  assert.equal(Number(repeatCount.count), 1);
  await conn.end();

  await admin.query(renderSchemaForDatabase(initSql, freshDb));
  const fresh = await connectionFor(freshDb);
  const [[freshProbe]] = await fresh.execute(navigation.steps[0].checkSql);
  assert.equal(Number(freshProbe.complete), 1, 'fresh init must satisfy the 012 completion probe');
  await applyMigrations({ connection: fresh, database: freshDb, migrations: [navigation] });
  const [[freshCount]] = await fresh.query("SELECT COUNT(*) AS count FROM sys_menu WHERE route_path = '/admin/courses' AND type = 'menu' AND permission_code IS NULL");
  assert.equal(Number(freshCount.count), 1);
  await fresh.end();
});

test('media migration completion checks reject same-count schema drift without destroying rows', async () => {
  const base = await migration();
  const media = await migration('003_media');
  const variants = [
    {
      name: 'asset_wrong_field',
      stepId: 'create_media_asset',
      assetSql: correctMediaAssetFixture.replace('probe_error VARCHAR(512)', 'probe_failure VARCHAR(512)'),
      referenceSql: correctMediaReferenceFixture,
      markerTable: 'media_asset',
    },
    {
      name: 'asset_wrong_type',
      stepId: 'create_media_asset',
      assetSql: correctMediaAssetFixture.replace('mime_type VARCHAR(128)', 'mime_type VARCHAR(127)'),
      referenceSql: correctMediaReferenceFixture,
      markerTable: 'media_asset',
    },
    {
      name: 'asset_missing_index',
      stepId: 'create_media_asset',
      assetSql: correctMediaAssetFixture.replace(',\n  KEY idx_media_asset_status (status)', ''),
      referenceSql: correctMediaReferenceFixture,
      markerTable: 'media_asset',
    },
    {
      name: 'asset_wrong_index_shape',
      stepId: 'create_media_asset',
      assetSql: correctMediaAssetFixture.replace('idx_media_asset_owner_purpose (owner_id, purpose)', 'idx_media_asset_owner_purpose (purpose, owner_id)'),
      referenceSql: correctMediaReferenceFixture,
      markerTable: 'media_asset',
    },
    {
      name: 'asset_prefix_unique_index',
      stepId: 'create_media_asset',
      assetSql: correctMediaAssetFixture.replace('uk_media_asset_storage_key (storage_key)', 'uk_media_asset_storage_key (storage_key(1))'),
      referenceSql: correctMediaReferenceFixture,
      markerTable: 'media_asset',
    },
    {
      name: 'reference_wrong_unsigned',
      stepId: 'create_media_reference',
      assetSql: correctMediaAssetFixture,
      referenceSql: correctMediaReferenceFixture.replace('asset_id BIGINT UNSIGNED', 'asset_id BIGINT'),
      markerTable: 'media_reference',
    },
    {
      name: 'asset_wrong_default',
      stepId: 'create_media_asset',
      assetSql: correctMediaAssetFixture.replace("DEFAULT 'processing'", "DEFAULT 'ready'"),
      referenceSql: correctMediaReferenceFixture,
      markerTable: 'media_asset',
    },
    {
      name: 'reference_wrong_precision',
      stepId: 'create_media_reference',
      assetSql: correctMediaAssetFixture,
      referenceSql: correctMediaReferenceFixture.replace(
        'created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
        'created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
      ),
      markerTable: 'media_reference',
    },
    {
      name: 'asset_wrong_engine',
      stepId: 'create_media_asset',
      assetSql: correctMediaAssetFixture.replace(
        'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci',
        'ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci',
      ),
      referenceSql: correctMediaReferenceFixture,
      markerTable: 'media_asset',
    },
  ];

  for (const variant of variants) {
    const database = await createDatabase(`${variant.name}_${randomBytes(3).toString('hex')}`);
    const conn = await connectionFor(database);
    try {
      await conn.query(`CREATE TABLE sys_user (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        avatar_id BIGINT UNSIGNED NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
      await conn.query(`CREATE TABLE sys_permission (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        code VARCHAR(128) NOT NULL,
        name VARCHAR(128) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uk_sys_permission_code (code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
      await conn.query(variant.assetSql);
      await conn.query(variant.referenceSql);
      await conn.execute(`INSERT INTO media_asset
        (id, owner_id, uploaded_by, purpose, media_kind, original_name, mime_type, storage_key, size_bytes, sha256)
        VALUES (1, 1, 1, 'avatar', 'image', 'preserved.png', 'image/png', ?, 1, ?)`,
      [`drift/${variant.name}`, 'a'.repeat(64)]);
      await conn.execute("INSERT INTO media_reference (id, asset_id, owner_type, owner_id) VALUES (1, 1, 'user_avatar', 1)");

      const step = media.steps.find((item) => item.id === variant.stepId);
      assert.ok(step, `missing media migration step ${variant.stepId}`);
      const [[completion]] = await conn.execute(step.checkSql);
      assert.equal(Number(completion.complete), 0, `${variant.name} must fail its completion check`);
      await assert.rejects(
        () => applyMigrations({ connection: conn, database, migrations: [base, media] }),
        /003_media|create_media_(?:asset|reference)|probe|invariant|incomplete/i,
        `${variant.name} must reject apply instead of recording completion`,
      );
      const [[registry]] = await conn.query(`SELECT status, progress FROM \`${migrationTable}\` WHERE migration_id = ?`, [media.id]);
      assert.equal(registry.status, 'failed');
      assert.equal(Array.isArray(registry.progress) && registry.progress.includes(variant.stepId), false);
      const [[preserved]] = await conn.query(`SELECT COUNT(*) AS count FROM \`${variant.markerTable}\` WHERE id = 1`);
      assert.equal(Number(preserved.count), 1, `${variant.name} must preserve pre-existing rows`);
    } finally {
      await conn.end();
    }
  }
});

test('two actual connections cannot apply the same database concurrently', async () => {
  const database = await createDatabase();
  const first = await connectionFor(database);
  const second = await connectionFor(database);
  const base = await migration();
  const fixture = fixtureMigration('001_lock_fixture', `
-- @step create_marker
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lock_marker') THEN 1 ELSE 0 END AS complete;
CREATE TABLE lock_marker (id INT PRIMARY KEY);
`);
  let release;
  const paused = new Promise((resolve) => { release = resolve; });
  let reachedStep;
  const reached = new Promise((resolve) => { reachedStep = resolve; });
  const firstRun = applyMigrations({
    connection: first,
    database,
    migrations: [base, fixture],
    onCheckpoint: async ({ event, migrationId, stepId }) => {
      if (event === 'before-step' && migrationId === fixture.id && stepId === 'create_marker') {
        reachedStep();
        await paused;
      }
    },
  });
  await reached;
  await assert.rejects(
    () => applyMigrations({ connection: second, database, migrations: [base, fixture] }),
    /lock|concurrent|acquire/i,
  );
  release();
  await firstRun;
  const [[row]] = await first.query(`SELECT status FROM \`${migrationTable}\` WHERE migration_id = ?`, [fixture.id]);
  assert.equal(row.status, 'applied');
  await first.end();
  await second.end();
});

test('partial non-idempotent DDL resumes from persisted step progress', async () => {
  const database = await createDatabase();
  const conn = await connectionFor(database);
  const base = await migration();
  await conn.query('CREATE TABLE partial_fixture (id INT PRIMARY KEY)');
  const fixture = fixtureMigration('001_partial_fixture', `
-- @step add_first_marker
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'partial_fixture' AND COLUMN_NAME = 'first_marker') THEN 1 ELSE 0 END AS complete;
ALTER TABLE partial_fixture ADD COLUMN first_marker INT NOT NULL DEFAULT 0;
-- @step add_second_marker
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'partial_fixture' AND COLUMN_NAME = 'second_marker') THEN 1 ELSE 0 END AS complete;
ALTER TABLE partial_fixture ADD COLUMN second_marker INT NOT NULL DEFAULT 0;
`);
  await assert.rejects(
    () => applyMigrations({
      connection: conn,
      database,
      migrations: [base, fixture],
      onCheckpoint: ({ event, migrationId, stepId }) => {
        if (event === 'before-step' && migrationId === fixture.id && stepId === 'add_second_marker') throw new Error('injected later failure');
      },
    }),
    /injected later failure/,
  );
  const [[failed]] = await conn.query(`SELECT status, progress FROM \`${migrationTable}\` WHERE migration_id = ?`, [fixture.id]);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.progress, ['add_first_marker']);
  await applyMigrations({ connection: conn, database, migrations: [base, fixture] });
  const [columns] = await conn.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'partial_fixture' ORDER BY ORDINAL_POSITION");
  assert.deepEqual(columns.map((column) => column.COLUMN_NAME), ['id', 'first_marker', 'second_marker']);
  const [[applied]] = await conn.query(`SELECT status, progress, attempts FROM \`${migrationTable}\` WHERE migration_id = ?`, [fixture.id]);
  assert.equal(applied.status, 'applied');
  assert.deepEqual(applied.progress, ['add_first_marker', 'add_second_marker']);
  assert.ok(applied.attempts >= 2);
  await conn.end();
});

test('dependent migrations run probes in migration order and backfill a newly created object', async () => {
  const database = await createDatabase();
  const conn = await connectionFor(database);
  const base = await migration();
  const createFixture = fixtureMigration('001_dependency_create', `
-- @step create_dependency
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dependency_fixture') THEN 1 ELSE 0 END AS complete;
CREATE TABLE dependency_fixture (id INT PRIMARY KEY, marker VARCHAR(16) NOT NULL);
-- @step seed_dependency
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM dependency_fixture WHERE id = 1 AND marker = 'pending') THEN 1 ELSE 0 END AS complete;
INSERT INTO dependency_fixture (id, marker) VALUES (1, 'pending') ON DUPLICATE KEY UPDATE marker = VALUES(marker);
`);
  const backfillFixture = fixtureMigration('002_dependency_backfill', `
-- @step backfill_dependency
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM dependency_fixture WHERE id = 1 AND marker = 'done') THEN 1 ELSE 0 END AS complete;
UPDATE dependency_fixture SET marker = 'done' WHERE id = 1;
`);
  await applyMigrations({ connection: conn, database, migrations: [base, createFixture, backfillFixture] });
  const [[row]] = await conn.query('SELECT marker FROM dependency_fixture WHERE id = 1');
  assert.equal(row.marker, 'done');
  const [progress] = await conn.query(`SELECT migration_id, status, progress FROM \`${migrationTable}\` WHERE migration_id IN (?, ?) ORDER BY migration_id`, [createFixture.id, backfillFixture.id]);
  assert.deepEqual(progress.map((item) => [item.migration_id, item.status, item.progress]), [
    [createFixture.id, 'applied', ['create_dependency', 'seed_dependency']],
    [backfillFixture.id, 'applied', ['backfill_dependency']],
  ]);
  await conn.end();
});

test('crash window after DDL is reconciled by the completion probe without duplicate ALTER', async () => {
  const database = await createDatabase();
  const conn = await connectionFor(database);
  const base = await migration();
  await conn.query('CREATE TABLE crash_fixture (id INT PRIMARY KEY)');
  const fixture = fixtureMigration('001_crash_fixture', `
-- @step add_marker
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crash_fixture' AND COLUMN_NAME = 'marker') THEN 1 ELSE 0 END AS complete;
ALTER TABLE crash_fixture ADD COLUMN marker INT NOT NULL DEFAULT 0;
`);
  let crash = true;
  await assert.rejects(
    () => applyMigrations({
      connection: conn,
      database,
      migrations: [base, fixture],
      onCheckpoint: ({ event, migrationId, stepId }) => {
        if (crash && event === 'before-progress' && migrationId === fixture.id && stepId === 'add_marker') {
          crash = false;
          throw new Error('simulated process crash window');
        }
      },
    }),
    /crash window/,
  );
  await applyMigrations({ connection: conn, database, migrations: [base, fixture] });
  const [[count]] = await conn.query("SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crash_fixture' AND COLUMN_NAME = 'marker'");
  assert.equal(Number(count.count), 1);
  const [[row]] = await conn.query(`SELECT status, progress FROM \`${migrationTable}\` WHERE migration_id = ?`, [fixture.id]);
  assert.equal(row.status, 'applied');
  assert.deepEqual(row.progress, ['add_marker']);
  await conn.end();
});

test('a killed lock owner leaves stale applying metadata and the named lock is released for recovery', async () => {
  const database = await createDatabase();
  const owner = await connectionFor(database);
  const killer = await connectionFor(database);
  const base = await migration();
  const fixture = fixtureMigration('001_killed_owner_fixture', `
-- @step add_marker
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'killed_owner_fixture' AND COLUMN_NAME = 'marker') THEN 1 ELSE 0 END AS complete;
ALTER TABLE killed_owner_fixture ADD COLUMN marker INT NOT NULL DEFAULT 0;
`);
  await owner.query('CREATE TABLE killed_owner_fixture (id INT PRIMARY KEY)');
  const [[thread]] = await owner.query('SELECT CONNECTION_ID() AS connection_id');
  const lockName = getMigrationLockName(database);
  let releaseOwnerCheckpoint;
  const ownerCheckpoint = new Promise((resolve) => { releaseOwnerCheckpoint = resolve; });
  let reachedOwnerCheckpoint;
  const ownerReached = new Promise((resolve) => { reachedOwnerCheckpoint = resolve; });
  let ownerKilled = false;
  const ownerRun = applyMigrations({
    connection: owner,
    database,
    migrations: [base, fixture],
    onCheckpoint: async ({ event, migrationId, stepId }) => {
      if (!ownerKilled && event === 'before-progress' && migrationId === fixture.id && stepId === 'add_marker') {
        reachedOwnerCheckpoint();
        await ownerCheckpoint;
      }
    },
  });
  await ownerReached;
  const [[ownerState]] = await killer.query('SELECT IS_USED_LOCK(?) AS owner_id', [lockName]);
  assert.equal(Number(ownerState.owner_id), Number(thread.connection_id));
  await killer.query(`KILL CONNECTION ${Number(thread.connection_id)}`);
  ownerKilled = true;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [[state]] = await killer.query('SELECT IS_USED_LOCK(?) AS owner_id', [lockName]);
    if (state.owner_id === null) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (attempt === 19) assert.fail('killed migration connection still owns named lock');
  }
  const [[stale]] = await killer.query(`SELECT status, progress FROM \`${migrationTable}\` WHERE migration_id = ?`, [fixture.id]);
  assert.equal(stale.status, 'applying');
  assert.deepEqual(stale.progress, []);
  const recoveryRun = applyMigrations({ connection: killer, database, migrations: [base, fixture] });
  await recoveryRun;
  releaseOwnerCheckpoint();
  await assert.rejects(ownerRun, /closed|lost|reset|connection|PROTOCOL/i);
  const [[row]] = await killer.query(`SELECT status, progress, attempts FROM \`${migrationTable}\` WHERE migration_id = ?`, [fixture.id]);
  assert.equal(row.status, 'applied');
  assert.deepEqual(row.progress, ['add_marker']);
  assert.ok(row.attempts >= 2);
  const [[column]] = await killer.query("SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'killed_owner_fixture' AND COLUMN_NAME = 'marker'");
  assert.equal(Number(column.count), 1);
  await owner.end().catch(() => undefined);
  await killer.end();
});

test('checksum conflict and malformed or multi-statement definitions reject before writes', async () => {
  const database = await createDatabase();
  const conn = await connectionFor(database);
  const base = await migration();
  await applyMigrations({ connection: conn, database, migrations: [base] });
  const [[before]] = await conn.query(`SELECT status, attempts, progress FROM \`${migrationTable}\` WHERE migration_id = '000_migration_registry'`);
  await conn.execute(`UPDATE \`${migrationTable}\` SET checksum = ? WHERE migration_id = '000_migration_registry'`, ['0'.repeat(64)]);
  await assert.rejects(() => applyMigrations({ connection: conn, database, migrations: [base] }), /checksum|校验/i);
  const [[after]] = await conn.query(`SELECT status, attempts, progress FROM \`${migrationTable}\` WHERE migration_id = '000_migration_registry'`);
  assert.deepEqual(after, before);
  assert.throws(() => parseMigrationText('001_unprobed', 'CREATE TABLE x (id INT);'), /step|check|probe/i);
  assert.throws(() => parseMigrationText('001_multi', `
-- @step one
-- @check SELECT 1 AS complete;
CREATE TABLE x (id INT); CREATE TABLE y (id INT);
`), /single|multiple|statement/i);
  await conn.end();
});

test('migration SQL and probes reject cross-schema, session, side-effect, and locking syntax', () => {
  const rejected = [
    ['001_cross_schema_ddl', `
-- @step alter
-- @check SELECT 1 AS complete;
ALTER TABLE mysql.foreign_table ADD COLUMN marker INT;
`],
    ['002_cross_schema_backfill', `
-- @step backfill
-- @check SELECT 1 AS complete;
UPDATE \`other_db\`.\`foreign_table\` SET marker = 1 WHERE id = 1;
`],
    ['003_lock_probe', `
-- @step lock
-- @check SELECT GET_LOCK('not-a-migration-lock', 0) AS complete;
CREATE TABLE safe_fixture (id INT PRIMARY KEY);
`],
    ['003b_release_all_locks_probe', `
-- @step release
-- @check SELECT RELEASE_ALL_LOCKS() AS complete;
CREATE TABLE safe_fixture (id INT PRIMARY KEY);
`],
    ['004_file_probe', `
-- @step file
-- @check SELECT 1 AS complete INTO OUTFILE '/tmp/not-a-migration-file';
CREATE TABLE safe_fixture (id INT PRIMARY KEY);
`],
    ['005_session_probe', `
-- @step session
-- @check SELECT @session_value := 1 AS complete;
CREATE TABLE safe_fixture (id INT PRIMARY KEY);
`],
    ['006_lock_clause', `
-- @step lock_clause
-- @check SELECT 1 AS complete FROM safe_fixture FOR UPDATE;
CREATE TABLE safe_fixture (id INT PRIMARY KEY);
`],
    ['007_unknown_probe_function', `
-- @step unknown_function
-- @check SELECT arbitrary_stored_function() AS complete;
CREATE TABLE safe_fixture (id INT PRIMARY KEY);
`],
    ['008_backtick_probe_function', `
-- @step backtick_function
-- @check SELECT \`COUNT\`(*) AS complete;
CREATE TABLE safe_fixture (id INT PRIMARY KEY);
`],
    ['009_unicode_probe_function', `
-- @step unicode_function
-- @check SELECT 危险函数() AS complete;
CREATE TABLE safe_fixture (id INT PRIMARY KEY);
`],
    ['010_unicode_cross_schema', `
-- @step unicode_cross_schema
-- @check SELECT 1 AS complete;
ALTER TABLE 其他库.外表 ADD COLUMN marker INT;
`],
  ];
  for (const [id, sql] of rejected) {
    assert.throws(() => parseMigrationText(id, sql), /schema-qualified|session|side-effect|lock|file|completion flag|locking|function|quoted|identifier|ASCII/i);
  }
  assert.doesNotThrow(() => parseMigrationText('009_approved_probe_functions', `
-- @step approved
-- @check SELECT CASE WHEN EXISTS (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'safe_fixture') AND 1 IN (1, 2) THEN COALESCE(1, 0) ELSE 0 END AS complete;
CREATE TABLE approved_probe_fixture (id INT PRIMARY KEY);
`));
  assert.doesNotThrow(() => parseMigrationText('011_unicode_literals_and_comments', `
-- 中文迁移注释
-- @step chinese_literals
-- @check /* 中文 probe 注释 */ SELECT CASE WHEN '中文' = '中文' THEN 1 ELSE 0 END AS complete;
CREATE TABLE chinese_literals_fixture (
  id INT PRIMARY KEY,
  label VARCHAR(16) COMMENT '字段中文'
) COMMENT='表中文';
`));
});

test('a probe that does not return one completion flag is rejected before registry writes', async () => {
  const database = await createDatabase();
  const conn = await connectionFor(database);
  const base = await migration();
  const invalidProbe = {
    id: '001_invalid_probe',
    checksum: 'a'.repeat(64),
    steps: [{
      id: 'invalid_probe',
      sql: 'CREATE TABLE invalid_probe (id INT PRIMARY KEY)',
      checkSql: 'SELECT 1 AS complete, 0 AS other',
    }],
  };
  await assert.rejects(
    () => applyMigrations({ connection: conn, database, migrations: [base, invalidProbe] }),
    /exactly one completion flag/i,
  );
  const [[registry]] = await conn.query(`SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${migrationTable}'`);
  assert.equal(Number(registry.count), 0);
  await conn.end();
});

test('requested database must match the connection before any mutation', async () => {
  const firstDb = await createDatabase();
  const secondDb = await createDatabase();
  const conn = await connectionFor(firstDb);
  await assert.rejects(() => applyMigrations({ connection: conn, database: secondDb }), /database|connection|match/i);
  const [[row]] = await conn.query(`SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${REGISTRY_TABLE}'`);
  assert.equal(Number(row.count), 0);
  await conn.end();
});

test('formal migration targets allow existing installs but reject system schemas', () => {
  for (const databaseName of ['ruleexam', 'ruleexam_upgrade_fixture_abc123']) {
    assert.doesNotThrow(() => validateMigrationTarget(databaseName));
  }
  for (const databaseName of ['', 'mysql', 'sys', 'information_schema', 'performance_schema', 'ruleexam;DROP']) {
    assert.throws(() => validateMigrationTarget(databaseName), /DB_DATABASE|database|system/i);
  }
  assert.equal(REGISTRY_TABLE, 'schema_migration');
});

test('formal CLI check is read-only and apply upgrades a non-test fixture database', async () => {
  const formalDatabase = `ruleexam_upgrade_fixture_${randomBytes(5).toString('hex')}`;
  databases.add(formalDatabase);
  validateMigrationTarget(formalDatabase);
  await admin.query(`CREATE DATABASE \`${formalDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  const acceptedA1Sql = execFileSync('git', ['show', 'a5955da4bf8022757008322d49b2db58d15aef74:database/init.sql'], { cwd: ROOT, encoding: 'utf8' });
  const formalSchema = acceptedA1Sql
    .replace('CREATE DATABASE IF NOT EXISTS `ruleexam`', `CREATE DATABASE IF NOT EXISTS \`${formalDatabase}\``)
    .replace('USE `ruleexam`', `USE \`${formalDatabase}\``);
  await admin.query(formalSchema);
  const credentials = { DB_HOST: services.mysql.host, DB_PORT: String(services.mysql.port), DB_USERNAME: services.mysql.user, DB_PASSWORD: services.mysql.password };
  const env = { ...process.env, ...credentials, DB_DATABASE: formalDatabase };
  try {
    const check = spawnSync(process.execPath, ['database/migrate.mjs', '--check'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    const [[before]] = await admin.query('SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [formalDatabase, migrationTable]);
    assert.equal(Number(before.count), 1);

    const apply = spawnSync(process.execPath, ['database/migrate.mjs', '--apply'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(apply.status, 0, apply.stderr);
    const [[afterApply]] = await admin.query('SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [formalDatabase, migrationTable]);
    assert.equal(Number(afterApply.count), 1);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS \`${formalDatabase}\``).catch(() => undefined);
  }
});
