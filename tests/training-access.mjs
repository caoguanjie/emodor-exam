import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { startMockAi } from './e2e-smoke.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');
const mysql = require('mysql2/promise');
const { JwtService } = require('@nestjs/jwt');
const fixtureJwt = new JwtService({});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function randomStrongPassword(...personalValues) {
  const forbidden = personalValues
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => value.length >= 3)
    .flatMap((value) => Array.from(
      { length: value.length - 2 },
      (_, index) => value.slice(index, index + 3),
    ));
  while (true) {
    const password = `Q${randomBytes(16).toString('hex')}Z9`;
    if (!forbidden.some((value) => password.toLowerCase().includes(value))) return password;
  }
}

async function readCaptchaAnswer(ctx, captchaId) {
  const redis = new Redis({
    host: ctx.env.REDIS_HOST || '127.0.0.1',
    port: Number(ctx.env.REDIS_PORT || 6379),
    password: ctx.env.REDIS_PASSWORD || undefined,
    lazyConnect: false,
  });
  try {
    const prefix = ctx.env.REDIS_KEY_PREFIX || '';
    return await redis.get(`${prefix}auth:captcha:${captchaId}`);
  } finally {
    await redis.quit();
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
  const answer = await readCaptchaAnswer(ctx, issued.data.captcha_id);
  assert(answer, 'captcha fixture answer missing from run-owned Redis');
  const actor = {};
  const result = await ctx.request(actor, 'POST', '/auth/login', {
    username, password, captcha_id: issued.data.captcha_id, captcha_code: answer,
  }, sourceHeaders);
  assert(result.status === 200, `admin login failed: ${result.status}`);
  actor.accessToken = result.data.access_token;
  return { actor, result };
}

async function openTestDb(ctx) {
  return mysql.createConnection({
    host: ctx.env.DB_HOST || '127.0.0.1',
    port: Number(ctx.env.DB_PORT || 3306),
    user: ctx.env.DB_USERNAME || 'root',
    password: ctx.env.DB_PASSWORD || undefined,
    database: ctx.env.DB_DATABASE,
  });
}

async function holdRowLock(ctx, sql, params) {
  const connection = await openTestDb(ctx);
  await connection.beginTransaction();
  await connection.execute(sql, params);
  return connection;
}

async function waitForLockWaits(ctx, minimum, label) {
  const observer = await openTestDb(ctx);
  const started = Date.now();
  try {
    while (Date.now() - started < 8_000) {
      const [rows] = await observer.query(
        'SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits',
      );
      const count = Number(rows[0]?.count || 0);
      if (count >= minimum) return count;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    await observer.end();
  }
  throw new Error(`${label} did not reach ${minimum} owned lock waits`);
}

async function closeLock(connection, commit = false) {
  if (!connection) return;
  if (commit) await connection.commit();
  else await connection.rollback().catch(() => undefined);
  await connection.end();
}
async function completeFirstLogin(ctx, login, username, oldPassword, suffix) {
  if (!login.result.data?.force_change_password) return { ...login, password: oldPassword };
  // 不能把账号/姓名作为口令片段，避免触发业务层个人信息子串策略。
  const newPassword = randomStrongPassword(username);
  const changed = await ctx.request(login.actor, 'PUT', '/auth/password', {
    old_password: oldPassword, new_password: newPassword,
  });
  assert(changed.status === 200, `first login password change failed: ${changed.status}/${changed.code}/${JSON.stringify(changed.json || changed.data)}`);
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

function signEqualIatAccessToken(ctx, user, authVersion, iat, sid) {
  const payload = {
    sub: String(user.id), username: user.username, role: 'employee',
    auth_version: Number(authVersion), type: 'access', jti: randomBytes(16).toString('hex'), iat,
  };
  if (sid) payload.sid = sid;
  return fixtureJwt.sign(payload, { secret: ctx.env.JWT_SECRET, expiresIn: '1h' });
}

async function runBody(ctx, mockPort) {
  const refreshIp = '198.51.100.240';
  const refreshHeaders = { 'X-Forwarded-For': refreshIp };
  const previousCaptcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, refreshHeaders);
  assert(previousCaptcha.status === 200 && previousCaptcha.data?.captcha_id, `initial captcha issue failed: ${previousCaptcha.status}`);
  const previousAnswer = await readCaptchaAnswer(ctx, previousCaptcha.data.captcha_id);
  assert(previousAnswer, 'previous captcha fixture answer missing');
  const unrelatedCaptcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, refreshHeaders);
  assert(unrelatedCaptcha.status === 200 && unrelatedCaptcha.data?.captcha_id, `unrelated captcha issue failed: ${unrelatedCaptcha.status}`);
  const unrelatedAnswer = await readCaptchaAnswer(ctx, unrelatedCaptcha.data.captcha_id);
  assert(unrelatedAnswer, 'unrelated captcha fixture answer missing');
  const malformedRefresh = await ctx.request(null, 'POST', '/auth/captcha', { previous_captcha_id: 'not-a-captcha-id' }, refreshHeaders);
  assert(malformedRefresh.status === 400, `malformed captcha refresh expected 400, got ${malformedRefresh.status}`);
  for (const malformed of [
    [previousCaptcha.data.captcha_id],
    { toString: previousCaptcha.data.captcha_id },
    7,
    null,
  ]) {
    const malformedField = await ctx.request(null, 'POST', '/auth/captcha', { previous_captcha_id: malformed }, refreshHeaders);
    assert(malformedField.status === 400, `typed malformed captcha refresh expected 400, got ${malformedField.status}`);
  }
  const refreshedCaptcha = await ctx.request(null, 'POST', '/auth/captcha', {
    previous_captcha_id: previousCaptcha.data.captcha_id,
  }, refreshHeaders);
  assert(refreshedCaptcha.status === 200 && refreshedCaptcha.data?.captcha_id, `captcha refresh failed: ${refreshedCaptcha.status}`);
  const refreshedAnswer = await readCaptchaAnswer(ctx, refreshedCaptcha.data.captcha_id);
  assert(refreshedAnswer, 'refreshed captcha fixture answer missing');
  const oldCaptchaLogin = await ctx.request(null, 'POST', '/auth/login', {
    username: 'admin', password: ctx.adminPassword,
    captcha_id: previousCaptcha.data.captcha_id, captcha_code: previousAnswer,
  }, refreshHeaders);
  assert(oldCaptchaLogin.status === 400, `captcha refresh accepted previous challenge: ${oldCaptchaLogin.status}`);
  const unrelatedActor = {};
  const unrelatedLogin = await ctx.request(unrelatedActor, 'POST', '/auth/login', {
    username: 'admin', password: ctx.adminPassword,
    captcha_id: unrelatedCaptcha.data.captcha_id, captcha_code: unrelatedAnswer,
  }, refreshHeaders);
  assert(unrelatedLogin.status === 200, `same-IP unrelated captcha was invalidated: ${unrelatedLogin.status}`);
  unrelatedActor.accessToken = unrelatedLogin.data.access_token;
  const refreshedActor = {};
  const refreshedLogin = await ctx.request(refreshedActor, 'POST', '/auth/login', {
    username: 'admin', password: ctx.adminPassword,
    captcha_id: refreshedCaptcha.data.captcha_id, captcha_code: refreshedAnswer,
  }, refreshHeaders);
  assert(refreshedLogin.status === 200, `refreshed captcha did not work: ${refreshedLogin.status}`);
  refreshedActor.accessToken = refreshedLogin.data.access_token;
  const adminInitialLogin = { actor: refreshedActor, result: refreshedLogin };
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
  const loginCountBeforeSessionFailure = await ctx.queryTestDb(
    'SELECT login_count FROM sys_user WHERE id = ?',
    [String(employee.data.id)],
  );
  // The harness query helper intentionally uses prepared statements, so use
  // an owned table rename rather than a trigger to force session persistence
  // failure. The table is restored immediately after the one request.
  await ctx.queryTestDb('RENAME TABLE auth_session TO auth_session_a3_failure');
  let failedSessionLogin;
  try {
    failedSessionLogin = await ctx.request(null, 'POST', '/auth/login', {
      username: employee.data.username, password: employeePassword,
    });
  } finally {
    await ctx.queryTestDb('RENAME TABLE auth_session_a3_failure TO auth_session');
  }
  assert(failedSessionLogin.status >= 500, `session creation failure expected server error, got ${failedSessionLogin.status}`);
  const loginCountAfterSessionFailure = await ctx.queryTestDb(
    'SELECT login_count FROM sys_user WHERE id = ?',
    [String(employee.data.id)],
  );
  assert(
    Number(loginCountAfterSessionFailure[0]?.login_count || 0) === Number(loginCountBeforeSessionFailure[0]?.login_count || 0),
    'failed session creation committed a successful-login count',
  );
  const employeeLogin = await ctx.request(null, 'POST', '/auth/login', {
    username: employee.data.username, password: employeePassword,
  });
  assert(employeeLogin.status === 200, `employeeLegacyLogin expected 200, got ${employeeLogin.status}`);
  const employeeSessionDb = await ctx.queryTestDb(
    'SELECT sid, created_at, updated_at, last_seen_at FROM auth_session WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    [String(employee.data.id)],
  );
  const employeeSessionList = await ctx.request(admin.actor, 'GET', '/admin/sessions');
  const employeeSessionApi = employeeSessionList.data?.items?.find((item) => item.sid === employeeSessionDb[0]?.sid);
  const dbCreated = new Date(employeeSessionDb[0]?.created_at).getTime();
  const dbUpdated = new Date(employeeSessionDb[0]?.updated_at).getTime();
  const dbLastSeen = new Date(employeeSessionDb[0]?.last_seen_at).getTime();
  const apiCreated = new Date(employeeSessionApi?.created_at).getTime();
  const apiLastSeen = new Date(employeeSessionApi?.last_seen_at).getTime();
  assert(
    employeeSessionList.status === 200 && employeeSessionApi
      && [dbCreated, dbUpdated, dbLastSeen, apiCreated, apiLastSeen].every(Number.isFinite)
      && Math.abs(dbCreated - dbLastSeen) <= 10
      && Math.abs(dbUpdated - dbLastSeen) <= 10
      && Math.abs(apiCreated - apiLastSeen) <= 10,
    `new session timestamps diverged: db=${dbCreated}/${dbUpdated}/${dbLastSeen} api=${apiCreated}/${apiLastSeen}`,
  );

  const adminReadRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `admin_read_${randomBytes(4).toString('hex')}`,
    name: '管理员只读', permissions: ['administrators:read'],
  });
  assert(adminReadRole.status === 200 && adminReadRole.data?.id, `administrator read role create failed: ${adminReadRole.status}`);
  const adminWriteRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `admin_write_${randomBytes(4).toString('hex')}`,
    name: '管理员分配', permissions: ['administrators:read', 'administrators:write'],
  });
  assert(adminWriteRole.status === 200 && adminWriteRole.data?.id, `administrator write role create failed: ${adminWriteRole.status}`);
  const firstAssignmentRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `first_assignment_${randomBytes(4).toString('hex')}`,
    name: '首次分配验证角色', permissions: ['statistics:read'],
  });
  assert(firstAssignmentRole.status === 200 && firstAssignmentRole.data?.id, `first assignment role create failed: ${firstAssignmentRole.status}`);

  const ordinaryUsername = `ordinary_${randomBytes(4).toString('hex')}`;
  const ordinaryPassword = randomStrongPassword(ordinaryUsername);
  const ordinary = await ctx.request(admin.actor, 'POST', '/users', {
    username: ordinaryUsername, password: ordinaryPassword, real_name: '普通树读取者', role: 'employee',
  });
  assert(ordinary.status === 200 && ordinary.data?.id, `ordinary tree fixture create failed: ${ordinary.status}`);
  const ordinaryLogin = await completeFirstLogin(
    ctx,
    await captchaLogin(ctx, ordinaryUsername, ordinaryPassword),
    ordinaryUsername, ordinaryPassword, 'OrdinaryTreeReader',
  );
  const ordinaryTree = await ctx.request(ordinaryLogin.actor, 'GET', '/departments/tree');
  assert(ordinaryTree.status === 200 && Array.isArray(ordinaryTree.data?.list), `ordinary department tree read failed: ${ordinaryTree.status}`);

  const readUsername = `admin_read_${randomBytes(4).toString('hex')}`;
  const readPassword = randomStrongPassword(readUsername);
  const readUser = await ctx.request(admin.actor, 'POST', '/users', {
    username: readUsername, password: readPassword, real_name: '管理员只读账号', role: 'employee',
  });
  assert(readUser.status === 200 && readUser.data?.id, `administrator read fixture create failed: ${readUser.status}`);
  const readAssigned = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${readUser.data.id}/roles`, {
    role_ids: [String(adminReadRole.data.id)],
  });
  assert(readAssigned.status === 200, `administrator read fixture assignment failed: ${readAssigned.status}`);
  const readLogin = await completeFirstLogin(
    ctx,
    await captchaLogin(ctx, readUsername, readPassword),
    readUsername, readPassword, 'AdministratorReadOnly',
  );
  const readAdministrators = await ctx.request(readLogin.actor, 'GET', '/admin/administrators');
  assert(readAdministrators.status === 200 && Array.isArray(readAdministrators.data), `administrator read listing failed: ${readAdministrators.status}`);
  const readCandidatesDenied = await ctx.request(readLogin.actor, 'GET', '/admin/administrators/candidates');
  assert(readCandidatesDenied.status === 403, `administrator read candidate lookup unexpectedly allowed: ${readCandidatesDenied.status}`);
  const readOptionsDenied = await ctx.request(readLogin.actor, 'GET', '/admin/administrators/assignable-roles');
  assert(readOptionsDenied.status === 403, `administrator read role options unexpectedly allowed: ${readOptionsDenied.status}`);
  const readTree = await ctx.request(readLogin.actor, 'GET', '/departments/tree');
  assert(readTree.status === 200 && Array.isArray(readTree.data?.list), `delegated department tree read failed: ${readTree.status}`);
  const departmentWrites = [
    ['POST', '/departments', { parent_id: null, name: `forbidden_${randomBytes(4).toString('hex')}` }],
    ['PUT', '/departments/1', { name: '不得修改根部门' }],
    ['PUT', '/departments/1/parent', { parent_id: null }],
    ['PUT', '/departments/1/status', { status: 0 }],
    ['DELETE', '/departments/1', undefined],
  ];
  for (const [method, path, body] of departmentWrites) {
    const denied = await ctx.request(readLogin.actor, method, path, body);
    assert(denied.status === 403, `delegated department write unexpectedly allowed: ${method} ${path} ${denied.status}`);
  }

  const writeUsername = `admin_write_${randomBytes(4).toString('hex')}`;
  const writePassword = randomStrongPassword(writeUsername);
  const writeUser = await ctx.request(admin.actor, 'POST', '/users', {
    username: writeUsername, password: writePassword, real_name: '管理员分配账号', role: 'employee',
  });
  assert(writeUser.status === 200 && writeUser.data?.id, `administrator write fixture create failed: ${writeUser.status}`);
  const writeAssigned = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${writeUser.data.id}/roles`, {
    role_ids: [String(adminWriteRole.data.id)],
  });
  assert(writeAssigned.status === 200, `administrator write fixture assignment failed: ${writeAssigned.status}`);
  const writeLogin = await completeFirstLogin(
    ctx,
    await captchaLogin(ctx, writeUsername, writePassword),
    writeUsername, writePassword, 'AdministratorWriteOnly',
  );
  const generalRolesDenied = await ctx.request(writeLogin.actor, 'GET', '/admin/roles');
  assert(generalRolesDenied.status === 403, `administrator write role unexpectedly has roles:read: ${generalRolesDenied.status}`);
  const writeAdministrators = await ctx.request(writeLogin.actor, 'GET', '/admin/administrators');
  assert(writeAdministrators.status === 200 && Array.isArray(writeAdministrators.data), `administrator write listing failed: ${writeAdministrators.status}`);
  const candidatePage = await ctx.request(
    writeLogin.actor, 'GET', `/admin/administrators/candidates?page=1&page_size=100&keyword=${encodeURIComponent(ordinaryUsername)}`,
  );
  assert(
    candidatePage.status === 200 && candidatePage.data?.page === 1 && candidatePage.data?.page_size === 100
      && Array.isArray(candidatePage.data?.items) && candidatePage.data.total >= 1,
    `administrator write candidate page failed: ${candidatePage.status}`,
  );
  for (const candidate of candidatePage.data.items) {
    assert(
      Object.keys(candidate).sort().join(',') === 'id,real_name,status,system_role,username'
        && candidate.system_role !== 'super_admin'
        && candidate.id !== '1',
      `candidate leaked unsafe fields or highest identity: ${JSON.stringify(candidate)}`,
    );
  }
  const allCandidates = await ctx.request(writeLogin.actor, 'GET', '/admin/administrators/candidates?page=1&page_size=100');
  assert(allCandidates.status === 200 && allCandidates.data?.items?.every((candidate) => candidate.id !== '1' && candidate.system_role !== 'super_admin'), `super admin appeared in candidate set: ${allCandidates.status}`);
  const malformedCandidate = await ctx.request(writeLogin.actor, 'GET', '/admin/administrators/candidates?page=not-a-number');
  assert(malformedCandidate.status === 400, `malformed candidate page was accepted: ${malformedCandidate.status}`);
  const unknownCandidateField = await ctx.request(writeLogin.actor, 'GET', '/admin/administrators/candidates?unexpected=1');
  assert(unknownCandidateField.status === 400, `unknown candidate query field was accepted: ${unknownCandidateField.status}`);

  const assignableOptions = await ctx.request(writeLogin.actor, 'GET', '/admin/administrators/assignable-roles');
  assert(assignableOptions.status === 200 && Array.isArray(assignableOptions.data) && assignableOptions.data.length > 0, `administrator write role options failed: ${assignableOptions.status}`);
  for (const option of assignableOptions.data) {
    assert(
      Object.keys(option).sort().join(',') === 'code,id,is_system,name,status'
        && option.is_system === false && option.status === 1
        && !Object.hasOwn(option, 'permissions'),
      `role options leaked unsafe fields or disabled/system role: ${JSON.stringify(option)}`,
    );
  }
  const firstAssignment = await ctx.request(writeLogin.actor, 'PUT', `/admin/administrators/${ordinary.data.id}/roles`, {
    role_ids: [String(firstAssignmentRole.data.id)],
  });
  assert(firstAssignment.status === 200, `first business-role assignment failed: ${firstAssignment.status}`);
  const assignedAdministrators = await ctx.request(writeLogin.actor, 'GET', '/admin/administrators');
  const assignedOrdinary = assignedAdministrators.data?.find((item) => item.id === String(ordinary.data.id));
  assert(assignedAdministrators.status === 200 && assignedOrdinary?.role_ids?.includes(String(firstAssignmentRole.data.id)), 'first assignment was not reflected in administrator listing');

  const roleCode = `limited_${randomBytes(4).toString('hex')}`;
  const role = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: roleCode, name: '只读统计', permissions: ['statistics:read'],
  });
  assert(role.status === 200 && role.data?.id, `limited role create failed: ${role.status}`);

  const employeeRoleCode = `employee_admin_${randomBytes(4).toString('hex')}`;
  const employeeRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: employeeRoleCode, name: '员工运营管理员', permissions: [
      'statistics:read', 'regulations:read', 'regulations:write',
      'questions:read', 'questions:write', 'ai:read', 'ai:write',
      'papers:read', 'papers:write',
      'training_categories:read', 'training_categories:write', 'students:read', 'students:write',
    ],
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
  const preGrantEmployeeSession = await ctx.request({ accessToken: employeeLogin.data.access_token }, 'GET', '/statistics/regulations');
  assert(preGrantEmployeeSession.status === 401, `employee session before role grant remained valid: ${preGrantEmployeeSession.status}`);
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
  const scopedRegulationId = await seedScopedPublishedRegulation(ctx, admin.result.data.user.id);
  const employeePreview = await ctx.request(
    employeeAdminLogin.actor,
    'GET',
    `/regulations/${scopedRegulationId}/preview`,
  );
  assert(employeePreview.status === 200, `employee custom regulation preview denied: ${employeePreview.status}`);
  const employeeOtherUserStats = await ctx.request(employeeAdminLogin.actor, 'GET', '/statistics/users/1');
  assert(employeeOtherUserStats.status === 200, `employee custom other-user statistics denied: ${employeeOtherUserStats.status}`);
  const secondEmployeeSession = await captchaLogin(ctx, employee.data.username, employeeAdminLogin.password);
  const legacyEmployeeToken = signLegacyNoSidAccessToken(
    ctx,
    employee.data,
    employeeAdminLogin.result.data.user.auth_version,
  );
  const rotatedEmployeePassword = randomStrongPassword(employee.data.username, '临时员工');
  const employeePasswordChange = await ctx.request(employeeAdminLogin.actor, 'PUT', '/auth/password', {
    old_password: employeeAdminLogin.password, new_password: rotatedEmployeePassword,
  });
  assert(employeePasswordChange.status === 200, `employee password rotation failed: ${employeePasswordChange.status}/${employeePasswordChange.code}/${JSON.stringify(employeePasswordChange.json || employeePasswordChange.data)}`);
  employeeAdminLogin.actor.accessToken = employeePasswordChange.data.access_token;
  employeeAdminLogin.password = rotatedEmployeePassword;
  const secondSessionAfterPasswordChange = await ctx.request(secondEmployeeSession.actor, 'GET', '/statistics/regulations');
  assert(secondSessionAfterPasswordChange.status === 401, `same-second second sid survived password change: ${secondSessionAfterPasswordChange.status}`);
  const legacyAfterPasswordChange = await ctx.request({ accessToken: legacyEmployeeToken }, 'GET', '/statistics/regulations');
  assert(legacyAfterPasswordChange.status === 401, `legacy no-sid token survived password change: ${legacyAfterPasswordChange.status}`);
  const raceUsername = `race_employee_${randomBytes(4).toString('hex')}`;
  const racePassword = randomStrongPassword(raceUsername, '并发员工');
  const raceEmployee = await ctx.request(admin.actor, 'POST', '/users', {
    username: raceUsername, password: racePassword, real_name: '并发员工', role: 'employee',
  });
  assert(raceEmployee.status === 200 && raceEmployee.data?.id, `concurrent login fixture create failed: ${raceEmployee.status}/${raceEmployee.code}/${raceEmployee.message}`);
  const raceInitialActor = {};
  const raceInitial = await ctx.request(raceInitialActor, 'POST', '/auth/login', {
    username: raceUsername, password: racePassword,
  });
  assert(raceInitial.status === 200, `concurrent login fixture initial login failed: ${raceInitial.status}`);
  raceInitialActor.accessToken = raceInitial.data.access_token;
  const raceReady = await completeFirstLogin(
    ctx, { actor: raceInitialActor, result: raceInitial }, raceUsername, racePassword, 'RaceEmployee',
  );
  const warmedRaceProfile = await ctx.request(raceReady.actor, 'GET', '/auth/profile');
  assert(warmedRaceProfile.status === 200, `race permission cache warmup failed: ${warmedRaceProfile.status}`);
  const raceBlocker = await holdRowLock(ctx, 'SELECT id FROM sys_user WHERE id = ? FOR UPDATE', [String(raceEmployee.data.id)]);
  let raceReleased = false;
  try {
    const raceAssignmentPromise = ctx.request(admin.actor, 'PUT', `/admin/administrators/${raceEmployee.data.id}/roles`, {
      role_ids: [String(role.data.id)],
    });
    await waitForLockWaits(ctx, 1, 'login/grant assignment');
    const raceLoginPromise = ctx.request(null, 'POST', '/auth/login', {
      username: raceUsername, password: raceReady.password,
    });
    await waitForLockWaits(ctx, 2, 'login/grant classification');
    await closeLock(raceBlocker, true);
    raceReleased = true;
    const [raceAssignment, raceLogin] = await Promise.all([raceAssignmentPromise, raceLoginPromise]);
    assert(raceAssignment.status === 200, `deterministic role assignment failed: ${raceAssignment.status}`);
    assert(raceLogin.status === 400, `deterministic post-grant login should require captcha, got ${raceLogin.status}`);
  } finally {
    if (!raceReleased) await closeLock(raceBlocker);
  }

  const roleBarrierLogin = await captchaLogin(ctx, employee.data.username, employeeAdminLogin.password);
  const roleVersionBefore = await ctx.queryTestDb(
    'SELECT auth_version FROM sys_user WHERE id = ?', [String(employee.data.id)],
  );
  const roleBlocker = await holdRowLock(ctx, 'SELECT id FROM sys_role WHERE id = ? FOR UPDATE', [String(employeeRole.data.id)]);
  let roleReleased = false;
  try {
    const roleUpdatePromise = ctx.request(admin.actor, 'PUT', `/admin/roles/${employeeRole.data.id}`, {
      name: `员工运营管理员 barrier ${randomBytes(3).toString('hex')}`,
      permissions: employeeRole.data.permissions,
    });
    await waitForLockWaits(ctx, 1, 'role update');
    const roleAssignmentPromise = ctx.request(admin.actor, 'PUT', `/admin/administrators/${employee.data.id}/roles`, {
      role_ids: [String(employeeRole.data.id)],
    });
    await waitForLockWaits(ctx, 2, 'role update/assignment');
    await closeLock(roleBlocker, true);
    roleReleased = true;
    const [roleUpdate, roleAssignment] = await Promise.all([roleUpdatePromise, roleAssignmentPromise]);
    assert(roleUpdate.status === 200 && roleAssignment.status === 200, `role update/assignment barrier failed: ${roleUpdate.status}/${roleAssignment.status}`);
  } finally {
    if (!roleReleased) await closeLock(roleBlocker);
  }
  const roleVersionAfter = await ctx.queryTestDb(
    'SELECT auth_version FROM sys_user WHERE id = ?', [String(employee.data.id)],
  );
  assert(
    Number(roleVersionAfter[0]?.auth_version || 0) >= Number(roleVersionBefore[0]?.auth_version || 0) + 2,
    'role update/assignment barrier collapsed security-generation increments',
  );
  const oldRoleBarrierToken = await ctx.request({ accessToken: roleBarrierLogin.actor.accessToken }, 'GET', '/auth/profile');
  assert(oldRoleBarrierToken.status === 401, `role update/assignment left an old session active: ${oldRoleBarrierToken.status}`);

  const passwordRaceUsername = `password_race_${randomBytes(4).toString('hex')}`;
  const passwordRacePassword = randomStrongPassword(passwordRaceUsername, '并发改密');
  const passwordRaceUser = await ctx.request(admin.actor, 'POST', '/users', {
    username: passwordRaceUsername, password: passwordRacePassword, real_name: '并发改密', role: 'employee',
  });
  assert(passwordRaceUser.status === 200 && passwordRaceUser.data?.id, `password race fixture create failed: ${passwordRaceUser.status}`);
  const passwordRaceLogin = await completeFirstLogin(
    ctx,
    await (async () => {
      const actor = {};
      const result = await ctx.request(actor, 'POST', '/auth/login', { username: passwordRaceUsername, password: passwordRacePassword });
      assert(result.status === 200, `password race initial login failed: ${result.status}`);
      actor.accessToken = result.data.access_token;
      return { actor, result };
    })(),
    passwordRaceUsername, passwordRacePassword, 'PasswordRace',
  );
  const passwordRaceVersionBefore = await ctx.queryTestDb(
    'SELECT auth_version FROM sys_user WHERE id = ?', [String(passwordRaceUser.data.id)],
  );
  const passwordRaceResetPassword = randomStrongPassword(passwordRaceUsername, '重置后');
  const passwordRaceBlocker = await holdRowLock(ctx, 'SELECT id FROM sys_user WHERE id = ? FOR UPDATE', [String(passwordRaceUser.data.id)]);
  let passwordRaceReleased = false;
  let resetPromise;
  try {
    resetPromise = ctx.request(admin.actor, 'PUT', `/users/${passwordRaceUser.data.id}/password`, { password: passwordRaceResetPassword });
    try {
      await waitForLockWaits(ctx, 1, 'password reset');
    } catch (error) {
      const earlyReset = await resetPromise;
      throw new Error(`${error.message}; reset=${earlyReset.status}/${earlyReset.code}/${earlyReset.message}`);
    }
    const changePromise = ctx.request(passwordRaceLogin.actor, 'PUT', '/auth/password', {
      old_password: passwordRaceLogin.password, new_password: randomStrongPassword(passwordRaceUsername, '并发改密后'),
    });
    await waitForLockWaits(ctx, 2, 'password reset/change');
    await closeLock(passwordRaceBlocker, true);
    passwordRaceReleased = true;
    const [resetResult, changeResult] = await Promise.all([resetPromise, changePromise]);
    assert(resetResult.status === 200, `deterministic password reset failed: ${resetResult.status}`);
    assert(changeResult.status !== 200, `old-password change raced through reset: ${changeResult.status}`);
  } finally {
    if (!passwordRaceReleased) await closeLock(passwordRaceBlocker);
  }
  const passwordRaceVersionAfter = await ctx.queryTestDb(
    'SELECT auth_version FROM sys_user WHERE id = ?', [String(passwordRaceUser.data.id)],
  );
  assert(
    Number(passwordRaceVersionAfter[0]?.auth_version || 0) === Number(passwordRaceVersionBefore[0]?.auth_version || 0) + 1,
    'password reset/change race produced more than one generation increment',
  );
  const passwordRaceSessions = await ctx.queryTestDb(
    'SELECT COUNT(*) AS count FROM auth_session WHERE user_id = ? AND revoked_at IS NULL', [String(passwordRaceUser.data.id)],
  );
  assert(Number(passwordRaceSessions[0]?.count || 0) === 0, 'old-password race created a current session after reset');

  const equalIatUsername = `equal_iat_${randomBytes(4).toString('hex')}`;
  const equalIatPassword = randomStrongPassword(equalIatUsername, '同秒令牌');
  const equalIatUser = await ctx.request(admin.actor, 'POST', '/users', {
    username: equalIatUsername, password: equalIatPassword, real_name: '同秒令牌', role: 'employee',
  });
  assert(equalIatUser.status === 200 && equalIatUser.data?.id, `equal-iat fixture create failed: ${equalIatUser.status}`);
  const equalIatInitial = await ctx.request(null, 'POST', '/auth/login', {
    username: equalIatUsername, password: equalIatPassword,
  });
  assert(equalIatInitial.status === 200, `equal-iat initial login failed: ${equalIatInitial.status}`);
  const equalIatReady = await completeFirstLogin(
    ctx,
    { actor: { accessToken: equalIatInitial.data.access_token }, result: equalIatInitial },
    equalIatUsername, equalIatPassword, 'EqualIat',
  );
  const equalIatA = await captchaLogin(ctx, equalIatUsername, equalIatReady.password);
  const equalIatB = await captchaLogin(ctx, equalIatUsername, equalIatReady.password);
  const equalIatSessions = await ctx.queryTestDb(
    'SELECT sid FROM auth_session WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 2',
    [String(equalIatUser.data.id)],
  );
  assert(equalIatSessions.length === 2, 'equal-iat fixture did not retain two owned session IDs');
  const equalIatVersionRows = await ctx.queryTestDb(
    'SELECT auth_version FROM sys_user WHERE id = ?', [String(equalIatUser.data.id)],
  );
  const equalIat = Math.floor(Date.now() / 1000) - 5;
  const equalIatSidTokenA = signEqualIatAccessToken(ctx, equalIatUser.data, equalIatVersionRows[0].auth_version, equalIat, equalIatSessions[0].sid);
  const equalIatSidTokenB = signEqualIatAccessToken(ctx, equalIatUser.data, equalIatVersionRows[0].auth_version, equalIat, equalIatSessions[1].sid);
  const equalIatNoSidToken = signEqualIatAccessToken(ctx, equalIatUser.data, equalIatVersionRows[0].auth_version, equalIat);
  assert(fixtureJwt.verify(equalIatSidTokenA, { secret: ctx.env.JWT_SECRET }).iat === equalIat, 'equal-iat sid A fixture drifted');
  assert(fixtureJwt.verify(equalIatSidTokenB, { secret: ctx.env.JWT_SECRET }).iat === equalIat, 'equal-iat sid B fixture drifted');
  assert(fixtureJwt.verify(equalIatNoSidToken, { secret: ctx.env.JWT_SECRET }).iat === equalIat, 'equal-iat no-sid fixture drifted');
  const equalIatReset = await ctx.request(admin.actor, 'PUT', `/users/${equalIatUser.data.id}/password`, {
    password: randomStrongPassword(equalIatUsername, '重置同秒'),
  });
  assert(equalIatReset.status === 200, `equal-iat reset failed: ${equalIatReset.status}`);
  for (const token of [equalIatSidTokenA, equalIatSidTokenB, equalIatNoSidToken]) {
    const rejected = await ctx.request({ accessToken: token }, 'GET', '/auth/profile');
    assert(rejected.status === 401, `equal-iat token survived user invalidation: ${rejected.status}`);
  }
  const refreshedEmployeeAdmin = await captchaLogin(ctx, employee.data.username, employeeAdminLogin.password);
  employeeAdminLogin.actor = refreshedEmployeeAdmin.actor;
  const delegatedRegulation = await ctx.request(employeeAdminLogin.actor, 'POST', '/regulations', {
    title: `A3 delegated regulation ${randomBytes(4).toString('hex')}`,
    category: 'A3', description: 'delegated write fixture',
  });
  assert(delegatedRegulation.status === 200 && delegatedRegulation.data?.id, `employee custom regulation write denied: ${delegatedRegulation.status}`);
  const delegatedQuestion = await ctx.request(employeeAdminLogin.actor, 'POST', '/ai/questions', {
    regulation_id: scopedRegulationId,
    type: 'single', stem: 'A3 delegated question',
    options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }],
    answer: [0], score: 10,
  });
  assert(delegatedQuestion.status === 200 && delegatedQuestion.data?.id, `employee custom question write denied: ${delegatedQuestion.status}`);
  const delegatedPaper = await ctx.request(employeeAdminLogin.actor, 'POST', '/ai/papers', {
    regulation_id: scopedRegulationId, title: 'A3 delegated paper', pass_score: 60,
  });
  assert(delegatedPaper.status === 200 && delegatedPaper.data?.id, `employee custom paper write denied: ${delegatedPaper.status}`);
  const ownedAiConfig = await ctx.request(admin.actor, 'PUT', '/ai/config', {
    base_url: `http://127.0.0.1:${mockPort}/v1`,
    api_key: `run_${randomBytes(16).toString('hex')}`,
    model: 'mock-model',
  });
  assert(
    ownedAiConfig.status === 200 && ownedAiConfig.data?.configured === true && ownedAiConfig.data?.api_key_masked,
    `run-owned AI config setup failed: ${ownedAiConfig.status}/${ownedAiConfig.code}`,
  );
  const delegatedGeneration = await ctx.request(employeeAdminLogin.actor, 'POST', '/ai/generate-questions', {
    regulation_id: scopedRegulationId, question_count_single: 1, question_count_multiple: 0,
    score_single: 100, score_multiple: 1,
  });
  assert(
    delegatedGeneration.status === 200 && delegatedGeneration.data?.task_id,
    `employee custom AI generation was not accepted: ${delegatedGeneration.status}/${delegatedGeneration.code}`,
  );
  let delegatedTask;
  for (let attempt = 0; attempt < 40; attempt++) {
    delegatedTask = await ctx.request(employeeAdminLogin.actor, 'GET', `/ai/generate-status/${delegatedGeneration.data.task_id}`);
    assert(delegatedTask.status === 200 && delegatedTask.data?.task_id, `employee custom AI task status failed: ${delegatedTask.status}/${delegatedTask.code}`);
    if (delegatedTask.data.status === 'completed' || delegatedTask.data.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(delegatedTask?.data?.status === 'completed', `employee custom AI task did not complete: ${delegatedTask?.data?.status}`);
  const taskOnlyConfigRead = await ctx.request(employeeAdminLogin.actor, 'GET', '/ai/config');
  assert(taskOnlyConfigRead.status === 403, `AI-task-only role read config unexpectedly allowed: ${taskOnlyConfigRead.status}`);
  const taskOnlyConfigWrite = await ctx.request(employeeAdminLogin.actor, 'PUT', '/ai/config', {
    base_url: 'http://127.0.0.1:9/v1', api_key: `task_only_${randomBytes(8).toString('hex')}`, model: 'task-only',
  });
  assert(taskOnlyConfigWrite.status === 403, `AI-task-only role write config unexpectedly allowed: ${taskOnlyConfigWrite.status}`);
  const taskOnlyConfigTest = await ctx.request(employeeAdminLogin.actor, 'POST', '/ai/config/test');
  assert(taskOnlyConfigTest.status === 403, `AI-task-only role test config unexpectedly allowed: ${taskOnlyConfigTest.status}`);

  const configWriterRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `ai_config_writer_${randomBytes(4).toString('hex')}`,
    name: 'AI 配置写入者', permissions: ['ai_config:write'],
  });
  assert(configWriterRole.status === 200 && configWriterRole.data?.id, `AI config writer role create failed: ${configWriterRole.status}`);
  const configReaderRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: `ai_config_reader_${randomBytes(4).toString('hex')}`,
    name: 'AI 配置读取者', permissions: ['ai_config:read'],
  });
  assert(configReaderRole.status === 200 && configReaderRole.data?.id, `AI config reader role create failed: ${configReaderRole.status}`);

  const configWriterAssigned = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${employee.data.id}/roles`, {
    role_ids: [String(configWriterRole.data.id)],
  });
  assert(configWriterAssigned.status === 200, `AI config writer assignment failed: ${configWriterAssigned.status}`);
  const configWriterLogin = await completeFirstLogin(
    ctx,
    await captchaLogin(ctx, employee.data.username, employeeAdminLogin.password),
    employee.data.username, employeeAdminLogin.password, 'AiConfigWriter',
  );
  const configWriterRead = await ctx.request(configWriterLogin.actor, 'GET', '/ai/config');
  assert(configWriterRead.status === 403, `AI config writer read unexpectedly allowed: ${configWriterRead.status}`);
  const ownedConfigKey = `run_${randomBytes(16).toString('hex')}`;
  const ownedConfigWrite = await ctx.request(configWriterLogin.actor, 'PUT', '/ai/config', {
    base_url: 'http://127.0.0.1:9/v1', api_key: ownedConfigKey, model: 'run-owned-config',
  });
  assert(ownedConfigWrite.status === 200 && ownedConfigWrite.data?.api_key_masked, `AI config writer write failed: ${ownedConfigWrite.status}`);

  const configReaderAssigned = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${employee.data.id}/roles`, {
    role_ids: [String(configReaderRole.data.id)],
  });
  assert(configReaderAssigned.status === 200, `AI config reader assignment failed: ${configReaderAssigned.status}`);
  const configReaderLogin = await completeFirstLogin(
    ctx,
    await captchaLogin(ctx, employee.data.username, configWriterLogin.password),
    employee.data.username, configWriterLogin.password, 'AiConfigReader',
  );
  const configReaderGet = await ctx.request(configReaderLogin.actor, 'GET', '/ai/config');
  assert(configReaderGet.status === 200 && configReaderGet.data?.api_key_masked && !('api_key' in (configReaderGet.data || {})), `AI config reader masked read failed: ${configReaderGet.status}`);
  const configReaderPut = await ctx.request(configReaderLogin.actor, 'PUT', '/ai/config', {
    base_url: 'http://127.0.0.1:9/v1', api_key: `reader_${randomBytes(8).toString('hex')}`, model: 'reader-denied',
  });
  assert(configReaderPut.status === 403, `AI config reader write unexpectedly allowed: ${configReaderPut.status}`);
  const configReaderTest = await ctx.request(configReaderLogin.actor, 'POST', '/ai/config/test');
  assert(configReaderTest.status === 403, `AI config reader test unexpectedly allowed: ${configReaderTest.status}`);
  const restoredEmployee = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${employee.data.id}/roles`, {
    role_ids: [String(employeeRole.data.id)],
  });
  assert(restoredEmployee.status === 200, `employee AI config fixture role restore failed: ${restoredEmployee.status}`);
  const restoredEmployeeLogin = await captchaLogin(ctx, employee.data.username, configReaderLogin.password);
  employeeAdminLogin.actor = restoredEmployeeLogin.actor;
  employeeAdminLogin.password = configReaderLogin.password;
  const employeeStatsRows = await ctx.queryTestDb(
    'SELECT login_count, force_password_change, last_login_at, last_login_ip FROM sys_user WHERE id = ?',
    [String(employee.data.id)],
  );

  const categoryName = `培训类别_${randomBytes(4).toString('hex')}`;
  const createdCategory = await ctx.request(employeeAdminLogin.actor, 'POST', '/admin/training-categories', {
    name: categoryName, description: 'delegated training category',
  });
  assert(createdCategory.status === 200 && createdCategory.data?.id, `delegated category write denied: ${createdCategory.status}`);
  const categoryList = await ctx.request(employeeAdminLogin.actor, 'GET', '/admin/training-categories');
  assert(categoryList.status === 200 && categoryList.data?.items?.some((item) => item.id === createdCategory.data.id), `delegated category read denied: ${categoryList.status}`);

  const studentUsername = `training_student_${randomBytes(4).toString('hex')}`;
  const studentPassword = randomStrongPassword(studentUsername, '培训学员');
  const createdStudent = await ctx.request(employeeAdminLogin.actor, 'POST', '/admin/students', {
    username: studentUsername, password: studentPassword, real_name: '培训学员',
    category_id: String(createdCategory.data.id), source: 'institution',
  });
  assert(createdStudent.status === 200 && createdStudent.data?.id, `delegated student create denied: ${createdStudent.status}`);
  const createdStudentFacts = await ctx.queryTestDb(
    'SELECT force_password_change, login_count, last_login_at FROM sys_user WHERE id = ?',
    [String(createdStudent.data.id)],
  );
  assert(Number(createdStudentFacts[0]?.force_password_change || 0) === 1, 'manual student create did not set force_password_change');
  assert(Number(createdStudentFacts[0]?.login_count || 0) === 0 && !createdStudentFacts[0]?.last_login_at, 'manual student create changed login facts');
  const studentLogin = await ctx.request(null, 'POST', '/auth/login', { username: studentUsername, password: studentPassword });
  assert(studentLogin.status === 200 && studentLogin.data?.force_change_password === true, `manual student first login flag missing: ${studentLogin.status}`);
  const studentChangedPassword = randomStrongPassword(studentUsername, '培训学员改密');
  const studentChange = await ctx.request({ accessToken: studentLogin.data.access_token }, 'PUT', '/auth/password', {
    old_password: studentPassword, new_password: studentChangedPassword,
  });
  assert(studentChange.status === 200 && studentChange.data?.access_token, `manual student password change failed: ${studentChange.status}`);
  const studentBeforeReset = await ctx.request({ accessToken: studentChange.data.access_token }, 'GET', '/auth/profile');
  assert(studentBeforeReset.status === 200, `manual student pre-reset profile failed: ${studentBeforeReset.status}`);

  const importedUsername = `training_import_${randomBytes(4).toString('hex')}`;
  const importedPassword = randomStrongPassword(importedUsername, '导入学员');
  const importPreview = await ctx.request(employeeAdminLogin.actor, 'POST', '/admin/students/import-preview', {
    rows: [{ username: importedUsername, real_name: '导入学员', source: 'external', category_id: String(createdCategory.data.id), password: importedPassword }],
  });
  assert(importPreview.status === 200 && importPreview.data?.batch_id && importPreview.data?.valid_rows?.length === 1, `student import preview denied: ${importPreview.status}/${JSON.stringify(importPreview.json || importPreview.data)}`);
  const importCommit = await ctx.request(employeeAdminLogin.actor, 'POST', `/admin/students/import-batches/${importPreview.data.batch_id}/commit`, {
    row_numbers: importPreview.data.valid_rows,
  });
  assert(importCommit.status === 200 && importCommit.data?.created_ids?.length === 1, `student import commit denied: ${importCommit.status}`);
  const importedStudentFacts = await ctx.queryTestDb(
    'SELECT id, force_password_change, login_count, last_login_at FROM sys_user WHERE username = ?',
    [importedUsername],
  );
  assert(Number(importedStudentFacts[0]?.force_password_change || 0) === 1, 'imported student did not set force_password_change');
  assert(Number(importedStudentFacts[0]?.login_count || 0) === 0 && !importedStudentFacts[0]?.last_login_at, 'student import changed login facts');

  const studentResetPassword = randomStrongPassword(studentUsername, '培训学员重置');
  const studentReset = await ctx.request(employeeAdminLogin.actor, 'PUT', `/admin/students/${createdStudent.data.id}/password`, { password: studentResetPassword });
  assert(studentReset.status === 200, `delegated student reset denied: ${studentReset.status}`);
  const studentResetFacts = await ctx.queryTestDb(
    'SELECT force_password_change FROM sys_user WHERE id = ?', [String(createdStudent.data.id)],
  );
  assert(Number(studentResetFacts[0]?.force_password_change || 0) === 1, 'student reset did not set force_password_change');
  const studentOldToken = await ctx.request({ accessToken: studentChange.data.access_token }, 'GET', '/auth/profile');
  assert(studentOldToken.status === 401 && studentOldToken.code === 40107, `student token after reset expected 40107, got ${studentOldToken.status}/${studentOldToken.code}`);

  const importedLogin = await ctx.request(null, 'POST', '/auth/login', { username: importedUsername, password: importedPassword });
  assert(importedLogin.status === 200 && importedLogin.data?.force_change_password === true, `imported student first login flag missing: ${importedLogin.status}`);
  const importedChangedPassword = randomStrongPassword(importedUsername, '导入学员改密');
  const importedChange = await ctx.request({ accessToken: importedLogin.data.access_token }, 'PUT', '/auth/password', {
    old_password: importedPassword, new_password: importedChangedPassword,
  });
  assert(importedChange.status === 200 && importedChange.data?.access_token, `imported student password change failed: ${importedChange.status}`);
  const importedBeforeDisable = await ctx.request({ accessToken: importedChange.data.access_token }, 'GET', '/auth/profile');
  assert(importedBeforeDisable.status === 200, `imported student pre-disable profile failed: ${importedBeforeDisable.status}`);
  const disabledStudent = await ctx.request(employeeAdminLogin.actor, 'PUT', `/admin/students/${importedStudentFacts[0].id}/status`, { status: 0 });
  assert(disabledStudent.status === 200, `delegated student disable denied: ${disabledStudent.status}`);
  const disabledStudentToken = await ctx.request({ accessToken: importedChange.data.access_token }, 'GET', '/auth/profile');
  assert(disabledStudentToken.status === 403 && disabledStudentToken.code === 40105, `disabled student live session expected 40105/403, got ${disabledStudentToken.status}/${disabledStudentToken.code}`);

  const oldUsersDenied = await ctx.request(employeeAdminLogin.actor, 'GET', '/users');
  assert(oldUsersDenied.status === 403, `delegated manager reached legacy users API: ${oldUsersDenied.status}`);
  const systemRoleDenied = await ctx.request(employeeAdminLogin.actor, 'GET', '/admin/roles');
  assert(systemRoleDenied.status === 403, `delegated manager reached system roles API: ${systemRoleDenied.status}`);

  const readOnlyRoleCode = `training_read_${randomBytes(4).toString('hex')}`;
  const readOnlyRole = await ctx.request(admin.actor, 'POST', '/admin/roles', {
    code: readOnlyRoleCode, name: '培训只读', permissions: ['training_categories:read', 'students:read'],
  });
  assert(readOnlyRole.status === 200 && readOnlyRole.data?.id, `training read-only role create failed: ${readOnlyRole.status}`);
  const readOnlyUsername = `training_readonly_${randomBytes(4).toString('hex')}`;
  const readOnlyPassword = randomStrongPassword(readOnlyUsername, '培训只读');
  const readOnlyUser = await ctx.request(admin.actor, 'POST', '/users', {
    username: readOnlyUsername, password: readOnlyPassword, real_name: '培训只读', role: 'employee',
  });
  assert(readOnlyUser.status === 200 && readOnlyUser.data?.id, `training read-only fixture create failed: ${readOnlyUser.status}`);
  const readOnlyAssigned = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${readOnlyUser.data.id}/roles`, { role_ids: [String(readOnlyRole.data.id)] });
  assert(readOnlyAssigned.status === 200, `training read-only role assignment failed: ${readOnlyAssigned.status}`);
  const readOnlyLogin = await completeFirstLogin(
    ctx,
    await captchaLogin(ctx, readOnlyUsername, readOnlyPassword),
    readOnlyUsername, readOnlyPassword, 'TrainingReadOnly',
  );
  const readOnlyCategories = await ctx.request(readOnlyLogin.actor, 'GET', '/admin/training-categories');
  assert(readOnlyCategories.status === 200, `training read-only category read denied: ${readOnlyCategories.status}`);
  const readOnlyStudents = await ctx.request(readOnlyLogin.actor, 'GET', '/admin/students');
  assert(readOnlyStudents.status === 200, `training read-only student read denied: ${readOnlyStudents.status}`);
  const readOnlyCategoryWrite = await ctx.request(readOnlyLogin.actor, 'POST', '/admin/training-categories', { name: `forbidden_${randomBytes(4).toString('hex')}` });
  assert(readOnlyCategoryWrite.status === 403, `training read-only category write unexpectedly allowed: ${readOnlyCategoryWrite.status}`);
  const readOnlyStudentWrite = await ctx.request(readOnlyLogin.actor, 'POST', '/admin/students', {
    username: `forbidden_${randomBytes(4).toString('hex')}`, password: randomStrongPassword('forbidden'), real_name: '禁止写入',
    category_id: String(createdCategory.data.id), source: 'institution',
  });
  assert(readOnlyStudentWrite.status === 403, `training read-only student write unexpectedly allowed: ${readOnlyStudentWrite.status}`);

  assert(Number(employeeStatsRows[0]?.login_count || 0) >= 3, 'successful password logins did not increment login_count');
  assert(Number(employeeStatsRows[0]?.force_password_change || 0) === 0, 'password change did not clear force_password_change');
  assert(employeeStatsRows[0]?.last_login_at && employeeStatsRows[0]?.last_login_ip, 'successful login stats missing timestamp or IP');

  const employeeTokenBeforeReset = employeeAdminLogin.actor.accessToken;
  const employeeBeforeResetProfile = await ctx.request(employeeAdminLogin.actor, 'GET', '/auth/profile');
  assert(employeeBeforeResetProfile.status === 200, `employee pre-reset profile failed: ${employeeBeforeResetProfile.status}`);
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
  assert(employeeOldToken.status === 401 && employeeOldToken.code === 40107, `employee token after reset expected 40107, got ${employeeOldToken.status}/${employeeOldToken.code}`);

  const restrictedUsername = `restricted_${randomBytes(4).toString('hex')}`;
  const restrictedPassword = randomStrongPassword(restrictedUsername, '受限管理员');
  const restricted = await ctx.request(admin.actor, 'POST', '/users', {
    username: restrictedUsername, password: restrictedPassword,
    real_name: '受限管理员', role: 'regulation_admin',
  });
  assert(restricted.status === 200 && restricted.data?.id, `restricted fixture create failed: ${restricted.status} ${JSON.stringify(restricted.json || restricted.data)}`);
  const assigned = await ctx.request(admin.actor, 'PUT', `/admin/administrators/${restricted.data.id}/roles`, { role_ids: [role.data.id] });
  assert(assigned.status === 200, `restricted role assignment failed: ${assigned.status}`);
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
  const deniedRemovedGeneration = await ctx.request(postRemovalLogin.actor, 'POST', '/ai/generate-questions', {
    regulation_id: scopedRegulationId, question_count_single: 1, question_count_multiple: 0,
    score_single: 100, score_multiple: 1,
  });
  assert(deniedRemovedGeneration.status === 403, `removed role AI generation expected 403, got ${deniedRemovedGeneration.status}`);
  const deniedRemovedQuestionRead = await ctx.request(postRemovalLogin.actor, 'GET', '/ai/questions');
  assert(deniedRemovedQuestionRead.status === 403, `removed role question read expected 403, got ${deniedRemovedQuestionRead.status}`);
  const deniedRemovedQuestionWrite = await ctx.request(postRemovalLogin.actor, 'POST', '/ai/questions', {
    regulation_id: scopedRegulationId, type: 'single', stem: 'removed role question',
    options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [0], score: 10,
  });
  assert(deniedRemovedQuestionWrite.status === 403, `removed role question write expected 403, got ${deniedRemovedQuestionWrite.status}`);
  const deniedRemovedPaperWrite = await ctx.request(postRemovalLogin.actor, 'POST', '/ai/papers', {
    regulation_id: scopedRegulationId, title: 'removed role paper', pass_score: 60,
  });
  assert(deniedRemovedPaperWrite.status === 403, `removed role paper write expected 403, got ${deniedRemovedPaperWrite.status}`);
  const scopedContentAfterRoleRemoval = await ctx.request(postRemovalLogin.actor, 'GET', `/regulations/${scopedRegulationId}/content`);
  assert(scopedContentAfterRoleRemoval.status === 404 && scopedContentAfterRoleRemoval.code === 40402, `cleared role content scope expected hidden 40402, got ${scopedContentAfterRoleRemoval.status}/${scopedContentAfterRoleRemoval.code}`);

  const sessions = await ctx.request(admin.actor, 'GET', '/admin/sessions');
  assert(sessions.status === 200 && Array.isArray(sessions.data?.items), `session list failed: ${sessions.status}`);
  assert(sessions.data.items.every((item) => item.expires_at), 'session list did not expose persisted expires_at');
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

  const adminLoginCountBeforeConcurrent = await ctx.queryTestDb('SELECT login_count FROM sys_user WHERE id = 1');
  const [parallelAdminLoginA, parallelAdminLoginB] = await Promise.all([
    captchaLogin(ctx, 'admin', admin.password),
    captchaLogin(ctx, 'admin', admin.password),
  ]);
  assert(parallelAdminLoginA.result.status === 200 && parallelAdminLoginB.result.status === 200, 'concurrent admin logins failed');
  const adminLoginCountAfterConcurrent = await ctx.queryTestDb('SELECT login_count FROM sys_user WHERE id = 1');
  assert(
    Number(adminLoginCountAfterConcurrent[0]?.login_count || 0) >= Number(adminLoginCountBeforeConcurrent[0]?.login_count || 0) + 2,
    'concurrent successful logins lost a login_count increment',
  );

  const rotation = await captchaLogin(ctx, 'admin', admin.password);
  const beforeCookie = rotation.actor.cookie;
  const rotated = await ctx.request(rotation.actor, 'POST', '/auth/refresh');
  assert(rotated.status === 200, `refresh rotation failed: ${rotated.status}`);
  const adminSessionBeforeTouch = await ctx.queryTestDb(
    'SELECT sid, expires_at FROM auth_session WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1',
    ['1'],
  );
  assert(adminSessionBeforeTouch[0]?.sid && adminSessionBeforeTouch[0]?.expires_at, 'admin session missing persisted expiry');
  await ctx.queryTestDb(
    'UPDATE auth_session SET expires_at = DATE_ADD(NOW(3), INTERVAL 1 SECOND) WHERE sid = ?',
    [adminSessionBeforeTouch[0].sid],
  );
  const extended = await ctx.request(rotation.actor, 'POST', '/auth/refresh');
  assert(extended.status === 200, `refresh after near-expiry session failed: ${extended.status}`);
  const adminSessionAfterTouch = await ctx.queryTestDb(
    'SELECT expires_at FROM auth_session WHERE sid = ?',
    [adminSessionBeforeTouch[0].sid],
  );
  assert(new Date(adminSessionAfterTouch[0]?.expires_at).getTime() > Date.now() + 3600_000, 'refresh did not extend the persisted session expiry');
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

export async function run(ctx) {
  // This suite owns its Mock AI rather than relying on a developer service or
  // the API child's environment. Port 0 delegates isolation to the kernel.
  const mockServer = await startMockAi(0);
  const address = mockServer.address();
  const mockPort = address && typeof address !== 'string' ? address.port : null;
  if (!Number.isInteger(mockPort) || mockPort < 1024) {
    mockServer.close();
    throw new Error('training-access Mock AI 未返回有效监听端口');
  }
  try {
    return await runBody(ctx, mockPort);
  } finally {
    await new Promise((resolve) => mockServer.close(resolve));
  }
}
