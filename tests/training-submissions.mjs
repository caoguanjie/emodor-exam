import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { assertAttemptView, assertPureTimeout, assertTimeoutFacts, examLearner, wholeAnswers } from './support/exam-mobile-fixtures.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');

async function connection(ctx) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_[A-Za-z0-9_]+$/);
  return mysql.createConnection({ host: ctx.env.DB_HOST, port: Number(ctx.env.DB_PORT), user: ctx.env.DB_USERNAME, password: ctx.env.DB_PASSWORD, database: ctx.env.DB_DATABASE });
}

async function fixture(ctx) {
  const [admin] = await ctx.queryTestDb("SELECT id FROM sys_user WHERE username='admin'");
  const category = await ctx.queryTestDb('INSERT INTO training_category(name,status,created_by) VALUES (?,1,?)', [`H2 提交 ${randomBytes(4).toString('hex')}`, admin.id]);
  const categoryId = String(category.insertId);
  const pool = [];
  for (const [type, scoreCents, answer, options] of [
    ['single', 3000, [0], [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }]],
    ['multiple', 3000, [0, 1], [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }, { key: 'C', text: '丙' }]],
    ['judgment', 4000, [0], [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }]],
  ]) {
    const question = await ctx.queryTestDb('INSERT INTO question(category_id,difficulty,type,stem,options,answer,analysis,score,status,source,created_by) VALUES (?,\'easy\',?,?,?,?,?,?,\'approved\',\'manual\',?)', [categoryId, type, `<p>${type}</p>`, JSON.stringify(options), JSON.stringify(answer), '<p>冻结解析</p>', scoreCents / 100, admin.id]);
    const version = await ctx.queryTestDb('INSERT INTO question_version(question_id,revision,category_id,difficulty,type,stem,options,answer,analysis,score_cents,source,status,created_by) VALUES (?,1,?,\'easy\',?,?,?,?,?,?,\'manual\',\'approved\',?)', [question.insertId, categoryId, type, `<p>${type}</p>`, JSON.stringify(options), JSON.stringify(answer), '<p>冻结解析</p>', scoreCents, admin.id]);
    await ctx.queryTestDb('UPDATE question SET current_version_id=? WHERE id=?', [version.insertId, question.insertId]);
    // Intentionally retain a v1 frozen snapshot to prove the server adapter maps
    // original key A/B/C to stable IDs regardless of displayed option order.
    pool.push({ questionId: String(question.insertId), versionId: String(version.insertId), revision: 1, categoryId, difficulty: 'easy', type, stem: `<p>${type}</p>`, options, answer, analysis: '<p>冻结解析</p>', scoreCents, source: 'manual', approvedBy: String(admin.id), approvedAt: new Date().toISOString() });
  }
  const rule = { totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5, rules: pool.map((item) => ({ type: item.type, count: 1, scoreCents: item.scoreCents })) };
  const paper = await ctx.queryTestDb('INSERT INTO exam_paper(business_scope,mode,category_id,requires_learning,regulation_ids,course_ids,rule_config,title,total_score,pass_score,duration_minutes,max_attempts,partial_credit_ratio,status,created_by) VALUES (\'training\',\'random\',?,0,\'[]\',\'[]\',?,?,100,60,30,3,0.5,\'published\',?)', [categoryId, JSON.stringify(rule), 'H2 三题型整卷', admin.id]);
  const release = await ctx.queryTestDb('INSERT INTO paper_release(paper_id,version_no,business_scope,mode,category_id,requires_learning,rule_snapshot,regulation_ids,course_ids,created_by) VALUES (?,1,\'training\',\'random\',?,0,?,\'[]\',\'[]\',?)', [paper.insertId, categoryId, JSON.stringify(rule), admin.id]);
  for (const [position, item] of pool.entries()) await ctx.queryTestDb('INSERT INTO paper_release_question(release_id,question_id,question_version_id,type,difficulty,score_cents,position,snapshot_json) VALUES (?,?,?,?,\'easy\',?,?,?)', [release.insertId, item.questionId, item.versionId, item.type, item.scoreCents, position, JSON.stringify(item)]);
  return { categoryId, paperId: String(paper.insertId) };
}

async function start(ctx, actor, paperId) {
  const result = await ctx.request(actor, 'POST', `/me/exams/${paperId}/start`);
  assert.equal(result.status, 200, JSON.stringify(result));
  assertAttemptView(result.data);
  assert.equal(result.data.questions.length, 3);
  return result.data;
}

async function submit(ctx, actor, attempt, body) {
  return ctx.request(actor, 'POST', `/me/exam-records/${attempt.record_id}/submit`, body);
}

export async function run(ctx) {
  let stage = 'fixtures';
  try {
    const { categoryId, paperId } = await fixture(ctx);
    const alpha = await examLearner(ctx, { categoryId });
    const beta = await examLearner(ctx, { categoryId });
    const gamma = await examLearner(ctx, { categoryId });
    const alphaAttempt = await start(ctx, alpha, paperId);
    const betaAttempt = await start(ctx, beta, paperId);
    const gammaAttempt = await start(ctx, gamma, paperId);

    stage = 'local-only draft and immutable recovery';
    for (const [method, route, body] of [['PUT', 'draft', { revision: 1, answers: [] }], ['POST', 'heartbeat', {}]]) {
      assert.equal((await ctx.request(alpha, method, `/me/exam-records/${alphaAttempt.record_id}/${route}`, body)).status, 404);
    }
    const [untouched] = await ctx.queryTestDb('SELECT draft_revision,(SELECT COUNT(*) FROM exam_answer WHERE exam_record_id=?) AS count FROM exam_record WHERE id=?', [alphaAttempt.record_id, alphaAttempt.record_id]);
    assert.equal(Number(untouched.draft_revision), 0);
    assert.equal(Number(untouched.count), 0);
    await ctx.restartApi();
    const recovered = await ctx.request(alpha, 'GET', `/me/exam-records/${alphaAttempt.record_id}`);
    assert.equal(recovered.status, 200);
    assertAttemptView(recovered.data);
    assert.deepEqual(recovered.data.questions, alphaAttempt.questions);
    assert.equal(recovered.data.deadline_at, alphaAttempt.deadline_at);

    stage = 'identity is required for active recovery and submit';
    // Preserve the real encrypted fact while temporarily hiding it, without
    // inventing any synthetic verified row or production bypass.
    await ctx.queryTestDb('UPDATE learner_identity SET user_id=? WHERE user_id=?', ['9223372036854775000', alpha.userId]);
    try {
      for (const request of [ctx.request(alpha, 'GET', `/me/exam-records/${alphaAttempt.record_id}`), submit(ctx, alpha, alphaAttempt, wholeAnswers(alphaAttempt))]) {
        const denied = await request;
        assert.equal(denied.status, 403, JSON.stringify(denied));
        assert.equal(denied.data.reason_code, 'IDENTITY_REQUIRED');
      }
    } finally { await ctx.queryTestDb('UPDATE learner_identity SET user_id=? WHERE user_id=?', [alpha.userId, '9223372036854775000']); }

    stage = 'strict complete stable-ID envelope rejects old and malformed input';
    const valid = wholeAnswers(alphaAttempt, { single: ['A'], multiple: ['A'], judgment: ['B'] });
    const single = valid.answers.find((answer) => alphaAttempt.questions.find((item) => item.item_id === answer.item_id).type === 'single');
    const badBodies = [
      undefined,
      { ...valid, record_id: betaAttempt.record_id },
      { ...valid, revision: 1 },
      { ...valid, answers: valid.answers.slice(1) },
      { ...valid, answers: [valid.answers[0], valid.answers[0], valid.answers[2]] },
      { ...valid, answers: valid.answers.map((answer, index) => index ? answer : { ...answer, item_id: '999999999' }) },
      { ...valid, answers: valid.answers.map((answer) => answer === single ? { ...answer, option_ids: ['unknown'] } : answer) },
      { ...valid, answers: valid.answers.map((answer) => answer === single ? { ...answer, option_ids: ['A', 'A'] } : answer) },
      { ...valid, answers: valid.answers.map((answer) => answer === single ? { ...answer, option_ids: ['A', 'B'] } : answer) },
      { ...valid, answers: valid.answers.map((answer) => ({ ...answer, selected: [0] })) },
      { ...valid, answers: valid.answers.map((answer) => ({ ...answer, asset_ids: [] })) },
      { ...valid, answers: valid.answers.map((answer) => ({ ...answer, option_ids: [0] })) },
    ];
    for (const body of badBodies) {
      const rejected = await submit(ctx, alpha, alphaAttempt, body);
      assert.equal(rejected.status, 400, `invalid body: ${JSON.stringify(body)} -> ${JSON.stringify(rejected)}`);
      assert.equal(rejected.code, 40001);
    }
    const foreign = await submit(ctx, beta, alphaAttempt, valid);
    assert.equal(foreign.status, 403);

    stage = 'manual whole-exam grading and different-payload idempotence';
    const result = await submit(ctx, alpha, alphaAttempt, valid);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.data.status, 'failed');
    assert.equal(result.data.score, 45);
    assert.equal(result.data.submission_method, 'manual');
    assert.equal(result.data.grading_state, 'finalized');
    assert.equal(result.data.legacy, true, 'the frozen v1 snapshot is adapted without rewriting history');
    assert.ok(result.data.submitted_at);
    assert.equal(result.data.items.length, 3);
    assert.deepEqual((await submit(ctx, alpha, alphaAttempt, { arbitrary: 'ignored after first success' })).data, result.data);
    const persisted = await ctx.queryTestDb('SELECT selected_option_ids,gained_score FROM exam_answer WHERE exam_record_id=?', [alphaAttempt.record_id]);
    assert.equal(persisted.length, 3);
    assert.ok(persisted.every((row) => row.selected_option_ids !== null));

    stage = 'every item including explicit empty answers is persisted once';
    const betaResult = await submit(ctx, beta, betaAttempt, wholeAnswers(betaAttempt, { single: ['A'], multiple: ['A'] }));
    assert.equal(betaResult.status, 200, JSON.stringify(betaResult));
    assert.equal(betaResult.data.score, 45);
    const judgment = betaResult.data.items.find((item) => item.type === 'judgment');
    assert.deepEqual(judgment.selected_option_ids, []);
    const wrong = await ctx.request(beta, 'GET', '/me/wrong-questions');
    assert.equal(wrong.status, 200, JSON.stringify(wrong));
    assert.equal(wrong.data.total, 2, 'partial multiple and blank judgment remain reviewable wrong items');
    assert.deepEqual(wrong.data.items.find((item) => item.type === 'judgment').selected_option_ids, []);
    assert.deepEqual(wrong.data.items.find((item) => item.type === 'multiple').selected_option_ids, ['A']);

    stage = 'read lazily finalizes pure timeout without submit';
    // Simulate an active draft left by the previous server-draft version. It
    // must be removed on expiry rather than treated as an implicit submission.
    const [oldItem] = await ctx.queryTestDb('SELECT id,question_id FROM exam_record_question WHERE record_id=? LIMIT 1', [gammaAttempt.record_id]);
    await ctx.queryTestDb('INSERT INTO exam_answer(exam_record_id,record_question_id,question_id,selected) VALUES (?,?,?,\'[0]\')', [gammaAttempt.record_id, oldItem.id, oldItem.question_id]);
    await ctx.queryTestDb('UPDATE exam_record SET draft_revision=1,draft_saved_at=UTC_TIMESTAMP(3) WHERE id=?', [gammaAttempt.record_id]);
    await ctx.queryTestDb('UPDATE exam_record SET deadline_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?', [gammaAttempt.record_id]);
    const timeoutView = await ctx.request(gamma, 'GET', `/me/exam-records/${gammaAttempt.record_id}`);
    assert.equal(timeoutView.status, 200, JSON.stringify(timeoutView));
    assertAttemptView(timeoutView.data, { status: 'timeout' });
    await assertTimeoutFacts(ctx, gammaAttempt.record_id);
    const timeoutResults = await Promise.all(Array.from({ length: 8 }, () => submit(ctx, gamma, gammaAttempt, wholeAnswers(gammaAttempt, { single: ['A'], multiple: ['A', 'B'], judgment: ['A'] }))));
    for (const reply of timeoutResults) {
      assert.equal(reply.status, 200, JSON.stringify(reply));
      assertPureTimeout(reply.data);
      assert.deepEqual(reply.data, timeoutResults[0].data);
    }

    stage = 'real MySQL concurrent different submissions freeze one result';
    const concurrent = await start(ctx, beta, paperId);
    const full = wholeAnswers(concurrent, { single: ['A'], multiple: ['A', 'B'], judgment: ['A'] });
    const empty = wholeAnswers(concurrent);
    const raced = await Promise.all(Array.from({ length: 16 }, (_, index) => submit(ctx, beta, concurrent, index % 2 ? full : empty)));
    for (const reply of raced) {
      assert.equal(reply.status, 200, JSON.stringify(reply));
      assert.deepEqual(reply.data, raced[0].data);
    }
    assert.ok([0, 100].includes(raced[0].data.score));
    const [rows] = await ctx.queryTestDb('SELECT COUNT(*) AS count,COUNT(DISTINCT record_question_id) AS distinct_count FROM exam_answer WHERE exam_record_id=?', [concurrent.record_id]);
    assert.equal(Number(rows.count), 3);
    assert.equal(Number(rows.distinct_count), 3);

    stage = 'transaction rollback leaves no answers and permits a clean retry';
    const rollback = await start(ctx, alpha, paperId);
    const db = await connection(ctx);
    try {
      await db.query("CREATE TRIGGER exam_test_insert_failure BEFORE INSERT ON exam_answer FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic exam insert failure'");
      try {
        assert.equal((await submit(ctx, alpha, rollback, wholeAnswers(rollback))).status, 500);
        const [facts] = await ctx.queryTestDb('SELECT status,(SELECT COUNT(*) FROM exam_answer WHERE exam_record_id=?) AS count FROM exam_record WHERE id=?', [rollback.record_id, rollback.record_id]);
        assert.equal(facts.status, 'in_progress');
        assert.equal(Number(facts.count), 0);
      } finally { await db.query('DROP TRIGGER exam_test_insert_failure'); }
    } finally { await db.end(); }
    assert.equal((await submit(ctx, alpha, rollback, wholeAnswers(rollback))).status, 200);

    stage = 'accepted time is taken after the record lock across deadline';
    const crossing = await start(ctx, gamma, paperId);
    const held = await connection(ctx);
    let pending;
    try {
      await held.beginTransaction();
      await held.execute('UPDATE exam_record SET deadline_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?', [crossing.record_id]);
      pending = submit(ctx, gamma, crossing, wholeAnswers(crossing, { single: ['A'], multiple: ['A', 'B'], judgment: ['A'] }));
      const observer = await connection(ctx);
      try {
        const until = Date.now() + 8000;
        let waiting = false;
        while (Date.now() < until) {
          const [locks] = await observer.query('SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits');
          if (Number(locks[0].count) > 0) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(waiting, true, 'submission must reach the held MySQL record lock');
      } finally { await observer.end(); }
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await held.commit();
    } finally { await held.end(); }
    const crossed = await pending;
    assert.equal(crossed.status, 200, JSON.stringify(crossed));
    assertPureTimeout(crossed.data);
    await assertTimeoutFacts(ctx, crossing.record_id);
    console.log('[training-submissions] mobile identity, strict stable-ID whole submission, local-only drafts, restart, real MySQL idempotence/rollback/deadline and pure timeout passed');
  } catch (error) { error.message = `[training-submissions stage=${stage}] ${error.message}`; throw error; }
}
