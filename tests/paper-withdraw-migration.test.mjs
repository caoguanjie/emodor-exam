import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { applyMigrations, listMigrations } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const mysql = createRequire(new URL('../server/package.json', import.meta.url))('mysql2/promise');
const expectedComment = 'draft / published / withdrawn；archived 仅历史兼容';

test('withdraw metadata upgrades idempotently without changing other dictionaries or column types', async () => {
  const migration = (await listMigrations()).find(row => row.id === '040_paper_withdraw_metadata');
  assert.ok(migration, 'withdraw status needs matching fresh and upgrade metadata');
  const services = await createEphemeralServices();
  const database = `ruleexam_test_withdraw_${randomBytes(6).toString('hex')}`;
  let conn;
  try {
    conn = await mysql.createConnection({ ...services.mysql, multipleStatements: true });
    const sql = renderSchemaForDatabase(await readFile(new URL('../database/init.sql', import.meta.url), 'utf8'), database);
    await conn.query(sql);
    const [[fresh]] = await conn.query("SELECT label,sort,status,is_system FROM sys_dictionary WHERE type='paper_status' AND code='withdrawn'");
    assert.deepEqual(fresh, { label: '已撤回', sort: 25, status: 1, is_system: 1 });
    const [otherRows] = await conn.query("SELECT * FROM sys_dictionary WHERE NOT(type='paper_status' AND code='withdrawn') ORDER BY id");
    const [beforeColumns] = await conn.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='exam_paper' ORDER BY ORDINAL_POSITION");
    await conn.query("DELETE FROM sys_dictionary WHERE type='paper_status' AND code='withdrawn'");
    await conn.query("ALTER TABLE exam_paper MODIFY COLUMN status VARCHAR(16) NOT NULL DEFAULT 'draft' COMMENT 'draft / published；withdrawn / archived 仅历史兼容'");
    const applied = await applyMigrations({ connection: conn, database, migrations: [migration] });
    assert.deepEqual(applied.applied, [migration.id]);
    const [[upgraded]] = await conn.query("SELECT label,sort,status,is_system FROM sys_dictionary WHERE type='paper_status' AND code='withdrawn'");
    assert.deepEqual(upgraded, fresh);
    const [[column]] = await conn.query("SELECT COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='exam_paper' AND COLUMN_NAME='status'");
    assert.equal(column.COLUMN_COMMENT, expectedComment);
    const [afterColumns] = await conn.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='exam_paper' ORDER BY ORDINAL_POSITION");
    assert.deepEqual(afterColumns, beforeColumns);
    const [afterRows] = await conn.query("SELECT * FROM sys_dictionary WHERE NOT(type='paper_status' AND code='withdrawn') ORDER BY id");
    assert.deepEqual(afterRows, otherRows);
    assert.deepEqual((await applyMigrations({ connection: conn, database, migrations: [migration] })).applied, []);
  } finally {
    if (conn) { await conn.query(`DROP DATABASE IF EXISTS \`${database}\``); await conn.end(); }
    await services.stopProcesses();
    await services.cleanup();
  }
});
