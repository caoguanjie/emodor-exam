import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './training-access.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');
const ExcelJS = require('exceljs');

const HEADERS = ['category', 'type', 'difficulty', 'concept', 'stem', 'options', 'answer', 'analysis', 'rubric', 'score'];

async function captchaAnswer(ctx, captchaId) {
  const redis = new Redis({
    host: ctx.env.REDIS_HOST,
    port: Number(ctx.env.REDIS_PORT),
    password: ctx.env.REDIS_PASSWORD || undefined,
  });
  try { return await redis.get(`${ctx.env.REDIS_KEY_PREFIX}auth:captcha:${captchaId}`); }
  finally { await redis.quit(); }
}

let loginSequence = 211;
async function accountLogin(ctx, username, password, ...personalValues) {
  loginSequence = loginSequence >= 240 ? 211 : loginSequence + 1;
  const headers = { 'X-Forwarded-For': `198.51.100.${loginSequence}` };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert.equal(captcha.status, 200);
  const actor = {};
  const login = await ctx.request(actor, 'POST', '/auth/login', {
    username,
    password,
    captcha_id: captcha.data.captcha_id,
    captcha_code: await captchaAnswer(ctx, captcha.data.captcha_id),
  }, headers);
  assert.equal(login.status, 200, `${username} login: ${JSON.stringify(login)}`);
  actor.accessToken = login.data.access_token;
  if (!login.data.force_change_password) return { actor, id: String(login.data.user.id) };
  const nextPassword = randomStrongPassword(username, ...personalValues);
  const currentPassword = username === 'admin' ? ctx.adminPassword : password;
  const changed = await ctx.request(actor, 'PUT', '/auth/password', { old_password: currentPassword, new_password: nextPassword });
  assert.equal(changed.status, 200);
  actor.accessToken = changed.data.access_token;
  return { actor, id: String(login.data.user.id) };
}

function multipart(fields, bytes, filename, contentType) {
  const boundary = `----ruleexam-b4-${randomBytes(12).toString('hex')}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  parts.push(bytes);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

function baseRows() {
  const single = {
    category: '', type: 'single', difficulty: 'easy', concept: '受限空间',
    stem: '<p>B4：进入受限空间前首先应做什么？</p>',
    options: JSON.stringify([{ key: 'A', text: '先通风检测' }, { key: 'B', text: '直接进入' }]),
    answer: JSON.stringify([0]), analysis: '<p>应先通风并检测。</p>', rubric: '', score: '5',
  };
  return [
    single,
    { ...single, type: 'essay', stem: '<p>B4：未知题型。</p>' },
    { ...single },
    {
      category: '', type: 'image', difficulty: 'hard', concept: '',
      stem: '<p>B4：上传现场照片并指出隐患。</p>', options: '[]', answer: '[]', analysis: '',
      rubric: '<p>识别隐患完整，位置准确。</p>', score: '10',
    },
  ];
}

function txtBytes(rows) {
  const lines = [HEADERS.join('\t'), ...rows.map((row) => HEADERS.map((header) => row[header] ?? '').join('\t'))];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

async function xlsxBytes(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('题库导入');
  sheet.addRow(HEADERS);
  for (const row of rows) sheet.addRow(HEADERS.map((header) => row[header] ?? ''));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function previewFile(ctx, actor, format, bytes, categoryId, difficulty = '') {
  const request = multipart(
    { format, category_id: categoryId, ...(difficulty ? { difficulty } : {}) },
    bytes,
    `questions.${format}`,
    format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/plain; charset=utf-8',
  );
  return ctx.request(actor, 'POST', '/admin/questions/import-preview', request.body, request.headers);
}

async function templateRows(buffer, format) {
  if (format === 'txt') {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trimEnd();
    return text.split(/\r\n|\n|\r/).slice(1).map((line) => line.split('\t'));
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rows = [];
  workbook.worksheets[0].eachRow((row, number) => {
    if (number > 1) rows.push(HEADERS.map((_header, index) => String(row.getCell(index + 1).value ?? '').trim()));
  });
  return rows;
}

async function runBody(ctx) {
  const admin = await accountLogin(ctx, 'admin', ctx.adminPassword, 'B4题库管理员');
  const suffix = randomBytes(4).toString('hex');
  const category = await ctx.request(admin.actor, 'POST', '/admin/training-categories', { name: `B4 类别 ${suffix}` });
  assert.equal(category.status, 200, JSON.stringify(category));
  const categoryId = String(category.data.id);
  const concept = await ctx.request(admin.actor, 'POST', '/ai/question-concepts', {
    category_id: categoryId,
    type: 'single',
    name: '受限空间',
  });
  assert.equal(concept.status, 200, JSON.stringify(concept));

  const txtTemplate = await ctx.request(admin.actor, 'GET', '/admin/questions/import-template?format=txt');
  const xlsxTemplate = await ctx.request(admin.actor, 'GET', '/admin/questions/import-template?format=xlsx');
  assert.equal(txtTemplate.status, 200);
  assert.equal(xlsxTemplate.status, 200);
  assert.match(txtTemplate.headers['content-type'], /text\/tab-separated-values/);
  assert.match(xlsxTemplate.headers['content-type'], /spreadsheetml\.sheet/);
  assert.deepEqual(await templateRows(xlsxTemplate.data, 'xlsx'), await templateRows(txtTemplate.data, 'txt'));

  const rows = baseRows();
  const txtPreview = await previewFile(ctx, admin.actor, 'txt', txtBytes(rows), categoryId, 'hard');
  const xlsxPreview = await previewFile(ctx, admin.actor, 'xlsx', await xlsxBytes(rows), categoryId, 'hard');
  for (const preview of [txtPreview, xlsxPreview]) {
    assert.equal(preview.status, 200, JSON.stringify(preview));
    assert.deepEqual(preview.data.valid_rows, [2, 5]);
    assert.equal(preview.data.errors.some((item) => item.row === 3), true);
    assert.deepEqual(preview.data.duplicates, [4]);
  }

  const committed = await ctx.request(admin.actor, 'POST', `/admin/questions/import-batches/${txtPreview.data.batch_id}/commit`, {
    row_numbers: txtPreview.data.valid_rows,
  });
  assert.equal(committed.status, 200, JSON.stringify(committed));
  assert.equal(committed.data.created_ids.length, 2);
  const retried = await ctx.request(admin.actor, 'POST', `/admin/questions/import-batches/${txtPreview.data.batch_id}/commit`, {
    row_numbers: txtPreview.data.valid_rows,
  });
  assert.equal(retried.status, 200, JSON.stringify(retried));
  assert.deepEqual(retried.data.created_ids, committed.data.created_ids);
  const changedRetry = await ctx.request(admin.actor, 'POST', `/admin/questions/import-batches/${txtPreview.data.batch_id}/commit`, { row_numbers: [2] });
  assert.equal(changedRetry.status, 409);
  assert.equal(changedRetry.code, 40911);
  const status = await ctx.request(admin.actor, 'GET', `/admin/questions/import-batches/${txtPreview.data.batch_id}`);
  assert.equal(status.status, 200);
  assert.deepEqual(status.data, committed.data);

  const otherUsername = `b4_admin_${suffix}`;
  const otherName = `B4管理员${suffix}`;
  const otherPassword = randomStrongPassword(otherUsername, otherName);
  const otherUser = await ctx.request(admin.actor, 'POST', '/users', {
    username: otherUsername,
    password: otherPassword,
    real_name: otherName,
    role: 'super_admin',
  });
  assert.equal(otherUser.status, 200, JSON.stringify(otherUser));
  const other = await accountLogin(ctx, otherUsername, otherPassword, otherName);
  const otherOwnerCommit = await ctx.request(other.actor, 'POST', `/admin/questions/import-batches/${txtPreview.data.batch_id}/commit`, {
    row_numbers: txtPreview.data.valid_rows,
  });
  assert.equal(otherOwnerCommit.status, 403);
  assert.equal(otherOwnerCommit.code, 40302);
  assert.equal(otherOwnerCommit.data, null);

  const studentPreview = await ctx.request(admin.actor, 'POST', '/admin/students/import-preview', {
    rows: [{
      row: 2,
      username: `b4_student_${suffix}`,
      real_name: `B4学员${suffix}`,
      source: 'institution',
      category_id: categoryId,
      password: randomStrongPassword(`b4_student_${suffix}`, `B4学员${suffix}`),
    }],
  });
  assert.equal(studentPreview.status, 200, JSON.stringify(studentPreview));
  const crossKind = await ctx.request(admin.actor, 'POST', `/admin/questions/import-batches/${studentPreview.data.batch_id}/commit`, { row_numbers: [2] });
  assert.equal(crossKind.status, 403);
  assert.equal(crossKind.code, 40302);

  const correctedRows = [
    {
      category: categoryId, type: 'multiple', difficulty: 'medium', concept: '',
      stem: '<p>B4：哪些属于作业前检查？</p>',
      options: JSON.stringify([{ key: 'A', text: '检查防护用品' }, { key: 'B', text: '确认许可' }, { key: 'C', text: '跳过交底' }]),
      answer: '[0,1]', analysis: '<p>前两项正确。</p>', rubric: '', score: '10',
    },
    {
      category: categoryId, type: 'judgment', difficulty: 'hard', concept: '',
      stem: '<p>B4：未交底可以直接作业。</p>',
      options: JSON.stringify([{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }]),
      answer: '[1]', analysis: '<p>必须先交底。</p>', rubric: '', score: '5',
    },
  ];
  const correctedPreview = await previewFile(ctx, admin.actor, 'txt', txtBytes(correctedRows), categoryId);
  assert.equal(correctedPreview.status, 200, JSON.stringify(correctedPreview));
  assert.deepEqual(correctedPreview.data.valid_rows, [2, 3]);
  const correctedCommit = await ctx.request(admin.actor, 'POST', `/admin/questions/import-batches/${correctedPreview.data.batch_id}/commit`, {
    row_numbers: correctedPreview.data.valid_rows,
  });
  assert.equal(correctedCommit.status, 200, JSON.stringify(correctedCommit));

  const allIds = [...committed.data.created_ids, ...correctedCommit.data.created_ids].map(String);
  const placeholders = allIds.map(() => '?').join(',');
  const stored = await ctx.queryTestDb(
    `SELECT q.id, q.type, q.difficulty, q.status, q.source, q.current_version_id, v.id AS saved_version_id, v.status AS version_status, v.approved_by, v.approved_at, v.reviewed_by, v.reviewed_at FROM question q JOIN question_version v ON v.id = q.current_version_id WHERE q.id IN (${placeholders}) ORDER BY q.id`,
    allIds,
  );
  assert.equal(stored.length, 4);
  assert.deepEqual(new Set(stored.map((row) => row.type)), new Set(['single', 'multiple', 'judgment', 'image']));
  assert.deepEqual(new Set(stored.map((row) => row.difficulty)), new Set(['easy', 'medium', 'hard']));
  for (const row of stored) {
    assert.equal(row.status, 'approved');
    assert.equal(row.version_status, 'approved');
    assert.equal(row.source, 'import');
    assert.equal(String(row.current_version_id), String(row.saved_version_id));
    assert.ok(row.approved_by && row.reviewed_by && row.approved_at && row.reviewed_at);
  }

  const duplicatePreview = await previewFile(ctx, admin.actor, 'txt', txtBytes(rows), categoryId, 'hard');
  assert.equal(duplicatePreview.status, 200, JSON.stringify(duplicatePreview));
  assert.deepEqual(duplicatePreview.data.valid_rows, []);
  assert.equal(duplicatePreview.data.errors.some((item) => item.row === 3), true);
  assert.deepEqual(duplicatePreview.data.duplicates, [2, 4, 5]);

  const listed = await ctx.request(admin.actor, 'GET', `/ai/questions?category_id=${categoryId}&status=approved&page=1&page_size=100`);
  assert.equal(listed.status, 200, JSON.stringify(listed));
  for (const id of allIds) assert.ok(listed.data.list.some((row) => String(row.question_id) === id));
}

export async function run(ctx) {
  ctx.reportOwnedRuntime?.({ stage: 'training-question-import-start', database: ctx.env.DB_DATABASE });
  await runBody(ctx);
  console.log('training-question-import: passed');
}
