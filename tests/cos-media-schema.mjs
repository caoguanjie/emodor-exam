import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { applyMigrations, listMigrations } from '../database/migrate.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const BASE = '44b9d7f';
const TARGET = '030_cos_media_storage';
const ROOT = new URL('../', import.meta.url);
const require = createRequire(new URL('../server/package.json', import.meta.url));

async function columns(connection, table) {
  const [rows] = await connection.execute('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [table]);
  return rows;
}

async function oldMediaFacts(connection) {
  const [assets] = await connection.query('SELECT CAST(id AS CHAR) id,CAST(owner_id AS CHAR) owner_id,CAST(uploaded_by AS CHAR) uploaded_by,purpose,media_kind,original_name,mime_type,storage_key,CAST(size_bytes AS CHAR) size_bytes,sha256,status,duration_ms,probe_error,created_at,updated_at FROM media_asset ORDER BY id');
  const [references] = await connection.query('SELECT CAST(id AS CHAR) id,CAST(asset_id AS CHAR) asset_id,owner_type,CAST(owner_id AS CHAR) owner_id,created_at FROM media_reference ORDER BY id');
  return { assets, references };
}

async function seedLegacy(connection) {
  await connection.execute("INSERT INTO media_asset (id,owner_id,uploaded_by,purpose,media_kind,original_name,mime_type,storage_key,size_bytes,sha256,status,duration_ms,created_at,updated_at) VALUES ('9007199254740997',9,9,'video','video','历史视频.mp4','video/mp4','media/legacy/immutable.mp4',128,?,'ready',1200,'2026-01-01 10:00:00.000','2026-01-02 10:00:00.000')", ['f'.repeat(64)]);
  await connection.query("INSERT INTO media_reference (asset_id,owner_type,owner_id,created_at) VALUES ('9007199254740997','lesson_version',51,'2026-01-03 10:00:00.000')");
}

/** Isolated schema checks shared by node:test and the repository E2E harness. */
export async function verifyCosMediaSchema({ mysql = require('mysql2/promise'), mysqlConfig }) {
  const migrations = await listMigrations();
  const target = migrations.find((item) => item.id === TARGET);
  assert.ok(target, 'COS schema migration must be shipped');
  const admin = await mysql.createConnection({ ...mysqlConfig, multipleStatements: true });
  const databases = new Set();
  const currentSql = await readFile(new URL('../database/init.sql', import.meta.url), 'utf8');
  const baselineSql = execFileSync('git', ['show', `${BASE}:database/init.sql`], { cwd: ROOT, encoding: 'utf8' });
  const open = async (label, current = false) => {
    const database = `ruleexam_test_cos_schema_${label}_${randomBytes(4).toString('hex')}`;
    databases.add(database);
    await admin.query(renderSchemaForDatabase(current ? currentSql : baselineSql, database));
    const connection = await mysql.createConnection({ ...mysqlConfig, database });
    try {
      if (!current) await applyMigrations({ connection, database, migrations: migrations.filter((item) => item.id < TARGET) });
    } catch (error) {
      await connection.end();
      throw error;
    }
    return { connection, database };
  };
  try {
    // 1: upgrade, unchanged history, current-init parity, and idempotent replay.
    const old = await open('upgrade');
    const fresh = await open('fresh', true);
    try {
      await seedLegacy(old.connection);
      const facts = await oldMediaFacts(old.connection);
      await applyMigrations({ ...old, migrations });
      assert.deepEqual(await oldMediaFacts(old.connection), facts);
      const [[row]] = await old.connection.query("SELECT storage_provider,cos_bucket,cos_region,cos_version_id,etag,crc64 FROM media_asset WHERE id='9007199254740997'");
      assert.deepEqual(row, { storage_provider: 'local', cos_bucket: null, cos_region: null, cos_version_id: null, etag: null, crc64: null });
      for (const table of ['media_asset', 'media_upload_session']) assert.deepEqual(await columns(old.connection, table), await columns(fresh.connection, table));
      await applyMigrations({ ...fresh, migrations });
      const [before] = await old.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
      await applyMigrations({ ...old, migrations });
      const [after] = await old.connection.query('SELECT * FROM schema_migration ORDER BY migration_id');
      assert.deepEqual(after, before);
      assert.deepEqual(await oldMediaFacts(old.connection), facts);
    } finally { await old.connection.end(); await fresh.connection.end(); }

    // 2/3: either DDL can commit before progress is saved; retry must probe it.
    for (const step of target.steps) {
      const state = await open(`crash_${step.id}`);
      try {
        await seedLegacy(state.connection);
        const facts = await oldMediaFacts(state.connection);
        await assert.rejects(() => applyMigrations({ ...state, migrations,
          onCheckpoint({ event, migrationId, stepId }) {
            if (event === 'after-step-sql' && migrationId === TARGET && stepId === step.id) throw new Error('simulated COS DDL crash');
          },
        }), /simulated COS DDL crash/);
        await applyMigrations({ ...state, migrations,
          onCheckpoint({ event, migrationId, stepId }) {
            assert.ok(!(event === 'after-step-sql' && migrationId === TARGET && stepId === step.id), 'completed COS DDL must not be replayed');
          },
        });
        assert.deepEqual(await oldMediaFacts(state.connection), facts);
        const [[registry]] = await state.connection.execute('SELECT status,progress FROM schema_migration WHERE migration_id=?', [TARGET]);
        assert.equal(registry.status, 'applied');
        assert.deepEqual(registry.progress, target.steps.map((item) => item.id));
      } finally { await state.connection.end(); }
    }

    // 4: the successor retains all legacy invariants and checks new columns too.
    for (const [label, alter] of [
      ['old_column', 'ALTER TABLE media_asset MODIFY storage_key VARCHAR(300) NOT NULL'],
      ['new_column', 'ALTER TABLE media_asset MODIFY storage_provider VARCHAR(16) NULL DEFAULT NULL'],
      ['old_index', 'ALTER TABLE media_asset DROP INDEX uk_media_asset_storage_key, ADD INDEX uk_media_asset_storage_key(storage_key)'],
    ]) {
      const state = await open(label, true);
      try {
        await state.connection.query(alter);
        await assert.rejects(() => applyMigrations({ ...state, migrations }));
      } finally { await state.connection.end(); }
    }

    // 5: the DB enforces request ownership uniqueness; malformed queue indexes,
    // partial columns and foreign-key drift are never adopted as completed.
    const sessionState = await open('sessions', true);
    try {
      const values = [
        '00112233-4455-4677-8899-aabbccddeeff', 9, 9,
        '10112233-4455-4677-8899-aabbccddeeff', 'a'.repeat(64), 'video',
        'video/mp4', 128, 'b'.repeat(64), 'multipart', 8388608, new Date(Date.now() + 60_000),
      ];
      const insert = 'INSERT INTO media_upload_session (id,owner_id,uploaded_by,client_request_id,request_digest,purpose,mime_type,size_bytes,fingerprint_sha256,mode,part_size,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)';
      await sessionState.connection.execute(insert, values);
      await assert.rejects(() => sessionState.connection.execute(insert, ['20112233-4455-4677-8899-aabbccddeeff', ...values.slice(1)]), { code: 'ER_DUP_ENTRY' });
      await sessionState.connection.execute(insert, ['30112233-4455-4677-8899-aabbccddeeff', 10, 10, ...values.slice(3)]);
      const [[session]] = await sessionState.connection.query('SELECT state,finalize_attempts,asset_id,receipt FROM media_upload_session ORDER BY id LIMIT 1');
      assert.deepEqual(session, { state: 'uploading', finalize_attempts: 0, asset_id: null, receipt: null });
      const [[assets]] = await sessionState.connection.query('SELECT COUNT(*) count FROM media_asset');
      assert.equal(Number(assets.count), 0, 'declaring an upload must not require a fake media SHA row');
      await sessionState.connection.query("UPDATE media_upload_session SET state='expired',original_name=NULL,staging_locator=NULL,candidate_objects=NULL,receipt=NULL WHERE id='00112233-4455-4677-8899-aabbccddeeff'");
      await assert.rejects(() => sessionState.connection.execute(insert, ['40112233-4455-4677-8899-aabbccddeeff', ...values.slice(1)]), { code: 'ER_DUP_ENTRY' });
      const [[foreignKeys]] = await sessionState.connection.query("SELECT COUNT(*) count FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('media_asset','media_upload_session')");
      assert.equal(Number(foreignKeys.count), 0);
      for (const alter of [
        'ALTER TABLE media_upload_session DROP INDEX idx_media_upload_queue, ADD INDEX idx_media_upload_queue(state,expires_at)',
        'ALTER TABLE media_upload_session DROP COLUMN last_credential_expires_at',
        'ALTER TABLE media_upload_session MODIFY receipt LONGTEXT NULL',
        'ALTER TABLE media_upload_session MODIFY client_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL',
        'ALTER TABLE media_upload_session ADD CONSTRAINT fk_invalid_upload_owner FOREIGN KEY (owner_id) REFERENCES sys_user(id)',
      ]) {
        const state = await open('session_drift', true);
        try {
          await state.connection.query(alter);
          const [[probe]] = await state.connection.execute(target.steps[1].checkSql);
          assert.equal(Number(probe.complete), 0);
          await assert.rejects(() => applyMigrations({ ...state, migrations }));
        } finally { await state.connection.end(); }
      }
    } finally { await sessionState.connection.end(); }
    return { scenarios: 5 };
  } finally {
    for (const database of databases) await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
}

export async function run(ctx) {
  await verifyCosMediaSchema({ mysqlConfig: {
    host: ctx.env.DB_HOST, port: Number(ctx.env.DB_PORT),
    user: ctx.env.DB_USERNAME, password: ctx.env.DB_PASSWORD,
  } });
}
