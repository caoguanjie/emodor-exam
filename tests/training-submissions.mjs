import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const bcrypt = require('bcryptjs');
const Redis = require('ioredis');

function suffix() { return randomBytes(5).toString('hex'); }
function password(label) { return `A9-${label}-${randomBytes(8).toString('hex')}`; }
function pngFixture() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
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
    'INSERT INTO question (regulation_id, version_id, category_id, difficulty, concept_id, current_version_id, type, stem, options, answer, analysis, rubric, score, status, source, created_by) VALUES (NULL, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [input.categoryId, 'easy', input.type, input.stem, JSON.stringify(input.options), JSON.stringify(input.answer),
      input.analysis ?? '<p>解析</p>', input.rubric ?? null, '25.00', 'approved', 'manual', input.actorId],
  );
  const questionId = String(question.insertId);
  const version = await ctx.queryTestDb(
    'INSERT INTO question_version (question_id, revision, category_id, difficulty, type, stem, options, answer, analysis, rubric, score_cents, concept_id, regulation_id, regulation_version_id, source_page_group, source_page_start, source_page_end, source, status, approved_by, approved_at, reviewed_by, reviewed_at, review_reason, created_by, legacy_captured_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 2500, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NOW(3), ?, NOW(3), NULL, ?, NULL)',
    [questionId, input.categoryId, 'easy', input.type, input.stem, JSON.stringify(input.options), JSON.stringify(input.answer),
      input.analysis ?? '<p>解析</p>', input.rubric ?? null, 'manual', 'approved', input.actorId, input.actorId, input.actorId],
  );
  const versionId = String(version.insertId);
  await ctx.queryTestDb('UPDATE question SET current_version_id = ? WHERE id = ?', [versionId, questionId]);
  return {
    questionId, versionId, revision: 1, categoryId: String(input.categoryId), difficulty: 'easy', type: input.type,
    stem: input.stem, options: input.options, answer: input.answer, analysis: input.analysis ?? '<p>解析</p>',
    rubric: input.rubric ?? null, scoreCents: 2500, source: 'manual', approvedBy: String(input.actorId),
    approvedAt: new Date().toISOString(),
  };
}

async function createPaper(ctx, { categoryId, actorId, pool, title }) {
  const rule = {
    totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5,
    rules: ['single', 'multiple', 'judgment', 'image'].map((type) => ({ type, count: 1, scoreCents: 2500 })),
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
      'INSERT INTO paper_release_question (release_id, question_id, question_version_id, concept_id, type, difficulty, score_cents, position, snapshot_json) VALUES (?, ?, ?, NULL, ?, ?, 2500, ?, ?)',
      [releaseId, item.questionId, item.versionId, item.type, item.difficulty, index, JSON.stringify(item)],
    );
  }
  return { paperId, releaseId };
}

async function uploadAnswerImage(ctx, actor, recordId, itemId, filename) {
  const boundary = `----ruleexam-c3-${randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="item_id"\r\n\r\n${itemId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    pngFixture(), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return ctx.request(actor, 'POST', `/me/exam-records/${recordId}/answer-images`, body, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  });
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
    ...(answer.asset_ids ? { asset_ids: answer.asset_ids.map(String) } : {}),
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
      await createQuestionVersion(ctx, { categoryId, actorId: adminId, type: 'single', stem: '<p>单选</p>', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0] }),
      await createQuestionVersion(ctx, { categoryId, actorId: adminId, type: 'multiple', stem: '<p>多选</p>', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }], answer: [0, 1] }),
      await createQuestionVersion(ctx, { categoryId, actorId: adminId, type: 'judgment', stem: '<p>判断</p>', options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [0] }),
      await createQuestionVersion(ctx, { categoryId, actorId: adminId, type: 'image', stem: '<p>图片作答</p>', options: [], answer: [], rubric: '<p>评分参考</p>' }),
    ];
    const paper = await createPaper(ctx, { categoryId, actorId: adminId, pool, title: `C3 四题型 ${runSuffix}` });

    stage = 'start three real attempts';
    for (const value of Object.values(actors)) {
      value.started = await ctx.request(value.actor, 'POST', `/me/exams/${paper.paperId}/start`);
      assert.equal(value.started.status, 200, JSON.stringify(value.started));
      assert.equal(value.started.data.questions.length, 4);
      value.byType = Object.fromEntries(value.started.data.questions.map((question) => [question.type, question]));
    }

    stage = 'heartbeat and switch persist server facts';
    const heartbeat = await ctx.request(actors.alpha.actor, 'POST', `/me/exam-records/${actors.alpha.started.data.record_id}/heartbeat`, {
      device_summary: 'c3-test-device',
    });
    assert.equal(heartbeat.status, 200, JSON.stringify(heartbeat));
    const switched = await ctx.request(actors.alpha.actor, 'POST', `/me/exam-records/${actors.alpha.started.data.record_id}/switch`);
    assert.equal(switched.status, 200, JSON.stringify(switched));
    assert.equal(switched.data.switch_count, 1);
    const liveFacts = await ctx.queryTestDb('SELECT last_heartbeat_at, device_summary, switch_count FROM exam_record WHERE id = ?', [actors.alpha.started.data.record_id]);
    assert.ok(liveFacts[0].last_heartbeat_at);
    assert.equal(liveFacts[0].device_summary, 'c3-test-device');
    assert.equal(Number(liveFacts[0].switch_count), 1);

    stage = 'answer image ownership and nine-image cap';
    const alphaImage = actors.alpha.byType.image;
    const alphaAssets = [];
    for (let index = 0; index < 10; index += 1) {
      const uploaded = await uploadAnswerImage(ctx, actors.alpha.actor, actors.alpha.started.data.record_id, alphaImage.item_id, `alpha-${index}.png`);
      assert.equal(uploaded.status, 200, JSON.stringify(uploaded));
      alphaAssets.push(String(uploaded.data.asset_id));
    }
    const tenthImage = await ctx.request(actors.alpha.actor, 'PUT', `/me/exam-records/${actors.alpha.started.data.record_id}/draft`, {
      revision: 1, answers: [{ item_id: alphaImage.item_id, asset_ids: alphaAssets }],
    });
    assert.equal(tenthImage.status, 400, JSON.stringify(tenthImage));
    const betaImage = actors.beta.byType.image;
    const betaUpload = await uploadAnswerImage(ctx, actors.beta.actor, actors.beta.started.data.record_id, betaImage.item_id, 'beta-unsaved.png');
    assert.equal(betaUpload.status, 200, JSON.stringify(betaUpload));
    const foreignAttachment = await ctx.request(actors.alpha.actor, 'PUT', `/me/exam-records/${actors.alpha.started.data.record_id}/draft`, {
      revision: 1, answers: [{ item_id: alphaImage.item_id, asset_ids: [String(betaUpload.data.asset_id)] }],
    });
    assert.equal(foreignAttachment.status, 403, JSON.stringify(foreignAttachment));

    stage = 'acknowledged full draft survives real restart';
    const alphaAnswers = [
      { item_id: actors.alpha.byType.single.item_id, selected: [displayedIndex(actors.alpha.byType.single, 'A')] },
      { item_id: actors.alpha.byType.multiple.item_id, selected: [displayedIndex(actors.alpha.byType.multiple, 'A')] },
      { item_id: actors.alpha.byType.judgment.item_id, selected: [displayedIndex(actors.alpha.byType.judgment, 'B')] },
      { item_id: alphaImage.item_id, asset_ids: alphaAssets.slice(0, 9) },
    ];
    const saved = await ctx.request(actors.alpha.actor, 'PUT', `/me/exam-records/${actors.alpha.started.data.record_id}/draft`, {
      revision: 1, answers: alphaAnswers,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    assert.equal(saved.data.revision, 1);
    assert.equal(saved.data.answered_count, 4);
    const durable = await ctx.queryTestDb(
      'SELECT (SELECT draft_revision FROM exam_record WHERE id = ?) AS revision, COUNT(*) AS answer_count FROM exam_answer WHERE exam_record_id = ?',
      [actors.alpha.started.data.record_id, actors.alpha.started.data.record_id],
    );
    assert.equal(Number(durable[0].revision), 1);
    assert.equal(Number(durable[0].answer_count), 4);
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

    stage = 'manual submit saves latest draft atomically and enters pending manual';
    const savedImageResult = await ctx.request(actors.alpha.actor, 'POST', `/me/exam-records/${actors.alpha.started.data.record_id}/submit`, {
      revision: 2, answers: alphaAnswers,
    });
    assert.equal(savedImageResult.status, 200, JSON.stringify(savedImageResult));
    assert.equal(savedImageResult.data.grading_state, 'pending_manual');
    assert.equal(savedImageResult.data.submission_method, 'manual');
    assert.equal(savedImageResult.data.score, null);
    assert.equal(savedImageResult.data.legacy, false);
    const manualRetry = await ctx.request(actors.alpha.actor, 'POST', `/me/exam-records/${actors.alpha.started.data.record_id}/submit`, {
      revision: 99, answers: [],
    });
    assert.equal(manualRetry.status, 200, JSON.stringify(manualRetry));
    assert.deepEqual(manualRetry.data, savedImageResult.data);

    stage = 'uploaded but unconfirmed image scores zero and loses its context reference';
    const betaAnswers = [
      { item_id: actors.beta.byType.single.item_id, selected: [displayedIndex(actors.beta.byType.single, 'A')] },
      { item_id: actors.beta.byType.multiple.item_id, selected: [displayedIndex(actors.beta.byType.multiple, 'A')] },
      { item_id: actors.beta.byType.judgment.item_id, selected: [displayedIndex(actors.beta.byType.judgment, 'A')] },
    ];
    const betaSaved = await ctx.request(actors.beta.actor, 'PUT', `/me/exam-records/${actors.beta.started.data.record_id}/draft`, {
      revision: 1, answers: betaAnswers,
    });
    assert.equal(betaSaved.status, 200, JSON.stringify(betaSaved));
    const uploadedButUnsavedImageScore = await ctx.request(actors.beta.actor, 'POST', `/me/exam-records/${actors.beta.started.data.record_id}/submit`);
    assert.equal(uploadedButUnsavedImageScore.status, 200, JSON.stringify(uploadedButUnsavedImageScore));
    assert.equal(uploadedButUnsavedImageScore.data.grading_state, 'finalized');
    assert.equal(uploadedButUnsavedImageScore.data.score, 62.5);
    const unconfirmedReference = await ctx.queryTestDb(
      'SELECT COUNT(*) AS count FROM media_reference WHERE asset_id = ? AND owner_type = ?',
      [String(betaUpload.data.asset_id), 'exam_answer_item'],
    );
    assert.equal(Number(unconfirmedReference[0].count), 0);

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
    assert.equal(timeoutResults[0].data.score, 25);
    const finalFacts = await ctx.queryTestDb(
      'SELECT submission_method, grading_state, score, active_assignment_id FROM exam_record WHERE id = ?',
      [actors.gamma.started.data.record_id],
    );
    assert.equal(finalFacts[0].submission_method, 'timeout');
    assert.equal(finalFacts[0].grading_state, 'finalized');
    assert.equal(Number(finalFacts[0].score), 25);
    assert.equal(finalFacts[0].active_assignment_id, null);
    const finalizationRows = await ctx.queryTestDb(
      'SELECT COUNT(*) AS row_count, COUNT(DISTINCT record_question_id) AS unique_items FROM exam_answer WHERE exam_record_id = ?',
      [actors.gamma.started.data.record_id],
    );
    assert.equal(Number(finalizationRows[0].row_count), 4);
    assert.equal(Number(finalizationRows[0].unique_items), 4);

    console.log(JSON.stringify({
      suite: 'training-submissions',
      restart_record_id: actors.alpha.started.data.record_id,
      pending_record_id: actors.alpha.started.data.record_id,
      timeout_record_id: actors.gamma.started.data.record_id,
      assertions: 'persistent-draft,restart,revision,image-owner,9-image,manual-timeout-idempotency,unconfirmed-image',
    }));
  } catch (error) {
    error.message = `[training-submissions stage=${stage}] ${error.message}`;
    throw error;
  }
}

export async function run(ctx) {
  await runSubmissions(ctx);
}
