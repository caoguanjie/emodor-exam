import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');
const mysql = require('mysql2/promise');

let loginSequence = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function strongPassword() {
  return `Q${randomBytes(16).toString('hex')}Z9`;
}

async function readCaptchaAnswer(ctx, captchaId) {
  const redis = new Redis({
    host: ctx.env.REDIS_HOST || '127.0.0.1',
    port: Number(ctx.env.REDIS_PORT || 6379),
    password: ctx.env.REDIS_PASSWORD || undefined,
  });
  try {
    return await redis.get(`${ctx.env.REDIS_KEY_PREFIX || ''}auth:captcha:${captchaId}`);
  } finally {
    await redis.quit();
  }
}

async function login(ctx, username, password) {
  const sourceIp = `198.51.100.${(loginSequence = (loginSequence % 200) + 1)}`;
  const headers = { 'X-Forwarded-For': sourceIp };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert(captcha.status === 200 && captcha.data?.captcha_id, 'captcha fixture failed');
  const answer = await readCaptchaAnswer(ctx, captcha.data.captcha_id);
  assert(answer, 'captcha answer missing from run-owned Redis');
  const actor = {};
  const result = await ctx.request(actor, 'POST', '/auth/login', {
    username, password, captcha_id: captcha.data.captcha_id, captcha_code: answer,
  }, headers);
  assert(result.status === 200, `login failed: ${result.status}`);
  actor.accessToken = result.data.access_token;
  if (!result.data.force_change_password) return { actor, password, result };
  const nextPassword = strongPassword();
  const changed = await ctx.request(actor, 'PUT', '/auth/password', {
    old_password: password, new_password: nextPassword,
  });
  assert(changed.status === 200 && changed.data?.access_token, `first password change failed: ${changed.status}`);
  actor.accessToken = changed.data.access_token;
  return { actor, password: nextPassword, result: changed };
}

async function dbConnection(ctx) {
  return mysql.createConnection({
    host: ctx.env.DB_HOST || '127.0.0.1',
    port: Number(ctx.env.DB_PORT || 3306),
    user: ctx.env.DB_USERNAME || 'root',
    password: ctx.env.DB_PASSWORD || undefined,
    database: ctx.env.DB_DATABASE,
  });
}

async function holdUserRow(ctx, id) {
  const connection = await dbConnection(ctx);
  await connection.beginTransaction();
  await connection.execute('SELECT id FROM sys_user WHERE id = ? FOR UPDATE', [String(id)]);
  return connection;
}

async function releaseLock(connection, commit = false) {
  if (!connection) return;
  if (commit) await connection.commit();
  else await connection.rollback().catch(() => undefined);
  await connection.end();
}

async function waitForLockWaits(ctx, minimum, label) {
  const observer = await dbConnection(ctx);
  const started = Date.now();
  try {
    while (Date.now() - started < 8_000) {
      const [rows] = await observer.query('SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits');
      if (Number(rows[0]?.count || 0) >= minimum) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    await observer.end();
  }
  throw new Error(`${label} did not reach ${minimum} owned lock waits`);
}

async function createStudent(ctx, admin, categoryId, label) {
  const password = strongPassword();
  const username = `boundary_${label}_${randomBytes(4).toString('hex')}`;
  const response = await ctx.request(admin, 'POST', '/admin/students', {
    username,
    password,
    real_name: label,
    category_id: String(categoryId),
    source: 'institution',
  });
  assert(response.status === 200 && response.data?.id, `student create failed: ${response.status}`);
  return { id: String(response.data.id), username, password };
}

async function createRole(ctx, admin, name, permissions = []) {
  const response = await ctx.request(admin, 'POST', '/admin/roles', {
    code: `boundary_${randomBytes(4).toString('hex')}`,
    name,
    permissions,
  });
  assert(response.status === 200 && response.data?.id, `role create failed: ${response.status}`);
  return String(response.data.id);
}

async function assignRole(ctx, admin, userId, roleId) {
  const response = await ctx.request(admin, 'PUT', `/admin/administrators/${userId}/roles`, {
    role_ids: [String(roleId)],
  });
  assert(response.status === 200, `role assignment failed: ${response.status}`);
}

async function userState(ctx, id) {
  const rows = await ctx.queryTestDb(
    'SELECT password_hash, status, auth_version FROM sys_user WHERE id = ?',
    [String(id)],
  );
  assert(rows.length === 1, `user ${id} disappeared`);
  return rows[0];
}

async function linkedRoleCount(ctx, id) {
  const rows = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM sys_user_role WHERE user_id = ?', [String(id)]);
  return Number(rows[0]?.count || 0);
}

async function assertLinkedSessionAndState(ctx, linked, before, label) {
  const profile = await ctx.request(linked.actor, 'GET', '/auth/profile');
  assert(profile.status === 200, `${label} linked admin session was revoked: ${profile.status}/${profile.code}`);
  const after = await userState(ctx, linked.id);
  assert(after.password_hash === before.password_hash, `${label} linked admin password changed`);
  assert(Number(after.status) === Number(before.status), `${label} linked admin status changed`);
  assert(Number(after.auth_version) === Number(before.auth_version), `${label} linked admin auth version changed`);
}

async function rejectLinkedStudentEndpoint(ctx, admin, linked, before, method, path, body, label) {
  const beforeProfile = await ctx.request(linked.actor, 'GET', '/auth/profile');
  assert(beforeProfile.status === 200, `${label} linked admin profile before request failed: ${beforeProfile.status}/${beforeProfile.code}`);
  const response = await ctx.request(admin, method, path, body);
  assert(response.status === 404, `${label} linked admin request accepted: ${response.status}`);
  await assertLinkedSessionAndState(ctx, linked, before, label);
}

async function assertStudentEndpointsRejectLinkedAdmin(ctx, admin, linked, before) {
  await rejectLinkedStudentEndpoint(
    ctx, admin, linked, before, 'GET', `/admin/students/${linked.id}`, undefined, 'detail',
  );
  await rejectLinkedStudentEndpoint(
    ctx, admin, linked, before, 'PUT', `/admin/students/${linked.id}`, { real_name: 'must-not-change' }, 'update',
  );
  await rejectLinkedStudentEndpoint(
    ctx, admin, linked, before, 'PUT', `/admin/students/${linked.id}/status`, { status: 0 }, 'status',
  );
  await rejectLinkedStudentEndpoint(
    ctx, admin, linked, before, 'PUT', `/admin/students/${linked.id}/password`, { password: strongPassword() }, 'reset',
  );
}

async function raceRoleAssignmentFirst(ctx, admin, categoryId) {
  const roleId = await createRole(ctx, admin, 'race-assignment-first');
  const target = await createStudent(ctx, admin, categoryId, 'race assignment first');
  const before = await userState(ctx, target.id);
  const blocker = await holdUserRow(ctx, target.id);
  let released = false;
  try {
    const assignmentPromise = ctx.request(admin, 'PUT', `/admin/administrators/${target.id}/roles`, {
      role_ids: [roleId],
    });
    await waitForLockWaits(ctx, 1, 'assignment-first role assignment');
    const resetPromise = ctx.request(admin, 'PUT', `/admin/students/${target.id}/password`, {
      password: strongPassword(),
    });
    await waitForLockWaits(ctx, 2, 'assignment-first reset');
    await releaseLock(blocker, true);
    released = true;
    const [assignment, reset] = await Promise.all([assignmentPromise, resetPromise]);
    assert(assignment.status === 200, `assignment-first role assignment failed: ${assignment.status}`);
    assert(reset.status === 404, `assignment-first reset bypassed link: ${reset.status}`);
  } finally {
    if (!released) await releaseLock(blocker);
  }
  const after = await userState(ctx, target.id);
  assert(after.password_hash === before.password_hash, 'assignment-first reset changed password');
  assert(Number(after.auth_version) === Number(before.auth_version) + 1, 'assignment-first auth generation mismatch');
  assert(await linkedRoleCount(ctx, target.id) === 1, 'assignment-first link missing');
}

async function raceStatusFirst(ctx, admin, categoryId) {
  const roleId = await createRole(ctx, admin, 'race-status-first');
  const target = await createStudent(ctx, admin, categoryId, 'race status first');
  const before = await userState(ctx, target.id);
  const blocker = await holdUserRow(ctx, target.id);
  let released = false;
  try {
    const statusPromise = ctx.request(admin, 'PUT', `/admin/students/${target.id}/status`, { status: 0 });
    await waitForLockWaits(ctx, 1, 'status-first status mutation');
    const assignmentPromise = ctx.request(admin, 'PUT', `/admin/administrators/${target.id}/roles`, {
      role_ids: [roleId],
    });
    await waitForLockWaits(ctx, 2, 'status-first role assignment');
    await releaseLock(blocker, true);
    released = true;
    const [status, assignment] = await Promise.all([statusPromise, assignmentPromise]);
    assert(status.status === 200, `status-first status mutation failed: ${status.status}`);
    assert(assignment.status === 200, `status-first role assignment failed: ${assignment.status}`);
  } finally {
    if (!released) await releaseLock(blocker);
  }
  const after = await userState(ctx, target.id);
  assert(Number(after.status) === 0, 'status-first status was not persisted');
  assert(Number(after.auth_version) === Number(before.auth_version) + 2, 'status-first auth generation mismatch');
  assert(await linkedRoleCount(ctx, target.id) === 1, 'status-first link missing');
}

export async function run(ctx) {
  const adminLogin = await login(ctx, 'admin', ctx.adminPassword);
  const admin = adminLogin.actor;

  const category = await ctx.request(admin, 'POST', '/admin/training-categories', {
    name: `boundary category ${randomBytes(4).toString('hex')}`,
  });
  assert(category.status === 200 && category.data?.id, `category create failed: ${category.status}`);
  const categoryId = String(category.data.id);

  const emptyRole = await createRole(ctx, admin, 'empty permission role', []);
  const emptyAdmin = await createStudent(ctx, admin, categoryId, 'empty permission admin');
  await assignRole(ctx, admin, emptyAdmin.id, emptyRole);
  const emptyAdminLogin = await login(ctx, emptyAdmin.username, emptyAdmin.password);
  const emptyLinkedAdmin = { ...emptyAdmin, actor: emptyAdminLogin.actor };
  const emptyBefore = await userState(ctx, emptyAdmin.id);
  await assertStudentEndpointsRejectLinkedAdmin(ctx, admin, emptyLinkedAdmin, emptyBefore);

  const inactiveRole = await createRole(ctx, admin, 'inactive role', []);
  const inactiveAdmin = await createStudent(ctx, admin, categoryId, 'inactive role admin');
  await assignRole(ctx, admin, inactiveAdmin.id, inactiveRole);
  const deactivated = await ctx.request(admin, 'PUT', `/admin/roles/${inactiveRole}`, { status: 0 });
  assert(deactivated.status === 200, `role deactivation failed: ${deactivated.status}`);
  const inactiveAdminLogin = await login(ctx, inactiveAdmin.username, inactiveAdmin.password);
  const inactiveLinkedAdmin = { ...inactiveAdmin, actor: inactiveAdminLogin.actor };
  const inactiveBefore = await userState(ctx, inactiveAdmin.id);
  await assertStudentEndpointsRejectLinkedAdmin(ctx, admin, inactiveLinkedAdmin, inactiveBefore);

  const list = await ctx.request(admin, 'GET', '/admin/students');
  assert(list.status === 200, `student list failed: ${list.status}`);
  const listedIds = (list.data?.items || []).map((item) => String(item.id));
  assert(!listedIds.includes(emptyAdmin.id) && !listedIds.includes(inactiveAdmin.id), 'linked admin leaked from list');

  const ordinary = await createStudent(ctx, admin, categoryId, 'ordinary student');
  const ordinaryLogin = await login(ctx, ordinary.username, ordinary.password);
  const ordinaryBeforeUpdate = await userState(ctx, ordinary.id);
  const ordinaryProfileBeforeUpdate = await ctx.request(ordinaryLogin.actor, 'GET', '/auth/profile');
  assert(ordinaryProfileBeforeUpdate.status === 200, `ordinary profile before update failed: ${ordinaryProfileBeforeUpdate.status}`);
  const updated = await ctx.request(admin, 'PUT', `/admin/students/${ordinary.id}`, { real_name: 'ordinary updated' });
  assert(updated.status === 200 && updated.data?.real_name === 'ordinary updated', 'ordinary update failed');
  const ordinaryProfileAfterUpdate = await ctx.request(ordinaryLogin.actor, 'GET', '/auth/profile');
  assert(ordinaryProfileAfterUpdate.status === 200, `ordinary update revoked old token: ${ordinaryProfileAfterUpdate.status}/${ordinaryProfileAfterUpdate.code}`);
  const ordinaryAfterUpdate = await userState(ctx, ordinary.id);
  assert(ordinaryAfterUpdate.password_hash === ordinaryBeforeUpdate.password_hash, 'ordinary update changed password');
  assert(Number(ordinaryAfterUpdate.status) === Number(ordinaryBeforeUpdate.status), 'ordinary update changed status');
  assert(Number(ordinaryAfterUpdate.auth_version) === Number(ordinaryBeforeUpdate.auth_version), 'ordinary update changed auth version');

  const statusBefore = await userState(ctx, ordinary.id);
  const statusProfileBefore = await ctx.request(ordinaryLogin.actor, 'GET', '/auth/profile');
  assert(statusProfileBefore.status === 200, `ordinary profile before status failed: ${statusProfileBefore.status}`);
  const disabled = await ctx.request(admin, 'PUT', `/admin/students/${ordinary.id}/status`, { status: 0 });
  assert(disabled.status === 200 && Number(disabled.data?.status) === 0, 'ordinary status failed');
  const statusProfileAfter = await ctx.request(ordinaryLogin.actor, 'GET', '/auth/profile');
  assert(
    (statusProfileAfter.status === 403 && statusProfileAfter.code === 40105)
      || (statusProfileAfter.status === 401 && statusProfileAfter.code === 40107),
    `ordinary status did not revoke old token: ${statusProfileAfter.status}/${statusProfileAfter.code}`,
  );
  const statusAfter = await userState(ctx, ordinary.id);
  assert(Number(statusAfter.status) === 0, 'ordinary status was not persisted');
  assert(Number(statusAfter.auth_version) === Number(statusBefore.auth_version) + 1, 'ordinary status auth generation mismatch');

  const resetTarget = await createStudent(ctx, admin, categoryId, 'ordinary reset student');
  const resetLogin = await login(ctx, resetTarget.username, resetTarget.password);
  const resetBefore = await userState(ctx, resetTarget.id);
  const resetProfileBefore = await ctx.request(resetLogin.actor, 'GET', '/auth/profile');
  assert(resetProfileBefore.status === 200, `ordinary profile before reset failed: ${resetProfileBefore.status}`);
  const reset = await ctx.request(admin, 'PUT', `/admin/students/${resetTarget.id}/password`, { password: strongPassword() });
  assert(reset.status === 200, `ordinary reset failed: ${reset.status}`);
  const resetProfileAfter = await ctx.request(resetLogin.actor, 'GET', '/auth/profile');
  assert(
    (resetProfileAfter.status === 401 && resetProfileAfter.code === 40107)
      || (resetProfileAfter.status === 403 && resetProfileAfter.code === 40105),
    `ordinary reset did not revoke old token: ${resetProfileAfter.status}/${resetProfileAfter.code}`,
  );
  const resetAfter = await userState(ctx, resetTarget.id);
  assert(resetAfter.password_hash !== resetBefore.password_hash, 'ordinary reset did not change password');
  assert(Number(resetAfter.status) === Number(resetBefore.status), 'ordinary reset changed status');
  assert(Number(resetAfter.auth_version) === Number(resetBefore.auth_version) + 1, 'ordinary reset auth generation mismatch');
  assert(await linkedRoleCount(ctx, ordinary.id) === 0, 'ordinary student unexpectedly linked');
  assert(await linkedRoleCount(ctx, resetTarget.id) === 0, 'ordinary reset student unexpectedly linked');

  await raceRoleAssignmentFirst(ctx, admin, categoryId);
  await raceStatusFirst(ctx, admin, categoryId);
}
