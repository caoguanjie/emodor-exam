import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const ExcelJS = require('exceljs');

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
  const malformedStudentPage = await ctx.request(admin, 'GET', '/admin/students?page_size=not-a-number');
  assert.equal(malformedStudentPage.status, 400, `malformedStudentPage ${JSON.stringify(malformedStudentPage)}`);
  const unknownStudentFilter = await ctx.request(admin, 'GET', '/admin/students?role=employee');
  assert.equal(unknownStudentFilter.status, 400, `unknownStudentFilter ${JSON.stringify(unknownStudentFilter)}`);
  const forbiddenProfilePatch = await ctx.request(admin, 'PATCH', '/me/profile', { source: 'external' });
  assert.equal(forbiddenProfilePatch.status, 400, `forbiddenProfilePatch ${JSON.stringify(forbiddenProfilePatch)}`);
  const unknownProfilePatch = await ctx.request(admin, 'PATCH', '/me/profile', { username: 'must-not-be-accepted' });
  assert.equal(unknownProfilePatch.status, 400, `unknownProfilePatch ${JSON.stringify(unknownProfilePatch)}`);

  const importPasswords = [];
  const importUsername = `a2_import_${randomBytes(3).toString('hex')}`;
  const importPasswordA = password('Qx');
  const importPasswordB = password('Qx');
  const invalidImportPassword = password('Qx');
  const duplicateImportPassword = password('Qx');
  const invalidImportUsername = `a2_invalid_${randomBytes(3).toString('hex')}`;
  importPasswords.push(importPasswordA, importPasswordB, invalidImportPassword, duplicateImportPassword);
  const importRowA = { row: 2, username: importUsername, real_name: '导入学员甲', source: 'institution', category_id: categoryId, employee_no: 'A2-IMPORT-1', password: importPasswordA };
  const importRowB = { row: 4, username: `a2_import_${randomBytes(3).toString('hex')}`, real_name: '导入学员乙', source: 'external', category_id: externalCategoryId, password: importPasswordB };

  const importPreview = await ctx.request(admin, 'POST', '/admin/students/import-preview', {
    rows: [
      importRowA,
      { row: 3, username: invalidImportUsername, real_name: '导入失败', source: 'invalid', category_id: categoryId, password: invalidImportPassword },
      importRowB,
      { row: 5, username: invalidImportUsername.toUpperCase(), real_name: '大小写重复', source: 'institution', category_id: categoryId, password: duplicateImportPassword },
    ],
  });
  assert.equal(importPreview.status, 200);
  assert.deepEqual(importPreview.data.valid_rows, [2, 4]);
  assert.equal(importPreview.data.errors[0].row, 3);
  assert.ok(importPreview.data.duplicates.includes(5));
  assert.ok(!JSON.stringify(importPreview.data).includes('password_hash'));
  for (const actualPassword of importPasswords) assert.equal(JSON.stringify(importPreview).includes(actualPassword), false);

  const malformedImportBody = await ctx.request(admin, 'POST', '/admin/students/import-preview', {
    rows: [], unexpected: true,
  });
  assert.equal(malformedImportBody.status, 400, `malformedImportBody ${JSON.stringify(malformedImportBody)}`);

  const first = await ctx.request(admin, 'POST', `/admin/students/import-batches/${importPreview.data.batch_id}/commit`, { row_numbers: [2, 4] });
  assert.equal(first.status, 200);
  const retry = await ctx.request(admin, 'POST', `/admin/students/import-batches/${importPreview.data.batch_id}/commit`, { row_numbers: [2, 4] });
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.data.created_ids, first.data.created_ids);
  const changedRows = await ctx.request(admin, 'POST', `/admin/students/import-batches/${importPreview.data.batch_id}/commit`, { row_numbers: [2] });
  assert.equal(changedRows.status, 409);
  const storedBatch = await ctx.queryTestDb('SELECT normalized_rows, errors FROM import_batch WHERE id = ?', [importPreview.data.batch_id]);
  assert.equal(JSON.stringify(storedBatch).includes('password_hash'), true);
  for (const actualPassword of importPasswords) assert.equal(JSON.stringify(storedBatch).includes(actualPassword), false);
  for (const actualPassword of importPasswords) {
    assert.equal(JSON.stringify(first).includes(actualPassword), false);
    assert.equal(JSON.stringify(retry).includes(actualPassword), false);
  }
  const auditPath = `${ctx.env.LOG_DIR}/audit/audit-${new Date().toISOString().slice(0, 10)}.log`;
  const auditText = await readFile(auditPath, 'utf8');
  for (const actualPassword of importPasswords) assert.equal(auditText.includes(actualPassword), false);

  const owner2Password = password('Qx');
  const owner2Username = `a2_owner_${randomBytes(3).toString('hex')}`;
  const owner2Created = await ctx.request(admin, 'POST', '/users', {
    username: owner2Username, password: owner2Password, real_name: '第二管理员', role: 'super_admin',
  });
  assert.equal(owner2Created.status, 200);
  const owner2Login = await login(ctx, owner2Username, owner2Password);
  const owner2ReadyPassword = password('Qx');
  const owner2Changed = await ctx.request(owner2Login.actor, 'PUT', '/auth/password', {
    old_password: owner2Password, new_password: owner2ReadyPassword,
  });
  assert.equal(owner2Changed.status, 200);
  const owner2 = { accessToken: owner2Changed.data.access_token, cookie: owner2Login.actor.cookie };
  const owner2Status = await ctx.request(owner2, 'GET', `/admin/students/import-batches/${importPreview.data.batch_id}`);
  assert.equal(owner2Status.status, 404, `owner2Status ${JSON.stringify(owner2Status)}`);
  const owner2Commit = await ctx.request(owner2, 'POST', `/admin/students/import-batches/${importPreview.data.batch_id}/commit`, { row_numbers: [2, 4] });
  assert.equal(owner2Commit.status, 404, `owner2Commit ${JSON.stringify(owner2Commit)}`);

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

  const staleDisabled = await ctx.request(admin, 'POST', '/admin/training-categories', { name: `${categoryName} stale-disabled` });
  assert.equal(staleDisabled.status, 200);
  const staleDisabledPassword = password('Qx');
  const staleDisabledPreview = await ctx.request(admin, 'POST', '/admin/students/import-preview', {
    rows: [{ row: 2, username: `a2_stale_disabled_${randomBytes(3).toString('hex')}`, real_name: '陈旧停用批次', source: 'institution', category_id: String(staleDisabled.data.id), password: staleDisabledPassword }],
  });
  assert.equal(staleDisabledPreview.status, 200);
  await ctx.request(admin, 'PUT', `/admin/training-categories/${staleDisabled.data.id}/status`, { status: 0 });
  const staleDisabledCommit = await ctx.request(admin, 'POST', `/admin/students/import-batches/${staleDisabledPreview.data.batch_id}/commit`, { row_numbers: [2] });
  assert.equal(staleDisabledCommit.status, 409);
  const staleDisabledUsers = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM sys_user WHERE username LIKE ?', ['a2_stale_disabled_%']);
  assert.equal(Number(staleDisabledUsers[0].count), 0);

  const staleDeleted = await ctx.request(admin, 'POST', '/admin/training-categories', { name: `${categoryName} stale-deleted` });
  assert.equal(staleDeleted.status, 200);
  const staleDeletedPassword = password('Qx');
  const staleDeletedUsername = `a2_stale_deleted_${randomBytes(3).toString('hex')}`;
  const staleDeletedPreview = await ctx.request(admin, 'POST', '/admin/students/import-preview', {
    rows: [{ row: 2, username: staleDeletedUsername, real_name: '陈旧删除批次', source: 'institution', category_id: String(staleDeleted.data.id), password: staleDeletedPassword }],
  });
  assert.equal(staleDeletedPreview.status, 200);
  const staleDeletedRemove = await ctx.request(admin, 'DELETE', `/admin/training-categories/${staleDeleted.data.id}`);
  assert.equal(staleDeletedRemove.status, 200);
  const staleDeletedCommit = await ctx.request(admin, 'POST', `/admin/students/import-batches/${staleDeletedPreview.data.batch_id}/commit`, { row_numbers: [2] });
  assert.equal(staleDeletedCommit.status, 409);
  const staleDeletedUsers = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM sys_user WHERE username = ?', [staleDeletedUsername]);
  assert.equal(Number(staleDeletedUsers[0].count), 0);

  const raceCategory = await ctx.request(admin, 'POST', '/admin/training-categories', { name: `${categoryName} race` });
  assert.equal(raceCategory.status, 200);
  const racePassword = password('Qx');
  const raceUsername = `a2_race_${randomBytes(3).toString('hex')}`;
  const [raceStudent, raceDelete] = await Promise.all([
    ctx.request(admin, 'POST', '/admin/students', { username: raceUsername, password: racePassword, real_name: '并发学员', source: 'institution', category_id: String(raceCategory.data.id) }),
    ctx.request(admin, 'DELETE', `/admin/training-categories/${raceCategory.data.id}`),
  ]);
  assert.ok((raceStudent.status === 200 && raceDelete.status === 409) || (raceStudent.status === 409 && raceDelete.status === 200), `${raceStudent.status}/${raceDelete.status}`);

  const template = await ctx.request(admin, 'GET', '/admin/students/import-template');
  assert.equal(template.status, 200);
  assert.equal(template.body[0], 0x50);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template.body);
  const worksheet = workbook.worksheets[0];
  const xlsxPassword = password('Qx');
  const xlsxDuplicatePassword = password('Qx');
  const xlsxUniquePassword = password('Qx');
  const xlsxUsername = `a2_xlsx_${randomBytes(3).toString('hex')}`;
  const xlsxUniqueUsername = `a2_xlsx_unique_${randomBytes(3).toString('hex')}`;
  importPasswords.push(xlsxPassword, xlsxDuplicatePassword, xlsxUniquePassword);
  worksheet.addRow([xlsxUsername, 'XLSX 学员', 'A2-XLSX-1', '', '', 'institution', categoryId, xlsxPassword]);
  worksheet.addRow([xlsxUsername.toUpperCase(), 'XLSX 重复', 'A2-XLSX-2', '', '', 'institution', categoryId, xlsxDuplicatePassword]);
  worksheet.addRow([xlsxUniqueUsername, 'XLSX 唯一', 'A2-XLSX-3', '', '', 'institution', categoryId, xlsxUniquePassword]);
  const xlsxPreview = await ctx.upload(admin, '/admin/students/import-preview', Buffer.from(await workbook.xlsx.writeBuffer()), 'students.xlsx');
  assert.equal(xlsxPreview.status, 200);
  assert.deepEqual(xlsxPreview.data.valid_rows, [4]);
  assert.deepEqual(xlsxPreview.data.duplicates, [2, 3]);
  for (const actualPassword of [xlsxPassword, xlsxDuplicatePassword, xlsxUniquePassword]) {
    assert.equal(JSON.stringify(xlsxPreview).includes(actualPassword), false);
  }
  const xlsxCommit = await ctx.request(admin, 'POST', `/admin/students/import-batches/${xlsxPreview.data.batch_id}/commit`, { row_numbers: [4] });
  assert.equal(xlsxCommit.status, 200);
  const xlsxStored = await ctx.queryTestDb('SELECT username, password_hash FROM sys_user WHERE username = ?', [xlsxUniqueUsername]);
  assert.equal(xlsxStored.length, 1);
  assert.notEqual(xlsxStored[0].password_hash, xlsxPassword);
  const xlsxBatch = await ctx.queryTestDb('SELECT normalized_rows, errors FROM import_batch WHERE id = ?', [xlsxPreview.data.batch_id]);
  for (const actualPassword of [xlsxPassword, xlsxDuplicatePassword, xlsxUniquePassword]) {
    assert.equal(JSON.stringify(xlsxBatch).includes(actualPassword), false);
  }
  const finalAuditText = await readFile(auditPath, 'utf8');
  for (const actualPassword of importPasswords) assert.equal(finalAuditText.includes(actualPassword), false);
}
