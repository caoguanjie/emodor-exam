import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTimeoutStartRace } from './training-attempts-race.mjs';

const expected = {
  recordId: '303',
  userId: '101',
  paperId: '202',
  assignmentId: '404',
};

const active = Object.freeze({
  record_id: '303',
  user_id: '101',
  paper_id: '202',
  assignment_id: '404',
  active_assignment_id: '404',
  attempt_no: 3,
  status: 'in_progress',
  score: null,
  submitted_at: null,
  is_expired: 1,
  record_count: 3,
  max_attempt_no: 3,
  fourth_count: 0,
  assignment_count: 1,
});

const failed = Object.freeze({
  ...active,
  status: 'failed',
  score: '0.00',
  submitted_at: '2026-10-22T00:00:00.000Z',
  active_assignment_id: null,
});

const response = (code) => ({ status: 409, code });

test('accepts every lawful ordering of the timeout sweeper around start', () => {
  assert.equal(assertTimeoutStartRace({
    pre: active, response: response(40904), post: active, expected,
  }), 'active');
  assert.equal(assertTimeoutStartRace({
    pre: failed, response: response(40902), post: failed, expected,
  }), 'finalized-before-pre');
  assert.equal(assertTimeoutStartRace({
    pre: active, response: response(40902), post: failed, expected,
  }), 'finalized-before-start');
  assert.equal(assertTimeoutStartRace({
    pre: active, response: response(40904), post: failed, expected,
  }), 'finalized-after-start');
});

test('rejects responses that do not match a lawful timeout transition', () => {
  const rejected = [
    { pre: active, response: { status: 200, code: 0 }, post: active },
    { pre: active, response: response(40905), post: active },
    { pre: failed, response: response(40904), post: failed },
    { pre: active, response: response(40902), post: active },
  ];
  for (const value of rejected) {
    assert.throws(() => assertTimeoutStartRace({ ...value, expected }));
  }
});

test('rejects identity, count, active-marker, and failed-state inconsistencies', () => {
  const rejected = [
    { pre: { ...active, record_id: '999' }, response: response(40904), post: active },
    { pre: active, response: response(40904), post: { ...active, user_id: '999' } },
    { pre: active, response: response(40904), post: { ...active, paper_id: '999' } },
    { pre: active, response: response(40904), post: { ...active, assignment_id: '999' } },
    { pre: active, response: response(40904), post: { ...active, attempt_no: 1 } },
    { pre: active, response: response(40904), post: { ...active, record_count: 4, fourth_count: 1 } },
    { pre: active, response: response(40904), post: { ...active, assignment_count: 2 } },
    { pre: active, response: response(40904), post: { ...active, active_assignment_id: null } },
    { pre: active, response: response(40902), post: { ...failed, submitted_at: null } },
    { pre: active, response: response(40902), post: { ...failed, score: null } },
    { pre: active, response: response(40902), post: { ...failed, score: '60.00' } },
    { pre: active, response: response(40902), post: { ...failed, status: 'passed' } },
  ];
  for (const value of rejected) {
    assert.throws(() => assertTimeoutStartRace({ ...value, expected }));
  }
});
