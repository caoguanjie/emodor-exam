import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const bcrypt = require('bcryptjs');
const Redis = require('ioredis');

function suffix() { return randomBytes(5).toString('hex'); }
function password(label) { return `A9-${label}-${randomBytes(8).toString('hex')}`; }
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
  const headers = { 'X-Forwarded-For': `203.0.113.${(login.sequence = (login.sequence || 20) + 1)}` };
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

async function createQuestionVersion(ctx, input) {
  const question = await ctx.queryTestDb(
    'INSERT INTO question (regulation_id, version_id, category_id, difficulty, concept_id, current_version_id, type, stem, options, answer, analysis, score, status, source, created_by) VALUES (NULL, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [input.categoryId, 'easy', input.type, input.stem, JSON.stringify(input.options), JSON.stringify(input.answer),
      input.analysis ?? '<p>解析</p>', ((input.scoreCents || 2500) / 100).toFixed(2), 'approved', 'manual', input.actorId],
  );
  const questionId = String(question.insertId);
  const version = await ctx.queryTestDb(
    'INSERT INTO question_version (question_id, revision, category_id, difficulty, type, stem, options, answer, analysis, score_cents, concept_id, regulation_id, regulation_version_id, source_page_group, source_page_start, source_page_end, source, status, approved_by, approved_at, reviewed_by, reviewed_at, review_reason, created_by, legacy_captured_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NOW(3), ?, NOW(3), NULL, ?, NULL)',
    [questionId, input.categoryId, 'easy', input.type, input.stem, JSON.stringify(input.options), JSON.stringify(input.answer),
      input.analysis ?? '<p>解析</p>', input.scoreCents || 2500, 'manual', 'approved', input.actorId, input.actorId, input.actorId],
  );
  const versionId = String(version.insertId);
  await ctx.queryTestDb('UPDATE question SET current_version_id = ? WHERE id = ?', [versionId, questionId]);
  return {
    questionId, versionId, revision: 1, categoryId: String(input.categoryId), difficulty: 'easy', type: input.type,
    stem: input.stem, options: input.options, answer: input.answer, analysis: input.analysis ?? '<p>解析</p>',
    scoreCents: input.scoreCents || 2500, source: 'manual', approvedBy: String(input.actorId),
    approvedAt: new Date().toISOString(),
  };
}

async function createPaper(ctx, { categoryId, actorId, pool, title }) {
  const rule = {
    totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5,
    rules: pool.map((item) => ({ type: item.type, count: 1, scoreCents: item.scoreCents })),
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

function sortedAnswers(answers) {
  return answers.map((answer) => ({
    item_id: String(answer.item_id),
    ...(answer.selected ? { selected: [...answer.selected] } : {}),
  })).sort((left, right) => BigInt(left.item_id) < BigInt(right.item_id) ? -1 : 1);
}

async function runSubmissions(ctx) {
  let stage = 'fixtures';
  const runSuffix = suffix();
  try {
    const adminPassword = password('admin');
    const adminId = await createUser(ctx, {
      username: `c3_admin_${runSuffix}`, password: adminPassword, realName: 'C3 管理员',
      categoryId: null, source: null, role: 'super_admin',
    });
    const category = await ctx.queryTestDb(
      'INSERT INTO training_category (name, description, status, created_by) VALUES (?, NULL, 1, ?)',
      [`C3 类别 ${runSuffix}`, adminId],
    );
    const categoryId = String(category.insertId);
    const actors = {};
    for (const label of ['alpha', 'beta', 'gamma']) {
      const userPassword = password(label);
      const userId = await createUser(ctx, {
        username: `c3_${label}_${runSuffix}`, password: userPassword, realName: `C3 ${label}`,
        categoryId, source: 'institution',
      });
      actors[label] = { userId, actor: await login(ctx, `c3_${label}_${runSuffix}`, userPassword, label) };
    }
    const pool = [
      await createQuestionVersion(ctx, { categoryId, actorId: adminId, type: 'single', stem: '<p>单选</p>', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0], scoreCents: 3000 }),
      await createQuestionVersion(ctx, { categoryId, actorId: adminId, type: 'multiple', stem: '<p>多选</p>', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }], answer: [0, 1], scoreCents: 3000 }),
      await createQuestionVersion(ctx, { categoryId, actorId: adminId, type: 'judgment', stem: '<p>判断</p>', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [0], scoreCents: 4000 }),
    ];
    const paper = await createPaper(ctx, { categoryId, actorId: adminId, pool, title: `C3 三题型 ${runSuffix}` });

    stage = 'start three real attempts';
    for (const value of Object.values(actors)) {
      value.started = await ctx.request(value.actor, 'POST', `/me/exams/${paper.paperId}/start`);
      assert.equal(value.started.status, 200, JSON.stringify(value.started));
      assert.equal(value.started.data.questions.length, 3);
      value.byType = Object.fromEntries(value.started.data.questions.map((question) => [question.type, question]));
    }

    stage = 'heartbeat persists server timing facts';
    const heartbeat = await ctx.request(actors.alpha.actor, 'POST', `/me/exam-records/${actors.alpha.started.data.record_id}/heartbeat`, {});
    assert.equal(heartbeat.status, 200, JSON.stringify(heartbeat));
    assert.match(heartbeat.data.server_time, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof heartbeat.data.remaining_seconds, 'number');
    assert.equal(heartbeat.data.draft_revision, 0);

    stage = 'acknowledged full draft survives real restart';
    const alphaAnswers = [
      { item_id: actors.alpha.byType.single.item_id, selected: [displayedIndex(actors.alpha.byType.single, 'A')] },
      { item_id: actors.alpha.byType.multiple.item_id, selected: [displayedIndex(actors.alpha.byType.multiple, 'A')] },
      { item_id: actors.alpha.byType.judgment.item_id, selected: [displayedIndex(actors.alpha.byType.judgment, 'B')] },
    ];
    const saved = await ctx.request(actors.alpha.actor, 'PUT', `/me/exam-records/${actors.alpha.started.data.record_id}/draft`, {
      revision: 1, answers: alphaAnswers,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    assert.equal(saved.data.revision, 1);
    assert.equal(saved.data.answered_count, 3);
    const durable = await ctx.queryTestDb(
      'SELECT (SELECT draft_revision FROM exam_record WHERE id = ?) AS revision, COUNT(*) AS answer_count FROM exam_answer WHERE exam_record_id = ?',
      [actors.alpha.started.data.record_id, actors.alpha.started.data.record_id],
    );
    assert.equal(Number(durable[0].revision), 1);
    assert.equal(Number(durable[0].answer_count), 3);
    await ctx.restartApi();
    const recovered = await ctx.request(actors.alpha.actor, 'GET', `/me/exam-records/${actors.alpha.started.data.record_id}`);
    assert.equal(recovered.status, 200, JSON.stringify(recovered));
    assert.equal(recovered.data.draft_revision, 1);
    assert.deepEqual(sortedAnswers(recovered.data.answers), sortedAnswers(alphaAnswers));
    const replay = await ctx.request(actors.alpha.actor, 'PUT', `/me/exam-records/${actors.alpha.started.data.record_id}/draft`, {
      revision: 1, answers: alphaAnswers,
    });
    assert.equal(replay.status, 200, JSON.stringify(replay));
    assert.deepEqual(replay.data, saved.data);
    const staleRevision = await ctx.request(actors.alpha.actor, 'PUT', `/me/exam-records/${actors.alpha.started.data.record_id}/draft`, {
      revision: 1, answers: [{ item_id: actors.alpha.byType.single.item_id, selected: [displayedIndex(actors.alpha.byType.single, 'B')] }],
    });
    assert.equal(staleRevision.status, 409, JSON.stringify(staleRevision));

    stage = 'manual submit saves latest draft atomically and finalizes objective score';
    const savedResult = await ctx.request(actors.alpha.actor, 'POST', `/me/exam-records/${actors.alpha.started.data.record_id}/submit`, {
      revision: 2, answers: alphaAnswers,
    });
    assert.equal(savedResult.status, 200, JSON.stringify(savedResult));
    assert.equal(savedResult.data.grading_state, 'finalized');
    assert.equal(savedResult.data.submission_method, 'manual');
    assert.equal(savedResult.data.score, 45);
    assert.equal(savedResult.data.legacy, false);
    const manualRetry = await ctx.request(actors.alpha.actor, 'POST', `/me/exam-records/${actors.alpha.started.data.record_id}/submit`, {
      revision: 99, answers: [],
    });
    assert.equal(manualRetry.status, 200, JSON.stringify(manualRetry));
    assert.deepEqual(manualRetry.data, savedResult.data);

    stage = 'objective draft submit finalizes automatically';
    const betaAnswers = [
      { item_id: actors.beta.byType.single.item_id, selected: [displayedIndex(actors.beta.byType.single, 'A')] },
      { item_id: actors.beta.byType.multiple.item_id, selected: [displayedIndex(actors.beta.byType.multiple, 'A')] },
      { item_id: actors.beta.byType.judgment.item_id, selected: [displayedIndex(actors.beta.byType.judgment, 'A')] },
    ];
    const betaSaved = await ctx.request(actors.beta.actor, 'PUT', `/me/exam-records/${actors.beta.started.data.record_id}/draft`, {
      revision: 1, answers: betaAnswers,
    });
    assert.equal(betaSaved.status, 200, JSON.stringify(betaSaved));
    const betaResult = await ctx.request(actors.beta.actor, 'POST', `/me/exam-records/${actors.beta.started.data.record_id}/submit`);
    assert.equal(betaResult.status, 200, JSON.stringify(betaResult));
    assert.equal(betaResult.data.grading_state, 'finalized');
    assert.equal(betaResult.data.score, 85);

    stage = 'deadline rejection and concurrent idempotent timeout finalization';
    const gammaAnswers = [{
      item_id: actors.gamma.byType.single.item_id,
      selected: [displayedIndex(actors.gamma.byType.single, 'A')],
    }];
    const gammaSaved = await ctx.request(actors.gamma.actor, 'PUT', `/me/exam-records/${actors.gamma.started.data.record_id}/draft`, {
      revision: 1, answers: gammaAnswers,
    });
    assert.equal(gammaSaved.status, 200, JSON.stringify(gammaSaved));
    await ctx.queryTestDb('UPDATE exam_record SET deadline_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?', [actors.gamma.started.data.record_id]);
    const afterDeadlineSave = await ctx.request(actors.gamma.actor, 'PUT', `/me/exam-records/${actors.gamma.started.data.record_id}/draft`, {
      revision: 2,
      answers: [{ item_id: actors.gamma.byType.single.item_id, selected: [displayedIndex(actors.gamma.byType.single, 'B')] }],
    });
    assert.equal(afterDeadlineSave.status, 409, JSON.stringify(afterDeadlineSave));
    const timeoutResults = await Promise.all(Array.from({ length: 8 }, () => ctx.request(
      actors.gamma.actor, 'POST', `/me/exam-records/${actors.gamma.started.data.record_id}/submit`, {
        revision: 2,
        answers: [{ item_id: actors.gamma.byType.single.item_id, selected: [displayedIndex(actors.gamma.byType.single, 'B')] }],
      },
    )));
    for (const response of timeoutResults) assert.equal(response.status, 200, JSON.stringify(response));
    for (const response of timeoutResults.slice(1)) assert.deepEqual(response.data, timeoutResults[0].data);
    assert.equal(timeoutResults[0].data.submission_method, 'timeout');
    assert.equal(timeoutResults[0].data.score, 30);
    const finalFacts = await ctx.queryTestDb(
      'SELECT submission_method, grading_state, score, active_assignment_id FROM exam_record WHERE id = ?',
      [actors.gamma.started.data.record_id],
    );
    assert.equal(finalFacts[0].submission_method, 'timeout');
    assert.equal(finalFacts[0].grading_state, 'finalized');
    assert.equal(Number(finalFacts[0].score), 30);
    assert.equal(finalFacts[0].active_assignment_id, null);
    const finalizationRows = await ctx.queryTestDb(
      'SELECT COUNT(*) AS row_count, COUNT(DISTINCT record_question_id) AS unique_items FROM exam_answer WHERE exam_record_id = ?',
      [actors.gamma.started.data.record_id],
    );
    assert.equal(Number(finalizationRows[0].row_count), 3);
    assert.equal(Number(finalizationRows[0].unique_items), 3);

    console.log(JSON.stringify({
      suite: 'training-submissions',
      restart_record_id: actors.alpha.started.data.record_id,
      finalized_record_id: actors.alpha.started.data.record_id,
      timeout_record_id: actors.gamma.started.data.record_id,
      assertions: 'persistent-draft,restart,revision,objective-auto-score,manual-timeout-idempotency',
    }));
  } catch (error) {
    error.message = `[training-submissions stage=${stage}] ${error.message}`;
    throw error;
  }
}

export async function run(ctx) {
  await runSubmissions(ctx);
}
