import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { captchaLogin, randomStrongPassword } from './training-access.mjs';
import { runSuiteInRuntime } from './run-e2e.mjs';
import { startAdminDashboardBrowserServer } from './support/admin-dashboard-browser-harness.mjs';

const browserSession = 'ruleexam-online-sessions-polish';
// queryTestDb uses mysql2's host-local Date serialization; persist UTC strings
// to match the API connection, which is explicitly configured with timezone Z.
const utcSql = value => new Date(value).toISOString().replace('T', ' ').replace('Z', '');
async function request(ctx, actor, method, path, body) {
  const response = await ctx.request(actor, method, path, body);
  assert.equal(response.status, 200, `${method} ${path}: ${response.status}/${response.code}`);
  return response.data;
}

async function createUser(ctx, owner, username, name, roleId) {
  const inserted = await ctx.queryTestDb(`INSERT INTO sys_user
    (username,password_hash,real_name,role,status,force_password_change,roles_configured)
    SELECT ?,password_hash,?,'employee',1,0,1 FROM sys_user WHERE id=?`, [username, name, owner]);
  if (roleId) await ctx.queryTestDb('INSERT INTO sys_user_role(user_id,role_id) VALUES (?,?)', [inserted.insertId, roleId]);
  return String(inserted.insertId);
}

async function insertSession(ctx, userId, status, index, client = 'pc') {
  const created = '2026-10-20 02:00:00.000';
  const now = Date.now();
  const expires = utcSql(now + (status === 'active' ? 3600000 : -3600000));
  const revoked = status === 'revoked' ? utcSql(now - 120000) : null;
  const result = await ctx.queryTestDb(`INSERT INTO auth_session
    (sid,user_id,client,auth_method,user_agent,ip_address,last_seen_at,expires_at,revoked_at,created_at,updated_at)
    VALUES (?,?,?,'password',?,'192.0.2.10',?,?,?,?,?)`,
  [randomBytes(24).toString('hex'), userId, client,
    client === 'mobile' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Version/18.5 Mobile/15E148 Safari/604.1'
      : `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36 test-${index}`,
    utcSql(now - index * 60000), expires, revoked, created, created]);
  return String(result.insertId);
}

export async function run(ctx) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_[A-Za-z0-9_]+$/);
  const initial = await captchaLogin(ctx, 'admin', ctx.adminPassword);
  let password = ctx.adminPassword;
  const admin = initial.actor;
  if (initial.result.data.force_change_password) {
    password = randomStrongPassword('admin', 'sessions');
    const changed = await request(ctx, admin, 'PUT', '/auth/password', { old_password: ctx.adminPassword, new_password: password });
    admin.accessToken = changed.access_token;
  }
  const owner = String(initial.result.data.user.id);
  const suffix = randomBytes(4).toString('hex');
  const subjectName = `session_subject_${suffix}`;
  const subjectId = await createUser(ctx, owner, subjectName, '会话验收%_记录', null);
  const states = ['active', 'active', 'active', 'expired', 'expired', 'revoked'];
  const ids = [];
  for (const [index, status] of states.entries()) ids.push(await insertSession(ctx, subjectId, status, index, index === 1 ? 'mobile' : 'pc'));
  const keyword = encodeURIComponent(subjectName);

  const all = await request(ctx, admin, 'GET', `/admin/sessions?keyword=${keyword}&status=all`);
  assert.equal(all.total, 6);
  assert.deepEqual(all.items.map(row => row.id), [...ids].reverse(), 'stable ID order for tied creation times');
  for (const row of all.items) {
    assert.equal(row.username, subjectName); assert.equal(row.real_name, '会话验收%_记录');
    assert.equal(row.user_id, subjectId); assert.equal(row.is_current, false);
    assert.ok(['pc', 'mobile'].includes(row.client));
    assert.ok(row.expires_at && row.created_at && row.last_seen_at);
    assert.ok(!('password_hash' in row) && !('phone' in row) && !('identity_number' in row));
  }
  for (const [status, total] of [['active', 3], ['expired', 2], ['revoked', 1]]) {
    const page = await request(ctx, admin, 'GET', `/admin/sessions?keyword=${keyword}&status=${status}`);
    assert.equal(page.total, total); assert.ok(page.items.every(row => row.status === status));
  }
  const defaults = await request(ctx, admin, 'GET', `/admin/sessions?keyword=${keyword}`);
  assert.equal(defaults.total, 3); assert.equal(defaults.page, 1); assert.equal(defaults.page_size, 20);
  const paged = await request(ctx, admin, 'GET', `/admin/sessions?keyword=${keyword}&status=all&page=2&page_size=2`);
  assert.equal(paged.total, 6); assert.deepEqual(paged.items.map(row => row.id), [...ids].reverse().slice(2,4));
  const beyond = await request(ctx, admin, 'GET', `/admin/sessions?keyword=${keyword}&status=all&page=20&page_size=2`);
  assert.equal(beyond.total, 6); assert.deepEqual(beyond.items, []);
  const literal = await request(ctx, admin, 'GET', '/admin/sessions?status=all&keyword=%25_');
  assert.equal(literal.total, 6); assert.ok(literal.items.every(row => row.user_id === subjectId));
  const trimmed = await request(ctx, admin, 'GET', `/admin/sessions?status=all&keyword=%20${keyword}%20`);
  assert.equal(trimmed.total, 6);
  const noMatch = await request(ctx, admin, 'GET', '/admin/sessions?keyword=never_matching_session_account');
  assert.equal(noMatch.total, 0); assert.deepEqual(noMatch.items, []);

  for (const query of ['status=online', 'status=active&status=expired', 'keyword[]=x', 'page=0', 'page=-1', 'page=1.5',
    'page=1e2', 'page=1000001', 'page=1&page=2', 'page_size=101', 'page_size=0', 'unknown=1', `keyword=${'x'.repeat(129)}`]) {
    const bad = await ctx.request(admin, 'GET', `/admin/sessions?${query}`);
    assert.equal(bad.status, 400, `query accepted: ${query}`); assert.equal(bad.code, 40001);
  }
  const unauth = await ctx.request(null, 'GET', '/admin/sessions');
  assert.equal(unauth.status, 401);

  const second = await captchaLogin(ctx, 'admin', password);
  const firstList = await request(ctx, admin, 'GET', '/admin/sessions?keyword=admin&status=active');
  const secondList = await request(ctx, second.actor, 'GET', '/admin/sessions?keyword=admin&status=active');
  assert.equal(firstList.items.filter(row => row.is_current).length, 1);
  assert.equal(secondList.items.filter(row => row.is_current).length, 1);
  const current = firstList.items.find(row => row.is_current);
  const secondCurrent = secondList.items.find(row => row.is_current);
  assert.notEqual(current.id, secondCurrent.id, 'same-user sessions must have distinct current markers');

  const readerRole = await request(ctx, admin, 'POST', '/admin/roles', { name: `会话只读${suffix}`, permissions: ['sessions:read'] });
  const readerName = `session_reader_${suffix}`;
  await createUser(ctx, owner, readerName, '会话只读验收', readerRole.id);
  const reader = await captchaLogin(ctx, readerName, password);
  assert.ok(Array.isArray((await request(ctx, reader.actor, 'GET', '/admin/sessions')).items));
  const deniedWrite = await ctx.request(reader.actor, 'POST', `/admin/sessions/${secondCurrent.id}/revoke`);
  assert.equal(deniedWrite.status, 403);
  const otherRole = await request(ctx, admin, 'POST', '/admin/roles', { name: `学员只读${suffix}`, permissions: ['students:read'] });
  const otherName = `session_denied_${suffix}`;
  await createUser(ctx, owner, otherName, '无会话权限验收', otherRole.id);
  const other = await captchaLogin(ctx, otherName, password);
  assert.equal((await ctx.request(other.actor, 'GET', '/admin/sessions')).status, 403);

  await request(ctx, admin, 'POST', `/admin/sessions/${secondCurrent.id}/revoke`);
  assert.equal((await ctx.request(second.actor, 'GET', '/auth/profile')).status, 401);
  assert.equal((await ctx.request(admin, 'GET', '/auth/profile')).status, 200, 'revoking another session must preserve current');
  const revoked = await request(ctx, admin, 'GET', '/admin/sessions?keyword=admin&status=revoked');
  assert.ok(revoked.items.some(row => row.id === secondCurrent.id));
  assert.ok(!revoked.items.some(row => row.is_current));

  const orphanId = await insertSession(ctx, '999999999999', 'expired', 50);
  const expired = await request(ctx, admin, 'GET', '/admin/sessions?status=expired&page_size=100');
  const orphan = expired.items.find(row => row.id === orphanId);
  assert.equal(orphan.username, null); assert.equal(orphan.real_name, null);
  console.log('online-sessions API: filtering, projection, pagination, literal search, strict query, permissions and isolated revoke passed');

  if (process.argv.includes('--kimi')) await browserAcceptance(ctx, password);
}

async function browserAcceptance(ctx, password) {
  const ui = await startAdminDashboardBrowserServer(ctx);
  const input = createInterface({ input: process.stdin, terminal: false });
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const stop = () => finish();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  async function kimi(action, args) {
    const response = await fetch('http://127.0.0.1:10086/command', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args, session: browserSession }) });
    const body = await response.json(); assert.ok(body.ok, `Kimi ${action} failed`); return body.data;
  }
  console.log(JSON.stringify({ event: 'sessions-kimi-ready', url: `${ui.baseUrl}/login`, session: browserSession }));
  let queue = Promise.resolve();
  input.on('line', line => {
    queue = queue.then(async () => {
      const command = JSON.parse(line);
      if (command.action === 'finish') { finish(); return; }
      assert.equal(command.action, 'login');
      const { value: src } = await kimi('evaluate', { code: 'document.querySelector("img[alt=验证码]")?.src || ""' });
      assert.ok(src.startsWith('data:image/svg+xml'));
      const svg = src.includes(';base64,') ? Buffer.from(src.split(',')[1], 'base64').toString('utf8') : decodeURIComponent(src.slice(src.indexOf(',') + 1));
      const answer = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match => match[1]).join('');
      assert.match(answer, /^[A-Za-z0-9]{4}$/);
      for (const [selector, value] of [[command.username, 'admin'], [command.password, password], [command.captcha, answer]]) {
        assert.ok(selector); await kimi('fill', { selector, value });
      }
      await kimi('click', { selector: command.submit });
      console.log('sessions Kimi test login submitted');
    }).catch(error => console.log(JSON.stringify({ event: 'sessions-command-error', message: error.message })));
  });
  try { await finished; await queue; }
  finally { input.close(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await ui.close(); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  assert.ok(process.argv.includes('--ephemeral'), 'online sessions checks require an isolated ephemeral database');
  if (process.argv.includes('--kimi')) assert.ok(process.stdin.isTTY, 'interactive Kimi acceptance requires a terminal with stdin open');
  await runSuiteInRuntime(new URL('./online-sessions.mjs', import.meta.url).pathname, true, { interrupted: false }, { suiteModule: { run } });
}
