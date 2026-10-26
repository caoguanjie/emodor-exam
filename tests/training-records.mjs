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
  assertNoSecrets(list.data);

  const detail = await ctx.request(reader.actor, 'GET', `/admin/exam-records/${recordId}`);
  assert.equal(detail.status, 200, JSON.stringify(detail));
  assert.equal(detail.data.record_id, recordId);
  assert.equal(detail.data.score, 100);
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

  console.log(JSON.stringify({
    suite: 'training-records',
    record_id: recordId,
    assertions: 'read-list-detail-result,permission,anti-leak,removed-monitor-grading-switch-answer-image',
  }));
}
