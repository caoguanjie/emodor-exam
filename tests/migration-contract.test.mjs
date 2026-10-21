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
