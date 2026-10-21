import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { startMockAi } from './e2e-smoke.mjs';
import { randomStrongPassword } from './training-access.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');

async function captchaAnswer(ctx, captchaId) {
  const redis = new Redis({
    host: ctx.env.REDIS_HOST || '127.0.0.1',
    port: Number(ctx.env.REDIS_PORT || 6379),
    password: ctx.env.REDIS_PASSWORD || undefined,
  });
  try { return await redis.get(`${ctx.env.REDIS_KEY_PREFIX || ''}auth:captcha:${captchaId}`); }
  finally { await redis.quit(); }
}

let loginSequence = 182;

async function accountLogin(ctx, username, password, ...personalValues) {
  loginSequence = loginSequence >= 240 ? 182 : loginSequence + 1;
  const headers = { 'X-Forwarded-For': `198.51.100.${loginSequence}` };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert.equal(captcha.status, 200);
  const actor = {};
  const login = await ctx.request(actor, 'POST', '/auth/login', {
    username, password,
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

async function adminLogin(ctx) {
  return accountLogin(ctx, 'admin', ctx.adminPassword, 'B3题库管理员');
}

function singleDraft(categoryId, stem = '<p>进入受限空间前应做什么？</p>') {
  return {
    category_id: categoryId,
    difficulty: 'easy',
    type: 'single',
    stem,
    options: [{ text: '先通风并检测' }, { text: '直接进入' }],
    answer: [0],
    analysis: '<p>应先通风、检测并审批。</p>',
    score: 5,
  };
}

function multipart(fields, bytes, filename, contentType) {
  const boundary = `----ruleexam-b3-${randomBytes(12).toString('hex')}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  parts.push(bytes);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

function pngFixture() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
}

async function seedParsedRegulation(ctx, actorId) {
  const title = `B3 AI 制度 ${randomBytes(4).toString('hex')}`;
  const inserted = await ctx.queryTestDb(
    'INSERT INTO regulation (title, category, description, status, current_version_id, required_minutes, scroll_segments, created_by) VALUES (?, ?, NULL, ?, NULL, 10, 10, ?)',
    [title, 'B3旧分类', 'draft', actorId],
  );
  const regulationId = String(inserted.insertId);
  const version = await ctx.queryTestDb(
    'INSERT INTO regulation_version (regulation_id, version_no, file_path, file_type, file_hash, content_html, text_content, parse_status, parsed_at, retry_count, created_by) VALUES (?, 1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), 0, ?)',
    [regulationId, `b3-${regulationId}.docx`, 'docx', randomBytes(32).toString('hex'), '<p>进入受限空间前必须通风、检测并审批。</p>', '进入受限空间前必须通风、检测并审批。'.repeat(80), 'parsed', actorId],
  );
  const versionId = String(version.insertId);
  await ctx.queryTestDb('UPDATE regulation SET current_version_id = ? WHERE id = ?', [versionId, regulationId]);
  return { regulationId, versionId };
}

async function waitTask(ctx, actor, taskId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await ctx.request(actor, 'GET', `/ai/generate-status/${taskId}`);
    assert.equal(status.status, 200, `AI status: ${JSON.stringify(status)}`);
    if (status.data.status === 'completed' || status.data.status === 'failed') return status.data;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('B3 Mock AI task timed out');
}

async function runBody(ctx, mockPort) {
  const admin = await adminLogin(ctx);
  const suffix = randomBytes(4).toString('hex');
  const category = await ctx.request(admin.actor, 'POST', '/admin/training-categories', { name: `B3 类别 ${suffix}` });
  const otherCategory = await ctx.request(admin.actor, 'POST', '/admin/training-categories', { name: `B3 其他类别 ${suffix}` });
  assert.equal(category.status, 200);
  assert.equal(otherCategory.status, 200);
  const categoryId = String(category.data.id);
  const otherCategoryId = String(otherCategory.data.id);

  for (const endpoint of ['generation-category-options', 'question-category-options', 'question-category-filters']) {
    const options = await ctx.request(admin.actor, 'GET', `/ai/${endpoint}?page=1&page_size=100`);
    assert.equal(options.status, 200, `${endpoint}: ${JSON.stringify(options)}`);
    assert.ok(options.data.items.some((item) => item.id === categoryId && item.name === category.data.name));
    assert.equal(typeof options.data.items[0].id, 'string');
  }

  const concept = await ctx.request(admin.actor, 'POST', '/ai/question-concepts', {
    category_id: categoryId, type: 'single', name: `受限空间 ${suffix}`,
  });
  assert.equal(concept.status, 200, `concept: ${JSON.stringify(concept)}`);
  const conceptOptions = await ctx.request(admin.actor, 'GET', `/ai/question-concept-options?category_id=${categoryId}&type=single&page=1&page_size=100`);
  assert.equal(conceptOptions.status, 200, `concept options: ${JSON.stringify(conceptOptions)}`);
  assert.ok(conceptOptions.data.items.some((item) => item.id === String(concept.data.id)));
  assert.equal(conceptOptions.data.page, 1);
  assert.equal(conceptOptions.data.page_size, 100);
  assert.deepEqual(Object.keys(conceptOptions.data.items[0]).sort(), ['id', 'name']);

  const writerUsername = `b3_writer_${suffix}`;
  const writerRealName = `B3录题员${suffix}`;
  const writerPassword = randomStrongPassword(writerUsername, writerRealName);
  const writerUser = await ctx.request(admin.actor, 'POST', '/users', {
    username: writerUsername, password: writerPassword, real_name: writerRealName, role: 'employee',
  });
  assert.equal(writerUser.status, 200, `writer user: ${JSON.stringify(writerUser)}`);
  const writerRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `b3_writer_${suffix}`, name: `B3 录题角色 ${suffix}`, permissions: ['questions:write'],
  });
  assert.equal(writerRole.status, 200, `writer role: ${JSON.stringify(writerRole)}`);
  const writerAssigned = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${writerUser.data.id}/roles`, {
    role_ids: [String(writerRole.data.id)],
  });
  assert.equal(writerAssigned.status, 200, `writer assignment: ${JSON.stringify(writerAssigned)}`);
  const writer = await accountLogin(ctx, writerUsername, writerPassword, writerRealName);
  const writerReadDenied = await ctx.request(writer.actor, 'GET', '/ai/questions?page=1&page_size=20');
  assert.equal(writerReadDenied.status, 403, 'questions:write-only 不得读取题库列表');
  const writerCategories = await ctx.request(writer.actor, 'GET', '/ai/question-category-options?page=1&page_size=100');
  assert.equal(writerCategories.status, 200, `writer category options: ${JSON.stringify(writerCategories)}`);
  assert.ok(writerCategories.data.items.some((item) => item.id === categoryId));
  const writerConceptOptions = await ctx.request(
    writer.actor,
    'GET',
    `/ai/question-concept-options?category_id=${categoryId}&type=single&page=1&page_size=100`,
  );
  assert.equal(writerConceptOptions.status, 200, `writer concept options: ${JSON.stringify(writerConceptOptions)}`);
  assert.ok(writerConceptOptions.data.items.some((item) => item.id === String(concept.data.id)));
  assert.ok(writerConceptOptions.data.items.every((item) => Object.keys(item).sort().join(',') === 'id,name'));
  const malformedConceptOptions = await ctx.request(
    writer.actor,
    'GET',
    `/ai/question-concept-options?category_id=${categoryId}&type=single&page=0`,
  );
  assert.equal(malformedConceptOptions.status, 400, '考点选项必须校验分页边界');
  const unknownCategoryConceptOptions = await ctx.request(
    writer.actor,
    'GET',
    '/ai/question-concept-options?category_id=9223372036854775807&type=single',
  );
  assert.equal(unknownCategoryConceptOptions.status, 409, '考点选项必须拒绝不存在/停用类别');
  assert.equal(unknownCategoryConceptOptions.code, 40910);
  const writerConcept = await ctx.request(writer.actor, 'POST', '/ai/question-concepts', {
    category_id: categoryId, type: 'judgment', name: `写权限考点 ${suffix}`,
  });
  assert.equal(writerConcept.status, 200, `writer concept create: ${JSON.stringify(writerConcept)}`);
  const writerQuestion = await ctx.request(writer.actor, 'POST', '/ai/questions', {
    ...singleDraft(categoryId, '<p>写权限用户人工录题。</p>'),
    concept_id: String(concept.data.id),
  });
  assert.equal(writerQuestion.status, 200, `writer question create: ${JSON.stringify(writerQuestion)}`);
  assert.equal(writerQuestion.data.status, 'approved');

  const manualWithoutRegulation = await ctx.request(admin.actor, 'POST', '/ai/questions', singleDraft(categoryId));
  assert.equal(manualWithoutRegulation.status, 200, JSON.stringify(manualWithoutRegulation));
  assert.equal(manualWithoutRegulation.data.regulation_id, null);
  assert.equal(manualWithoutRegulation.data.status, 'approved');
  assert.equal(manualWithoutRegulation.data.category_id, categoryId);
  assert.match(manualWithoutRegulation.data.question_id, /^\d+$/);
  assert.ok(manualWithoutRegulation.data.approved_by);
  assert.ok(manualWithoutRegulation.data.approved_at);
  const referencedCategoryDelete = await ctx.request(admin.actor, 'DELETE', `/admin/training-categories/${categoryId}`);
  assert.equal(referencedCategoryDelete.status, 409, '题目引用中的类别不得被删除');
  assert.equal(referencedCategoryDelete.code, 40910);

  const multiple = await ctx.request(admin.actor, 'POST', '/ai/questions', {
    ...singleDraft(categoryId, '<p>哪些属于进入前措施？</p>'),
    difficulty: 'medium', type: 'multiple', answer: [1, 0],
  });
  assert.equal(multiple.status, 200);
  assert.deepEqual(multiple.data.answer, [0, 1]);

  const judgment = await ctx.request(admin.actor, 'POST', '/ai/questions', {
    ...singleDraft(categoryId, '<p>未检测可直接进入。</p>'),
    difficulty: 'hard', type: 'judgment',
    options: [{ text: '正确' }, { text: '错误' }], answer: [1],
  });
  assert.equal(judgment.status, 200);
  assert.deepEqual(judgment.data.options.map((item) => item.text), ['正确', '错误']);

  const image = await ctx.request(admin.actor, 'POST', '/ai/questions', {
    ...singleDraft(categoryId, '<p>请上传现场隐患照片并说明。</p>'),
    type: 'image', options: [], answer: [], analysis: null,
    rubric: '<p>识别三项隐患，每项 2 分。</p>', score: 6,
  });
  assert.equal(image.status, 200);
  assert.equal(image.data.type, 'image');
  assert.deepEqual(image.data.options, []);
  assert.deepEqual(image.data.answer, []);

  const unknownType = await ctx.request(admin.actor, 'POST', '/ai/questions', { ...singleDraft(categoryId), type: 'essay' });
  assert.equal(unknownType.status, 400);
  const aiWithoutSourceVersion = await ctx.request(admin.actor, 'POST', '/ai/questions', { ...singleDraft(categoryId), source: 'ai' });
  assert.equal(aiWithoutSourceVersion.status, 400);

  const crossCategoryConcept = await ctx.request(admin.actor, 'POST', '/ai/questions', {
    ...singleDraft(otherCategoryId), concept_id: String(concept.data.id),
  });
  assert.equal(crossCategoryConcept.status, 400, JSON.stringify(crossCategoryConcept));

  const sanitized = await ctx.request(admin.actor, 'POST', '/ai/questions', singleDraft(
    categoryId,
    '<p onclick="alert(1)">清洗题干<script>alert(1)</script></p>',
  ));
  assert.equal(sanitized.status, 200);
  assert.equal(sanitized.data.stem.includes('<script'), false);
  assert.equal(sanitized.data.stem.includes('onclick'), false);
  const externalImage = await ctx.request(admin.actor, 'POST', '/ai/questions', singleDraft(
    categoryId,
    '<p>非法图片<img src="https://example.com/tracker.png"></p>',
  ));
  assert.equal(externalImage.status, 400);

  const uploadPayload = multipart({ purpose: 'question' }, pngFixture(), 'b3-question.png', 'image/png');
  const uploaded = await ctx.request(admin.actor, 'POST', '/media/upload', uploadPayload.body, uploadPayload.headers);
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded));
  assert.equal(uploaded.data.status, 'ready');
  const mediaId = String(uploaded.data.asset_id);
  const withMedia = await ctx.request(admin.actor, 'POST', '/ai/questions', singleDraft(
    categoryId,
    `<p>受控现场图<img data-media-id="${mediaId}" alt="现场图"></p>`,
  ));
  assert.equal(withMedia.status, 200, JSON.stringify(withMedia));
  const references = await ctx.queryTestDb(
    'SELECT owner_type, owner_id FROM media_reference WHERE asset_id = ?',
    [mediaId],
  );
  assert.ok(references.some((row) => row.owner_type === 'question_version' && String(row.owner_id) === String(withMedia.data.current_version_id)));
  const mediaContent = await ctx.request(admin.actor, 'GET', `/media/${mediaId}/content`);
  assert.equal(mediaContent.status, 200);
  assert.ok(Buffer.isBuffer(mediaContent.body) && mediaContent.body.length > 0);
  const referencedDelete = await ctx.request(admin.actor, 'DELETE', `/media/${mediaId}`);
  assert.equal(referencedDelete.status, 409);
  assert.equal(referencedDelete.code, 40913);

  const manualQuestionId = manualWithoutRegulation.data.question_id;
  const edited = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}`, {
    stem: '<p>修订后的题干</p>',
  });
  assert.equal(edited.status, 200, JSON.stringify(edited));
  assert.equal(edited.data.status, 'pending');
  assert.equal(edited.data.revision, 2);
  const history = await ctx.request(admin.actor, 'GET', `/ai/questions/${manualQuestionId}/versions`);
  assert.equal(history.status, 200);
  assert.equal(history.data[0].stem, '<p>修订后的题干</p>');
  assert.equal(history.data[1].stem, '<p>进入受限空间前应做什么？</p>');

  const approved = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}/review`, { status: 'approved' });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.status, 'approved');
  assert.equal(String(approved.data.approved_by), admin.id);

  const legacyInsert = await ctx.queryTestDb(
    'INSERT INTO question (regulation_id, version_id, type, stem, options, answer, analysis, score, status, source, created_by) VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['single', '<p>升级前题干</p>', JSON.stringify([{ key: 'A', text: '是' }, { key: 'B', text: '否' }]), JSON.stringify([0]), '旧解析', '2.00', 'approved', 'manual', admin.id],
  );
  const legacyId = String(legacyInsert.insertId);
  const upgraded = await ctx.request(admin.actor, 'PUT', `/ai/questions/${legacyId}`, {
    category_id: categoryId, difficulty: 'medium', stem: '<p>升级后题干</p>',
  });
  assert.equal(upgraded.status, 200, JSON.stringify(upgraded));
  assert.equal(upgraded.data.status, 'pending');
  const legacyHistory = await ctx.request(admin.actor, 'GET', `/ai/questions/${legacyId}/versions`);
  assert.equal(legacyHistory.status, 200);
  assert.equal(legacyHistory.data[1].stem, '<p>升级前题干</p>');
  assert.ok(legacyHistory.data[1].legacy_captured_at);
  assert.equal(legacyHistory.data[1].approved_by, null);

  const { regulationId, versionId } = await seedParsedRegulation(ctx, admin.id);
  const missingVersionRegulation = await ctx.request(admin.actor, 'POST', '/regulations', {
    title: `B3 无版本 ${suffix}`, category: '旧类别',
  });
  assert.equal(missingVersionRegulation.status, 200);
  const missingVersionGenerate = await ctx.request(admin.actor, 'POST', '/ai/generate-questions', {
    regulation_id: String(missingVersionRegulation.data.id), category_id: categoryId, difficulty: 'hard',
    question_count_single: 10, score_single: 6, question_count_multiple: 5, score_multiple: 8,
  });
  assert.equal(missingVersionGenerate.status, 400);

  const config = await ctx.request(admin.actor, 'PUT', '/ai/config', {
    base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: `test-${randomBytes(16).toString('hex')}`, model: 'mock-question-model',
  });
  assert.equal(config.status, 200, JSON.stringify(config));
  const generated = await ctx.request(admin.actor, 'POST', '/ai/generate-questions', {
    regulation_id: regulationId, category_id: categoryId, difficulty: 'hard',
    question_count_single: 10, score_single: 6, question_count_multiple: 5, score_multiple: 8,
  });
  assert.equal(generated.status, 200, JSON.stringify(generated));
  const task = await waitTask(ctx, admin.actor, generated.data.task_id);
  assert.equal(task.status, 'completed', JSON.stringify(task));
  assert.ok(task.question_ids.length > 0);
  const placeholders = task.question_ids.map(() => '?').join(',');
  const generatedRows = await ctx.queryTestDb(
    `SELECT q.category_id, q.difficulty, q.status, q.version_id, q.current_version_id, v.regulation_version_id, v.source FROM question q INNER JOIN question_version v ON v.id = q.current_version_id WHERE q.id IN (${placeholders})`,
    task.question_ids.map(String),
  );
  assert.ok(generatedRows.length > 0);
  for (const row of generatedRows) {
    assert.equal(String(row.category_id), categoryId);
    assert.equal(row.difficulty, 'hard');
    assert.equal(row.status, 'pending');
    assert.equal(String(row.version_id), versionId);
    assert.equal(String(row.regulation_version_id), versionId);
    assert.equal(row.source, 'ai');
  }
}

export async function run(ctx) {
  const mockServer = await startMockAi(0);
  const address = mockServer.address();
  const mockPort = address && typeof address !== 'string' ? address.port : null;
  if (!Number.isInteger(mockPort) || mockPort < 1024) {
    mockServer.close();
    throw new Error('training-question-bank Mock AI 未返回有效监听端口');
  }
  try {
    await runBody(ctx, mockPort);
  } finally {
    await new Promise((resolve) => mockServer.close(resolve));
  }
}
