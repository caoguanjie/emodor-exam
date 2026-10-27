import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const sharp = require('sharp');
const mysql = require('mysql2/promise');

async function ownedDdl(ctx, sql) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_[A-Za-z0-9_]+$/);
  const connection = await mysql.createConnection({ host: ctx.env.DB_HOST, port: Number(ctx.env.DB_PORT), user: ctx.env.DB_USERNAME, password: ctx.env.DB_PASSWORD, database: ctx.env.DB_DATABASE });
  try { await connection.query(sql); } finally { await connection.end(); }
}

async function providerControl(ctx, action) {
  const response = await fetch(`${new URL(ctx.baseUrl).origin}/__identity-test/provider`, { method: action ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Identity-Test-Control': createHmac('sha256', ctx.env.JWT_SECRET).update('identity-test-control').digest('hex') },
    ...(action ? { body: JSON.stringify({ action }) } : {}) });
  assert.equal(response.status, 200, 'test-only Provider control must be available only in the isolated test bootstrap');
  return response.json();
}
async function waitFor(check, description) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 20)); }
  throw new Error(`Timed out: ${description}`);
}

async function concurrencyCases(ctx) {
  const learner = await identityReadyLearner(ctx);
  const firstMaterials = await materials(ctx, learner, '#2364aa'); const secondMaterials = await materials(ctx, learner, '#2464aa');
  const before = await providerControl(ctx, 'pause');
  const replies = [];
  const first = ctx.request(learner, 'POST', '/me/identity-verification/sessions', firstMaterials).then((reply) => { replies.push(reply); return reply; });
  const second = ctx.request(learner, 'POST', '/me/identity-verification/sessions', secondMaterials).then((reply) => { replies.push(reply); return reply; });
  try {
    await waitFor(async () => { const state = await providerControl(ctx); return state.waiting_calls === 1 && replies.length === 1; }, 'two real concurrent requests to serialize on the user row');
    assert.equal(replies[0].code, 40906, 'different material set must conflict while the other request is inside Provider');
    const state = await providerControl(ctx); assert.equal(state.verify_calls - before.verify_calls, 1);
    const active = await ctx.queryTestDb("SELECT id FROM identity_verification_session WHERE user_id=? AND status IN ('created','provider_pending','provider_unknown','provider_verified')", [learner.userId]);
    assert.equal(active.length, 1, 'MySQL user lock permits only one active session');
  } finally { await providerControl(ctx, 'resume'); }
  const completed = await Promise.all([first, second]);
  assert.deepEqual(completed.map((reply) => reply.status).sort(), [200, 409]);
  assert.equal((await providerControl(ctx)).verify_calls - before.verify_calls, 1);

  // Both lock orderings are safe: release wins => no session; create wins => release rejects.
  // Repeat with fresh users so no prior verified fact can short-circuit the race.
  for (let index = 0; index < 3; index++) {
    const racer = await identityReadyLearner(ctx); const input = await materials(ctx, racer, `#${30 + index}64aa`);
    const [created, released] = await Promise.all([
      ctx.request(racer, 'POST', '/me/identity-verification/sessions', input),
      ctx.request(racer, 'DELETE', `/me/identity-verification/images/${input.face_asset_id}`),
    ]);
    const rows = await ctx.queryTestDb(`SELECT s.id, a.id AS face_id, a.status AS face_status FROM identity_verification_session s LEFT JOIN media_asset a ON a.id=s.face_asset_id WHERE s.user_id=?`, [racer.userId]);
    if (released.status === 200) {
      assert.notEqual(created.status, 200); assert.equal(rows.length, 0, 'a released image cannot be referenced by a newly created session');
    } else {
      assert.equal(released.code, 40913); assert.equal(created.status, 200); assert.equal(rows.length, 1); assert.ok(rows[0].face_id); assert.equal(rows[0].face_status, 'ready');
    }
  }
}

export async function syntheticImage(color = '#2164aa') {
  return sharp({ create: { width: 640, height: 420, channels: 3, background: color } }).png().toBuffer();
}
export async function debugLearner(ctx) {
  const actor = {};
  const phone = `138${String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, '0')}`;
  const logged = await ctx.request(actor, 'POST', '/mobile/auth/debug-login', { phone });
  assert.equal(logged.status, 200, 'test bootstrap debug login');
  assert.equal(logged.data.user.identity_status, 'unverified', 'debug login must not create a verified identity');
  actor.accessToken = logged.data.access_token; actor.userId = String(logged.data.user.id);
  return actor;
}
// Prepare ordinary profile data through the same HTTP APIs as onboarding.
// Category creation below is isolated fixture setup, never an identity shortcut.
export async function completeIdentityProfile(ctx, actor) {
  const profile = await ctx.request(actor, 'GET', '/me/profile');
  assert.equal(profile.status, 200);
  if (!profile.data.real_name?.trim()) {
    const saved = await ctx.request(actor, 'POST', '/me/profile', { real_name: '合成待核验学员' });
    assert.equal(saved.status, 200);
  }
  if (!profile.data.category_id) {
    let [category] = await ctx.queryTestDb('SELECT id FROM training_category WHERE status=1 ORDER BY id LIMIT 1');
    if (!category) {
      const inserted = await ctx.queryTestDb('INSERT INTO training_category(name,status,created_by) VALUES (?,1,?)', [`实名测试工种 ${randomBytes(4).toString('hex')}`, actor.userId]);
      category = { id: inserted.insertId };
    }
    const confirmed = await ctx.request(actor, 'PUT', '/me/training-category', { category_id: String(category.id) });
    assert.equal(confirmed.status, 200);
  }
  return profile.data;
}
async function identityReadyLearner(ctx) {
  const actor = await debugLearner(ctx);
  await completeIdentityProfile(ctx, actor);
  return actor;
}
export async function uploadIdentity(ctx, actor, imageType, bytes) {
  const boundary = `----ruleexam-identity-${randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image_type"\r\n\r\n${imageType}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return ctx.request(actor, 'POST', '/me/identity-verification/images', body, { 'Content-Type': `multipart/form-data; boundary=${boundary}` });
}
export async function materials(ctx, actor, portraitColor = '#2164aa', faceColor = '#25814f') {
  const result = {};
  for (const [type, key, color] of [['id_card_portrait', 'id_card_portrait_asset_id', portraitColor], ['id_card_emblem', 'id_card_emblem_asset_id', '#7164aa'], ['face', 'face_asset_id', faceColor]]) {
    const uploaded = await uploadIdentity(ctx, actor, type, await syntheticImage(color));
    assert.equal(uploaded.status, 200, `synthetic ${type} upload`);
    assert.equal(uploaded.data.scan_status, 'safe');
    if (type === 'face') assert.equal(uploaded.data.processed_preview, null);
    else assert.match(uploaded.data.processed_preview.content_url, /^\/api\/v1\/media\/tickets\//);
    result[key] = uploaded.data.asset_id;
  }
  return result;
}

/** Real HTTP/JWT/MySQL/media lifecycle; only the external identity provider is replaced. */
export async function run(ctx) {
  const learner = await identityReadyLearner(ctx); const other = await identityReadyLearner(ctx);
  const incomplete = await debugLearner(ctx);
  const incompleteImages = await materials(ctx, incomplete, '#5564aa');
  const callsBefore = (await providerControl(ctx)).verify_calls;
  const missing = await ctx.request(incomplete, 'POST', '/me/identity-verification/sessions', incompleteImages);
  assert.equal(missing.code, 40001);
  assert.equal((await providerControl(ctx)).verify_calls, callsBefore, 'incomplete profile cannot call provider');
  await completeIdentityProfile(ctx, incomplete);
  assert.equal((await ctx.request(incomplete, 'POST', '/me/identity-verification/sessions', incompleteImages)).data.status, 'verified');
  assert.equal((await ctx.request(learner, 'GET', '/me/identity-verification')).data.status, 'unverified');
  const bad = await uploadIdentity(ctx, learner, 'face', Buffer.from('not an image'));
  assert.equal(bad.code, 42201); assert.deepEqual(bad.data, { reason_code: null, clear_materials: [] });
  const input = await materials(ctx, learner); const foreign = await materials(ctx, other);
  const mixed = await ctx.request(other, 'POST', '/me/identity-verification/sessions', { ...foreign, face_asset_id: input.face_asset_id });
  assert.equal(mixed.code, 40302);
  const forbiddenPurpose = await ctx.request(learner, 'POST', '/me/identity-verification/sessions', { ...input, face_asset_id: input.id_card_portrait_asset_id });
  assert.equal(forbiddenPurpose.code, 40001);
  const created = await ctx.request(learner, 'POST', '/me/identity-verification/sessions', input);
  assert.equal(created.status, 200); assert.equal(created.data.status, 'verified');
  const sessionId = created.data.session_id;
  assert.equal((await ctx.request(other, 'GET', `/me/identity-verification/sessions/${sessionId}`)).code, 40302);
  const repeat = await ctx.request(learner, 'POST', '/me/identity-verification/sessions', input);
  assert.equal(repeat.code, 40960); assert.equal(repeat.data.status, 'verified');
  const view = await ctx.request(learner, 'GET', '/me/identity-verification');
  assert.equal(view.data.status, 'verified'); assert.equal(view.data.real_name, '合成测试主体'); assert.match(view.data.id_number_masked, /\*+/);
  const rows = await ctx.queryTestDb('SELECT * FROM learner_identity WHERE user_id=?', [learner.userId]);
  assert.equal(rows.length, 1); assert.equal(JSON.stringify(rows).includes('SYNTHETIC-'), false); assert.equal(JSON.stringify(rows).includes('合成测试主体'), false);
  const session = await ctx.queryTestDb('SELECT * FROM identity_verification_session WHERE id=?', [sessionId]);
  assert.ok(session[0].bound_event_id); assert.equal(session[0].status, 'verified'); assert.ok(session[0].provider_result_encrypted);
  assert.equal((await ctx.request(learner, 'POST', '/me/profile', { real_name: '未经认证的姓名' })).code, 40001);
  const refreshed = await ctx.request(learner, 'POST', '/mobile/auth/refresh');
  assert.equal(refreshed.data.user.identity_status, 'verified'); learner.accessToken = refreshed.data.access_token;
  assert.equal((await ctx.request(learner, 'DELETE', `/me/identity-verification/images/${input.face_asset_id}`)).code, 40913);
  const duplicate = await ctx.request(other, 'POST', '/me/identity-verification/sessions', foreign);
  assert.equal(duplicate.data.reason_code, 'IDENTITY_ALREADY_BOUND');
  const failedLearner = await identityReadyLearner(ctx); const rejectedInput = await materials(ctx, failedLearner, '#1264aa', '#ee1515');
  const rejected = await ctx.request(failedLearner, 'POST', '/me/identity-verification/sessions', rejectedInput);
  assert.equal(rejected.data.status, 'rejected'); assert.equal(rejected.data.reason_code, 'FACE_MISMATCH'); assert.deepEqual(rejected.data.clear_materials, ['face']);
  assert.equal((await ctx.request(failedLearner, 'POST', '/me/identity-verification/sessions', rejectedInput)).data.session_id, rejected.data.session_id);
  await ctx.restartApi();
  assert.equal((await ctx.request(learner, 'GET', '/me/identity-verification')).data.status, 'verified');
  assert.equal((await ctx.request(learner, 'GET', `/me/identity-verification/sessions/${sessionId}`)).data.status, 'verified');
  const replayed = await ctx.queryTestDb('SELECT bound_event_id FROM identity_verification_session WHERE id=?', [sessionId]);
  assert.equal(replayed[0].bound_event_id, session[0].bound_event_id);

  // Force a local DB binding failure after the successful provider result commits.
  // This trigger exists only in this run-owned isolated database.
  const recovering = await identityReadyLearner(ctx); const recoverInput = await materials(ctx, recovering, '#9964aa');
  await ownedDdl(ctx, "CREATE TRIGGER identity_test_bind_failure BEFORE INSERT ON learner_identity FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic bind failure'");
  let pending;
  try {
    const failed = await ctx.request(recovering, 'POST', '/me/identity-verification/sessions', recoverInput);
    assert.equal(failed.status, 500);
    pending = (await ctx.queryTestDb('SELECT id,status,provider_request_id,provider_result_encrypted FROM identity_verification_session WHERE user_id=?', [recovering.userId]))[0];
    assert.equal(pending.status, 'provider_verified'); assert.ok(pending.provider_result_encrypted);
    await ctx.queryTestDb('UPDATE identity_verification_session SET expires_at=DATE_SUB(NOW(3),INTERVAL 1 HOUR) WHERE id=?', [pending.id]);
  } finally { await ownedDdl(ctx, 'DROP TRIGGER identity_test_bind_failure'); }
  await ctx.restartApi();
  assert.equal((await ctx.request(recovering, 'GET', '/me/identity-verification')).data.status, 'verified', 'expired successful provider result must recover its local binding');
  const restored = (await ctx.queryTestDb('SELECT status,provider_request_id FROM identity_verification_session WHERE id=?', [pending.id]))[0];
  assert.equal(restored.status, 'verified'); assert.equal(restored.provider_request_id, pending.provider_request_id);
  await concurrencyCases(ctx);
  console.log('[mobile-identity] real upload/session/bind/restart/uniqueness passed with test-only external Provider replacement');
}
