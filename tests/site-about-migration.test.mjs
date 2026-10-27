import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { applyMigrations, listMigrations } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';

const mysql = createRequire(new URL('../server/package.json', import.meta.url))('mysql2/promise');

test('about settings upgrade matches fresh init, preserves branding and never overwrites edited content', async () => {
  const migration = (await listMigrations()).find(row => row.id === '039_site_about_settings');
  assert.ok(migration, 'about config needs an upgrade for existing environments');
  const services = await createEphemeralServices();
  const database = `ruleexam_test_site_about_${randomBytes(6).toString('hex')}`;
  let conn;
  try {
    conn = await mysql.createConnection({ ...services.mysql, multipleStatements: true, timezone: 'Z' });
    const sql = renderSchemaForDatabase(await readFile(new URL('../database/init.sql', import.meta.url), 'utf8'), database);
    await conn.query(sql);
    const [[fresh]] = await conn.query("SELECT value_json FROM site_setting WHERE setting_key='about'");
    assert.ok(fresh?.value_json?.service_terms?.content?.length, 'fresh defaults include the existing terms');
    const [branding] = await conn.query("SELECT * FROM site_setting WHERE setting_key IN ('logo_asset_id','banners') ORDER BY id");
    const [references] = await conn.query('SELECT * FROM media_reference ORDER BY id');
    await conn.query("DELETE FROM site_setting WHERE setting_key='about'");
    const applied = await applyMigrations({ connection: conn, database, migrations: [migration] });
    assert.deepEqual(applied.applied, ['039_site_about_settings']);
    const [[upgraded]] = await conn.query("SELECT value_json FROM site_setting WHERE setting_key='about'");
    assert.deepEqual(upgraded.value_json, fresh.value_json);
    const custom = { ...upgraded.value_json, institution_name: '保留用户配置', contact_email: '', service_terms: null };
    await conn.execute("UPDATE site_setting SET value_json=? WHERE setting_key='about'", [JSON.stringify(custom)]);
    const repeated = await applyMigrations({ connection: conn, database, migrations: [migration] });
    assert.deepEqual(repeated.applied, []);
    await conn.query(sql);
    const [[preserved]] = await conn.query("SELECT value_json FROM site_setting WHERE setting_key='about'");
    assert.deepEqual(preserved.value_json, custom);
    const [afterBranding] = await conn.query("SELECT * FROM site_setting WHERE setting_key IN ('logo_asset_id','banners') ORDER BY id");
    const [afterReferences] = await conn.query('SELECT * FROM media_reference ORDER BY id');
    assert.deepEqual(afterBranding, branding);
    assert.deepEqual(afterReferences, references);
  } finally {
    if (conn) { await conn.query(`DROP DATABASE IF EXISTS \`${database}\``); await conn.end(); }
    await services.stopProcesses();
    await services.cleanup();
  }
});
