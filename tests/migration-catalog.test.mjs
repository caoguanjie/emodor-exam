import test from 'node:test';
import assert from 'node:assert/strict';
import { listMigrations } from '../database/migrate.mjs';

test('every shipped migration is accepted by the real runner before database access', async () => {
  // Catch unsupported SQL in newly shipped files, not only in synthetic parser
  // fixtures. listMigrations validates the entire catalog without a DB socket.
  const migrations = await listMigrations();
  assert.ok(migrations.length > 0);
  for (const migration of migrations) assert.ok(migration.steps.length > 0, migration.id);
  assert.deepEqual(migrations.slice(-5).map((migration) => migration.id), [
    '025_question_bank_without_scores', '026_question_lifecycle_slimming', '027_question_review_permission_cleanup',
    '028_access_password_backfill_probe',
    '030_cos_media_storage',
  ]);
  const lifecycle = migrations.find((migration) => migration.id === '026_question_lifecycle_slimming');
  assert.equal(lifecycle.steps[0].replacesCheck, '025_question_bank_without_scores/question_score_nullable');
  const cos = migrations.find((migration) => migration.id === '030_cos_media_storage');
  assert.equal(cos.steps[0].replacesCheck, '003_media/create_media_asset');
});
