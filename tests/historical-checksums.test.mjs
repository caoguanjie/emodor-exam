import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { HISTORICAL_CHECKSUMS, matchesHistoricalChecksum } from '../database/historical-checksums.mjs';
import { listMigrations, applyMigrations, inspectMigrations } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';
const mysql = createRequire(new URL('../server/package.json', import.meta.url))('mysql2/promise');

test('only exact approved applied historical/current pairs match', () => {
  for (const [id, pair] of Object.entries(HISTORICAL_CHECKSUMS)) {
    const row = { migration_id: id, checksum: pair.recorded, status: 'applied' };
    const migration = { id, checksum: pair.current };
    assert.equal(matchesHistoricalChecksum(row, migration), true);
    for (const status of ['failed', 'applying', 'pending']) assert.equal(matchesHistoricalChecksum({ ...row, status }, migration), false);
    assert.equal(matchesHistoricalChecksum({ ...row, checksum: '0'.repeat(64) }, migration), false);
    assert.equal(matchesHistoricalChecksum(row, { ...migration, checksum: '0'.repeat(64) }), false);
    assert.equal(matchesHistoricalChecksum(row, { ...migration, id: '034_administrator_soft_delete' }), false);
  }
});

test('real DB preserves accepted registry rows, handles successor probes and rejects drift or incomplete history', async () => {
  const services = await createEphemeralServices();
  let c;
  try {
    c = await mysql.createConnection({ ...services.mysql, multipleStatements: true });
    const database = `ruleexam_test_history_${randomBytes(5).toString('hex')}`;
    await c.query(renderSchemaForDatabase(await readFile(new URL('../database/init.sql', import.meta.url), 'utf8'), database));
    const migrations = await listMigrations();
    await applyMigrations({ connection: c, database, migrations });
    for (const [id, pair] of Object.entries(HISTORICAL_CHECKSUMS)) {
      await c.execute('UPDATE schema_migration SET checksum=? WHERE migration_id=?', [pair.recorded, id]);
    }
    const registry = async () => (await c.query('SELECT * FROM schema_migration ORDER BY migration_id'))[0];
    const before = await registry();
    const result = await applyMigrations({ connection: c, database, migrations });
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.compatibilityAccepted, Object.keys(HISTORICAL_CHECKSUMS));
    assert.deepEqual(await registry(), before);
    const row = before.find(r => r.migration_id === '035_role_management');
    await c.execute('UPDATE schema_migration SET progress=? WHERE migration_id=?', ['[]', row.migration_id]);
    await assert.rejects(inspectMigrations({ connection: c, database, migrations }), /incomplete checkpoints/);
    await c.execute('UPDATE schema_migration SET progress=?,checksum=? WHERE migration_id=?', [JSON.stringify(row.progress), '0'.repeat(64), row.migration_id]);
    await assert.rejects(inspectMigrations({ connection: c, database, migrations }), /checksum conflict/);
    await c.execute('UPDATE schema_migration SET checksum=? WHERE migration_id=?', [row.checksum, row.migration_id]);
    await c.query('ALTER TABLE sys_role DROP COLUMN remark');
    await assert.rejects(inspectMigrations({ connection: c, database, migrations }), /invariant conflict/);
  } finally {
    await c?.end();
    await services.cleanup();
  }
});
