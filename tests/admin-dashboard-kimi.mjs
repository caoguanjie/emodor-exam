// Interactive acceptance environment; all browser actions go through the Kimi extension.
// Usage: node tests/admin-dashboard-kimi.mjs --ephemeral
// stdin accepts JSON commands. Credentials stay in this process and are never printed or saved.
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { runSuiteInRuntime, SUITE_REGISTRY } from './run-e2e.mjs';
import { seedAdminDashboardFixture, completeDashboardExam, dashboardRequest } from './support/admin-dashboard-fixtures.mjs';
import { startAdminDashboardBrowserServer } from './support/admin-dashboard-browser-harness.mjs';

const SESSION = 'ruleexam-dashboard-implementation';
async function kimi(action, args) {
  const response = await fetch('http://127.0.0.1:10086/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args, session: SESSION }),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(`Kimi ${action} failed`);
  return body.data;
}

export async function run(ctx) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_[A-Za-z0-9_]+$/);
  const fixture = await seedAdminDashboardFixture(ctx);
  const ui = await startAdminDashboardBrowserServer(ctx);
  const readline = createInterface({ input: process.stdin, terminal: false });
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const onSignal = () => finish();
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  console.log(JSON.stringify({ event: 'kimi-ready', url: `${ui.baseUrl}/login`, database: ctx.env.DB_DATABASE,
    session: SESSION, paperId: fixture.openPaper.id, learningPaperId: fixture.learningPaper.id,
    emptyPaperId: fixture.emptyPaper.id, archivedPaperId: fixture.archivedPaper.id, expected: fixture.expected }));
  let queue = Promise.resolve();
  async function command(input) {
    if (input.action === 'finish') { finish(); return; }
    if (input.action === 'login') {
      const account = input.account === 'stats' ? fixture.statsOnly : input.account === 'students' ? fixture.studentsOnly
        : { username: 'admin', password: fixture.adminPassword };
      // Read the visible CAPTCHA image from our own test server without exposing the answer.
      const result = await kimi('evaluate', { code: '(() => document.querySelector("img[alt=验证码]")?.src || "")()' });
      const src = result.value;
      if (typeof src !== 'string' || !src.startsWith('data:image/svg+xml')) throw new Error('test login CAPTCHA image unavailable');
      const svg = src.includes(';base64,') ? Buffer.from(src.split(',')[1], 'base64').toString('utf8') : decodeURIComponent(src.slice(src.indexOf(',') + 1));
      const answer = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match => match[1]).join('');
      if (!/^[A-Za-z0-9]{4}$/.test(answer)) throw new Error('test login CAPTCHA format unavailable');
      for (const [selector, value] of [[input.username, account.username], [input.password, account.password], [input.captcha, answer]]) {
        if (typeof selector !== 'string' || !selector) throw new Error('login requires observed Kimi element references');
        await kimi('fill', { selector, value });
      }
      await kimi('click', { selector: input.submit });
      console.log(JSON.stringify({ event: 'kimi-login-submitted', account: input.account || 'admin' }));
      return;
    }
    if (input.action === 'submit-exam') {
      console.log(JSON.stringify({ event: 'real-exam-submitted', ...await completeDashboardExam(ctx, fixture) })); return;
    }
    if (input.action === 'facts') {
      const overview = await dashboardRequest(ctx, fixture.admin, 'GET', '/admin/dashboard');
      const learning = await ctx.request(fixture.admin, 'GET', `/admin/dashboard/learning-summary?paper_id=${fixture.learningPaper.id}&release_id=${fixture.learningPaper.releaseId}`);
      const recent = await dashboardRequest(ctx, fixture.admin, 'GET', '/admin/dashboard/recent-exams');
      console.log(JSON.stringify({ event: 'facts', overview, learning: { code: learning.code, data: learning.data }, recent })); return;
    }
    if (['withdraw-learning', 'clear-candidates', 'restore-learning'].includes(input.action)) {
      const ids = input.action === 'withdraw-learning' ? [fixture.learningPaper.id] : [fixture.learningPaper.id, fixture.emptyPaper.id];
      for (const id of ids) await ctx.queryTestDb('UPDATE exam_paper SET status=? WHERE id=?', [input.action === 'restore-learning' ? 'published' : 'withdrawn', id]);
      console.log(JSON.stringify({ event: input.action, paperIds: ids })); return;
    }
    if (input.action === 'zero-achievement' || input.action === 'restore-achievement') {
      for (const [i, learner] of fixture.learners.entries()) {
        await ctx.queryTestDb('UPDATE video_learning_record SET credited_ms=? WHERE user_id=? AND lesson_version_id=?',
          [input.action === 'zero-achievement' ? 0 : [0,119999,120000,120001][i], learner.id, fixture.course.versionId]);
      }
      console.log(JSON.stringify({ event: input.action })); return;
    }
    if (input.action === 'revoke-statistics') {
      await dashboardRequest(ctx, fixture.admin, 'PUT', `/admin/roles/${fixture.statsOnly.roleId}`, { name: '学员只读管理员', permissions: ['students:read'] });
      console.log(JSON.stringify({ event: 'statistics-revoked' })); return;
    }
    throw new Error('unknown acceptance command');
  }
  readline.on('line', line => {
    queue = queue.then(() => command(JSON.parse(line))).catch(error => console.log(JSON.stringify({ event: 'command-error', message: error.message })));
  });
  try { await finished; await queue; }
  finally {
    readline.close(); process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    await ui.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.slice(2).join(' ') !== '--ephemeral') throw new Error('Kimi acceptance requires --ephemeral');
  await runSuiteInRuntime(SUITE_REGISTRY['admin-dashboard'], true, { interrupted: false }, { suiteModule: { run } });
}
