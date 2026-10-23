import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const bcrypt = require('bcryptjs');
const { JwtService } = require('@nestjs/jwt');

/** Real HTTP/JWT/MySQL/Redis suite. Only debug login bypasses the external SMS delivery. */
export async function run(ctx) {
  assert.equal(ctx.env.SERVER_DEBUG_LOGIN_ENABLED, 'true', 'mobile-auth suite requires its owned debug-login opt-in');
  const jwt = new JwtService({ secret: ctx.env.JWT_SECRET });
  const phone = `138${String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, '0')}`;
  const rawPhone = phone.slice(0, 3) + ' ' + phone.slice(3, 7) + '-' + phone.slice(7);
  const password = randomBytes(24).toString('hex');
  const suffix = randomBytes(6).toString('hex');
  const username = `mobile_${suffix}`;
  const created = await ctx.queryTestDb(
    `INSERT INTO sys_user (username,password_hash,real_name,role,phone,status,source,force_password_change) VALUES (?,?,?,'employee',?,1,'institution',1)`,
    [username, await bcrypt.hash(password, 4), '合成测试学员', phone],
  );
  const userId = String(created.insertId);

  const invalid = await ctx.request(null, 'POST', '/mobile/auth/debug-login', { phone: '123' });
  assert.equal(invalid.status, 400);
  const sms = await ctx.request(null, 'POST', '/mobile/auth/sms/send', { phone });
  assert.equal(sms.status, 503, 'test runtime must not send real SMS');

  const mobile = {};
  const logged = await ctx.request(mobile, 'POST', '/mobile/auth/debug-login', { phone: rawPhone });
  assert.equal(logged.status, 200);
  assert.equal(logged.data.user.id, Number(userId));
  assert.equal(logged.data.user.identity_status, 'unverified');
  assert.equal(logged.data.user.phone_masked, `${phone.slice(0, 3)}****${phone.slice(-4)}`);
  assert.equal(Object.hasOwn(logged.data.user, 'phone'), false);
  mobile.accessToken = logged.data.access_token;
  const claims = jwt.verify(mobile.accessToken);
  assert.equal(claims.client, 'mobile');
  assert.equal(claims.auth_method, 'debug');
  assert.equal(Object.hasOwn(claims, 'pwd_pending'), false);
  assert.match(claims.sid, /^[a-f0-9]{48}$/);
  const setCookies = logged.headers?.['set-cookie'] || [];
  const mobileCookie = setCookies.find((cookie) => cookie.startsWith('ruleexam_mobile_refresh='));
  assert.ok(mobileCookie, 'mobile refresh cookie must be emitted');
  assert.match(mobileCookie, /HttpOnly/i);
  assert.match(mobileCookie, /SameSite=Strict/i);
  assert.match(mobileCookie, /Path=\/api\/v1\/mobile\/auth/i);
  assert.equal((await ctx.request(mobile, 'GET', '/me/profile')).status, 200);
  assert.equal((await ctx.request(mobile, 'GET', '/auth/profile')).status, 403);
  assert.equal((await ctx.request(mobile, 'GET', '/AUTH/profile')).status, 403, 'route matching is case-insensitive, so client isolation must be too');
  assert.equal((await ctx.request(mobile, 'GET', '/admin/students')).status, 403);

  const session = await ctx.queryTestDb('SELECT client,auth_method,user_id FROM auth_session WHERE sid=?', [claims.sid]);
  assert.equal(session[0].client, 'mobile');
  assert.equal(session[0].auth_method, 'debug');
  assert.equal(String(session[0].user_id), userId);
  const stillPending = await ctx.queryTestDb('SELECT force_password_change FROM sys_user WHERE id=?', [userId]);
  assert.equal(Number(stillPending[0].force_password_change), 1);

  const pc = {};
  const pcLogin = await ctx.request(pc, 'POST', '/auth/login', { username, password });
  assert.equal(pcLogin.status, 200);
  assert.equal(pcLogin.data.force_change_password, true);
  pc.accessToken = pcLogin.data.access_token;
  assert.equal(jwt.verify(pc.accessToken).client, 'pc');
  assert.equal((await ctx.request(pc, 'GET', '/me/profile')).status, 403);
  assert.equal((await ctx.request({ ...pc }, 'POST', '/mobile/auth/logout')).status, 200, 'PC credentials can only trigger an empty mobile-cookie cleanup');
  assert.ok(pc.cookie.startsWith('ruleexam_refresh='));
  const pcRefreshValue = pc.cookie.split('=', 2)[1];
  assert.equal((await ctx.request(null, 'POST', '/mobile/auth/refresh', undefined, { Cookie: `ruleexam_mobile_refresh=${pcRefreshValue}` })).status, 401);

  const originalMobileCookie = mobile.cookie;
  const rotations = await Promise.all([1, 2].map(() => ctx.request({ cookie: originalMobileCookie }, 'POST', '/mobile/auth/refresh')));
  assert.deepEqual(rotations.map((result) => result.status).sort(), [200, 401]);
  const rotated = rotations.find((result) => result.status === 200);
  assert.equal(rotated.data.user.identity_status, 'unverified');
  const nextCookie = rotated.headers['set-cookie'].find((cookie) => cookie.startsWith('ruleexam_mobile_refresh=')).split(';', 1)[0];
  mobile.cookie = nextCookie; mobile.accessToken = rotated.data.access_token;

  for (const withExpiredAccess of [false, true]) {
    const actor = {};
    const anotherLogin = await ctx.request(actor, 'POST', '/mobile/auth/debug-login', { phone });
    assert.equal(anotherLogin.status, 200);
    const logoutCookie = actor.cookie;
    if (withExpiredAccess) {
      const expired = jwt.verify(anotherLogin.data.access_token);
      delete expired.exp; delete expired.iat;
      actor.accessToken = jwt.sign(expired, { expiresIn: -1 });
    }
    const loggedOut = await ctx.request(actor, 'POST', '/mobile/auth/logout');
    assert.equal(loggedOut.status, 200, 'logout must work without a live access token');
    assert.ok(loggedOut.setCookies.some((cookie) => cookie.startsWith('ruleexam_mobile_refresh=;')));
    assert.equal((await ctx.request({ cookie: logoutCookie }, 'POST', '/mobile/auth/refresh')).status, 401);
  }
  for (const cookie of [undefined, 'ruleexam_mobile_refresh=invalid-cookie']) {
    const cleaned = await ctx.request({ cookie }, 'POST', '/mobile/auth/logout');
    assert.equal(cleaned.status, 200);
    assert.ok(cleaned.setCookies.some((value) => value.startsWith('ruleexam_mobile_refresh=;')));
  }

  // Add effective permissions without bumping auth_version: the mobile guard must still re-read them.
  const role = await ctx.queryTestDb('INSERT INTO sys_role (code,name,is_system,status) VALUES (?,?,0,1)', [`mobile_role_${suffix}`, '合成权限角色']);
  const permission = await ctx.queryTestDb("SELECT id FROM sys_permission WHERE code='students:read'");
  await ctx.queryTestDb('INSERT INTO sys_role_permission (role_id,permission_id) VALUES (?,?)', [String(role.insertId), String(permission[0].id)]);
  await ctx.queryTestDb('INSERT INTO sys_user_role (user_id,role_id) VALUES (?,?)', [userId, String(role.insertId)]);
  assert.equal((await ctx.request(mobile, 'GET', '/me/profile')).status, 403);
  assert.equal((await ctx.request(mobile, 'POST', '/mobile/auth/refresh')).status, 403);
  assert.equal((await ctx.request(null, 'POST', '/mobile/auth/debug-login', { phone })).status, 403);
  await ctx.queryTestDb('DELETE FROM sys_user_role WHERE user_id=?', [userId]);

  assert.equal((await ctx.request(mobile, 'POST', '/mobile/auth/logout')).status, 200);
  assert.equal((await ctx.request({ cookie: nextCookie }, 'POST', '/mobile/auth/refresh')).status, 401);
  assert.equal((await ctx.request({ accessToken: logged.data.access_token }, 'GET', '/me/profile')).status, 401);
  const pcRefresh = await ctx.request(pc, 'POST', '/auth/refresh');
  assert.equal(pcRefresh.status, 200, 'mobile logout must preserve the PC session');
  assert.equal(pcRefresh.data.force_change_password, true);

  const newPhone = `139${String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, '0')}`;
  const registrations = await Promise.all(Array.from({ length: 4 }, () => ctx.request(null, 'POST', '/mobile/auth/debug-login', { phone: newPhone })));
  assert.ok(registrations.every((result) => result.status === 200), 'concurrent registrations must converge');
  assert.equal(new Set(registrations.map((result) => result.data.user.id)).size, 1);
  const newUsers = await ctx.queryTestDb('SELECT id,role,source,real_name FROM sys_user WHERE phone=?', [newPhone]);
  assert.equal(newUsers.length, 1);
  assert.equal(newUsers[0].role, 'employee');
  assert.equal(newUsers[0].source, 'external');
  assert.equal(newUsers[0].real_name, '');
  const newActor = { accessToken: registrations[0].data.access_token };
  assert.equal((await ctx.request(newActor, 'PATCH', '/me/profile', { phone })).status, 400);
  await ctx.queryTestDb('UPDATE sys_user SET status=0 WHERE id=?', [String(newUsers[0].id)]);
  assert.equal((await ctx.request(newActor, 'GET', '/me/profile')).status, 403);
  assert.equal((await ctx.request(null, 'POST', '/mobile/auth/debug-login', { phone: newPhone })).status, 403);
  await assert.rejects(async () => ctx.queryTestDb(
    "INSERT INTO sys_user (username,password_hash,real_name,role,phone,status) VALUES (?,?,?,'employee',?,1)",
    [`duplicate_${suffix}`, await bcrypt.hash(randomBytes(16).toString('hex'), 4), '合成重复学员', phone],
  ), { code: 'ER_DUP_ENTRY' });
  console.log('mobile-auth: real HTTP, session rotation, client isolation, permissions and unique-phone assertions passed');
}
