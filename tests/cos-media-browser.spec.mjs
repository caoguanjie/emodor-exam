import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const MOBILE = join(ROOT, 'mobile');
const MOBILE_SRC = join(MOBILE, 'src');
const WEB_SRC = join(ROOT, 'web', 'src');
const requireMobile = createRequire(join(MOBILE, 'package.json'));
const { chromium } = requireMobile('playwright');
const esbuild = requireMobile('esbuild');

function wait(ms) { return new Promise(resolvePromise => setTimeout(resolvePromise, ms)); }

async function startFixture(videoBytes) {
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-cos-browser-'));
  const entry = join(root, 'fixture-entry.js');
  await writeFile(entry, `import { createPinia, setActivePinia } from 'pinia';
    import { watch } from 'vue';
    import { createVideoSessionClient } from ${JSON.stringify(join(MOBILE_SRC, 'stores/video.ts'))};
    import { createProtectedImageController } from ${JSON.stringify(join(MOBILE_SRC, 'platform/protected-image.ts'))};
    import { questionHtmlToReadonlyDoc } from ${JSON.stringify(join(WEB_SRC, 'api/training-types.ts'))};
    setActivePinia(createPinia());
    window.uni = { request: options => fetch(options.url, { method: options.method || 'GET', headers: options.header || {}, body: options.data ? JSON.stringify(options.data) : undefined }).then(async response => options.success({ statusCode: response.status, data: await response.json() })).catch(error => options.fail(error)), reLaunch: () => {} };
    window.__epoch = 0; window.__context = { assetId: '44', ownerType: 'course_cover', ownerId: '31', epoch: 0, userId: '7', authenticated: true, loggingIn: false };
    const video = document.querySelector('#video');
    const controls = { play: () => { void video.play(); }, pause: () => video.pause(), seek: ms => { video.currentTime = ms / 1000; } };
    const client = createVideoSessionClient({ controls, getEpoch: () => window.__epoch, refreshProgress: async () => {}, resolveUrl: url => url });
    watch(() => client.state.src, src => { if (src) { video.src = src; video.load(); } else { video.removeAttribute('src'); video.load(); } }, { flush: 'sync' });
    for (const event of ['play','pause','waiting','ended','error']) video.addEventListener(event, () => void client.event(event));
    video.addEventListener('loadedmetadata', () => client.ready());
    video.addEventListener('timeupdate', () => client.timeUpdate(video.currentTime * 1000));
    window.__client = client; window.__video = video;
    const image = document.querySelector('#image');
    window.__imageContext = window.__context;
    window.__image = createProtectedImageController({ read: () => window.__imageContext, show: src => { image.src = src; } });
    window.__serializeQuestion = value => questionHtmlToReadonlyDoc(value);
  `);
  const bundle = join(root, 'fixture.js');
  await esbuild.build({ entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', absWorkingDir: root,
    nodePaths: [join(MOBILE, 'node_modules')], alias: { '@': MOBILE_SRC }, define: {
      'import.meta.env.VITE_COS_MEDIA_ORIGIN': JSON.stringify('https://fixture-123.cos.ap-shanghai.myqcloud.com'),
      'import.meta.env.VITE_COS_MEDIA_PREFIX': JSON.stringify('ruleexam/test/media/'),
    } });
  const html = Buffer.from('<!doctype html><meta charset="utf-8"><video id="video" muted playsinline preload="auto"></video><img id="image"><script type="module" src="/fixture.js"></script>');
  const server = createHttpServer(async (request, response) => {
    if (request.url === '/' || request.url === '/index.html') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(html); return; }
    if (request.url === '/fixture.js') { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); response.end(await readFile(bundle)); return; }
    response.writeHead(404); response.end();
  });
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { root, server, url: `http://127.0.0.1:${address.port}/` };
}

export async function run({ videoBytes }) {
  const fixture = await startFixture(videoBytes);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage();
  let renewalCalls = 0;
  let holdRenewal = false;
  let releaseRenewal;
  const renewalReleased = new Promise(resolvePromise => { releaseRenewal = resolvePromise; });
  const signed = path => `https://fixture-123.cos.ap-shanghai.myqcloud.com/ruleexam/test/media/${path}?q-sign-algorithm=sha1&q-ak=fixture&q-sign-time=1;9999999999&q-key-time=1;9999999999&q-header-list=host&q-url-param-list=&q-signature=${'a'.repeat(40)}`;
  await page.route('https://fixture-123.cos.ap-shanghai.myqcloud.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('.mp4')) return route.fulfill({ status: 200, contentType: 'video/mp4', body: videoBytes, headers: { 'accept-ranges': 'bytes' } });
    if (url.pathname.endsWith('.png')) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
    return route.fulfill({ status: 404, body: 'missing' });
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    const envelope = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'ok', data }) });
    if (url.pathname.endsWith('/me/video-sessions')) return route.fulfill(envelope({ session_id: '501', version_id: '31', heartbeat_interval_ms: 30000, media: { asset_id: '22', ticket: { content_url: signed('fixture-initial.mp4'), expires_at: new Date(Date.now() + 1400).toISOString() } }, progress: { confirmed_position_ms: 500, credited_ms: 0, coverage_ms: 0, duration_ms: 30000, completed: false, last_seq: 0 } }));
    if (url.pathname.endsWith('/media/22/tickets')) {
      renewalCalls++;
      if (holdRenewal) await renewalReleased;
      return route.fulfill(envelope({ content_url: signed(`fixture-${renewalCalls}.mp4`), expires_at: new Date(Date.now() + 60_000).toISOString() }));
    }
    if (url.pathname.endsWith('/video-sessions/501/close') || url.pathname.endsWith('/video-sessions/501/heartbeat')) return route.fulfill(envelope({ confirmed_position_ms: 500, credited_ms: 0, coverage_ms: 0, duration_ms: 30000, completed: false, last_seq: 0 }));
    if (url.pathname.endsWith('/media/44/tickets')) return route.fulfill(envelope({ content_url: signed('fixture.png'), expires_at: new Date(Date.now() + 5000).toISOString() }));
    return route.fulfill(envelope({ content_url: 'http://cos.fixture.test/fixture.mp4?sig=asset', expires_at: new Date(Date.now() + 5000).toISOString() }));
  });
  await page.goto(fixture.url);
  await page.evaluate(() => window.__client.select({ courseId: '1', lessonId: '1' }));
  await page.evaluate(() => window.__client.play());
  try { await page.waitForFunction(() => window.__video.readyState >= 1 && !window.__video.paused, null, { timeout: 10_000 }); }
  catch (error) { console.error('[cos-media-browser diagnostic]', await page.evaluate(() => ({ state: { ...window.__client.state }, readyState: window.__video.readyState, paused: window.__video.paused, src: window.__video.src }))); throw error; }
  const before = await page.evaluate(() => ({ currentTime: window.__video.currentTime, paused: window.__video.paused }));
  assert.equal(before.paused, false, 'real HTMLVideoElement must be playing');
  assert.ok(before.currentTime >= 0.4, `expected restored position, got ${before.currentTime}`);
  try { await page.waitForFunction(() => /fixture-[1-9]\.mp4/.test(window.__video.src), null, { timeout: 6_000 }); }
  catch (error) { console.error('[cos-media-browser renewal diagnostic]', { calls: renewalCalls, current: await page.evaluate(() => ({ src: window.__video.src, state: { ...window.__client.state }, paused: window.__video.paused })) }); throw error; }
  await page.waitForFunction(() => !window.__video.paused, null, { timeout: 2_000 });
  const after = await page.evaluate(() => ({ currentTime: window.__video.currentTime, paused: window.__video.paused }));
  assert.equal(after.paused, false, 'renewed source must preserve play intent');
  assert.ok(Math.abs(after.currentTime - before.currentTime) < 1.5, `renewal lost position: ${before.currentTime} -> ${after.currentTime}`);

  holdRenewal = true;
  await page.evaluate(() => { window.__epoch++; window.__client.select({ courseId: '2', lessonId: '2' }); });
  await page.waitForFunction(() => window.__client.state.src === '', null, { timeout: 2_000 });
  await page.evaluate(() => window.__client.play());
  await page.waitForFunction(() => window.__video.readyState >= 1, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__client.state.src.includes('renew-'), null, { timeout: 6_000 }).catch(() => undefined);
  await page.evaluate(() => { window.__epoch++; window.__client.select({ courseId: '3', lessonId: '3' }); });
  releaseRenewal();
  await wait(400);
  const stale = await page.evaluate(() => ({ src: window.__client.state.src, paused: window.__video.paused }));
  assert.equal(stale.src, '', 'late ticket after account switch must not revive source');
  assert.equal(stale.paused, true, 'late ticket after account switch must not resume video');

  await page.evaluate(() => window.__image.update());
  await page.waitForFunction(() => document.querySelector('#image').naturalWidth === 1, null, { timeout: 5_000 });
  const imageSrc = await page.locator('#image').getAttribute('src');
  assert.match(imageSrc || '', /fixture-123\.cos\.ap-shanghai\.myqcloud\.com\/ruleexam\/test\/media\/fixture\.png/, 'image fixture should update DOM through controlled resolver');
  const serialized = await page.evaluate(() => JSON.stringify(window.__serializeQuestion('<p>图题<img data-media-id="44" src="https://fixture-123.cos.ap-shanghai.myqcloud.com/ruleexam/test/media/fixture.png?q-signature=secret"></p>')));
  assert.match(serialized, /"asset_id":"44"/); assert.doesNotMatch(serialized, /q-signature|fixture-123\.cos/);
  await page.evaluate(() => { window.__imageContext = { ...window.__imageContext, epoch: window.__imageContext.epoch + 1, userId: '8' }; window.__image.update(); });
  assert.equal(await page.locator('#image').getAttribute('src'), '', 'image DOM must clear on account switch');
  await browser.close(); await new Promise(resolvePromise => fixture.server.close(resolvePromise)); await rm(fixture.root, { recursive: true, force: true });
  console.log(`[cos-media-browser] real HTMLVideoElement currentTime/paused, renewal, stale account switch, controlled image DOM passed; browser COS requests were route-stubbed`);
}

async function standaloneVideoFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-cos-browser-video-'));
  const output = join(root, 'fixture.mp4');
  try {
    await new Promise((resolvePromise, reject) => {
      const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=30',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-y', output,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 2000); });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`ffmpeg fixture exited ${code}: ${stderr}`)));
    });
    return await readFile(output);
  } finally { await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run({ videoBytes: await standaloneVideoFixture() }).catch(error => { console.error(error); process.exitCode = 1; });
}
