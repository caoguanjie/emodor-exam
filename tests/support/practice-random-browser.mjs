import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startMobileServer } from './public-random-browser.mjs';
import { fixtureAnswerSheet } from './public-random-question-fixture.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = join(ROOT, '.superpowers/practice-exam/screenshots');

export async function runPracticeRandomBrowser(ctx, { admin, actor, formalId, paperId, title, fixture }) {
  assert.ok(process.argv.includes('--ephemeral'));
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_[a-f0-9]{12}$/);
  const principal = await ctx.request(admin, 'GET', '/auth/profile');
  assert.equal(principal.status, 200);
  const server = await startMobileServer(ctx);
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--practice-browser-child'], {
        cwd: ROOT, env: { ...process.env, PLAYWRIGHT_CHANNEL: process.env.PLAYWRIGHT_CHANNEL || 'chrome' },
        stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
      });
      ctx.trackChild(child);
      let evidence;
      child.on('message', message => { if (message?.type === 'practice-browser-result') evidence = message.evidence; });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 && evidence ? resolve(evidence) : reject(new Error(`practice browser failed: ${code ?? signal}`)));
      child.stdin.on('error', reject);
      // Owned runtime credentials only travel through this pipe, never argv/logs.
      child.stdin.end(JSON.stringify({ baseUrl: server.baseUrl, cookie: actor.cookie, admin: { token: admin.accessToken, user: principal.data }, formalId, paperId, title, questions: fixture.questions }));
    });
  } finally {
    await new Promise(resolve => { server.server.close(resolve); server.server.closeIdleConnections(); });
  }
}

async function browserMain(input) {
  const require = createRequire(new URL('../../mobile/package.json', import.meta.url));
  const { chromium, expect } = require('@playwright/test');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const origin = new URL(input.baseUrl).origin;
  const pageErrors = [];
  await mkdir(SHOTS, { recursive: true });
  try {
    const pcContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await pcContext.addInitScript(({ origin, token, user }) => {
      if (location.origin !== origin) return;
      sessionStorage.setItem('re_token', token);
      sessionStorage.setItem('re_user', JSON.stringify(user));
      sessionStorage.setItem('re_pwd_pending', '0');
    }, { origin, token: input.admin.token, user: input.admin.user });
    const pc = await pcContext.newPage();
    pc.setDefaultTimeout(20000);
    pc.on('pageerror', error => pageErrors.push(error.message));
    const writes = [];
    pc.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/v1/admin/papers')) writes.push(new URL(request.url()).pathname); });
    const responseFor = (page, path, method) => page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === method);
    await pc.goto(`${origin}/admin/papers`);
    const sourceActions = pc.locator(`.paper-row-actions[data-paper-id="${input.formalId}"]`);
    await sourceActions.getByText('创建模拟卷', { exact: true }).click();
    const dialog = pc.getByRole('dialog', { name: '新增试卷', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('不限次数');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog).toBeHidden();
    assert.deepEqual(writes, [], 'cancel template cannot create/publish a paper');
    await sourceActions.getByText('创建模拟卷', { exact: true }).click();
    await expect(dialog).toBeVisible();
    const nameField = dialog.locator('.el-form-item').filter({ has: pc.locator('.el-form-item__label').filter({ hasText: /^\s*试卷名称\s*$/ }) }).locator('input').first();
    const pcTitle = `${input.title}-PC模拟`;
    await nameField.fill(pcTitle);
    for (const [type, count] of [['single', '30'], ['multiple', '10'], ['judgment', '10']]) {
      const row = dialog.locator(`[data-rule-type="${type}"]`);
      await row.getByRole('spinbutton').nth(0).fill(count);
      await row.getByRole('spinbutton').nth(1).fill('2');
    }
    await expect(dialog.getByTestId('random-rule-summary')).toContainText(/共\s*50\s*道/);
    await expect(dialog).toHaveCSS('opacity', '1');
    await pc.screenshot({ path: join(SHOTS, 'pc-practice-create.png'), fullPage: false, animations: 'disabled' });
    const createdWait = responseFor(pc, '/admin/papers', 'POST');
    await dialog.getByRole('button', { name: '保存草稿', exact: true }).click();
    const createdReply = await createdWait;
    assert.equal(createdReply.status(), 200);
    const created = await createdReply.json();
    assert.equal(created.code, 0);
    const body = createdReply.request().postDataJSON();
    assert.equal(body.exam_purpose, 'practice');
    assert.equal(body.max_attempts, null);
    assert.equal(body.rules.reduce((sum, rule) => sum + rule.count, 0), 50);
    assert.equal(writes.length, 1);
    const pcPaper = String(created.data.id);
    const actions = pc.locator(`.paper-row-actions[data-paper-id="${pcPaper}"]`);
    await actions.getByText('修改', { exact: true }).click();
    const edit = pc.getByRole('dialog', { name: '修改试卷', exact: true });
    await expect(edit).toContainText('不限次数');
    await expect(edit.getByTestId('random-rule-summary')).toContainText(/共\s*50\s*道/);
    await edit.getByRole('button', { name: '取消', exact: true }).click();
    await actions.getByText('发布', { exact: true }).click();
    const publishWait = responseFor(pc, `/admin/papers/${pcPaper}/publish`, 'POST');
    await pc.locator('.el-message-box').getByRole('button', { name: '确定', exact: true }).click();
    assert.equal((await publishWait).status(), 200);
    await expect(pc.locator('.el-message-box')).toBeHidden();
    await pc.screenshot({ path: join(SHOTS, 'pc-practice-list.png'), fullPage: false, animations: 'disabled' });

    const h5Context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await h5Context.addCookies(input.cookie.split(';').map(value => value.trim()).filter(Boolean).map(pair => {
      const split = pair.indexOf('=');
      return { name: pair.slice(0, split), value: pair.slice(split + 1), domain: '127.0.0.1', path: '/api/v1/mobile/auth', httpOnly: true, secure: false, sameSite: 'Lax' };
    }));
    const page = await h5Context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => pageErrors.push(error.message));
    const starts = [];
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/start')) starts.push(request.postDataJSON()); });
    await page.goto(`${input.baseUrl}/#/pages/exam/index`);
    await expect(page.getByText(pcTitle, { exact: true })).toBeVisible();
    const card = page.locator('.exam-card').filter({ has: page.getByText(input.title, { exact: true }) });
    await expect(card).toContainText('不限次数');
    await card.click();
    await expect(page).toHaveURL(new RegExp(`instructions\\?paper_id=${input.paperId}`));
    await expect(page.getByText('开始答题', { exact: true })).toBeVisible();
    assert.equal(starts.length, 0);
    const adminCall = async (method, path, data) => {
      const response = await pc.request.fetch(`${origin}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${input.admin.token}` }, ...(data ? { data } : {}) });
      assert.equal(response.status(), 200, `browser setup ${path}`);
      return (await response.json()).data;
    };
    await adminCall('POST', `/admin/papers/${input.paperId}/withdraw`);
    await adminCall('PUT', `/admin/papers/${input.paperId}`, { duration_minutes: 16 });
    const changed = await adminCall('POST', `/admin/papers/${input.paperId}/publish`);
    const staleWait = responseFor(page, `/me/exams/${input.paperId}/start`, 'POST');
    await page.getByText('开始答题', { exact: true }).click();
    const stale = await staleWait;
    assert.equal((await stale.json()).code, 40970);
    await expect(page).toHaveURL(/instructions/);
    await expect(page.locator('.paper-stat__number').first()).toHaveText('16');
    assert.equal(starts.length, 1, 'stale instructions must not retry automatically');
    const firstWait = responseFor(page, `/me/exams/${input.paperId}/start`, 'POST');
    await page.getByText('开始答题', { exact: true }).click();
    const firstReply = await firstWait;
    assert.equal(firstReply.status(), 200);
    const first = (await firstReply.json()).data;
    assert.equal(first.release_id, String(changed.release_id));
    assert.equal(first.exam_purpose, 'practice');
    assert.equal(first.questions.length, 100);
    const oracle = { answersByToken: new Map(input.questions.map(question => [question.token, question])) };
    const wrong = fixtureAnswerSheet(first, oracle, 'wrong').answers[0];
    const displayIndex = first.questions[0].options.findIndex(option => option.id === wrong.option_ids[0]);
    await expect(page.locator('.option-card').nth(displayIndex)).toBeVisible();
    await page.locator('.option-card').nth(displayIndex).click();
    const recoveredWait = responseFor(page, `/me/exam-records/${first.record_id}`, 'GET');
    await page.reload();
    const recovered = (await (await recoveredWait).json()).data;
    for (const field of ['record_id', 'release_id', 'questions', 'deadline_at']) assert.deepEqual(recovered[field], first[field]);
    await expect(page.locator('.option-card').nth(displayIndex)).toHaveAttribute('aria-checked', 'true');
    const submittedWait = responseFor(page, `/me/exam-records/${first.record_id}/submit`, 'POST');
    await page.getByRole('button', { name: '交卷', exact: true }).click();
    await page.getByText('确定交卷', { exact: true }).click();
    const submitted = await submittedWait;
    assert.equal(submitted.status(), 200);
    assert.equal((await submitted.json()).data.score, 0);
    await expect(page).toHaveURL(/\/result\?/);
    await expect(page.getByText('再考一次', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'h5-practice-result.png'), fullPage: false, animations: 'disabled' });
    await page.getByText('再考一次', { exact: true }).click();
    await expect(page).toHaveURL(/instructions/);
    await expect(page.getByText('开始答题', { exact: true })).toBeVisible();
    assert.equal(starts.length, 2, 'retry button only navigates to instructions');
    await page.goto(`${input.baseUrl}/#/pages/profile/wrong-book`);
    await expect(page.locator('.wrong-card').first()).toContainText('模拟考');
    await expect(page.locator('.wrong-card').first()).toContainText(input.title);
    await page.screenshot({ path: join(SHOTS, 'h5-practice-wrong-book.png'), fullPage: false, animations: 'disabled' });
    assert.deepEqual(pageErrors, []);
    const bodyWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(bodyWidth.scroll <= bodyWidth.viewport + 1, 'H5 should not horizontally overflow');
    process.send?.({ type: 'practice-browser-result', evidence: {
      status: 'PASS', channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', real_exam_api: true,
      pc_cancel_zero_writes: true, pc_create_50_publish: true, h5_list_synchronized: true,
      stale_release_reconfirm: true, refreshed_draft_and_record: true,
      submitted_score: 0, retry_does_not_start: true, wrong_book_practice_source: true,
      page_errors: 0, screenshots: ['pc-practice-create.png', 'pc-practice-list.png', 'h5-practice-result.png', 'h5-practice-wrong-book.png'],
    } });
    await h5Context.close();
    await pcContext.close();
  } finally { await browser.close(); }
}

if (process.argv.includes('--practice-browser-child')) {
  try {
    const parts = [];
    for await (const part of process.stdin) parts.push(part);
    await browserMain(JSON.parse(Buffer.concat(parts).toString('utf8')));
  } catch (error) {
    console.error(`[practice-browser] ${error.message}`);
    process.exitCode = 1;
  }
}
