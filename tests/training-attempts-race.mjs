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
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.active_assignment_id, null);
  assert.ok(snapshot.submitted_at !== null && snapshot.submitted_at !== undefined);
  assert.ok(snapshot.score !== null && snapshot.score !== undefined);
  assert.equal(Number(snapshot.score), 0);
  return 'failed';
}

export function assertTimeoutStartRace({ pre, response, post, expected }) {
  const preState = assertSnapshotState(pre, expected);
  assert.equal(response.status, 409);
  const postState = assertSnapshotState(post, expected);
  if (response.code === 40904) {
    assert.equal(preState, 'active');
    return postState === 'active' ? 'active' : 'finalized-after-start';
  }
  assert.equal(response.code, 40902);
  assert.equal(postState, 'failed');
  return preState === 'active' ? 'finalized-before-start' : 'finalized-before-pre';
}
