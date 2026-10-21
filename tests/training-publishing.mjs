import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './training-access.mjs';
import {
  provePaperReleaseSingleConnectionPools,
  proveTrainingCategoryChangeConflicts,
} from './support/paper-release-concurrency-checks.mjs';

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

async function adminLogin(ctx) {
  const headers = { 'X-Forwarded-For': '198.51.100.217' };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert.equal(captcha.status, 200);
  const actor = {};
  const login = await ctx.request(actor, 'POST', '/auth/login', {
    username: 'admin', password: ctx.adminPassword,
    captcha_id: captcha.data.captcha_id,
    captcha_code: await captchaAnswer(ctx, captcha.data.captcha_id),
  }, headers);
  assert.equal(login.status, 200, JSON.stringify(login));
  actor.accessToken = login.data.access_token;
  if (!login.data.force_change_password) return { actor, id: String(login.data.user.id) };
  const nextPassword = randomStrongPassword('admin', 'C1发布管理员');
  const changed = await ctx.request(actor, 'PUT', '/auth/password', { old_password: ctx.adminPassword, new_password: nextPassword });
  assert.equal(changed.status, 200, JSON.stringify(changed));
  actor.accessToken = changed.data.access_token;
  return { actor, id: String(login.data.user.id) };
}

async function loginUser(ctx, username, password, label) {
  const sourceIp = `198.51.100.${(loginUser.sequence = (loginUser.sequence || 220) + 1)}`;
  const headers = { 'X-Forwarded-For': sourceIp };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert.equal(captcha.status, 200, `${label} captcha: ${JSON.stringify(captcha)}`);
  const actor = {};
  const login = await ctx.request(actor, 'POST', '/auth/login', {
    username,
    password,
    captcha_id: captcha.data.captcha_id,
    captcha_code: await captchaAnswer(ctx, captcha.data.captcha_id),
  }, headers);
  assert.equal(login.status, 200, `${label} login: ${JSON.stringify(login)}`);
  actor.accessToken = login.data.access_token;
  if (!login.data.force_change_password) return { actor, password };
  const nextPassword = randomStrongPassword(username, label);
  const changed = await ctx.request(actor, 'PUT', '/auth/password', {
    old_password: password,
    new_password: nextPassword,
  });
  assert.equal(changed.status, 200, `${label} password change: ${JSON.stringify(changed)}`);
  actor.accessToken = changed.data.access_token;
  return { actor, password: nextPassword };
}

async function createPermissionReader(ctx, admin, suffix, label, permissions) {
  const role = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `c1_${label}_${suffix}`,
    name: `C1 ${label}`,
    permissions,
  });
  assert.equal(role.status, 200, `${label} role: ${JSON.stringify(role)}`);
  const username = `c1_${label}_${suffix}`;
  const initialPassword = randomStrongPassword(username, label);
  const user = await ctx.request(admin.actor, 'POST', '/users', {
    username,
    password: initialPassword,
    real_name: `C1 ${label}`,
    role: 'employee',
  });
  assert.equal(user.status, 200, `${label} user: ${JSON.stringify(user)}`);
  const assigned = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${user.data.id}/roles`, {
    role_ids: [String(role.data.id)],
  });
  assert.equal(assigned.status, 200, `${label} assignment: ${JSON.stringify(assigned)}`);
  const login = await loginUser(ctx, username, initialPassword, label);
  return {
    ...login,
    id: String(user.data.id),
    username,
    roleId: String(role.data.id),
  };
}

function pngFixture() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
}

async function uploadQuestionImage(ctx, actor, filename) {
  const boundary = `----ruleexam-c1-${randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nquestion\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    pngFixture(),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploaded = await ctx.request(actor, 'POST', '/media/upload', body, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  });
  assert.equal(uploaded.status, 200, `question image upload: ${JSON.stringify(uploaded)}`);
  assert.equal(uploaded.data.status, 'ready');
  return String(uploaded.data.asset_id);
}

function questionDraft(categoryId, type, difficulty, stem, extra = {}) {
  const objectiveOptions = [{ text: '正确选项' }, { text: '干扰选项' }, { text: '另一个选项' }];
  return {
    category_id: categoryId,
    difficulty,
    type,
    stem: `<p>${stem}</p>`,
    options: type === 'image' ? [] : type === 'judgment' ? [{ text: '正确' }, { text: '错误' }] : objectiveOptions,
    answer: type === 'image' ? [] : type === 'multiple' ? [0, 1] : type === 'judgment' ? [1] : [0],
    analysis: type === 'image' ? null : '<p>发布前解析</p>',
    rubric: type === 'image' ? '<p>按风险点逐项评分</p>' : null,
    score: 25,
    ...extra,
  };
}

async function createQuestion(ctx, actor, draft) {
  const response = await ctx.request(actor, 'POST', '/ai/questions', draft);
  assert.equal(response.status, 200, `question create: ${JSON.stringify(response)}`);
  assert.equal(response.data.status, 'approved');
  return {
    questionId: String(response.data.question_id),
    versionId: String(response.data.saved_version_id),
  };
}

async function createCategory(ctx, actor, name) {
  const response = await ctx.request(actor, 'POST', '/admin/training-categories', { name });
  assert.equal(response.status, 200, JSON.stringify(response));
  return String(response.data.id);
}

async function insertLegacyRegulationQuestion(ctx, input) {
  const inserted = await ctx.queryTestDb(
    'INSERT INTO question (regulation_id, version_id, category_id, difficulty, concept_id, current_version_id, type, stem, options, answer, analysis, rubric, score, status, source, created_by) VALUES (?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)',
    [input.regulationId, input.categoryId, 'medium', input.conceptId, 'single', `<p>${input.stem}</p>`,
      JSON.stringify([{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }]), JSON.stringify([0]),
      '旧题解析', '50.00', 'approved', 'manual', input.createdBy],
  );
  return String(inserted.insertId);
}

async function runPublishing(ctx) {
  let stage = 'admin login';
  try {
  const admin = await adminLogin(ctx);
  const suffix = randomBytes(4).toString('hex');
  stage = 'category and base questions';
  const categoryId = await createCategory(ctx, admin.actor, `C1 发布类别 ${suffix}`);

  stage = 'paper-scoped question media authorization';
  const mediaIds = {};
  for (const field of ['stem', 'option', 'analysis', 'rubric', 'unrelated']) {
    mediaIds[field] = await uploadQuestionImage(ctx, admin.actor, `c1-${field}-${suffix}.png`);
  }
  const promptMediaQuestion = await createQuestion(ctx, admin.actor, questionDraft(
    categoryId,
    'single',
    'medium',
    `题图授权 ${suffix}`,
    {
      stem: `<p>题干图<img data-media-id="${mediaIds.stem}" alt="题干图"></p>`,
      options: [
        { text: `<p>选项图<img data-media-id="${mediaIds.option}" alt="选项图"></p>` },
        { text: '干扰项' },
      ],
      answer: [0],
      analysis: `<p>解析图<img data-media-id="${mediaIds.analysis}" alt="解析图"></p>`,
      score: 50,
    },
  ));
  const rubricMediaQuestion = await createQuestion(ctx, admin.actor, questionDraft(
    categoryId,
    'image',
    'medium',
    `图片题授权 ${suffix}`,
    {
      rubric: `<p>评分参考图<img data-media-id="${mediaIds.rubric}" alt="评分参考图"></p>`,
      score: 50,
    },
  ));
  await createQuestion(ctx, admin.actor, questionDraft(
    categoryId,
    'single',
    'medium',
    `未引用题图 ${suffix}`,
    {
      stem: `<p>未引用图<img data-media-id="${mediaIds.unrelated}" alt="未引用图"></p>`,
    },
  ));
  const mediaDraft = await ctx.request(admin.actor, 'POST', '/admin/papers', {
    title: `C1 题图字段授权 ${suffix}`, mode: 'fixed', category_id: categoryId,
  });
  assert.equal(mediaDraft.status, 200, JSON.stringify(mediaDraft));
  const mediaPaperId = String(mediaDraft.data.id);
  const mediaQuestions = await ctx.request(admin.actor, 'PUT', `/admin/papers/${mediaPaperId}/questions`, {
    items: [
      { question_version_id: promptMediaQuestion.versionId, score_cents: 5000 },
      { question_version_id: rubricMediaQuestion.versionId, score_cents: 5000 },
    ],
  });
  assert.equal(mediaQuestions.status, 200, JSON.stringify(mediaQuestions));

  const paperReader = await createPermissionReader(ctx, admin, suffix, 'paper_reader', ['papers:read']);
  const noPaperReader = await createPermissionReader(ctx, admin, suffix, 'no_paper_reader', ['statistics:read']);
  const readerDraftPreview = await ctx.request(paperReader.actor, 'GET', `/admin/papers/${mediaPaperId}/preview`);
  assert.equal(readerDraftPreview.status, 200, JSON.stringify(readerDraftPreview));
  for (const field of ['stem', 'option']) {
    const content = await ctx.request(paperReader.actor, 'GET', `/media/${mediaIds[field]}/content`);
    assert.equal(content.status, 200, `papers:read draft ${field}: ${JSON.stringify(content.json)}`);
  }
  for (const field of ['analysis', 'rubric', 'unrelated']) {
    const content = await ctx.request(paperReader.actor, 'GET', `/media/${mediaIds[field]}/content`);
    assert.equal(content.status, 403, `papers:read must not read ${field}: ${JSON.stringify(content.json)}`);
  }
  const noPaperContent = await ctx.request(noPaperReader.actor, 'GET', `/media/${mediaIds.stem}/content`);
  assert.equal(noPaperContent.status, 403, `identity without papers:read loaded a paper image: ${JSON.stringify(noPaperContent.json)}`);

  const mediaPublished = await ctx.request(admin.actor, 'POST', `/admin/papers/${mediaPaperId}/publish`);
  assert.equal(mediaPublished.status, 200, JSON.stringify(mediaPublished));
  assert.match(mediaPublished.data.release_id, /^\d+$/);
  const releasePromptContent = await ctx.request(paperReader.actor, 'GET', `/media/${mediaIds.stem}/content`);
  assert.equal(releasePromptContent.status, 200, 'published release must retain prompt-image access');
  const revisedMediaQuestion = await ctx.request(admin.actor, 'PUT', `/ai/questions/${promptMediaQuestion.questionId}`, {
    expected_version_id: promptMediaQuestion.versionId,
    stem: `<p>发布后的新题干 ${suffix}</p>`,
  });
  assert.equal(revisedMediaQuestion.status, 200, JSON.stringify(revisedMediaQuestion));
  assert.equal(revisedMediaQuestion.data.status, 'pending');
  const historicalPromptContent = await ctx.request(paperReader.actor, 'GET', `/media/${mediaIds.stem}/content`);
  assert.equal(historicalPromptContent.status, 200, 'historical release must authorize its frozen version instead of current_version');

  const grantExport = await ctx.request(admin.actor, 'PUT', `/admin/roles/${paperReader.roleId}`, {
    permissions: ['papers:read', 'papers:export'],
  });
  assert.equal(grantExport.status, 200, JSON.stringify(grantExport));
  const revokedReader = await ctx.request(paperReader.actor, 'GET', `/media/${mediaIds.stem}/content`);
  assert.equal(revokedReader.status, 401, 'permission update must revoke the prior reader session');
  const paperExporter = await loginUser(ctx, paperReader.username, paperReader.password, 'paper_exporter');
  const exporterPreview = await ctx.request(paperExporter.actor, 'GET', `/admin/papers/${mediaPaperId}/preview/answers`);
  assert.equal(exporterPreview.status, 200, JSON.stringify(exporterPreview));
  for (const field of ['analysis', 'rubric']) {
    const content = await ctx.request(paperExporter.actor, 'GET', `/media/${mediaIds[field]}/content`);
    assert.equal(content.status, 200, `papers:export release ${field}: ${JSON.stringify(content.json)}`);
  }
  const exportedUnrelated = await ctx.request(paperExporter.actor, 'GET', `/media/${mediaIds.unrelated}/content`);
  assert.equal(exportedUnrelated.status, 403, 'papers:export must not open an unrelated question version');

  const fixedQuestions = [];
  for (const type of ['single', 'multiple', 'judgment', 'image']) {
    fixedQuestions.push(await createQuestion(
      ctx,
      admin.actor,
      questionDraft(categoryId, type, 'medium', `固定卷 ${type} ${suffix}`),
    ));
  }
  const easyManual = await createQuestion(ctx, admin.actor, questionDraft(categoryId, 'single', 'easy', `无制度初级 ${suffix}`));
  const hardManual = await createQuestion(ctx, admin.actor, questionDraft(categoryId, 'single', 'hard', `无制度高级 ${suffix}`));

  const fixed = await ctx.request(admin.actor, 'POST', '/admin/papers', {
    title: `C1 固定四题型 ${suffix}`, mode: 'fixed', category_id: categoryId,
    regulation_ids: [], course_ids: [], pass_score: 60, duration_minutes: 30, max_attempts: 3,
    partial_credit_ratio: 0.5,
  });
  assert.equal(fixed.status, 200, `fixed create: ${JSON.stringify(fixed)}`);
  assert.equal(fixed.data.requires_learning, false);
  assert.equal(typeof fixed.data.id, 'string');
  const fixedId = String(fixed.data.id);
  const savedFixed = await ctx.request(admin.actor, 'PUT', `/admin/papers/${fixedId}/questions`, {
    items: fixedQuestions.map((item) => ({ question_version_id: item.versionId, score_cents: 2500 })),
  });
  assert.equal(savedFixed.status, 200, `fixed set: ${JSON.stringify(savedFixed)}`);
  assert.equal(savedFixed.data.sum_score_cents, 10000);
  assert.deepEqual(new Set(savedFixed.data.questions.map((item) => item.question_version_id)).size, 4);

  const fixedPublished = await ctx.request(admin.actor, 'POST', `/admin/papers/${fixedId}/publish`);
  assert.equal(fixedPublished.status, 200, `fixed publish: ${JSON.stringify(fixedPublished)}`);
  assert.match(fixedPublished.data.release_id, /^\d+$/);
  const fixedPreview = await ctx.request(admin.actor, 'GET', `/admin/papers/${fixedId}/preview`);
  assert.equal(fixedPreview.status, 200, `fixed preview: ${JSON.stringify(fixedPreview)}`);
  assert.equal(fixedPreview.data.sample_kind, 'fixed_paper');
  assert.deepEqual(Object.keys(fixedPreview.data.rule).sort(), [
    'duration_minutes', 'max_attempts', 'partial_credit_ratio', 'pass_cents', 'rules', 'total_cents',
  ]);
  assert.equal(fixedPreview.data.rule.total_cents, 10000);
  assert.equal(fixedPreview.data.rule.rules.every((item) => Object.hasOwn(item, 'score_cents')), true);
  assert.equal(fixedPreview.data.questions.length, 4);
  assert.equal(fixedPreview.data.questions.reduce((sum, item) => sum + item.score, 0), 100);
  for (const question of fixedPreview.data.questions) {
    assert.equal(Object.hasOwn(question, 'answer'), false, 'ordinary preview must not expose answers');
    assert.equal(Object.hasOwn(question, 'analysis'), false, 'ordinary preview must not expose analysis');
    assert.equal(Object.hasOwn(question, 'rubric'), false, 'ordinary preview must not expose rubric');
  }
  const answerPreview = await ctx.request(admin.actor, 'GET', `/admin/papers/${fixedId}/preview/answers`);
  assert.equal(answerPreview.status, 200, `answer preview: ${JSON.stringify(answerPreview)}`);
  assert.equal(Object.hasOwn(answerPreview.data.questions[0], 'answer'), true);

  const originalStem = fixedPreview.data.questions.find((item) => item.question_id === fixedQuestions[0].questionId).stem;
  const revised = await ctx.request(admin.actor, 'PUT', `/ai/questions/${fixedQuestions[0].questionId}`, {
    expected_version_id: fixedQuestions[0].versionId,
    stem: `<p>发布后修订 ${suffix}</p>`,
  });
  assert.equal(revised.status, 200, JSON.stringify(revised));
  assert.equal(revised.data.status, 'pending');
  const frozenPreview = await ctx.request(admin.actor, 'GET', `/admin/papers/${fixedId}/preview`);
  assert.equal(frozenPreview.status, 200);
  assert.equal(
    frozenPreview.data.questions.find((item) => item.question_id === fixedQuestions[0].questionId).stem,
    originalStem,
    'published preview must use the frozen version',
  );
  const immutableUpdate = await ctx.request(admin.actor, 'PUT', `/admin/papers/${fixedId}`, { title: '禁止改写' });
  assert.equal(immutableUpdate.status, 409);
  assert.equal(immutableUpdate.code, 40970);

  const weightedQuestions = [];
  stage = 'same-type weighted fixed paper';
  for (const label of ['三十分考点', '七十分考点']) {
    const concept = await ctx.request(admin.actor, 'POST', '/ai/question-concepts', {
      category_id: categoryId, type: 'single', name: `${label} ${suffix}`,
    });
    assert.equal(concept.status, 200, JSON.stringify(concept));
    weightedQuestions.push(await createQuestion(
      ctx,
      admin.actor,
      questionDraft(categoryId, 'single', 'medium', `${label}题目 ${suffix}`, { concept_id: String(concept.data.id) }),
    ));
  }
  const weightedFixed = await ctx.request(admin.actor, 'POST', '/admin/papers', {
    title: `C1 同题型不同分值 ${suffix}`, mode: 'fixed', category_id: categoryId,
  });
  assert.equal(weightedFixed.status, 200, JSON.stringify(weightedFixed));
  const weightedFixedId = String(weightedFixed.data.id);
  const weightedSet = await ctx.request(admin.actor, 'PUT', `/admin/papers/${weightedFixedId}/questions`, {
    items: [
      { question_version_id: weightedQuestions[0].versionId, score_cents: 3000 },
      { question_version_id: weightedQuestions[1].versionId, score_cents: 7000 },
    ],
  });
  assert.equal(weightedSet.status, 200, `weighted fixed set: ${JSON.stringify(weightedSet)}`);
  const weightedPublished = await ctx.request(admin.actor, 'POST', `/admin/papers/${weightedFixedId}/publish`);
  assert.equal(weightedPublished.status, 200, `weighted fixed publish: ${JSON.stringify(weightedPublished)}`);
  const weightedRows = await ctx.queryTestDb(
    'SELECT score_cents, snapshot_json FROM paper_release_question WHERE release_id = ? ORDER BY position',
    [weightedPublished.data.release_id],
  );
  assert.deepEqual(weightedRows.map((row) => Number(row.score_cents)), [3000, 7000]);
  assert.deepEqual(weightedRows.map((row) => {
    const snapshot = typeof row.snapshot_json === 'string' ? JSON.parse(row.snapshot_json) : row.snapshot_json;
    return Number(snapshot.scoreCents);
  }), [3000, 7000], 'immutable snapshots use actual paper scores rather than question-bank suggestions');
  const weightedPreview = await ctx.request(admin.actor, 'GET', `/admin/papers/${weightedFixedId}/preview`);
  assert.equal(weightedPreview.status, 200, JSON.stringify(weightedPreview));
  assert.deepEqual(weightedPreview.data.questions.map((item) => item.score), [30, 70]);
  assert.deepEqual(weightedPreview.data.rule.rules.map((item) => [item.type, item.score_cents]), [
    ['single', 3000], ['single', 7000],
  ]);

  const bandScores = [1000, 1500, 2000, 2500, 3000];
  stage = 'five-band fixed paper';
  const bandQuestions = [];
  for (const [index, score] of bandScores.entries()) {
    const bandConcept = await ctx.request(admin.actor, 'POST', '/ai/question-concepts', {
      category_id: categoryId, type: 'single', name: `五档考点 ${index + 1}-${score} ${suffix}`,
    });
    assert.equal(bandConcept.status, 200, JSON.stringify(bandConcept));
    bandQuestions.push(await createQuestion(
      ctx,
      admin.actor,
      questionDraft(categoryId, 'single', 'medium', `五档题目 ${index + 1} ${suffix}`, { concept_id: String(bandConcept.data.id) }),
    ));
  }
  const fiveBands = await ctx.request(admin.actor, 'POST', '/admin/papers', {
    title: `C1 固定五档分值 ${suffix}`, mode: 'fixed', category_id: categoryId,
  });
  assert.equal(fiveBands.status, 200, JSON.stringify(fiveBands));
  const fiveBandId = String(fiveBands.data.id);
  const fiveBandSet = await ctx.request(admin.actor, 'PUT', `/admin/papers/${fiveBandId}/questions`, {
    items: bandQuestions.map((item, index) => ({ question_version_id: item.versionId, score_cents: bandScores[index] })),
  });
  assert.equal(fiveBandSet.status, 200, `five-band fixed set: ${JSON.stringify(fiveBandSet)}`);
  assert.equal(fiveBandSet.data.rules.length, 5, 'fixed papers may derive more than four score bands');
  const fiveBandUpdate = await ctx.request(admin.actor, 'PUT', `/admin/papers/${fiveBandId}`, {
    rules: bandScores.map((score_cents) => ({ type: 'single', count: 1, score_cents })),
  });
  assert.equal(fiveBandUpdate.status, 200, `five-band fixed update: ${JSON.stringify(fiveBandUpdate)}`);
  assert.equal(fiveBandUpdate.data.rules.length, 5);
  const fiveBandPublished = await ctx.request(admin.actor, 'POST', `/admin/papers/${fiveBandId}/publish`);
  assert.equal(fiveBandPublished.status, 200, `five-band fixed publish: ${JSON.stringify(fiveBandPublished)}`);
  const fiveBandRows = await ctx.queryTestDb(
    'SELECT score_cents, snapshot_json FROM paper_release_question WHERE release_id = ? ORDER BY position',
    [fiveBandPublished.data.release_id],
  );
  assert.deepEqual(fiveBandRows.map((row) => Number(row.score_cents)), bandScores);
  assert.deepEqual(fiveBandRows.map((row) => {
    const snapshot = typeof row.snapshot_json === 'string' ? JSON.parse(row.snapshot_json) : row.snapshot_json;
    return Number(snapshot.scoreCents);
  }), bandScores);

  const randomFiveRules = await ctx.request(admin.actor, 'POST', '/admin/papers', {
    title: `C1 随机五规则非法 ${suffix}`, mode: 'random', category_id: categoryId,
    rules: bandScores.map((score_cents) => ({ type: 'single', count: 1, score_cents })),
  });
  assert.equal(randomFiveRules.status, 409);
  assert.equal(randomFiveRules.code, 40972, 'random papers retain the unique-type/four-rule boundary');

  stage = 'random paper and preview';
  const random = await ctx.request(admin.actor, 'POST', '/admin/papers', {
    title: `C1 随机双难度 ${suffix}`, mode: 'random', category_id: categoryId,
    regulation_ids: [], course_ids: [], rules: [{ type: 'single', count: 1, score_cents: 10000 }],
  });
  assert.equal(random.status, 200, `random create: ${JSON.stringify(random)}`);
  const randomId = String(random.data.id);
  const randomPublished = await ctx.request(admin.actor, 'POST', `/admin/papers/${randomId}/publish`);
  assert.equal(randomPublished.status, 200, `random publish: ${JSON.stringify(randomPublished)}`);
  const releasedRows = await ctx.queryTestDb(
    'SELECT question_id, difficulty, snapshot_json FROM paper_release_question WHERE release_id = ? ORDER BY difficulty, question_id',
    [randomPublished.data.release_id],
  );
  assert.ok(releasedRows.some((row) => String(row.question_id) === easyManual.questionId && row.difficulty === 'easy'));
  assert.ok(releasedRows.some((row) => String(row.question_id) === hardManual.questionId && row.difficulty === 'hard'));
  const randomPreview = await ctx.request(admin.actor, 'GET', `/admin/papers/${randomId}/preview?difficulty=easy`);
  assert.equal(randomPreview.status, 200, JSON.stringify(randomPreview));
  assert.equal(randomPreview.data.sample_kind, 'random_example');
  assert.match(randomPreview.data.note, /样例|不代表/);
  assert.equal(randomPreview.data.questions.length, 1);
  assert.ok(randomPreview.data.capacities.some((item) => item.difficulty === 'easy' && item.available >= 1));
  const legacyStartGuard = await ctx.request(admin.actor, 'POST', `/exams/papers/${randomId}/start`);
  assert.equal(legacyStartGuard.status, 404, 'C1 must not pass training releases through the legacy exam start path');
  assert.equal(legacyStartGuard.code, 40402);

  const concurrentDrafts = [];
  stage = 'single-connection concurrent publication';
  for (const label of ['A', 'B']) {
    const draft = await ctx.request(admin.actor, 'POST', '/admin/papers', {
      title: `C1 单连接并发 ${label} ${suffix}`, mode: 'random', category_id: categoryId,
      rules: [{ type: 'single', count: 1, score_cents: 10000 }],
    });
    assert.equal(draft.status, 200, JSON.stringify(draft));
    concurrentDrafts.push(String(draft.data.id));
  }
  const poolEvidence = await provePaperReleaseSingleConnectionPools(ctx, concurrentDrafts, admin.id);
  assert.equal(poolEvidence.connection_ids.length, 2);
  assert.equal(poolEvidence.release_ids.length, 2);
  const concurrentRows = await ctx.queryTestDb(
    'SELECT paper_id, COUNT(*) AS release_count FROM paper_release WHERE paper_id IN (?, ?) GROUP BY paper_id ORDER BY paper_id',
    concurrentDrafts,
  );
  assert.equal(concurrentRows.length, 2);
  assert.equal(concurrentRows.every((row) => Number(row.release_count) === 1), true);

  stage = 'real category-change stale-read conflicts';
  const categoryRaceQuestion = await ctx.request(admin.actor, 'GET', `/ai/questions/${fixedQuestions[1].questionId}`);
  assert.equal(categoryRaceQuestion.status, 200, JSON.stringify(categoryRaceQuestion));
  assert.equal(categoryRaceQuestion.data.status, 'approved');
  assert.equal(String(categoryRaceQuestion.data.current_version_id), fixedQuestions[1].versionId);
  const categoryBId = await createCategory(ctx, admin.actor, `C1 并发类别 B ${suffix}`);
  const categoryRacePapers = {};
  for (const [key, label] of [['update', '更新'], ['questions', '题单'], ['copy', '复制']]) {
    const draft = await ctx.request(admin.actor, 'POST', '/admin/papers', {
      title: `C1 类别并发${label} ${suffix}`, mode: 'fixed', category_id: categoryId,
    });
    assert.equal(draft.status, 200, JSON.stringify(draft));
    categoryRacePapers[key] = String(draft.data.id);
    const selected = await ctx.request(admin.actor, 'PUT', `/admin/papers/${draft.data.id}/questions`, {
      items: [{ question_version_id: fixedQuestions[1].versionId, score_cents: 10000 }],
    });
    assert.equal(selected.status, 200, JSON.stringify(selected));
    assert.equal(selected.data.questions.length, 1);
  }
  const categoryRaceEvidence = await proveTrainingCategoryChangeConflicts(ctx, {
    categoryAId: categoryId,
    categoryBId,
    questionVersionId: fixedQuestions[1].versionId,
    papers: categoryRacePapers,
  }, admin.id);
  assert.equal(new Set(categoryRaceEvidence.connection_ids).size, 2);
  assert.deepEqual(categoryRaceEvidence.scenarios.map((item) => item.name), [
    'updateTraining', 'setTrainingQuestions', 'copyTraining',
  ]);
  for (const item of categoryRaceEvidence.scenarios) {
    assert.equal(item.conflict_code, 40970);
    assert.equal(item.before.category_id, categoryId);
    assert.equal(item.before.question_count, 1);
    assert.equal(item.after_switch.category_id, categoryBId);
    assert.equal(item.after_switch.question_count, 0);
    assert.deepEqual(item.after_stale, item.after_switch);
  }

  stage = 'release-backed legacy regulation paper';
  const regulationInsert = await ctx.queryTestDb(
    'INSERT INTO regulation (title, category, category_id, description, status, current_version_id, required_minutes, scroll_segments, created_by) VALUES (?, ?, ?, NULL, ?, NULL, 10, 10, ?)',
    [`C1 筛选制度 ${suffix}`, 'C1旧分类', categoryId, 'draft', admin.id],
  );
  const regulationId = String(regulationInsert.insertId);

  stage = 'regulation duplicate-concept rollback and no-concept control';
  const regulationConcept = await ctx.request(admin.actor, 'POST', '/ai/question-concepts', {
    category_id: categoryId,
    type: 'single',
    name: `制度重复考点 ${suffix}`,
  });
  assert.equal(regulationConcept.status, 200, JSON.stringify(regulationConcept));
  const duplicateConceptQuestionIds = [];
  for (const label of ['变体一', '变体二']) {
    duplicateConceptQuestionIds.push(await insertLegacyRegulationQuestion(ctx, {
      regulationId,
      categoryId,
      conceptId: String(regulationConcept.data.id),
      stem: `${label} ${suffix}`,
      createdBy: admin.id,
    }));
  }
  const duplicateConceptPaper = await ctx.request(admin.actor, 'POST', '/ai/papers', {
    regulation_id: regulationId,
    title: `C1 制度重复考点 ${suffix}`,
  });
  assert.equal(duplicateConceptPaper.status, 200, JSON.stringify(duplicateConceptPaper));
  const duplicateConceptPaperId = String(duplicateConceptPaper.data.id);
  const duplicateConceptSet = await ctx.request(admin.actor, 'PUT', `/ai/papers/${duplicateConceptPaperId}/questions`, {
    items: duplicateConceptQuestionIds.map((questionId) => ({ question_id: Number(questionId), score: 50 })),
  });
  assert.equal(duplicateConceptSet.status, 200, JSON.stringify(duplicateConceptSet));
  const duplicateConceptPublish = await ctx.request(admin.actor, 'POST', `/ai/papers/${duplicateConceptPaperId}/publish`);
  assert.equal(duplicateConceptPublish.status, 409, JSON.stringify(duplicateConceptPublish));
  assert.equal(duplicateConceptPublish.code, 40972);
  assert.match(duplicateConceptPublish.json?.message, /重复考点/);
  const [duplicatePaperState] = await ctx.queryTestDb(
    'SELECT status FROM exam_paper WHERE id = ?',
    [duplicateConceptPaperId],
  );
  const [duplicateReleaseCount] = await ctx.queryTestDb(
    'SELECT COUNT(*) AS count FROM paper_release WHERE paper_id = ?',
    [duplicateConceptPaperId],
  );
  const duplicateQuestionsAfter = await ctx.queryTestDb(
    'SELECT id, current_version_id FROM question WHERE id IN (?, ?) ORDER BY id',
    duplicateConceptQuestionIds,
  );
  const duplicateLinksAfter = await ctx.queryTestDb(
    'SELECT question_version_id FROM paper_question WHERE paper_id = ? ORDER BY sort',
    [duplicateConceptPaperId],
  );
  const [duplicateCapturedCount] = await ctx.queryTestDb(
    'SELECT COUNT(*) AS count FROM question_version WHERE question_id IN (?, ?)',
    duplicateConceptQuestionIds,
  );
  assert.equal(duplicatePaperState.status, 'draft');
  assert.equal(Number(duplicateReleaseCount.count), 0);
  assert.equal(duplicateQuestionsAfter.every((row) => row.current_version_id === null), true);
  assert.equal(duplicateLinksAfter.every((row) => row.question_version_id === null), true);
  assert.equal(Number(duplicateCapturedCount.count), 0, 'duplicate-concept rollback must remove captured legacy versions');

  const noConceptQuestionIds = [];
  for (const label of ['独立旧题一', '独立旧题二']) {
    noConceptQuestionIds.push(await insertLegacyRegulationQuestion(ctx, {
      regulationId,
      categoryId,
      conceptId: null,
      stem: `${label} ${suffix}`,
      createdBy: admin.id,
    }));
  }
  const noConceptPaper = await ctx.request(admin.actor, 'POST', '/ai/papers', {
    regulation_id: regulationId,
    title: `C1 制度无考点对照 ${suffix}`,
  });
  assert.equal(noConceptPaper.status, 200, JSON.stringify(noConceptPaper));
  const noConceptPaperId = String(noConceptPaper.data.id);
  const noConceptSet = await ctx.request(admin.actor, 'PUT', `/ai/papers/${noConceptPaperId}/questions`, {
    items: noConceptQuestionIds.map((questionId) => ({ question_id: Number(questionId), score: 50 })),
  });
  assert.equal(noConceptSet.status, 200, JSON.stringify(noConceptSet));
  const noConceptPublished = await ctx.request(admin.actor, 'POST', `/ai/papers/${noConceptPaperId}/publish`);
  assert.equal(noConceptPublished.status, 200, JSON.stringify(noConceptPublished));
  const noConceptReleaseRows = await ctx.queryTestDb(
    'SELECT question_id, concept_id FROM paper_release_question WHERE release_id = ? ORDER BY position',
    [String(noConceptPublished.data.release_id)],
  );
  assert.deepEqual(noConceptReleaseRows.map((row) => String(row.question_id)), noConceptQuestionIds);
  assert.equal(noConceptReleaseRows.every((row) => row.concept_id === null), true, 'no-concept legacy questions must retain real null concepts');

  const legacyQuestionInsert = await ctx.queryTestDb(
    'INSERT INTO question (regulation_id, version_id, category_id, difficulty, concept_id, current_version_id, type, stem, options, answer, analysis, rubric, score, status, source, created_by) VALUES (?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)',
    [regulationId, 'single', `<p>制度发布前题干 ${suffix}</p>`, JSON.stringify([{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }]),
      JSON.stringify([0]), '旧题解析', '33.00', 'approved', 'manual', admin.id],
  );
  const legacyQuestionId = String(legacyQuestionInsert.insertId);
  const legacyPaper = await ctx.request(admin.actor, 'POST', '/ai/papers', {
    regulation_id: regulationId, title: `C1 legacy frozen ${suffix}`,
    pass_score: 60, duration_minutes: 30, max_attempts: 3, partial_credit_ratio: 0.5,
  });
  assert.equal(legacyPaper.status, 200, JSON.stringify(legacyPaper));
  assert.equal(typeof legacyPaper.data.id, 'number', 'legacy /ai/papers keeps numeric ids');
  assert.equal(legacyPaper.data.release_id, null);
  assert.equal(legacyPaper.data.rules_locked, false);
  const legacyPaperId = String(legacyPaper.data.id);
  const legacySet = await ctx.request(admin.actor, 'PUT', `/ai/papers/${legacyPaperId}/questions`, {
    items: [{ question_id: Number(legacyQuestionId), score: 100 }],
  });
  assert.equal(legacySet.status, 200, JSON.stringify(legacySet));
  const legacyPublished = await ctx.request(admin.actor, 'POST', `/ai/papers/${legacyPaperId}/publish`);
  assert.equal(legacyPublished.status, 200, `legacy publish: ${JSON.stringify(legacyPublished)}`);
  assert.equal(typeof legacyPublished.data.id, 'number');
  assert.match(legacyPublished.data.release_id, /^\d+$/);
  assert.equal(legacyPublished.data.rules_locked, true);
  const legacyReleaseId = String(legacyPublished.data.release_id);
  const [legacyReleaseRow] = await ctx.queryTestDb(
    'SELECT pr.business_scope, pr.category_id, pr.requires_learning, prq.question_version_id, prq.difficulty, prq.score_cents, prq.snapshot_json FROM paper_release pr JOIN paper_release_question prq ON prq.release_id = pr.id WHERE pr.id = ?',
    [legacyReleaseId],
  );
  const legacySnapshot = typeof legacyReleaseRow.snapshot_json === 'string'
    ? JSON.parse(legacyReleaseRow.snapshot_json) : legacyReleaseRow.snapshot_json;
  assert.equal(legacyReleaseRow.business_scope, 'regulation');
  assert.equal(legacyReleaseRow.category_id, null);
  assert.equal(Number(legacyReleaseRow.requires_learning), 1);
  assert.match(String(legacyReleaseRow.question_version_id), /^\d+$/);
  assert.notEqual(String(legacyReleaseRow.question_version_id), '0');
  assert.equal(legacyReleaseRow.difficulty, 'unknown');
  assert.equal(Number(legacyReleaseRow.score_cents), 10000);
  assert.equal(legacySnapshot.categoryId, null);
  assert.equal(legacySnapshot.difficulty, 'unknown');
  assert.equal(legacySnapshot.approvedBy, null);
  assert.equal(legacySnapshot.approvedAt, null);
  assert.equal(legacySnapshot.stem, `<p>制度发布前题干 ${suffix}</p>`);

  const legacyDetail = await ctx.request(admin.actor, 'GET', `/ai/papers/${legacyPaperId}`);
  assert.equal(legacyDetail.status, 200, JSON.stringify(legacyDetail));
  assert.equal(legacyDetail.data.release_id, legacyReleaseId);
  assert.equal(legacyDetail.data.rules_locked, true);
  assert.equal(legacyDetail.data.questions[0].score, 100);
  assert.equal(legacyDetail.data.questions[0].stem, `<p>制度发布前题干 ${suffix}</p>`);
  const nextVersionInsert = await ctx.queryTestDb(
    'INSERT INTO question_version (question_id, revision, category_id, difficulty, type, stem, options, answer, analysis, rubric, score_cents, concept_id, regulation_id, regulation_version_id, source_page_group, source_page_start, source_page_end, source, status, approved_by, approved_at, reviewed_by, reviewed_at, review_reason, created_by, legacy_captured_at) SELECT question_id, 2, category_id, difficulty, type, ?, options, answer, analysis, rubric, score_cents, concept_id, regulation_id, regulation_version_id, source_page_group, source_page_start, source_page_end, source, status, approved_by, approved_at, reviewed_by, reviewed_at, review_reason, created_by, NOW(3) FROM question_version WHERE id = ?',
    [`<p>制度发布后修订 ${suffix}</p>`, String(legacyReleaseRow.question_version_id)],
  );
  const nextVersionId = String(nextVersionInsert.insertId);
  await ctx.queryTestDb(
    'UPDATE question SET current_version_id = ?, stem = ?, score = ? WHERE id = ?',
    [nextVersionId, `<p>制度发布后修订 ${suffix}</p>`, '33.00', legacyQuestionId],
  );
  await ctx.queryTestDb(
    'UPDATE exam_paper SET pass_score = ?, duration_minutes = ?, max_attempts = ?, partial_credit_ratio = ? WHERE id = ?',
    ['55.00', 15, 1, '0.10', legacyPaperId],
  );
  const frozenLegacyDetail = await ctx.request(admin.actor, 'GET', `/ai/papers/${legacyPaperId}`);
  assert.equal(frozenLegacyDetail.status, 200, JSON.stringify(frozenLegacyDetail));
  assert.equal(frozenLegacyDetail.data.questions[0].stem, `<p>制度发布前题干 ${suffix}</p>`);
  assert.equal(frozenLegacyDetail.data.questions[0].score, 100);
  assert.equal(frozenLegacyDetail.data.pass_score, 60);
  assert.equal(frozenLegacyDetail.data.duration_minutes, 30);
  assert.equal(frozenLegacyDetail.data.max_attempts, 3);
  assert.equal(frozenLegacyDetail.data.partial_credit_ratio, 0.5);
  const frozenStrategyUpdate = await ctx.request(admin.actor, 'PUT', `/ai/papers/${legacyPaperId}`, { pass_score: 70 });
  assert.equal(frozenStrategyUpdate.status, 409);
  assert.equal(frozenStrategyUpdate.code, 40970);

  const copyUnknownBody = await ctx.request(admin.actor, 'POST', `/ai/papers/${legacyPaperId}/copy`, { unexpected: true });
  assert.equal(copyUnknownBody.status, 400);
  assert.equal(copyUnknownBody.code, 40001);
  const legacyCopy = await ctx.request(admin.actor, 'POST', `/ai/papers/${legacyPaperId}/copy`, {});
  assert.equal(legacyCopy.status, 200, `legacy copy: ${JSON.stringify(legacyCopy)}`);
  assert.equal(typeof legacyCopy.data.id, 'number');
  assert.equal(legacyCopy.data.status, 'draft');
  assert.equal(legacyCopy.data.release_id, null);
  assert.equal(legacyCopy.data.rules_locked, false);
  const legacyCopyId = String(legacyCopy.data.id);
  const copyRows = await ctx.queryTestDb(
    'SELECT question_version_id, score FROM paper_question WHERE paper_id = ? ORDER BY sort',
    [legacyCopyId],
  );
  assert.deepEqual(copyRows.map((row) => [String(row.question_version_id), Number(row.score)]), [
    [String(legacyReleaseRow.question_version_id), 100],
  ]);
  const editableCopy = await ctx.request(admin.actor, 'PUT', `/ai/papers/${legacyCopyId}`, { pass_score: 70 });
  assert.equal(editableCopy.status, 200, JSON.stringify(editableCopy));
  assert.equal(editableCopy.data.pass_score, 70);
  const staleCopyPublish = await ctx.request(admin.actor, 'POST', `/ai/papers/${legacyCopyId}/publish`);
  assert.equal(staleCopyPublish.status, 409);
  assert.equal(staleCopyPublish.code, 40970);
  assert.match(staleCopyPublish.json?.message, /重新选题/);
  const reselectedCopy = await ctx.request(admin.actor, 'PUT', `/ai/papers/${legacyCopyId}/questions`, {
    items: [{ question_id: Number(legacyQuestionId), score: 100 }],
  });
  assert.equal(reselectedCopy.status, 200, JSON.stringify(reselectedCopy));
  const republishedCopy = await ctx.request(admin.actor, 'POST', `/ai/papers/${legacyCopyId}/publish`);
  assert.equal(republishedCopy.status, 200, JSON.stringify(republishedCopy));
  assert.notEqual(republishedCopy.data.release_id, legacyReleaseId);
  const sourceReleaseCount = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM paper_release WHERE paper_id = ?', [legacyPaperId]);
  assert.equal(Number(sourceReleaseCount[0].count), 1, 'copy and republish must not mutate the source release');

  const preupgradeInsert = await ctx.queryTestDb(
    'INSERT INTO exam_paper (regulation_id, business_scope, mode, category_id, requires_learning, regulation_ids, course_ids, rule_config, title, total_score, pass_score, duration_minutes, max_attempts, partial_credit_ratio, status, created_by) VALUES (?, ?, ?, NULL, 1, ?, ?, NULL, ?, 100.00, 60.00, 30, 3, 0.50, ?, ?)',
    [regulationId, 'regulation', 'fixed', JSON.stringify([regulationId]), JSON.stringify([]), `C1 preupgrade ${suffix}`, 'published', admin.id],
  );
  const preupgradeId = String(preupgradeInsert.insertId);
  const preupgradeDetail = await ctx.request(admin.actor, 'GET', `/ai/papers/${preupgradeId}`);
  assert.equal(preupgradeDetail.status, 200, JSON.stringify(preupgradeDetail));
  assert.equal(preupgradeDetail.data.release_id, null);
  assert.equal(preupgradeDetail.data.rules_locked, false);
  const preupgradeUpdate = await ctx.request(admin.actor, 'PUT', `/ai/papers/${preupgradeId}`, { pass_score: 65 });
  assert.equal(preupgradeUpdate.status, 200, JSON.stringify(preupgradeUpdate));
  assert.equal(preupgradeUpdate.data.pass_score, 65);
  const preupgradePublish = await ctx.request(admin.actor, 'POST', `/ai/papers/${preupgradeId}/publish`);
  assert.equal(preupgradePublish.status, 200, JSON.stringify(preupgradePublish));
  assert.equal(preupgradePublish.data.release_id, null);
  assert.equal(preupgradePublish.data.rules_locked, false);
  const preupgradeReleases = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM paper_release WHERE paper_id = ?', [preupgradeId]);
  assert.equal(Number(preupgradeReleases[0].count), 0, 'pre-upgrade published papers must not receive fabricated history');

  stage = 'filtered and capacity failures';
  const filtered = await ctx.request(admin.actor, 'POST', '/admin/papers', {
    title: `C1 有制度筛选 ${suffix}`, mode: 'random', category_id: categoryId,
    regulation_ids: [regulationId], course_ids: [],
    rules: [{ type: 'single', count: 1, score_cents: 10000 }],
  });
  assert.equal(filtered.status, 200, JSON.stringify(filtered));
  const filteredPublish = await ctx.request(admin.actor, 'POST', `/admin/papers/${filtered.data.id}/publish`);
  assert.equal(filteredPublish.status, 409, 'manual questions without a regulation must be excluded by a non-empty filter');
  assert.equal(filteredPublish.code, 40971);

  const capacityCategory = await createCategory(ctx, admin.actor, `C1 考点容量 ${suffix}`);
  const concept = await ctx.request(admin.actor, 'POST', '/ai/question-concepts', {
    category_id: capacityCategory, type: 'single', name: `同一考点 ${suffix}`,
  });
  assert.equal(concept.status, 200, JSON.stringify(concept));
  await createQuestion(ctx, admin.actor, questionDraft(capacityCategory, 'single', 'easy', `变体一 ${suffix}`, { concept_id: String(concept.data.id) }));
  await createQuestion(ctx, admin.actor, questionDraft(capacityCategory, 'single', 'easy', `变体二 ${suffix}`, { concept_id: String(concept.data.id) }));
  const deficit = await ctx.request(admin.actor, 'POST', '/admin/papers', {
    title: `C1 考点不足 ${suffix}`, mode: 'random', category_id: capacityCategory,
    rules: [{ type: 'single', count: 2, score_cents: 5000 }],
  });
  assert.equal(deficit.status, 200, JSON.stringify(deficit));
  const deficitPublish = await ctx.request(admin.actor, 'POST', `/admin/papers/${deficit.data.id}/publish`);
  assert.equal(deficitPublish.status, 409);
  assert.equal(deficitPublish.code, 40971);
  assert.match(JSON.stringify(deficitPublish.data), /"available":1/);

  stage = 'training copy transitions and lists';
  const copied = await ctx.request(admin.actor, 'POST', `/admin/papers/${fixedId}/copy`);
  assert.equal(copied.status, 200, JSON.stringify(copied));
  assert.equal(copied.data.status, 'draft');
  assert.equal(copied.data.mode, 'fixed');
  const withdrawn = await ctx.request(admin.actor, 'POST', `/admin/papers/${randomId}/withdraw`);
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn));
  assert.equal(withdrawn.data.status, 'withdrawn');
  const previewAfterWithdraw = await ctx.request(admin.actor, 'GET', `/admin/papers/${randomId}/preview?difficulty=hard`);
  assert.equal(previewAfterWithdraw.status, 200, 'withdrawal must preserve the immutable release for history/active attempts');
  const archived = await ctx.request(admin.actor, 'POST', `/admin/papers/${randomId}/archive`);
  assert.equal(archived.status, 200);
  assert.equal(archived.data.status, 'archived');

  const trainingList = await ctx.request(admin.actor, 'GET', `/admin/papers?page=1&page_size=100&category_id=${categoryId}`);
  assert.equal(trainingList.status, 200, JSON.stringify(trainingList));
  assert.ok(trainingList.data.items.some((item) => item.id === fixedId));
  assert.equal(typeof trainingList.data.items[0].id, 'string');
  assert.deepEqual(Object.keys(trainingList.data).sort(), ['items', 'page', 'page_size', 'total']);
  const categoryDelete = await ctx.request(admin.actor, 'DELETE', `/admin/training-categories/${categoryId}`);
  assert.equal(categoryDelete.status, 409);
  assert.equal(categoryDelete.code, 40910);

  const legacyList = await ctx.request(admin.actor, 'GET', '/ai/papers?page=1&page_size=100');
  assert.equal(legacyList.status, 200);
  assert.ok(Array.isArray(legacyList.data.list));
  assert.ok(legacyList.data.list.some((item) => String(item.id) === legacyPaperId
    && item.release_id === legacyReleaseId && item.rules_locked === true));
  assert.ok(legacyList.data.list.some((item) => String(item.id) === preupgradeId
    && item.release_id === null && item.rules_locked === false));
  assert.equal(Object.hasOwn(legacyList.data, 'items'), false, 'legacy list shape must not change');
  const trainingThroughLegacy = await ctx.request(admin.actor, 'GET', `/ai/papers/${fixedId}`);
  assert.equal(trainingThroughLegacy.status, 404, 'release-backed training papers stay outside the legacy write surface');
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    throw new Error(`training-publishing stage=${stage}\n${detail}`);
  }
}

export async function run(ctx) {
  await runPublishing(ctx);
}
