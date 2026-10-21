import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  applyMigrations,
  getMigrationChecksum,
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
  admin = await mysql.createConnection({
    host: services.mysql.host,
    port: services.mysql.port,
    user: services.mysql.user,
    password: services.mysql.password,
    multipleStatements: true,
  });
});

after(async () => {
  for (const database of databases) {
    await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
  }
  await admin?.end().catch(() => undefined);
  await services?.cleanup();
});

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
  await applyMigrations({ connection: conn, database });
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
  await applyMigrations({ connection: conn, database });
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
    await assert.rejects(() => applyMigrations({ connection: conn, database }), /schema_migration|progress|nullable|incompatible|drift/i);
    const [[after]] = await conn.query(`SELECT status, attempts, progress FROM \`${migrationTable}\` WHERE migration_id = ?`, [base.id]);
    assert.deepEqual(after, before);
    await conn.end();
  }
});

test('upgrade preserves existing rows and converges INFORMATION_SCHEMA with initialization', async () => {
  const initDb = await createDatabase('init_' + randomBytes(3).toString('hex'));
  const upgradeDb = await createDatabase('upgrade_' + randomBytes(3).toString('hex'));

  await admin.query(`${renderSchemaForDatabase(initSql, initDb)}`);
  const oldSql = initSql.replace(/\n-- ---------------------------------------------------------------------\n-- 5\. 迁移元数据[\s\S]*$/u, '\n');
  await admin.query(renderSchemaForDatabase(oldSql, upgradeDb));
  const upgrade = await connectionFor(upgradeDb);
  await upgrade.execute("INSERT INTO sys_department (name, sort, status) VALUES ('保留数据', 1, 1)");
  await applyMigrations({ connection: upgrade, database: upgradeDb });
  const [[row]] = await upgrade.query("SELECT name FROM sys_department WHERE name = '保留数据'");
  assert.equal(row.name, '保留数据');
  const [initTables] = await admin.query('SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [initDb]);
  const [upgradeTables] = await admin.query('SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [upgradeDb]);
  assert.deepEqual(upgradeTables, initTables);
  const [initColumns] = await admin.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [initDb]);
  const [upgradeColumns] = await admin.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [upgradeDb]);
  assert.deepEqual(upgradeColumns, initColumns);
  await upgrade.end();
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

test('checksum conflict and malformed or multi-statement definitions reject before writes', async () => {
  const database = await createDatabase();
  const conn = await connectionFor(database);
  await applyMigrations({ connection: conn, database });
  const [[before]] = await conn.query(`SELECT status, attempts, progress FROM \`${migrationTable}\` WHERE migration_id = '000_migration_registry'`);
  await conn.execute(`UPDATE \`${migrationTable}\` SET checksum = ? WHERE migration_id = '000_migration_registry'`, ['0'.repeat(64)]);
  await assert.rejects(() => applyMigrations({ connection: conn, database }), /checksum|校验/i);
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
    /exactly one complete flag/i,
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
  const credentials = { DB_HOST: services.mysql.host, DB_PORT: String(services.mysql.port), DB_USERNAME: services.mysql.user, DB_PASSWORD: services.mysql.password };
  const env = { ...process.env, ...credentials, DB_DATABASE: formalDatabase };
  try {
    const check = spawnSync(process.execPath, ['database/migrate.mjs', '--check'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    const [[before]] = await admin.query('SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [formalDatabase, migrationTable]);
    assert.equal(Number(before.count), 0);

    const apply = spawnSync(process.execPath, ['database/migrate.mjs', '--apply'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(apply.status, 0, apply.stderr);
    const [[afterApply]] = await admin.query('SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [formalDatabase, migrationTable]);
    assert.equal(Number(afterApply.count), 1);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS \`${formalDatabase}\``).catch(() => undefined);
  }
});
