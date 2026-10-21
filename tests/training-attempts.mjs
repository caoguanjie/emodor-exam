import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const bcrypt = require('bcryptjs');
const Redis = require('ioredis');

function suffix() {
  return randomBytes(5).toString('hex');
}

function password(label) {
  return `A9-${label}-${randomBytes(8).toString('hex')}`;
}

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
  try {
    answer = await redis.get(`${ctx.env.REDIS_KEY_PREFIX || ''}auth:captcha:${captcha.data.captcha_id}`);
  } finally {
    await redis.quit();
  }
  const actor = {};
  const response = await ctx.request(actor, 'POST', '/auth/login', {
    username,
    password: userPassword,
    captcha_id: captcha.data.captcha_id,
    captcha_code: answer,
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

function pngFixture() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
}

async function uploadQuestionImage(ctx, actor, filename) {
  const boundary = `----ruleexam-c2-${randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nquestion\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    pngFixture(),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploaded = await ctx.request(actor, 'POST', '/media/upload', body, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  });
  assert.equal(uploaded.status, 200, `media upload: ${JSON.stringify(uploaded)}`);
  return String(uploaded.data.asset_id);
}

async function createQuestionVersion(ctx, input) {
  const options = input.options || [{ key: 'A', text: '正确项' }, { key: 'B', text: '错误项' }];
  const answer = input.answer || [0];
  const question = await ctx.queryTestDb(
    'INSERT INTO question (regulation_id, version_id, category_id, difficulty, concept_id, current_version_id, type, stem, options, answer, analysis, rubric, score, status, source, created_by) VALUES (NULL, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [input.categoryId, input.difficulty, input.type || 'single', input.stem, JSON.stringify(options), JSON.stringify(answer),
      input.analysis ?? '<p>冻结解析</p>', input.rubric ?? null, ((input.scoreCents || 10000) / 100).toFixed(2), 'approved', 'manual', input.actorId],
  );
  const questionId = String(question.insertId);
  const version = await ctx.queryTestDb(
    'INSERT INTO question_version (question_id, revision, category_id, difficulty, type, stem, options, answer, analysis, rubric, score_cents, concept_id, regulation_id, regulation_version_id, source_page_group, source_page_start, source_page_end, source, status, approved_by, approved_at, reviewed_by, reviewed_at, review_reason, created_by, legacy_captured_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NOW(3), ?, NOW(3), NULL, ?, NULL)',
    [questionId, input.categoryId, input.difficulty, input.type || 'single', input.stem, JSON.stringify(options), JSON.stringify(answer),
      input.analysis ?? '<p>冻结解析</p>', input.rubric ?? null, input.scoreCents || 10000, 'manual', 'approved', input.actorId, input.actorId, input.actorId],
  );
  const versionId = String(version.insertId);
  await ctx.queryTestDb('UPDATE question SET current_version_id = ? WHERE id = ?', [versionId, questionId]);
  return {
    questionId,
    versionId,
    revision: 1,
    categoryId: String(input.categoryId),
    difficulty: input.difficulty,
    type: input.type || 'single',
    stem: input.stem,
    options,
    answer,
    analysis: input.analysis ?? '<p>冻结解析</p>',
    rubric: input.rubric ?? null,
    scoreCents: input.scoreCents || 10000,
    source: 'manual',
    approvedBy: String(input.actorId),
    approvedAt: new Date().toISOString(),
  };
}

async function createTrainingPaper(ctx, input) {
  const paper = await ctx.queryTestDb(
    'INSERT INTO exam_paper (regulation_id, business_scope, mode, category_id, requires_learning, regulation_ids, course_ids, rule_config, title, total_score, pass_score, duration_minutes, max_attempts, partial_credit_ratio, status, created_by) VALUES (NULL, ?, ?, ?, 0, ?, ?, ?, ?, 100.00, 60.00, 30, 3, 0.50, ?, ?)',
    ['training', input.mode || 'random', input.categoryId, JSON.stringify([]), JSON.stringify([]), JSON.stringify(input.rule), input.title, 'published', input.actorId],
  );
  const paperId = String(paper.insertId);
  const release = await ctx.queryTestDb(
    'INSERT INTO paper_release (paper_id, version_no, business_scope, mode, category_id, requires_learning, rule_snapshot, regulation_ids, course_ids, created_by) VALUES (?, 1, ?, ?, ?, 0, ?, ?, ?, ?)',
    [paperId, 'training', input.mode || 'random', input.categoryId, JSON.stringify(input.rule), JSON.stringify([]), JSON.stringify([]), input.actorId],
  );
  const releaseId = String(release.insertId);
  for (let index = 0; index < input.pool.length; index += 1) {
    const item = input.pool[index];
    await ctx.queryTestDb(
      'INSERT INTO paper_release_question (release_id, question_id, question_version_id, concept_id, type, difficulty, score_cents, position, snapshot_json) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)',
      [releaseId, item.questionId, item.versionId, item.type, item.difficulty, item.scoreCents, index, JSON.stringify(item)],
    );
  }
  return { paperId, releaseId };
}

function forbiddenKeys(value, forbidden, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) forbiddenKeys(item, forbidden, found);
    return found;
  }
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.includes(key)) found.push(key);
    forbiddenKeys(item, forbidden, found);
  }
  return found;
}

async function waitFor(ctx, probe, timeoutMs = 40_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('timed out waiting for attempt state');
}

async function runAttempts(ctx) {
  let stage = 'fixtures';
  const runSuffix = suffix();
  try {
    const seedAdminPassword = password('admin');
    const adminId = await createUser(ctx, {
      username: `c2_admin_${runSuffix}`, password: seedAdminPassword, realName: 'C2 管理员',
      categoryId: null, source: null, role: 'super_admin',
    });
    const admin = await login(ctx, `c2_admin_${runSuffix}`, seedAdminPassword, 'admin');
    const category = await ctx.queryTestDb(
      'INSERT INTO training_category (name, description, status, created_by) VALUES (?, NULL, 1, ?)',
      [`C2 类别 ${runSuffix}`, adminId],
    );
    const categoryId = String(category.insertId);

    const learnerPassword = password('learner');
    const learnerId = await createUser(ctx, {
      username: `c2_learner_${runSuffix}`, password: learnerPassword, realName: 'C2 并发学员',
      categoryId, source: 'institution',
    });
    const learner = await login(ctx, `c2_learner_${runSuffix}`, learnerPassword, 'learner');

    const otherPassword = password('other');
    const otherId = await createUser(ctx, {
      username: `c2_other_${runSuffix}`, password: otherPassword, realName: 'C2 其他学员',
      categoryId, source: 'institution',
    });
    const other = await login(ctx, `c2_other_${runSuffix}`, otherPassword, 'other learner');

    const promptAssetId = await uploadQuestionImage(ctx, admin, `c2-prompt-${runSuffix}.png`);
    const answerAssetId = await uploadQuestionImage(ctx, admin, `c2-answer-${runSuffix}.png`);
    const easy = await createQuestionVersion(ctx, {
      categoryId, difficulty: 'easy', actorId: adminId,
      stem: `<p>发布冻结题干 <img data-media-id="${promptAssetId}"></p>`,
      analysis: `<p>发布冻结解析 <img data-media-id="${answerAssetId}"></p>`,
    });
    const hard = await createQuestionVersion(ctx, {
      categoryId, difficulty: 'hard', actorId: adminId, stem: '<p>高级冻结题干</p>',
    });
    const oneRule = {
      totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3,
      partialCreditRatio: 0.5, rules: [{ type: 'single', count: 1, scoreCents: 10000 }],
    };
    const paper = await createTrainingPaper(ctx, {
      categoryId, actorId: adminId, title: `C2 并发随机卷 ${runSuffix}`, rule: oneRule, pool: [easy, hard],
    });

    stage = '20 concurrent first starts with stale redis lock';
    const redis = await redisFor(ctx);
    try {
      await redis.set(`${ctx.env.REDIS_KEY_PREFIX || ''}exam:lock:start:${learnerId}:${paper.paperId}`, 'stale', 'EX', 60);
    } finally {
      await redis.quit();
    }
    const starts = await Promise.all(Array.from({ length: 20 }, () => (
      ctx.request(learner, 'POST', `/me/exams/${paper.paperId}/start`)
    )));
    for (const response of starts) assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(new Set(starts.map((response) => response.data.record_id)).size, 1);
    const first = starts[0];
    assert.equal(first.data.difficulty, 'easy');
    assert.equal(first.data.source, 'institution');
    assert.equal(first.data.category_id, categoryId);
    assert.deepEqual(forbiddenKeys(first.data, ['answer', 'analysis', 'rubric']), []);
    const committed = await ctx.queryTestDb(
      'SELECT id, assignment_id, active_assignment_id, attempt_no, snapshot_origin FROM exam_record WHERE user_id = ? AND paper_id = ?',
      [learnerId, paper.paperId],
    );
    assert.equal(committed.length, 1);
    assert.equal(Number(committed[0].attempt_no), 1);
    assert.equal(committed[0].snapshot_origin, 'release');
    assert.equal(String(committed[0].assignment_id), String(committed[0].active_assignment_id));
    const assignments = await ctx.queryTestDb('SELECT * FROM exam_assignment WHERE user_id = ? AND paper_id = ?', [learnerId, paper.paperId]);
    assert.equal(assignments.length, 1);
    const items = await ctx.queryTestDb('SELECT * FROM exam_record_question WHERE record_id = ?', [first.data.record_id]);
    assert.equal(items.length, 1);

    stage = 'snapshot recovery, withdraw and media ownership';
    await ctx.queryTestDb(
      'UPDATE paper_release_question SET snapshot_json = JSON_SET(snapshot_json, ?, ?, ?, JSON_ARRAY(1)) WHERE release_id = ? AND difficulty = ?',
      ['$.stem', '<p>发布后篡改题干</p>', '$.answer', paper.releaseId, 'easy'],
    );
    await ctx.queryTestDb('UPDATE exam_paper SET status = ? WHERE id = ?', ['withdrawn', paper.paperId]);
    await ctx.restartApi();
    const recovered = await ctx.request(learner, 'POST', `/me/exams/${paper.paperId}/start`);
    assert.equal(recovered.status, 200, JSON.stringify(recovered));
    assert.equal(recovered.data.record_id, first.data.record_id);
    assert.deepEqual(recovered.data.questions, first.data.questions);
    assert.equal(recovered.data.deadline_at, first.data.deadline_at);
    const directRecover = await ctx.request(learner, 'GET', `/me/exam-records/${first.data.record_id}`);
    assert.equal(directRecover.status, 200, JSON.stringify(directRecover));
    assert.deepEqual(directRecover.data.questions, first.data.questions);
    const crossAccount = await ctx.request(other, 'GET', `/me/exam-records/${first.data.record_id}`);
    assert.equal(crossAccount.status, 403);
    assert.equal(crossAccount.code, 40302);
    const promptRead = await ctx.request(learner, 'GET', `/media/${promptAssetId}/content`);
    assert.equal(promptRead.status, 200);
    const answerRead = await ctx.request(learner, 'GET', `/media/${answerAssetId}/content`);
    assert.equal(answerRead.status, 403);
    const crossPromptRead = await ctx.request(other, 'GET', `/media/${promptAssetId}/content`);
    assert.equal(crossPromptRead.status, 403);

    stage = 'retake keeps first source and difficulty';
    const trainingViaLegacySubmit = await ctx.request(learner, 'POST', `/exams/records/${first.data.record_id}/submit`, { answers: [] });
    assert.equal(trainingViaLegacySubmit.status, 404);
    assert.equal(trainingViaLegacySubmit.code, 40402);
    await ctx.queryTestDb(
      "UPDATE exam_record SET status = 'failed', score = 0.00, submitted_at = UTC_TIMESTAMP(3), active_assignment_id = NULL WHERE id = ?",
      [first.data.record_id],
    );
    await ctx.queryTestDb('UPDATE exam_paper SET status = ? WHERE id = ?', ['published', paper.paperId]);
    await ctx.queryTestDb('UPDATE sys_user SET source = ? WHERE id = ?', ['external', learnerId]);
    const retakeAfterSourceChange = await ctx.request(learner, 'POST', `/me/exams/${paper.paperId}/start`);
    assert.equal(retakeAfterSourceChange.status, 200, JSON.stringify(retakeAfterSourceChange));
    assert.equal(retakeAfterSourceChange.data.difficulty, 'easy');
    assert.equal(retakeAfterSourceChange.data.source, 'institution');
    assert.equal(retakeAfterSourceChange.data.release_id, paper.releaseId);
    await ctx.queryTestDb(
      "UPDATE exam_record SET status = 'failed', score = 0.00, submitted_at = UTC_TIMESTAMP(3), active_assignment_id = NULL WHERE id = ?",
      [retakeAfterSourceChange.data.record_id],
    );

    stage = 'legacy two attempts count and timeout sweeper releases active assignment';
    const legacyCountPassword = password('legacy-count');
    const legacyCountId = await createUser(ctx, {
      username: `c2_count_${runSuffix}`, password: legacyCountPassword, realName: 'C2 旧次数学员',
      categoryId, source: 'institution',
    });
    const legacyCountActor = await login(ctx, `c2_count_${runSuffix}`, legacyCountPassword, 'legacy count learner');
    await ctx.queryTestDb(
      "INSERT INTO exam_record (paper_id, regulation_id, user_id, attempt_no, status, score, started_at, deadline_at, submitted_at, switch_count) VALUES (?, NULL, ?, 1, 'failed', 0.00, NOW(3), NOW(3), NOW(3), 0), (?, NULL, ?, 2, 'failed', 0.00, NOW(3), NOW(3), NOW(3), 0)",
      [paper.paperId, legacyCountId, paper.paperId, legacyCountId],
    );
    const third = await ctx.request(legacyCountActor, 'POST', `/me/exams/${paper.paperId}/start`);
    assert.equal(third.status, 200, JSON.stringify(third));
    const thirdRow = await ctx.queryTestDb('SELECT attempt_no FROM exam_record WHERE id = ?', [third.data.record_id]);
    assert.equal(Number(thirdRow[0].attempt_no), 3);
    const recoveredThird = await ctx.request(legacyCountActor, 'POST', `/me/exams/${paper.paperId}/start`);
    assert.equal(recoveredThird.status, 200, JSON.stringify(recoveredThird));
    assert.equal(recoveredThird.data.record_id, third.data.record_id);
    await ctx.queryTestDb('UPDATE exam_record SET deadline_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?', [third.data.record_id]);
    const expiredFixture = await ctx.queryTestDb(
      'SELECT attempt_no, status, assignment_id, active_assignment_id, deadline_at <= UTC_TIMESTAMP(3) AS is_expired FROM exam_record WHERE id = ?',
      [third.data.record_id],
    );
    assert.equal(Number(expiredFixture[0].attempt_no), 3);
    assert.equal(expiredFixture[0].status, 'in_progress');
    assert.equal(String(expiredFixture[0].assignment_id), String(expiredFixture[0].active_assignment_id));
    assert.equal(Number(expiredFixture[0].is_expired), 1);
    const expiredStart = await ctx.request(legacyCountActor, 'POST', `/me/exams/${paper.paperId}/start`);
    assert.equal(expiredStart.status, 409);
    assert.equal(expiredStart.code, 40904);
    const swept = await waitFor(ctx, async () => {
      const rows = await ctx.queryTestDb('SELECT status, active_assignment_id FROM exam_record WHERE id = ?', [third.data.record_id]);
      return rows[0]?.status !== 'in_progress' ? rows[0] : null;
    });
    assert.equal(swept.status, 'failed');
    assert.equal(swept.active_assignment_id, null);
    const fourth = await ctx.request(legacyCountActor, 'POST', `/me/exams/${paper.paperId}/start`);
    assert.equal(fourth.status, 409);
    assert.equal(fourth.code, 40902);

    stage = 'failed draw rolls back assignment record items and media references';
    const failingPassword = password('failing');
    const failingId = await createUser(ctx, {
      username: `c2_fail_${runSuffix}`, password: failingPassword, realName: 'C2 抽题失败学员',
      categoryId, source: 'institution',
    });
    const failingActor = await login(ctx, `c2_fail_${runSuffix}`, failingPassword, 'failing learner');
    const insufficientRule = {
      ...oneRule,
      rules: [{ type: 'single', count: 2, scoreCents: 5000 }],
    };
    const insufficientEasy = { ...easy, scoreCents: 5000 };
    const insufficientHard = { ...hard, scoreCents: 5000 };
    const insufficientPaper = await createTrainingPaper(ctx, {
      categoryId, actorId: adminId, title: `C2 不足题池 ${runSuffix}`,
      rule: insufficientRule, pool: [insufficientEasy, insufficientHard],
    });
    const failedDraw = await ctx.request(failingActor, 'POST', `/me/exams/${insufficientPaper.paperId}/start`);
    assert.equal(failedDraw.status, 409);
    assert.equal(failedDraw.code, 40971);
    const failedDrawFacts = await ctx.queryTestDb(
      'SELECT (SELECT COUNT(*) FROM exam_assignment WHERE user_id = ? AND paper_id = ?) AS assignments, (SELECT COUNT(*) FROM exam_record WHERE user_id = ? AND paper_id = ?) AS records, (SELECT COUNT(*) FROM exam_record_question item INNER JOIN exam_record record_row ON record_row.id = item.record_id WHERE record_row.user_id = ? AND record_row.paper_id = ?) AS items',
      [failingId, insufficientPaper.paperId, failingId, insufficientPaper.paperId, failingId, insufficientPaper.paperId],
    );
    assert.equal(Number(failedDrawFacts[0].assignments), 0);
    assert.equal(Number(failedDrawFacts[0].records), 0);
    assert.equal(Number(failedDrawFacts[0].items), 0);

    stage = 'real legacy fixed-client start heartbeat recover submit result';
    const legacyPassword = password('fixed');
    const legacyUserId = await createUser(ctx, {
      username: `c2_fixed_${runSuffix}`, password: legacyPassword, realName: 'C2 固定卷学员',
      categoryId, source: 'institution',
    });
    const legacyActor = await login(ctx, `c2_fixed_${runSuffix}`, legacyPassword, 'legacy fixed learner');
    const noLearningPassword = password('no-learning');
    await createUser(ctx, {
      username: `c2_nolearn_${runSuffix}`, password: noLearningPassword, realName: 'C2 未学习学员',
      categoryId, source: 'institution',
    });
    const noLearningActor = await login(ctx, `c2_nolearn_${runSuffix}`, noLearningPassword, 'no learning learner');
    const regulation = await ctx.queryTestDb(
      'INSERT INTO regulation (title, category, category_id, description, status, current_version_id, required_minutes, scroll_segments, created_by) VALUES (?, ?, ?, NULL, ?, NULL, 1, 10, ?)',
      [`C2 legacy 制度 ${runSuffix}`, 'C2', categoryId, 'published', adminId],
    );
    const regulationId = String(regulation.insertId);
    await ctx.queryTestDb('INSERT INTO regulation_scope (regulation_id, department_id, is_all) VALUES (?, NULL, 1)', [regulationId]);
    await ctx.queryTestDb(
      'INSERT INTO learning_record (user_id, regulation_id, version_id, total_seconds, max_scroll_percent, scroll_coverage, is_valid, valid_at, last_learn_at) VALUES (?, ?, 1, 60, 100, ?, 1, NOW(3), NOW(3))',
      [legacyUserId, regulationId, JSON.stringify([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])],
    );
    const legacyQuestion = await ctx.queryTestDb(
      'INSERT INTO question (regulation_id, version_id, category_id, difficulty, concept_id, current_version_id, type, stem, options, answer, analysis, rubric, score, status, source, created_by) VALUES (?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL, 100.00, ?, ?, ?)',
      [regulationId, 'single', '<p>旧卷冻结题干</p>', JSON.stringify([{ key: 'A', text: '正确项' }, { key: 'B', text: '错误项' }]),
        JSON.stringify([0]), '<p>旧卷冻结解析</p>', 'approved', 'manual', adminId],
    );
    const legacyQuestionId = String(legacyQuestion.insertId);
    const legacyPaper = await ctx.queryTestDb(
      'INSERT INTO exam_paper (regulation_id, business_scope, mode, category_id, requires_learning, title, total_score, pass_score, duration_minutes, max_attempts, partial_credit_ratio, status, created_by) VALUES (?, ?, ?, NULL, 1, ?, 100.00, 60.00, 30, 3, 0.50, ?, ?)',
      [regulationId, 'regulation', 'fixed', `C2 旧固定卷 ${runSuffix}`, 'published', adminId],
    );
    const legacyPaperId = String(legacyPaper.insertId);
    await ctx.queryTestDb(
      'INSERT INTO paper_question (paper_id, question_id, question_version_id, concept_id, sort, score) VALUES (?, ?, NULL, NULL, 0, 100.00)',
      [legacyPaperId, legacyQuestionId],
    );
    const gated = await ctx.request(noLearningActor, 'POST', `/exams/papers/${legacyPaperId}/start`);
    assert.equal(gated.status, 409);
    assert.equal(gated.code, 40901);
    const oldStart = await ctx.request(legacyActor, 'POST', `/exams/papers/${legacyPaperId}/start`);
    assert.equal(oldStart.status, 200, JSON.stringify(oldStart));
    assert.equal(typeof oldStart.data.exam_record_id, 'number');
    assert.equal(typeof oldStart.data.questions[0].question_id, 'number');
    assert.deepEqual(forbiddenKeys(oldStart.data.questions, ['answer', 'analysis', 'rubric']), []);
    const correctDisplay = oldStart.data.questions[0].options.findIndex((option) => option.key === 'A');
    assert.notEqual(correctDisplay, -1);
    await ctx.queryTestDb(
      'UPDATE question SET stem = ?, answer = ?, analysis = ? WHERE id = ?',
      ['<p>开考后动态题干</p>', JSON.stringify([1]), '<p>开考后动态解析</p>', legacyQuestionId],
    );
    const oldHeartbeat = await ctx.request(legacyActor, 'POST', `/exams/records/${oldStart.data.exam_record_id}/heartbeat`, {
      answers: [{ question_id: oldStart.data.questions[0].question_id, selected: [correctDisplay] }],
    });
    assert.equal(oldHeartbeat.status, 200, JSON.stringify(oldHeartbeat));
    const oldRecover = await ctx.request(legacyActor, 'GET', `/exams/records/${oldStart.data.exam_record_id}`);
    assert.equal(oldRecover.status, 200, JSON.stringify(oldRecover));
    assert.deepEqual(oldRecover.data.questions, oldStart.data.questions);
    const oldSubmit = await ctx.request(legacyActor, 'POST', `/exams/records/${oldStart.data.exam_record_id}/submit`, {
      answers: [{ question_id: oldStart.data.questions[0].question_id, selected: [correctDisplay] }],
    });
    assert.equal(oldSubmit.status, 200, JSON.stringify(oldSubmit));
    assert.equal(oldSubmit.data.status, 'passed');
    assert.equal(oldSubmit.data.score, 100);
    const oldResult = await ctx.request(legacyActor, 'GET', `/exams/records/${oldStart.data.exam_record_id}/result`);
    assert.equal(oldResult.status, 200, JSON.stringify(oldResult));
    assert.equal(oldResult.data.questions[0].stem, '<p>旧卷冻结题干</p>');
    assert.deepEqual(oldResult.data.questions[0].answer, [0]);
    assert.equal(oldResult.data.questions[0].analysis, '<p>旧卷冻结解析</p>');
    const legacyFacts = await ctx.queryTestDb(
      'SELECT difficulty, snapshot_origin, active_assignment_id FROM exam_record WHERE id = ?',
      [oldStart.data.exam_record_id],
    );
    assert.equal(legacyFacts[0].difficulty, 'unknown');
    assert.equal(legacyFacts[0].snapshot_origin, 'legacy_start');
    assert.equal(legacyFacts[0].active_assignment_id, null);

    stage = 'new list excludes legacy fixed paper';
    const list = await ctx.request(learner, 'GET', '/me/exams?page=1&page_size=100');
    assert.equal(list.status, 200, JSON.stringify(list));
    assert.equal(list.data.items.some((item) => String(item.paper_id) === legacyPaperId), false);

    console.log(JSON.stringify({
      suite: 'training-attempts',
      concurrent_record_id: first.data.record_id,
      assignment_id: String(assignments[0].id),
      timeout_record_id: third.data.record_id,
      legacy_record_id: String(oldStart.data.exam_record_id),
      assertions: 'atomic-start,snapshot,retake,rollback,media,timeout-sweeper,legacy-flow',
    }));
  } catch (error) {
    error.message = `[training-attempts stage=${stage}] ${error.message}`;
    throw error;
  }
}

export async function run(ctx) {
  await runAttempts(ctx);
}
