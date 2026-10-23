import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTimeoutStartRace } from './training-attempts-race.mjs';

const expected = { recordId: '303', userId: '101', paperId: '202', assignmentId: '404' };
const active = Object.freeze({ record_id: '303', user_id: '101', paper_id: '202', assignment_id: '404', active_assignment_id: '404', attempt_no: 3, status: 'in_progress', score: null, submitted_at: null, is_expired: 1, record_count: 3, max_attempt_no: 3, fourth_count: 0, assignment_count: 1 });
const timeout = Object.freeze({ ...active, status: 'timeout', score: '0.00', active_assignment_id: null });
const recovered = { status: 200, data: { status: 'timeout', record_id: '303', questions: [] } };
const exhausted = { status: 409, code: 40902 };

test('expired active start returns its pure timeout record while swept max-attempt start rejects', () => {
  assert.equal(assertTimeoutStartRace({ pre: active, response: recovered, post: timeout, expected }), 'finalized-before-start');
  assert.equal(assertTimeoutStartRace({ pre: active, response: exhausted, post: timeout, expected }), 'finalized-before-start');
  assert.equal(assertTimeoutStartRace({ pre: timeout, response: exhausted, post: timeout, expected }), 'finalized-before-pre');
});

test('rejects active leftovers, old auto-submitted timeout facts, or inconsistent ownership/counts', () => {
  for (const value of [
    { pre: active, response: recovered, post: active },
    { pre: timeout, response: recovered, post: timeout },
    { pre: active, response: { status: 409, code: 40904 }, post: timeout },
    ...['record_id', 'user_id', 'paper_id', 'assignment_id'].map((key) => ({ pre: active, response: recovered, post: { ...timeout, [key]: '999' } })),
    ...[{ status: 'failed' }, { score: '60.00' }, { score: null }, { submitted_at: '2026-10-22T00:00:00Z' }, { active_assignment_id: '404' }, { record_count: 4 }, { fourth_count: 1 }, { assignment_count: 2 }].map((change) => ({ pre: active, response: recovered, post: { ...timeout, ...change } })),
  ]) assert.throws(() => assertTimeoutStartRace({ ...value, expected }));
});
