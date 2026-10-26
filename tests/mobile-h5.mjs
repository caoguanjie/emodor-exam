import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { prepareTrainingFlow } from './training-full-flow.mjs';
import { syntheticImage } from './mobile-identity.mjs';
import { wholeAnswers, assertAttemptView } from './support/exam-mobile-fixtures.mjs';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const MOBILE_DIST = join(ROOT, 'dist', 'mobile');
const MOBILE_DIR = join(ROOT, 'mobile');

function phone() { return `138${String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, '0')}`; }
function waitForChild(child, label) {
  if (child.exitCode !== null) return Promise.reject(new Error(`${label} exited with ${child.exitCode}`));
  return new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${label} exited ${code ?? signal}`)));
    child.once('error', reject);
  });
}
function contentType(path) { return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' })[extname(path).toLowerCase()] || 'application/octet-stream'; }

async function startMobileServer(ctx) {
  if (!existsSync(join(MOBILE_DIST, 'index.html'))) throw new Error('missing dist/mobile/index.html; build H5 before T16');
  const api = new URL(ctx.baseUrl);
  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url || '/', 'http://mobile.test');
    if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) {
      const upstreamPath = `${api.pathname.replace(/\/$/, '')}${url.pathname.slice('/api/v1'.length)}${url.search}`;
      const upstream = httpRequest({ hostname: api.hostname, port: Number(api.port || 80), method: incoming.method, path: upstreamPath, headers: { ...incoming.headers, host: api.host } }, upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on('error', error => { if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); response.end(String(error.message)); });
      incoming.pipe(upstream);
      return;
    }
    const relative = url.pathname.startsWith('/mobile/') ? url.pathname.slice('/mobile/'.length) : '';
    const candidate = relative ? normalize(join(MOBILE_DIST, relative)) : join(MOBILE_DIST, 'index.html');
    const file = candidate.startsWith(MOBILE_DIST) && existsSync(candidate) ? candidate : join(MOBILE_DIST, 'index.html');
    try {
      response.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
      response.end(readFileSync(file));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); response.end(String(error.message));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address === 'object' && address.port);
  return { server, baseUrl: `http://127.0.0.1:${address.port}/mobile` };
}

async function uploadQuestionImage(ctx, actor, assetName) {
  const boundary = `----mobile-h5-${randomBytes(12).toString('hex')}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nquestion\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${assetName}"\r\nContent-Type: image/png\r\n\r\n`),
    await syntheticImage('#2164aa'), Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploaded = await ctx.request(actor, 'POST', '/media/upload', body, { 'Content-Type': `multipart/form-data; boundary=${boundary}` });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded));
  return String(uploaded.data.asset_id);
}

async function addImageToFrozenRelease(ctx, releaseId, assetId) {
  const rows = await ctx.queryTestDb('SELECT id,snapshot_json FROM paper_release_question WHERE release_id=? ORDER BY position,id', [releaseId]);
  assert.ok(rows.length >= 3, 'the shared full-flow release must contain three objective questions');
  for (const row of rows) {
    const snapshot = typeof row.snapshot_json === 'string' ? JSON.parse(row.snapshot_json) : row.snapshot_json;
    if (snapshot.content_schema_version === 2 || snapshot.contentSchemaVersion === 2) {
      const content = snapshot.content_json || snapshot.contentJson;
      content.stem = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '图文安全题' }, { type: 'image', attrs: { asset_id: assetId } }] }] };
    } else snapshot.stem = `<p>图文安全题 <img data-media-id="${assetId}"></p>`;
    await ctx.queryTestDb('UPDATE paper_release_question SET snapshot_json=? WHERE id=?', [JSON.stringify(snapshot), row.id]);
  }
}

async function createDebugLearner(ctx, categoryId) {
  const input = { phone: phone() }, actor = {};
  const logged = await ctx.request(actor, 'POST', '/mobile/auth/debug-login', input);
  assert.equal(logged.status, 200, JSON.stringify(logged));
  actor.accessToken = logged.data.access_token; actor.userId = String(logged.data.user.id);
  await ctx.queryTestDb('UPDATE sys_user SET category_id=?,source=? WHERE id=?', [categoryId, 'institution', actor.userId]);
  return { actor, phone: input.phone, userId: actor.userId };
}

async function createDeadlineAttempt(ctx, actor, paperId) {
  let started;
  try { started = await ctx.request(actor, 'POST', `/me/exams/${paperId}/start`); }
  catch (error) {
    error.message = `[mobile-h5 stage=createDeadlineAttempt cause=${error.cause?.code || 'none'}:${error.cause?.message || 'none'}] ${error.message}`;
    throw error;
  }
  assert.equal(started.status, 200, JSON.stringify(started)); assertAttemptView(started.data);
  // Leave a real in-progress window for the browser. The Playwright case first
  // proves the questions are editable, then waits for the server deadline to
  // cross and proves the client locks without issuing a submit.
  await ctx.queryTestDb('UPDATE exam_record SET deadline_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 18 SECOND) WHERE id=?', [started.data.record_id]);
  const [user] = await ctx.queryTestDb('SELECT phone FROM sys_user WHERE id=?', [actor.userId]);
  assert.ok(user?.phone);
  return { phone: String(user.phone), recordId: String(started.data.record_id), answers: wholeAnswers(started.data, { single: ['A'], multiple: ['A'], judgment: ['A'] }) };
}

function runPlaywright(ctx, env) {
  const cli = join(MOBILE_DIR, 'node_modules', '.bin', 'playwright');
  return (async () => {
    for (const file of ['e2e/critical-timeout.spec.ts', 'e2e/critical-exam.spec.ts']) {
      const child = spawn(cli, ['test', file, '--config', 'playwright.config.ts', '--workers=1'], { cwd: MOBILE_DIR, env: { ...process.env, ...env, PLAYWRIGHT_CHANNEL: process.env.PLAYWRIGHT_CHANNEL || 'chrome' }, stdio: 'inherit' });
      ctx.trackChild(child);
      ctx.reportOwnedRuntime?.({ stage: 'suite-child-started', suitePid: child.pid, suiteFile: file });
      await waitForChild(child, `mobile critical Playwright ${file}`);
    }
  })();
}

export async function run(ctx) {
  const flow = await prepareTrainingFlow(ctx);
  const learner = await createDebugLearner(ctx, flow.categoryId);
  const imageAssetId = await uploadQuestionImage(ctx, flow.admin.actor, `mobile-h5-${randomBytes(3).toString('hex')}.png`);
  await addImageToFrozenRelease(ctx, flow.releaseId, imageAssetId);
  const [lesson] = await ctx.queryTestDb('SELECT id FROM course_lesson WHERE course_id=? ORDER BY sort_order,id LIMIT 1', [flow.courseId]);
  assert.ok(lesson?.id, 'the shared full-flow course must contain a lesson');
  const identityImages = {
    id_card_portrait: (await syntheticImage('#2164aa')).toString('base64'),
    id_card_emblem: (await syntheticImage('#7164aa')).toString('base64'),
    face: (await syntheticImage('#25814f')).toString('base64'),
  };
  const courseDetail = await ctx.request(learner.actor, 'GET', `/me/courses/${flow.courseId}`);
  assert.equal(courseDetail.status, 200, JSON.stringify(courseDetail));
  // Keep processing API keep-alive closures while the separate H5 build runs.
  // A synchronous build leaves a stale pooled socket for the next exam request.
  const build = spawn(process.execPath, ['scripts/build.mjs', 'h5'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env } });
  ctx.trackChild(build);
  await waitForChild(build, 'mobile H5 build');
  // Create the short-lived attempt immediately before Playwright so the two
  // ordered tests observe a fresh in-progress state before crossing deadline.
  const timeout = await createDeadlineAttempt(ctx, flow.learners[0].actor, flow.paperId);
  const mobileServer = await startMobileServer(ctx);
  try {
    await runPlaywright(ctx, { MOBILE_E2E_BASE_URL: mobileServer.baseUrl, MOBILE_E2E_CRITICAL: '1', MOBILE_H5_PHONE: learner.phone, MOBILE_H5_PAPER_ID: flow.paperId, MOBILE_H5_COURSE_ID: flow.courseId, MOBILE_H5_COURSE_TITLE: courseDetail.data.title, MOBILE_H5_LESSON_ID: String(lesson.id), MOBILE_H5_TIMEOUT_PHONE: timeout.phone, MOBILE_H5_TIMEOUT_RECORD_ID: timeout.recordId, MOBILE_H5_TIMEOUT_ANSWERS: JSON.stringify(timeout.answers), MOBILE_H5_IDENTITY_IMAGES_B64: JSON.stringify(identityImages), MOBILE_H5_IMAGE_ASSET_ID: imageAssetId });
  } finally {
    // The runner owns the Playwright child through ctx.trackChild(). This
    // finally closes the same-origin proxy on normal completion and after the
    // runner's SIGTERM cleanup has stopped that child.
    await new Promise(resolve => mobileServer.server.close(resolve));
  }
  console.log('[mobile-h5] browser critical exam, identity gate, draft recovery, result/review/history/wrong-book and pure timeout passed');
}
