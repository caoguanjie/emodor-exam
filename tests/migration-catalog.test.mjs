import test from 'node:test';
import assert from 'node:assert/strict';
import { listMigrations } from '../database/migrate.mjs';

test('every shipped migration is accepted by the real runner before database access', async () => {
  // Catch unsupported SQL in newly shipped files, not only in synthetic parser
  // fixtures. listMigrations validates the entire catalog without a DB socket.
  const migrations = await listMigrations();
  assert.ok(migrations.length > 0);
  for (const migration of migrations) assert.ok(migration.steps.length > 0, migration.id);
  assert.deepEqual(migrations.slice(-4).map((migration) => migration.id), [
    '026_question_lifecycle_slimming', '027_question_review_permission_cleanup',
    '028_access_password_backfill_probe', '029_question_soft_delete',
  ]);
  const lifecycle = migrations.find((migration) => migration.id === '026_question_lifecycle_slimming');
  assert.equal(lifecycle.steps[0].replacesCheck, '025_question_bank_without_scores/question_score_nullable');
  const deletion = migrations.find((migration) => migration.id === '029_question_soft_delete');
  assert.equal(deletion.steps[0].replacesCheck, '026_question_lifecycle_slimming/add_question_enabled');
});
