import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createEphemeralServices } from './support/ephemeral-services.mjs';
import { renderSchemaForDatabase } from './support/test-target.mjs';
import { practiceStartPublishRace } from './support/practice-start-publish-concurrency.mjs';

const mysql = createRequire(new URL('../server/package.json', import.meta.url))('mysql2/promise');
const database = `ruleexam_test_practice_start_publish_${randomBytes(5).toString('hex')}`;
let services, admin;

before(async () => {
  services = await createEphemeralServices();
  admin = await mysql.createConnection({ ...services.mysql, multipleStatements: true });
  const sql = await readFile(new URL('../database/init.sql', import.meta.url), 'utf8');
  await admin.query(renderSchemaForDatabase(sql, database));
});

after(async () => {
  await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin?.end();
  await services?.stopProcesses();
  await services?.cleanup();
  if (services) assert.equal(existsSync(services.root), false, 'owned ephemeral directory must be removed');
});

for (const retake of [false, true]) test(`practice ${retake ? 'retake' : 'first start'} observes the release committed while waiting for the paper lock`, async t => {
  const result = await practiceStartPublishRace(services.mysql, database, (sql, parameters) => admin.query(sql, parameters).then(([rows]) => rows), { retake });
  t.diagnostic(JSON.stringify({ connection_ids: result.connectionIds, isolation: result.isolation, paper_lock_waits: result.paperLockWaits,
    stale_expected_release_id: result.fixture.firstReleaseId, committed_release_id: result.nextReleaseId,
    stale_start: result.staleStart.status, stale_code: result.staleStart.reason?.code,
    stale_observed_release_id: result.staleStart.value?.release_id, before: result.before, after_stale: result.afterStale }));
  assert.equal(result.staleStart.status, 'rejected', 'a stale expectation must not create or recover an older-version record');
  assert.equal(result.staleStart.reason.code, 40970);
  assert.deepEqual(result.afterStale, result.before, 'stale start must leave assignments, records and items unchanged');
  assert.equal(result.nextStart.status, 'fulfilled');
  assert.equal(result.nextStart.value.release_id, result.nextReleaseId);
  assert.equal(result.nextStart.value.questions.length, 2);
  assert.equal(result.afterLatest.records, result.before.records + 1);
  assert.equal(result.afterLatest.items, result.before.items + 2);
  assert.deepEqual(result.latestRecord.ruleSnapshot, result.fixture.nextRule);
  assert.equal(new Date(result.latestRecord.deadlineAt) - new Date(result.latestRecord.startedAt), 45 * 60000);
  if (retake) {
    assert.deepEqual(result.assignmentAfter, result.assignmentBefore);
    assert.equal(result.latestRecord.source, 'institution');
    assert.equal(result.latestRecord.difficulty, 'easy');
  }
});
