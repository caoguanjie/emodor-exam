import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { listMigrations } from '../database/migrate.mjs';
import { createEphemeralServices } from './support/ephemeral-services.mjs';

const TARGET = '030_cos_media_storage';
const mysql = createRequire(new URL('../server/package.json', import.meta.url))('mysql2/promise');
let services;

test('030 is accepted by the real migration runner and replaces the old media shape check', async () => {
  const target = (await listMigrations()).find((migration) => migration.id === TARGET);
  assert.ok(target, 'COS schema migration must be shipped');
  assert.equal(target.steps.length, 2);
  assert.equal(target.steps[0].replacesCheck, '003_media/create_media_asset');
});

// Real MySQL exercises defaults, request uniqueness, schema drift and DDL recovery.
// It never connects to the developer database or reads a project environment file.
before(async () => {
  const target = (await listMigrations()).find((migration) => migration.id === TARGET);
  if (target) services = await createEphemeralServices();
});

after(async () => {
  await services?.stopProcesses();
  await services?.cleanup();
});

test('030 upgrades and resumes without changing old asset IDs, hashes or references', async () => {
  assert.ok(services, 'COS schema migration must exist before upgrade checks');
  const { verifyCosMediaSchema } = await import('./cos-media-schema.mjs');
  const result = await verifyCosMediaSchema({ mysql, mysqlConfig: services.mysql });
  assert.equal(result.scenarios, 5);
});
