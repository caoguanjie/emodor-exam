import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
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

async function runBody(ctx) {
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

  for (const [method, path, body] of [
    ['POST', '/ai/question-concepts', { category_id: categoryId, type: 'single', name: '已取消考点' }],
    ['GET', `/ai/question-concepts?category_id=${categoryId}`],
    ['GET', `/ai/question-concept-options?category_id=${categoryId}&type=single`],
  ]) assert.equal((await ctx.request(admin.actor, method, path, body)).status, 404, `retired concept endpoint: ${path}`);

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
  const writerQuestion = await ctx.request(writer.actor, 'POST', '/ai/questions', singleDraft(categoryId, '<p>写权限用户人工录题。</p>'));
  assert.equal(writerQuestion.status, 200, `writer question create: ${JSON.stringify(writerQuestion)}`);
  assert.equal(writerQuestion.data.enabled, true);
  assert.equal(String(writerQuestion.data.saved_version_id), String(writerQuestion.data.current_version_id));
  const writerDisabled = await ctx.request(writer.actor, 'PUT', `/ai/questions/${writerQuestion.data.question_id}/enabled`, { expected_version_id: writerQuestion.data.current_version_id, enabled: false });
  assert.equal(writerDisabled.status, 200); assert.equal(writerDisabled.data.enabled, false);
  const writerRevised = await ctx.request(writer.actor, 'PUT', `/ai/questions/${writerQuestion.data.question_id}`, { expected_version_id: writerQuestion.data.current_version_id, expected_enabled: false, stem: '<p>停用题明确保存并启用。</p>' });
  assert.equal(writerRevised.status, 200, JSON.stringify(writerRevised));
  assert.equal(writerRevised.data.enabled, true); assert.equal(writerRevised.data.revision, 2);

  const manualWithoutRegulation = await ctx.request(admin.actor, 'POST', '/ai/questions', singleDraft(categoryId));
  assert.equal(manualWithoutRegulation.status, 200, JSON.stringify(manualWithoutRegulation));
  assert.equal(manualWithoutRegulation.data.material_id, null);
  assert.equal(manualWithoutRegulation.data.enabled, true);
  assert.equal(manualWithoutRegulation.data.category_id, categoryId);
  assert.match(manualWithoutRegulation.data.question_id, /^\d+$/);
  assert.match(manualWithoutRegulation.data.saved_version_id, /^\d+$/);
  assert.equal(String(manualWithoutRegulation.data.saved_version_id), String(manualWithoutRegulation.data.current_version_id));
  for (const key of ['concept_id', 'status', 'approved_by', 'approved_at', 'reviewed_by', 'reviewed_at']) assert.equal(Object.hasOwn(manualWithoutRegulation.data, key), false, `current bank view omits ${key}`);
  assert.equal(Object.hasOwn(manualWithoutRegulation.data, 'score'), false, '题库响应不携带分值');
  const rejectedScore = await ctx.request(admin.actor, 'POST', '/ai/questions', { ...singleDraft(categoryId), score: 5 });
  assert.equal(rejectedScore.status, 400, '人工录题不接受题库分值');
  const scorelessRows = await ctx.queryTestDb(
    'SELECT q.score, v.score_cents FROM question q INNER JOIN question_version v ON v.id = q.current_version_id WHERE q.id = ?',
    [manualWithoutRegulation.data.question_id],
  );
  assert.deepEqual(scorelessRows.map((row) => [row.score, row.score_cents]), [[null, null]], '人工题不得暗写默认分值');
  const referencedCategoryDelete = await ctx.request(admin.actor, 'DELETE', `/admin/training-categories/${categoryId}`);
  assert.equal(referencedCategoryDelete.status, 409, '题目引用中的类别不得被删除');
  assert.equal(referencedCategoryDelete.code, 40910);

  const multiple = await ctx.request(admin.actor, 'POST', '/ai/questions', {
    ...singleDraft(categoryId, '<p>哪些属于进入前措施？</p>'),
    difficulty: 'easy', type: 'multiple', answer: [1, 0],
  });
  assert.equal(multiple.status, 200);
  assert.deepEqual(multiple.data.answer, [0, 1]);

  const scoredPapers = [];
  for (const scoreCents of [2000, 7000]) {
    const paper = await ctx.request(admin.actor, 'POST', '/admin/papers', {
      title: `同题独立赋分 ${scoreCents} ${suffix}`, mode: 'fixed', category_id: categoryId,
    });
    assert.equal(paper.status, 200, JSON.stringify(paper));
    const selected = await ctx.request(admin.actor, 'PUT', `/admin/papers/${paper.data.id}/questions`, {
      items: [
        { question_version_id: manualWithoutRegulation.data.current_version_id, score_cents: scoreCents },
        { question_version_id: multiple.data.current_version_id, score_cents: 10000 - scoreCents },
      ],
    });
    assert.equal(selected.status, 200, JSON.stringify(selected));
    const published = await ctx.request(admin.actor, 'POST', `/admin/papers/${paper.data.id}/publish`);
    assert.equal(published.status, 200, JSON.stringify(published));
    scoredPapers.push({ id: paper.data.id, scoreCents });
  }
  const frozenScores = await ctx.queryTestDb(
    'SELECT r.paper_id, rq.score_cents FROM paper_release r INNER JOIN paper_release_question rq ON rq.release_id = r.id WHERE rq.question_version_id = ? ORDER BY r.paper_id',
    [manualWithoutRegulation.data.current_version_id],
  );
  assert.deepEqual(frozenScores.map((row) => Number(row.score_cents)), [2000, 7000], '同一道题在不同试卷冻结独立分值');

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
    ...singleDraft(otherCategoryId), concept_id: '1',
  });
  assert.equal(crossCategoryConcept.status, 400, JSON.stringify(crossCategoryConcept));

  const sanitized = await ctx.request(admin.actor, 'POST', '/ai/questions', singleDraft(
    categoryId,
    '<p onclick="alert(1)">清洗题干<script>alert(1)</script></p>',
  ));
  assert.equal(sanitized.status, 200);
  assert.equal(sanitized.data.stem.includes('<script'), false);
  assert.equal(sanitized.data.stem.includes('onclick'), false);
  const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const v2Content = { stem: doc('稳定 ID 题干'), options: [{ id: 'opt_red', content: doc('红色') }, { id: 'opt_blue', content: doc('蓝色') }], analysis: doc('冻结解析'), answer_option_ids: ['opt_blue'] };
  const v2 = await ctx.request(admin.actor, 'POST', '/ai/questions', { category_id: categoryId, difficulty: 'easy', type: 'single', content_schema_version: 2, content_json: v2Content });
  assert.equal(v2.status, 200, `v2-only create: ${JSON.stringify(v2)}`);
  assert.deepEqual(v2.data.content_json, v2Content);
  assert.deepEqual(v2.data.options.map((option) => option.key), ['opt_red', 'opt_blue']);
  assert.deepEqual(v2.data.answer, [1]);
  const reordered = await ctx.request(admin.actor, 'PUT', `/ai/questions/${v2.data.question_id}`, { expected_version_id: v2.data.current_version_id, expected_enabled: true, content_schema_version: 2, content_json: { ...v2Content, options: [...v2Content.options].reverse() } });
  assert.equal(reordered.status, 200, `stable reorder: ${JSON.stringify(reordered)}`);
  assert.deepEqual(reordered.data.content_json.answer_option_ids, ['opt_blue']);
  assert.deepEqual(reordered.data.options.map((option) => option.key), ['opt_blue', 'opt_red']);
  assert.deepEqual(reordered.data.answer, [0]);
  const badV2 = await ctx.request(admin.actor, 'POST', '/ai/questions', { category_id: categoryId, difficulty: 'easy', type: 'single', content_schema_version: 2, content_json: { ...v2Content, stem: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '不透传', checked: true }] }] } } });
  assert.equal(badV2.status, 400, 'v2 deep unknown fields must fail closed');
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
  const missingExpectedState = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}`, { expected_version_id: firstVersionId, stem: '<p>不能省略启停前置条件</p>' });
  assert.equal(missingExpectedState.status, 400);
  const edited = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}`, {
    expected_version_id: firstVersionId, expected_enabled: true,
    stem: '<p>修订后的题干</p>',
  });
  assert.equal(edited.status, 200, JSON.stringify(edited));
  assert.equal(edited.data.enabled, true);
  assert.equal(edited.data.revision, 2);
  assert.equal(Object.hasOwn(edited.data, 'score'), false, '修订不重新引入题库分值');
  const scoresAfterRevision = await ctx.queryTestDb(
    'SELECT r.paper_id, rq.score_cents FROM paper_release r INNER JOIN paper_release_question rq ON rq.release_id = r.id WHERE r.paper_id IN (?, ?) AND rq.question_version_id = ? ORDER BY r.paper_id',
    [scoredPapers[0].id, scoredPapers[1].id, firstVersionId],
  );
  assert.deepEqual(scoresAfterRevision.map((row) => Number(row.score_cents)), [2000, 7000], '题库修订不改变已发布试卷的分值');
  assert.match(edited.data.saved_version_id, /^\d+$/);
  assert.equal(String(edited.data.saved_version_id), String(edited.data.current_version_id));
  const secondVersionId = String(edited.data.saved_version_id);
  const versionCountBeforeStale = await ctx.queryTestDb(
    'SELECT COUNT(*) AS total FROM question_version WHERE question_id = ?',
    [manualQuestionId],
  );
  const staleEdit = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}`, {
    expected_version_id: firstVersionId, expected_enabled: true,
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

  assert.equal((await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}/review`, { expected_version_id: secondVersionId, status: 'approved' })).status, 404);
  const disabled = await ctx.request(writer.actor, 'PUT', `/ai/questions/${manualQuestionId}/enabled`, { expected_version_id: secondVersionId, enabled: false });
  assert.equal(disabled.status, 200, JSON.stringify(disabled)); assert.equal(disabled.data.enabled, false);
  assert.equal(String(disabled.data.current_version_id), secondVersionId, '停用不创建内容版本');
  const staleState = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}`, { expected_version_id: secondVersionId, expected_enabled: true, stem: '<p>过期启用页面不得恢复</p>' });
  assert.equal(staleState.status, 409); assert.equal(staleState.code, 40940);
  const stillDisabled = await ctx.request(admin.actor, 'GET', `/ai/questions/${manualQuestionId}`);
  assert.equal(stillDisabled.data.enabled, false); assert.equal(String(stillDisabled.data.current_version_id), secondVersionId);
  const stopped = await ctx.request(admin.actor, 'GET', `/ai/questions?category_id=${categoryId}&enabled=false`);
  assert.ok(stopped.data.list.some((row) => row.question_id === manualQuestionId));
  const sameDisable = await ctx.request(writer.actor, 'PUT', `/ai/questions/${manualQuestionId}/enabled`, { expected_version_id: secondVersionId, enabled: false });
  assert.equal(sameDisable.status, 200); assert.equal(sameDisable.data.enabled, false);
  const staleEnable = await ctx.request(admin.actor, 'PUT', `/ai/questions/${manualQuestionId}/enabled`, { expected_version_id: firstVersionId, enabled: true });
  assert.equal(staleEnable.status, 409); assert.equal(staleEnable.code, 40940);
  const restored = await ctx.request(writer.actor, 'PUT', `/ai/questions/${manualQuestionId}/enabled`, { expected_version_id: secondVersionId, enabled: true });
  assert.equal(restored.status, 200, JSON.stringify(restored)); assert.equal(restored.data.enabled, true);
  const restoredVersions = await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question_version WHERE question_id=?', [manualQuestionId]);
  assert.equal(Number(restoredVersions[0].total), 2, '启停和过期编辑不得新增内容版本');
  const frozenAfterLifecycle = await ctx.queryTestDb('SELECT rq.score_cents FROM paper_release r JOIN paper_release_question rq ON rq.release_id=r.id WHERE r.paper_id IN (?, ?) AND rq.question_version_id=? ORDER BY r.paper_id', [scoredPapers[0].id, scoredPapers[1].id, firstVersionId]);
  assert.deepEqual(frozenAfterLifecycle.map((row) => Number(row.score_cents)), [2000, 7000]);

  const legacyInsert = await ctx.queryTestDb(
    'INSERT INTO question (regulation_id, version_id, type, stem, options, answer, analysis, score, status, source, created_by) VALUES (NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['single', '<p>升级前题干</p>', JSON.stringify([{ key: 'A', text: '是' }, { key: 'B', text: '否' }]), JSON.stringify([0]), '旧解析', '2.00', 'approved', 'manual', admin.id],
  );
  const legacyId = String(legacyInsert.insertId);
  const upgraded = await ctx.request(admin.actor, 'PUT', `/ai/questions/${legacyId}`, {
    expected_version_id: null, expected_enabled: true,
    category_id: categoryId, difficulty: 'easy', stem: '<p>升级后题干</p>',
  });
  assert.equal(upgraded.status, 200, JSON.stringify(upgraded));
  assert.equal(upgraded.data.enabled, true);
  const legacyHistory = await ctx.request(admin.actor, 'GET', `/ai/questions/${legacyId}/history`);
  assert.equal(legacyHistory.status, 200);
  assert.equal(legacyHistory.data.items[1].stem, '<p>升级前题干</p>');
  assert.ok(legacyHistory.data.items[1].legacy_captured_at);
  assert.equal(legacyHistory.data.items[1].approved_by, null);

  const { regulationId, versionId } = await seedParsedRegulation(ctx, admin.id);
  const fixedSingle = await ctx.request(admin.actor, 'POST', '/ai/questions', {
    ...singleDraft(categoryId, '<p>固定卷单选题。</p>'),
  });
  assert.equal(fixedSingle.status, 200, JSON.stringify(fixedSingle));
  const fixedJudgment = await ctx.request(admin.actor, 'POST', '/ai/questions', {
    ...singleDraft(categoryId, '<p>固定卷不支持判断题。</p>'),
    type: 'judgment',
    options: [{ text: '正确' }, { text: '错误' }],
    answer: [1],
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
    expected_version_id: String(fixedSingle.data.current_version_id), expected_enabled: true,
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

  const beforeRetiredWrites = await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question_version');
  const retiredGeneration = await ctx.request(admin.actor, 'POST', '/ai/generate-questions', {
    material_id: regulationId, material_version_id: versionId, category_id: categoryId, difficulty: 'hard',
    question_count_single: 10, question_count_multiple: 5,
  });
  assert.equal(retiredGeneration.status, 404, '旧资料生成入口不得绕过导入预览直接启用');
  const retiredRegeneration = await ctx.request(admin.actor, 'POST', `/ai/questions/${manualQuestionId}/regenerate`, {
    expected_version_id: secondVersionId,
  });
  assert.equal(retiredRegeneration.status, 404, '历史题目直接重生成入口已取消');
  assert.deepEqual(await ctx.queryTestDb('SELECT COUNT(*) AS total FROM question_version'), beforeRetiredWrites);
}

export async function run(ctx) {
  await runBody(ctx);
}
