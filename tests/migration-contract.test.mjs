import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { applyMigrations, getMigrationChecksum, inspectMigrations, validateMigrationTarget, REGISTRY_TABLE } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase, isSafeTestDatabase } from './support/test-target.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const ROOT = join(import.meta.dirname, '..');
const initSql = readFileSync(join(ROOT, 'database', 'init.sql'), 'utf8');
const migrationTable = 'schema_migration';

let services;
let admin;
let database;

before(async () => {
  if (process.env.DB_PASSWORD) {
    database = process.env.DB_DATABASE || 'ruleexam_test_training';
    assert.ok(isSafeTestDatabase(database), 'migration tests require a safe test database');
    admin = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD,
      multipleStatements: true,
    });
  } else {
    services = await createEphemeralServices();
    database = `ruleexam_test_${randomBytes(5).toString('hex')}`;
    admin = await mysql.createConnection({
      host: services.mysql.host,
      port: services.mysql.port,
      user: services.mysql.user,
      password: services.mysql.password,
      multipleStatements: true,
    });
  }
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\`; CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`);
});

after(async () => {
  await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
  await admin?.query(`DROP DATABASE IF EXISTS \`${database}_init\``).catch(() => undefined);
  await admin?.query(`DROP DATABASE IF EXISTS \`${database}_upgrade\``).catch(() => undefined);
  await admin?.end().catch(() => undefined);
  await services?.cleanup();
});

async function connectionFor(name = database) {
  const cfg = services
    ? { host: services.mysql.host, port: services.mysql.port, user: services.mysql.user, password: services.mysql.password }
    : { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME || 'root', password: process.env.DB_PASSWORD };
  return mysql.createConnection({ ...cfg, database: name, multipleStatements: true });
}

test('upgrade preserves existing rows and converges INFORMATION_SCHEMA with initialization', async () => {
  const initDb = `${database}_init`;
  const upgradeDb = `${database}_upgrade`;
  await admin.query(`DROP DATABASE IF EXISTS \`${initDb}\`; DROP DATABASE IF EXISTS \`${upgradeDb}\`; CREATE DATABASE \`${initDb}\`; CREATE DATABASE \`${upgradeDb}\`;`);

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

test('an in-progress migration blocks a second apply', async () => {
  const conn = await connectionFor();
  await conn.query(`CREATE TABLE IF NOT EXISTS \`${migrationTable}\` (migration_id VARCHAR(128) PRIMARY KEY, checksum CHAR(64) NOT NULL, status VARCHAR(16) NOT NULL, started_at DATETIME(3) NULL, applied_at DATETIME(3) NULL, attempts INT NOT NULL DEFAULT 0, error_message TEXT NULL)`);
  const checksum = getMigrationChecksum('000_migration_registry');
  await conn.execute(`INSERT INTO \`${migrationTable}\` (migration_id, checksum, status, started_at, attempts) VALUES (?, ?, 'applying', CURRENT_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE status='applying'`, ['000_migration_registry', checksum]);
  await assert.rejects(() => applyMigrations({ connection: conn, database }), /in.progress|running/i);
  await conn.end();
});

test('a failed migration resumes with the same checksum and becomes applied', async () => {
  const conn = await connectionFor();
  const checksum = getMigrationChecksum('000_migration_registry');
  await conn.execute(`INSERT INTO \`${migrationTable}\` (migration_id, checksum, status, attempts, error_message) VALUES (?, ?, 'failed', 1, 'transient') ON DUPLICATE KEY UPDATE checksum=VALUES(checksum), status='failed', attempts=1`, ['000_migration_registry', checksum]);
  await applyMigrations({ connection: conn, database });
  const [[row]] = await conn.execute(`SELECT status, attempts, error_message FROM \`${migrationTable}\` WHERE migration_id=?`, ['000_migration_registry']);
  assert.equal(row.status, 'applied');
  assert.ok(row.attempts >= 2);
  assert.equal(row.error_message, null);
  await conn.end();
});

test('checksum drift is rejected before a migration is rerun', async () => {
  const conn = await connectionFor();
  await conn.execute(`UPDATE \`${migrationTable}\` SET checksum=? WHERE migration_id=?`, ['0'.repeat(64), '000_migration_registry']);
  await assert.rejects(() => inspectMigrations({ connection: conn, database }), /checksum|校验/i);
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
  validateMigrationTarget(formalDatabase);
  await admin.query(`CREATE DATABASE \`${formalDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  const credentials = services
    ? { DB_HOST: services.mysql.host, DB_PORT: String(services.mysql.port), DB_USERNAME: services.mysql.user, DB_PASSWORD: services.mysql.password }
    : { DB_HOST: process.env.DB_HOST || '127.0.0.1', DB_PORT: String(process.env.DB_PORT || 3306), DB_USERNAME: process.env.DB_USERNAME || 'root', DB_PASSWORD: process.env.DB_PASSWORD || '' };
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
