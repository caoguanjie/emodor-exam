import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const bcrypt = require('bcryptjs');
const Redis = require('ioredis');

function suffix() { return randomBytes(5).toString('hex'); }
function password(label) { return `A9-${label}-${randomBytes(8).toString('hex')}`; }
function pngFixture() { return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'); }

async function redisFor(ctx) {
  const redis = new Redis({
    host: ctx.env.REDIS_HOST || '127.0.0.1',
    port: Number(ctx.env.REDIS_PORT || 6379),
    password: ctx.env.REDIS_PASSWORD || undefined,
  });
  await redis.ping();
  return redis;
}

async function login(ctx, username, userPassword, label) {
  const headers = { 'X-Forwarded-For': `198.51.100.${(login.sequence = (login.sequence || 30) + 1)}` };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert.equal(captcha.status, 200, `${label} captcha: ${JSON.stringify(captcha)}`);
  const redis = await redisFor(ctx);
  let answer;
  try { answer = await redis.get(`${ctx.env.REDIS_KEY_PREFIX || ''}auth:captcha:${captcha.data.captcha_id}`); }
  finally { await redis.quit(); }
  const actor = {};
  const response = await ctx.request(actor, 'POST', '/auth/login', {
    username, password: userPassword, captcha_id: captcha.data.captcha_id, captcha_code: answer,
  }, headers);
  assert.equal(response.status, 200, `${label} login: ${JSON.stringify(response)}`);
  actor.accessToken = response.data.access_token;
  return actor;
}

async function createUser(ctx, input) {
  const hash = await bcrypt.hash(input.password, 4);
  const inserted = await ctx.queryTestDb(
    'INSERT INTO sys_user (username, password_hash, real_name, category_id, source, role, status, force_password_change) VALUES (?, ?, ?, ?, ?, ?, 1, 0)',
    [input.username, hash, input.realName, input.categoryId, input.source, input.role || 'employee'],
  );
  return String(inserted.insertId);
}

async function grantReviewOnly(ctx, userIds, roleCode) {
  const role = await ctx.queryTestDb(
    'INSERT INTO sys_role (code, name, is_system, status) VALUES (?, ?, 0, 1)',
    [roleCode, '图片阅卷员'],
  );
  const permissions = await ctx.queryTestDb("SELECT id FROM sys_permission WHERE code = 'exam_records:review'");
  assert.equal(permissions.length, 1, 'review permission not initialized');
  await ctx.queryTestDb('INSERT INTO sys_role_permission (role_id, permission_id) VALUES (?, ?)', [role.insertId, permissions[0].id]);
  for (const userId of userIds) {
    await ctx.queryTestDb('INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [userId, role.insertId]);
  }
}

function multipart(fields, file, filename) {
  const boundary = `----ruleexam-c4-${randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`));
  chunks.push(file, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function uploadQuestionImage(ctx, actor, filename) {
  const payload = multipart({ purpose: 'question' }, pngFixture(), filename);
  const response = await ctx.request(actor, 'POST', '/media/upload', payload.body, { 'Content-Type': payload.contentType });
  assert.equal(response.status, 200, `question upload: ${JSON.stringify(response)}`);
  return String(response.data.asset_id);
}

async function uploadAnswerImage(ctx, actor, recordId, itemId, filename) {
  const payload = multipart({ item_id: itemId }, pngFixture(), filename);
  const response = await ctx.request(actor, 'POST', `/me/exam-records/${recordId}/answer-images`, payload.body, { 'Content-Type': payload.contentType });
  assert.equal(response.status, 200, `answer upload: ${JSON.stringify(response)}`);
  return String(response.data.asset_id);
}

async function createQuestionVersion(ctx, input) {
  const question = await ctx.queryTestDb(
    'INSERT INTO question (regulation_id, version_id, category_id, difficulty, concept_id, current_version_id, type, stem, options, answer, analysis, rubric, score, status, source, created_by) VALUES (NULL, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [input.categoryId, 'easy', input.type, input.stem, JSON.stringify(input.options), JSON.stringify(input.answer),
      input.analysis ?? null, input.rubric ?? null, (input.scoreCents / 100).toFixed(2), 'approved', 'manual', input.actorId],
  );
  const questionId = String(question.insertId);
  const version = await ctx.queryTestDb(
    'INSERT INTO question_version (question_id, revision, category_id, difficulty, type, stem, options, answer, analysis, rubric, score_cents, concept_id, regulation_id, regulation_version_id, source_page_group, source_page_start, source_page_end, source, status, approved_by, approved_at, reviewed_by, reviewed_at, review_reason, created_by, legacy_captured_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NOW(3), ?, NOW(3), NULL, ?, NULL)',
    [questionId, input.categoryId, 'easy', input.type, input.stem, JSON.stringify(input.options), JSON.stringify(input.answer),
      input.analysis ?? null, input.rubric ?? null, input.scoreCents, 'manual', 'approved', input.actorId, input.actorId, input.actorId],
  );
  const versionId = String(version.insertId);
  await ctx.queryTestDb('UPDATE question SET current_version_id = ? WHERE id = ?', [versionId, questionId]);
  return {
    questionId, versionId, revision: 1, categoryId: String(input.categoryId), difficulty: 'easy', type: input.type,
    stem: input.stem, options: input.options, answer: input.answer, analysis: input.analysis ?? null,
    rubric: input.rubric ?? null, scoreCents: input.scoreCents, source: 'manual', approvedBy: String(input.actorId),
    approvedAt: new Date().toISOString(),
  };
}

async function createPaper(ctx, { categoryId, actorId, pool, title }) {
  const rule = {
    totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5,
    rules: [
      { type: 'single', count: 1, scoreCents: 1500 },
      { type: 'multiple', count: 1, scoreCents: 1500 },
      { type: 'image', count: 4, scoreCents: 1750 },
    ],
  };
  const paper = await ctx.queryTestDb(
    'INSERT INTO exam_paper (regulation_id, business_scope, mode, category_id, requires_learning, regulation_ids, course_ids, rule_config, title, total_score, pass_score, duration_minutes, max_attempts, partial_credit_ratio, status, created_by) VALUES (NULL, ?, ?, ?, 0, ?, ?, ?, ?, 100.00, 60.00, 30, 3, 0.50, ?, ?)',
    ['training', 'random', categoryId, JSON.stringify([]), JSON.stringify([]), JSON.stringify(rule), title, 'published', actorId],
  );
  const paperId = String(paper.insertId);
  const release = await ctx.queryTestDb(
    'INSERT INTO paper_release (paper_id, version_no, business_scope, mode, category_id, requires_learning, rule_snapshot, regulation_ids, course_ids, created_by) VALUES (?, 1, ?, ?, ?, 0, ?, ?, ?, ?)',
    [paperId, 'training', 'random', categoryId, JSON.stringify(rule), JSON.stringify([]), JSON.stringify([]), actorId],
  );
  const releaseId = String(release.insertId);
  for (let index = 0; index < pool.length; index += 1) {
    const item = pool[index];
    await ctx.queryTestDb(
      'INSERT INTO paper_release_question (release_id, question_id, question_version_id, concept_id, type, difficulty, score_cents, position, snapshot_json) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)',
      [releaseId, item.questionId, item.versionId, item.type, item.difficulty, item.scoreCents, index, JSON.stringify(item)],
    );
  }
  return { paperId, releaseId };
}

function displayedIndex(question, key) {
  const index = question.options.findIndex((option) => option.key === key);
  assert.notEqual(index, -1, `missing displayed option ${key}`);
  return index;
}

async function createLegacyRecord(ctx, { userId, actorId, questionId }) {
  const paper = await ctx.queryTestDb(
    'INSERT INTO exam_paper (regulation_id, business_scope, mode, category_id, requires_learning, regulation_ids, course_ids, rule_config, title, total_score, pass_score, duration_minutes, max_attempts, partial_credit_ratio, status, created_by) VALUES (NULL, ?, ?, NULL, 1, NULL, NULL, NULL, ?, 100.00, 60.00, 30, 3, 0.50, ?, ?)',
    ['regulation', 'fixed', `C4 legacy ${suffix()}`, 'published', actorId],
  );
  await ctx.queryTestDb(
    'INSERT INTO paper_question (paper_id, question_id, question_version_id, concept_id, sort, score) VALUES (?, ?, NULL, NULL, 0, 100.00)',
    [paper.insertId, questionId],
  );
  const record = await ctx.queryTestDb(
    "INSERT INTO exam_record (paper_id, regulation_id, user_id, assignment_id, active_assignment_id, release_id, source, category_id, difficulty, rule_snapshot, snapshot_origin, attempt_no, status, score, started_at, deadline_at, submitted_at, submission_method, grading_state, grading_revision, graded_at, switch_count) VALUES (?, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'legacy_unavailable', 1, 'passed', 88.00, DATE_SUB(NOW(3), INTERVAL 31 MINUTE), DATE_SUB(NOW(3), INTERVAL 1 MINUTE), NOW(3), NULL, 'finalized', 0, NULL, 0)",
    [paper.insertId, userId],
  );
  await ctx.queryTestDb(
    'INSERT INTO exam_answer (exam_record_id, question_id, record_question_id, selected, asset_ids, is_correct, gained_score, comment, grading_version) VALUES (?, ?, NULL, ?, NULL, 1, 88.00, NULL, 0)',
    [record.insertId, questionId, JSON.stringify([0])],
  );
  return String(record.insertId);
}

async function runGrading(ctx) {
  let stage = 'fixtures';
  const runSuffix = suffix();
  try {
    const setupPassword = password('setup');
    const setupId = await createUser(ctx, { username: `c4_setup_${runSuffix}`, password: setupPassword, realName: 'C4 配置管理员', categoryId: null, source: null, role: 'super_admin' });
    const setup = await login(ctx, `c4_setup_${runSuffix}`, setupPassword, 'setup');
    const category = await ctx.queryTestDb('INSERT INTO training_category (name, description, status, created_by) VALUES (?, NULL, 1, ?)', [`C4 类别 ${runSuffix}`, setupId]);
    const categoryId = String(category.insertId);

    const learnerPassword = password('learner');
    const learnerId = await createUser(ctx, { username: `c4_learner_${runSuffix}`, password: learnerPassword, realName: 'C4 学员', categoryId, source: 'institution' });
    const learner = await login(ctx, `c4_learner_${runSuffix}`, learnerPassword, 'learner');
    const otherPassword = password('other');
    const otherId = await createUser(ctx, { username: `c4_other_${runSuffix}`, password: otherPassword, realName: 'C4 他人', categoryId, source: 'institution' });
    const other = await login(ctx, `c4_other_${runSuffix}`, otherPassword, 'other');
    const reviewerActors = [];
    const reviewerIds = [];
    for (const label of ['one', 'two']) {
      const reviewerPassword = password(label);
      const reviewerId = await createUser(ctx, { username: `c4_reviewer_${label}_${runSuffix}`, password: reviewerPassword, realName: `C4 阅卷员 ${label}`, categoryId: null, source: null });
      reviewerIds.push(reviewerId);
      reviewerActors.push({ username: `c4_reviewer_${label}_${runSuffix}`, password: reviewerPassword });
    }
    await grantReviewOnly(ctx, reviewerIds, `c4_review_${runSuffix}`);
    const reviewers = await Promise.all(reviewerActors.map((item, index) => login(ctx, item.username, item.password, `reviewer-${index + 1}`)));

    stage = 'frozen question media';
    const promptAssetId = await uploadQuestionImage(ctx, setup, `c4-prompt-${runSuffix}.png`);
    const analysisAssetId = await uploadQuestionImage(ctx, setup, `c4-analysis-${runSuffix}.png`);
    const pool = [
      await createQuestionVersion(ctx, {
        categoryId, actorId: setupId, type: 'single', scoreCents: 1500,
        stem: `<p>题干图片<img data-media-id="${promptAssetId}"></p>`,
        options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0],
        analysis: `<p>解析图片<img data-media-id="${analysisAssetId}"></p>`, rubric: null,
      }),
      await createQuestionVersion(ctx, {
        categoryId, actorId: setupId, type: 'multiple', scoreCents: 1500, stem: '<p>多选部分分</p>',
        options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }], answer: [0, 1], analysis: '<p>多选解析</p>', rubric: null,
      }),
    ];
    for (let index = 1; index <= 4; index += 1) {
      pool.push(await createQuestionVersion(ctx, {
        categoryId, actorId: setupId, type: 'image', scoreCents: 1750, stem: `<p>图片作答 ${index}</p>`,
        options: [], answer: [], analysis: null, rubric: `<p>评分参考 ${index}</p>`,
      }));
    }
    const paper = await createPaper(ctx, { categoryId, actorId: setupId, pool, title: `C4 人工阅卷 ${runSuffix}` });

    stage = 'start and in-progress media boundary';
    const started = await ctx.request(learner, 'POST', `/me/exams/${paper.paperId}/start`);
    assert.equal(started.status, 200, JSON.stringify(started));
    const recordId = String(started.data.record_id);
    const single = started.data.questions.find((item) => item.type === 'single');
    const multiple = started.data.questions.find((item) => item.type === 'multiple');
    const images = started.data.questions.filter((item) => item.type === 'image');
    assert.equal(images.length, 4);
    assert.equal((await ctx.request(learner, 'GET', `/media/${promptAssetId}/content`)).status, 200);
    assert.equal((await ctx.request(learner, 'GET', `/media/${analysisAssetId}/content`)).status, 403);
    assert.equal((await ctx.request(reviewers[0], 'GET', `/media/${promptAssetId}/content`)).status, 200);
    assert.equal((await ctx.request(reviewers[0], 'GET', `/media/${analysisAssetId}/content`)).status, 403);
    assert.equal((await ctx.request(other, 'GET', `/media/${promptAssetId}/content`)).status, 403);

    stage = 'submit three answered images and one unanswered image';
    const answerAssets = [];
    for (let index = 0; index < 3; index += 1) {
      answerAssets.push(await uploadAnswerImage(ctx, learner, recordId, images[index].item_id, `c4-answer-${index}-${runSuffix}.png`));
    }
    const submitted = await ctx.request(learner, 'POST', `/me/exam-records/${recordId}/submit`, {
      revision: 1,
      answers: [
        { item_id: single.item_id, selected: [displayedIndex(single, 'A')] },
        { item_id: multiple.item_id, selected: [displayedIndex(multiple, 'A')] },
        ...images.slice(0, 3).map((item, index) => ({ item_id: item.item_id, asset_ids: [answerAssets[index]] })),
      ],
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted));
    assert.equal(submitted.data.grading_state, 'pending_manual');
    assert.equal(submitted.data.score, null);
    assert.equal(submitted.data.correct_rate, null);
    const unanswered = submitted.data.items.find((item) => item.item_id === images[3].item_id);
    assert.equal(unanswered.gained_score, 0);
    assert.equal(unanswered.answer, null);

    stage = 'review-only queue/result/media authorization';
    const navigation = await ctx.request(reviewers[0], 'GET', '/admin/menus/navigation');
    assert.equal(navigation.status, 200, JSON.stringify(navigation));
    const menuPaths = JSON.stringify(navigation.data);
    assert.match(menuPaths, /\/admin\/grading/);
    const queue = await ctx.request(reviewers[0], 'GET', `/admin/grading?paper_id=${paper.paperId}&source=institution&status=pending_manual`);
    assert.equal(queue.status, 200, JSON.stringify(queue));
    assert.equal(queue.data.total, 1);
    assert.equal(queue.data.items[0].record_id, recordId);
    assert.equal(queue.data.items[0].pending_items, 3);
    assert.equal(queue.data.items[0].image_items, 3);
    const adminResult = await ctx.request(reviewers[0], 'GET', `/admin/exam-records/${recordId}/result`);
    assert.equal(adminResult.status, 200, JSON.stringify(adminResult));
    assert.equal((await ctx.request(reviewers[0], 'GET', `/media/${answerAssets[0]}/content`)).status, 200);
    assert.equal((await ctx.request(reviewers[0], 'GET', `/media/${analysisAssetId}/content`)).status, 200);
    assert.equal((await ctx.request(learner, 'GET', `/media/${analysisAssetId}/content`)).status, 200);
    assert.equal((await ctx.request(other, 'GET', `/media/${answerAssets[0]}/content`)).status, 403);
    assert.equal((await ctx.request(other, 'GET', `/media/${analysisAssetId}/content`)).status, 403);
    assert.equal((await ctx.request(other, 'GET', `/admin/exam-records/${recordId}/result`)).status, 403);
    assert.equal((await ctx.request(other, 'GET', '/admin/grading')).status, 403);
    const resultRefs = await ctx.queryTestDb(
      "SELECT COUNT(*) AS count FROM media_reference WHERE asset_id = ? AND owner_type = 'exam_record_question' AND owner_id = ?",
      [analysisAssetId, single.item_id],
    );
    assert.equal(Number(resultRefs[0].count), 1, 'lazy result reference must be idempotent');
    await Promise.all([
      ctx.request(learner, 'GET', `/me/exam-records/${recordId}/result`),
      ctx.request(reviewers[1], 'GET', `/admin/exam-records/${recordId}/result`),
    ]);
    const refsAfterConcurrentRead = await ctx.queryTestDb(
      "SELECT COUNT(*) AS count FROM media_reference WHERE asset_id = ? AND owner_type = 'exam_record_question' AND owner_id = ?",
      [analysisAssetId, single.item_id],
    );
    assert.equal(Number(refsAfterConcurrentRead[0].count), 1);
    const wrongPending = await ctx.request(learner, 'GET', '/me/wrong-questions?page=1&page_size=20');
    assert.equal(wrongPending.status, 200, JSON.stringify(wrongPending));
    assert.equal(wrongPending.data.items.some((item) => item.record_id === recordId), false);

    stage = 'same item optimistic conflict and auditable correction';
    const sameItem = await Promise.all([
      ctx.request(reviewers[0], 'PUT', `/admin/exam-records/${recordId}/grades/${images[0].item_id}`, { score_cents: 1000, comment: '阅卷一', expected_version: 0 }),
      ctx.request(reviewers[1], 'PUT', `/admin/exam-records/${recordId}/grades/${images[0].item_id}`, { score_cents: 1500, comment: '阅卷二', expected_version: 0 }),
    ]);
    assert.equal(sameItem.filter((response) => response.status === 200).length, 1, JSON.stringify(sameItem));
    assert.equal(sameItem.filter((response) => response.status === 409).length, 1, JSON.stringify(sameItem));
    const corrected = await ctx.request(reviewers[0], 'PUT', `/admin/exam-records/${recordId}/grades/${images[0].item_id}`, {
      score_cents: 1000, comment: '统一为部分分', expected_version: 1,
    });
    assert.equal(corrected.status, 200, JSON.stringify(corrected));
    assert.equal(corrected.data.grading_state, 'pending_manual');
    assert.equal(corrected.data.items.find((item) => item.item_id === images[0].item_id).grading_version, 2);
    const correctionEvents = await ctx.queryTestDb(
      'SELECT before_score, after_score, before_comment, after_comment, grading_version FROM exam_review_event WHERE exam_record_id = ? AND record_question_id = ? ORDER BY grading_version',
      [recordId, images[0].item_id],
    );
    assert.equal(correctionEvents.length, 2);
    assert.equal(Number(correctionEvents[1].after_score), 10);
    assert.equal(correctionEvents[1].after_comment, '统一为部分分');

    stage = 'last two items concurrent finalization';
    const lastTwo = await Promise.all([
      ctx.request(reviewers[0], 'PUT', `/admin/exam-records/${recordId}/grades/${images[1].item_id}`, { score_cents: 1750, comment: '满分二', expected_version: 0 }),
      ctx.request(reviewers[1], 'PUT', `/admin/exam-records/${recordId}/grades/${images[2].item_id}`, { score_cents: 1750, comment: '满分三', expected_version: 0 }),
    ]);
    assert.equal(lastTwo.every((response) => response.status === 200), true, JSON.stringify(lastTwo));
    assert.equal(lastTwo.filter((response) => response.data.grading_state === 'finalized').length, 1, JSON.stringify(lastTwo));
    assert.equal(lastTwo.filter((response) => response.data.grading_state === 'pending_manual').length, 1, JSON.stringify(lastTwo));
    const final = lastTwo.find((response) => response.data.grading_state === 'finalized').data;
    assert.equal(final.score, 67.5);
    assert.equal(final.passed, true);
    assert.equal(final.correct_rate, 0.5);
    assert.equal(final.grading_revision, 4);
    const finalFacts = await ctx.queryTestDb(
      'SELECT status, score, grading_state, grading_revision, graded_at FROM exam_record WHERE id = ?', [recordId],
    );
    assert.deepEqual({
      status: finalFacts[0].status, score: Number(finalFacts[0].score), state: finalFacts[0].grading_state,
      revision: Number(finalFacts[0].grading_revision), graded: Boolean(finalFacts[0].graded_at),
    }, { status: 'passed', score: 67.5, state: 'finalized', revision: 4, graded: true });
    const eventCount = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM exam_review_event WHERE exam_record_id = ?', [recordId]);
    assert.equal(Number(eventCount[0].count), 4);
    const editAfterFinal = await ctx.request(reviewers[0], 'PUT', `/admin/exam-records/${recordId}/grades/${images[1].item_id}`, {
      score_cents: 1600, comment: '终态不可改', expected_version: 1,
    });
    assert.equal(editAfterFinal.status, 409);

    stage = 'history and wrong item pagination';
    const history = await ctx.request(learner, 'GET', '/me/exam-records?page=1&page_size=20');
    assert.equal(history.status, 200, JSON.stringify(history));
    assert.equal(history.data.items.find((item) => item.record_id === recordId).score, 67.5);
    const wrongPage1 = await ctx.request(learner, 'GET', '/me/wrong-questions?page=1&page_size=2');
    const wrongPage2 = await ctx.request(learner, 'GET', '/me/wrong-questions?page=2&page_size=2');
    assert.equal(wrongPage1.status, 200, JSON.stringify(wrongPage1));
    assert.equal(wrongPage2.status, 200, JSON.stringify(wrongPage2));
    assert.equal(wrongPage1.data.total, 3);
    const wrongIds = [...wrongPage1.data.items, ...wrongPage2.data.items].map((item) => item.item_id).sort();
    assert.deepEqual(wrongIds, [multiple.item_id, images[0].item_id, images[3].item_id].sort());

    stage = 'snapshotless legacy truth and old interface shape';
    const legacyRecordId = await createLegacyRecord(ctx, { userId: learnerId, actorId: setupId, questionId: pool[0].questionId });
    const legacyNewResult = await ctx.request(learner, 'GET', `/me/exam-records/${legacyRecordId}/result`);
    assert.equal(legacyNewResult.status, 200, JSON.stringify(legacyNewResult));
    assert.deepEqual({
      legacy: legacyNewResult.data.legacy,
      method: legacyNewResult.data.submission_method,
      gradedAt: legacyNewResult.data.graded_at,
      score: legacyNewResult.data.score,
      correctRate: legacyNewResult.data.correct_rate,
      itemCount: legacyNewResult.data.items.length,
    }, { legacy: true, method: null, gradedAt: null, score: 88, correctRate: null, itemCount: 0 });
    const legacyOldResult = await ctx.request(learner, 'GET', `/exams/records/${legacyRecordId}/result`);
    assert.equal(legacyOldResult.status, 200, JSON.stringify(legacyOldResult));
    assert.equal(legacyOldResult.data.exam_record_id, Number(legacyRecordId));
    assert.equal(legacyOldResult.data.score, 88);
    assert.ok(Array.isArray(legacyOldResult.data.questions));
    assert.equal(legacyOldResult.data.questions[0].selected[0], 0);

    console.log(JSON.stringify({
      suite: 'training-grading', record_id: recordId, legacy_record_id: legacyRecordId,
      assertions: 'review-only,media-phase,same-item-conflict,last-two-finalize,audit,history,wrong-pagination,legacy',
    }));
  } catch (error) {
    error.message = `[training-grading stage=${stage}] ${error.message}`;
    throw error;
  }
}

export async function run(ctx) { await runGrading(ctx); }
