import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './training-access.mjs';
import { debugLearner, materials } from './mobile-identity.mjs';
import { assertAttemptView, assertPureTimeout, assertTimeoutFacts } from './support/exam-mobile-fixtures.mjs';
import {
  PUBLIC_RANDOM_RULES_100, PUBLIC_RANDOM_RULES_80, publicRandomQuestionFixture,
  questionImportMultipart, fixtureQuestion, fixtureAnswerSheet,
} from './support/public-random-question-fixture.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');
const mysql = require('mysql2/promise');

// This suite intentionally cannot use run-e2e's non-ephemeral mode. Perform all
// checks before opening Redis, MySQL or HTTP connections, including on failure.
export function assertOwnedEphemeralRuntime(ctx) {
  assert.ok(process.argv.includes('--ephemeral'), 'public-random-exam requires --ephemeral');
  const env = ctx.env || {};
  assert.match(String(env.DB_DATABASE || ''), /^ruleexam_test_[a-f0-9]{12}$/);
  assert.match(String(env.REDIS_KEY_PREFIX || ''), /^e2e:[a-f0-9]{20}:$/);
  for (const key of ['DB_HOST', 'REDIS_HOST']) assert.equal(env[key], '127.0.0.1', `${key} must be harness-owned loopback`);
  for (const [key, forbidden] of [['DB_PORT', 3306], ['REDIS_PORT', 6379], ['API_PORT', 3000]]) {
    const port = Number(env[key]);
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535 && port !== forbidden, `${key} must be an ephemeral port`);
  }
  for (const key of ['DB_USERNAME', 'DB_PASSWORD', 'JWT_SECRET', 'ADMIN_INITIAL_PASSWORD']) {
    assert.ok(typeof env[key] === 'string' && env[key].length > 0, `${key} must be supplied by the runtime`);
  }
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.SERVER_DEBUG_LOGIN_ENABLED, 'true');
  assert.equal(env.SMS_PROVIDER, 'disabled');
  assert.equal(env.IDENTITY_PROVIDER, 'disabled');
  assert.equal(env.MOCK_AI_PORT_MODE, 'ephemeral');
  const api = new URL(ctx.baseUrl);
  assert.equal(api.protocol, 'http:');
  assert.equal(api.hostname, '127.0.0.1');
  assert.equal(Number(api.port), Number(env.API_PORT));
  assert.equal(api.pathname, '/api/v1');
  assert.equal(api.username + api.password + api.search + api.hash, '');
  assert.equal(typeof ctx.request, 'function');
  assert.equal(typeof ctx.queryTestDb, 'function');
}

function ok(reply, label) {
  assert.equal(reply.status, 200, `${label}: HTTP ${reply.status}, code ${reply.code}`);
  return reply.data;
}

const parsed = value => typeof value === 'string' ? JSON.parse(value) : value;

export async function adminLogin(ctx) {
  const headers = { 'X-Forwarded-For': '198.51.100.218' };
  const captcha = ok(await ctx.request(null, 'POST', '/auth/captcha', undefined, headers), 'admin captcha');
  const redis = new Redis({ host: ctx.env.REDIS_HOST, port: Number(ctx.env.REDIS_PORT), password: ctx.env.REDIS_PASSWORD || undefined });
  let code;
  try { code = await redis.get(`${ctx.env.REDIS_KEY_PREFIX}auth:captcha:${captcha.captcha_id}`); }
  finally { await redis.quit(); }
  assert.ok(code, 'owned captcha must exist');
  const actor = {};
  const login = ok(await ctx.request(actor, 'POST', '/auth/login', {
    username: 'admin', password: ctx.adminPassword, captcha_id: captcha.captcha_id, captcha_code: code,
  }, headers), 'admin login');
  actor.accessToken = login.access_token;
  if (login.force_change_password) {
    const changed = ok(await ctx.request(actor, 'PUT', '/auth/password', {
      old_password: ctx.adminPassword, new_password: randomStrongPassword('admin', '公共随机卷验收'),
    }), 'admin password change');
    actor.accessToken = changed.access_token;
  }
  return actor;
}

export async function learner(ctx, source) {
  const actor = await debugLearner(ctx);
  // Durable source is fixture data; the mobile login/session and identity fact
  // are real API flows with only the external identity provider overridden.
  await ctx.queryTestDb('UPDATE sys_user SET source=?,category_id=NULL WHERE id=?', [source, actor.userId]);
  ok(await ctx.request(actor, 'POST', '/me/profile', { real_name: '合成随机考试学员' }), 'blank-category profile');
  // Red faces deliberately mean rejection in FakeIdentityProvider. Randomize
  // only the portrait (identity uniqueness), retaining its known passing face.
  const input = await materials(ctx, actor, `#${randomBytes(3).toString('hex')}`, '#25814f');
  const identity = ok(await ctx.request(actor, 'POST', '/me/identity-verification/sessions', input), 'blank-category synthetic identity');
  assert.equal(identity.status, 'verified');
  const [user] = await ctx.queryTestDb('SELECT category_id,source,role FROM sys_user WHERE id=?', [actor.userId]);
  assert.equal(user.category_id, null);
  assert.equal(user.source, source);
  assert.equal(user.role, 'employee');
  return actor;
}

async function withInsertFailure(ctx, table, action) {
  assert.ok(['question_version', 'exam_record_question', 'exam_answer'].includes(table));
  const db = await mysql.createConnection({
    host: ctx.env.DB_HOST, port: Number(ctx.env.DB_PORT), user: ctx.env.DB_USERNAME,
    password: ctx.env.DB_PASSWORD, database: ctx.env.DB_DATABASE,
  });
  const trigger = `prx_failure_${randomBytes(6).toString('hex')}`;
  try {
    await db.query(`CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`${table}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic public random rollback'`);
    try { await action(); }
    finally { await db.query(`DROP TRIGGER \`${trigger}\``); }
  } finally { await db.end(); }
}

async function count(ctx, table, where = '', params = []) {
  assert.ok(['question', 'question_version', 'paper_release', 'paper_release_question', 'exam_assignment', 'exam_record', 'exam_record_question', 'exam_answer'].includes(table));
  const [row] = await ctx.queryTestDb(`SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`, params);
  return Number(row.n);
}

export async function importQuestions(ctx, admin, fixture, categoryIds, report) {
  assert.equal(await count(ctx, 'question'), 0, 'isolated bank must begin empty');
  const importedIds = new Set();
  for (const [index, batch] of fixture.batches.entries()) {
    const upload = questionImportMultipart(categoryIds[batch.categoryIndex], batch.questions);
    const preview = ok(await ctx.request(admin, 'POST', '/admin/questions/import-preview', upload.body, upload.headers), 'question import preview');
    assert.deepEqual(preview.errors, []);
    assert.deepEqual(preview.duplicates, []);
    assert.equal(preview.valid_rows.length, 250);
    assert.equal(preview.rows.length, 250);
    assert.ok(preview.rows.every(row => row.difficulty === batch.difficulty && String(row.category) === categoryIds[batch.categoryIndex]));
    const body = { row_numbers: preview.valid_rows };
    const path = `/admin/questions/import-batches/${preview.batch_id}/commit`;
    if (index === 0) {
      await withInsertFailure(ctx, 'question_version', async () => {
        const failed = await ctx.request(admin, 'POST', path, body);
        assert.equal(failed.status, 500, 'injected import write failure must reach the transaction');
        assert.equal(await count(ctx, 'question'), 0, 'failed import cannot leave bank rows');
        assert.equal(await count(ctx, 'question_version'), 0, 'failed import cannot leave versions');
      });
    }
    const committed = ok(await ctx.request(admin, 'POST', path, body), 'question import commit');
    assert.equal(committed.created_ids.length, 250);
    assert.equal(committed.enabled, true);
    for (const id of committed.created_ids) {
      assert.ok(!importedIds.has(String(id)), 'imports must create unique questions');
      importedIds.add(String(id));
    }
    const retried = ok(await ctx.request(admin, 'POST', path, body), 'idempotent import commit');
    assert.deepEqual(retried.created_ids, committed.created_ids);
    assert.equal(await count(ctx, 'question'), (index + 1) * 250);
    report.imports.push({ category: batch.categoryIndex + 1, difficulty: batch.difficulty, preview: 250, committed: 250, retry_added: 0 });
    console.log(`[public-random-exam] imported ${(index + 1) * 250}/1000; retry added 0`);
  }
  assert.equal(importedIds.size, 1000);
  assert.equal(await count(ctx, 'question'), 1000);
  assert.equal(await count(ctx, 'question_version'), 1000);
  const distribution = await ctx.queryTestDb(
    'SELECT category_id,difficulty,type,COUNT(*) AS n FROM question GROUP BY category_id,difficulty,type ORDER BY category_id,difficulty,type',
  );
  assert.equal(distribution.length, 12);
  for (const row of distribution) {
    assert.ok(categoryIds.includes(String(row.category_id)));
    assert.ok(['easy', 'hard'].includes(row.difficulty));
    assert.equal(Number(row.n), row.type === 'single' ? 150 : 50);
  }
  const [valid] = await ctx.queryTestDb(
    `SELECT COUNT(*) AS n FROM question q JOIN question_version v ON v.id=q.current_version_id
     WHERE q.is_enabled=1 AND q.deleted_at IS NULL AND q.status='approved' AND v.status='approved'
       AND v.question_id=q.id AND v.type=q.type AND v.difficulty=q.difficulty AND v.category_id=q.category_id`,
  );
  assert.equal(Number(valid.n), 1000, 'all imported rows must have usable current versions');
}

async function createPaper(ctx, admin, title, rules, extra = {}) {
  const data = ok(await ctx.request(admin, 'POST', '/admin/papers', {
    title, mode: 'random', pool_scope: 'public', category_id: null,
    total_score: 100, pass_score: 60, duration_minutes: 30, max_attempts: 3,
    partial_credit_ratio: 0.5, regulation_ids: [], course_ids: [], rules, ...extra,
  }), 'public random paper create');
  const paperId = String(data.id);
  const [stored] = await ctx.queryTestDb('SELECT pool_scope,category_id,mode,status FROM exam_paper WHERE id=?', [paperId]);
  assert.deepEqual(stored, { pool_scope: 'public', category_id: null, mode: 'random', status: 'draft' });
  return paperId;
}

async function publish(ctx, admin, paperId, expectedPoolSize = 1000) {
  const data = ok(await ctx.request(admin, 'POST', `/admin/papers/${paperId}/publish`), 'public random publish');
  const releaseId = String(data.release_id);
  const [release] = await ctx.queryTestDb('SELECT pool_scope,category_id,rule_snapshot FROM paper_release WHERE id=? AND paper_id=?', [releaseId, paperId]);
  assert.equal(release.pool_scope, 'public');
  assert.equal(release.category_id, null);
  assert.equal(parsed(release.rule_snapshot).totalCents, 10000);
  const pool = await ctx.queryTestDb('SELECT question_id,type,difficulty,snapshot_json FROM paper_release_question WHERE release_id=? ORDER BY position', [releaseId]);
  assert.equal(pool.length, expectedPoolSize);
  assert.equal(new Set(pool.map(row => String(row.question_id))).size, expectedPoolSize);
  assert.equal(new Set(pool.map(row => String(parsed(row.snapshot_json).categoryId))).size, 2);
  assert.deepEqual([...new Set(pool.map(row => row.difficulty))].sort(), ['easy', 'hard']);
  return releaseId;
}

export function assertNoSecrets(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['answer', 'answers', 'analysis', 'correct_option_ids', 'snapshot_json', 'snapshotJson', 'display_to_original', 'displayToOriginal', 'pool', 'candidates'].includes(key), `learner API leaked ${key}`);
    assertNoSecrets(child);
  }
  assert.ok(!JSON.stringify(value).includes('PRIVATE_ANALYSIS_'), 'learner API leaked synthetic analysis');
}

async function inspectAttempt(ctx, actor, view, fixture, rules, difficulty, attemptNo, releaseId, report) {
  if (view.questions.some(item => Object.hasOwn(item, 'content_schema_version'))) {
    // H5 advertises v3 capability; attemptQuestionView still marks these TXT
    // imports with their actual v2 schema. The older default API omits the
    // marker. Keep the existing strict v2 projection checks in both cases.
    assert.ok(view.questions.every(item => item.content_schema_version === 2));
    assertAttemptView({ ...view, questions: view.questions.map(({ content_schema_version: _schema, ...item }) => item) });
  } else assertAttemptView(view);
  assertNoSecrets(view);
  assert.equal(view.release_id, releaseId);
  const expectedCount = rules.reduce((sum, rule) => sum + rule.count, 0);
  assert.equal(view.questions.length, expectedCount);
  assert.equal(new Set(view.questions.map(item => item.item_id)).size, expectedCount);
  assert.equal(view.questions.reduce((sum, item) => sum + Math.round(item.score * 100), 0), 10000);
  const selected = view.questions.map(item => fixtureQuestion(item, fixture));
  assert.equal(new Set(selected.map(question => question.token)).size, expectedCount);
  assert.ok(selected.every(question => question.difficulty === difficulty));
  assert.equal(new Set(selected.map(question => question.categoryIndex)).size, 2);
  for (const rule of rules) {
    const items = view.questions.filter(item => item.type === rule.type);
    assert.equal(items.length, rule.count);
    assert.ok(items.every(item => Math.round(item.score * 100) === rule.score_cents));
  }
  const exposed = JSON.stringify(view);
  const selectedTokens = new Set(selected.map(question => question.token));
  for (const question of fixture.questions) {
    if (!selectedTokens.has(question.token)) assert.ok(!exposed.includes(question.token), 'learner received an unselected pool question');
  }
  const [record] = await ctx.queryTestDb('SELECT user_id,paper_id,assignment_id,release_id,source,category_id,difficulty,attempt_no,rule_snapshot FROM exam_record WHERE id=?', [view.record_id]);
  assert.equal(String(record.user_id), actor.userId);
  assert.equal(String(record.paper_id), view.paper_id);
  assert.equal(String(record.release_id), releaseId);
  assert.equal(record.category_id, null);
  assert.equal(record.source, difficulty === 'easy' ? 'institution' : 'external');
  assert.equal(record.difficulty, difficulty);
  assert.equal(Number(record.attempt_no), attemptNo);
  assert.equal(parsed(record.rule_snapshot).maxAttempts, 3);
  const rows = await ctx.queryTestDb('SELECT id,question_id,type,difficulty,score_cents,snapshot_json FROM exam_record_question WHERE record_id=? ORDER BY position', [view.record_id]);
  assert.equal(rows.length, expectedCount);
  assert.deepEqual(rows.map(row => String(row.id)), view.questions.map(item => item.item_id));
  assert.equal(new Set(rows.map(row => String(row.question_id))).size, expectedCount);
  assert.ok(rows.every(row => row.difficulty === difficulty));
  assert.equal(rows.reduce((sum, row) => sum + Number(row.score_cents), 0), 10000);
  const [assignment] = await ctx.queryTestDb('SELECT category_id,release_id,source,difficulty,rule_snapshot FROM exam_assignment WHERE id=?', [record.assignment_id]);
  assert.equal(assignment.category_id, null);
  assert.equal(String(assignment.release_id), releaseId);
  assert.equal(assignment.source, record.source);
  assert.equal(assignment.difficulty, difficulty);
  assert.deepEqual(parsed(assignment.rule_snapshot), parsed(record.rule_snapshot));
  report.attempts.push({ paper_id: view.paper_id, release_id: releaseId, record_id: view.record_id, attempt: attemptNo, difficulty, questions: expectedCount, total_score: 100 });
}

function sameAttempt(actual, expected) {
  for (const key of ['record_id', 'release_id', 'paper_id', 'deadline_at', 'questions']) {
    assert.deepEqual(actual[key], expected[key], `recovery must preserve ${key}`);
  }
}

async function checkRecovery(ctx, actor, attempt) {
  const replies = await Promise.all([
    ctx.request(actor, 'POST', `/me/exams/${attempt.paper_id}/start`),
    ctx.request(actor, 'POST', `/me/exams/${attempt.paper_id}/start`),
    ctx.request(actor, 'GET', `/me/exam-records/${attempt.record_id}`),
  ]);
  for (const reply of replies) sameAttempt(ok(reply, 'concurrent start/refresh recovery'), attempt);
  assert.equal(await count(ctx, 'exam_record', 'paper_id=? AND user_id=?', [attempt.paper_id, actor.userId]), 1);
}

async function submit(ctx, actor, attempt, fixture, mode, expectedScore, report) {
  const body = fixtureAnswerSheet(attempt, fixture, mode);
  const path = `/me/exam-records/${attempt.record_id}/submit`;
  const result = ok(await ctx.request(actor, 'POST', path, body), 'whole-paper submit');
  assert.equal(result.record_id, attempt.record_id);
  assert.equal(result.score, expectedScore);
  assert.equal(result.passed, expectedScore >= 60);
  assert.equal(result.grading_state, 'finalized');
  assert.ok(result.submitted_at);
  const again = ok(await ctx.request(actor, 'POST', path, body), 'idempotent submit');
  assert.deepEqual(again, result);
  const [stored] = await ctx.queryTestDb('SELECT score,status,grading_state,submitted_at,graded_at FROM exam_record WHERE id=?', [attempt.record_id]);
  assert.equal(Number(stored.score), expectedScore);
  assert.equal(stored.status, expectedScore >= 60 ? 'passed' : 'failed');
  assert.equal(stored.grading_state, 'finalized');
  assert.ok(stored.submitted_at && stored.graded_at);
  const [answers] = await ctx.queryTestDb('SELECT COUNT(*) AS n,COUNT(DISTINCT record_question_id) AS distinct_n,SUM(gained_score) AS score FROM exam_answer WHERE exam_record_id=?', [attempt.record_id]);
  assert.equal(Number(answers.n), attempt.questions.length);
  assert.equal(Number(answers.distinct_n), attempt.questions.length);
  assert.equal(Number(answers.score), expectedScore);
  const reviewed = ok(await ctx.request(actor, 'GET', `/me/exam-records/${attempt.record_id}/result`), 'frozen result');
  assert.equal(reviewed.score, expectedScore);
  assert.equal(reviewed.total_score, 100);
  report.scores.push({ record_id: attempt.record_id, mode, expected: expectedScore, actual: result.score, retry: 'same result' });
  return reviewed;
}

async function assertNoAttempt(ctx, actor, paperId) {
  assert.equal(await count(ctx, 'exam_assignment', 'paper_id=? AND user_id=?', [paperId, actor.userId]), 0);
  assert.equal(await count(ctx, 'exam_record', 'paper_id=? AND user_id=?', [paperId, actor.userId]), 0);
  const [orphans] = await ctx.queryTestDb('SELECT COUNT(*) AS n FROM exam_record_question q LEFT JOIN exam_record r ON r.id=q.record_id WHERE r.id IS NULL');
  assert.equal(Number(orphans.n), 0);
}

async function assertDeficit(ctx, admin, title, rules, expected) {
  const paperId = await createPaper(ctx, admin, title, rules, { total_score: rules.reduce((sum, rule) => sum + rule.count * rule.score_cents, 0) / 100 });
  const failed = await ctx.request(admin, 'POST', `/admin/papers/${paperId}/publish`);
  assert.equal(failed.status, 409);
  assert.equal(failed.code, 40971);
  const deficits = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'available') && Object.hasOwn(value, 'required')) deficits.push(value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(failed.data);
  assert.ok(deficits.some(item => item.type === expected.type && item.difficulty === expected.difficulty
    && Number(item.required) === expected.required && Number(item.available) === expected.available), 'publish must report the exact difficulty/type deficit');
  assert.equal(await count(ctx, 'paper_release', 'paper_id=?', [paperId]), 0);
  const [paper] = await ctx.queryTestDb('SELECT status FROM exam_paper WHERE id=?', [paperId]);
  assert.equal(paper.status, 'draft');
  return paperId;
}

export function renderPublicRandomExamReport(report) {
  return [
    '# 公共随机考试1000题隔离验收', '',
    `结果：${report.status}；阶段：${report.stage}；用时：${report.elapsed_ms} ms。`, '',
    '运行：`node tests/run-e2e.mjs --ephemeral --suite public-random-exam`。',
    '使用本次随机测试库、独立MySQL/Redis/API；未调用真实短信或实名供应商。', '',
    ...report.checks.map(check => `- ${check}`), '',
    '```json', JSON.stringify({ imports: report.imports, releases: report.releases, attempts: report.attempts, scores: report.scores, boundaries: report.boundaries, browser: report.browser }, null, 2), '```', '',
    `H5浏览器阶段：${report.browser?.status || '未执行'}${report.browser?.status === 'PASS' ? '；Chrome移动视口、真实列表/开考/恢复API及本机草稿已验证。' : '；设置 PUBLIC_RANDOM_BROWSER=1 可在同一临时库中执行。'}`, '',
    `PC浏览器阶段：${report.browser?.pc?.status || 'NOT_RUN'}；规则保存、编辑回显、发布、二维码配置状态与H5列表同步的证据见browser.pc。`, '',
    '真实手机二维码扫码、小程序真机导航、真实短信/实名供应商、生产部署和容量压力测试均未在本套件中验收。二维码下载正例由root的组件真实库测试负责。',
    '服务与临时数据清理以外层harness的finally清理输出为准。',
  ].join('\n');
}

export async function run(ctx) {
  assertOwnedEphemeralRuntime(ctx);
  const began = Date.now();
  const report = { status: 'FAIL', stage: 'owned runtime', checks: [], imports: [], releases: [], attempts: [], scores: [], boundaries: [], browser: { status: 'NOT_RUN' } };
  const phase = label => { report.stage = label; console.log(`[public-random-exam] ${label}`); };
  try {
    const [target] = await ctx.queryTestDb('SELECT DATABASE() AS name,@@port AS port');
    assert.equal(target.name, ctx.env.DB_DATABASE);
    assert.equal(Number(target.port), Number(ctx.env.DB_PORT));
    const [migration] = await ctx.queryTestDb("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name IN ('exam_paper','paper_release') AND column_name='pool_scope'");
    assert.equal(Number(migration.n), 2, 'harness must apply the public-pool migration before running');
    const admin = await adminLogin(ctx);
    // init.sql may contain shared COS branding locators. This suite owns a
    // cloud-free temporary runtime, so detach only its configured branding via
    // the ordinary API before any PC/H5 page can request those seeded assets.
    const settings = ok(await ctx.request(admin, 'PUT', '/admin/site-settings', { logo_asset_id: null, banners: [] }), 'clear owned test branding');
    assert.equal(settings.logo_asset_id, null);
    assert.deepEqual(settings.banners, []);
    const branding = ok(await ctx.request(null, 'GET', '/site-config'), 'owned public branding convergence');
    assert.equal(branding.logo_asset_id, null);
    assert.deepEqual(branding.banners, []);
    report.checks.push('隔离前置：通过站点配置API清空本轮临时库logo/banners并校验公开读取一致，不调用真实COS。');
    const fixture = publicRandomQuestionFixture();
    const categoryIds = [];
    for (const index of [1, 2]) {
      const category = ok(await ctx.request(admin, 'POST', '/admin/training-categories', { name: `公共随机验收${fixture.runId}-${index}` }), 'test category create');
      categoryIds.push(String(category.id));
    }

    phase('1000 questions through import-preview and commit');
    await importQuestions(ctx, admin, fixture, categoryIds, report);
    report.checks.push('1000题经真实TXT导入preview→commit：两类别各500，easy/hard各500，各难度单选300/多选100/判断100；重提幂等、导入事务失败回滚。');

    phase('publish 100-question and 80-question public papers');
    const paper100 = await createPaper(ctx, admin, `公共100题${fixture.runId}`, PUBLIC_RANDOM_RULES_100);
    const release100 = await publish(ctx, admin, paper100);
    const paper80 = await createPaper(ctx, admin, `公共80题${fixture.runId}`, PUBLIC_RANDOM_RULES_80);
    const release80 = await publish(ctx, admin, paper80);
    report.releases.push({ paper_id: paper100, release_id: release100, questions: 100, score: 100, pool: 1000 }, { paper_id: paper80, release_id: release80, questions: 80, score: 100, pool: 1000 });

    phase('blank-category mobile sessions, list and instructions');
    const institution = await learner(ctx, 'institution');
    const external = await learner(ctx, 'external');
    for (const actor of [institution, external]) {
      const list = ok(await ctx.request(actor, 'GET', '/me/exams?page=1&page_size=100'), 'mobile exam list');
      assertNoSecrets(list);
      for (const [paperId, expectedCount] of [[paper100, 100], [paper80, 80]]) {
        const summary = list.items.find(item => item.paper_id === paperId);
        assert.ok(summary, 'no-category learner must see the published public exam');
        assert.equal(summary.question_count, expectedCount);
        assert.equal(summary.total_score, 100);
        const detail = ok(await ctx.request(actor, 'GET', `/me/exams/${paperId}`), 'exam instructions');
        assertNoSecrets(detail);
        assert.equal(detail.category_id, null);
        assert.equal(detail.question_count, expectedCount);
        assert.equal(detail.active_record_id, null);
        await assertNoAttempt(ctx, actor, paperId);
      }
    }
    report.checks.push('无工种学员经mobile会话、合成实名、考试列表与说明进入；查看页面数据不创建归属或消耗次数。');

    phase('start transaction rollback, concurrent start and recovery');
    await withInsertFailure(ctx, 'exam_record_question', async () => {
      const failed = await ctx.request(institution, 'POST', `/me/exams/${paper100}/start`);
      assert.equal(failed.status, 500);
      await assertNoAttempt(ctx, institution, paper100);
    });
    const concurrent = await Promise.all([
      ctx.request(institution, 'POST', `/me/exams/${paper100}/start`, { source: 'external', difficulty: 'hard' }),
      ctx.request(institution, 'POST', `/me/exams/${paper100}/start`),
    ]);
    const firstInstitution = ok(concurrent[0], 'institution start');
    sameAttempt(ok(concurrent[1], 'second concurrent start'), firstInstitution);
    const firstExternal = ok(await ctx.request(external, 'POST', `/me/exams/${paper100}/start`, { source: 'institution', difficulty: 'easy' }), 'external start');
    await inspectAttempt(ctx, institution, firstInstitution, fixture, PUBLIC_RANDOM_RULES_100, 'easy', 1, release100, report);
    await inspectAttempt(ctx, external, firstExternal, fixture, PUBLIC_RANDOM_RULES_100, 'hard', 1, release100, report);
    await checkRecovery(ctx, institution, firstInstitution);
    await checkRecovery(ctx, external, firstExternal);
    report.checks.push('来源由数据库决定，伪造来源/难度不生效；100题60/20/20、无重复、两类别、无答案解析或未抽中900题；并发/刷新恢复相同记录、顺序和截止。');

    phase('live question revision preserves frozen release and active question order');
    const frozenRelease = await ctx.queryTestDb('SELECT * FROM paper_release_question WHERE release_id=? ORDER BY position', [release100]);
    const [editedQuestion] = await ctx.queryTestDb("SELECT question_id,question_version_id FROM exam_record_question WHERE record_id=? AND type='single' ORDER BY position LIMIT 1", [firstInstitution.record_id]);
    const editedItem = firstInstitution.questions.find(item => item.type === 'single');
    const original = fixtureQuestion(editedItem, fixture);
    const revised = ok(await ctx.request(admin, 'PUT', `/ai/questions/${editedQuestion.question_id}`, {
      expected_version_id: String(editedQuestion.question_version_id), expected_enabled: true,
      stem: `<p>${original.token}：合成安全知识题（发布后修订）。</p>`,
    }), 'revise live question after publish');
    assert.notEqual(String(revised.saved_version_id), String(editedQuestion.question_version_id));
    sameAttempt(ok(await ctx.request(institution, 'GET', `/me/exam-records/${firstInstitution.record_id}`), 'recovery after live revision'), firstInstitution);
    assert.deepEqual(await ctx.queryTestDb('SELECT * FROM paper_release_question WHERE release_id=? ORDER BY position', [release100]), frozenRelease);

    phase('whole-paper grading and idempotent retry');
    const firstResult = await submit(ctx, institution, firstInstitution, fixture, 'correct', 100, report);
    await submit(ctx, external, firstExternal, fixture, 'partial', 90, report);

    phase('withdraw, source change and republish preserve personal assignment');
    ok(await ctx.request(admin, 'POST', `/admin/papers/${paper100}/withdraw`), 'withdraw to draft');
    const withdrawn = await ctx.request(institution, 'POST', `/me/exams/${paper100}/start`);
    assert.equal(withdrawn.status, 404, 'withdrawn paper must reject a new attempt');
    ok(await ctx.request(admin, 'PUT', `/ai/questions/${editedQuestion.question_id}/enabled`, { enabled: false, expected_version_id: String(revised.saved_version_id) }), 'disable revised live bank question');
    const republished = await publish(ctx, admin, paper100, 999);
    assert.notEqual(republished, release100);
    assert.deepEqual(await ctx.queryTestDb('SELECT * FROM paper_release_question WHERE release_id=? ORDER BY position', [release100]), frozenRelease);
    await ctx.queryTestDb("UPDATE sys_user SET source='external' WHERE id=?", [institution.userId]);
    await ctx.queryTestDb("UPDATE sys_user SET source='institution' WHERE id=?", [external.userId]);
    for (const [actor, difficulty, modes, scores] of [
      [institution, 'easy', ['partial', 'wrong'], [90, 0]],
      [external, 'hard', ['correct', 'wrong'], [100, 0]],
    ]) {
      const seen = new Set([actor === institution ? firstInstitution.record_id : firstExternal.record_id]);
      const seenItems = new Set((actor === institution ? firstInstitution : firstExternal).questions.map(item => item.item_id));
      for (const [index, attemptNo] of [2, 3].entries()) {
        const attempt = ok(await ctx.request(actor, 'POST', `/me/exams/${paper100}/start`), 'independent retake');
        assert.ok(!seen.has(attempt.record_id), 'retake needs an independent record');
        seen.add(attempt.record_id);
        assert.ok(attempt.questions.every(item => !seenItems.has(item.item_id)), 'retake needs independent persisted question rows');
        attempt.questions.forEach(item => seenItems.add(item.item_id));
        await inspectAttempt(ctx, actor, attempt, fixture, PUBLIC_RANDOM_RULES_100, difficulty, attemptNo, release100, report);
        await submit(ctx, actor, attempt, fixture, modes[index], scores[index], report);
      }
      const fourth = await ctx.request(actor, 'POST', `/me/exams/${paper100}/start`);
      assert.equal(fourth.status, 409, 'fourth attempt must be rejected');
      const exhausted = ok(await ctx.request(actor, 'GET', `/me/exams/${paper100}`), 'exhausted summary matches server quota');
      assert.deepEqual([exhausted.attempts_used, exhausted.max_attempts, exhausted.attempts_remaining], [3, 3, 0]);
      assert.equal(exhausted.active_record_id, null);
      assert.ok(exhausted.latest_record_id, 'exhausted learner keeps an owned result entry');
      const records = await ctx.queryTestDb('SELECT id,attempt_no,release_id FROM exam_record WHERE paper_id=? AND user_id=? ORDER BY attempt_no', [paper100, actor.userId]);
      assert.deepEqual(records.map(row => Number(row.attempt_no)), [1, 2, 3]);
      assert.ok(records.every(row => String(row.release_id) === release100));
      assert.equal(await count(ctx, 'exam_assignment', 'paper_id=? AND user_id=?', [paper100, actor.userId]), 1);
    }
    assert.deepEqual(ok(await ctx.request(institution, 'GET', `/me/exam-records/${firstInstitution.record_id}/result`), 'unchanged historical score'), firstResult);
    const fresh = await learner(ctx, 'institution');
    const latestAttempt = ok(await ctx.request(fresh, 'POST', `/me/exams/${paper100}/start`), 'fresh learner uses republished version');
    await inspectAttempt(ctx, fresh, latestAttempt, fixture, PUBLIC_RANDOM_RULES_100, 'easy', 1, republished, report);
    await submit(ctx, fresh, latestAttempt, fixture, 'correct', 100, report);
    report.releases.push({ paper_id: paper100, release_id: republished, questions: 100, score: 100, pool: 999 });
    report.checks.push('每人前3次新建独立record/题单，第4次拒绝；及格后仍可重考。改题、停用、撤回重发、来源修改不改旧发布、个人难度、归属、额度和历史结果；新学员用新发布。');

    phase('80-question weighted paper and timeout consumes one attempt');
    await ctx.queryTestDb("UPDATE sys_user SET source='institution' WHERE id=?", [institution.userId]);
    await ctx.queryTestDb("UPDATE sys_user SET source='external' WHERE id=?", [external.userId]);
    const timeoutAttempt = ok(await ctx.request(institution, 'POST', `/me/exams/${paper80}/start`), '80-question easy start');
    const weightedHard = ok(await ctx.request(external, 'POST', `/me/exams/${paper80}/start`), '80-question hard start');
    await inspectAttempt(ctx, institution, timeoutAttempt, fixture, PUBLIC_RANDOM_RULES_80, 'easy', 1, release80, report);
    await inspectAttempt(ctx, external, weightedHard, fixture, PUBLIC_RANDOM_RULES_80, 'hard', 1, release80, report);
    await submit(ctx, external, weightedHard, fixture, 'partial', 85, report);
    await ctx.queryTestDb('UPDATE exam_record SET deadline_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?', [timeoutAttempt.record_id]);
    const closed = ok(await ctx.request(institution, 'GET', `/me/exam-records/${timeoutAttempt.record_id}`), 'lazily finalize timeout');
    assertAttemptView(closed, { status: 'timeout' });
    assertPureTimeout(ok(await ctx.request(institution, 'GET', `/me/exam-records/${timeoutAttempt.record_id}/result`), 'pure timeout result'));
    await assertTimeoutFacts(ctx, timeoutAttempt.record_id);
    const afterTimeout = ok(await ctx.request(institution, 'POST', `/me/exams/${paper80}/start`), 'remaining quota after timeout');
    const continuing = ok(await ctx.request(institution, 'GET', `/me/exams/${paper80}`), 'timeout consumes quota and active attempt remains recoverable');
    assert.deepEqual([continuing.attempts_used, continuing.max_attempts, continuing.attempts_remaining], [2, 3, 1]);
    assert.equal(continuing.active_record_id, afterTimeout.record_id);
    await inspectAttempt(ctx, institution, afterTimeout, fixture, PUBLIC_RANDOM_RULES_80, 'easy', 2, release80, report);
    await submit(ctx, institution, afterTimeout, fixture, 'correct', 100, report);
    const last = ok(await ctx.request(institution, 'POST', `/me/exams/${paper80}/start`), 'last quota after timeout');
    await inspectAttempt(ctx, institution, last, fixture, PUBLIC_RANDOM_RULES_80, 'easy', 3, release80, report);
    await submit(ctx, institution, last, fixture, 'wrong', 0, report);
    assert.equal((await ctx.request(institution, 'POST', `/me/exams/${paper80}/start`)).status, 409);
    await assertTimeoutFacts(ctx, timeoutAttempt.record_id);
    report.checks.push('80题60×1+10×3+10×1=100分，两来源成功；部分正确85分。超时占1次、无答案无评分，剩余2次后拒绝第4次。');

    phase('both difficulty deficits and failed publish rollback');
    const easyDeficit = await assertDeficit(ctx, admin, `简单不足${fixture.runId}`, [{ type: 'multiple', count: 101, score_cents: 100 }], { type: 'multiple', difficulty: 'easy', required: 101, available: 100 });
    const [hardQuestion] = await ctx.queryTestDb("SELECT id,current_version_id FROM question WHERE difficulty='hard' AND type='multiple' AND is_enabled=1 ORDER BY id LIMIT 1");
    ok(await ctx.request(admin, 'PUT', `/ai/questions/${hardQuestion.id}/enabled`, { enabled: false, expected_version_id: String(hardQuestion.current_version_id) }), 'disable one hard multiple');
    const hardDeficit = await assertDeficit(ctx, admin, `困难不足${fixture.runId}`, [{ type: 'multiple', count: 100, score_cents: 100 }], { type: 'multiple', difficulty: 'hard', required: 100, available: 99 });
    const invalid = await ctx.request(admin, 'POST', '/admin/papers', {
      title: `分值不符${fixture.runId}`, mode: 'random', pool_scope: 'public', category_id: null,
      total_score: 100, pass_score: 60, rules: [{ type: 'single', count: 80, score_cents: 100 }],
    });
    assert.equal(invalid.status, 409);
    assert.equal(invalid.code, 40972);
    for (const actor of [institution, external]) {
      const list = ok(await ctx.request(actor, 'GET', '/me/exams?page=1&page_size=100'), 'list excludes failed publications');
      assert.ok(!list.items.some(item => [easyDeficit, hardDeficit].includes(item.paper_id)));
    }
    report.boundaries.push('easy/multiple: required=101, available=100', 'hard/multiple: required=100, available=99', 'invalid score total rejected', 'import/start write failures fully rolled back');
    report.checks.push('easy与hard题池不足均返回具体题型/需求/可用数，失败无release或可参加入口；非法分值合计拒绝。');

    phase('frozen best-score statistics and exam records');
    await ctx.queryTestDb("UPDATE sys_user SET source='external' WHERE id=?", [institution.userId]);
    await ctx.queryTestDb("UPDATE sys_user SET source='institution' WHERE id=?", [external.userId]);
    const summary = ok(await ctx.request(admin, 'GET', `/statistics/training/summary?paper_id=${paper80}`), 'public exam statistics');
    assert.equal(summary.exam.category_id, null);
    for (const [difficulty, score] of [['easy', 100], ['hard', 85]]) {
      const group = summary.score_groups.find(item => item.difficulty === difficulty);
      assert.ok(group);
      assert.equal(group.finalized_users, 1);
      assert.equal(group.highest_score, score);
      assert.equal(group.average_score, score);
    }
    const records = ok(await ctx.request(admin, 'GET', `/admin/exam-records?paper_id=${paper100}&page=1&page_size=100`), 'public exam record list');
    assertNoSecrets(records);
    assert.equal(records.total, 7);
    for (const row of records.items) {
      assert.equal(row.pool_scope, 'public');
      assert.equal(row.category_id, null);
      assert.equal(row.category_name, '公共题库');
      assert.equal(row.total_score, 100);
    }
    const detail = ok(await ctx.request(admin, 'GET', `/admin/exam-records/${firstInstitution.record_id}`), 'frozen administrative record detail');
    assertNoSecrets(detail);
    assert.equal(detail.score, 100);
    assert.equal(detail.source, 'institution');
    assert.equal(detail.difficulty, 'easy');
    assert.equal(detail.category_id, null);
    const [persisted] = await ctx.queryTestDb('SELECT COUNT(*) AS n FROM exam_record r WHERE r.paper_id IN (?,?) AND r.category_id IS NOT NULL', [paper100, paper80]);
    assert.equal(Number(persisted.n), 0);
    const [orphans] = await ctx.queryTestDb('SELECT COUNT(*) AS n FROM paper_release_question q LEFT JOIN paper_release r ON r.id=q.release_id WHERE r.id IS NULL');
    assert.equal(Number(orphans.n), 0);
    assert.equal(await count(ctx, 'question'), 1000, 'no negative case or idempotent retry may add bank questions');
    report.checks.push('数据库成绩与逐题得分、学员结果一致；重复交卷不新增答案；公共卷无工种且最高分统计按easy/hard分别归组。');
    if (process.env.PUBLIC_RANDOM_BROWSER === '1') {
      phase('real PC rules/save/edit/publish and H5 list/start/refresh');
      report.browser = { status: 'RUNNING' };
      const { runPublicRandomBrowser } = await import('./support/public-random-browser.mjs');
      const evidence = await runPublicRandomBrowser(ctx, { actor: fresh, admin, paperId: paper100, title: `公共100题${fixture.runId}` });
      assert.equal(evidence.pc.status, 'PASS');
      assert.equal(evidence.pc.h5_list_synchronized, true);
      const pcDetail = ok(await ctx.request(admin, 'GET', `/admin/papers/${evidence.pc.paper_id}`), 'PC UI writes persisted through real API');
      assert.equal(pcDetail.status, 'published');
      assert.equal(pcDetail.mode, 'random');
      assert.equal(pcDetail.pool_scope, 'public');
      assert.equal(pcDetail.category_id, null);
      assert.equal(pcDetail.max_attempts, 3);
      assert.deepEqual(pcDetail.rules, PUBLIC_RANDOM_RULES_80);
      assert.equal(await count(ctx, 'paper_release', 'paper_id=?', [evidence.pc.paper_id]), 1);
      assert.equal(await count(ctx, 'exam_record', 'paper_id=?', [evidence.pc.paper_id]), 0, 'listing the PC-published paper must not start an attempt');
      const pcPoolCount = await count(ctx, 'paper_release_question', 'release_id=?', [evidence.pc.release_id]);
      report.releases.push({ paper_id: evidence.pc.paper_id, release_id: evidence.pc.release_id, questions: 80, score: 100, pool: pcPoolCount, origin: 'PC UI' });
      await inspectAttempt(ctx, fresh, evidence.attempt, fixture, PUBLIC_RANDOM_RULES_100, 'easy', 2, republished, report);
      assert.equal(await count(ctx, 'exam_record', 'paper_id=? AND user_id=?', [paper100, fresh.userId]), 2);
      await submit(ctx, fresh, evidence.attempt, fixture, 'correct', 100, report);
      const { attempt: _attempt, ...browser } = evidence;
      report.browser = browser;
      report.checks.push('Chrome真实PC新增公共随机卷100题规则，页面修改为80题100分、重开回显并发布；二维码按实际配置显示提示或通用入口；同库H5列表同步新发布卷。');
      report.checks.push('Chrome真实H5显示公共100题100分卷，点击开始仅1次请求；刷新保持record/题目/顺序/截止并恢复1题本机草稿；未mock考试API。');
    }
    report.status = 'PASS';
    report.stage = 'complete';
    return report;
  } catch (error) {
    if (report.browser.status === 'RUNNING') report.browser.status = 'FAIL';
    throw new Error(`[public-random-exam stage=${report.stage}] ${error.message}`, { cause: error });
  } finally {
    report.elapsed_ms = Date.now() - began;
    console.log('[public-random-exam:report-begin]');
    console.log(renderPublicRandomExamReport(report));
    console.log('[public-random-exam:report-end]');
  }
}
