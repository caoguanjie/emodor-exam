import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAvatarRead,
  preflightAvatarSave,
  reconcileStudentAvatar,
  runStudentSaveWorkflow,
} from '../src/utils/avatar-save-state.ts';

test('confirms an uncertain write when exact student GET returns the desired id', async () => {
  let requestedPath = '';
  const result = await reconcileStudentAvatar('42', 'asset-new', async (path) => {
    requestedPath = path;
    return { id: '42', avatar_id: 'asset-new' };
  });
  assert.equal(requestedPath, '/admin/students/42');
  assert.deepEqual(result, {
    outcome: 'applied',
    confirmedId: 'asset-new',
    pendingId: null,
    message: '头像已确认更新',
  });
});

test('retains the pending id when exact student GET confirms the old avatar', async () => {
  const result = await reconcileStudentAvatar('42', 'asset-new', async () => ({
    id: '42',
    avatar_id: 'asset-old',
  }));
  assert.equal(result.outcome, 'not_applied');
  assert.equal(result.confirmedId, 'asset-old');
  assert.equal(result.pendingId, 'asset-new');
  assert.match(result.message, /尚未应用/);
});

test('keeps the pending id and marks unknown when the state query is unavailable', async () => {
  const result = await reconcileStudentAvatar('42', 'asset-new', async () => {
    throw new Error('network lost');
  });
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.confirmedId, null);
  assert.equal(result.pendingId, 'asset-new');
  assert.match(result.message, /无法确认/);
});

test('treats a clear-avatar response as applied only when the server reports null', () => {
  assert.equal(classifyAvatarRead(null, { avatar_id: null }).outcome, 'applied');
  assert.equal(classifyAvatarRead(null, { avatar_id: 'asset-old' }).outcome, 'not_applied');
});

test('queries an unknown save before writing and blocks the write when the query is still unknown', async () => {
  const context = { dialogVersion: 1, studentId: '42', desiredId: 'asset-new' };
  let reads = 0;
  let writes = 0;
  const decision = await preflightAvatarSave(
    'unknown',
    context,
    async (path) => {
      reads += 1;
      assert.equal(path, '/admin/students/42');
      throw new Error('network lost');
    },
    () => context,
  );
  if (decision.action === 'write') writes += 1;
  assert.equal(reads, 1);
  assert.equal(writes, 0);
  assert.equal(decision.action, 'blocked');
  assert.equal(decision.result.outcome, 'unknown');
});

test('requires a later explicit save after a query confirms the target was not applied', async () => {
  const context = { dialogVersion: 1, studentId: '42', desiredId: 'asset-new' };
  const first = await preflightAvatarSave(
    'unknown',
    context,
    async () => ({ avatar_id: 'asset-old' }),
    () => context,
  );
  assert.equal(first.action, 'blocked');
  assert.equal(first.result.outcome, 'not_applied');
  const retry = await preflightAvatarSave(
    'not_applied',
    context,
    async () => {
      throw new Error('must not query after known result');
    },
    () => context,
  );
  assert.equal(retry.action, 'write');
});

test('ignores an old query after cancel and opening another student dialog', async () => {
  const oldContext = { dialogVersion: 1, studentId: '42', desiredId: 'asset-new' };
  let currentContext = oldContext;
  let resolveRead;
  const read = new Promise((resolve) => { resolveRead = resolve; });
  const pending = preflightAvatarSave(
    'unknown',
    oldContext,
    async () => read,
    () => currentContext,
  );
  currentContext = { dialogVersion: 2, studentId: '43', desiredId: 'other-avatar' };
  resolveRead({ avatar_id: 'asset-new' });
  const decision = await pending;
  assert.equal(decision.action, 'stale');
  assert.equal(decision.result.outcome, 'applied');
});

test('does not close or mutate another dialog after the original avatar PUT succeeds late', async () => {
  const original = {
    dialogVersion: 1,
    studentId: '42',
    desiredId: 'asset-new',
    ordinary: { real_name: 'A' },
  };
  let current = original;
  let resolveAvatar;
  let ordinaryWrites = 0;
  let avatarWrites = 0;
  const pending = runStudentSaveWorkflow('pending', original, {
    avatarChanged: true,
    read: async () => ({ avatar_id: 'asset-old' }),
    currentContext: () => current,
    writeOrdinary: async (draft) => {
      ordinaryWrites += 1;
      assert.deepEqual(draft, { real_name: 'A' });
    },
    writeAvatar: async () => {
      avatarWrites += 1;
      await new Promise((resolve) => { resolveAvatar = resolve; });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  current = { dialogVersion: 2, studentId: '43', desiredId: 'asset-b', ordinary: { real_name: 'B' } };
  resolveAvatar();
  const result = await pending;
  assert.equal(result.outcome, 'stale');
  assert.equal(ordinaryWrites, 1);
  assert.equal(avatarWrites, 1);
});

test('reconciles a late failed PUT against the original student without touching the new dialog', async () => {
  const original = {
    dialogVersion: 1,
    studentId: '42',
    desiredId: 'asset-new',
    ordinary: { real_name: 'A' },
  };
  let current = original;
  const readPaths = [];
  let rejectAvatar;
  const pending = runStudentSaveWorkflow('pending', original, {
    avatarChanged: true,
    read: async (path) => {
      readPaths.push(path);
      return { avatar_id: 'asset-old' };
    },
    currentContext: () => current,
    writeOrdinary: async () => undefined,
    writeAvatar: async () => new Promise((_resolve, reject) => { rejectAvatar = reject; }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  current = { dialogVersion: 2, studentId: '43', desiredId: 'asset-b', ordinary: { real_name: 'B' } };
  rejectAvatar(new Error('late response lost'));
  const result = await pending;
  assert.equal(result.outcome, 'stale');
  assert.deepEqual(readPaths, ['/admin/students/42']);
});

test('keeps ordinary edits when unknown avatar state is confirmed applied', async () => {
  const original = {
    dialogVersion: 4,
    studentId: '42',
    desiredId: 'asset-new',
    ordinary: { real_name: '新姓名', phone: '13800000000' },
  };
  let ordinaryDraft;
  let avatarWrites = 0;
  const result = await runStudentSaveWorkflow('unknown', original, {
    avatarChanged: true,
    read: async (path) => {
      assert.equal(path, '/admin/students/42');
      return { avatar_id: 'asset-new' };
    },
    currentContext: () => original,
    writeOrdinary: async (draft) => { ordinaryDraft = draft; },
    writeAvatar: async () => { avatarWrites += 1; },
  });
  assert.equal(result.outcome, 'saved');
  assert.deepEqual(ordinaryDraft, { real_name: '新姓名', phone: '13800000000' });
  assert.equal(avatarWrites, 0);
});
