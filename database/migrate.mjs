// Safe, resumable schema migration runner.
// It only targets the explicitly configured, non-system database.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'database', 'migrations');
const REGISTRY_TABLE = 'schema_migration';
const SAFE_DATABASE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SYSTEM_DATABASES = new Set(['mysql', 'sys', 'information_schema', 'performance_schema', 'ndbinfo']);
const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');

export function validateMigrationTarget(database) {
  if (typeof database !== 'string' || !database) {
    throw new Error('DB_DATABASE must be explicitly configured for migrations');
  }
  if (!SAFE_DATABASE_NAME.test(database)) {
    throw new Error('DB_DATABASE must be a safe MySQL identifier');
  }
  if (SYSTEM_DATABASES.has(database.toLowerCase())) {
    throw new Error(`DB_DATABASE cannot target a system database: ${database}`);
  }
  return database;
}

async function migrationFiles() {
  const names = (await readdir(MIGRATIONS_DIR))
    .filter((name) => /^\d{3}[_-][A-Za-z0-9_-]+\.sql$/.test(name))
    .sort();
  return Promise.all(names.map(async (name) => {
    const filename = join(MIGRATIONS_DIR, name);
    const id = basename(name, '.sql');
    const sql = await readFile(filename, 'utf8');
    return { id, filename, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

export async function listMigrations() {
  return migrationFiles();
}

export function getMigrationChecksum(migrationId) {
  const files = existsSync(MIGRATIONS_DIR) ? require('node:fs').readdirSync(MIGRATIONS_DIR).filter((name) => name === `${migrationId}.sql`) : [];
  if (files.length !== 1) throw new Error(`unknown migration: ${migrationId}`);
  const sql = require('node:fs').readFileSync(join(MIGRATIONS_DIR, files[0]), 'utf8');
  return createHash('sha256').update(sql).digest('hex');
}

async function ensureRegistry(connection) {
  const migration = (await migrationFiles()).find((item) => item.id === '000_migration_registry');
  if (!migration) throw new Error('000_migration_registry.sql is required');
  await connection.query(migration.sql);
}

async function registryRows(connection) {
  try {
    const [rows] = await connection.query(`SELECT migration_id, checksum, status, started_at, applied_at, attempts, error_message FROM \`${REGISTRY_TABLE}\``);
    return rows;
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') return [];
    throw error;
  }
}

export async function inspectMigrations({ connection, database }) {
  validateMigrationTarget(database);
  const migrations = await migrationFiles();
  const rows = await registryRows(connection);
  const byId = new Map(rows.map((row) => [row.migration_id, row]));
  const pending = [];
  for (const migration of migrations) {
    const row = byId.get(migration.id);
    if (!row) {
      pending.push({ ...migration, status: 'pending' });
      continue;
    }
    if (row.checksum !== migration.checksum) {
      throw new Error(`migration checksum conflict: ${migration.id}`);
    }
    if (row.status === 'applying') {
      throw new Error(`migration is already in-progress: ${migration.id}`);
    }
    if (row.status === 'failed') {
      pending.push({ ...migration, status: 'failed', attempts: Number(row.attempts || 0) });
      continue;
    }
    if (row.status !== 'applied') {
      throw new Error(`unknown migration status: ${migration.id}`);
    }
  }
  return { migrations, rows, pending };
}

export async function applyMigrations({ connection, database }) {
  validateMigrationTarget(database);
  await ensureRegistry(connection);
  const plan = await inspectMigrations({ connection, database });
  const applied = [];
  for (const migration of plan.pending) {
    const started = new Date();
    if (migration.status === 'failed') {
      await connection.execute(
        `UPDATE \`${REGISTRY_TABLE}\` SET status='applying', started_at=?, applied_at=NULL, attempts=attempts+1, error_message=NULL WHERE migration_id=?`,
        [started, migration.id],
      );
    } else {
      await connection.execute(
        `INSERT INTO \`${REGISTRY_TABLE}\` (migration_id, checksum, status, started_at, attempts) VALUES (?, ?, 'applying', ?, 1)`,
        [migration.id, migration.checksum, started],
      );
    }
    try {
      await connection.query(migration.sql);
      await connection.execute(
        `UPDATE \`${REGISTRY_TABLE}\` SET status='applied', applied_at=?, error_message=NULL WHERE migration_id=?`,
        [new Date(), migration.id],
      );
      applied.push(migration.id);
    } catch (error) {
      await connection.execute(
        `UPDATE \`${REGISTRY_TABLE}\` SET status='failed', error_message=? WHERE migration_id=?`,
        [String(error?.message || error).slice(0, 4000), migration.id],
      ).catch(() => undefined);
      throw error;
    }
  }
  return { applied, pending: [] };
}

function quoteDatabase(database) {
  validateMigrationTarget(database);
  return `\`${database}\``;
}

async function cli() {
  const rawArgs = process.argv.slice(2);
  const args = new Set(rawArgs);
  const mode = args.has('--check') ? 'check' : args.has('--apply') ? 'apply' : null;
  const unknownArgs = rawArgs.filter((arg) => arg !== '--check' && arg !== '--apply');
  if (!mode || unknownArgs.length > 0 || (args.has('--check') && args.has('--apply'))) {
    console.error('用法：node database/migrate.mjs --check|--apply');
    process.exitCode = 2;
    return;
  }
  const database = process.env.DB_DATABASE;
  quoteDatabase(database);
  if (!process.env.DB_PASSWORD) {
    throw new Error('缺少 DB_PASSWORD 环境变量（运行期注入，不落盘）');
  }
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD,
    database,
    multipleStatements: true,
  });
  try {
    const result = mode === 'apply'
      ? await applyMigrations({ connection, database })
      : await inspectMigrations({ connection, database });
    console.log(JSON.stringify({ mode, database, applied: result.applied || [], pending: (result.pending || []).map((item) => item.id) }));
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  cli().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

export { REGISTRY_TABLE };
