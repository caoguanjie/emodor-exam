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
    username, password: userPassword, captcha_id: captcha.data.captcha_id, captcha_code: answer,
  }, headers);
  assert.equal(response.status, 200, `${label} login: ${JSON.stringify(response)}`);
  actor.accessToken = response.data.access_token;
  return actor;
}

async function createUser(ctx, input) {
  const hash = await bcrypt.hash(input.password, 4);
  const inserted = await ctx.queryTestDb(
    'INSERT INTO sys_user (username, password_hash, real_name, category_id, source, role, status, force_password_change, roles_configured) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)',
    [input.username, hash, input.realName, input.categoryId, input.source, input.role || 'employee', input.rolesConfigured ? 1 : 0],
  );
  return String(inserted.insertId);
}

async function grantRole(ctx, userId, code, permissions) {
  const inserted = await ctx.queryTestDb(
    'INSERT INTO sys_role (code, name, is_system, status) VALUES (?, ?, 0, 1)',
    [code, code],
  );
  const roleId = String(inserted.insertId);
  for (const permissionCode of permissions) {
    const rows = await ctx.queryTestDb('SELECT id FROM sys_permission WHERE code = ?', [permissionCode]);
    assert.equal(rows.length, 1, `permission ${permissionCode} must be registered by init`);
    await ctx.queryTestDb('INSERT INTO sys_role_permission (role_id, permission_id) VALUES (?, ?)', [roleId, String(rows[0].id)]);
  }
  await ctx.queryTestDb('INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [userId, roleId]);
}

async function createQuestionVersion(ctx, input) {
  const question = await ctx.queryTestDb(
    'INSERT INTO question (regulation_id, version_id, category_id, difficulty, concept_id, current_version_id, type, stem, options, answer, analysis, rubric, score, status, source, created_by) VALUES (NULL, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, 50.00, ?, ?, ?)',
    [input.categoryId, 'easy', input.type, input.stem, JSON.stringify(input.options), JSON.stringify(input.answer),
      input.analysis ?? '<p>解析</p>', input.rubric ?? null, 'approved', 'manual', input.actorId],
  );
  const questionId = String(question.insertId);
  const version = await ctx.queryTestDb(
    'INSERT INTO question_version (question_id, revision, category_id, difficulty, type, stem, options, answer, analysis, rubric, score_cents, concept_id, regulation_id, regulation_version_id, source_page_group, source_page_start, source_page_end, source, status, approved_by, approved_at, reviewed_by, reviewed_at, review_reason, created_by, legacy_captured_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 5000, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, NOW(3), ?, NOW(3), NULL, ?, NULL)',
    [questionId, input.categoryId, 'easy', input.type, input.stem, JSON.stringify(input.options), JSON.stringify(input.answer),
      input.analysis ?? '<p>解析</p>', input.rubric ?? null, 'manual', 'approved', input.actorId, input.actorId, input.actorId],
  );
  const versionId = String(version.insertId);
  await ctx.queryTestDb('UPDATE question SET current_version_id = ? WHERE id = ?', [versionId, questionId]);
  return {
    questionId, versionId, revision: 1, categoryId: String(input.categoryId), difficulty: 'easy', type: input.type,
    stem: input.stem, options: input.options, answer: input.answer, analysis: input.analysis ?? '<p>解析</p>',
    rubric: input.rubric ?? null, scoreCents: 5000, source: 'manual', approvedBy: String(input.actorId),
    approvedAt: new Date().toISOString(),
  };
}

async function createPaper(ctx, { categoryId, actorId, pool, title }) {
  const rule = {
    totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5,
    rules: [{ type: 'single', count: 1, scoreCents: 5000 }, { type: 'image', count: 1, scoreCents: 5000 }],
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
      'INSERT INTO paper_release_question (release_id, question_id, question_version_id, concept_id, type, difficulty, score_cents, position, snapshot_json) VALUES (?, ?, ?, NULL, ?, ?, 5000, ?, ?)',
      [releaseId, item.questionId, item.versionId, item.type, item.difficulty, index, JSON.stringify(item)],
    );
  }
  return { paperId, releaseId };
}

async function uploadAnswerImage(ctx, actor, recordId, itemId) {
  const boundary = `----ruleexam-c5-${randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="item_id"\r\n\r\n${itemId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="answer.png"\r\nContent-Type: image/png\r\n\r\n`),
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

function forbiddenKeys(value, forbidden, path = '$', found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenKeys(item, forbidden, `${path}[${index}]`, found));
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.includes(key)) found.push(`${path}.${key}`);
    forbiddenKeys(child, forbidden, `${path}.${key}`, found);
  }
  return found;
}

async function runMonitor(ctx) {
  let stage = 'fixtures';
  const runSuffix = suffix();
  try {
    const adminPassword = password('admin');
    const adminId = await createUser(ctx, {
      username: `c5_admin_${runSuffix}`, password: adminPassword, realName: 'C5 管理员',
      categoryId: null, source: null, role: 'super_admin',
    });
    const admin = await login(ctx, `c5_admin_${runSuffix}`, adminPassword, 'admin');
    const category = await ctx.queryTestDb(
      'INSERT INTO training_category (name, description, status, created_by) VALUES (?, NULL, 1, ?)',
      [`C5 类别 ${runSuffix}`, adminId],
    );
    const categoryId = String(category.insertId);

    const learners = {};
    for (const label of ['alpha', 'beta']) {
      const userPassword = password(label);
      const username = `c5_${label}_${runSuffix}`;
      const userId = await createUser(ctx, {
        username, password: userPassword, realName: `C5 ${label}`, categoryId, source: 'institution',
      });
      learners[label] = { userId, actor: await login(ctx, username, userPassword, label) };
    }
    const single = await createQuestionVersion(ctx, {
      categoryId, actorId: adminId, type: 'single', stem: '<p>C5 单选</p>',
      options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }], answer: [0],
    });
    const image = await createQuestionVersion(ctx, {
      categoryId, actorId: adminId, type: 'image', stem: '<p>C5 图片作答</p>', options: [], answer: [], rubric: '<p>评分参考</p>',
    });
    const paper = await createPaper(ctx, { categoryId, actorId: adminId, pool: [single, image], title: `C5 监控卷 ${runSuffix}` });

    const readPassword = password('read');
    const readUserId = await createUser(ctx, {
      username: `c5_read_${runSuffix}`, password: readPassword, realName: 'C5 记录管理员',
      categoryId: null, source: null, rolesConfigured: true,
    });
    await grantRole(ctx, readUserId, `c5_read_${runSuffix}`, ['exam_records:read']);
    const readActor = await login(ctx, `c5_read_${runSuffix}`, readPassword, 'record reader');

    const monitorPassword = password('monitor');
    const monitorUserId = await createUser(ctx, {
      username: `c5_monitor_${runSuffix}`, password: monitorPassword, realName: 'C5 监控管理员',
      categoryId: null, source: null, rolesConfigured: true,
    });
    await grantRole(ctx, monitorUserId, `c5_monitor_${runSuffix}`, ['exam_records:monitor']);
    const monitorActor = await login(ctx, `c5_monitor_${runSuffix}`, monitorPassword, 'monitor reader');

    stage = 'two real attempts and acknowledged drafts';
    for (const learner of Object.values(learners)) {
      learner.started = await ctx.request(learner.actor, 'POST', `/me/exams/${paper.paperId}/start`);
      assert.equal(learner.started.status, 200, JSON.stringify(learner.started));
      assert.equal(learner.started.data.questions.length, 2);
      learner.byType = Object.fromEntries(learner.started.data.questions.map((question) => [question.type, question]));
    }
    const alphaAnswers = [{
      item_id: learners.alpha.byType.single.item_id,
      selected: [displayedIndex(learners.alpha.byType.single, 'A')],
    }];
    const alphaSaved = await ctx.request(learners.alpha.actor, 'PUT', `/me/exam-records/${learners.alpha.started.data.record_id}/draft`, {
      revision: 1, answers: alphaAnswers,
    });
    assert.equal(alphaSaved.status, 200, JSON.stringify(alphaSaved));
    assert.equal(alphaSaved.data.answered_count, 1);
    const alphaHeartbeat = await ctx.request(learners.alpha.actor, 'POST', `/me/exam-records/${learners.alpha.started.data.record_id}/heartbeat`, {
      device_summary: 'Chrome 130 / macOS',
    });
    assert.equal(alphaHeartbeat.status, 200, JSON.stringify(alphaHeartbeat));
    const alphaSwitch = await ctx.request(learners.alpha.actor, 'POST', `/me/exam-records/${learners.alpha.started.data.record_id}/switch`);
    assert.equal(alphaSwitch.status, 200, JSON.stringify(alphaSwitch));
    assert.equal(alphaSwitch.data.switch_count, 1);

    const betaUpload = await uploadAnswerImage(
      ctx, learners.beta.actor, learners.beta.started.data.record_id, learners.beta.byType.image.item_id,
    );
    assert.equal(betaUpload.status, 200, JSON.stringify(betaUpload));
    const betaAnswers = [
      { item_id: learners.beta.byType.single.item_id, selected: [displayedIndex(learners.beta.byType.single, 'B')] },
      { item_id: learners.beta.byType.image.item_id, asset_ids: [String(betaUpload.data.asset_id)] },
    ];
    const betaSaved = await ctx.request(learners.beta.actor, 'PUT', `/me/exam-records/${learners.beta.started.data.record_id}/draft`, {
      revision: 1, answers: betaAnswers,
    });
    assert.equal(betaSaved.status, 200, JSON.stringify(betaSaved));
    assert.equal(betaSaved.data.answered_count, 2);
    await ctx.queryTestDb('UPDATE sys_user SET source = ? WHERE id IN (?, ?)', [
      'external', learners.alpha.userId, learners.beta.userId,
    ]);

    stage = 'independent API permissions and navigation';
    const readList = await ctx.request(readActor, 'GET', `/admin/exam-records?paper_id=${paper.paperId}&page=1&page_size=1`);
    assert.equal(readList.status, 200, JSON.stringify(readList));
    assert.equal(readList.data.total, 2);
    assert.equal(readList.data.items.length, 1);
    const readSecondPage = await ctx.request(readActor, 'GET', `/admin/exam-records?paper_id=${paper.paperId}&page=2&page_size=1`);
    assert.equal(readSecondPage.status, 200, JSON.stringify(readSecondPage));
    assert.equal(readSecondPage.data.total, 2);
    assert.notEqual(readSecondPage.data.items[0].record_id, readList.data.items[0].record_id);
    const frozenFilter = await ctx.request(readActor, 'GET', `/admin/exam-records?paper_id=${paper.paperId}&source=institution&page=1&page_size=20`);
    assert.equal(frozenFilter.status, 200, JSON.stringify(frozenFilter));
    assert.equal(frozenFilter.data.total, 2, 'record source must remain frozen after user source changes');
    const invalidPageSize = await ctx.request(readActor, 'GET', '/admin/exam-records?page=1&page_size=101');
    assert.equal(invalidPageSize.status, 400, JSON.stringify(invalidPageSize));
    const unknownQuery = await ctx.request(readActor, 'GET', '/admin/exam-records?page=1&unexpected=1');
    assert.equal(unknownQuery.status, 400, JSON.stringify(unknownQuery));
    const readMonitorDenied = await ctx.request(readActor, 'GET', `/admin/exams/${paper.paperId}/monitor`);
    assert.equal(readMonitorDenied.status, 403, JSON.stringify(readMonitorDenied));
    const monitorRecordsDenied = await ctx.request(monitorActor, 'GET', '/admin/exam-records');
    assert.equal(monitorRecordsDenied.status, 403, JSON.stringify(monitorRecordsDenied));
    const options = await ctx.request(monitorActor, 'GET', '/admin/exams/monitor-options?page=1&page_size=100');
    assert.equal(options.status, 200, JSON.stringify(options));
    assert(options.data.items.some((item) => String(item.id) === paper.paperId));

    const readNavigation = await ctx.request(readActor, 'GET', '/admin/menus/navigation');
    assert.equal(readNavigation.status, 200, JSON.stringify(readNavigation));
    assert.equal(JSON.stringify(readNavigation.data).includes('/admin/exam-records'), true);
    assert.equal(JSON.stringify(readNavigation.data).includes('/admin/exam-monitor'), false);
    const monitorNavigation = await ctx.request(monitorActor, 'GET', '/admin/menus/navigation');
    assert.equal(monitorNavigation.status, 200, JSON.stringify(monitorNavigation));
    assert.equal(JSON.stringify(monitorNavigation.data).includes('/admin/exam-monitor'), true);
    assert.equal(JSON.stringify(monitorNavigation.data).includes('/admin/exam-records'), false);

    stage = 'safe monitor and metadata projections';
    const live = await ctx.request(monitorActor, 'GET', `/admin/exams/${paper.paperId}/monitor?page=1&page_size=20`);
    assert.equal(live.status, 200, JSON.stringify(live));
    assert.equal(live.data.total, 2);
    assert.deepEqual(forbiddenKeys(live.data, ['answer', 'correct_answer', 'analysis', 'rubric', 'asset_ids']), []);
    const alphaLive = live.data.items.find((item) => item.record_id === learners.alpha.started.data.record_id);
    const betaLive = live.data.items.find((item) => item.record_id === learners.beta.started.data.record_id);
    assert(alphaLive && betaLive, JSON.stringify(live));
    assert.equal(alphaLive.answered_count, 1);
    assert.equal(betaLive.answered_count, 2);
    assert.equal(alphaLive.total_count, 2);
    assert.equal(betaLive.total_count, 2);
    assert.equal(alphaLive.connection_state, 'connected');
    assert.equal(betaLive.connection_state, 'uncertain');
    assert.equal(alphaLive.switch_count, 1);
    assert.equal(alphaLive.device_summary, 'Chrome 130 / macOS');
    assert.equal(alphaLive.source, 'institution');
    assert.equal(alphaLive.difficulty, 'easy');
    assert(alphaLive.remaining_seconds >= 0);

    const alphaDetail = await ctx.request(readActor, 'GET', `/admin/exam-records/${alphaLive.record_id}`);
    assert.equal(alphaDetail.status, 200, JSON.stringify(alphaDetail));
    assert.equal(alphaDetail.data.answered_count, 1);
    assert.deepEqual(forbiddenKeys(alphaDetail.data, ['answer', 'correct_answer', 'analysis', 'rubric', 'asset_ids']), []);
    const readerImageDenied = await ctx.request(readActor, 'GET', `/media/${betaUpload.data.asset_id}/content`);
    assert.equal(readerImageDenied.status, 403, JSON.stringify(readerImageDenied));
    const ownerImage = await ctx.request(learners.beta.actor, 'GET', `/media/${betaUpload.data.asset_id}/content`);
    assert.equal(ownerImage.status, 200);

    stage = 'stale heartbeat and terminal transitions';
    await ctx.queryTestDb('UPDATE exam_record SET last_heartbeat_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 91 SECOND) WHERE id = ?', [alphaLive.record_id]);
    const stale = await ctx.request(monitorActor, 'GET', `/admin/exams/${paper.paperId}/monitor?page=1&page_size=20`);
    assert.equal(stale.status, 200, JSON.stringify(stale));
    assert.equal(stale.data.items.find((item) => item.record_id === alphaLive.record_id).connection_state, 'uncertain');

    const alphaSubmitted = await ctx.request(learners.alpha.actor, 'POST', `/me/exam-records/${alphaLive.record_id}/submit`);
    assert.equal(alphaSubmitted.status, 200, JSON.stringify(alphaSubmitted));
    assert.equal(alphaSubmitted.data.grading_state, 'finalized');
    const betaSubmitted = await ctx.request(learners.beta.actor, 'POST', `/me/exam-records/${betaLive.record_id}/submit`);
    assert.equal(betaSubmitted.status, 200, JSON.stringify(betaSubmitted));
    assert.equal(betaSubmitted.data.grading_state, 'pending_manual');

    const terminal = await ctx.request(monitorActor, 'GET', `/admin/exams/${paper.paperId}/monitor?page=1&page_size=20`);
    assert.equal(terminal.status, 200, JSON.stringify(terminal));
    const alphaTerminal = terminal.data.items.find((item) => item.record_id === alphaLive.record_id);
    const betaTerminal = terminal.data.items.find((item) => item.record_id === betaLive.record_id);
    assert.equal(alphaTerminal.connection_state, 'ended');
    assert.equal(alphaTerminal.grading_state, 'finalized');
    assert.equal(alphaTerminal.submission_method, 'manual');
    assert.equal(betaTerminal.connection_state, 'ended');
    assert.equal(betaTerminal.status, 'submitted');
    assert.equal(betaTerminal.grading_state, 'pending_manual');
    assert.equal(betaTerminal.submission_method, 'manual');
    assert.deepEqual(forbiddenKeys(terminal.data, ['answer', 'correct_answer', 'analysis', 'rubric', 'asset_ids']), []);

    const terminalRecords = await ctx.request(readActor, 'GET', `/admin/exam-records?paper_id=${paper.paperId}&page=1&page_size=20`);
    assert.equal(terminalRecords.status, 200, JSON.stringify(terminalRecords));
    const alphaRecord = terminalRecords.data.items.find((item) => item.record_id === alphaLive.record_id);
    const betaRecord = terminalRecords.data.items.find((item) => item.record_id === betaLive.record_id);
    assert.equal(alphaRecord.score, 50);
    assert.equal(betaRecord.score, null);
    assert.equal(betaRecord.grading_state, 'pending_manual');

    console.log(JSON.stringify({
      suite: 'training-monitor', paper_id: paper.paperId,
      connected_record_id: alphaLive.record_id, pending_record_id: betaLive.record_id,
      assertions: 'permissions,pagination,frozen-facts,ack-count,90s-stale,safe-payload,answer-media,terminal-transition',
    }));
  } catch (error) {
    error.message = `[training-monitor stage=${stage}] ${error.message}`;
    throw error;
  }
}

export async function run(ctx) {
  await runMonitor(ctx);
}
