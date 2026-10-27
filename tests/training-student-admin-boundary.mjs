import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { randomStrongPassword } from './training-access.mjs';
import { learnerSession, legacyLearnerPcSession, randomLearnerPhone } from './support/learner-session-fixture.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');

let loginSequence = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function accessPayload(actor) {
  const token = String(actor?.accessToken || '');
  const encodedPayload = token.split('.')[1];
  assert(encodedPayload, 'access token payload missing');
  // Keep the sid in memory only. Never print or persist token payloads.
  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
}

async function login(ctx, username, password, ...personalValues) {
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
  const nextPassword = randomStrongPassword(username, ...personalValues);
  const changed = await ctx.request(actor, 'PUT', '/auth/password', {
    old_password: password, new_password: nextPassword,
  });
  assert(changed.status === 200 && changed.data?.access_token, `first password change failed: ${changed.status}`);
  actor.accessToken = changed.data.access_token;
  return { actor, password: nextPassword, result: changed };
}

async function createStudent(ctx, admin, categoryId, label) {
  const username = `boundary_${label}_${randomBytes(4).toString('hex')}`;
  const employeeNo = `boundary_${randomBytes(4).toString('hex')}`;
  const response = await ctx.request(admin, 'POST', '/admin/students', {
    username,
    phone: randomLearnerPhone(),
    real_name: label,
    employee_no: employeeNo,
    category_id: String(categoryId),
    source: 'institution',
  });
  assert(response.status === 200 && response.data?.id, `student create failed: ${response.status}`);
  return { id: String(response.data.id), username, employeeNo, realName: label };
}

async function createAdministrator(ctx, admin, roleId, label) {
  const username = `boundary_admin_${randomBytes(4).toString('hex')}`;
  const password = randomStrongPassword(username, label);
  const response = await ctx.request(admin, 'POST', '/admin/administrators', {
    username, password, real_name: label, role_ids: [roleId],
  });
  assert(response.status === 200 && response.data?.id, `administrator create failed: ${response.status}`);
  return { id: String(response.data.id), username, password, realName: label };
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

async function userState(ctx, id) {
  const rows = await ctx.queryTestDb(
    'SELECT password_hash, status, auth_version, force_password_change FROM sys_user WHERE id = ?',
    [String(id)],
  );
  assert(rows.length === 1, `user ${id} disappeared`);
  return rows[0];
}

async function authSessionState(ctx, userId, actor) {
  const sid = String(accessPayload(actor).sid || '');
  assert(/^[a-f0-9]{48}$/.test(sid), 'access token durable sid missing');
  const rows = await ctx.queryTestDb(
    'SELECT sid, revoked_at FROM auth_session WHERE user_id = ? AND sid = ? LIMIT 1',
    [String(userId), sid],
  );
  assert(rows.length === 1, 'durable auth session row missing');
  return rows[0];
}

function assertSessionActive(row, label) {
  assert(row.revoked_at === null, `${label} durable session unexpectedly revoked`);
}

function assertSessionRevoked(row, label) {
  assert(row.revoked_at !== null, `${label} durable session was not revoked`);
}

async function linkedRoleCount(ctx, id) {
  const rows = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM sys_user_role WHERE user_id = ?', [String(id)]);
  return Number(rows[0]?.count || 0);
}

async function assertLinkedSessionAndState(ctx, linked, before, label) {
  const profile = await ctx.request(linked.actor, 'GET', '/auth/profile');
  assert(profile.status === 403, `${label} permission-free linked account regained PC access: ${profile.status}/${profile.code}`);
  assertSessionActive(await authSessionState(ctx, linked.id, linked.actor), label);
  const after = await userState(ctx, linked.id);
  assert(after.password_hash === before.password_hash, `${label} linked admin password changed`);
  assert(Number(after.status) === Number(before.status), `${label} linked admin status changed`);
  assert(Number(after.auth_version) === Number(before.auth_version), `${label} linked admin auth version changed`);
  assert(Number(after.force_password_change) === Number(before.force_password_change), `${label} linked admin force flag changed`);
}

async function rejectLinkedStudentEndpoint(ctx, admin, linked, before, method, path, body, label) {
  const beforeProfile = await ctx.request(linked.actor, 'GET', '/auth/profile');
  assert(beforeProfile.status === 403, `${label} permission-free linked account regained PC access: ${beforeProfile.status}/${beforeProfile.code}`);
  assertSessionActive(await authSessionState(ctx, linked.id, linked.actor), `${label} before request`);
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
    ctx, admin, linked, before, 'PUT', `/admin/students/${linked.id}/password`,
    { password: randomStrongPassword(linked.username, linked.employeeNo, linked.realName) }, 'reset',
  );
}

export async function run(ctx) {
  const adminLogin = await login(ctx, 'admin', ctx.adminPassword, null, '超级管理员');
  const admin = adminLogin.actor;

  const category = await ctx.request(admin, 'POST', '/admin/training-categories', {
    name: `boundary category ${randomBytes(4).toString('hex')}`,
  });
  assert(category.status === 200 && category.data?.id, `category create failed: ${category.status}`);
  const categoryId = String(category.data.id);

  const emptyRole = await createRole(ctx, admin, 'empty permission role', []);
  const emptyAdmin = await createAdministrator(ctx, admin, emptyRole, 'empty permission admin');
  const emptyLinkedAdmin = { ...emptyAdmin, actor: await legacyLearnerPcSession(ctx, emptyAdmin.id) };
  const emptyBefore = await userState(ctx, emptyAdmin.id);
  await assertStudentEndpointsRejectLinkedAdmin(ctx, admin, emptyLinkedAdmin, emptyBefore);

  const inactiveRole = await createRole(ctx, admin, 'inactive role', []);
  const inactiveAdmin = await createAdministrator(ctx, admin, inactiveRole, 'inactive role admin');
  const deactivated = await ctx.request(admin, 'PUT', `/admin/roles/${inactiveRole}`, { status: 0 });
  assert(deactivated.status === 200, `role deactivation failed: ${deactivated.status}`);
  const inactiveLinkedAdmin = { ...inactiveAdmin, actor: await legacyLearnerPcSession(ctx, inactiveAdmin.id) };
  const inactiveBefore = await userState(ctx, inactiveAdmin.id);
  await assertStudentEndpointsRejectLinkedAdmin(ctx, admin, inactiveLinkedAdmin, inactiveBefore);

  const list = await ctx.request(admin, 'GET', '/admin/students');
  assert(list.status === 200, `student list failed: ${list.status}`);
  const listedIds = (list.data?.items || []).map((item) => String(item.id));
  assert(!listedIds.includes(emptyAdmin.id) && !listedIds.includes(inactiveAdmin.id), 'linked admin leaked from list');

  const ordinary = await createStudent(ctx, admin, categoryId, 'ordinary student');
  const ordinaryLogin = { actor: await learnerSession(ctx, ordinary.id) };
  const profileBefore = await ctx.request(ordinaryLogin.actor, 'GET', '/me/profile');
  assert(profileBefore.status === 200 && profileBefore.data?.occupation === null
    && profileBefore.data?.gender === null && profileBefore.data?.birthday === null,
  'new nullable self-profile fields missing');
  const savedProfile = await ctx.request(ordinaryLogin.actor, 'POST', '/me/profile', {
    occupation: '  电工  ', gender: 'female', birthday: '2000-02-29',
  });
  assert(savedProfile.status === 200 && savedProfile.data?.occupation === '电工'
    && savedProfile.data?.gender === 'female' && savedProfile.data?.birthday === '2000-02-29',
  `POST self-profile save failed: ${savedProfile.status}/${savedProfile.code}`);
  const persistedProfile = await ctx.queryTestDb(
    "SELECT occupation, gender, DATE_FORMAT(birthday, '%Y-%m-%d') AS birthday FROM sys_user WHERE id = ?", [ordinary.id],
  );
  assert(persistedProfile[0]?.occupation === '电工' && persistedProfile[0]?.gender === 'female'
    && persistedProfile[0]?.birthday === '2000-02-29', 'self-profile fields did not persist');
  const reloadedProfile = await ctx.request(ordinaryLogin.actor, 'GET', '/me/profile');
  assert(reloadedProfile.status === 200 && reloadedProfile.data?.birthday === '2000-02-29'
    && reloadedProfile.data?.source === 'institution' && String(reloadedProfile.data?.category_id) === categoryId,
  'self-profile reload changed authoritative fields');
  for (const method of ['PATCH', 'POST']) {
    for (const field of ['phone', 'source', 'category_id', 'role', 'status', 'identity_status', 'username']) {
      const forged = await ctx.request(ordinaryLogin.actor, method, '/me/profile', { [field]: 'forged' });
      assert(forged.status === 400 && forged.code === 40001,
        `${method} self-profile accepted controlled field ${field}: ${forged.status}/${forged.code}`);
    }
    for (const invalid of [
      { occupation: '  ' }, { occupation: 'a'.repeat(65) }, { gender: 'other' },
      { birthday: '2023-02-29' }, { birthday: '2026-02-30' }, { birthday: '2999-01-01' },
    ]) {
      const rejected = await ctx.request(ordinaryLogin.actor, method, '/me/profile', invalid);
      assert(rejected.status === 400 && rejected.code === 40001,
        `${method} self-profile accepted invalid display fields: ${rejected.status}/${rejected.code}`);
    }
  }
  const clearedProfile = await ctx.request(ordinaryLogin.actor, 'PATCH', '/me/profile', {
    occupation: null, gender: null, birthday: null, email: 'learner@example.test',
  });
  assert(clearedProfile.status === 200 && clearedProfile.data?.occupation === null
    && clearedProfile.data?.gender === null && clearedProfile.data?.birthday === null
    && clearedProfile.data?.email === 'learner@example.test', 'PATCH profile null clear/PC compatibility failed');
  const ordinaryBeforeUpdate = await userState(ctx, ordinary.id);
  const ordinaryProfileBeforeUpdate = await ctx.request(ordinaryLogin.actor, 'GET', '/me/profile');
  assert(ordinaryProfileBeforeUpdate.status === 200, `ordinary profile before update failed: ${ordinaryProfileBeforeUpdate.status}`);
  const ordinarySessionBeforeUpdate = await authSessionState(ctx, ordinary.id, ordinaryLogin.actor);
  assertSessionActive(ordinarySessionBeforeUpdate, 'ordinary update before request');
  const updated = await ctx.request(admin, 'PUT', `/admin/students/${ordinary.id}`, { real_name: 'ordinary updated' });
  assert(updated.status === 200 && updated.data?.real_name === 'ordinary updated', 'ordinary update failed');
  const ordinaryProfileAfterUpdate = await ctx.request(ordinaryLogin.actor, 'GET', '/me/profile');
  assert(ordinaryProfileAfterUpdate.status === 200, `ordinary update revoked old token: ${ordinaryProfileAfterUpdate.status}/${ordinaryProfileAfterUpdate.code}`);
  const ordinarySessionAfterUpdate = await authSessionState(ctx, ordinary.id, ordinaryLogin.actor);
  assertSessionActive(ordinarySessionAfterUpdate, 'ordinary update after request');
  const ordinaryAfterUpdate = await userState(ctx, ordinary.id);
  assert(ordinaryAfterUpdate.password_hash === ordinaryBeforeUpdate.password_hash, 'ordinary update changed password');
  assert(Number(ordinaryAfterUpdate.status) === Number(ordinaryBeforeUpdate.status), 'ordinary update changed status');
  assert(Number(ordinaryAfterUpdate.auth_version) === Number(ordinaryBeforeUpdate.auth_version), 'ordinary update changed auth version');
  assert(Number(ordinaryAfterUpdate.force_password_change) === Number(ordinaryBeforeUpdate.force_password_change), 'ordinary update changed force flag');

  const statusBefore = await userState(ctx, ordinary.id);
  const statusProfileBefore = await ctx.request(ordinaryLogin.actor, 'GET', '/me/profile');
  assert(statusProfileBefore.status === 200, `ordinary profile before status failed: ${statusProfileBefore.status}`);
  const statusSessionBefore = await authSessionState(ctx, ordinary.id, ordinaryLogin.actor);
  assertSessionActive(statusSessionBefore, 'ordinary status before request');
  const disabled = await ctx.request(admin, 'PUT', `/admin/students/${ordinary.id}/status`, { status: 0 });
  assert(disabled.status === 200 && Number(disabled.data?.status) === 0, 'ordinary status failed');
  const statusProfileAfter = await ctx.request(ordinaryLogin.actor, 'GET', '/me/profile');
  assert(statusProfileAfter.status === 403 && statusProfileAfter.code === 40105,
    `ordinary status did not reject old token with 403/40105: ${statusProfileAfter.status}/${statusProfileAfter.code}`);
  const statusSessionAfter = await authSessionState(ctx, ordinary.id, ordinaryLogin.actor);
  assertSessionRevoked(statusSessionAfter, 'ordinary status');
  const statusAfter = await userState(ctx, ordinary.id);
  assert(Number(statusAfter.status) === 0, 'ordinary status was not persisted');
  assert(Number(statusAfter.auth_version) === Number(statusBefore.auth_version) + 1, 'ordinary status auth generation mismatch');
  assert(Number(statusAfter.force_password_change) === Number(statusBefore.force_password_change), 'ordinary status changed force flag');

  const resetTarget = await createStudent(ctx, admin, categoryId, 'ordinary reset student');
  const resetLogin = { actor: await learnerSession(ctx, resetTarget.id) };
  const resetBefore = await userState(ctx, resetTarget.id);
  const resetProfileBefore = await ctx.request(resetLogin.actor, 'GET', '/me/profile');
  assert(resetProfileBefore.status === 200, `ordinary profile before reset failed: ${resetProfileBefore.status}`);
  const resetSessionBefore = await authSessionState(ctx, resetTarget.id, resetLogin.actor);
  assertSessionActive(resetSessionBefore, 'ordinary reset before request');
  const reset = await ctx.request(admin, 'PUT', `/admin/students/${resetTarget.id}/password`, {
    password: randomStrongPassword(resetTarget.username, resetTarget.employeeNo, resetTarget.realName),
  });
  assert(reset.status === 404, `removed student reset endpoint was reachable: ${reset.status}`);
  const resetProfileAfter = await ctx.request(resetLogin.actor, 'GET', '/me/profile');
  assert(resetProfileAfter.status === 200, `removed reset changed mobile session: ${resetProfileAfter.status}`);
  const resetSessionAfter = await authSessionState(ctx, resetTarget.id, resetLogin.actor);
  assertSessionActive(resetSessionAfter, 'removed student reset');
  const resetAfter = await userState(ctx, resetTarget.id);
  assert(resetAfter.password_hash === resetBefore.password_hash, 'removed student reset changed password');
  assert(Number(resetAfter.status) === 1 && Number(resetAfter.status) === Number(resetBefore.status), 'ordinary reset changed status');
  assert(Number(resetAfter.auth_version) === Number(resetBefore.auth_version), 'removed student reset changed auth generation');
  assert(Number(resetAfter.force_password_change) === 0, 'student was marked for password change');
  assert(await linkedRoleCount(ctx, ordinary.id) === 0, 'ordinary student unexpectedly linked');
  assert(await linkedRoleCount(ctx, resetTarget.id) === 0, 'ordinary reset student unexpectedly linked');

}
