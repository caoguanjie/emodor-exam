import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { applyMigrations, listMigrations } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const mysql = createRequire(new URL('../server/package.json', import.meta.url))('mysql2/promise');
const BASE = '9471cc9164c9d79e8a140cb9f68ab0e7b74fb706';
const ACCESS = '002_access';
const BACKFILL = 'backfill_force_password_change';
const TARGET = '028_access_password_backfill_probe';
const databases = new Set();
let migrations;
let services;
let admin;

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

function successorStep() {
  const target = migrations.find((migration) => migration.id === TARGET);
  assert.ok(target, '028 must ship the forward-only password backfill probe');
  assert.equal(target.steps.length, 1);
  assert.equal(target.steps[0].replacesCheck, `${ACCESS}/${BACKFILL}`);
  return target.steps[0];
}

async function databaseFor(label, { current = false, adopt = true } = {}) {
  const database = `ruleexam_test_password_probe_${label}_${randomBytes(4).toString('hex')}`;
  databases.add(database);
  const sql = current ? await readFile(new URL('../database/init.sql', import.meta.url), 'utf8')
    : execFileSync('git', ['show', `${BASE}:database/init.sql`], { encoding: 'utf8' });
  await admin.query(renderSchemaForDatabase(sql, database));
  const connection = await mysql.createConnection({ ...services.mysql, database });
  if (adopt) await applyMigrations({ connection, database, migrations: migrations.filter((migration) => migration.id < '025') });
  return { connection, database };
}

async function seedUsers(connection) {
  await connection.execute('INSERT INTO sys_user (id,username,password_hash,real_name,force_password_change,last_login_at,created_at,updated_at) VALUES (1,?,?,?,?,?,?,?),(2,?,?,?,?,?,?,?)', [
    'new_account', 'not-an-authenticatable-hash', '新账号', 0, null, '2026-01-01 00:00:00.000', '2026-01-01 00:00:00.000',
    'reset_account', 'not-an-authenticatable-hash', '已重置账号', 1, '2026-01-02 00:00:00.000', '2026-01-01 00:00:00.000', '2026-01-02 00:00:00.000',
  ]);
}

async function users(connection) {
  const [rows] = await connection.query('SELECT * FROM sys_user ORDER BY id');
  return rows;
}

async function registry(connection) {
  const [rows] = await connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
  return rows;
}

async function complete(connection) {
  const [[row]] = await connection.query(successorStep().checkSql);
  return Number(row.complete);
}

test('028 upgrades later password states without changing any account or old registry row, and replays idempotently', async () => {
  const state = await databaseFor('upgrade');
  try {
    await seedUsers(state.connection);
    const oldStep = migrations.find((migration) => migration.id === ACCESS).steps.find((step) => step.id === BACKFILL);
    const [[oldProbe]] = await state.connection.query(oldStep.checkSql);
    assert.equal(Number(oldProbe.complete), 0, 'the old one-time backfill probe rejects these valid later states');
    const beforeUsers = await users(state.connection);
    const beforeRegistry = await registry(state.connection);
    const result = await applyMigrations({ ...state, migrations, onCheckpoint({ event, migrationId, stepId }) {
      if (event === 'before-step') {
        assert.notEqual(`${migrationId}/${stepId}`, `${ACCESS}/${BACKFILL}`, 'the historical backfill must never rerun');
        assert.notEqual(migrationId, TARGET, 'valid accounts need only probe adoption');
      }
    } });
    assert.deepEqual(result.applied, [
      '025_question_bank_without_scores', '026_question_lifecycle_slimming',
      '027_question_review_permission_cleanup', TARGET,
    ]);
    assert.deepEqual(await users(state.connection), beforeUsers);
    const afterRegistry = await registry(state.connection);
    assert.deepEqual(afterRegistry.filter((row) => row.migration_id < '025'), beforeRegistry);
    assert.equal(await complete(state.connection), 1);
    const repeated = await applyMigrations({ ...state, migrations });
    assert.deepEqual(repeated.applied, []);
    assert.deepEqual(await registry(state.connection), afterRegistry);
    assert.deepEqual(await users(state.connection), beforeUsers);
  } finally { await state.connection.end(); }
});

test('028 accepts recorded backfill completion while 002 is applying or failed, so the runner can resume', async () => {
  for (const status of ['applying', 'failed']) {
    const state = await databaseFor(status);
    try {
      await seedUsers(state.connection);
      await state.connection.execute('UPDATE schema_migration SET status=? WHERE migration_id=?', [status, ACCESS]);
      const beforeUsers = await users(state.connection);
      const [[before]] = await state.connection.query('SELECT checksum,progress FROM schema_migration WHERE migration_id=?', [ACCESS]);
      assert.equal(await complete(state.connection), 1);
      await applyMigrations({ ...state, migrations });
      assert.deepEqual(await users(state.connection), beforeUsers);
      const [[after]] = await state.connection.query('SELECT checksum,progress,status FROM schema_migration WHERE migration_id=?', [ACCESS]);
      assert.equal(after.checksum, before.checksum);
      assert.deepEqual(after.progress, before.progress);
      assert.equal(after.status, 'applied');
    } finally { await state.connection.end(); }
  }
});

test('028 does not skip the original first backfill when 002 has no recorded completion', async () => {
  const state = await databaseFor('first', { current: true, adopt: false });
  try {
    await state.connection.execute('INSERT INTO sys_user (id,username,password_hash,real_name,force_password_change) VALUES (1,?,?,?,0)', ['original_account', 'not-an-authenticatable-hash', '首次升级账号']);
    const before = await users(state.connection);
    assert.equal(await complete(state.connection), 0);
    let backfills = 0;
    await applyMigrations({ ...state, migrations, onCheckpoint({ event, migrationId, stepId }) {
      if (event === 'after-step-sql' && migrationId === ACCESS && stepId === BACKFILL) backfills += 1;
    } });
    assert.equal(backfills, 1, 'a new install with original users must run the historical one-time backfill');
    const after = await users(state.connection);
    assert.equal(after[0].force_password_change, 1);
    assert.equal(after[0].last_login_at, null);
    const { force_password_change: _beforeFlag, updated_at: _beforeUpdated, ...beforeFacts } = before[0];
    const { force_password_change: _afterFlag, updated_at: _afterUpdated, ...afterFacts } = after[0];
    assert.deepEqual(afterFacts, beforeFacts);
    assert.equal(await complete(state.connection), 1);
    const settled = await users(state.connection);
    await applyMigrations({ ...state, migrations });
    assert.deepEqual(await users(state.connection), settled);
  } finally { await state.connection.end(); }
});

test('028 probe rejects absent, null or incomplete progress and does not mistake a larger string for the step ID', async () => {
  const state = await databaseFor('progress');
  try {
    await seedUsers(state.connection);
    const before = await users(state.connection);
    const [[row]] = await state.connection.query('SELECT progress FROM schema_migration WHERE migration_id=?', [ACCESS]);
    assert.ok(row.progress.includes(BACKFILL));
    for (const progress of [null, [], row.progress.filter((step) => step !== BACKFILL), [`prefix_${BACKFILL}`, `${BACKFILL}_suffix`]]) {
      await state.connection.execute('UPDATE schema_migration SET progress=? WHERE migration_id=?', [progress === null ? null : JSON.stringify(progress), ACCESS]);
      assert.equal(await complete(state.connection), 0);
      assert.deepEqual(await users(state.connection), before);
    }
    await state.connection.execute('DELETE FROM schema_migration WHERE migration_id=?', [ACCESS]);
    assert.equal(await complete(state.connection), 0);
    assert.deepEqual(await users(state.connection), before);
  } finally { await state.connection.end(); }
});

test('028 refuses an illegal flag after 002 completion without replaying a backfill or changing accounts', async () => {
  const state = await databaseFor('illegal');
  try {
    await seedUsers(state.connection);
    await state.connection.query('UPDATE sys_user SET force_password_change=2 WHERE id=1');
    const beforeUsers = await users(state.connection);
    const beforeRegistry = await registry(state.connection);
    assert.equal(await complete(state.connection), 0);
    await assert.rejects(() => applyMigrations({ ...state, migrations }), /002_access\/backfill_force_password_change.*invariant is false/);
    assert.deepEqual(await users(state.connection), beforeUsers);
    assert.deepEqual(await registry(state.connection), beforeRegistry);
    const [result] = await state.connection.execute(successorStep().sql);
    assert.equal(result.affectedRows, 0, 'the fail-closed step must match no accounts');
    assert.equal(await complete(state.connection), 0);
    assert.deepEqual(await users(state.connection), beforeUsers);
  } finally { await state.connection.end(); }
});

test('028 probe retains the original tinyint, not-null and default-zero column contract', async () => {
  for (const [label, definition] of [
    ['type', 'SMALLINT NOT NULL DEFAULT 0'],
    ['nullable', 'TINYINT NULL DEFAULT 0'],
    ['default', 'TINYINT NOT NULL DEFAULT 1'],
  ]) {
    const state = await databaseFor(label);
    try {
      await seedUsers(state.connection);
      await state.connection.query(`ALTER TABLE sys_user MODIFY COLUMN force_password_change ${definition}`);
      const before = await users(state.connection);
      assert.equal(await complete(state.connection), 0);
      await assert.rejects(() => applyMigrations({ ...state, migrations }));
      assert.deepEqual(await users(state.connection), before);
    } finally { await state.connection.end(); }
  }
});

test('current init adopts the full chain through 028 with an empty account table', async () => {
  const state = await databaseFor('init', { current: true, adopt: false });
  try {
    await applyMigrations({ ...state, migrations });
    assert.deepEqual(await users(state.connection), []);
    assert.equal(await complete(state.connection), 1);
    assert.deepEqual((await registry(state.connection)).slice(-4).map((row) => row.migration_id), [
      '025_question_bank_without_scores', '026_question_lifecycle_slimming',
      '027_question_review_permission_cleanup', TARGET,
    ]);
  } finally { await state.connection.end(); }
});
