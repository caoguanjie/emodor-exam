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
    '029_question_soft_delete', '030_paper_learning_requirement',
    '031_paper_sort_order', '032_paper_operation_metadata',
    '033_cos_media_storage',
  ]);
  const lifecycle = migrations.find((migration) => migration.id === '026_question_lifecycle_slimming');
  assert.equal(lifecycle.steps[0].replacesCheck, '025_question_bank_without_scores/question_score_nullable');
  const deletion = migrations.find((migration) => migration.id === '029_question_soft_delete');
  assert.equal(deletion.steps[0].replacesCheck, '026_question_lifecycle_slimming/add_question_enabled');
  const cos = migrations.find((migration) => migration.id === '033_cos_media_storage');
  assert.equal(cos.steps[0].replacesCheck, '003_media/create_media_asset');
});
