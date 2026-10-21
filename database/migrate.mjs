// Safe, resumable schema migration runner.
// It only targets the explicitly configured, non-system database.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync as readFileSyncFromFs, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'database', 'migrations');
export const REGISTRY_TABLE = 'schema_migration';
const REGISTRY_MIGRATION_ID = '000_migration_registry';
const SAFE_DATABASE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SAFE_MIGRATION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const SAFE_STEP_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const MIGRATION_FILE = /^\d{3}[_-][A-Za-z0-9_-]+\.sql$/;
const SYSTEM_DATABASES = new Set(['mysql', 'sys', 'information_schema', 'performance_schema', 'ndbinfo']);
const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');

const REGISTRY_COLUMN_CONTRACT = [
  { name: 'migration_id', dataType: 'varchar', columnType: 'varchar(128)', nullable: 'NO', defaultValue: null },
  { name: 'checksum', dataType: 'char', columnType: 'char(64)', nullable: 'NO', defaultValue: null },
  { name: 'status', dataType: 'varchar', columnType: 'varchar(16)', nullable: 'NO', defaultValue: 'applied' },
  { name: 'started_at', dataType: 'datetime', columnType: 'datetime(3)', nullable: 'YES', defaultValue: null },
  { name: 'applied_at', dataType: 'datetime', columnType: 'datetime(3)', nullable: 'YES', defaultValue: null },
  { name: 'attempts', dataType: 'int', columnType: 'int', nullable: 'NO', defaultValue: '0' },
  { name: 'error_message', dataType: 'text', columnType: 'text', nullable: 'YES', defaultValue: null },
  { name: 'progress', dataType: 'json', columnType: 'json', nullable: 'YES', defaultValue: null },
];

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

function stripSqlComments(sql) {
  let output = '';
  let quote = null;
  let blockComment = false;
  let lineComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (current === '\n') {
        lineComment = false;
        output += current;
      } else {
        output += ' ';
      }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        output += '  ';
        index += 1;
      } else {
        output += current === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (quote) {
      output += current;
      if (current === '\\' && next) {
        output += next;
        index += 1;
      } else if (current === quote) {
        if (sql[index + 1] === quote) {
          output += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (current === "'" || current === '"' || current === '`') {
      quote = current;
      output += current;
      continue;
    }
    if (current === '/' && next === '*') {
      blockComment = true;
      output += '  ';
      index += 1;
      continue;
    }
    if (current === '#') {
      lineComment = true;
      output += ' ';
      continue;
    }
    if (current === '-' && next === '-' && (index === 0 || /\s/.test(sql[index - 1])) && (index + 2 === sql.length || /\s/.test(sql[index + 2]))) {
      lineComment = true;
      output += '  ';
      index += 1;
      continue;
    }
    output += current;
  }
  return output;
}

function splitSqlStatements(sql) {
  const stripped = stripSqlComments(sql);
  const statements = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < stripped.length; index += 1) {
    const current = stripped[index];
    if (quote) {
      if (current === '\\') {
        index += 1;
      } else if (current === quote) {
        if (stripped[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (current === "'" || current === '"' || current === '`') {
      quote = current;
      continue;
    }
    if (current === ';') {
      const statement = stripped.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = stripped.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function normalizeSingleStatement(sql, kind) {
  const statements = splitSqlStatements(sql);
  if (statements.length !== 1) {
    throw new Error(`${kind} must contain exactly one SQL statement`);
  }
  return statements[0];
}

function normalizeCheckSql(sql, migrationId, stepId) {
  const statement = normalizeSingleStatement(sql, `migration probe ${migrationId}/${stepId}`);
  if (!/^SELECT\b/i.test(statement)) {
    throw new Error(`migration probe ${migrationId}/${stepId} must be a SELECT`);
  }
  if (!/\bAS\s+(?:`complete`|complete)\b/i.test(statement)) {
    throw new Error(`migration probe ${migrationId}/${stepId} must return AS complete`);
  }
  if (/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|USE|CALL|SET|INTO)\b/i.test(statement)) {
    throw new Error(`migration probe ${migrationId}/${stepId} must be read-only`);
  }
  return statement;
}

function normalizeMigrationSql(sql, migrationId, stepId) {
  const statement = normalizeSingleStatement(sql, `migration step ${migrationId}/${stepId}`);
  if (/\b(?:USE|CREATE\s+DATABASE|DROP\s+DATABASE)\b/i.test(statement)) {
    throw new Error(`migration step ${migrationId}/${stepId} cannot switch or destroy databases`);
  }
  if (!/^(?:CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|INSERT\s+INTO|INSERT\s+IGNORE|UPDATE)\b/i.test(statement)) {
    throw new Error(`migration step ${migrationId}/${stepId} uses an unsupported SQL statement`);
  }
  if (/^INSERT\b/i.test(statement) && !/\b(?:ON\s+DUPLICATE\s+KEY\s+UPDATE|INSERT\s+IGNORE)\b/i.test(statement)) {
    throw new Error(`migration step ${migrationId}/${stepId} must use an idempotent INSERT form`);
  }
  if (/^UPDATE\b/i.test(statement) && !/\bWHERE\b/i.test(statement)) {
    throw new Error(`migration step ${migrationId}/${stepId} UPDATE requires a WHERE clause`);
  }
  return statement;
}

export function parseMigrationText(id, sql, filename = undefined) {
  if (typeof id !== 'string' || !SAFE_MIGRATION_ID.test(id)) throw new Error(`invalid migration id: ${id}`);
  if (typeof sql !== 'string' || !sql.trim()) throw new Error(`migration ${id} is empty`);
  const markers = [...sql.matchAll(/^[ \t]*--\s*@step\s+([A-Za-z][A-Za-z0-9_.-]{0,127})\s*$/gim)];
  if (markers.length === 0) throw new Error(`migration ${id} must declare @step boundaries`);
  const steps = [];
  const seen = new Set();
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const stepId = marker[1];
    if (seen.has(stepId)) throw new Error(`migration ${id} has duplicate step ${stepId}`);
    seen.add(stepId);
    const bodyStart = marker.index + marker[0].length;
    const bodyEnd = index + 1 < markers.length ? markers[index + 1].index : sql.length;
    const body = sql.slice(bodyStart, bodyEnd);
    const checks = [...body.matchAll(/^[ \t]*--\s*@check\s+(.+)$/gim)];
    if (checks.length !== 1) throw new Error(`migration ${id}/${stepId} must declare exactly one @check probe`);
    const checkSql = normalizeCheckSql(checks[0][1], id, stepId);
    const stepSql = normalizeMigrationSql(body.replace(checks[0][0], ''), id, stepId);
    steps.push({ id: stepId, sql: stepSql, checkSql });
  }
  return {
    id,
    filename,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
    steps,
  };
}

function validateMigrationDefinition(definition) {
  if (!definition || typeof definition !== 'object' || typeof definition.id !== 'string' || !SAFE_MIGRATION_ID.test(definition.id)) {
    throw new Error('invalid migration definition');
  }
  const parsed = Array.isArray(definition.steps)
    ? definition
    : parseMigrationText(definition.id, definition.sql || '', definition.filename);
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error(`migration ${definition.id} has no steps`);
  }
  const steps = parsed.steps.map((step) => {
    if (!step || typeof step.id !== 'string' || !SAFE_STEP_ID.test(step.id)) {
      throw new Error(`migration ${definition.id} has an invalid step id`);
    }
    return {
      id: step.id,
      sql: normalizeMigrationSql(step.sql, definition.id, step.id),
      checkSql: normalizeCheckSql(step.checkSql, definition.id, step.id),
    };
  });
  const ids = new Set();
  for (const step of steps) {
    if (ids.has(step.id)) throw new Error(`migration ${definition.id} has duplicate step ${step.id}`);
    ids.add(step.id);
  }
  if (typeof parsed.checksum !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.checksum)) {
    throw new Error(`migration ${definition.id} has an invalid checksum`);
  }
  return { ...parsed, steps };
}

function validateMigrationDefinitions(migrations) {
  if (!Array.isArray(migrations) || migrations.length === 0) throw new Error('no migration definitions found');
  const ids = new Set();
  return migrations.map((migration) => {
    const definition = validateMigrationDefinition(migration);
    if (ids.has(definition.id)) throw new Error(`duplicate migration id: ${definition.id}`);
    ids.add(definition.id);
    return definition;
  });
}

async function migrationFiles() {
  const names = (await readdir(MIGRATIONS_DIR))
    .filter((name) => MIGRATION_FILE.test(name))
    .sort();
  return Promise.all(names.map(async (name) => {
    const filename = join(MIGRATIONS_DIR, name);
    const id = basename(name, '.sql');
    return parseMigrationText(id, await readFile(filename, 'utf8'), filename);
  }));
}

export async function listMigrations() {
  return migrationFiles();
}

export function getMigrationChecksum(migrationId) {
  if (!existsSync(MIGRATIONS_DIR)) throw new Error(`unknown migration: ${migrationId}`);
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name === `${migrationId}.sql`);
  if (files.length !== 1) throw new Error(`unknown migration: ${migrationId}`);
  return createHash('sha256').update(readFileSyncFromFs(join(MIGRATIONS_DIR, files[0]))).digest('hex');
}

async function prepareMigrations(migrations) {
  return validateMigrationDefinitions(migrations || await migrationFiles());
}

async function actualDatabase(connection) {
  const [rows] = await connection.query('SELECT DATABASE() AS database_name');
  return rows?.[0]?.database_name || null;
}

async function assertConnectionDatabase(connection, database) {
  const actual = await actualDatabase(connection);
  if (actual !== database) {
    throw new Error(`database connection mismatch: requested ${database}, actual ${actual || '(none)'}`);
  }
}

async function tableExists(connection, tableName) {
  const [[row]] = await connection.execute(
    "SELECT COUNT(*) AS present FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'",
    [tableName],
  );
  return Number(row?.present || 0) === 1;
}

async function columnExists(connection, tableName, columnName) {
  const [[row]] = await connection.execute(
    'SELECT COUNT(*) AS present FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [tableName, columnName],
  );
  return Number(row?.present || 0) === 1;
}

async function activeExamPreflight(connection) {
  if (!await tableExists(connection, 'exam_record')) return 0;
  if (!await columnExists(connection, 'exam_record', 'status')) {
    throw new Error('exam_record exists but has no status column; refusing migration');
  }
  const [[row]] = await connection.execute("SELECT COUNT(*) AS active_count FROM `exam_record` WHERE `status` = 'in_progress'");
  const count = Number(row?.active_count || 0);
  if (count > 0) throw new Error(`active exam records block migration: ${count}`);
  return count;
}

async function readRegistryColumns(connection) {
  if (!await tableExists(connection, REGISTRY_TABLE)) return new Set();
  const [rows] = await connection.execute(
    'SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [REGISTRY_TABLE],
  );
  const byName = new Map(rows.map((row) => [row.COLUMN_NAME, row]));
  for (const contract of REGISTRY_COLUMN_CONTRACT) {
    const row = byName.get(contract.name);
    if (!row) {
      if (contract.name === 'progress') continue;
      throw new Error(`schema_migration is missing required column: ${contract.name}`);
    }
    if (row.DATA_TYPE !== contract.dataType
      || row.COLUMN_TYPE !== contract.columnType
      || row.IS_NULLABLE !== contract.nullable
      || row.COLUMN_DEFAULT !== contract.defaultValue) {
      throw new Error(`schema_migration column ${contract.name} has incompatible type/nullability/default`);
    }
  }
  const [indexes] = await connection.execute(
    'SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
    [REGISTRY_TABLE],
  );
  const indexContract = [
    { name: 'PRIMARY', nonUnique: 0, sequence: 1, column: 'migration_id' },
    { name: 'idx_schema_migration_status', nonUnique: 1, sequence: 1, column: 'status' },
  ];
  for (const expected of indexContract) {
    const matches = indexes.filter((index) => index.INDEX_NAME === expected.name);
    if (matches.length !== 1
      || Number(matches[0].NON_UNIQUE) !== expected.nonUnique
      || Number(matches[0].SEQ_IN_INDEX) !== expected.sequence
      || matches[0].COLUMN_NAME !== expected.column
      || matches[0].INDEX_TYPE !== 'BTREE') {
      throw new Error(`schema_migration index ${expected.name} is incompatible`);
    }
  }
  return new Set(byName.keys());
}

function decodeProgress(value, migrationId) {
  if (value === null || value === undefined || value === '') return [];
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`migration ${migrationId} has invalid progress JSON`);
    }
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`migration ${migrationId} has invalid progress JSON`);
  }
  if (new Set(parsed).size !== parsed.length) throw new Error(`migration ${migrationId} has duplicate progress steps`);
  return parsed;
}

async function registryRows(connection) {
  const columns = await readRegistryColumns(connection);
  if (columns.size === 0) return [];
  const progress = columns.has('progress') ? ', progress' : '';
  const [rows] = await connection.execute(
    `SELECT migration_id, checksum, status, started_at, applied_at, attempts, error_message${progress} FROM \`${REGISTRY_TABLE}\``,
  );
  return rows.map((row) => ({ ...row, progress: columns.has('progress') ? row.progress : null }));
}

async function readPreflight(connection, database) {
  validateMigrationTarget(database);
  await assertConnectionDatabase(connection, database);
  await activeExamPreflight(connection);
}

function migrationStepIds(migration) {
  return migration.steps.map((step) => step.id);
}

function assertProgressBelongs(progress, migration) {
  const ids = new Set(migrationStepIds(migration));
  for (const stepId of progress) {
    if (!ids.has(stepId)) throw new Error(`migration ${migration.id} progress references unknown step: ${stepId}`);
  }
}

function isComplete(progress, migration) {
  return progress.length === migration.steps.length && migration.steps.every((step) => progress.includes(step.id));
}

export async function inspectMigrations({ connection, database, migrations, allowApplying = false } = {}) {
  const definitions = await prepareMigrations(migrations);
  await readPreflight(connection, database);
  const rows = await registryRows(connection);
  const byId = new Map(rows.map((row) => [row.migration_id, row]));
  const pending = [];
  for (const migration of definitions) {
    const row = byId.get(migration.id);
    if (!row) {
      pending.push({ ...migration, status: 'pending' });
      continue;
    }
    if (row.checksum !== migration.checksum) throw new Error(`migration checksum conflict: ${migration.id}`);
    const progress = decodeProgress(row.progress, migration.id);
    assertProgressBelongs(progress, migration);
    if (row.status === 'applying' && !allowApplying) {
      throw new Error(`migration is already in-progress: ${migration.id}`);
    }
    if (!['applying', 'applied', 'failed'].includes(row.status)) {
      throw new Error(`unknown migration status: ${migration.id}`);
    }
    if (row.status !== 'applied' || !isComplete(progress, migration)) {
      pending.push({ ...migration, status: row.status, attempts: Number(row.attempts || 0), progress });
    }
  }
  return { migrations: definitions, rows, pending };
}

export function getMigrationLockName(database) {
  validateMigrationTarget(database);
  return `ruleexam_mig_${createHash('sha256').update(database).digest('hex').slice(0, 48)}`;
}

async function acquireMigrationLock(connection, database) {
  const lockName = getMigrationLockName(database);
  const [[row]] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
  if (Number(row?.acquired || 0) !== 1) throw new Error(`could not acquire migration lock for ${database}`);
  return lockName;
}

async function releaseMigrationLock(connection, lockName) {
  await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]).catch(() => undefined);
}

async function probeStep(connection, migration, step) {
  const [rows] = await connection.execute(step.checkSql);
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || Object.keys(rows[0]).length !== 1 || !Object.prototype.hasOwnProperty.call(rows[0], 'complete')) {
    throw new Error(`migration probe ${migration.id}/${step.id} must return exactly one complete flag`);
  }
  const value = rows[0].complete;
  if (![0, 1, '0', '1'].includes(value)) throw new Error(`migration probe ${migration.id}/${step.id} returned non-boolean complete flag`);
  return Number(value) === 1;
}

async function validateRuntimeProbes(connection, migrations) {
  for (const migration of migrations) {
    for (const step of migration.steps) {
      await probeStep(connection, migration, step);
    }
  }
}

async function checkpoint(onCheckpoint, event, migration, step) {
  if (typeof onCheckpoint === 'function') {
    await onCheckpoint({ event, migrationId: migration.id, stepId: step?.id || null });
  }
}

async function updateFailed(connection, migration, error) {
  await connection.execute(
    `UPDATE \`${REGISTRY_TABLE}\` SET status='failed', error_message=? WHERE migration_id=? AND checksum=?`,
    [String(error?.message || error).slice(0, 4000), migration.id, migration.checksum],
  ).catch(() => undefined);
}

async function writeProgress(connection, migration, progress) {
  await connection.execute(
    `UPDATE \`${REGISTRY_TABLE}\` SET progress=?, status='applying', error_message=NULL WHERE migration_id=? AND checksum=?`,
    [JSON.stringify(progress), migration.id, migration.checksum],
  );
}

async function markApplying(connection, migration, row, progress) {
  const started = new Date();
  if (row) {
    await connection.execute(
      `UPDATE \`${REGISTRY_TABLE}\` SET status='applying', started_at=?, applied_at=NULL, attempts=attempts+1, error_message=NULL, progress=? WHERE migration_id=? AND checksum=?`,
      [started, JSON.stringify(progress), migration.id, migration.checksum],
    );
  } else {
    await connection.execute(
      `INSERT INTO \`${REGISTRY_TABLE}\` (migration_id, checksum, status, started_at, attempts, progress) VALUES (?, ?, 'applying', ?, 1, ?)`,
      [migration.id, migration.checksum, started, JSON.stringify(progress)],
    );
  }
}

async function markApplied(connection, migration, progress, startedAt) {
  await connection.execute(
    `UPDATE \`${REGISTRY_TABLE}\` SET status='applied', started_at=?, applied_at=?, attempts=GREATEST(attempts, 1), error_message=NULL, progress=? WHERE migration_id=? AND checksum=?`,
    [startedAt || new Date(), new Date(), JSON.stringify(progress), migration.id, migration.checksum],
  );
}

async function bootstrapRegistry(connection, migration, existingRow, onCheckpoint) {
  const tableBefore = await tableExists(connection, REGISTRY_TABLE);
  const columnsBefore = tableBefore ? await readRegistryColumns(connection) : new Set();
  if (tableBefore && columnsBefore.has('progress')) return false;
  let progress = existingRow ? decodeProgress(existingRow.progress, migration.id) : [];
  assertProgressBelongs(progress, migration);
  const startedAt = existingRow?.started_at || new Date();
  if (existingRow && tableBefore) {
    await connection.execute(
      `UPDATE \`${REGISTRY_TABLE}\` SET status='applying', started_at=?, applied_at=NULL, attempts=attempts+1, error_message=NULL WHERE migration_id=? AND checksum=?`,
      [startedAt, migration.id, migration.checksum],
    );
  }
  try {
    for (const step of migration.steps) {
      if (progress.includes(step.id)) {
        if (!await probeStep(connection, migration, step)) throw new Error(`migration ${migration.id}/${step.id} progress is not complete`);
        continue;
      }
      if (!await probeStep(connection, migration, step)) {
        await checkpoint(onCheckpoint, 'before-step', migration, step);
        await connection.execute(step.sql);
        await checkpoint(onCheckpoint, 'after-step-sql', migration, step);
        if (!await probeStep(connection, migration, step)) throw new Error(`migration probe ${migration.id}/${step.id} remained incomplete`);
      }
      await checkpoint(onCheckpoint, 'before-progress', migration, step);
      progress.push(step.id);
    }
    if (!await tableExists(connection, REGISTRY_TABLE) || !await columnExists(connection, REGISTRY_TABLE, 'progress')) {
      throw new Error('registry bootstrap did not create schema_migration.progress');
    }
    await connection.execute(
      `INSERT INTO \`${REGISTRY_TABLE}\` (migration_id, checksum, status, started_at, applied_at, attempts, error_message, progress) VALUES (?, ?, 'applied', ?, ?, ?, NULL, ?) ON DUPLICATE KEY UPDATE checksum=VALUES(checksum), status='applied', started_at=VALUES(started_at), applied_at=VALUES(applied_at), attempts=GREATEST(attempts, VALUES(attempts)), error_message=NULL, progress=VALUES(progress)`,
      [migration.id, migration.checksum, startedAt, new Date(), existingRow ? Number(existingRow.attempts || 0) + 1 : 1, JSON.stringify(progress)],
    );
    return true;
  } catch (error) {
    if (tableBefore && existingRow) await updateFailed(connection, migration, error);
    throw error;
  }
}

async function runMigration(connection, migration, row, onCheckpoint) {
  const progress = row ? decodeProgress(row.progress, migration.id) : [];
  assertProgressBelongs(progress, migration);
  if (row?.status === 'applied' && isComplete(progress, migration)) {
    for (const step of migration.steps) {
      if (!await probeStep(connection, migration, step)) throw new Error(`migration ${migration.id}/${step.id} is recorded complete but its invariant is false`);
    }
    return false;
  }
  await markApplying(connection, migration, row, progress);
  const startedAt = row?.started_at || new Date();
  try {
    for (const step of migration.steps) {
      if (progress.includes(step.id)) {
        if (!await probeStep(connection, migration, step)) throw new Error(`migration ${migration.id}/${step.id} progress is not complete`);
        continue;
      }
      const completeBefore = await probeStep(connection, migration, step);
      if (!completeBefore) {
        await checkpoint(onCheckpoint, 'before-step', migration, step);
        await connection.execute(step.sql);
        await checkpoint(onCheckpoint, 'after-step-sql', migration, step);
        if (!await probeStep(connection, migration, step)) throw new Error(`migration probe ${migration.id}/${step.id} remained incomplete`);
      }
      await checkpoint(onCheckpoint, 'before-progress', migration, step);
      progress.push(step.id);
      await writeProgress(connection, migration, progress);
      await checkpoint(onCheckpoint, 'after-progress', migration, step);
    }
    await markApplied(connection, migration, progress, startedAt);
    return true;
  } catch (error) {
    await updateFailed(connection, migration, error);
    throw error;
  }
}

export async function applyMigrations({ connection, database, migrations, onCheckpoint } = {}) {
  const definitions = await prepareMigrations(migrations);
  validateMigrationTarget(database);
  await readPreflight(connection, database);
  const lockName = await acquireMigrationLock(connection, database);
  try {
    await readPreflight(connection, database);
    const initialPlan = await inspectMigrations({ connection, database, migrations: definitions, allowApplying: true });
    // Execute every probe before the first metadata/DDL write. This makes a
    // malformed or unexecutable probe fail as a read-only validation error.
    await validateRuntimeProbes(connection, definitions);
    const registryMigration = definitions.find((migration) => migration.id === REGISTRY_MIGRATION_ID);
    if (!registryMigration && !await tableExists(connection, REGISTRY_TABLE)) {
      throw new Error(`${REGISTRY_MIGRATION_ID}.sql is required to bootstrap the registry`);
    }
    const initialRegistryRow = initialPlan.rows.find((row) => row.migration_id === REGISTRY_MIGRATION_ID);
    let bootstrapped = false;
    if (registryMigration) bootstrapped = await bootstrapRegistry(connection, registryMigration, initialRegistryRow, onCheckpoint);
    await readPreflight(connection, database);
    const plan = await inspectMigrations({ connection, database, migrations: definitions, allowApplying: true });
    const rowsById = new Map(plan.rows.map((row) => [row.migration_id, row]));
    const applied = [];
    if (bootstrapped) applied.push(REGISTRY_MIGRATION_ID);
    for (const migration of definitions) {
      if (migration.id === REGISTRY_MIGRATION_ID && bootstrapped) continue;
      const row = rowsById.get(migration.id);
      const changed = await runMigration(connection, migration, row, onCheckpoint);
      if (changed) applied.push(migration.id);
      const [freshRows] = await connection.execute(`SELECT migration_id, checksum, status, started_at, applied_at, attempts, error_message, progress FROM \`${REGISTRY_TABLE}\``);
      rowsById.set(migration.id, freshRows.find((item) => item.migration_id === migration.id));
    }
    return { applied, pending: [] };
  } finally {
    await releaseMigrationLock(connection, lockName);
  }
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
  if (!process.env.DB_PASSWORD) throw new Error('缺少 DB_PASSWORD 环境变量（运行期注入，不落盘）');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD,
    database,
    multipleStatements: false,
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
