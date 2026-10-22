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
    [title, 'question_material', 'draft', actorId],
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
  const conceptList = await ctx.request(admin.actor, 'GET', `/ai/question-concepts?category_id=${categoryId}`);
  assert.equal(conceptList.status, 200, `concept list: ${JSON.stringify(conceptList)}`);
  assert.equal(conceptList.data.page, 1);
  assert.equal(conceptList.data.page_size, 20);
  assert.ok(conceptList.data.items.some((item) => item.id === String(concept.data.id)));
  assert.deepEqual(
    Object.keys(conceptList.data.items.find((item) => item.id === String(concept.data.id))).sort(),
    ['category_id', 'id', 'name', 'type'],
  );
  const malformedConceptList = await ctx.request(admin.actor, 'GET', `/ai/question-concepts?category_id=${categoryId}&page_size=101`);
  assert.equal(malformedConceptList.status, 400, '考点管理列表必须校验分页上限');
  const conceptOptions = await ctx.request(admin.actor, 'GET', `/ai/question-concept-options?category_id=${categoryId}&type=single&page=1&page_size=100`);
  assert.equal(conceptOptions.status, 200, `concept options: ${JSON.stringify(conceptOptions)}`);
  assert.ok(conceptOptions.data.items.some((item) => item.id === String(concept.data.id)));
  assert.equal(conceptOptions.data.page, 1);
  assert.equal(conceptOptions.data.page_size, 100);
  assert.deepEqual(Object.keys(conceptOptions.data.items[0]).sort(), ['id', 'name']);

  const writerUsername = `b3_writer_${suffix}`;
  const writerRealName = `B3录题员${suffix}`;
  const writerPassword = randomStrongPassword(writerUsername, writerRealName);
  const writerRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `b3_writer_${suffix}`, name: `B3 录题角色 ${suffix}`, permissions: ['questions:write'],
  });
  assert.equal(writerRole.status, 200, `writer role: ${JSON.stringify(writerRole)}`);
  const writerUser = await ctx.request(admin.actor, 'POST', '/admin/administrators', {
    username: writerUsername, password: writerPassword, real_name: writerRealName,
    role_ids: [String(writerRole.data.id)],
  });
  assert.equal(writerUser.status, 200, `writer user: ${JSON.stringify(writerUser)}`);
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
  assert.equal(String(writerQuestion.data.saved_version_id), String(writerQuestion.data.current_version_id));

  const manualWithoutRegulation = await ctx.request(admin.actor, 'POST', '/ai/questions', singleDraft(categoryId));
  assert.equal(manualWithoutRegulation.status, 200, JSON.stringify(manualWithoutRegulation));
  assert.equal(manualWithoutRegulation.data.material_id, null);
  assert.equal(manualWithoutRegulation.data.status, 'approved');
  assert.equal(manualWithoutRegulation.data.category_id, categoryId);
  assert.match(manualWithoutRegulation.data.question_id, /^\d+$/);
  assert.match(manualWithoutRegulation.data.saved_version_id, /^\d+$/);
  assert.equal(String(manualWithoutRegulation.data.saved_version_id), String(manualWithoutRegulation.data.current_version_id));
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

  const removedImageType = await ctx.request(admin.actor, 'POST', '/ai/questions', {
    ...singleDraft(categoryId, '<p>请上传现场隐患照片并说明。</p>'),
    type: 'image', options: [], answer: [], analysis: null,
    rubric: '<p>识别三项隐患，每项 2 分。</p>', score: 6,
  });
  assert.equal(removedImageType.status, 400, '已取消的图片作答题不得再录入');

  const unknownType = await ctx.request(admin.actor, 'POST', '/ai/questions', { ...singleDraft(categoryId), type: 'essay' });
  assert.equal(unknownType.status, 400);
  const unsupportedSourceOverride = await ctx.request(admin.actor, 'POST', '/ai/questions', { ...singleDraft(categoryId), source: 'ai' });
  assert.equal(unsupportedSourceOverride.status, 400, '人工录题 API 不允许客户端伪造 source=ai');

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
  const maliciousLegacyStem = '<p onclick="steal()">恶意旧题<script>alert(1)</script><img src="https://evil.test/tracker.png" onerror="steal()"></p>';
  const maliciousLegacy = await ctx.queryTestDb(
    'INSERT INTO question (regulation_id, version_id, type, stem, options, answer, analysis, score, status, source, created_by) VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      'single', maliciousLegacyStem,
      JSON.stringify([{ key: 'A', text: '<b onmouseover="steal()">是</b>' }, { key: 'B', text: '否' }]),
      JSON.stringify([0]), '<a href="javascript:steal()">旧解析</a>', '2.00', 'approved', 'manual', admin.id,
    ],
  );
  const maliciousLegacyId = String(maliciousLegacy.insertId);
  const maliciousDetail = await ctx.request(admin.actor, 'GET', `/ai/questions/${maliciousLegacyId}`);
  assert.equal(maliciousDetail.status, 200, JSON.stringify(maliciousDetail));
  assert.equal(Object.hasOwn(maliciousDetail.data, 'saved_version_id'), false, 'ordinary GET view must not invent a mutation receipt');
  assert.equal(maliciousDetail.data.difficulty, null, '旧题未知难度不得伪造为 easy');
  assert.equal(maliciousDetail.data.stem.includes('<script'), false);
  assert.equal(maliciousDetail.data.stem.includes('onclick'), false);
  assert.equal(maliciousDetail.data.stem.includes('src='), false);
  assert.equal(maliciousDetail.data.options[0].text.includes('onmouseover'), false);
  assert.equal(maliciousDetail.data.analysis.includes('javascript:'), false);
  const maliciousList = await ctx.request(admin.actor, 'GET', '/ai/questions?keyword=%E6%81%B6%E6%84%8F%E6%97%A7%E9%A2%98');
  assert.equal(maliciousList.status, 200, JSON.stringify(maliciousList));
  const maliciousListItem = maliciousList.data.list.find((item) => item.question_id === maliciousLegacyId);
  assert.ok(maliciousListItem);
  assert.equal(maliciousListItem.stem.includes('<script'), false);
  assert.equal(maliciousListItem.stem.includes('onclick'), false);
  const storedMalicious = await ctx.queryTestDb('SELECT stem FROM question WHERE id = ?', [maliciousLegacyId]);
  assert.equal(storedMalicious[0].stem, maliciousLegacyStem, '响应清洗不得重写遗留历史');
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
  assert.ok(references.some((row) => row.owner_type === 'question_version' && String(row.owner_id) === String(withMedia.data.saved_version_id)));
  const mediaContent = await ctx.request(admin.actor, 'GET', `/media/${mediaId}/content`);
  assert.equal(mediaContent.status, 200);
  assert.ok(Buffer.isBuffer(mediaContent.body) && mediaContent.body.length > 0);
  const referencedDelete = await ctx.request(admin.actor, 'DELETE', `/media/${mediaId}`);
  assert.equal(referencedDelete.status, 409);
  assert.equal(referencedDelete.code, 40913);

  const manualQuestionId = manualWithoutRegulation.data.question_id;
  const firstVersionId = String(manualWithoutRegulation.data.saved_version_id);
  const missingExpectedEdit = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}`, {
    stem: '<p>不能省略版本前置条件</p>',
  });
  assert.equal(missingExpectedEdit.status, 400);
  const edited = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}`, {
    expected_version_id: firstVersionId,
    stem: '<p>修订后的题干</p>',
  });
  assert.equal(edited.status, 200, JSON.stringify(edited));
  assert.equal(edited.data.status, 'pending');
  assert.equal(edited.data.revision, 2);
  assert.match(edited.data.saved_version_id, /^\d+$/);
  assert.equal(String(edited.data.saved_version_id), String(edited.data.current_version_id));
  const secondVersionId = String(edited.data.saved_version_id);
  const versionCountBeforeStale = await ctx.queryTestDb(
    'SELECT COUNT(*) AS total FROM question_version WHERE question_id = ?',
    [manualQuestionId],
  );
  const staleEdit = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}`, {
    expected_version_id: firstVersionId,
    stem: '<p>旧页面覆盖</p>',
  });
  assert.equal(staleEdit.status, 409);
  assert.equal(staleEdit.code, 40940);
  const versionCountAfterStale = await ctx.queryTestDb(
    'SELECT COUNT(*) AS total FROM question_version WHERE question_id = ?',
    [manualQuestionId],
  );
  assert.equal(Number(versionCountAfterStale[0].total), Number(versionCountBeforeStale[0].total));
  const history = await ctx.request(admin.actor, 'GET', `/ai/questions/${manualQuestionId}/history`);
  assert.equal(history.status, 200);
  assert.equal(history.data.page, 1);
  assert.equal(history.data.page_size, 20);
  assert.equal(history.data.total, 2);
  assert.equal(history.data.items[0].stem, '<p>修订后的题干</p>');
  assert.equal(history.data.items[1].stem, '<p>进入受限空间前应做什么？</p>');
  const historyPage = await ctx.request(admin.actor, 'GET', `/ai/questions/${manualQuestionId}/history?page=2&page_size=1`);
  assert.equal(historyPage.status, 200);
  assert.equal(historyPage.data.items.length, 1);
  assert.equal(historyPage.data.items[0].stem, '<p>进入受限空间前应做什么？</p>');
  const malformedHistory = await ctx.request(admin.actor, 'GET', `/ai/questions/${manualQuestionId}/history?page_size=101`);
  assert.equal(malformedHistory.status, 400);

  const missingExpectedReview = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}/review`, { status: 'approved' });
  assert.equal(missingExpectedReview.status, 400);
  const staleReview = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}/review`, {
    expected_version_id: firstVersionId, status: 'approved',
  });
  assert.equal(staleReview.status, 409);
  assert.equal(staleReview.code, 40940);
  const afterStaleReview = await ctx.request(admin.actor, 'GET', `/ai/questions/${manualQuestionId}`);
  assert.equal(afterStaleReview.data.status, 'pending');
  assert.equal(String(afterStaleReview.data.current_version_id), secondVersionId);
  const approved = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}/review`, {
    expected_version_id: secondVersionId, status: 'approved',
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.status, 'approved');
  assert.equal(String(approved.data.approved_by), admin.id);

  const legacyInsert = await ctx.queryTestDb(
    'INSERT INTO question (regulation_id, version_id, type, stem, options, answer, analysis, score, status, source, created_by) VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['single', '<p>升级前题干</p>', JSON.stringify([{ key: 'A', text: '是' }, { key: 'B', text: '否' }]), JSON.stringify([0]), '旧解析', '2.00', 'approved', 'manual', admin.id],
  );
  const legacyId = String(legacyInsert.insertId);
  const upgraded = await ctx.request(admin.actor, 'PUT', `/ai/questions/${legacyId}`, {
    expected_version_id: null,
    category_id: categoryId, difficulty: 'medium', stem: '<p>升级后题干</p>',
  });
  assert.equal(upgraded.status, 200, JSON.stringify(upgraded));
  assert.equal(upgraded.data.status, 'pending');
  const legacyHistory = await ctx.request(admin.actor, 'GET', `/ai/questions/${legacyId}/history`);
  assert.equal(legacyHistory.status, 200);
  assert.equal(legacyHistory.data.items[1].stem, '<p>升级前题干</p>');
  assert.ok(legacyHistory.data.items[1].legacy_captured_at);
  assert.equal(legacyHistory.data.items[1].approved_by, null);

  const { regulationId, versionId } = await seedParsedRegulation(ctx, admin.id);
  const fixedSingle = await ctx.request(admin.actor, 'POST', '/ai/questions', {
    ...singleDraft(categoryId, '<p>固定卷单选题。</p>'),
    score: 100,
  });
  assert.equal(fixedSingle.status, 200, JSON.stringify(fixedSingle));
  const fixedJudgment = await ctx.request(admin.actor, 'POST', '/ai/questions', {
    ...singleDraft(categoryId, '<p>固定卷不支持判断题。</p>'),
    type: 'judgment',
    options: [{ text: '正确' }, { text: '错误' }],
    answer: [1],
    score: 100,
  });
  assert.equal(fixedJudgment.status, 200, JSON.stringify(fixedJudgment));
  for (const question of [fixedSingle.data, fixedJudgment.data]) {
    await ctx.queryTestDb(
      'UPDATE question SET regulation_id = ?, version_id = ? WHERE id = ?',
      [regulationId, versionId, String(question.question_id)],
    );
    await ctx.queryTestDb(
      'UPDATE question_version SET regulation_id = ?, regulation_version_id = ? WHERE id = ?',
      [regulationId, versionId, String(question.current_version_id)],
    );
  }
  const legacyPaper = await ctx.request(admin.actor, 'POST', '/ai/papers', {
    regulation_id: regulationId, title: `B3 legacy 能力边界 ${suffix}`, pass_score: 60,
  });
  assert.equal(legacyPaper.status, 200, JSON.stringify(legacyPaper));
  const unsupportedSelection = await ctx.request(admin.actor, 'PUT', `/ai/papers/${legacyPaper.data.id}/questions`, {
    items: [{ question_id: Number(fixedJudgment.data.question_id), score: 100 }],
  });
  assert.equal(unsupportedSelection.status, 400, 'legacy 固定卷选题必须拒绝判断题');
  const supportedSelection = await ctx.request(admin.actor, 'PUT', `/ai/papers/${legacyPaper.data.id}/questions`, {
    items: [{ question_id: Number(fixedSingle.data.question_id), score: 100 }],
  });
  assert.equal(supportedSelection.status, 200, JSON.stringify(supportedSelection));
  const referencedTypeChange = await ctx.request(admin.actor, 'PUT', `/ai/questions/${fixedSingle.data.question_id}`, {
    expected_version_id: String(fixedSingle.data.current_version_id),
    type: 'judgment', options: [{ text: '正确' }, { text: '错误' }], answer: [1],
  });
  assert.equal(referencedTypeChange.status, 409);
  assert.equal(referencedTypeChange.code, 40908);

  const corruptedPaper = await ctx.request(admin.actor, 'POST', '/ai/papers', {
    regulation_id: regulationId, title: `B3 legacy 发布边界 ${suffix}`, pass_score: 60,
  });
  assert.equal(corruptedPaper.status, 200, JSON.stringify(corruptedPaper));
  await ctx.queryTestDb(
    'INSERT INTO paper_question (paper_id, question_id, sort, score) VALUES (?, ?, 0, 100.00)',
    [String(corruptedPaper.data.id), String(fixedJudgment.data.question_id)],
  );
  const unsupportedPublish = await ctx.request(admin.actor, 'POST', `/ai/papers/${corruptedPaper.data.id}/publish`);
  assert.equal(unsupportedPublish.status, 400, 'legacy 固定卷发布必须重新拒绝判断题');

  const missingVersionMaterial = await ctx.request(admin.actor, 'POST', '/admin/question-materials', {
    title: `B3 无版本 ${suffix}`, description: '尚未上传版本',
  });
  assert.equal(missingVersionMaterial.status, 200);
  const missingVersionGenerate = await ctx.request(admin.actor, 'POST', '/ai/generate-questions', {
    material_id: String(missingVersionMaterial.data.id), category_id: categoryId, difficulty: 'hard',
    question_count_single: 10, score_single: 6, question_count_multiple: 5, score_multiple: 8,
  });
  assert.equal(missingVersionGenerate.status, 400);

  const config = await ctx.request(admin.actor, 'PUT', '/ai/config', {
    base_url: `http://127.0.0.1:${mockPort}/v1`, api_key: `test-${randomBytes(16).toString('hex')}`, model: 'mock-question-model',
  });
  assert.equal(config.status, 200, JSON.stringify(config));
  const generated = await ctx.request(admin.actor, 'POST', '/ai/generate-questions', {
    material_id: regulationId, material_version_id: versionId, category_id: categoryId, difficulty: 'hard',
    question_count_single: 10, score_single: 6, question_count_multiple: 5, score_multiple: 8,
  });
  assert.equal(generated.status, 200, JSON.stringify(generated));
  const task = await waitTask(ctx, admin.actor, generated.data.task_id);
  assert.equal(task.status, 'completed', JSON.stringify(task));
  assert.ok(task.question_ids.length > 0);
  const placeholders = task.question_ids.map(() => '?').join(',');
  const generatedRows = await ctx.queryTestDb(
    `SELECT q.id, q.type, q.category_id, q.difficulty, q.status, q.version_id, q.current_version_id, v.regulation_version_id, v.source, v.source_page_group, v.source_page_start, v.source_page_end FROM question q INNER JOIN question_version v ON v.id = q.current_version_id WHERE q.id IN (${placeholders})`,
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
    assert.equal(row.source_page_group, null);
    assert.equal(row.source_page_start, null);
    assert.equal(row.source_page_end, null);
  }

  const regenQuestion = generatedRows.find((row) => row.type === 'single');
  assert.ok(regenQuestion, 'Mock AI 结果应至少包含一题可重生成的单选题');
  const regenQuestionId = String(regenQuestion.id);
  const regenVersionId = String(regenQuestion.current_version_id);
  const missingExpectedRegen = await ctx.request(admin.actor, 'POST', `/ai/questions/${regenQuestionId}/regenerate`, {});
  assert.equal(missingExpectedRegen.status, 400);
  const beforeStaleRegen = await ctx.queryTestDb(
    'SELECT COUNT(*) AS total FROM question_version WHERE question_id = ?',
    [regenQuestionId],
  );
  const staleRegen = await ctx.request(admin.actor, 'POST', `/ai/questions/${regenQuestionId}/regenerate`, {
    expected_version_id: String(BigInt(regenVersionId) + 1n),
  });
  assert.equal(staleRegen.status, 409);
  assert.equal(staleRegen.code, 40940);
  const afterStaleRegen = await ctx.queryTestDb(
    'SELECT COUNT(*) AS total FROM question_version WHERE question_id = ?',
    [regenQuestionId],
  );
  assert.equal(Number(afterStaleRegen[0].total), Number(beforeStaleRegen[0].total));
  const regenerated = await ctx.request(admin.actor, 'POST', `/ai/questions/${regenQuestionId}/regenerate`, {
    expected_version_id: regenVersionId,
  });
  assert.equal(regenerated.status, 200, JSON.stringify(regenerated));
  assert.equal(regenerated.data.revision, 2);
  assert.equal(regenerated.data.difficulty, 'hard');
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
