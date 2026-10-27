import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './training-access.mjs';
import { assertAttemptView, assertPureTimeout, assertTimeoutFacts, examLearner } from './support/exam-mobile-fixtures.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');

async function captchaAnswer(ctx, captchaId) {
  const redis = new Redis({
    host: ctx.env.REDIS_HOST,
    port: Number(ctx.env.REDIS_PORT),
    password: ctx.env.REDIS_PASSWORD || undefined,
  });
  try { return await redis.get(`${ctx.env.REDIS_KEY_PREFIX || ''}auth:captcha:${captchaId}`); }
  finally { await redis.quit(); }
}

async function login(ctx, username, password, label) {
  const headers = { 'X-Forwarded-For': `198.51.100.${(login.sequence = (login.sequence || 150) + 1)}` };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert.equal(captcha.status, 200, `${label} captcha: ${JSON.stringify(captcha)}`);
  const actor = {};
  const response = await ctx.request(actor, 'POST', '/auth/login', {
    username,
    password,
    captcha_id: captcha.data.captcha_id,
    captcha_code: await captchaAnswer(ctx, captcha.data.captcha_id),
  }, headers);
  assert.equal(response.status, 200, `${label} login: ${JSON.stringify(response)}`);
  actor.accessToken = response.data.access_token;
  if (!response.data.force_change_password) return { actor, id: String(response.data.user.id), password };
  const nextPassword = randomStrongPassword(username, label);
  const changed = await ctx.request(actor, 'PUT', '/auth/password', {
    old_password: password,
    new_password: nextPassword,
  });
  assert.equal(changed.status, 200, `${label} password: ${JSON.stringify(changed)}`);
  actor.accessToken = changed.data.access_token;
  return { actor, id: String(response.data.user.id), password: nextPassword };
}

function assertNoSecrets(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.equal([
      'answer', 'analysis', 'rubric', 'snapshot_json', 'display_to_original',
      'connection_state', 'last_heartbeat_at', 'switch_count', 'device_summary',
    ].includes(key), false, `record projection leaked ${key}`);
    assertNoSecrets(item);
  }
}

async function assertSimplifiedRecordQueries(ctx, { admin, reader, learner, suffix }) {
  const historicalCategory = await ctx.queryTestDb(
    'INSERT INTO training_category(name,status,created_by) VALUES (?,0,?)',
    [`历史停用类别 ${suffix}`, admin.id],
  );
  const categoryId = String(historicalCategory.insertId);
  const unusedCategory = await ctx.queryTestDb(
    'INSERT INTO training_category(name,status,created_by) VALUES (?,0,?)',
    [`无记录停用类别 ${suffix}`, admin.id],
  );
  const activeCategory = await ctx.queryTestDb(
    'INSERT INTO training_category(name,status,created_by) VALUES (?,1,?)',
    [`无记录有效类别 ${suffix}`, admin.id],
  );
  const historicalPaper = await ctx.queryTestDb(
    "INSERT INTO exam_paper(title,business_scope,category_id,status,total_score,created_by) VALUES (?,'training',?,'archived',200,?)",
    [`历史归档卷 ${suffix}`, activeCategory.insertId, admin.id],
  );
  const paperId = String(historicalPaper.insertId);
  const unusedPaper = await ctx.queryTestDb(
    "INSERT INTO exam_paper(title,status,created_by) VALUES (?,'archived',?)",
    [`无记录归档卷 ${suffix}`, admin.id],
  );
  const activePaper = await ctx.queryTestDb(
    "INSERT INTO exam_paper(title,status,created_by) VALUES (?,'draft',?)",
    [`无记录有效卷 ${suffix}`, admin.id],
  );
  const rule = JSON.stringify({ totalCents: 15000, passCents: 9000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5, rules: [] });
  // Keep the in-progress fixture beyond the expiry sweeper's real clock.
  const submittedAt = '2099-03-01 08:20:00.000';
  const rows = [
    { key: 'before', status: 'passed', grading: 'finalized', score: 100, submitted: submittedAt, started: '2099-02-28 15:59:59.999', result: 'passed' },
    { key: 'start', status: 'in_progress', grading: 'not_submitted', score: 0, submitted: null, started: '2099-02-28 16:00:00.000', result: 'in_progress' },
    { key: 'passed', status: 'passed', grading: 'finalized', score: 100, submitted: submittedAt, result: 'passed' },
    { key: 'zero', status: 'failed', grading: 'finalized', score: 0, submitted: submittedAt, result: 'failed' },
    { key: 'timeout', status: 'timeout', grading: 'not_submitted', score: 0, submitted: null, result: 'timeout' },
    { key: 'pending', status: 'submitted', grading: 'not_submitted', score: 0, submitted: submittedAt, result: null },
    { key: 'scored', status: 'timeout', grading: 'finalized', score: 0, submitted: submittedAt, result: null },
    { key: 'missing_score', status: 'timeout', grading: 'finalized', score: null, submitted: submittedAt, result: 'timeout' },
    { key: 'missing_submission', status: 'timeout', grading: 'finalized', score: 0, submitted: null, started: '2099-03-01 15:59:59.999', result: 'timeout' },
    { key: 'end', status: 'passed', grading: 'finalized', score: 100, submitted: submittedAt, started: '2099-03-01 16:00:00.000', result: 'passed' },
  ];
  for (const [index, row] of rows.entries()) {
    const startedAt = row.started || '2099-03-01 08:00:00.000';
    const inserted = await ctx.queryTestDb(
      `INSERT INTO exam_record(paper_id,user_id,category_id,source,difficulty,rule_snapshot,attempt_no,status,score,started_at,deadline_at,submitted_at,grading_state)
       VALUES (?,?,?,'institution','medium',?,?,?,?,?,DATE_ADD(?,INTERVAL 30 MINUTE),?,?)`,
      [paperId, learner.actor.userId, categoryId, row.key === 'end' ? null : rule, index + 10, row.status, row.score, startedAt, startedAt, row.submitted, row.grading],
    );
    row.id = String(inserted.insertId);
  }
  const visibleRows = rows.filter(row => row.result !== null);
  async function query(filters = {}) {
    const params = new URLSearchParams({ paper_id: paperId, user_id: String(learner.actor.userId), category_id: categoryId, ...filters });
    const response = await ctx.request(reader.actor, 'GET', `/admin/exam-records?${params}`);
    assert.equal(response.status, 200, JSON.stringify(response));
    assertNoSecrets(response.data);
    return response.data;
  }
  const all = await query();
  assert.equal(all.total, visibleRows.length, 'administrator pagination excludes submitted and scored historical timeout records');
  for (const row of visibleRows) {
    const projected = all.items.find(item => item.record_id === row.id);
    assert.ok(projected, `missing ${row.key}`);
    assert.equal(projected.result_status, row.result, row.key);
    assert.equal(projected.result_status, projected.status, 'administrator result_status retains only the four current states');
    assert.equal(projected.total_score, row.key === 'end' ? null : 150, 'total uses frozen snapshot, not current 200-point paper');
    assert.equal(projected.category_name, `历史停用类别 ${suffix}`, 'name follows frozen record category, not current paper/user category');
    assert.equal(projected.score, row.score, 'real zero and nullable scoring facts are preserved');
  }
  assert.equal((await query({ user_id: reader.id })).total, 0, 'user filter uses the exact internal ID');
  assert.equal((await query({ category_id: String(activeCategory.insertId) })).total, 0, 'category filter uses the frozen record category');
  assert.equal((await query({ status: 'submitted' })).total, 0, 'the compatible raw status filter cannot expose excluded records');
  for (const result_status of ['in_progress', 'passed', 'failed', 'timeout']) {
    const result = await query({ result_status });
    assert.equal(result.total, visibleRows.filter(row => row.result === result_status).length, result_status);
    assert.deepEqual(result.items.map(item => item.record_id).sort(), visibleRows.filter(row => row.result === result_status).map(row => row.id).sort(), result_status);
  }
  const day = await query({ date_from: '2099-03-01', date_to: '2099-03-01' });
  assert.deepEqual(day.items.map(item => item.record_id).sort(), visibleRows.filter(row => !['before', 'end'].includes(row.key)).map(row => row.id).sort(), 'Beijing midnight is inclusive; next midnight is exclusive');
  assert.equal((await query({ date_from: '2099-03-01' })).total, visibleRows.length - 1);
  assert.equal((await query({ date_to: '2099-03-01' })).total, visibleRows.length - 1);

  const zeroDetail = await ctx.request(reader.actor, 'GET', `/admin/exam-records/${rows.find(row => row.key === 'zero').id}`);
  assert.equal(zeroDetail.status, 200, JSON.stringify(zeroDetail));
  assert.equal(zeroDetail.data.result_status, 'failed');
  assert.equal(zeroDetail.data.score, 0);
  assert.equal(zeroDetail.data.total_score, 150);
  assert.equal(zeroDetail.data.category_name, `历史停用类别 ${suffix}`);
  const learnerHistory = await ctx.request(learner.actor, 'GET', '/me/exam-records?page=1&page_size=100');
  assert.equal(learnerHistory.status, 200, JSON.stringify(learnerHistory));
  for (const row of rows.filter(row => row.result === null)) {
    assert.equal(all.items.some(item => item.record_id === row.id), false, `${row.key} is absent from the administrator list`);
    for (const path of [`/admin/exam-records/${row.id}`, `/admin/exam-records/${row.id}/result`]) {
      const excluded = await ctx.request(reader.actor, 'GET', path);
      assert.equal(excluded.status, 404, `${path}: ${JSON.stringify(excluded)}`);
      assert.equal(excluded.code, 40401);
    }
    const preserved = learnerHistory.data.items.find(item => item.record_id === row.id);
    assert.ok(preserved, `${row.key} remains in the shared learner history`);
    assert.equal(preserved.status, row.status);
    const learnerResult = await ctx.request(learner.actor, 'GET', `/me/exam-records/${row.id}/result`);
    assert.equal(learnerResult.status, 200, JSON.stringify(learnerResult));
    assert.equal(learnerResult.data.status, row.status, 'shared historical results retain their original status');
  }

  const options = await ctx.request(reader.actor, 'GET', '/admin/exam-records/options');
  assert.equal(options.status, 200, 'a records-only reader can load options without statistics/papers/students permissions');
  for (const id of [paperId, String(activePaper.insertId)]) assert.ok(options.data.papers.some(item => item.id === id));
  for (const id of [categoryId, String(activeCategory.insertId)]) assert.ok(options.data.categories.some(item => item.id === id));
  assert.equal(options.data.papers.some(item => item.id === String(unusedPaper.insertId)), false);
  assert.equal(options.data.categories.some(item => item.id === String(unusedCategory.insertId)), false);
  const denied = await ctx.request(learner.actor, 'GET', '/admin/exam-records/options');
  assert.equal(denied.status, 403);
  for (const filters of [
    { date_from: '2026-02-29' }, { date_to: '2026-04-31' }, { date_from: '2026-3-01' },
    { date_from: '2026-03-02', date_to: '2026-03-01' }, { user_id: '0' }, { category_id: '-1' },
    { result_status: 'submitted' }, { result_status: 'legacy_pending' }, { result_status: 'legacy_scored' },
  ]) {
    const response = await ctx.request(reader.actor, 'GET', `/admin/exam-records?${new URLSearchParams(filters)}`);
    assert.equal(response.status, 400, JSON.stringify(filters));
    assert.equal(response.code, 40001, JSON.stringify(response));
  }
}

export async function run(ctx) {
  const suffix = randomBytes(4).toString('hex');
  const admin = await login(ctx, 'admin', ctx.adminPassword, 'records admin');
  const category = await ctx.request(admin.actor, 'POST', '/admin/training-categories', {
    name: `记录回归类别 ${suffix}`,
  });
  assert.equal(category.status, 200, JSON.stringify(category));
  const categoryId = String(category.data.id);

  const readerRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `records_reader_${suffix}`,
    name: `记录只读 ${suffix}`,
    permissions: ['exam_records:read'],
  });
  assert.equal(readerRole.status, 200, JSON.stringify(readerRole));
  const readerUsername = `records_reader_${suffix}`;
  const readerPassword = randomStrongPassword(readerUsername, '记录只读');
  const readerCreated = await ctx.request(admin.actor, 'POST', '/admin/administrators', {
    username: readerUsername,
    password: readerPassword,
    real_name: `记录只读员${suffix}`,
    role_ids: [String(readerRole.data.id)],
  });
  assert.equal(readerCreated.status, 200, JSON.stringify(readerCreated));
  const reader = await login(ctx, readerUsername, readerPassword, 'records reader');

  const learnerUsername = `records_learner_${suffix}`;
  const learner = { actor: await examLearner(ctx, { categoryId, username: learnerUsername }) };

  const question = await ctx.request(admin.actor, 'POST', '/ai/questions', {
    category_id: categoryId,
    difficulty: 'easy',
    type: 'single',
    stem: `<p>记录回归题 ${suffix}</p>`,
    options: [{ text: '正确项' }, { text: '错误项' }],
    answer: [0],
    analysis: '<p>记录回归解析</p>',
  });
  assert.equal(question.status, 200, JSON.stringify(question));
  const paper = await ctx.request(admin.actor, 'POST', '/admin/papers', {
    title: `记录回归卷 ${suffix}`,
    mode: 'fixed',
    category_id: categoryId,
  });
  assert.equal(paper.status, 200, JSON.stringify(paper));
  const paperId = String(paper.data.id);
  const selected = await ctx.request(admin.actor, 'PUT', `/admin/papers/${paperId}/questions`, {
    items: [{ question_version_id: String(question.data.saved_version_id), score_cents: 10000 }],
  });
  assert.equal(selected.status, 200, JSON.stringify(selected));
  const published = await ctx.request(admin.actor, 'POST', `/admin/papers/${paperId}/publish`);
  assert.equal(published.status, 200, JSON.stringify(published));

  const started = await ctx.request(learner.actor, 'POST', `/me/exams/${paperId}/start`);
  assert.equal(started.status, 200, JSON.stringify(started));
  assertAttemptView(started.data);
  const recordId = String(started.data.record_id);
  const item = started.data.questions[0];
  const submitted = await ctx.request(learner.actor, 'POST', `/me/exam-records/${recordId}/submit`, {
    record_id: recordId,
    answers: [{ item_id: item.item_id, option_ids: ['A'] }],
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted));
  assert.equal(submitted.data.grading_state, 'finalized');
  assert.equal(submitted.data.score, 100);
  assert.equal(submitted.data.legacy, false, 'newly authored question freezes v2 content');
  assert.deepEqual(submitted.data.items[0].selected_option_ids, ['A']);
  assert.deepEqual(submitted.data.items[0].correct_option_ids, ['A']);

  const denied = await ctx.request(learner.actor, 'GET', '/admin/exam-records');
  assert.equal(denied.status, 403, JSON.stringify(denied));
  const list = await ctx.request(
    reader.actor,
    'GET',
    `/admin/exam-records?page=1&page_size=20&paper_id=${paperId}&status=passed&grading_state=finalized&keyword=${learnerUsername}`,
  );
  assert.equal(list.status, 200, JSON.stringify(list));
  assert.equal(list.data.total, 1);
  assert.equal(String(list.data.items[0].record_id), recordId);
  assert.equal(list.data.items[0].answered_count, 1);
  assert.equal(list.data.items[0].total_count, 1);
  assert.equal(list.data.items[0].category_name, `记录回归类别 ${suffix}`);
  assert.equal(list.data.items[0].total_score, 100);
  assert.equal(list.data.items[0].result_status, 'passed');
  assertNoSecrets(list.data);

  const detail = await ctx.request(reader.actor, 'GET', `/admin/exam-records/${recordId}`);
  assert.equal(detail.status, 200, JSON.stringify(detail));
  assert.equal(detail.data.record_id, recordId);
  assert.equal(detail.data.score, 100);
  assert.equal(detail.data.total_score, 100);
  assert.equal(detail.data.result_status, 'passed');
  assertNoSecrets(detail.data);
  const result = await ctx.request(reader.actor, 'GET', `/admin/exam-records/${recordId}/result`);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.record_id, recordId);
  assert.equal(result.data.grading_state, 'finalized');
  assert.equal(result.data.score, 100);

  const timeoutActor = await examLearner(ctx, { categoryId });
  const timeoutStart = await ctx.request(timeoutActor, 'POST', `/me/exams/${paperId}/start`);
  assert.equal(timeoutStart.status, 200, JSON.stringify(timeoutStart));
  const timeoutId = timeoutStart.data.record_id;
  await ctx.queryTestDb('UPDATE exam_record SET deadline_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?', [timeoutId]);
  const timeoutResult = await ctx.request(timeoutActor, 'GET', `/me/exam-records/${timeoutId}/result`);
  assert.equal(timeoutResult.status, 200, JSON.stringify(timeoutResult));
  assertPureTimeout(timeoutResult.data);
  assert.equal(timeoutResult.data.legacy, false);
  await assertTimeoutFacts(ctx, timeoutId);
  const adminTimeout = await ctx.request(reader.actor, 'GET', `/admin/exam-records/${timeoutId}/result`);
  assert.equal(adminTimeout.status, 200);
  assert.deepEqual(adminTimeout.data, timeoutResult.data);
  const history = await ctx.request(timeoutActor, 'GET', '/me/exam-records');
  assert.equal(history.status, 200);
  const timeoutRow = history.data.items.find((row) => row.record_id === timeoutId);
  assert.equal(timeoutRow.status, 'timeout');
  assert.equal(timeoutRow.submitted_at, null);
  assert.equal(timeoutRow.grading_state, 'not_submitted');
  const wrong = await ctx.request(learner.actor, 'GET', '/me/wrong-questions');
  assert.equal(wrong.status, 200);
  assert.deepEqual(wrong.data.items, [], 'a correct manual answer creates no wrong items');
  const timeoutWrong = await ctx.request(timeoutActor, 'GET', '/me/wrong-questions');
  assert.equal(timeoutWrong.status, 200);
  assert.deepEqual(timeoutWrong.data.items, [], 'an unsubmitted timeout creates no wrong items');

  for (const [method, path, body] of [
    ['GET', `/admin/exams/${paperId}/monitor`, undefined],
    ['GET', '/admin/grading', undefined],
    ['POST', `/me/exam-records/${recordId}/switch`, {}],
    ['POST', `/me/exam-records/${recordId}/answer-images`, {}],
  ]) {
    const removed = await ctx.request(method === 'GET' ? reader.actor : learner.actor, method, path, body);
    assert.equal(removed.status, 404, `${method} ${path}: ${JSON.stringify(removed)}`);
  }

  await assertSimplifiedRecordQueries(ctx, { admin, reader, learner, suffix });

  console.log(JSON.stringify({
    suite: 'training-records',
    record_id: recordId,
    assertions: 'read-list-detail-result,permission,anti-leak,current-four-states,admin-legacy-exclusion,shared-history-preserved,beijing-date-boundaries,frozen-total,exact-id-filters,historical-options,removed-monitor-grading-switch-answer-image',
  }));
}
