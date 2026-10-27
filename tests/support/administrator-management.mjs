import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './password-fixture.mjs';
import { randomLearnerPhone } from './learner-session-fixture.mjs';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const bcrypt = require('bcryptjs');
function assert(value, message) { if (!value) throw new Error(message); }
const rejected = (result) => result.status >= 400 && result.status < 500;

/** Only the ephemeral training-access database may be supplied by the harness. */
export async function verifyAdministratorManagement(ctx, fixtures, helpers) {
  const { admin, roleId, readActor, writeActor, categoryId } = fixtures;
  const { captchaLogin, completeFirstLogin, holdRowLock, waitForLockWaits, closeLock } = helpers;
  const username = `account_crud_${randomBytes(5).toString('hex')}`;
  const password = randomStrongPassword(username);
  const roleIds = [roleId];
  const created = await ctx.request(admin.actor, 'POST', '/admin/administrators', {
    username, password, role_ids: roleIds, status: 0,
  });
  assert(created.status === 200 && created.data?.id, `administrator optional-name create failed: ${created.status}`);
  const id = String(created.data.id);
  const path = `/admin/administrators/${id}`;
  const original = await ctx.request(admin.actor, 'GET', path);
  assert(original.status === 200 && original.data.real_name === '' && original.data.status === 0, 'administrator create lost optional name or disabled status');
  assert(Date.now() - new Date(original.data.created_at).getTime() < 60_000 && Date.now() >= new Date(original.data.created_at).getTime(), 'administrator creation timestamp differs from server time');
  assert(!('password' in original.data) && !('password_hash' in original.data), 'administrator details leaked credentials');

  for (const query of ['page=1.5', 'page_size=101', 'page=0', 'unexpected=1']) {
    const invalid = await ctx.request(admin.actor, 'GET', `/admin/administrators?${query}`);
    assert(invalid.status === 400, `administrator list accepted malformed query ${query}`);
  }
  const page = await ctx.request(readActor, 'GET', `/admin/administrators?page=1&page_size=1&keyword=${username}`);
  assert(page.status === 200 && page.data.total === 1 && page.data.page_size === 1 && page.data.items[0]?.id === id, 'administrator keyword pagination failed');
  assert(['phone', 'login_count', 'last_login_ip', 'created_at'].every((key) => key in page.data.items[0]), 'administrator list lacks legacy login fields');
  const emptyPage = await ctx.request(readActor, 'GET', `/admin/administrators?page=2&page_size=1&keyword=${username}`);
  assert(emptyPage.status === 200 && emptyPage.data.total === 1 && emptyPage.data.items.length === 0, 'administrator pagination did not bound rows');

  const readEdit = await ctx.request(readActor, 'PUT', path, { real_name: '禁止修改', role_ids: roleIds, status: 1 });
  const readReset = await ctx.request(readActor, 'POST', `${path}/reset-password`, { password: randomStrongPassword(username) });
  const readDelete = await ctx.request(readActor, 'DELETE', path);
  assert([readEdit, readReset, readDelete].every((result) => result.status === 403), 'read-only administrator mutated an account');
  const invalidStatus = await ctx.request(admin.actor, 'PUT', path, { role_ids: roleIds, status: '1' });
  const invalidUsername = await ctx.request(admin.actor, 'PUT', path, { role_ids: roleIds, username: 'cannot_rename' });
  const invalidRoles = await ctx.request(admin.actor, 'PUT', path, { role_ids: [], status: 1 });
  assert([invalidStatus, invalidUsername, invalidRoles].every((result) => result.status === 400), 'administrator update accepted malformed fields');
  const phone = randomLearnerPhone();
  const edited = await ctx.request(admin.actor, 'PUT', path, { real_name: '管理员维护回归', phone, role_ids: roleIds, status: 1 });
  assert(edited.status === 200, `administrator edit failed: ${edited.status}`);
  const byPhone = await ctx.request(admin.actor, 'GET', `/admin/administrators?keyword=${phone}`);
  assert(byPhone.status === 200 && byPhone.data.items[0]?.id === id, 'administrator phone search failed');
  const loggedIn = await completeFirstLogin(ctx, await captchaLogin(ctx, username, password), username, password, 'AccountCrud');
  const beforeReset = (await ctx.queryTestDb('SELECT login_count,last_login_at,last_login_ip,auth_version FROM sys_user WHERE id=?', [id]))[0];
  const oldAccess = loggedIn.actor.accessToken;
  const oldCookie = loggedIn.actor.cookie;
  const replacement = randomStrongPassword(username, '管理员维护回归');
  const reset = await ctx.request(writeActor, 'POST', `${path}/reset-password`, { password: replacement });
  assert(reset.status === 200, `delegated administrator password reset failed: ${reset.status}`);
  const afterReset = (await ctx.queryTestDb('SELECT password_hash,force_password_change,login_count,last_login_at,last_login_ip,auth_version FROM sys_user WHERE id=?', [id]))[0];
  assert(await bcrypt.compare(replacement, afterReset.password_hash), 'administrator reset did not store the supplied password hash');
  assert(!(await bcrypt.compare(loggedIn.password, afterReset.password_hash)), 'administrator reset left the old password valid');
  assert(Number(afterReset.force_password_change) === 1 && Number(afterReset.auth_version) > Number(beforeReset.auth_version), 'administrator reset omitted forced change or auth version');
  assert(Number(afterReset.login_count) === Number(beforeReset.login_count)
    && String(afterReset.last_login_at) === String(beforeReset.last_login_at)
    && afterReset.last_login_ip === beforeReset.last_login_ip, 'administrator reset rewrote real login history');
  const resetAccess = await ctx.request({ accessToken: oldAccess }, 'GET', '/auth/profile');
  const resetRefresh = await ctx.request({ cookie: oldCookie }, 'POST', '/auth/refresh');
  assert(rejected(resetAccess) && rejected(resetRefresh), 'administrator reset retained an old access/refresh token');
  const pendingLogin = await captchaLogin(ctx, username, replacement);
  assert(pendingLogin.result.data.force_change_password === true, 'administrator reset did not require next-login password change');
  const afterChange = await completeFirstLogin(ctx, pendingLogin, username, replacement, 'AfterReset');

  const selfDisable = await ctx.request(writeActor, 'PUT', `/admin/administrators/${fixtures.writeId}`, { role_ids: [fixtures.writeRoleId], status: 0 });
  const selfDelete = await ctx.request(writeActor, 'DELETE', `/admin/administrators/${fixtures.writeId}`);
  const selfReset = await ctx.request(writeActor, 'POST', `/admin/administrators/${fixtures.writeId}/reset-password`, { password: randomStrongPassword() });
  assert([selfDisable, selfDelete, selfReset].every(rejected), 'administrator self protection failed');
  for (const [method, endpoint, body] of [
    ['PUT', '/admin/administrators/1', { real_name: '不能改超级管理员', status: 1 }],
    ['POST', '/admin/administrators/1/reset-password', { password: randomStrongPassword() }],
    ['DELETE', '/admin/administrators/1', undefined],
  ]) {
    assert(rejected(await ctx.request(writeActor, method, endpoint, body)), 'delegated administrator changed a super administrator');
  }
  assert(rejected(await ctx.request(admin.actor, 'PUT', '/admin/administrators/1', { status: 0 })), 'super administrator was disabled');
  assert(rejected(await ctx.request(admin.actor, 'DELETE', '/admin/administrators/1')), 'super administrator was deleted');

  const learner = await ctx.request(admin.actor, 'POST', '/admin/students', {
    username: `crud_learner_${randomBytes(5).toString('hex')}`, real_name: '管理员边界学员', phone: randomLearnerPhone(),
    category_id: categoryId, source: 'institution',
  });
  assert(learner.status === 200 && learner.data.id, 'administrator-boundary learner fixture failed');
  for (const [method, suffix, body] of [
    ['GET', '', undefined], ['PUT', '', { role_ids: roleIds, status: 0 }],
    ['POST', '/reset-password', { password: randomStrongPassword() }], ['DELETE', '', undefined],
  ]) {
    const denied = await ctx.request(admin.actor, method, `/admin/administrators/${learner.data.id}${suffix}`, body);
    assert(denied.status === 404, `administrator API reached a pure learner via ${method}`);
  }

  // Both requests wait behind an owned row lock. Deletion is queued first;
  // the subsequent role edit must observe its tombstone after acquiring the lock.
  let lock = await holdRowLock(ctx, 'SELECT id FROM sys_user WHERE id=? FOR UPDATE', [id]);
  let deletion;
  let update;
  try {
    deletion = ctx.request(admin.actor, 'DELETE', path);
    await waitForLockWaits(ctx, 1, 'administrator deletion');
    update = ctx.request(admin.actor, 'PUT', path, { role_ids: roleIds, real_name: '删除后不得更新' });
    await waitForLockWaits(ctx, 2, 'deleted administrator update');
    await closeLock(lock);
    lock = null;
    const [deleted, updated] = await Promise.all([deletion, update]);
    assert(deleted.status === 200 && updated.status === 404, `administrator deletion/update race failed: ${deleted.status}/${updated.status}`);
  } finally {
    await closeLock(lock);
    await Promise.allSettled([deletion, update].filter(Boolean));
  }
  const afterDelete = (await ctx.queryTestDb('SELECT status,deleted_at FROM sys_user WHERE id=?', [id]))[0];
  const links = await ctx.queryTestDb('SELECT role_id FROM sys_user_role WHERE user_id=?', [id]);
  assert(afterDelete?.deleted_at && Number(afterDelete.status) === 0 && links.length === 1, 'administrator soft deletion discarded historical identity or role classification');
  const deletedAccess = await ctx.request(afterChange.actor, 'GET', '/auth/profile');
  const deletedRefresh = await ctx.request({ cookie: afterChange.actor.cookie }, 'POST', '/auth/refresh');
  assert(rejected(deletedAccess) && rejected(deletedRefresh), 'deleted administrator retained login sessions');
  const deletedList = await ctx.request(admin.actor, 'GET', `/admin/administrators?keyword=${username}`);
  const students = await ctx.request(admin.actor, 'GET', `/admin/students?keyword=${phone}`);
  assert(deletedList.data.total === 0 && students.data.total === 0, 'deleted administrator resurfaced in a management list');
  for (const [method, suffix, body] of [
    ['GET', '', undefined], ['PUT', '', { role_ids: roleIds, status: 1 }],
    ['POST', '/reset-password', { password: randomStrongPassword() }],
  ]) {
    assert((await ctx.request(admin.actor, method, `${path}${suffix}`, body)).status === 404, `deleted administrator was mutable via ${method} ${suffix}`);
  }
  const studentStatus = await ctx.request(admin.actor, 'PUT', `/admin/students/${id}/status`, { status: 1 });
  assert(studentStatus.status === 404, 'student API re-enabled a deleted administrator');
}
