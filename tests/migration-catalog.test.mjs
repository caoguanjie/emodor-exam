import test from 'node:test';
import assert from 'node:assert/strict';
import { listMigrations } from '../database/migrate.mjs';

test('every shipped migration is accepted by the real runner before database access', async () => {
  // Catch unsupported SQL in newly shipped files, not only in synthetic parser
  // fixtures. listMigrations validates the entire catalog without a DB socket.
  const migrations = await listMigrations();
  assert.ok(migrations.length > 0);
  for (const migration of migrations) assert.ok(migration.steps.length > 0, migration.id);
  assert.deepEqual(migrations.slice(-10).map((migration) => migration.id), [
    '033_cos_media_storage', '034_administrator_soft_delete',
    '035_role_management', '036_role_menu_button_permissions',
    '037_dictionary_types', '038_remove_administrator_role_assignment',
    '039_site_about_settings', '040_paper_withdraw_metadata',
    '041_training_withdraw_to_draft', '042_public_random_paper',
  ]);
  const lifecycle = migrations.find((migration) => migration.id === '026_question_lifecycle_slimming');
  assert.equal(lifecycle.steps[0].replacesCheck, '025_question_bank_without_scores/question_score_nullable');
  const deletion = migrations.find((migration) => migration.id === '029_question_soft_delete');
  assert.equal(deletion.steps[0].replacesCheck, '026_question_lifecycle_slimming/add_question_enabled');
  const cos = migrations.find((migration) => migration.id === '033_cos_media_storage');
  assert.equal(cos.steps[0].replacesCheck, '003_media/create_media_asset');
  const promotionCleanup = migrations.find((migration) => migration.id === '038_remove_administrator_role_assignment');
  assert.equal(
    promotionCleanup.steps.find((step) => step.id === 'remove_assignment_grants')?.replacesCheck,
    '036_role_menu_button_permissions/copy_legacy_management_grants',
  );
  assert.equal(
    promotionCleanup.steps.find((step) => step.id === 'remove_assignment_permission')?.replacesCheck,
    '036_role_menu_button_permissions/register_button_permissions',
  );
});
