import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { captchaLogin, randomStrongPassword } from './training-access.mjs';
import { randomLearnerPhone } from './support/learner-session-fixture.mjs';
import { run as runBrowser } from './cos-media-browser.spec.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { IdentityCrypto } = require('../server/dist/modules/identity/identity-crypto.js');

function waitChild(child, label) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += chunk.toString().slice(0, 1000); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${label} exited ${code}: ${stderr}`)));
  });
}

async function videoFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-cos-e2e-'));
  const output = join(root, 'fixture.mp4');
  try {
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-y', output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    await waitChild(child, 'ffmpeg fixture');
    return await readFile(output);
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function admin(ctx) {
  const logged = await captchaLogin(ctx, 'admin', ctx.adminPassword);
  const actor = logged.actor;
  if (logged.result.data?.force_change_password) {
    const next = randomStrongPassword('cos-flow-admin');
    const changed = await ctx.request(actor, 'PUT', '/auth/password', { old_password: ctx.adminPassword, new_password: next });
    assert.equal(changed.status, 200, JSON.stringify(changed)); actor.accessToken = changed.data.access_token;
  }
  return actor;
}

async function completeBackground(ctx, grant, sessionId) {
  const control = new URL(grant.url);
  const endpoint = `${control.origin}/__cos-test/finalize`;
  const headers = { 'Content-Type': 'application/json', 'x-cos-test-control': grant.headers['x-cos-test-control'] };
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(endpoint, { method: 'POST', headers });
    assert.equal(response.status, 200, await response.text());
    const view = await ctx.request(ctx.__actor, 'GET', `/media/upload-sessions/${sessionId}`);
    if (view.data?.state === 'completed') return view.data;
    if (view.data?.state === 'failed') throw new Error(`COS finalizer failed: ${JSON.stringify(view.data)}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('COS finalizer did not publish a ready asset');
}

export async function run(ctx) {
  const actor = await admin(ctx); ctx.__actor = actor;
  const bytes = await videoFixture();
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  const init = await ctx.request(actor, 'POST', '/media/upload-sessions', {
    client_request_id: randomUUID(), purpose: 'video', filename: 'fixture.mp4', mime_type: 'video/mp4', size_bytes: bytes.length, fingerprint_sha256: fingerprint,
  });
  assert.equal(init.status, 200, `init ${JSON.stringify(init)}`);
  assert.equal(init.data.mode, 'simple');
  const sessionId = init.data.session_id;
  const grant = await ctx.request(actor, 'POST', `/media/upload-sessions/${sessionId}/credentials`);
  if (grant.status !== 200) throw new Error(`POST /media/upload-sessions/${sessionId}/credentials failed: ${JSON.stringify(grant)}`);
  assert.equal(grant.data.mode, 'simple');
  const direct = await fetch(grant.data.url, { method: 'PUT', headers: grant.data.headers, body: bytes });
  if (direct.status !== 200) throw new Error(`direct PUT failed: ${direct.status} ${await direct.text()}`);
  const completed = await ctx.request(actor, 'POST', `/media/upload-sessions/${sessionId}/complete`);
  if (completed.status !== 200) throw new Error(`POST /media/upload-sessions/${sessionId}/complete failed: ${JSON.stringify(completed)}`);
  const ready = await completeBackground(ctx, grant.data, sessionId);
  assert.equal(ready.result.status, 'ready');
  const assetId = String(ready.result.asset_id);
  const assetRows = await ctx.queryTestDb('SELECT id,storage_provider,status,sha256 FROM media_asset WHERE id=?', [assetId]);
  assert.equal(assetRows.length, 1); assert.equal(assetRows[0].storage_provider, 'cos'); assert.equal(assetRows[0].status, 'ready'); assert.equal(assetRows[0].sha256, fingerprint);

  const category = await ctx.request(actor, 'POST', '/admin/training-categories', { name: `COS验证-${randomUUID().slice(0, 8)}`, description: 'media flow' });
  assert.equal(category.status, 200, `category ${JSON.stringify(category)}`);
  const course = await ctx.request(actor, 'POST', '/admin/courses', { title: `COS视频-${randomUUID().slice(0, 8)}`, category_id: String(category.data.id), description: 'media flow' });
  assert.equal(course.status, 200, `course ${JSON.stringify(course)}`);
  const chapter = await ctx.request(actor, 'POST', `/admin/courses/${course.data.id}/chapters`, { title: '第一章', sort_order: 1 });
  assert.equal(chapter.status, 200, `chapter ${JSON.stringify(chapter)}`);
  const lesson = await ctx.request(actor, 'POST', `/admin/courses/${course.data.id}/lessons`, { chapter_id: String(chapter.data.id), title: 'COS视频课时', lesson_type: 'video', required: true, sort_order: 1, asset_id: assetId });
  assert.equal(lesson.status, 200, `lesson ${JSON.stringify(lesson)}`);
  const refs = await ctx.queryTestDb("SELECT asset_id,owner_type,owner_id FROM media_reference WHERE asset_id=? AND owner_type='lesson_version_video'", [assetId]);
  assert.equal(refs.length, 1, JSON.stringify({ lesson: lesson.data, refs }));
  const versionId = String(lesson.data.version_id || lesson.data.current_version?.version_id || lesson.data.current_version_id || '');
  assert.ok(versionId, JSON.stringify({ lesson: lesson.data, refs }));
  assert.equal(String(refs[0].owner_id), versionId, JSON.stringify({ lesson: lesson.data, refs }));
  const published = await ctx.request(actor, 'POST', `/admin/courses/${course.data.id}/publish`, {});
  if (published.status !== 200) throw new Error(`POST /admin/courses/${course.data.id}/publish failed: ${JSON.stringify(published)}`);

  const phone = randomLearnerPhone();
  const learner = await ctx.request(actor, 'POST', '/admin/students', { username: `cos_${randomUUID().slice(0, 8)}`, phone, real_name: 'COS浏览器学员', employee_no: `C${randomUUID().slice(0, 8)}`, category_id: String(category.data.id), source: 'institution' });
  if (learner.status !== 200) throw new Error(`POST /admin/students failed: ${JSON.stringify(learner)}`);
  const identityFixture = `cos-flow-${randomUUID()}`;
  const identityCrypto = new IdentityCrypto({ identity: { dataEncryptionKey: ctx.env.IDENTITY_DATA_ENCRYPTION_KEY, fingerprintSecret: ctx.env.IDENTITY_FINGERPRINT_SECRET } });
  await ctx.queryTestDb(
    'INSERT INTO learner_identity (user_id,id_fingerprint,identity_encrypted,session_id,provider_request_id) VALUES (?,?,?,?,?)',
    [String(learner.data.id), identityCrypto.fingerprint(identityFixture), identityCrypto.encrypt({ realName: 'COS浏览器学员', idNumber: identityFixture }), randomUUID(), 'cos-flow-test-fixture'],
  );
  const mobile = await ctx.request(null, 'POST', '/mobile/auth/debug-login', { phone });
  if (mobile.status !== 200) throw new Error(`POST /mobile/auth/debug-login failed: ${JSON.stringify(mobile)}`);
  const mobileActor = { accessToken: mobile.data.access_token };
  const ticket = await ctx.request(mobileActor, 'POST', `/media/${assetId}/tickets`, { owner_type: 'lesson_version_video', owner_id: versionId });
  if (ticket.status !== 200) throw new Error(`POST /media/${assetId}/tickets failed: ${JSON.stringify(ticket)}`);
  assert.ok(ticket.data.expires_at); assert.match(ticket.data.content_url, /media\/tickets|preview-tickets/);
  await runBrowser({ videoBytes: bytes });
  console.log(`[cos-media-flow] upload-session -> direct PUT -> ready(${assetId}) -> lesson binding -> ticket passed; COS is fixture-stubbed, MySQL is isolated`);
}
