import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './training-access.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');
const { DataSource } = require('typeorm');
const { MediaAsset } = require('./dist/entities/media-asset.entity.js');
const { MediaService } = require('./dist/modules/media/media.service.js');
const { QuestionVersionService } = require('./dist/modules/questions/question-version.service.js');

const HEADERS = ['category', 'type', 'difficulty', 'concept', 'stem', 'options', 'answer', 'analysis', 'score'];

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
  if (!login.data.force_change_password) return { actor, id: String(login.data.user.id), password };
  const nextPassword = randomStrongPassword(username, ...personalValues);
  const currentPassword = username === 'admin' ? ctx.adminPassword : password;
  const changed = await ctx.request(actor, 'PUT', '/auth/password', { old_password: currentPassword, new_password: nextPassword });
  assert.equal(changed.status, 200);
  actor.accessToken = changed.data.access_token;
  return { actor, id: String(login.data.user.id), password: nextPassword };
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
    answer: JSON.stringify([0]), analysis: '<p>应先通风并检测。</p>', score: '5',
  };
  return [
    single,
    { ...single, type: 'essay', stem: '<p>B4：未知题型。</p>' },
    { ...single },
    {
      category: '', type: 'judgment', difficulty: 'hard', concept: '',
      stem: '<p>B4：未检测不得进入受限空间。</p>',
      options: JSON.stringify([{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }]),
      answer: JSON.stringify([0]), analysis: '<p>应先完成通风检测。</p>', score: '10',
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

function pngFixture() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
}

function assertOwnedDatabaseEnvironment(ctx) {
  assert.match(String(ctx.env.DB_DATABASE || ''), /^ruleexam_test_[A-Za-z0-9_]+$/);
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE']) {
    assert.equal(typeof ctx.env[key], 'string', `${key} must come from the owned runtime`);
    assert.notEqual(ctx.env[key], '', `${key} must not fall back to a default`);
  }
  assert.ok(Number.isInteger(Number(ctx.env.DB_PORT)) && Number(ctx.env.DB_PORT) > 0, 'owned DB_PORT is invalid');
}

async function validateMediaWithSaturatedCallerPool(ctx, actorId, categoryId, mediaId) {
  assertOwnedDatabaseEnvironment(ctx);
  const dataSource = new DataSource({
    type: 'mysql',
    host: ctx.env.DB_HOST,
    port: Number(ctx.env.DB_PORT),
    username: ctx.env.DB_USERNAME,
    password: ctx.env.DB_PASSWORD,
    database: ctx.env.DB_DATABASE,
    charset: 'utf8mb4_0900_ai_ci',
    timezone: 'Z',
    entities: [MediaAsset],
    synchronize: false,
    logging: false,
    poolSize: 2,
    extra: { connectionLimit: 2 },
  });
  await dataSource.initialize();
  try {
    const media = new MediaService(
      dataSource.getRepository(MediaAsset),
      {},
      dataSource,
      {},
      {},
    );
    const versions = Object.create(QuestionVersionService.prototype);
    versions.media = media;
    const draft = {
      categoryId,
      difficulty: 'easy',
      type: 'single',
      stem: `<p>连接池校验<img data-media-id="${mediaId}"></p>`,
      options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }],
      answer: [0],
      analysis: null,
      scoreCents: 500,
      source: 'import',
    };
    let entered = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const validate = () => dataSource.transaction(async (manager) => {
      entered += 1;
      if (entered === 2) release();
      await gate;
      return versions.validateImportDraft(draft, actorId, manager);
    });
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('caller-manager media validation exhausted the pool')), 5_000);
    });
    let results;
    try {
      results = await Promise.race([Promise.all([validate(), validate()]), timeout]);
    } finally {
      clearTimeout(timer);
    }
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((item) => item.mediaAssetIds), [[mediaId], [mediaId]]);
  } finally {
    await dataSource.destroy();
  }
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

  const mediaUpload = multipart(
    { purpose: 'question' },
    pngFixture(),
    'b4-question.png',
    'image/png',
  );
  const uploadedMedia = await ctx.request(admin.actor, 'POST', '/media/upload', mediaUpload.body, mediaUpload.headers);
  assert.equal(uploadedMedia.status, 200, JSON.stringify(uploadedMedia));
  assert.equal(uploadedMedia.data.status, 'ready');
  const mediaId = String(uploadedMedia.data.asset_id);
  await validateMediaWithSaturatedCallerPool(ctx, admin.id, categoryId, mediaId);

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

  const stalePreviewCommit = await ctx.request(
    admin.actor,
    'POST',
    `/admin/questions/import-batches/${xlsxPreview.data.batch_id}/commit`,
    { row_numbers: xlsxPreview.data.valid_rows },
  );
  assert.equal(stalePreviewCommit.status, 409, JSON.stringify(stalePreviewCommit));
  assert.equal(stalePreviewCommit.code, 40911);
  assert.match(stalePreviewCommit.json?.message, /重新预检查/, JSON.stringify(stalePreviewCommit));
  const stalePreviewStatus = await ctx.request(admin.actor, 'GET', `/admin/questions/import-batches/${xlsxPreview.data.batch_id}`);
  assert.equal(stalePreviewStatus.status, 200);
  assert.deepEqual(stalePreviewStatus.data.valid_rows, xlsxPreview.data.valid_rows);
  assert.equal(Object.hasOwn(stalePreviewStatus.data, 'created_ids'), false);

  const concurrentStem = `<p>B4：并发重复 ${suffix}</p>`;
  const concurrentRows = [{ ...baseRows()[0], concept: '', stem: concurrentStem }];
  const concurrentPreviewA = await previewFile(ctx, admin.actor, 'txt', txtBytes(concurrentRows), categoryId);
  const concurrentPreviewB = await previewFile(ctx, admin.actor, 'xlsx', await xlsxBytes(concurrentRows), categoryId);
  assert.deepEqual(concurrentPreviewA.data.valid_rows, [2]);
  assert.deepEqual(concurrentPreviewB.data.valid_rows, [2]);
  const concurrentCommits = await Promise.all([
    ctx.request(admin.actor, 'POST', `/admin/questions/import-batches/${concurrentPreviewA.data.batch_id}/commit`, { row_numbers: [2] }),
    ctx.request(admin.actor, 'POST', `/admin/questions/import-batches/${concurrentPreviewB.data.batch_id}/commit`, { row_numbers: [2] }),
  ]);
  assert.deepEqual(concurrentCommits.map((response) => response.status).sort((a, b) => a - b), [200, 409]);
  const concurrentConflict = concurrentCommits.find((response) => response.status === 409);
  assert.equal(concurrentConflict.code, 40911);
  assert.match(concurrentConflict.json?.message, /重新预检查/, JSON.stringify(concurrentConflict));
  const concurrentStored = await ctx.queryTestDb('SELECT id FROM question WHERE stem = ?', [concurrentStem]);
  assert.equal(concurrentStored.length, 1, 'concurrent previews created more than one question');

  const otherUsername = `b4_admin_${suffix}`;
  const otherName = `B4管理员${suffix}`;
  const otherPassword = randomStrongPassword(otherUsername, otherName);
  const otherRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `b4_other_${suffix}`,
    name: `B4 其他导入员 ${suffix}`,
    permissions: ['questions:write'],
  });
  assert.equal(otherRole.status, 200, JSON.stringify(otherRole));
  const otherUser = await ctx.request(admin.actor, 'POST', '/admin/administrators', {
    username: otherUsername, password: otherPassword, real_name: otherName,
    role_ids: [String(otherRole.data.id)],
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

  const scopedUsername = `b4_scoped_${suffix}`;
  const scopedName = `B4窄权限${suffix}`;
  const scopedPassword = randomStrongPassword(scopedUsername, scopedName);
  const scopedRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `b4_import_${suffix}`,
    name: `B4 导入权限 ${suffix}`,
    permissions: ['questions:write', 'students:write'],
  });
  assert.equal(scopedRole.status, 200, JSON.stringify(scopedRole));
  const scopedUser = await ctx.request(admin.actor, 'POST', '/admin/administrators', {
    username: scopedUsername, password: scopedPassword, real_name: scopedName,
    role_ids: [String(scopedRole.data.id)],
  });
  assert.equal(scopedUser.status, 200, JSON.stringify(scopedUser));
  const scoped = await accountLogin(ctx, scopedUsername, scopedPassword, scopedName);
  const deniedStem = `<p>B4：撤权后不得导入 ${suffix}</p>`;
  const deniedRows = [{ ...baseRows()[0], concept: '', stem: deniedStem }];
  const scopedQuestionPreview = await previewFile(ctx, scoped.actor, 'txt', txtBytes(deniedRows), categoryId);
  assert.equal(scopedQuestionPreview.status, 200, JSON.stringify(scopedQuestionPreview));
  assert.deepEqual(scopedQuestionPreview.data.valid_rows, [2]);

  const revokedQuestions = await ctx.request(admin.actor, 'PUT', `/admin/roles/${scopedRole.data.id}`, {
    permissions: ['students:write'],
  });
  assert.equal(revokedQuestions.status, 200, JSON.stringify(revokedQuestions));
  const studentsOnly = await accountLogin(ctx, scopedUsername, scoped.password, scopedName);
  const deniedBefore = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM question WHERE stem = ?', [deniedStem]);
  assert.equal(Number(deniedBefore[0]?.count || 0), 0);
  const deniedQuestionEntry = await ctx.request(
    studentsOnly.actor,
    'POST',
    `/admin/questions/import-batches/${scopedQuestionPreview.data.batch_id}/commit`,
    { row_numbers: [2] },
  );
  assert.equal(deniedQuestionEntry.status, 403, JSON.stringify(deniedQuestionEntry));
  const deniedStudentEntry = await ctx.request(
    studentsOnly.actor,
    'POST',
    `/admin/students/import-batches/${scopedQuestionPreview.data.batch_id}/commit`,
    { row_numbers: [2] },
  );
  assert.equal(deniedStudentEntry.status, 404, JSON.stringify(deniedStudentEntry));
  assert.equal(deniedStudentEntry.code, 40401);
  const deniedAfter = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM question WHERE stem = ?', [deniedStem]);
  assert.equal(Number(deniedAfter[0]?.count || 0), 0, 'revoked writer created a question through an import entry');

  const normalStudentUsername = `b4_students_only_${suffix}`;
  const normalStudentPreview = await ctx.request(studentsOnly.actor, 'POST', '/admin/students/import-preview', {
    rows: [{
      row: 2,
      username: normalStudentUsername,
      real_name: `B4学员入口${suffix}`,
      source: 'institution',
      category_id: categoryId,
      password: randomStrongPassword(normalStudentUsername, `B4学员入口${suffix}`),
    }],
  });
  assert.equal(normalStudentPreview.status, 200, JSON.stringify(normalStudentPreview));
  const normalStudentCommit = await ctx.request(
    studentsOnly.actor,
    'POST',
    `/admin/students/import-batches/${normalStudentPreview.data.batch_id}/commit`,
    { row_numbers: normalStudentPreview.data.valid_rows },
  );
  assert.equal(normalStudentCommit.status, 200, JSON.stringify(normalStudentCommit));
  assert.equal(normalStudentCommit.data.created_ids.length, 1);

  assertOwnedDatabaseEnvironment(ctx);
  const rollbackToken = randomBytes(6).toString('hex');
  const rollbackMarker = `B4_ROLLBACK_FAIL_${rollbackToken}`;
  const rollbackTrigger = `b4_qv_fail_${rollbackToken}`;
  const rollbackFirstStem = `<p>B4：事务首行 ${rollbackToken}<img data-media-id="${mediaId}"></p>`;
  const rollbackSecondStem = `<p>${rollbackMarker}</p>`;
  assert.equal(rollbackFirstStem.includes(rollbackMarker), false);
  assert.equal(rollbackSecondStem.includes(rollbackMarker), true);
  const rollbackRows = [
    { ...baseRows()[0], concept: '', stem: rollbackFirstStem },
    { ...baseRows()[0], concept: '', stem: rollbackSecondStem },
  ];
  const rollbackPreview = await previewFile(ctx, admin.actor, 'txt', txtBytes(rollbackRows), categoryId);
  assert.equal(rollbackPreview.status, 200, JSON.stringify(rollbackPreview));
  assert.deepEqual(rollbackPreview.data.valid_rows, [2, 3]);
  const importState = async () => Promise.all([
    ctx.queryTestDb('SELECT id, current_version_id, source, stem, options, answer, analysis FROM question ORDER BY id'),
    ctx.queryTestDb('SELECT id, question_id, source, regulation_id, regulation_version_id FROM question_version ORDER BY id'),
    ctx.queryTestDb('SELECT id, asset_id, owner_type, owner_id FROM media_reference ORDER BY id'),
    ctx.queryTestDb('SELECT status, normalized_rows, valid_rows, committed_rows, created_ids FROM import_batch WHERE id = ?', [rollbackPreview.data.batch_id]),
  ]);
  const beforeFailedImport = await importState();
  let rollbackCommit;
  let triggerCreated = false;
  let triggerConnection;
  try {
    triggerConnection = await mysql.createConnection({
      host: ctx.env.DB_HOST,
      port: Number(ctx.env.DB_PORT),
      user: ctx.env.DB_USERNAME,
      password: ctx.env.DB_PASSWORD,
      database: ctx.env.DB_DATABASE,
    });
    await triggerConnection.query(
      `CREATE TRIGGER \`${rollbackTrigger}\` BEFORE INSERT ON question_version FOR EACH ROW BEGIN IF INSTR(NEW.stem, '${rollbackMarker}') > 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'b4_owned_rollback'; END IF; END`,
    );
    triggerCreated = true;
    rollbackCommit = await ctx.request(
      admin.actor,
      'POST',
      `/admin/questions/import-batches/${rollbackPreview.data.batch_id}/commit`,
      { row_numbers: rollbackPreview.data.valid_rows },
    );
  } finally {
    try {
      if (triggerCreated) await triggerConnection.query(`DROP TRIGGER IF EXISTS \`${rollbackTrigger}\``);
    } finally {
      if (triggerConnection) await triggerConnection.end();
    }
  }
  assert.equal(rollbackCommit.status, 500, JSON.stringify(rollbackCommit));
  assert.equal(rollbackCommit.code, 50001);
  const rollbackBatch = await ctx.request(admin.actor, 'GET', `/admin/questions/import-batches/${rollbackPreview.data.batch_id}`);
  assert.equal(rollbackBatch.status, 200);
  assert.deepEqual(rollbackBatch.data.valid_rows, [2, 3]);
  assert.equal(Object.hasOwn(rollbackBatch.data, 'created_ids'), false);
  const rollbackQuestions = await ctx.queryTestDb(
    'SELECT id FROM question WHERE stem IN (?, ?)',
    [rollbackFirstStem, rollbackSecondStem],
  );
  assert.equal(rollbackQuestions.length, 0, 'failed batch left question identities');
  const rollbackVersions = await ctx.queryTestDb(
    'SELECT id FROM question_version WHERE stem IN (?, ?)',
    [rollbackFirstStem, rollbackSecondStem],
  );
  assert.equal(rollbackVersions.length, 0, 'failed batch left question versions');
  const rollbackMediaRefs = await ctx.queryTestDb(
    "SELECT id FROM media_reference WHERE asset_id = ? AND owner_type = 'question_version'",
    [mediaId],
  );
  assert.equal(rollbackMediaRefs.length, 0, 'failed batch left media references');
  assert.deepEqual(await importState(), beforeFailedImport, 'failed import must roll back every new write and preserve all pre-existing rows');

  const rollbackRetry = await ctx.request(
    admin.actor, 'POST', `/admin/questions/import-batches/${rollbackPreview.data.batch_id}/commit`,
    { row_numbers: rollbackPreview.data.valid_rows },
  );
  assert.equal(rollbackRetry.status, 200, JSON.stringify(rollbackRetry));
  assert.equal(rollbackRetry.data.created_ids.length, 2);
  const rollbackRetryAgain = await ctx.request(
    admin.actor, 'POST', `/admin/questions/import-batches/${rollbackPreview.data.batch_id}/commit`,
    { row_numbers: rollbackPreview.data.valid_rows },
  );
  assert.equal(rollbackRetryAgain.status, 200, JSON.stringify(rollbackRetryAgain));
  assert.deepEqual(rollbackRetryAgain.data, rollbackRetry.data, 'retrying a recovered batch must return its first committed result');
  const recoveredImport = await ctx.queryTestDb(
    'SELECT q.id, v.id AS version_id FROM question q JOIN question_version v ON v.question_id = q.id WHERE q.stem IN (?, ?)',
    [rollbackFirstStem, rollbackSecondStem],
  );
  assert.equal(recoveredImport.length, 2, 'recovered batch must create exactly one version per question');

  const correctedRows = [
    {
      category: categoryId, type: 'multiple', difficulty: 'medium', concept: '',
      stem: '<p>B4：哪些属于作业前检查？</p>',
      options: JSON.stringify([{ key: 'A', text: '检查防护用品' }, { key: 'B', text: '确认许可' }, { key: 'C', text: '跳过交底' }]),
      answer: '[0,1]', analysis: '<p>前两项正确。</p>', score: '10',
    },
    {
      category: categoryId, type: 'judgment', difficulty: 'hard', concept: '',
      stem: '<p>B4：未交底可以直接作业。</p>',
      options: JSON.stringify([{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }]),
      answer: '[1]', analysis: '<p>必须先交底。</p>', score: '5',
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
  assert.deepEqual(new Set(stored.map((row) => row.type)), new Set(['single', 'multiple', 'judgment']));
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
  assert.deepEqual(duplicatePreview.data.valid_rows, [], 'committed imports must remain duplicates after v2 HTML rendering');
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
