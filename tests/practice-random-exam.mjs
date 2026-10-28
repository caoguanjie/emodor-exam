import assert from 'node:assert/strict';
import { assertOwnedEphemeralRuntime, adminLogin, learner, importQuestions, assertNoSecrets } from './public-random-exam.mjs';
import { debugLearner } from './mobile-identity.mjs';
import { publicRandomQuestionFixture, fixtureAnswerSheet, fixtureQuestion, PUBLIC_RANDOM_RULES_100 } from './support/public-random-question-fixture.mjs';

const RULES_50 = [
  { type: 'single', count: 30, score_cents: 200 },
  { type: 'multiple', count: 10, score_cents: 200 },
  { type: 'judgment', count: 10, score_cents: 200 },
];
const ok = (reply, label) => {
  assert.equal(reply.status, 200, `${label}: HTTP ${reply.status}, code ${reply.code}, ${reply.message || ''}`);
  return reply.data;
};
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const stripClock = value => JSON.parse(JSON.stringify(value), (key, item) => key === 'as_of' ? undefined : item);
const dashboardExamFacts = value => ({
  metrics: Object.fromEntries(['paper_count', 'published_paper_count', 'today_participant_count', 'today_attempt_count', 'last_7_days_participant_count', 'last_7_days_attempt_count'].map(key => [key, value.metrics[key]])),
  exam_trend: value.exam_trend,
});

async function publish(ctx, admin, paperId) {
  return String(ok(await ctx.request(admin, 'POST', `/admin/papers/${paperId}/publish`), 'publish').release_id);
}
async function summary(ctx, actor, paperId) {
  const view = ok(await ctx.request(actor, 'GET', `/me/exams/${paperId}`), 'instructions');
  assertNoSecrets(view);
  return view;
}
async function start(ctx, actor, paperId, releaseId) {
  const view = ok(await ctx.request(actor, 'POST', `/me/exams/${paperId}/start`, { expected_release_id: releaseId }), 'start');
  assertNoSecrets(view);
  assert.equal(view.exam_purpose, 'practice');
  return view;
}
async function recordCount(ctx, actor, paperId) {
  const [row] = await ctx.queryTestDb('SELECT COUNT(*) AS n FROM exam_record WHERE user_id=? AND paper_id=?', [actor.userId, paperId]);
  return Number(row.n);
}
async function submit(ctx, actor, attempt, fixture, mode, score, { blankFirst = false } = {}) {
  const body = fixtureAnswerSheet(attempt, fixture, mode);
  if (blankFirst) {
    const single = attempt.questions.find(item => item.type === 'single');
    body.answers.find(item => item.item_id === single.item_id).option_ids = [];
  }
  const result = ok(await ctx.request(actor, 'POST', `/me/exam-records/${attempt.record_id}/submit`, body), 'submit');
  assert.equal(result.score, score);
  assert.equal(result.paper_id, attempt.paper_id);
  assert.equal(result.exam_purpose, attempt.exam_purpose);
  assert.equal(result.grading_state, 'finalized');
  const retry = ok(await ctx.request(actor, 'POST', `/me/exam-records/${attempt.record_id}/submit`, body), 'submit retry');
  assert.deepEqual(retry, result);
  return result;
}
async function assertSample(ctx, attempt, fixture, count, difficulty, releaseId) {
  assert.equal(attempt.questions.length, count);
  assert.equal(attempt.release_id, releaseId);
  const ids = new Set();
  for (const item of attempt.questions) {
    const question = fixtureQuestion(item, fixture);
    ids.add(question.token);
    assert.equal(question.difficulty, difficulty);
  }
  assert.equal(ids.size, count);
  const [record] = await ctx.queryTestDb('SELECT release_id,exam_purpose,difficulty,rule_snapshot FROM exam_record WHERE id=?', [attempt.record_id]);
  assert.equal(String(record.release_id), releaseId);
  assert.equal(record.exam_purpose, 'practice');
  assert.equal(record.difficulty, difficulty);
  assert.equal(parse(record.rule_snapshot).maxAttempts, null);
}

export async function run(ctx) {
  assertOwnedEphemeralRuntime(ctx);
  const report = { suite: 'practice-random-exam', status: 'RUNNING', checks: [], imports: [], browser: { status: 'NOT_RUN' } };
  const phase = name => { report.stage = name; console.log(`[practice-random-exam] ${name}`); };
  try {
    const admin = await adminLogin(ctx);
    ok(await ctx.request(admin, 'PUT', '/admin/site-settings', { logo_asset_id: null, banners: [] }), 'owned branding');
    const fixture = publicRandomQuestionFixture();
    const categories = [];
    for (const index of [1, 2]) categories.push(String(ok(await ctx.request(admin, 'POST', '/admin/training-categories', { name: `模拟验收${fixture.runId}-${index}` }), 'category').id));
    phase('import shared bank');
    await importQuestions(ctx, admin, fixture, categories, report);
    const formal = ok(await ctx.request(admin, 'POST', '/admin/papers', {
      title: `正式卷${fixture.runId}`, mode: 'random', pool_scope: 'public', category_id: null,
      rules: PUBLIC_RANDOM_RULES_100, total_score: 100, pass_score: 60, duration_minutes: 30,
      max_attempts: 3, partial_credit_ratio: 0.5, requires_learning: false, course_ids: [], regulation_ids: [],
    }), 'formal create');
    const formalId = String(formal.id);
    await publish(ctx, admin, formalId);
    const beforeTemplate = (await ctx.queryTestDb('SELECT COUNT(*) n FROM exam_paper'))[0].n;
    const template = ok(await ctx.request(admin, 'GET', `/admin/papers/${formalId}/practice-template`), 'practice template');
    assert.equal((await ctx.queryTestDb('SELECT COUNT(*) n FROM exam_paper'))[0].n, beforeTemplate);
    assert.equal(template.exam_purpose, 'practice');
    assert.equal(template.max_attempts, null);
    assert.deepEqual(template.rules, PUBLIC_RANDOM_RULES_100);
    const practice = ok(await ctx.request(admin, 'POST', '/admin/papers', { ...template, title: `模拟卷${fixture.runId}`, rules: RULES_50 }), 'practice create');
    const paperId = String(practice.id);
    assert.notEqual(paperId, formalId);
    assert.equal(practice.status, 'draft');
    assert.equal(practice.max_attempts, null);
    const v1 = await publish(ctx, admin, paperId);
    const institution = await learner(ctx, 'institution');
    const external = await learner(ctx, 'external');
    phase('unlimited summary, guarded start, and formal baseline');
    const info = await summary(ctx, institution, paperId);
    assert.equal(info.exam_purpose, 'practice');
    assert.equal(info.attempt_limit_kind, 'unlimited');
    assert.equal(info.max_attempts, null);
    assert.equal(info.attempts_remaining, null);
    assert.equal(info.release_id, v1);
    assert.equal(info.question_count, 50);
    assert.equal(await recordCount(ctx, institution, paperId), 0);
    assert.equal((await ctx.request(institution, 'POST', `/me/exams/${paperId}/start`, {})).code, 40970);
    assert.equal((await ctx.request(institution, 'POST', `/me/exams/${paperId}/start`, { expected_release_id: '999999999' })).code, 40970);
    assert.equal(await recordCount(ctx, institution, paperId), 0);
    const formalAttempt = ok(await ctx.request(institution, 'POST', `/me/exams/${formalId}/start`, {}), 'formal start compatibility');
    assert.equal(formalAttempt.exam_purpose, 'formal');
    await submit(ctx, institution, formalAttempt, fixture, 'wrong', 0);
    const baselineStats = stripClock(ok(await ctx.request(admin, 'GET', `/statistics/training/summary?paper_id=${formalId}`), 'formal summary'));
    const baselineDashboard = dashboardExamFacts(ok(await ctx.request(admin, 'GET', '/admin/dashboard'), 'dashboard'));
    const simultaneous = await Promise.all([start(ctx, institution, paperId, v1), start(ctx, institution, paperId, v1)]);
    assert.equal(simultaneous[0].record_id, simultaneous[1].record_id);
    const first = simultaneous[0];
    await assertSample(ctx, first, fixture, 50, 'easy', v1);
    const [assignmentBefore] = await ctx.queryTestDb('SELECT * FROM exam_assignment WHERE paper_id=? AND user_id=?', [paperId, institution.userId]);
    phase('v1 active while v2 published; v1 grading and wrong book');
    ok(await ctx.request(admin, 'POST', `/admin/papers/${paperId}/withdraw`), 'withdraw');
    ok(await ctx.request(admin, 'PUT', `/admin/papers/${paperId}`, { rules: PUBLIC_RANDOM_RULES_100, duration_minutes: 15 }), 'edit practice independently');
    const v2 = await publish(ctx, admin, paperId);
    assert.notEqual(v2, v1);
    const activeInfo = await summary(ctx, institution, paperId);
    assert.equal(activeInfo.release_id, v1);
    assert.equal(activeInfo.question_count, 50);
    const recovered = await start(ctx, institution, paperId, v1);
    for (const field of ['record_id', 'release_id', 'questions', 'deadline_at']) assert.deepEqual(recovered[field], first[field]);
    await submit(ctx, institution, first, fixture, 'partial', 88, { blankFirst: true });
    const wrong = ok(await ctx.request(institution, 'GET', '/me/wrong-questions?page=1&page_size=100'), 'wrong book');
    const firstWrong = wrong.items.filter(item => item.record_id === first.record_id);
    assert.equal(firstWrong.length, 11);
    assert.ok(firstWrong.every(item => item.exam_purpose === 'practice' && item.paper_id === paperId && item.paper_title === practice.title));
    const nextInfo = await summary(ctx, institution, paperId);
    assert.equal(nextInfo.release_id, v2);
    assert.equal(nextInfo.question_count, 100);
    assert.equal(nextInfo.duration_minutes, 15);
    assert.equal((await ctx.request(institution, 'POST', `/me/exams/${paperId}/start`, { expected_release_id: v1 })).code, 40970);
    assert.equal(await recordCount(ctx, institution, paperId), 1);
    await ctx.queryTestDb("UPDATE sys_user SET source='external' WHERE id=?", [institution.userId]);
    const second = await start(ctx, institution, paperId, v2);
    await assertSample(ctx, second, fixture, 100, 'easy', v2);
    assert.deepEqual((await ctx.queryTestDb('SELECT * FROM exam_assignment WHERE paper_id=? AND user_id=?', [paperId, institution.userId]))[0], assignmentBefore);
    await submit(ctx, institution, second, fixture, 'correct', 100);
    const oldResult = ok(await ctx.request(institution, 'GET', `/me/exam-records/${first.record_id}/result`), 'old result');
    assert.equal(oldResult.score, 88);
    assert.equal(oldResult.items.length, 50);
    const hard = await start(ctx, external, paperId, v2);
    await assertSample(ctx, hard, fixture, 100, 'hard', v2);
    await submit(ctx, external, hard, fixture, 'wrong', 0);
    report.checks.push('v1活动恢复不变；v2新模拟更新题量时限；来源仍首次冻结；正常评分与11道部分分/空答错题。');
    phase('formal statistics exclusion and mixed history');
    assert.deepEqual(stripClock(ok(await ctx.request(admin, 'GET', `/statistics/training/summary?paper_id=${formalId}`), 'formal summary unchanged')), baselineStats);
    // Changing the learner source above intentionally changes demographic counts;
    // compare the independent formal-exam counters and trend, not demographics.
    assert.deepEqual(dashboardExamFacts(ok(await ctx.request(admin, 'GET', '/admin/dashboard'), 'dashboard unchanged')), baselineDashboard);
    for (const endpoint of ['summary', 'ranking', 'export']) assert.equal((await ctx.request(admin, 'GET', `/statistics/training/${endpoint}?paper_id=${paperId}&difficulty=easy`)).code, 40401);
    const overview = ok(await ctx.request(admin, 'GET', '/statistics/training/overview?page=1&page_size=100'), 'formal overview');
    assert.ok(!overview.items.some(item => item.paper_id === paperId));
    const history = ok(await ctx.request(institution, 'GET', '/me/exam-records?page=1&page_size=100'), 'mixed history');
    assert.ok(history.items.some(item => item.exam_purpose === 'practice'));
    assert.ok(history.items.some(item => item.exam_purpose === 'formal'));
    const filtered = ok(await ctx.request(admin, 'GET', `/admin/exam-records?exam_purpose=practice&page=1&page_size=100`), 'admin filtered records');
    assert.ok(filtered.items.length >= 3);
    assert.ok(filtered.items.every(item => item.exam_purpose === 'practice'));
    report.checks.push('模拟记录可查而正式统计/首页不变；直接访问模拟正式报表被拒绝。');
    phase('timeout, fourth attempt, formal quota remains bounded');
    const third = await start(ctx, institution, paperId, v2);
    // The API/TypeORM connection serializes DATETIME in UTC. Using NOW() here
    // writes the MySQL process's local (+08:00) wall clock and makes the API
    // parse the deadline roughly eight hours in the future.
    await ctx.queryTestDb('UPDATE exam_record SET deadline_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id=?', [third.record_id]);
    const expired = await start(ctx, institution, paperId, v2);
    assert.equal(expired.record_id, third.record_id);
    assert.equal(expired.status, 'timeout');
    assert.equal(await recordCount(ctx, institution, paperId), 3);
    const fourth = await start(ctx, institution, paperId, v2);
    assert.notEqual(fourth.record_id, third.record_id);
    await submit(ctx, institution, fourth, fixture, 'wrong', 0);
    const [timeout] = await ctx.queryTestDb('SELECT score,grading_state,submitted_at,submission_method FROM exam_record WHERE id=?', [third.record_id]);
    assert.equal(timeout.grading_state, 'not_submitted');
    assert.equal(timeout.submitted_at, null);
    assert.equal(timeout.submission_method, null);
    for (let i = 0; i < 2; i++) {
      const next = ok(await ctx.request(institution, 'POST', `/me/exams/${formalId}/start`, {}), 'formal remaining quota');
      await submit(ctx, institution, next, fixture, 'wrong', 0);
    }
    assert.equal((await ctx.request(institution, 'POST', `/me/exams/${formalId}/start`, {})).code, 40902);
    const quotaActor = await learner(ctx, 'institution');
    const seed = await start(ctx, quotaActor, paperId, v2);
    await submit(ctx, quotaActor, seed, fixture, 'correct', 100);
    for (let n = 2; n <= 100; n++) {
      await ctx.queryTestDb(`INSERT INTO exam_record (paper_id,exam_purpose,user_id,assignment_id,release_id,source,category_id,difficulty,rule_snapshot,snapshot_origin,attempt_no,status,score,started_at,deadline_at,grading_state)
        SELECT paper_id,exam_purpose,user_id,assignment_id,release_id,source,category_id,difficulty,rule_snapshot,snapshot_origin,?,'timeout',0,DATE_SUB(NOW(3),INTERVAL 2 HOUR),DATE_SUB(NOW(3),INTERVAL 1 HOUR),'not_submitted' FROM exam_record WHERE id=?`, [n, seed.record_id]);
    }
    const oneHundredFirst = await start(ctx, quotaActor, paperId, v2);
    assert.equal((await ctx.queryTestDb('SELECT attempt_no FROM exam_record WHERE id=?', [oneHundredFirst.record_id]))[0].attempt_no, 101);
    assert.equal((await summary(ctx, quotaActor, paperId)).attempt_limit_kind, 'unlimited');
    await submit(ctx, quotaActor, oneHundredFirst, fixture, 'correct', 100);
    report.checks.push('第4次和第101次正常开始；timeout不评分且不自动新开；正式第4次仍拒绝。');
    phase('withdrawal and identity boundaries');
    const active = await start(ctx, external, paperId, v2);
    ok(await ctx.request(admin, 'POST', `/admin/papers/${paperId}/withdraw`), 'withdraw practice');
    assert.equal((await start(ctx, external, paperId, v1)).record_id, active.record_id);
    await submit(ctx, external, active, fixture, 'correct', 100);
    assert.notEqual((await ctx.request(institution, 'POST', `/me/exams/${paperId}/start`, { expected_release_id: v2 })).status, 200);
    const v3 = await publish(ctx, admin, paperId);
    const unverified = await debugLearner(ctx);
    assert.notEqual((await ctx.request(unverified, 'POST', `/me/exams/${paperId}/start`, { expected_release_id: v3 })).status, 200);
    assert.equal(await recordCount(ctx, unverified, paperId), 0);
    assert.notEqual((await ctx.request(external, 'GET', `/me/exam-records/${first.record_id}/result`)).status, 200);
    if (process.env.PRACTICE_RANDOM_BROWSER === '1') {
      phase('actual PC and H5 browser');
      const fresh = await learner(ctx, 'institution');
      const { runPracticeRandomBrowser } = await import('./support/practice-random-browser.mjs');
      report.browser = await runPracticeRandomBrowser(ctx, { admin, actor: fresh, formalId, paperId, title: practice.title, fixture });
    }
    report.status = 'PASS';
    return report;
  } catch (error) {
    report.status = 'FAIL';
    throw new Error(`[practice-random-exam stage=${report.stage}] ${error.message}`, { cause: error });
  } finally {
    console.log('[practice-random-exam:report]', JSON.stringify(report));
  }
}
