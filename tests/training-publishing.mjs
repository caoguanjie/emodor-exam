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

async function runPublishing(ctx) {
  const admin = await adminLogin(ctx);
  const suffix = randomBytes(4).toString('hex');
  const categoryId = await createCategory(ctx, admin.actor, `C1 发布类别 ${suffix}`);

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

  const regulationInsert = await ctx.queryTestDb(
    'INSERT INTO regulation (title, category, category_id, description, status, current_version_id, required_minutes, scroll_segments, created_by) VALUES (?, ?, ?, NULL, ?, NULL, 10, 10, ?)',
    [`C1 筛选制度 ${suffix}`, 'C1旧分类', categoryId, 'draft', admin.id],
  );
  const filtered = await ctx.request(admin.actor, 'POST', '/admin/papers', {
    title: `C1 有制度筛选 ${suffix}`, mode: 'random', category_id: categoryId,
    regulation_ids: [String(regulationInsert.insertId)], course_ids: [],
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

  const legacyPaper = await ctx.request(admin.actor, 'POST', '/ai/papers', {
    regulation_id: String(regulationInsert.insertId), title: `C1 legacy contract ${suffix}`,
  });
  assert.equal(legacyPaper.status, 200, JSON.stringify(legacyPaper));
  assert.equal(typeof legacyPaper.data.id, 'number', 'legacy /ai/papers keeps numeric ids');
  const legacyList = await ctx.request(admin.actor, 'GET', '/ai/papers?page=1&page_size=100');
  assert.equal(legacyList.status, 200);
  assert.ok(Array.isArray(legacyList.data.list));
  assert.equal(Object.hasOwn(legacyList.data, 'items'), false, 'legacy list shape must not change');
  const trainingThroughLegacy = await ctx.request(admin.actor, 'GET', `/ai/papers/${fixedId}`);
  assert.equal(trainingThroughLegacy.status, 404, 'release-backed training papers stay outside the legacy write surface');
}

export async function run(ctx) {
  await runPublishing(ctx);
}
