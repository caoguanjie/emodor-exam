import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { applyMigrations, listMigrations } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const mysql = createRequire(new URL('../server/package.json', import.meta.url))('mysql2/promise');

test('041 restores only withdrawn training papers and preserves frozen exam facts on repeated execution', async () => {
  const migration = (await listMigrations()).find(row => row.id === '041_training_withdraw_to_draft');
  assert.ok(migration);
  const services = await createEphemeralServices();
  const database = `ruleexam_test_restore_${randomBytes(6).toString('hex')}`;
  let conn;
  try {
    conn = await mysql.createConnection({ ...services.mysql, multipleStatements: true });
    await conn.query(renderSchemaForDatabase(await readFile(new URL('../database/init.sql', import.meta.url), 'utf8'), database));
    await conn.query("ALTER TABLE exam_paper MODIFY COLUMN status VARCHAR(16) NOT NULL DEFAULT 'draft' COMMENT 'draft / published / withdrawn；archived 仅历史兼容'");
    for (const [id, scope, status] of [[901, 'training', 'withdrawn'], [902, 'training', 'published'], [903, 'training', 'archived'], [904, 'regulation', 'withdrawn']]) {
      await conn.query("INSERT INTO exam_paper(id,business_scope,title,status,created_by,updated_by,updated_at) VALUES (?,?,?, ?,1,7,'2026-10-20 12:34:56.789')", [id, scope, `retained-${id}`, status]);
    }
    await conn.query("INSERT INTO paper_release(id,paper_id,version_no,business_scope,mode,rule_snapshot,created_by) VALUES (901,901,1,'training','fixed',JSON_OBJECT('totalCents',10000),1)");
    await conn.query("INSERT INTO paper_question(paper_id,question_id,score) VALUES(901,901,100)");
    await conn.query("INSERT INTO exam_assignment(id,paper_id,user_id,release_id,difficulty,rule_snapshot,snapshot_origin) VALUES(901,901,1,901,'easy',JSON_OBJECT('totalCents',10000),'release')");
    await conn.query("INSERT INTO exam_record(id,paper_id,user_id,assignment_id,release_id,status,score,started_at,deadline_at,grading_state) VALUES(901,901,1,901,901,'passed',100,'2026-10-20 12:00:00','2026-10-20 12:30:00','finalized')");
    const [papers] = await conn.query('SELECT * FROM exam_paper WHERE id>=901 ORDER BY id');
    const preserved = {};
    for (const table of ['paper_release', 'paper_question', 'exam_assignment', 'exam_record']) {
      [preserved[table]] = await conn.query(`SELECT * FROM ${table} ORDER BY id`);
    }
    assert.deepEqual((await applyMigrations({ connection: conn, database, migrations: [migration] })).applied, [migration.id]);
    const [after] = await conn.query('SELECT * FROM exam_paper WHERE id>=901 ORDER BY id');
    const [[column]] = await conn.query("SELECT COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='exam_paper' AND COLUMN_NAME='status'");
    assert.equal(column.COLUMN_COMMENT, 'draft / published；withdrawn / archived 仅历史兼容');
    assert.deepEqual(after, papers.map(row => Number(row.id) === 901 ? { ...row, status: 'draft' } : row));
    for (const table of Object.keys(preserved)) {
      const [rows] = await conn.query(`SELECT * FROM ${table} ORDER BY id`);
      assert.deepEqual(rows, preserved[table], `${table} must remain frozen`);
    }
    assert.deepEqual((await applyMigrations({ connection: conn, database, migrations: [migration] })).applied, []);
  } finally {
    if (conn) { await conn.query(`DROP DATABASE IF EXISTS \`${database}\``); await conn.end(); }
    await services.stopProcesses();
    await services.cleanup();
  }
});
