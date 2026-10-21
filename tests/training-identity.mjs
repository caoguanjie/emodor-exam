import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

function password(prefix = 'P') {
  return `${prefix}9${randomBytes(10).toString('hex')}`;
}

async function login(ctx, username, initialPassword) {
  const actor = {};
  const result = await ctx.request(actor, 'POST', '/auth/login', { username, password: initialPassword });
  assert.equal(result.status, 200, `${username} login: ${JSON.stringify(result.json || result.data || result.body)}`);
  return { actor: { accessToken: result.data.access_token, cookie: actor.cookie }, data: result.data };
}

export async function run(ctx) {
  const initialAdmin = await login(ctx, 'admin', ctx.adminPassword);
  const adminPassword = password('Qx');
  const changed = await ctx.request(initialAdmin.actor, 'PUT', '/auth/password', {
    old_password: ctx.adminPassword,
    new_password: adminPassword,
  });
  assert.equal(changed.status, 200, `admin change password: ${JSON.stringify(changed)}`);
  const admin = { accessToken: changed.data.access_token, cookie: initialAdmin.actor.cookie };

  const categoryName = `A2 类别 ${randomBytes(4).toString('hex')}`;
  const category = await ctx.request(admin, 'POST', '/admin/training-categories', { name: categoryName, description: 'identity test' });
  assert.equal(category.status, 200, `category create: ${JSON.stringify(category)}`);
  const categoryId = String(category.data.id);
  const duplicateCategory = await ctx.request(admin, 'POST', '/admin/training-categories', { name: categoryName });
  assert.equal(duplicateCategory.status, 400);

  const externalCategory = await ctx.request(admin, 'POST', '/admin/training-categories', { name: `${categoryName} external` });
  assert.equal(externalCategory.status, 200);
  const externalCategoryId = String(externalCategory.data.id);

  const institutionPassword = password('Qx');
  const externalPassword = password('Qx');
  const institution = await ctx.request(admin, 'POST', '/admin/students', {
    username: `a2_inst_${randomBytes(3).toString('hex')}`,
    password: institutionPassword,
    real_name: '本机构学员',
    source: 'institution',
    category_id: categoryId,
  });
  assert.equal(institution.status, 200);
  const external = await ctx.request(admin, 'POST', '/admin/students', {
    username: `a2_ext_${randomBytes(3).toString('hex')}`,
    password: externalPassword,
    real_name: '外来学员',
    source: 'external',
    category_id: externalCategoryId,
  });
  assert.equal(external.status, 200);

  const legacy = await ctx.request(admin, 'POST', '/users', {
    username: `a2_legacy_${randomBytes(3).toString('hex')}`,
    password: password('Qx'),
    real_name: '旧用户',
    role: 'employee',
  });
  assert.equal(legacy.status, 200);
  const legacyProfile = await ctx.request(admin, 'GET', `/users/${legacy.data.id}`);
  assert.equal(legacyProfile.status, 200);
  assert.equal(legacyProfile.data.category_id, undefined);
  const trainingProfile = await ctx.request(admin, 'GET', `/me/profile`);
  assert.equal(trainingProfile.status, 200);
  assert.equal(trainingProfile.data.source, null);

  const onlyInstitution = await ctx.request(admin, 'GET', `/admin/students?source=institution&category_id=${categoryId}`);
  assert.equal(onlyInstitution.status, 200);
  assert.ok(onlyInstitution.data.items.some((item) => item.source === 'institution'));
  const forbiddenProfilePatch = await ctx.request(admin, 'PATCH', '/me/profile', { source: 'external' });
  assert.equal(forbiddenProfilePatch.status, 400);

  const importPreview = await ctx.request(admin, 'POST', '/admin/students/import-preview', {
    rows: [
      { row: 2, username: `a2_import_${randomBytes(3).toString('hex')}`, real_name: '导入学员甲', source: 'institution', category_id: categoryId, password: password('Qx') },
      { row: 3, username: `a2_invalid_${randomBytes(3).toString('hex')}`, real_name: '导入失败', source: 'invalid', category_id: categoryId, password: password('Qx') },
      { row: 4, username: `a2_import_${randomBytes(3).toString('hex')}`, real_name: '导入学员乙', source: 'external', category_id: externalCategoryId, password: password('Qx') },
    ],
  });
  assert.equal(importPreview.status, 200);
  assert.deepEqual(importPreview.data.valid_rows, [2, 4]);
  assert.equal(importPreview.data.errors[0].row, 3);
  assert.ok(!JSON.stringify(importPreview.data).includes('password_hash'));

  const first = await ctx.request(admin, 'POST', `/admin/students/import-batches/${importPreview.data.batch_id}/commit`, { row_numbers: [2, 4] });
  assert.equal(first.status, 200);
  const retry = await ctx.request(admin, 'POST', `/admin/students/import-batches/${importPreview.data.batch_id}/commit`, { row_numbers: [2, 4] });
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.data.created_ids, first.data.created_ids);
  const changedRows = await ctx.request(admin, 'POST', `/admin/students/import-batches/${importPreview.data.batch_id}/commit`, { row_numbers: [2] });
  assert.equal(changedRows.status, 409);
  const storedBatch = await ctx.queryTestDb('SELECT normalized_rows, errors FROM import_batch WHERE id = ?', [importPreview.data.batch_id]);
  assert.equal(JSON.stringify(storedBatch).includes('password'), true);
  assert.equal(JSON.stringify(storedBatch).includes('password_hash'), true);
  assert.equal(JSON.stringify(storedBatch).includes(institutionPassword), false);

  const disabledLogin = await login(ctx, institution.data.username, institutionPassword);
  const disabled = await ctx.request(admin, 'PUT', `/admin/students/${institution.data.id}/status`, { status: 0 });
  assert.equal(disabled.status, 200);
  const revoked = await ctx.request(disabledLogin.actor, 'GET', '/auth/profile');
  assert.equal(revoked.status, 401);

  const referencedDelete = await ctx.request(admin, 'DELETE', `/admin/training-categories/${categoryId}`);
  assert.equal(referencedDelete.status, 409);
  const inactive = await ctx.request(admin, 'POST', '/admin/training-categories', { name: `${categoryName} inactive` });
  assert.equal(inactive.status, 200);
  await ctx.request(admin, 'PUT', `/admin/training-categories/${inactive.data.id}/status`, { status: 0 });
  const inactiveStudent = await ctx.request(admin, 'POST', '/admin/students', {
    username: `a2_inactive_${randomBytes(3).toString('hex')}`,
    password: password('Qx'),
    real_name: '停用类别学员', source: 'institution', category_id: String(inactive.data.id),
  });
  assert.equal(inactiveStudent.status, 409);
}
