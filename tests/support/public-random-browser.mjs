import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PC_DIST = join(ROOT, 'dist');
const MOBILE_DIST = join(ROOT, 'dist', 'mobile');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

// Same dist/mobile + temporary same-origin API proxy pattern as mobile-h5.mjs.
// The parent retains the live harness database until Chrome has finished.
export async function startMobileServer(ctx) {
  assert.ok((await stat(join(MOBILE_DIST, 'index.html'))).isFile(), 'build H5 before PUBLIC_RANDOM_BROWSER=1');
  assert.ok((await stat(join(PC_DIST, 'index.html'))).isFile(), 'build PC before PUBLIC_RANDOM_BROWSER=1');
  const api = new URL(ctx.baseUrl);
  assert.equal(api.hostname, '127.0.0.1');
  const server = createServer((incoming, response) => {
    void (async () => {
      const url = new URL(incoming.url || '/', 'http://public-random.test');
      if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) {
        const upstream = httpRequest({
          hostname: api.hostname, port: Number(api.port), method: incoming.method,
          path: `${api.pathname.replace(/\/$/, '')}${url.pathname.slice('/api/v1'.length)}${url.search}`,
          headers: { ...incoming.headers, host: api.host },
        }, reply => {
          response.writeHead(reply.statusCode || 502, reply.headers);
          reply.pipe(response);
        });
        upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('owned API proxy failed'); });
        incoming.once('aborted', () => upstream.destroy());
        incoming.pipe(upstream);
        return;
      }
      const isMobile = url.pathname === '/mobile' || url.pathname.startsWith('/mobile/');
      const root = isMobile ? MOBILE_DIST : PC_DIST;
      const relative = isMobile ? url.pathname.slice('/mobile/'.length) : url.pathname.slice(1);
      const candidate = relative ? resolve(root, decodeURIComponent(relative)) : join(root, 'index.html');
      let file = join(root, 'index.html');
      if (candidate.startsWith(`${root}${sep}`)) {
        try { if ((await stat(candidate)).isFile()) file = candidate; }
        catch { /* H5 navigation falls back to index.html. */ }
      }
      const bytes = await readFile(file);
      response.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(bytes);
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end('owned H5 static server failed'); });
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const address = server.address();
  assert.ok(address && typeof address === 'object' && address.port);
  return { server, baseUrl: `http://127.0.0.1:${address.port}/mobile` };
}

function runBrowserChild(ctx, input) {
  assert.equal(typeof ctx.trackChild, 'function', 'browser child must be owned by the ephemeral harness');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--public-random-browser-child'], {
    cwd: ROOT, env: { ...process.env, PLAYWRIGHT_CHANNEL: process.env.PLAYWRIGHT_CHANNEL || 'chrome' },
    stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
  });
  ctx.trackChild(child);
  ctx.reportOwnedRuntime?.({ stage: 'public-random-browser-started', suitePid: child.pid });
  return new Promise((accept, reject) => {
    let result;
    child.on('message', message => { if (message?.type === 'public-random-browser-result') result = message.evidence; });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 && result) accept(result);
      else reject(new Error(`public-random H5 browser failed (${code ?? signal ?? 'no result'})`));
    });
    // Refresh credentials stay in the owned process pipe, never command-line
    // arguments, persisted storage, screenshots, report text or console output.
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(input));
  });
}

export async function runPublicRandomBrowser(ctx, { actor, admin, paperId, title }) {
  assert.ok(process.argv.includes('--ephemeral'), 'browser stage requires the ephemeral runner');
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_[a-f0-9]{12}$/);
  assert.ok(actor.cookie, 'a real mobile refresh-cookie fixture is required');
  assert.ok(admin.accessToken, 'a real administrator session is required');
  const principal = await ctx.request(admin, 'GET', '/auth/profile');
  assert.equal(principal.status, 200, 'PC principal must come from the real API');
  const mobile = await startMobileServer(ctx);
  try {
    return await runBrowserChild(ctx, {
      baseUrl: mobile.baseUrl, cookie: actor.cookie, paperId, title,
      admin: { accessToken: admin.accessToken, user: principal.data },
    });
  } finally {
    // The runner tracks the child; the proxy is closed before it drops the DB.
    await new Promise(accept => { mobile.server.close(accept); mobile.server.closeIdleConnections(); });
  }
}

async function pcPaperFlow(browser, input, expect) {
  const origin = new URL(input.baseUrl).origin;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  try {
    await context.addInitScript(({ token, user, origin }) => {
      if (location.origin !== origin) return;
      sessionStorage.setItem('re_token', token);
      sessionStorage.setItem('re_user', JSON.stringify(user));
      sessionStorage.setItem('re_pwd_pending', '0');
    }, { token: input.admin.accessToken, user: input.admin.user, origin });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(30_000);
    const pageErrors = [];
    const httpFailures = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', reply => {
      const url = new URL(reply.url());
      if (url.origin === origin && url.pathname.startsWith('/api/v1/') && reply.status() >= 400) {
        httpFailures.push({ path: url.pathname, status: reply.status() });
      }
    });
    const field = (dialog, label) => dialog.locator('.el-form-item').filter({
      has: page.locator('.el-form-item__label').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }),
    }).locator('input').first();
    const countField = (dialog, type) => dialog.locator(`[data-rule-type="${type}"]`).getByRole('spinbutton').nth(0);
    const scoreField = (dialog, type) => dialog.locator(`[data-rule-type="${type}"]`).getByRole('spinbutton').nth(1);
    const responseFor = (path, method) => page.waitForResponse(reply => new URL(reply.url()).pathname === `/api/v1${path}` && reply.request().method() === method);
    const title = `${input.title}-PC页面`;
    console.log('[public-random-browser] PC open Papers and create public random rules');
    await page.goto(`${origin}/admin/papers`);
    await expect(page.getByRole('button', { name: '新增试卷', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '新增试卷', exact: true }).click();
    const create = page.getByRole('dialog', { name: '新增试卷', exact: true });
    await expect(create).toBeVisible();
    await field(create, '试卷名称').fill(title);
    await create.getByText('随机试卷', { exact: true }).click();
    await expect(create.getByRole('radio', { name: '随机试卷', exact: true })).toBeChecked();
    await expect(create).toContainText('公共题库（跨培训类别）');
    await countField(create, 'single').fill('100');
    await scoreField(create, 'single').fill('1');
    await countField(create, 'multiple').fill('0');
    await countField(create, 'judgment').fill('0');
    await expect(create.getByTestId('random-rule-summary')).toContainText(/共\s*100\s*道/);
    const createdWait = responseFor('/admin/papers', 'POST');
    await create.getByRole('button', { name: '保存草稿', exact: true }).click();
    const createdResponse = await createdWait;
    assert.equal(createdResponse.status(), 200);
    const created = await createdResponse.json();
    assert.equal(created.code, 0);
    const submittedCreate = createdResponse.request().postDataJSON();
    assert.equal(submittedCreate.mode, 'random');
    assert.equal(submittedCreate.pool_scope, 'public');
    assert.equal(submittedCreate.category_id, null);
    assert.equal(submittedCreate.max_attempts, 3);
    assert.deepEqual(submittedCreate.rules, [{ type: 'single', count: 100, score_cents: 100 }]);
    const paperId = String(created.data.id);
    await expect(create).toBeHidden();
    const actions = page.locator(`.paper-row-actions[data-paper-id="${paperId}"]`);
    await expect(actions.getByText('修改', { exact: true })).toBeVisible();
    await actions.getByText('修改', { exact: true }).click();
    const edit = page.getByRole('dialog', { name: '修改试卷', exact: true });
    await expect(edit).toBeVisible();
    await expect(field(edit, '试卷名称')).toHaveValue(title);
    await expect(countField(edit, 'single')).toHaveValue('100');
    await expect(scoreField(edit, 'single')).toHaveValue('1');
    await expect(field(edit, '最多考试次数')).toHaveValue('3');
    console.log('[public-random-browser] PC edit rules to 80 questions / 100 points and verify saved values');
    await countField(edit, 'single').fill('60');
    await countField(edit, 'multiple').fill('10');
    await scoreField(edit, 'multiple').fill('3');
    await countField(edit, 'judgment').fill('10');
    await scoreField(edit, 'judgment').fill('1');
    await expect(edit.getByTestId('random-rule-summary')).toContainText(/共\s*80\s*道/);
    await expect(edit.getByTestId('random-rule-summary')).toContainText(/分值合计\s*100\s*分/);
    const updatedWait = responseFor(`/admin/papers/${paperId}`, 'PUT');
    await edit.getByRole('button', { name: '保存', exact: true }).click();
    const updatedResponse = await updatedWait;
    assert.equal(updatedResponse.status(), 200);
    assert.equal((await updatedResponse.json()).code, 0);
    const submittedEdit = updatedResponse.request().postDataJSON();
    const rules = [{ type: 'single', count: 60, score_cents: 100 }, { type: 'multiple', count: 10, score_cents: 300 }, { type: 'judgment', count: 10, score_cents: 100 }];
    assert.deepEqual(submittedEdit.rules, rules);
    assert.equal(submittedEdit.pool_scope, 'public');
    assert.equal(submittedEdit.category_id, null);
    await expect(edit).toBeHidden();
    await actions.getByText('修改', { exact: true }).click();
    await expect(edit).toBeVisible();
    for (const [type, count, score] of [['single', '60', '1'], ['multiple', '10', '3'], ['judgment', '10', '1']]) {
      await expect(countField(edit, type)).toHaveValue(count);
      await expect(scoreField(edit, type)).toHaveValue(score);
    }
    await expect(field(edit, '最多考试次数')).toHaveValue('3');
    await edit.getByRole('button', { name: '取消', exact: true }).click();
    await expect(edit).toBeHidden();
    await actions.getByText('发布', { exact: true }).click();
    const confirmation = page.locator('.el-message-box');
    await expect(confirmation).toContainText('发布试卷');
    const publishedWait = responseFor(`/admin/papers/${paperId}/publish`, 'POST');
    await confirmation.getByRole('button', { name: '确定', exact: true }).click();
    const publishedResponse = await publishedWait;
    assert.equal(publishedResponse.status(), 200);
    const published = await publishedResponse.json();
    assert.equal(published.code, 0);
    assert.ok(published.data.release_id);
    await expect(actions.getByText('考试入口二维码', { exact: true })).toBeVisible();
    await actions.getByText('考试入口二维码', { exact: true }).click();
    const qr = page.getByRole('dialog', { name: '考试入口二维码', exact: true });
    await expect(qr).toBeVisible();
    let qrEvidence;
    // A missing public base URL is an expected deployed-build configuration
    // state, not a reason to fabricate a loopback QR or to bypass its UI.
    if (await qr.locator('.el-alert').isVisible()) {
      await expect(qr.locator('.el-alert')).toContainText(/VITE_PUBLIC_H5_BASE_URL|公开地址/);
      await expect(qr.getByRole('button', { name: '下载二维码', exact: true })).toBeDisabled();
      await expect(qr.locator('img[alt="扫码进入考试列表"]')).toHaveCount(0);
      qrEvidence = 'configuration warning shown; download disabled; no loopback QR';
    } else {
      await expect(qr.locator('img[alt="扫码进入考试列表"]')).toBeVisible();
      const entry = await qr.locator('.exam-entry-qr-dialog__url').innerText();
      const parsed = new URL(entry);
      assert.equal(parsed.hash, '#/pages/exam/index');
      assert.equal(parsed.search, '');
      assert.ok(!entry.includes('paper_id') && !entry.includes('token'));
      qrEvidence = 'configured common exam-Tab QR visible; download positive covered separately';
    }
    await qr.getByRole('button', { name: '关闭', exact: true }).click();
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(httpFailures, [], 'PC browser must not encounter background API errors in the self-contained fixture');
    console.log(`[public-random-browser] PC PASS: paper=${paperId}, release=${published.data.release_id}, rules=80/100`);
    return { status: 'PASS', paper_id: paperId, release_id: String(published.data.release_id), title, create_question_count: 100, edited_question_count: 80, total_score: 100, rules, default_max_attempts: 3, saved_rules_reopened: true, actual_ui_create_update_publish: true, qr: qrEvidence, page_errors: pageErrors.length, observed_http_errors: httpFailures };
  } finally { await context.close(); }
}

async function browserMain(input) {
  const require = createRequire(new URL('../../mobile/package.json', import.meta.url));
  const { chromium, expect } = require('@playwright/test');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const stop = () => { void browser.close().finally(() => { process.exitCode = 130; }); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    const pc = await pcPaperFlow(browser, input, expect);
    const origin = new URL(input.baseUrl).origin;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const cookies = input.cookie.split(';').map(value => value.trim()).filter(Boolean).map(pair => {
      const split = pair.indexOf('=');
      assert.ok(split > 0, 'mobile cookie fixture is invalid');
      return { name: pair.slice(0, split), value: pair.slice(split + 1), domain: '127.0.0.1', path: '/api/v1/mobile/auth', httpOnly: true, secure: false, sameSite: 'Lax' };
    });
    await context.addCookies(cookies);
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(30_000);
    const pageErrors = [];
    const requestPaths = [];
    const httpFailures = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', reply => {
      const url = new URL(reply.url());
      if (url.origin === origin && url.pathname.startsWith('/api/v1/') && reply.status() >= 400) {
        httpFailures.push({ path: url.pathname, status: reply.status() });
      }
    });
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/api/v1/')) requestPaths.push({ method: request.method(), path: url.pathname });
    });
    const listWait = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/v1/me/exams' && reply.request().method() === 'GET');
    await page.goto(`${input.baseUrl}/#/pages/exam/index`);
    const listResponse = await listWait;
    assert.equal(listResponse.status(), 200);
    const list = await listResponse.json();
    assert.equal(list.code, 0);
    const summary = list.data.items.find(item => item.paper_id === input.paperId);
    assert.ok(summary, 'real H5 list must include the public paper');
    assert.equal(summary.question_count, 100);
    assert.equal(summary.total_score, 100);
    assert.equal(summary.category_id, null);
    assert.equal(summary.active_record_id, null);
    const pcSummary = list.data.items.find(item => item.paper_id === pc.paper_id);
    assert.ok(pcSummary, 'H5 must show the paper published through the PC UI');
    assert.equal(pcSummary.question_count, 80);
    assert.equal(pcSummary.total_score, 100);
    assert.equal(pcSummary.category_id, null);
    await expect(page.locator('.exam-card').filter({ has: page.getByText(pc.title, { exact: true }) })).toContainText('80 题');
    const card = page.locator('.exam-card').filter({ has: page.getByText(input.title, { exact: true }) });
    await expect(card).toBeVisible();
    await expect(card).toContainText('100 题');
    await expect(card).toContainText('满分 100 分');
    assert.equal(requestPaths.filter(request => request.path.endsWith('/start')).length, 0, 'opening the Tab cannot start an attempt');
    await card.click();
    await expect(page).toHaveURL(new RegExp(`#/pages/exam/instructions\\?paper_id=${input.paperId}`));
    await expect(page.getByText('开始答题', { exact: true })).toBeVisible();
    assert.equal(requestPaths.filter(request => request.path.endsWith('/start')).length, 0, 'opening instructions cannot start an attempt');
    const started = page.waitForResponse(reply => new URL(reply.url()).pathname === `/api/v1/me/exams/${input.paperId}/start` && reply.request().method() === 'POST');
    await page.getByText('开始答题', { exact: true }).click();
    const startResponse = await started;
    assert.equal(startResponse.status(), 200);
    const first = await startResponse.json();
    assert.equal(first.code, 0);
    assert.equal(first.data.questions.length, 100);
    await expect(page).toHaveURL(new RegExp(`#/pages/exam/take\\?record_id=${first.data.record_id}`));
    await expect(page.locator('.take-footer__card')).toContainText('0/100');
    await expect(page.locator('.option-card').first()).toBeVisible();
    await page.locator('.option-card').first().click();
    await expect(page.locator('.option-card').first()).toHaveAttribute('aria-checked', 'true');
    const recoveredWait = page.waitForResponse(reply => new URL(reply.url()).pathname === `/api/v1/me/exam-records/${first.data.record_id}` && reply.request().method() === 'GET');
    await page.reload();
    const recoveredResponse = await recoveredWait;
    assert.equal(recoveredResponse.status(), 200);
    const recovered = await recoveredResponse.json();
    assert.equal(recovered.code, 0);
    for (const field of ['record_id', 'release_id', 'paper_id', 'questions', 'deadline_at']) {
      assert.deepEqual(recovered.data[field], first.data[field], `browser refresh must preserve ${field}`);
    }
    await expect(page.locator('.option-card').first()).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.take-footer__card')).toContainText('1/100');
    assert.deepEqual(pageErrors, [], 'H5 must not have uncaught page errors');
    assert.deepEqual(httpFailures, [], 'H5 browser must not encounter background API errors');
    assert.equal(requestPaths.filter(request => request.path.endsWith('/start')).length, 1);
    assert.ok(!requestPaths.some(request => /\/(draft|heartbeat|submit)$/.test(request.path)), 'browser recovery must not submit or save drafts to the server');
    process.send?.({ type: 'public-random-browser-result', evidence: {
      status: 'PASS', channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
      viewport: '390x844', public_paper_visible: true, list_question_count: 100,
      start_requests: 1, refresh_preserved_record_order_deadline: true, local_draft_restored: true,
      content_schema_version: first.data.questions[0].content_schema_version || 2,
      mock_exam_api: false, page_errors: pageErrors.length, observed_http_errors: httpFailures, pc: { ...pc, h5_list_synchronized: true }, attempt: first.data,
    } });
    await context.close();
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await browser.close();
  }
}

if (process.argv.includes('--public-random-browser-child')) {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    await browserMain(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    console.error(`[public-random-browser] ${error.message}`);
    process.exitCode = 1;
  }
}
