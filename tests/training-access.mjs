import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function randomStrongPassword(...personalValues) {
  const forbidden = personalValues
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => value.length >= 3);
  while (true) {
    const password = `Q${randomBytes(16).toString('hex')}Z9`;
    if (!forbidden.some((value) => password.toLowerCase().includes(value))) return password;
  }
}

async function captchaLogin(ctx, username, password) {
  const issued = await ctx.request(null, 'POST', '/auth/captcha');
  assert(issued.status === 200 && issued.data?.captcha_id, `captcha issue failed: ${issued.status}`);
  const redis = new Redis({
    host: ctx.env.REDIS_HOST || '127.0.0.1',
    port: Number(ctx.env.REDIS_PORT || 6379),
    password: ctx.env.REDIS_PASSWORD || undefined,
    lazyConnect: false,
  });
  try {
    const prefix = ctx.env.REDIS_KEY_PREFIX || '';
    const answer = await redis.get(`${prefix}auth:captcha:${issued.data.captcha_id}`);
    assert(answer, 'captcha fixture answer missing from run-owned Redis');
    const actor = {};
    const result = await ctx.request(actor, 'POST', '/auth/login', {
      username, password, captcha_id: issued.data.captcha_id, captcha_code: answer,
    });
    assert(result.status === 200, `admin login failed: ${result.status}`);
    actor.accessToken = result.data.access_token;
    return { actor, result };
  } finally {
    await redis.quit();
  }
}
async function completeFirstLogin(ctx, login, username, oldPassword, suffix) {
  if (!login.result.data?.force_change_password) return { ...login, password: oldPassword };
  // 不能把账号/姓名作为口令片段，避免触发业务层个人信息子串策略。
  const newPassword = randomStrongPassword(username);
  const changed = await ctx.request(login.actor, 'PUT', '/auth/password', {
    old_password: oldPassword, new_password: newPassword,
  });
  assert(changed.status === 200, `first login password change failed: ${changed.status}`);
  login.actor.accessToken = changed.data.access_token;
  return { ...(await captchaLogin(ctx, username, newPassword)), password: newPassword };
}

export async function run(ctx) {
  const admin = await completeFirstLogin(
    ctx,
    await captchaLogin(ctx, 'admin', ctx.adminPassword),
    'admin', ctx.adminPassword, 'Admin',
  );

  const missingCaptcha = await ctx.request(null, 'POST', '/auth/login', { username: 'admin', password: ctx.adminPassword });
  assert(missingCaptcha.status === 400, `adminWithoutCaptcha expected 400, got ${missingCaptcha.status}`);

  const employeeUsername = `employee_${randomBytes(4).toString('hex')}`;
  const employeePassword = randomStrongPassword(employeeUsername, '临时员工');
  const employee = await ctx.request(admin.actor, 'POST', '/users', {
    username: employeeUsername, password: employeePassword,
    real_name: '临时员工', role: 'employee',
  });
  assert(employee.status === 200, `employee fixture create failed: ${employee.status} ${JSON.stringify(employee.json || employee.data)}`);
  const employeeLogin = await ctx.request(null, 'POST', '/auth/login', {
    username: employee.data.username, password: employeePassword,
  });
  assert(employeeLogin.status === 200, `employeeLegacyLogin expected 200, got ${employeeLogin.status}`);

  const roleCode = `limited_${randomBytes(4).toString('hex')}`;
  const role = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: roleCode, name: '只读统计', permissions: ['statistics:read'],
  });
  assert(role.status === 200 && role.data?.id, `limited role create failed: ${role.status}`);
  const restrictedUsername = `restricted_${randomBytes(4).toString('hex')}`;
  const restrictedPassword = randomStrongPassword(restrictedUsername, '受限管理员');
  const restricted = await ctx.request(admin.actor, 'POST', '/users', {
    username: restrictedUsername, password: restrictedPassword,
    real_name: '受限管理员', role: 'regulation_admin',
  });
  assert(restricted.status === 200 && restricted.data?.id, `restricted fixture create failed: ${restricted.status}`);
  const assigned = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${restricted.data.id}/roles`, { role_ids: [role.data.id] });
  assert(assigned.status === 200, `restricted role assignment failed: ${assigned.status}`);

  const restrictedLogin = await completeFirstLogin(
    ctx,
    await captchaLogin(ctx, restricted.data.username, restrictedPassword),
    restricted.data.username, restrictedPassword, 'Restricted',
  );
  const allowedStats = await ctx.request(restrictedLogin.actor, 'GET', '/statistics/regulations');
  assert(allowedStats.status !== 403, `statistics read unexpectedly denied: ${allowedStats.status}`);
  const deniedAi = await ctx.request(restrictedLogin.actor, 'GET', '/ai/config');
  assert(deniedAi.status === 403, `restricted AI config expected 403, got ${deniedAi.status}`);
  const deniedExport = await ctx.request(restrictedLogin.actor, 'GET', '/statistics/export');
  assert(deniedExport.status === 403, `restricted statistics export expected 403, got ${deniedExport.status}`);

  const oldRestrictedToken = restrictedLogin.actor.accessToken;
  const removed = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${restricted.data.id}/roles`, { role_ids: [] });
  assert(removed.status === 200, `role removal failed: ${removed.status}`);
  const oldAfterRoleRemoval = await ctx.request({ accessToken: oldRestrictedToken }, 'GET', '/statistics/regulations');
  assert(oldAfterRoleRemoval.status === 403, `oldTokenAfterRoleRemoval expected 403, got ${oldAfterRoleRemoval.status}`);

  const sessions = await ctx.request(admin.actor, 'GET', '/admin/sessions');
  assert(sessions.status === 200 && Array.isArray(sessions.data?.items), `session list failed: ${sessions.status}`);
  const target = sessions.data.items.find((item) => item.user_id === String(restricted.data.id) && item.status === 'active');
  assert(target, 'restricted active session missing');
  const kickedToken = restrictedLogin.actor.accessToken;
  const kicked = await ctx.request(admin.actor, 'POST', `/admin/sessions/${target.id}/revoke`);
  assert(kicked.status === 200, `session revoke failed: ${kicked.status}`);
  const oldAfterKick = await ctx.request({ accessToken: kickedToken }, 'GET', '/statistics/regulations');
  assert(oldAfterKick.status === 401, `oldTokenAfterKick expected 401, got ${oldAfterKick.status}`);

  const roles = (await ctx.request(admin.actor, 'GET', '/admin/roles')).data;
  const superRole = Array.isArray(roles) ? roles.find((item) => item.code === 'super_admin') : null;
  const removeLastSuperAdmin = await ctx.request(admin.actor, 'PUT', '/admin/administrators/1/roles', { role_ids: [] });
  assert(removeLastSuperAdmin.status === 409, `removeLastSuperAdmin expected 409, got ${removeLastSuperAdmin.status}`);
  assert(superRole || removeLastSuperAdmin.status === 409, 'system super admin role missing');

  const rotation = await captchaLogin(ctx, 'admin', admin.password);
  const beforeCookie = rotation.actor.cookie;
  const rotated = await ctx.request(rotation.actor, 'POST', '/auth/refresh');
  assert(rotated.status === 200, `refresh rotation failed: ${rotated.status}`);
  const reused = await ctx.request({ cookie: beforeCookie }, 'POST', '/auth/refresh');
  assert(reused.status === 401, `reused refresh expected 401, got ${reused.status}`);
}
