import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { completeIdentityProfile, debugLearner, materials } from '../mobile-identity.mjs';

// The ordinary debug login only supplies a mobile session. A real HTTP identity
// session, with the external provider replaced in the isolated test process,
// creates the authoritative verified fact used by exam policy.
export async function verifyExamLearner(ctx, actor) {
  const original = await completeIdentityProfile(ctx, actor);
  const input = await materials(ctx, actor, `#${randomBytes(3).toString('hex')}`);
  const verified = await ctx.request(actor, 'POST', '/me/identity-verification/sessions', input);
  assert.equal(verified.status, 200, `synthetic identity session: ${JSON.stringify(verified)}`);
  assert.equal(verified.data.status, 'verified');
  // Some exam-policy fixtures deliberately remove the category after verification.
  if (!original.category_id) await ctx.queryTestDb('UPDATE sys_user SET category_id=NULL WHERE id=?', [actor.userId]);
  return actor;
}

export async function examLearner(ctx, { categoryId = null, source = 'institution', verified = true, username } = {}) {
  const actor = await debugLearner(ctx);
  await ctx.queryTestDb('UPDATE sys_user SET source=?,category_id=? WHERE id=?', [source, categoryId, actor.userId]);
  if (username) await ctx.queryTestDb('UPDATE sys_user SET username=? WHERE id=?', [username, actor.userId]);
  if (verified) await verifyExamLearner(ctx, actor);
  return actor;
}

export function assertAttemptView(view, { status = 'in_progress' } = {}) {
  assert.deepEqual(Object.keys(view).sort(), ['status', 'record_id', 'paper_id', 'release_id', 'deadline_at', 'server_now', 'questions'].sort());
  assert.equal(view.status, status);
  assert.match(view.record_id, /^\d+$/);
  assert.ok(Number.isFinite(Date.parse(view.server_now)));
  assert.ok(Number.isFinite(Date.parse(view.deadline_at)));
  const checkDoc = (doc, depth = 0) => {
    assert.ok(depth <= 4);
    assert.ok(['doc', 'paragraph', 'text', 'hardBreak', 'image'].includes(doc.type));
    if (doc.type === 'text') assert.deepEqual(Object.keys(doc).sort(), ['text', 'type']);
    else if (doc.type === 'image') {
      assert.deepEqual(Object.keys(doc).sort(), ['attrs', 'type']);
      assert.deepEqual(Object.keys(doc.attrs), ['asset_id']);
      assert.match(doc.attrs.asset_id, /^\d+$/);
    } else if (doc.type === 'hardBreak') assert.deepEqual(Object.keys(doc), ['type']);
    else {
      assert.deepEqual(Object.keys(doc).sort(), ['content', 'type']);
      for (const child of doc.content) checkDoc(child, depth + 1);
    }
  };
  for (const question of view.questions) {
    assert.deepEqual(Object.keys(question).sort(), ['item_id', 'type', 'stem', 'options', 'score'].sort());
    assert.ok(['single', 'multiple', 'judgment'].includes(question.type));
    assert.equal(new Set(question.options.map((option) => option.id)).size, question.options.length);
    checkDoc(question.stem);
    for (const option of question.options) {
      assert.deepEqual(Object.keys(option).sort(), ['content', 'id']);
      assert.equal(typeof option.id, 'string');
      checkDoc(option.content);
    }
  }
  if (status !== 'in_progress') assert.deepEqual(view.questions, []);
}

export function wholeAnswers(attempt, choices = {}) {
  return {
    record_id: attempt.record_id,
    answers: attempt.questions.map((item) => ({ item_id: item.item_id, option_ids: choices[item.type] || [] })),
  };
}

export function assertPureTimeout(result) {
  assert.equal(result.status, 'timeout');
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
  assert.equal(result.grading_state, 'not_submitted');
  assert.equal(result.submitted_at, null);
  assert.equal(result.graded_at, null);
  assert.equal(result.submission_method, null);
  assert.equal(result.correct_rate, null);
  assert.deepEqual(result.items, []);
}

export async function assertTimeoutFacts(ctx, recordId) {
  const [record] = await ctx.queryTestDb('SELECT status,score,submitted_at,graded_at,submission_method,grading_state,active_assignment_id,draft_revision,draft_saved_at FROM exam_record WHERE id=?', [recordId]);
  assert.equal(record.status, 'timeout');
  assert.equal(Number(record.score), 0);
  for (const field of ['submitted_at', 'graded_at', 'submission_method', 'active_assignment_id', 'draft_saved_at']) assert.equal(record[field], null, field);
  assert.equal(record.grading_state, 'not_submitted');
  assert.equal(Number(record.draft_revision), 0);
  const [answers] = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM exam_answer WHERE exam_record_id=?', [recordId]);
  assert.equal(Number(answers.count), 0, 'timeout must not persist or grade answers');
}
