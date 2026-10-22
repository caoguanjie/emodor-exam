import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { applyMigrations, listMigrations, parseMigrationText } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const root = new URL('../', import.meta.url).pathname;
const previousSchema = execFileSync('git', ['show', '09ddb1f:database/init.sql'], { cwd: root, encoding: 'utf8' });
const retiredRoutes = ['/admin/regulations', '/admin/users', '/admin/departments', '/admin/grading', '/admin/exam-monitor'];
let services;
let admin;
const databases = [];

before(async () => {
  services = await createEphemeralServices();
  console.log(`[slim-migration-owned] ${services.root} mysql=${services.mysqlPid} redis=${services.redisPid}`);
  admin = await mysql.createConnection({ ...services.mysql, multipleStatements: true });
});

after(async () => {
  try {
    for (const database of databases) await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``);
  } finally {
    await admin?.end();
    await services?.stopProcesses();
    await services?.cleanup();
  }
});

async function fixture(schema) {
  const database = `ruleexam_test_slim_${randomBytes(5).toString('hex')}`;
  databases.push(database);
  await admin.query(renderSchemaForDatabase(schema, database));
  const connection = await mysql.createConnection({ ...services.mysql, database, multipleStatements: true });
  return { database, connection };
}

async function assertMenuContract(connection) {
  const [rows] = await connection.query('SELECT name, type, route_path, parent_id, status FROM sys_menu ORDER BY sort,id');
  for (const path of retiredRoutes) assert.equal(rows.some((row) => row.route_path === path), false, path);
  const active = rows.filter((row) => row.status === 1);
  assert.deepEqual(active.filter((row) => row.parent_id === null).map((row) => row.name),
    ['业务首页', '培训管理', '考试管理', '统计分析', '系统设置']);
  assert.equal(active.filter((row) => row.type === 'menu').length, 16);
  assert.equal(rows.find((row) => row.route_path === '/admin/statistics')?.status, 0);
  const [permissions] = await connection.query("SELECT code FROM sys_permission WHERE code LIKE 'departments:%' OR code LIKE 'regulations:%' OR code IN ('exam_records:monitor','exam_records:review')");
  assert.deepEqual(permissions, []);
}

async function assertObjectiveSchema(connection) {
  const [types] = await connection.query("SELECT code FROM sys_dictionary WHERE type='question_type' ORDER BY sort");
  assert.deepEqual(types.map(row => row.code), ['single', 'multiple', 'judgment']);
  const [tables] = await connection.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='exam_review_event'");
  assert.equal(tables.length, 0);
  const [columns] = await connection.query(`SELECT TABLE_NAME,COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND (
    (TABLE_NAME='exam_answer' AND COLUMN_NAME IN ('asset_ids','comment','grading_version')) OR
    (TABLE_NAME='exam_record' AND COLUMN_NAME IN ('last_heartbeat_at','device_summary','switch_count','grading_revision')) OR
    (TABLE_NAME IN ('question','question_version') AND COLUMN_NAME='rubric'))`);
  assert.deepEqual(columns, []);
}

test('fresh initialization exposes five groups and only the objective examination schema', async () => {
  const { connection } = await fixture(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
  try { await assertMenuContract(connection); await assertObjectiveSchema(connection); }
  finally { await connection.end(); }
});

test('existing installation upgrades and repeated migration does not resurrect retired features', async () => {
  const { database, connection } = await fixture(previousSchema);
  try {
    const migrations = await listMigrations();
    assert.ok(migrations.some((item) => item.id === '015_demo_slimming'));
    await applyMigrations({ connection, database, migrations: migrations.filter((item) => item.id < '015_demo_slimming') });
    await applyMigrations({ connection, database, migrations });
    await assertMenuContract(connection);
    await assertObjectiveSchema(connection);
    await applyMigrations({ connection, database, migrations });
    await assertMenuContract(connection);
    await assertObjectiveSchema(connection);
  } finally { await connection.end(); }
});

test('latest initialization with empty migration registry can run the complete catalog', async () => {
  const { database, connection } = await fixture(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
  try {
    await applyMigrations({ connection, database, migrations: await listMigrations() });
    await assertMenuContract(connection);
    await assertObjectiveSchema(connection);
  } finally { await connection.end(); }
});

test('historical review data blocks destructive slimming before menus or records change', async () => {
  const { database, connection } = await fixture(previousSchema);
  try {
    await connection.query("INSERT INTO exam_review_event (exam_record_id,record_question_id,reviewer_id,after_score,grading_version) VALUES (99,98,1,12,1)");
    const migrations = await listMigrations();
    await assert.rejects(() => applyMigrations({ connection, database, migrations }), /retired examination data.*block|瘦身.*历史/i);
    const [[event]] = await connection.query('SELECT after_score FROM exam_review_event WHERE exam_record_id=99');
    assert.equal(Number(event.after_score), 12);
    const [[menu]] = await connection.query("SELECT COUNT(*) AS total FROM sys_menu WHERE route_path='/admin/grading'");
    assert.equal(menu.total, 1);
  } finally { await connection.end(); }
});

test('cancelled question types in draft paper rules block migration before deleting menus', async () => {
  const { database, connection } = await fixture(previousSchema);
  try {
    await connection.query("INSERT INTO exam_paper (title,created_by,rule_config) VALUES ('历史规则',1,?)", [JSON.stringify({ rules: [{ type: 'image', count: 1, scoreCents: 10000 }] })]);
    const migrations = await listMigrations();
    await assert.rejects(() => applyMigrations({ connection, database, migrations }), /retired examination data.*block/i);
    const [[menu]] = await connection.query("SELECT COUNT(*) AS total FROM sys_menu WHERE route_path='/admin/grading'");
    assert.equal(menu.total, 1);
  } finally { await connection.end(); }
});

test('slimming preserves a preexisting directory using the fresh-install exam directory ID', async () => {
  const { database, connection } = await fixture(previousSchema);
  try {
    await connection.query("INSERT INTO sys_menu (id,parent_id,name,type,sort,status) VALUES (3,NULL,'保留的自定义目录','directory',999,0)");
    await applyMigrations({ connection, database, migrations: await listMigrations() });
    const [[custom]] = await connection.query('SELECT name,status,sort FROM sys_menu WHERE id=3');
    assert.deepEqual({ ...custom }, { name: '保留的自定义目录', status: 0, sort: 999 });
    await assertMenuContract(connection);
  } finally { await connection.end(); }
});

test('slimming resumes after destructive DDL commits before its progress checkpoint', async () => {
  const { database, connection } = await fixture(previousSchema);
  const migrations = await listMigrations();
  try {
    await assert.rejects(() => applyMigrations({
      connection, database, migrations,
      onCheckpoint: ({ event, migrationId, stepId }) => {
        if (migrationId === '015_demo_slimming' && stepId === 'objective_answer_columns' && event === 'after-step-sql') {
          throw new Error('simulated checkpoint interruption');
        }
      },
    }), /simulated checkpoint interruption/);
    await applyMigrations({ connection, database, migrations });
    await assertMenuContract(connection);
    await assertObjectiveSchema(connection);
  } finally { await connection.end(); }
});

test('migration deletion SQL must name one table and constrain row deletion', () => {
  const migration = (sql) => parseMigrationText('015_test', `-- @step clean\n-- @check SELECT 0 AS complete;\n${sql}`);
  assert.doesNotThrow(() => migration('DELETE FROM sys_menu WHERE route_path = \'/admin/grading\';'));
  assert.doesNotThrow(() => migration('DROP TABLE IF EXISTS exam_review_event;'));
  for (const sql of ['DELETE FROM sys_menu;', 'DROP TABLE exam_review_event;', 'DROP TABLE IF EXISTS exam_review_event,sys_user;', 'DROP DATABASE ruleexam;']) {
    assert.throws(() => migration(sql));
  }
});
