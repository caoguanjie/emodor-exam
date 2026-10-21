import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const ROOT = join(import.meta.dirname, '..');
const BASE = 'c81ebe045cb25bb46f6ab5be077b68143b224a25';
const TABLES = ['question', 'question_concept', 'question_version'];
let services;
let admin;
const databases = new Set();

async function createDatabase(label) {
  const database = `ruleexam_test_b3_${label}_${randomBytes(4).toString('hex')}`;
  databases.add(database);
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  return database;
}

async function connectionFor(database) {
  return mysql.createConnection({ ...services.mysql, database });
}

async function questionSchema(connection) {
  const placeholders = TABLES.map(() => '?').join(', ');
  const [tables] = await connection.query(
    `SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME`,
    TABLES,
  );
  const [columns] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    TABLES,
  );
  const [indexes] = await connection.query(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    TABLES,
  );
  return { tables, columns, indexes };
}

before(async () => {
  services = await createEphemeralServices();
  console.log(`[owned-ephemeral] root=${services.root} mysqlPid=${services.mysqlPid} redisPid=${services.redisPid}`);
  admin = await mysql.createConnection({ ...services.mysql, multipleStatements: true });
});

after(async () => {
  const owned = services && { root: services.root, mysqlPid: services.mysqlPid, redisPid: services.redisPid };
  for (const database of databases) await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => undefined);
  await admin?.end().catch(() => undefined);
  await services?.stopProcesses();
  if (owned) {
    assert.equal(isProcessRunning(owned.mysqlPid), false);
    assert.equal(isProcessRunning(owned.redisPid), false);
  }
  await services?.cleanup();
  if (owned) {
    assert.equal(existsSync(owned.root), false);
    console.log(`[owned-ephemeral] stopped mysqlPid=${owned.mysqlPid} redisPid=${owned.redisPid}; removed exact root=${owned.root}`);
  }
});

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error?.code === 'ESRCH') return false; throw error; }
}

test('B3 CLI check is read-only and apply preserves legacy questions while converging to init', async () => {
  const currentDatabase = await createDatabase('init');
  const upgradeDatabase = await createDatabase('upgrade');
  const currentSql = await readFile(join(ROOT, 'database', 'init.sql'), 'utf8');
  const legacySql = execFileSync('git', ['show', `${BASE}:database/init.sql`], { cwd: ROOT, encoding: 'utf8' });
  await admin.query(renderSchemaForDatabase(currentSql, currentDatabase));
  await admin.query(renderSchemaForDatabase(legacySql, upgradeDatabase));

  const upgrade = await connectionFor(upgradeDatabase);
  await upgrade.execute(
    "INSERT INTO question (regulation_id, version_id, type, stem, options, answer, analysis, score, status, source, created_by) VALUES (1, 2, 'single', 'legacy stem', ?, ?, 'legacy analysis', 5.00, 'approved', 'ai', 9)",
    [JSON.stringify([{ key: 'A', text: 'yes' }, { key: 'B', text: 'no' }]), JSON.stringify([0])],
  );

  const env = {
    ...process.env,
    DB_HOST: services.mysql.host,
    DB_PORT: String(services.mysql.port),
    DB_USERNAME: services.mysql.user,
    DB_PASSWORD: services.mysql.password,
    DB_DATABASE: upgradeDatabase,
  };
  const beforeCheck = await questionSchema(upgrade);
  const check = spawnSync(process.execPath, ['database/migrate.mjs', '--check'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(await questionSchema(upgrade), beforeCheck, '--check changed the question schema');
  assert.ok(JSON.parse(check.stdout).pending.includes('007_question_bank'));

  const apply = spawnSync(process.execPath, ['database/migrate.mjs', '--apply'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(apply.status, 0, apply.stderr);
  assert.ok(JSON.parse(apply.stdout).applied.includes('007_question_bank'));

  const [[legacy]] = await upgrade.query(
    "SELECT stem, category_id, difficulty, concept_id, current_version_id, rubric FROM question WHERE stem = 'legacy stem'",
  );
  assert.deepEqual(
    [legacy.stem, legacy.category_id, legacy.difficulty, legacy.concept_id, legacy.current_version_id, legacy.rubric],
    ['legacy stem', null, null, null, null, null],
  );
  const [[captured]] = await upgrade.query('SELECT COUNT(*) AS count FROM question_version');
  assert.equal(Number(captured.count), 0, 'migration must not fabricate legacy version history');

  const current = await connectionFor(currentDatabase);
  assert.deepEqual(await questionSchema(upgrade), await questionSchema(current));
  await current.end();
  await upgrade.end();
});
