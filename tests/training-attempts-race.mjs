import assert from 'node:assert/strict';

function assertCommonSnapshot(snapshot, expected) {
  assert.equal(String(snapshot.record_id), String(expected.recordId));
  assert.equal(String(snapshot.user_id), String(expected.userId));
  assert.equal(String(snapshot.paper_id), String(expected.paperId));
  assert.equal(String(snapshot.assignment_id), String(expected.assignmentId));
  assert.equal(Number(snapshot.attempt_no), 3);
  assert.equal(Number(snapshot.is_expired), 1);
  assert.equal(Number(snapshot.record_count), 3);
  assert.equal(Number(snapshot.max_attempt_no), 3);
  assert.equal(Number(snapshot.fourth_count), 0);
  assert.equal(Number(snapshot.assignment_count), 1);
}

function assertSnapshotState(snapshot, expected) {
  assertCommonSnapshot(snapshot, expected);
  if (snapshot.status === 'in_progress') {
    assert.equal(String(snapshot.active_assignment_id), String(expected.assignmentId));
    assert.equal(snapshot.submitted_at, null);
    assert.equal(snapshot.score, null);
    return 'active';
  }
  assert.equal(snapshot.status, 'timeout');
  assert.equal(snapshot.active_assignment_id, null);
  assert.equal(snapshot.submitted_at, null);
  assert.ok(snapshot.score !== null && snapshot.score !== undefined);
  assert.equal(Number(snapshot.score), 0);
  return 'timeout';
}

export function assertTimeoutStartRace({ pre, response, post, expected }) {
  const preState = assertSnapshotState(pre, expected);
  const postState = assertSnapshotState(post, expected);
  assert.equal(postState, 'timeout');
  if (response.status === 200) {
    assert.equal(preState, 'active');
    assert.equal(response.data.status, 'timeout');
    assert.equal(String(response.data.record_id), String(expected.recordId));
    assert.deepEqual(response.data.questions, []);
    return 'finalized-before-start';
  }
  assert.equal(response.status, 409);
  assert.equal(response.code, 40902);
  return preState === 'active' ? 'finalized-before-start' : 'finalized-before-pre';
}
