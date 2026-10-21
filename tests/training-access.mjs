import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');
const { JwtService } = require('@nestjs/jwt');
const fixtureJwt = new JwtService({});

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
  // The API intentionally limits source IP login attempts to ten/minute. The
  // fixture exercises many independent accounts in one run, so give each
  // attempt an RFC 5737 test source through the harness' trusted XFF hop.
  const sourceIp = `198.51.100.${(captchaLogin.sequence = (captchaLogin.sequence || 0) + 1)}`;
  const sourceHeaders = { 'X-Forwarded-For': sourceIp };
  const issued = await ctx.request(null, 'POST', '/auth/captcha', undefined, sourceHeaders);
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
    }, sourceHeaders);
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

async function seedScopedPublishedRegulation(ctx, createdBy) {
  const title = `A3 scope fixture ${randomBytes(4).toString('hex')}`;
  const inserted = await ctx.queryTestDb(
    'INSERT INTO regulation (title, category, status, current_version_id, required_minutes, scroll_segments, created_by) VALUES (?, ?, ?, NULL, 1, 10, ?)',
    [title, 'A3', 'published', String(createdBy)],
  );
  const regulationId = String(inserted.insertId);
  const version = await ctx.queryTestDb(
    'INSERT INTO regulation_version (regulation_id, version_no, file_path, file_type, file_hash, content_html, text_content, parse_status, parsed_at, retry_count, created_by) VALUES (?, 1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), 0, ?)',
    [regulationId, `a3-fixture-${regulationId}.docx`, 'docx', 'a'.repeat(64), '<p>A3 scope fixture</p>', 'A3 scope fixture', 'parsed', String(createdBy)],
  );
  await ctx.queryTestDb('UPDATE regulation SET current_version_id = ? WHERE id = ?', [String(version.insertId), regulationId]);
  await ctx.queryTestDb('INSERT INTO regulation_scope (regulation_id, department_id, is_all) VALUES (?, 1, 0)', [regulationId]);
  return regulationId;
}

function signLegacyNoSidAccessToken(ctx, user, authVersion) {
  return fixtureJwt.sign({
    sub: String(user.id), username: user.username, role: 'regulation_admin',
    auth_version: Number(authVersion), type: 'access', jti: randomBytes(16).toString('hex'),
  }, { secret: ctx.env.JWT_SECRET, expiresIn: '1h' });
}

export async function run(ctx) {
  const adminInitialLogin = await captchaLogin(ctx, 'admin', ctx.adminPassword);
  const adminPendingToken = adminInitialLogin.actor.accessToken;
  const admin = await completeFirstLogin(
    ctx,
    adminInitialLogin,
    'admin', ctx.adminPassword, 'Admin',
  );
  const pendingTokenAfterChange = await ctx.request({ accessToken: adminPendingToken }, 'GET', '/auth/profile');
  assert(pendingTokenAfterChange.status === 401, `pendingTokenAfterPasswordChange expected 401, got ${pendingTokenAfterChange.status}`);

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

  const employeeRoleCode = `employee_admin_${randomBytes(4).toString('hex')}`;
  const employeeRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: employeeRoleCode, name: '员工运营管理员', permissions: ['statistics:read', 'regulations:read', 'questions:read', 'ai:read'],
  });
  assert(employeeRole.status === 200 && employeeRole.data?.id, `employee admin role create failed: ${employeeRole.status}`);

  const rollbackRoleCode = `rollback_${randomBytes(4).toString('hex')}`;
  const rollbackRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: rollbackRoleCode, name: '应回滚角色', permissions: ['permission:not_registered'],
  });
  assert(rollbackRole.status === 400, `invalid role transaction expected 400, got ${rollbackRole.status}`);
  const rollbackRows = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM sys_role WHERE code = ?', [rollbackRoleCode]);
  assert(Number(rollbackRows[0]?.count || 0) === 0, 'invalid role transaction left a partial sys_role row');

  const employeeAssigned = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${employee.data.id}/roles`, { role_ids: [String(employeeRole.data.id)] });
  assert(employeeAssigned.status === 200, `employee role assignment failed: ${employeeAssigned.status}`);
  const employeeWithoutCaptcha = await ctx.request(null, 'POST', '/auth/login', {
    username: employee.data.username, password: employeePassword,
  });
  assert(employeeWithoutCaptcha.status === 400, `employeeAdminWithoutCaptcha expected 400, got ${employeeWithoutCaptcha.status}`);
  const employeeAdminLogin = await completeFirstLogin(
    ctx,
    await captchaLogin(ctx, employee.data.username, employeePassword),
    employee.data.username, employeePassword, 'EmployeeAdmin',
  );
  const employeeStats = await ctx.request(employeeAdminLogin.actor, 'GET', '/statistics/regulations');
  assert(employeeStats.status !== 403, `employee custom statistics permission denied: ${employeeStats.status}`);
  const employeeQuestions = await ctx.request(employeeAdminLogin.actor, 'GET', '/ai/questions');
  assert(employeeQuestions.status !== 403, `employee custom AI permission denied: ${employeeQuestions.status}`);
  const employeeStatsRows = await ctx.queryTestDb(
    'SELECT login_count, force_password_change, last_login_at, last_login_ip FROM sys_user WHERE id = ?',
    [String(employee.data.id)],
  );
  assert(Number(employeeStatsRows[0]?.login_count || 0) >= 3, 'successful password logins did not increment login_count');
  assert(Number(employeeStatsRows[0]?.force_password_change || 0) === 0, 'password change did not clear force_password_change');
  assert(employeeStatsRows[0]?.last_login_at && employeeStatsRows[0]?.last_login_ip, 'successful login stats missing timestamp or IP');

  const employeeTokenBeforeReset = employeeAdminLogin.actor.accessToken;
  const employeeResetPassword = randomStrongPassword(employee.data.username, '临时员工');
  const employeeBeforeResetRows = await ctx.queryTestDb('SELECT login_count FROM sys_user WHERE id = ?', [String(employee.data.id)]);
  const employeeReset = await ctx.request(admin.actor, 'PUT', `/users/${employee.data.id}/password`, { password: employeeResetPassword });
  assert(employeeReset.status === 200, `employee password reset failed: ${employeeReset.status}`);
  const employeeAfterResetRows = await ctx.queryTestDb(
    'SELECT login_count, force_password_change FROM sys_user WHERE id = ?',
    [String(employee.data.id)],
  );
  assert(Number(employeeAfterResetRows[0]?.login_count) === Number(employeeBeforeResetRows[0]?.login_count), 'password reset changed truthful login_count');
  assert(Number(employeeAfterResetRows[0]?.force_password_change || 0) === 1, 'password reset did not set force_password_change');
  const employeeOldToken = await ctx.request({ accessToken: employeeTokenBeforeReset }, 'GET', '/statistics/regulations');
  assert(employeeOldToken.status === 401, `employee token after reset expected 401, got ${employeeOldToken.status}`);

  const restrictedUsername = `restricted_${randomBytes(4).toString('hex')}`;
  const restrictedPassword = randomStrongPassword(restrictedUsername, '受限管理员');
  const restricted = await ctx.request(admin.actor, 'POST', '/users', {
    username: restrictedUsername, password: restrictedPassword,
    real_name: '受限管理员', role: 'regulation_admin',
  });
  assert(restricted.status === 200 && restricted.data?.id, `restricted fixture create failed: ${restricted.status}`);
  const assigned = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${restricted.data.id}/roles`, { role_ids: [role.data.id] });
  assert(assigned.status === 200, `restricted role assignment failed: ${assigned.status}`);
  const scopedRegulationId = await seedScopedPublishedRegulation(ctx, admin.result.data.user.id);

  const restrictedLogin = await completeFirstLogin(
    ctx,
    await captchaLogin(ctx, restricted.data.username, restrictedPassword),
    restricted.data.username, restrictedPassword, 'Restricted',
  );
  const legacyNoSidToken = signLegacyNoSidAccessToken(
    ctx,
    restricted.data,
    restrictedLogin.result.data.user.auth_version,
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
  assert(oldAfterRoleRemoval.status === 401, `oldTokenAfterRoleRemoval expected 401, got ${oldAfterRoleRemoval.status}`);
  const oldNoSidAfterRoleRemoval = await ctx.request({ accessToken: legacyNoSidToken }, 'GET', '/statistics/regulations');
  assert(oldNoSidAfterRoleRemoval.status === 401, `legacyNoSidAfterRoleRemoval expected 401, got ${oldNoSidAfterRoleRemoval.status}`);

  // Role writes invalidate the durable session as well as incrementing the
  // auth generation. Log in again to obtain a fresh, now-unprivileged session
  // before exercising the explicit session-revoke endpoint.
  const postRemovalLogin = await completeFirstLogin(
    ctx,
    await captchaLogin(ctx, restricted.data.username, restrictedLogin.password),
    restricted.data.username, restrictedLogin.password, 'RestrictedAfterRemoval',
  );
  const scopedContentAfterRoleRemoval = await ctx.request(postRemovalLogin.actor, 'GET', `/regulations/${scopedRegulationId}/content`);
  assert(scopedContentAfterRoleRemoval.status === 404 && scopedContentAfterRoleRemoval.code === 40402, `cleared role content scope expected hidden 40402, got ${scopedContentAfterRoleRemoval.status}/${scopedContentAfterRoleRemoval.code}`);

  const sessions = await ctx.request(admin.actor, 'GET', '/admin/sessions');
  assert(sessions.status === 200 && Array.isArray(sessions.data?.items), `session list failed: ${sessions.status}`);
  const target = sessions.data.items.find((item) => item.user_id === String(restricted.data.id) && item.status === 'active');
  assert(target, 'restricted active session missing');
  const kickedToken = postRemovalLogin.actor.accessToken;
  const kicked = await ctx.request(admin.actor, 'POST', `/admin/sessions/${target.id}/revoke`);
  assert(kicked.status === 200, `session revoke failed: ${kicked.status}`);
  const oldAfterKick = await ctx.request({ accessToken: kickedToken }, 'GET', '/statistics/regulations');
  assert(oldAfterKick.status === 401, `oldTokenAfterKick expected 401, got ${oldAfterKick.status}`);

  const roles = (await ctx.request(admin.actor, 'GET', '/admin/roles')).data;
  const superRole = Array.isArray(roles) ? roles.find((item) => item.code === 'super_admin') : null;
  const selfEscalation = await ctx.request(admin.actor, 'PUT', '/admin/administrators/1/roles', { role_ids: [String(superRole?.id || '')] });
  assert(selfEscalation.status === 400, `systemRoleSelfEscalation expected 400, got ${selfEscalation.status}`);
  const removeLastSuperAdmin = await ctx.request(admin.actor, 'PUT', '/admin/administrators/1/roles', { role_ids: [] });
  assert(removeLastSuperAdmin.status === 409, `removeLastSuperAdmin expected 409, got ${removeLastSuperAdmin.status}`);
  assert(superRole || removeLastSuperAdmin.status === 409, 'system super admin role missing');

  const rotation = await captchaLogin(ctx, 'admin', admin.password);
  const beforeCookie = rotation.actor.cookie;
  const rotated = await ctx.request(rotation.actor, 'POST', '/auth/refresh');
  assert(rotated.status === 200, `refresh rotation failed: ${rotated.status}`);
  const reused = await ctx.request({ cookie: beforeCookie }, 'POST', '/auth/refresh');
  assert(reused.status === 401, `reused refresh expected 401, got ${reused.status}`);

  const concurrent = await captchaLogin(ctx, 'admin', admin.password);
  const concurrentCookie = concurrent.actor.cookie;
  const [refreshA, refreshB] = await Promise.all([
    ctx.request({ cookie: concurrentCookie }, 'POST', '/auth/refresh'),
    ctx.request({ cookie: concurrentCookie }, 'POST', '/auth/refresh'),
  ]);
  const concurrentStatuses = [refreshA.status, refreshB.status].sort((a, b) => a - b);
  assert(concurrentStatuses[0] === 200 && concurrentStatuses[1] === 401, `simultaneous refresh expected one 200/one 401, got ${concurrentStatuses.join('/')}`);
}
