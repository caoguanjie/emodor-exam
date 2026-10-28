import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './training-access.mjs';
import { learnerSession } from './support/learner-session-fixture.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const ExcelJS = require('exceljs');
const Redis = require('ioredis');

async function captchaAnswer(ctx, captchaId) {
  const redis = new Redis({
    host: ctx.env.REDIS_HOST || '127.0.0.1',
    port: Number(ctx.env.REDIS_PORT || 6379),
    password: ctx.env.REDIS_PASSWORD || undefined,
  });
  try { return await redis.get(`${ctx.env.REDIS_KEY_PREFIX || ''}auth:captcha:${captchaId}`); }
  finally { await redis.quit(); }
}

async function login(ctx, username, password) {
  const actor = {};
  const headers = { 'X-Forwarded-For': `198.51.100.${(login.sequence = ((login.sequence || 0) % 200) + 1)}` };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert.equal(captcha.status, 200, `${username} captcha`);
  const answer = await captchaAnswer(ctx, captcha.data.captcha_id);
  const result = await ctx.request(actor, 'POST', '/auth/login', {
    username, password, captcha_id: captcha.data.captcha_id, captcha_code: answer,
  }, headers);
  assert.equal(result.status, 200, `${username} login: ${JSON.stringify(result)}`);
  actor.accessToken = result.data.access_token;
  return { actor, data: result.data };
}

async function readyAdmin(ctx) {
  const first = await login(ctx, 'admin', ctx.adminPassword);
  if (!first.data.force_change_password) return { actor: first.actor, password: ctx.adminPassword };
  const password = randomStrongPassword('admin', 'C6 statistics');
  const changed = await ctx.request(first.actor, 'PUT', '/auth/password', {
    old_password: ctx.adminPassword, new_password: password,
  });
  assert.equal(changed.status, 200, 'admin password change');
  first.actor.accessToken = changed.data.access_token;
  return { actor: first.actor, password };
}

async function one(ctx, sql, params = []) {
  const rows = await ctx.queryTestDb(sql, params);
  assert.equal(rows.length, 1, `expected one row: ${sql}`);
  return rows[0];
}

async function createUser(ctx, values, passwordOwner = 'admin') {
  const username = `c6_${values.label}_${randomBytes(4).toString('hex')}`;
  await ctx.queryTestDb(
    `INSERT INTO sys_user (username,password_hash,real_name,category_id,source,role,status,force_password_change)
     SELECT ?,password_hash,?,?,?,?,?,0 FROM sys_user WHERE username = ?`,
    [username, values.name, values.categoryId, values.source, values.role || 'employee', values.status, passwordOwner],
  );
  return one(ctx, 'SELECT id,username,real_name FROM sys_user WHERE username = ?', [username]);
}

async function insertRecord(ctx, input) {
  await ctx.queryTestDb(
    `INSERT INTO exam_record
      (paper_id,regulation_id,user_id,assignment_id,active_assignment_id,release_id,source,category_id,difficulty,rule_snapshot,snapshot_origin,attempt_no,status,score,started_at,deadline_at,submitted_at,submission_method,grading_state,graded_at)
     VALUES (?,NULL,?,NULL,NULL,?,?,?,?,?,'release',?,?,?,?,?,?,?,?,?)`,
    [
      input.paperId, input.userId, input.releaseId, input.source, input.categoryId, input.difficulty,
      input.rule === null ? null : JSON.stringify(input.rule), input.attemptNo, input.status, input.score,
      input.startedAt, input.deadlineAt, input.submittedAt, input.method, input.gradingState, input.gradedAt,
    ],
  );
}

function flattenNavigation(nodes, output = []) {
  for (const node of nodes || []) {
    output.push(node);
    flattenNavigation(node.children, output);
  }
  return output;
}

async function assertLegacyPureTimeoutStatistics(ctx, admin, adminId) {
  const tag = randomBytes(4).toString('hex');
  const department = await ctx.queryTestDb('INSERT INTO sys_department(parent_id,name) VALUES (1,?)', [`超时统计隔离 ${tag}`]);
  const regulation = await ctx.queryTestDb("INSERT INTO regulation(title,category,status,required_minutes,created_by) VALUES (?,'legacy','published',1,?)", [`旧制度超时口径 ${tag}`, adminId]);
  const regulationId = String(regulation.insertId);
  await ctx.queryTestDb('INSERT INTO regulation_scope(regulation_id,department_id,is_all) VALUES (?,?,0)', [regulationId, department.insertId]);
  const paper = await ctx.queryTestDb("INSERT INTO exam_paper(regulation_id,business_scope,mode,title,total_score,pass_score,duration_minutes,max_attempts,partial_credit_ratio,status,created_by) VALUES (?,'regulation','fixed',?,100,60,30,3,0.5,'published',?)", [regulationId, `旧制度统计卷 ${tag}`, adminId]);
  const users = [];
  for (const [label, status, score, submittedAt, method, gradingState] of [
    ['manual', 'passed', 70, '2026-10-21 08:10:00.000', 'manual', 'finalized'],
    ['old_timeout', 'timeout', 80, '2026-10-21 08:31:00.000', 'timeout', 'finalized'],
    ['pure_timeout', 'timeout', 0, null, null, 'not_submitted'],
  ]) {
    const user = await createUser(ctx, { label, name: `${label}_${tag}`, categoryId: null, source: 'institution', status: 1 });
    users.push(user);
    await ctx.queryTestDb('UPDATE sys_user SET department_id=? WHERE id=?', [department.insertId, user.id]);
    await ctx.queryTestDb("INSERT INTO learning_record(user_id,regulation_id,version_id,total_seconds,max_scroll_percent,scroll_coverage,is_valid,valid_at) VALUES (?,?,1,60,100,'[1,1,1,1,1,1,1,1,1,1]',1,NOW(3))", [user.id, regulationId]);
    await insertRecord(ctx, { paperId: paper.insertId, releaseId: null, categoryId: null, rule: null, userId: user.id, source: null, difficulty: null, attemptNo: 1, status, score, startedAt: '2026-10-21 08:00:00.000', deadlineAt: '2026-10-21 08:30:00.000', submittedAt, method, gradingState, gradedAt: submittedAt });
  }
  await ctx.queryTestDb("UPDATE exam_record SET regulation_id=?,snapshot_origin='legacy_unavailable' WHERE paper_id=?", [regulationId, paper.insertId]);
  const overview = await ctx.request(admin.actor, 'GET', `/statistics/regulations/${regulationId}/overview`);
  assert.equal(overview.status, 200, JSON.stringify(overview));
  assert.equal(overview.data.assigned_count, 3);
  assert.equal(overview.data.exam.participant_count, 2, 'pure timeout must not inflate the scored participant denominator');
  assert.equal(overview.data.exam.passed_count, 2);
  assert.equal(overview.data.exam.pass_rate, 1);
  assert.equal(overview.data.exam.average_score, 75, 'historical graded timeout 80 remains; pure timeout placeholder 0 is excluded');
  assert.deepEqual(overview.data.exam.score_distribution, { '[0,60)': 0, '[60,70)': 0, '[70,80)': 1, '[80,90)': 1, '[90,100]': 0 });
  const departments = await ctx.request(admin.actor, 'GET', `/statistics/regulations/${regulationId}/departments`);
  assert.equal(departments.status, 200);
  assert.equal(departments.data.list.length, 1);
  assert.equal(departments.data.list[0].participant_count, 2);
  assert.equal(departments.data.list[0].average_score, 75);
  const uncompleted = await ctx.request(admin.actor, 'GET', `/statistics/regulations/${regulationId}/uncompleted`);
  assert.equal(uncompleted.status, 200);
  assert.equal(uncompleted.data.list.length, 1);
  assert.equal(String(uncompleted.data.list[0].user_id), String(users[2].id));
  assert.equal(uncompleted.data.list[0].best_score, null, 'pure timeout is not a zero-score submitted result');
  assert.equal(uncompleted.data.list[0].exam_status, null);
  for (const [user, expected] of [[users[1], 80], [users[2], null]]) {
    const personal = await ctx.request(admin.actor, 'GET', `/statistics/users/${user.id}`);
    assert.equal(personal.status, 200);
    const row = personal.data.exams.find((item) => String(item.paper_id) === String(paper.insertId));
    assert.equal(row.best_score, expected);
    assert.equal(row.attempts, 1, 'timeout history is retained even when excluded from scores');
    assert.equal(row.records[0].status, 'timeout');
  }
  const exported = await ctx.request(admin.actor, 'GET', `/statistics/export?type=user_detail&regulation_id=${regulationId}`);
  assert.equal(exported.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported.body);
  const rows = new Map();
  workbook.getWorksheet('个人明细').eachRow((row, index) => { if (index > 1) rows.set(row.getCell('A').value, row); });
  assert.equal(rows.get(users[2].real_name).getCell('J').value, '—');
  assert.equal(rows.get(users[2].real_name).getCell('K').value, '未参考');
  assert.equal(rows.get(users[1].real_name).getCell('J').value, 80, 'legacy graded timeout keeps its original frozen score in export');
}

async function assertTrainingOverviewAndSorting(ctx, admin, adminId, readOnlyActor, learnerActor) {
  const tag = `C6补齐${randomBytes(4).toString('hex')}`;
  const categories = [];
  for (const suffix of ['发布类别', '其他类别']) {
    const name = `${tag} ${suffix}`;
    const result = await ctx.queryTestDb('INSERT INTO training_category (name,status,created_by) VALUES (?,1,?)', [name, adminId]);
    categories.push({ id: String(result.insertId), name });
  }
  const rule = {
    totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 5,
    partialCreditRatio: 0.5, rules: [{ type: 'single', count: 1, scoreCents: 10000 }],
  };
  const oldRule = { ...rule, passCents: 7000 };
  const createPaper = async (suffix, categoryId, status = 'published', businessScope = 'training') => {
    const title = `${tag} ${suffix}`;
    const result = await ctx.queryTestDb(
      `INSERT INTO exam_paper (business_scope,mode,category_id,rule_config,title,total_score,pass_score,duration_minutes,max_attempts,partial_credit_ratio,status,created_by)
       VALUES (?,'random',?,?,?,100,60,30,5,0.5,?,?)`,
      [businessScope, categoryId, JSON.stringify(rule), title, status, adminId],
    );
    return { id: String(result.insertId), title };
  };
  const releasePaper = async (paper, categoryId, version, snapshot = rule) => {
    const result = await ctx.queryTestDb(
      `INSERT INTO paper_release (paper_id,version_no,business_scope,mode,category_id,requires_learning,rule_snapshot,created_by)
       VALUES (?,?,'training','random',?,0,?,?)`,
      [paper.id, version, categoryId, JSON.stringify(snapshot), adminId],
    );
    return String(result.insertId);
  };
  const paper = await createPaper('成绩卷 当前名称', categories[0].id);
  const priorReleaseId = await releasePaper(paper, categories[0].id, 1, oldRule);
  const releaseId = await releasePaper(paper, categories[0].id, 2);
  const draft = await createPaper('未发布草稿', categories[0].id, 'draft');
  const empty = await createPaper('无成绩卷', categories[1].id);
  const emptyReleaseId = await releasePaper(empty, categories[1].id, 1);
  const archived = await createPaper('归档卷', categories[1].id, 'archived');
  await releasePaper(archived, categories[1].id, 1);
  await createPaper('旧制度卷', categories[0].id, 'published', 'regulation');
  // Deliberately disagree with the release: statistics must use its frozen category and rules.
  await ctx.queryTestDb('UPDATE exam_paper SET category_id=?,total_score=200,pass_score=150,duration_minutes=99 WHERE id=?', [categories[1].id, paper.id]);

  const users = [];
  for (const [label, name, gender] of [
    ['sort_a', '排序甲', 'male'], ['sort_b', '排序乙', 'female'], ['sort_c', '排序丙', null],
    ['sort_timeout', '纯超时', null], ['sort_rule', '异规则', null], ['sort_old', '仅旧发布', null],
  ]) {
    const user = await createUser(ctx, { label, name, categoryId: categories[0].id, source: 'institution', status: 1 });
    await ctx.queryTestDb('UPDATE sys_user SET gender=? WHERE id=?', [gender, user.id]);
    users.push(user);
  }
  const addRecord = async (user, values) => insertRecord(ctx, {
    paperId: paper.id, releaseId, categoryId: categories[0].id, rule,
    userId: user.id, source: 'institution', difficulty: 'easy', attemptNo: 1,
    status: 'passed', score: 90, startedAt: '2026-10-21 08:00:00.000',
    deadlineAt: '2026-10-21 08:30:00.000', submittedAt: '2026-10-21 08:05:00.000',
    method: 'manual', gradingState: 'finalized', gradedAt: '2026-10-21 08:05:00.000', ...values,
  });
  await addRecord(users[0], { score: 40, status: 'failed', submittedAt: '2026-10-21 08:01:00.000' });
  await addRecord(users[0], { attemptNo: 2, startedAt: '2026-10-21 10:00:00.000', deadlineAt: '2026-10-21 10:30:00.000', submittedAt: '2026-10-21 10:15:00.000', gradedAt: '2026-10-21 10:15:00.000' });
  await addRecord(users[0], { attemptNo: 3, score: 96, source: 'external', difficulty: 'hard', submittedAt: '2026-10-21 08:10:00.000' });
  await addRecord(users[1], {});
  await addRecord(users[2], { score: 30, status: 'failed', submittedAt: '2026-10-21 08:03:00.000' });
  await addRecord(users[3], { score: 0, status: 'timeout', submittedAt: null, method: null, gradingState: 'not_submitted', gradedAt: null });
  await addRecord(users[4], { releaseId: priorReleaseId, rule: oldRule, score: 100 });
  await addRecord(users[4], { attemptNo: 2, rule: oldRule, score: 99 });
  await addRecord(users[5], { releaseId: priorReleaseId, rule: oldRule, score: 100 });
  await addRecord(users[1], { paperId: draft.id, releaseId: null, score: 100 });
  await addRecord(users[3], { paperId: empty.id, releaseId: emptyReleaseId, categoryId: categories[1].id, score: 0, status: 'timeout', submittedAt: null, method: null, gradingState: 'not_submitted', gradedAt: null });

  const overviewQuery = `/statistics/training/overview?keyword=${encodeURIComponent(tag)}`;
  const overview = await ctx.request(admin.actor, 'GET', `${overviewQuery}&page=1&page_size=100`);
  assert.equal(overview.status, 200, JSON.stringify(overview));
  assert.equal(overview.data.total, 2, 'overview must exclude regulation papers, drafts and archived papers');
  assert.equal(overview.data.items.length, 2);
  const row = overview.data.items.find((item) => item.paper_id === paper.id);
  assert.deepEqual(row, {
    paper_id: paper.id, title: paper.title, pool_scope: 'category', category_id: categories[0].id, category_name: categories[0].name,
    status: 'published', release_id: releaseId, total_score: 100, duration_minutes: 30, pass_score: 60,
    participant_count: 5, finalized_users: 3, average_score: 72,
  }, 'overview must count latest-release starters, then average one best score per user across difficulties');
  const draftRow = overview.data.items.find((item) => item.paper_id === draft.id);
  assert.equal(draftRow, undefined, 'unreleased drafts must stay in paper management');
  const emptyRow = overview.data.items.find((item) => item.paper_id === empty.id);
  assert.deepEqual([emptyRow.participant_count, emptyRow.finalized_users, emptyRow.average_score], [1, 0, null], 'pure timeout is a starter but not a scored result');
  assert.equal(overview.data.items.find((item) => item.paper_id === archived.id), undefined);

  const categoryOverview = await ctx.request(admin.actor, 'GET', `${overviewQuery}&category_id=${categories[0].id}`);
  assert.equal(categoryOverview.status, 200);
  assert.equal(categoryOverview.data.total, 1);
  assert.deepEqual(new Set(categoryOverview.data.items.map((item) => item.paper_id)), new Set([paper.id]), 'category filter must follow the latest release');
  const pages = [];
  for (const page of [1, 2]) {
    const result = await ctx.request(admin.actor, 'GET', `${overviewQuery}&page=${page}&page_size=1`);
    assert.equal(result.status, 200);
    assert.deepEqual([result.data.total, result.data.page, result.data.page_size, result.data.items.length], [2, page, 1, 1]);
    pages.push(...result.data.items.map((item) => item.paper_id));
  }
  assert.equal(new Set(pages).size, 2, 'overview pagination must neither repeat nor skip papers');
  const noMatch = await ctx.request(admin.actor, 'GET', `${overviewQuery}不存在&page=1&page_size=20`);
  assert.equal(noMatch.status, 200);
  assert.deepEqual([noMatch.data.total, noMatch.data.items], [0, []]);
  const narrowOverview = await ctx.request(readOnlyActor, 'GET', overviewQuery);
  assert.equal(narrowOverview.status, 200, 'statistics-only role must access overview without source-module permissions');
  for (const path of [overviewQuery, `/statistics/training/summary?paper_id=${paper.id}`, `/statistics/training/ranking?paper_id=${paper.id}&difficulty=easy`]) {
    const denied = await ctx.request(learnerActor, 'GET', path);
    assert.equal(denied.status, 403, `ordinary learner must not read statistics: ${path}`);
  }
  for (const query of ['page=0', 'page_size=101', 'category_id=invalid', 'unexpected=1']) {
    const invalid = await ctx.request(admin.actor, 'GET', `/statistics/training/overview?${query}`);
    assert.equal(invalid.status, 400, `invalid overview query: ${query}`);
  }

  const summary = await ctx.request(admin.actor, 'GET', `/statistics/training/summary?paper_id=${paper.id}`);
  assert.equal(summary.status, 200, JSON.stringify(summary));
  assert.deepEqual(summary.data.exam, {
    paper_id: paper.id, title: paper.title, pool_scope: 'category', category_id: categories[0].id, mode: 'random',
    total_score: 100, duration_minutes: 30, pass_score: 60, excellent_score: null,
  });
  const easy = summary.data.score_groups.find((group) => group.difficulty === 'easy');
  assert.deepEqual({
    finalized: easy.finalized_users, average: easy.average_score, highest: easy.highest_score,
    lowest: easy.lowest_score, passed: easy.passed_users, duration: easy.average_duration_seconds,
    excellent: easy.excellent_users,
  }, { finalized: 3, average: 70, highest: 90, lowest: 30, passed: 2, duration: 460, excellent: null }, 'score metrics must use the same best-score representative records');
  assert.ok(Math.abs(easy.pass_rate - 2 / 3) < 0.0001);
  const hard = summary.data.score_groups.find((group) => group.difficulty === 'hard');
  assert.deepEqual([hard.finalized_users, hard.highest_score, hard.lowest_score, hard.passed_users, hard.average_duration_seconds, hard.excellent_users], [1, 96, 96, 1, 600, null]);
  const frozenSource = await ctx.request(admin.actor, 'GET', `/statistics/training/ranking?paper_id=${paper.id}&category_id=${categories[0].id}&source=external&difficulty=hard`);
  assert.equal(frozenSource.status, 200);
  assert.deepEqual(frozenSource.data.items.map((item) => [item.user_id, item.source, item.score]), [[String(users[0].id), 'external', 96]], 'source/category filters must use record snapshots even after current facts differ');
  const emptySource = await ctx.request(admin.actor, 'GET', `/statistics/training/ranking?paper_id=${paper.id}&source=external&difficulty=easy`);
  assert.equal(emptySource.status, 200);
  assert.deepEqual([emptySource.data.total, emptySource.data.items], [0, []]);
  for (const noScorePaper of [draft, empty]) {
    const noScores = await ctx.request(admin.actor, 'GET', `/statistics/training/summary?paper_id=${noScorePaper.id}&difficulty=easy`);
    assert.equal(noScores.status, 200);
    assert.equal(noScores.data.finalized_users, 0, 'unreleased/timeout records must not enter summary scores');
    assert.equal(noScores.data.exam.excellent_score, null);
    if (noScorePaper === draft) {
      assert.equal(noScores.data.release_id, null);
      assert.deepEqual([noScores.data.exam.total_score, noScores.data.exam.duration_minutes, noScores.data.exam.pass_score], [null, null, null]);
    }
    for (const group of noScores.data.score_groups) {
      assert.deepEqual([group.average_score, group.highest_score, group.lowest_score, group.average_duration_seconds, group.excellent_users], [null, null, null, null, null]);
      assert.deepEqual([group.finalized_users, group.passed_users], [0, 0]);
    }
    const noRanking = await ctx.request(admin.actor, 'GET', `/statistics/training/ranking?paper_id=${noScorePaper.id}&difficulty=easy`);
    assert.equal(noRanking.status, 200);
    assert.deepEqual([noRanking.data.total, noRanking.data.items], [0, []]);
  }

  const rankingQuery = `/statistics/training/ranking?paper_id=${paper.id}&difficulty=easy`;
  const ranking = await ctx.request(admin.actor, 'GET', `${rankingQuery}&page=1&page_size=20`);
  assert.equal(ranking.status, 200);
  assert.deepEqual(ranking.data.items.map((item) => [item.rank, item.user_id, item.gender, item.score, item.duration_seconds]), [
    [1, String(users[1].id), 'female', 90, 300], [1, String(users[0].id), 'male', 90, 900], [3, String(users[2].id), null, 30, 180],
  ], 'rank must be based on scores, preserve gender, and exclude old/different rules and pure timeout');
  for (const [sort, order, expected] of [
    ['score', 'asc', [[3, '排序丙'], [1, '排序乙'], [1, '排序甲']]],
    ['score', 'desc', [[1, '排序乙'], [1, '排序甲'], [3, '排序丙']]],
    ['duration', 'asc', [[3, '排序丙'], [1, '排序乙'], [1, '排序甲']]],
    ['duration', 'desc', [[1, '排序甲'], [1, '排序乙'], [3, '排序丙']]],
  ]) {
    const sorted = await ctx.request(admin.actor, 'GET', `${rankingQuery}&sort_by=${sort}&sort_order=${order}&page=1&page_size=20`);
    assert.equal(sorted.status, 200, JSON.stringify(sorted));
    assert.deepEqual(sorted.data.items.map((item) => [item.rank, item.name]), expected, `${sort} ${order} must not renumber score ranks`);
  }
  const sortedPageQuery = `paper_id=${paper.id}&difficulty=easy&sort_by=duration&sort_order=desc&page=2&page_size=1`;
  const sortedPage = await ctx.request(admin.actor, 'GET', `/statistics/training/ranking?${sortedPageQuery}`);
  assert.equal(sortedPage.status, 200);
  assert.deepEqual([sortedPage.data.total, sortedPage.data.page, sortedPage.data.page_size], [3, 2, 1]);
  assert.deepEqual(sortedPage.data.items.map((item) => [item.rank, item.name, item.score]), [[1, '排序乙', 90]], 'sort must happen before pagination');
  const exported = await ctx.request(admin.actor, 'GET', `/statistics/training/export?${sortedPageQuery}`);
  assert.equal(exported.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported.body);
  const sheet = workbook.getWorksheet('成绩排名');
  assert.equal(sheet.rowCount, 2, 'export must contain the sorted current page only');
  assert.deepEqual([sheet.getCell('A2').value, String(sheet.getCell('B2').value), sheet.getCell('C2').value, sheet.getCell('F2').value, sheet.getCell('G2').value, String(sheet.getCell('H2').value)], [1, String(users[1].id), '排序乙', 90, 300, sortedPage.data.items[0].record_id]);
  for (const query of ['sort_by=name', 'sort_order=up']) {
    for (const endpoint of ['ranking', 'export']) {
      const invalid = await ctx.request(admin.actor, 'GET', `/statistics/training/${endpoint}?paper_id=${paper.id}&difficulty=easy&${query}`);
      assert.equal(invalid.status, 400, `invalid ranking/export sort must be rejected: ${query}`);
    }
  }
}

async function assertPublicStatistics(ctx, admin, adminId) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_/, 'public statistics fixtures require an isolated database');
  const tag = `T7公共${randomBytes(4).toString('hex')}`;
  const category = await ctx.queryTestDb('INSERT INTO training_category (name,status,created_by) VALUES (?,1,?)', [`${tag} 工种`, adminId]);
  const rule = { totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5,
    rules: [{ type: 'single', count: 1, scoreCents: 10000 }] };
  const oldRule = { ...rule, passCents: 7000 };
  const paper = await ctx.queryTestDb(`INSERT INTO exam_paper
    (business_scope,mode,pool_scope,category_id,rule_config,title,total_score,pass_score,duration_minutes,max_attempts,partial_credit_ratio,status,created_by)
    VALUES ('training','random','public',NULL,?,?,100,60,30,3,0.5,'published',?)`, [JSON.stringify(rule), tag, adminId]);
  const paperId = String(paper.insertId);
  const release = async (version, snapshot) => {
    const result = await ctx.queryTestDb(`INSERT INTO paper_release
      (paper_id,version_no,business_scope,mode,pool_scope,category_id,requires_learning,rule_snapshot,created_by)
      VALUES (?,?,'training','random','public',NULL,0,?,?)`, [paperId, version, JSON.stringify(snapshot), adminId]);
    return String(result.insertId);
  };
  const priorReleaseId = await release(1, oldRule);
  const releaseId = await release(2, rule);
  const users = [];
  for (const [label, categoryId, source] of [
    ['null_easy', null, 'institution'], ['cross_hard', String(category.insertId), 'external'],
    ['null_timeout', null, 'external'], ['old_public', null, 'institution'], ['not_started', null, 'institution'],
  ]) users.push(await createUser(ctx, { label, name: `${tag}_${label}`, categoryId, source, status: 1 }));
  const addRecord = (user, values) => insertRecord(ctx, {
    paperId, releaseId, categoryId: null, rule, userId: user.id, source: 'institution', difficulty: 'easy', attemptNo: 1,
    status: 'passed', score: 80, startedAt: '2026-10-28 01:00:00.000', deadlineAt: '2026-10-28 01:30:00.000',
    submittedAt: '2026-10-28 01:10:00.000', method: 'manual', gradingState: 'finalized', gradedAt: '2026-10-28 01:10:00.000', ...values,
  });
  await addRecord(users[0], { score: 50, status: 'failed' });
  await addRecord(users[0], { attemptNo: 2 });
  await addRecord(users[1], { source: 'external', difficulty: 'hard', score: 90 });
  await addRecord(users[2], { source: 'external', difficulty: 'hard', status: 'timeout', score: 0, submittedAt: null, method: null, gradingState: 'not_submitted', gradedAt: null });
  await addRecord(users[3], { releaseId: priorReleaseId, rule: oldRule, score: 100 });
  await ctx.queryTestDb("UPDATE sys_user SET source='external' WHERE id=?", [users[0].id]);
  await ctx.queryTestDb("UPDATE sys_user SET category_id=NULL,source='institution' WHERE id=?", [users[1].id]);

  const summary = await ctx.request(admin.actor, 'GET', `/statistics/training/summary?paper_id=${paperId}`);
  assert.equal(summary.status, 200, JSON.stringify(summary));
  assert.deepEqual(summary.data.exam, { paper_id: paperId, title: tag, pool_scope: 'public', category_id: null,
    mode: 'random', total_score: 100, duration_minutes: 30, pass_score: 60, excellent_score: null });
  assert.equal(summary.data.participation_rate, null, 'public exams do not define an expected-audience rate');
  assert.equal(summary.data.eligible_count, 0, 'numeric compatibility field must not estimate an audience');
  assert.deepEqual([summary.data.historical_started_count, summary.data.submitted_users, summary.data.submitted_attempts, summary.data.finalized_users], [4, 3, 4, 2]);
  assert.deepEqual(summary.data.score_groups.map(item => [item.difficulty, item.finalized_users, item.average_score]), [['easy', 1, 80], ['hard', 1, 90]]);
  const overview = await ctx.request(admin.actor, 'GET', `/statistics/training/overview?keyword=${encodeURIComponent(tag)}`);
  assert.equal(overview.status, 200);
  assert.equal(overview.data.total, 1);
  assert.deepEqual({ scope: overview.data.items[0].pool_scope, category: overview.data.items[0].category_id, label: overview.data.items[0].category_name,
    participants: overview.data.items[0].participant_count, finalized: overview.data.items[0].finalized_users, average: overview.data.items[0].average_score },
  { scope: 'public', category: null, label: '公共题库', participants: 3, finalized: 2, average: 85 });
  for (const [source, difficulty, user, score] of [['institution', 'easy', users[0], 80], ['external', 'hard', users[1], 90]]) {
    const query = `paper_id=${paperId}&source=${source}&difficulty=${difficulty}`;
    const ranking = await ctx.request(admin.actor, 'GET', `/statistics/training/ranking?${query}`);
    assert.equal(ranking.status, 200);
    assert.deepEqual(ranking.data.items.map(item => [item.user_id, item.source, item.difficulty, item.score, item.rank]),
      [[String(user.id), source, difficulty, score, 1]], 'ranking must use frozen source/difficulty and only the latest matching release');
    const exported = await ctx.request(admin.actor, 'GET', `/statistics/training/export?${query}`);
    assert.equal(exported.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body);
    const sheet = workbook.getWorksheet('成绩排名');
    assert.equal(sheet.rowCount, 2);
    assert.deepEqual([String(sheet.getCell('B2').value), sheet.getCell('F2').value], [String(user.id), score]);
  }
  for (const endpoint of ['ranking', 'export']) {
    const result = await ctx.request(admin.actor, 'GET', `/statistics/training/${endpoint}?paper_id=${paperId}`);
    assert.equal(result.status, 400, 'a public random exam cannot mix difficulties in a ranking');
  }
  const records = await ctx.request(admin.actor, 'GET', `/admin/exam-records?paper_id=${paperId}`);
  assert.equal(records.status, 200, JSON.stringify(records));
  assert.equal(records.data.total, 5);
  for (const row of records.data.items) {
    assert.equal(row.pool_scope, 'public');
    assert.equal(row.category_id, null);
    assert.equal(row.category_name, '公共题库');
  }
  const detail = await ctx.request(admin.actor, 'GET', `/admin/exam-records/${records.data.items[0].record_id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.pool_scope, 'public');
  const options = await ctx.request(admin.actor, 'GET', '/statistics/training/options');
  assert.equal(options.status, 200);
  assert.equal(options.data.papers.find(item => item.id === paperId).pool_scope, 'public');
  const recent = await ctx.request(admin.actor, 'GET', '/admin/dashboard/recent-exams');
  assert.equal(recent.status, 200);
  const recentRow = recent.data.items.find(item => item.paper_id === paperId);
  assert.ok(recentRow, 'latest public exam must be present in recent exams');
  assert.deepEqual([recentRow.pool_scope, recentRow.category_name, recentRow.participant_count, recentRow.average_score], ['public', '公共题库', 3, 85]);

  // Zero-participant public exams keep null rates and scores, with the same scope.
  const emptyPaper = await ctx.queryTestDb(`INSERT INTO exam_paper
    (business_scope,mode,pool_scope,category_id,rule_config,title,total_score,pass_score,duration_minutes,max_attempts,partial_credit_ratio,status,created_by)
    VALUES ('training','random','public',NULL,?,?,100,60,30,3,0.5,'published',?)`, [JSON.stringify(rule), `${tag} 空场`, adminId]);
  await ctx.queryTestDb(`INSERT INTO paper_release
    (paper_id,version_no,business_scope,mode,pool_scope,category_id,requires_learning,rule_snapshot,created_by)
    VALUES (?,1,'training','random','public',NULL,0,?,?)`, [emptyPaper.insertId, JSON.stringify(rule), adminId]);
  const empty = await ctx.request(admin.actor, 'GET', `/statistics/training/summary?paper_id=${emptyPaper.insertId}`);
  assert.equal(empty.status, 200);
  assert.deepEqual([empty.data.exam.pool_scope, empty.data.historical_started_count, empty.data.submitted_users, empty.data.participation_rate, empty.data.score_groups], ['public', 0, 0, null, []]);

  const learner = await learnerSession(ctx, users[4].id);
  const listed = await ctx.request(learner, 'GET', '/me/exams?page_size=100');
  assert.equal(listed.status, 200);
  const dashboard = await ctx.request(admin.actor, 'GET', '/admin/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal(listed.data.total, dashboard.data.metrics.published_paper_count, 'a new learner without an occupation sees the same published exams counted by the dashboard');
  for (const target of [paperId, String(emptyPaper.insertId)]) assert.ok(listed.data.items.some(item => String(item.paper_id) === target), 'public exams remain visible without an occupation');
  console.log('[T7] public/null statistics, frozen source/difficulty, best scores, ranking/export, records and dashboard/list counts verified');
}

export async function run(ctx) {
  ctx.reportOwnedRuntime?.({ stage: 'training-statistics-start', database: ctx.env.DB_DATABASE });
  const admin = await readyAdmin(ctx);
  const initialOverview = await ctx.request(admin.actor, 'GET', '/statistics/training/overview?page=1&page_size=20');
  assert.equal(initialOverview.status, 200, `training overview must be available: ${JSON.stringify(initialOverview)}`);
  const adminRow = await one(ctx, "SELECT id FROM sys_user WHERE username = 'admin'");
  const categoryName = `C6 类别 ${randomBytes(4).toString('hex')}`;
  await ctx.queryTestDb('INSERT INTO training_category (name,description,status,created_by) VALUES (?,?,1,?)', [categoryName, 'statistics fixture', adminRow.id]);
  const category = await one(ctx, 'SELECT id FROM training_category WHERE name = ?', [categoryName]);
  const otherName = `${categoryName} 空范围`;
  await ctx.queryTestDb('INSERT INTO training_category (name,description,status,created_by) VALUES (?,?,1,?)', [otherName, 'zero denominator', adminRow.id]);
  const otherCategory = await one(ctx, 'SELECT id FROM training_category WHERE name = ?', [otherName]);

  const learnerA = await createUser(ctx, { label: 'a', name: '学员A', categoryId: category.id, source: 'institution', status: 1 });
  const learnerB = await createUser(ctx, { label: 'b', name: '学员B', categoryId: category.id, source: 'institution', status: 1 });
  const learnerC = await createUser(ctx, { label: 'c', name: '学员C', categoryId: category.id, source: 'external', status: 1 });
  const learnerD = await createUser(ctx, { label: 'd', name: '学员D', categoryId: category.id, source: 'external', status: 1 });
  const learnerE = await createUser(ctx, { label: 'e', name: '调离E', categoryId: category.id, source: 'institution', status: 0 });

  const roleCode = `c6_stats_${randomBytes(4).toString('hex')}`;
  await ctx.queryTestDb('INSERT INTO sys_role (code,name,is_system,status) VALUES (?,?,0,1)', [roleCode, 'C6 只读统计']);
  const role = await one(ctx, 'SELECT id FROM sys_role WHERE code = ?', [roleCode]);
  const statisticsRead = await one(ctx, "SELECT id FROM sys_permission WHERE code = 'statistics:read'");
  await ctx.queryTestDb('INSERT INTO sys_role_permission (role_id,permission_id) VALUES (?,?)', [role.id, statisticsRead.id]);
  await ctx.queryTestDb('INSERT INTO sys_user_role (user_id,role_id) VALUES (?,?)', [learnerA.id, role.id]);
  await ctx.queryTestDb('UPDATE sys_user SET roles_configured = 1 WHERE id = ?', [learnerA.id]);

  const narrow = await createUser(ctx, { label: 'narrow', name: '统计管理员', categoryId: null, source: null, status: 1 });
  await ctx.queryTestDb('INSERT INTO sys_user_role (user_id,role_id) VALUES (?,?)', [narrow.id, role.id]);
  await ctx.queryTestDb('UPDATE sys_user SET roles_configured = 1 WHERE id = ?', [narrow.id]);

  const rule = {
    totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3,
    partialCreditRatio: 0.5, rules: [{ type: 'single', count: 1, scoreCents: 10000 }],
  };
  const priorRule = { ...rule, passCents: 7000 };
  const paperTitle = `C6 安全考试 ${randomBytes(3).toString('hex')}`;
  await ctx.queryTestDb(
    `INSERT INTO exam_paper (business_scope,mode,category_id,requires_learning,regulation_ids,course_ids,rule_config,title,total_score,pass_score,duration_minutes,max_attempts,partial_credit_ratio,status,created_by)
     VALUES ('training','random',?,0,NULL,NULL,?,?,100,60,30,3,0.5,'published',?)`,
    [category.id, JSON.stringify(rule), paperTitle, adminRow.id],
  );
  const paper = await one(ctx, 'SELECT id FROM exam_paper WHERE title = ?', [paperTitle]);
  await ctx.queryTestDb(
    `INSERT INTO paper_release (paper_id,version_no,business_scope,mode,category_id,requires_learning,rule_snapshot,regulation_ids,course_ids,created_by)
     VALUES (?,1,'training','random',?,0,?,NULL,NULL,?),(?,2,'training','random',?,0,?,NULL,NULL,?)`,
    [paper.id, category.id, JSON.stringify(priorRule), adminRow.id, paper.id, category.id, JSON.stringify(rule), adminRow.id],
  );
  const releases = await ctx.queryTestDb('SELECT id,version_no FROM paper_release WHERE paper_id = ? ORDER BY version_no', [paper.id]);
  const oldRelease = releases[0];
  const currentRelease = releases[1];

  const common = { paperId: paper.id, releaseId: currentRelease.id, categoryId: category.id, rule };
  await insertRecord(ctx, { ...common, userId: learnerA.id, source: 'institution', difficulty: 'easy', attemptNo: 1, status: 'failed', score: 50, startedAt: '2026-10-20 08:00:00.000', deadlineAt: '2026-10-20 08:30:00.000', submittedAt: '2026-10-20 08:10:00.000', method: 'manual', gradingState: 'finalized', gradedAt: '2026-10-20 09:00:00.000' });
  await insertRecord(ctx, { ...common, userId: learnerA.id, source: 'institution', difficulty: 'easy', attemptNo: 2, status: 'passed', score: 80, startedAt: '2026-10-20 10:00:00.000', deadlineAt: '2026-10-20 10:30:00.000', submittedAt: '2026-10-20 10:10:00.000', method: 'manual', gradingState: 'finalized', gradedAt: '2026-10-20 15:00:00.000' });
  await insertRecord(ctx, { ...common, userId: learnerB.id, source: 'institution', difficulty: 'easy', attemptNo: 1, status: 'passed', score: 80, startedAt: '2026-10-20 08:00:00.000', deadlineAt: '2026-10-20 08:30:00.000', submittedAt: '2026-10-20 08:10:00.000', method: 'manual', gradingState: 'finalized', gradedAt: '2026-10-20 09:30:00.000' });
  await insertRecord(ctx, { ...common, userId: learnerC.id, source: 'external', difficulty: 'hard', attemptNo: 1, status: 'passed', score: 90, startedAt: '2026-10-20 08:00:00.000', deadlineAt: '2026-10-20 08:30:00.000', submittedAt: '2026-10-20 08:35:00.000', method: 'timeout', gradingState: 'finalized', gradedAt: '2026-10-20 16:00:00.000' });
  await insertRecord(ctx, { ...common, userId: learnerD.id, source: 'external', difficulty: 'hard', attemptNo: 1, status: 'submitted', score: null, startedAt: '2026-10-20 08:00:00.000', deadlineAt: '2026-10-20 08:30:00.000', submittedAt: '2026-10-20 08:20:00.000', method: 'manual', gradingState: 'pending_manual', gradedAt: null });
  await insertRecord(ctx, { ...common, releaseId: oldRelease.id, rule: priorRule, userId: learnerE.id, source: 'institution', difficulty: 'easy', attemptNo: 1, status: 'passed', score: 100, startedAt: '2026-10-20 07:00:00.000', deadlineAt: '2026-10-20 07:30:00.000', submittedAt: '2026-10-20 07:10:00.000', method: 'manual', gradingState: 'finalized', gradedAt: '2026-10-20 07:30:00.000' });
  await insertRecord(ctx, { ...common, rule: priorRule, userId: learnerE.id, source: 'institution', difficulty: 'easy', attemptNo: 2, status: 'passed', score: 99, startedAt: '2026-10-20 11:00:00.000', deadlineAt: '2026-10-20 11:30:00.000', submittedAt: '2026-10-20 11:10:00.000', method: 'manual', gradingState: 'finalized', gradedAt: null });

  const courseTitle = `C6 课程 ${randomBytes(3).toString('hex')}`;
  await ctx.queryTestDb("INSERT INTO training_course (title,category_id,status,created_by,published_at) VALUES (?,?,'published',?,NOW(3))", [courseTitle, category.id, adminRow.id]);
  const course = await one(ctx, 'SELECT id FROM training_course WHERE title = ?', [courseTitle]);
  await ctx.queryTestDb("INSERT INTO course_chapter (course_id,title,sort_order) VALUES (?,'第一章',1)", [course.id]);
  const chapter = await one(ctx, 'SELECT id FROM course_chapter WHERE course_id = ?', [course.id]);
  await ctx.queryTestDb("INSERT INTO course_lesson (course_id,chapter_id,title,lesson_type,is_required,sort_order) VALUES (?,?,'课时一','video',1,1),(?,?,'课时二','video',1,2)", [course.id, chapter.id, course.id, chapter.id]);
  const lessons = await ctx.queryTestDb('SELECT id FROM course_lesson WHERE course_id = ? ORDER BY sort_order', [course.id]);
  for (let index = 0; index < lessons.length; index += 1) {
    const storageKey = `c6/${randomBytes(8).toString('hex')}.mp4`;
    await ctx.queryTestDb(
      "INSERT INTO media_asset (owner_id,uploaded_by,purpose,media_kind,original_name,mime_type,storage_key,size_bytes,sha256,status,duration_ms) VALUES (?,?,'video','video','c6.mp4','video/mp4',?,1,?,'ready',120000)",
      [adminRow.id, adminRow.id, storageKey, '0'.repeat(64)],
    );
    const asset = await one(ctx, 'SELECT id FROM media_asset WHERE storage_key = ?', [storageKey]);
    await ctx.queryTestDb('INSERT INTO lesson_version (lesson_id,version_no,asset_id,duration_ms,created_by) VALUES (?,1,?,120000,?)', [lessons[index].id, asset.id, adminRow.id]);
    const version = await one(ctx, 'SELECT id FROM lesson_version WHERE lesson_id = ? AND version_no = 1', [lessons[index].id]);
    lessons[index].versionId = version.id;
    await ctx.queryTestDb('UPDATE course_lesson SET current_version_id = ? WHERE id = ?', [version.id, lessons[index].id]);
  }
  const completed = async (userId, versionId) => ctx.queryTestDb(
    "INSERT INTO video_learning_record (user_id,lesson_version_id,duration_ms,credited_ms,coverage_intervals,coverage_ms,confirmed_position_ms,is_completed,completed_at,last_learn_at) VALUES (?,?,120000,120000,'[[0,120000]]',120000,120000,1,NOW(3),NOW(3))",
    [userId, versionId],
  );
  await completed(learnerA.id, lessons[0].versionId);
  await completed(learnerA.id, lessons[1].versionId);
  await completed(learnerB.id, lessons[0].versionId);

  const legacyTitle = `C6 legacy ${randomBytes(3).toString('hex')}`;
  await ctx.queryTestDb("INSERT INTO exam_paper (business_scope,mode,title,total_score,pass_score,duration_minutes,max_attempts,partial_credit_ratio,status,created_by) VALUES ('regulation','fixed',?,100,60,30,3,0.5,'published',?)", [legacyTitle, adminRow.id]);
  const legacyPaper = await one(ctx, 'SELECT id FROM exam_paper WHERE title = ?', [legacyTitle]);
  await insertRecord(ctx, { paperId: legacyPaper.id, releaseId: null, categoryId: null, rule: null, userId: learnerA.id, source: null, difficulty: null, attemptNo: 1, status: 'passed', score: 70, startedAt: '2026-10-21 08:00:00.000', deadlineAt: '2026-10-21 08:30:00.000', submittedAt: '2026-10-21 08:10:00.000', method: null, gradingState: 'finalized', gradedAt: null });
  await ctx.queryTestDb("UPDATE exam_record SET snapshot_origin = 'legacy_unavailable' WHERE paper_id = ?", [legacyPaper.id]);

  const mixedTitle = `C6 mixed ${randomBytes(3).toString('hex')}`;
  await ctx.queryTestDb("INSERT INTO exam_paper (business_scope,mode,category_id,rule_config,title,total_score,pass_score,duration_minutes,max_attempts,partial_credit_ratio,status,created_by) VALUES ('training','fixed',?,?,?,100,60,30,3,0.5,'published',?)", [category.id, JSON.stringify(rule), mixedTitle, adminRow.id]);
  const mixedPaper = await one(ctx, 'SELECT id FROM exam_paper WHERE title = ?', [mixedTitle]);
  await ctx.queryTestDb("INSERT INTO paper_release (paper_id,version_no,business_scope,mode,category_id,requires_learning,rule_snapshot,created_by) VALUES (?,1,'training','fixed',?,0,?,?)", [mixedPaper.id, category.id, JSON.stringify(rule), adminRow.id]);
  const mixedRelease = await one(ctx, 'SELECT id FROM paper_release WHERE paper_id = ?', [mixedPaper.id]);
  await ctx.queryTestDb("INSERT INTO paper_release_question (release_id,question_id,question_version_id,concept_id,type,difficulty,score_cents,position,snapshot_json) VALUES (?,900001,910001,NULL,'single','easy',5000,0,'{}'),(?,900002,910002,NULL,'single','hard',5000,1,'{}')", [mixedRelease.id, mixedRelease.id]);
  await insertRecord(ctx, { paperId: mixedPaper.id, releaseId: mixedRelease.id, categoryId: category.id, rule, userId: learnerA.id, source: 'institution', difficulty: 'mixed', attemptNo: 1, status: 'passed', score: 75, startedAt: '2026-10-21 09:00:00.000', deadlineAt: '2026-10-21 09:30:00.000', submittedAt: '2026-10-21 09:12:00.000', method: 'manual', gradingState: 'finalized', gradedAt: '2026-10-21 09:12:00.000' });

  const summary = await ctx.request(admin.actor, 'GET', `/statistics/training/summary?paper_id=${paper.id}&page=1&page_size=20`);
  assert.equal(summary.status, 200, JSON.stringify(summary));
  assert.deepEqual({
    release: String(summary.data.release_id), eligible: summary.data.eligible_count,
    eligibleStarted: summary.data.eligible_started_count, historical: summary.data.historical_started_count,
    historicalOnly: summary.data.historical_only_started_count, attempts: summary.data.submitted_attempts,
    users: summary.data.submitted_users, finalized: summary.data.finalized_users,
  }, {
    release: String(currentRelease.id), eligible: 4, eligibleStarted: 4, historical: 5,
    historicalOnly: 1, attempts: 7, users: 5, finalized: 3,
  });
  assert.equal(Object.hasOwn(summary.data, 'pending_users'), false);
  assert.equal(Object.hasOwn(summary.data, 'pending_attempts'), false);
  assert.equal(summary.data.participation_rate, 1);
  assert.deepEqual(summary.data.course_completion, { eligible_users: 2, required_lessons: 2, completed_users: 1, completion_rate: 0.5 });
  assert.deepEqual(summary.data.uncompleted_reasons, [
    { reason: 'learning_incomplete', users: 1 }, { reason: 'not_started', users: 0 },
    { reason: 'not_passed', users: 1 },
  ]);
  const easyGroup = summary.data.score_groups.find((item) => item.difficulty === 'easy');
  assert.deepEqual({ users: easyGroup.finalized_users, average: easyGroup.average_score, pass: easyGroup.pass_rate }, { users: 2, average: 80, pass: 1 });
  assert.deepEqual(summary.data.difficulty_composition, [{ difficulty: 'easy', users: 3 }, { difficulty: 'hard', users: 2 }]);

  const noEligible = await ctx.request(admin.actor, 'GET', `/statistics/training/summary?paper_id=${paper.id}&category_id=${otherCategory.id}&page=1&page_size=20`);
  assert.equal(noEligible.status, 200);
  assert.equal(noEligible.data.eligible_count, 0);
  assert.equal(noEligible.data.participation_rate, null);

  const missingDifficulty = await ctx.request(admin.actor, 'GET', `/statistics/training/ranking?paper_id=${paper.id}&page=1&page_size=20`);
  assert.equal(missingDifficulty.status, 400, 'ranking without difficulty must be rejected');
  const easyRanking = await ctx.request(admin.actor, 'GET', `/statistics/training/ranking?paper_id=${paper.id}&difficulty=easy&page=1&page_size=20`);
  assert.equal(easyRanking.status, 200, JSON.stringify(easyRanking));
  assert.deepEqual(easyRanking.data.items.map((item) => [item.rank, item.name, item.score]), [[1, '学员B', 80], [1, '学员A', 80]]);
  assert.deepEqual(easyRanking.data.items.map((item) => item.duration_seconds), [600, 600]);
  assert.equal(easyRanking.data.items.some((item) => item.name === '调离E'), false, 'prior release/different rule leaked into ranking');
  const hardRanking = await ctx.request(admin.actor, 'GET', `/statistics/training/ranking?paper_id=${paper.id}&difficulty=hard&page=1&page_size=20`);
  assert.equal(hardRanking.data.items[0].duration_seconds, 1800, 'timeout duration included post-deadline wait');

  const legacyRanking = await ctx.request(admin.actor, 'GET', `/statistics/training/ranking?paper_id=${legacyPaper.id}&difficulty=unknown&page=1&page_size=20`);
  assert.equal(legacyRanking.status, 200);
  assert.deepEqual(legacyRanking.data.items.map((item) => [item.difficulty, item.score]), [['unknown', 70]]);
  const mixedRanking = await ctx.request(admin.actor, 'GET', `/statistics/training/ranking?paper_id=${mixedPaper.id}&difficulty=mixed&page=1&page_size=20`);
  assert.equal(mixedRanking.status, 200);
  assert.deepEqual(mixedRanking.data.items.map((item) => [item.difficulty, item.score]), [['mixed', 75]]);

  const page = await ctx.request(admin.actor, 'GET', `/statistics/training/ranking?paper_id=${paper.id}&difficulty=easy&page=1&page_size=1`);
  const exported = await ctx.request(admin.actor, 'GET', `/statistics/training/export?paper_id=${paper.id}&difficulty=easy&page=1&page_size=1`);
  assert.equal(exported.status, 200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported.body);
  const sheet = workbook.getWorksheet('成绩排名');
  assert.equal(sheet.rowCount, 2);
  assert.deepEqual({
    rank: sheet.getCell('A2').value,
    user_id: String(sheet.getCell('B2').value),
    name: sheet.getCell('C2').value,
    score: sheet.getCell('F2').value,
    record_id: String(sheet.getCell('H2').value),
  }, {
    rank: page.data.items[0].rank,
    user_id: page.data.items[0].user_id,
    name: page.data.items[0].name,
    score: page.data.items[0].score,
    record_id: page.data.items[0].record_id,
  });
  assert.match(String(workbook.getWorksheet('口径说明').getCell('A1').value), /当前发布版本/);

  const narrowLogin = await login(ctx, narrow.username, admin.password);
  const dashboard = await ctx.request(narrowLogin.actor, 'GET', '/admin/dashboard');
  assert.equal(dashboard.status, 200);
  assert.deepEqual(Object.keys(dashboard.data.metrics).sort(), [
    'today_participant_count', 'today_attempt_count', 'last_7_days_participant_count', 'last_7_days_attempt_count',
  ].sort(), 'statistics-only actors receive participation metrics and no business-list metrics');
  for (const value of Object.values(dashboard.data.metrics)) assert.ok(Number.isInteger(value) && value >= 0);
  assert.equal(dashboard.data.timezone, 'Asia/Shanghai');
  assert.equal(Array.isArray(dashboard.data.exam_trend), true);
  const narrowOptions = await ctx.request(narrowLogin.actor, 'GET', '/statistics/training/options');
  assert.equal(narrowOptions.status, 200);
  assert.equal(narrowOptions.data.papers.some((item) => String(item.id) === String(paper.id)), true);
  const forbiddenExport = await ctx.request(narrowLogin.actor, 'GET', `/statistics/training/export?paper_id=${paper.id}&difficulty=easy&page=1&page_size=20`);
  assert.equal(forbiddenExport.status, 403);

  const adminDashboard = await ctx.request(admin.actor, 'GET', '/admin/dashboard');
  assert.equal(adminDashboard.status, 200);
  assert.equal(adminDashboard.data.metrics.learner_count, 3, 'dashboard learner scope should exclude business-role learner A');
  assert.equal(Object.hasOwn(adminDashboard.data.metrics, 'pending_grading_count'), false);
  assert.equal(typeof adminDashboard.data.metrics.question_count, 'number');
  assert.equal(typeof adminDashboard.data.metrics.paper_count, 'number');
  assert.equal(adminDashboard.data.exam_trend.length, 7);
  for (const point of adminDashboard.data.exam_trend) {
    const dayStart = Date.parse(`${point.date}T00:00:00+08:00`);
    const sqlTime = value => new Date(value).toISOString().replace('T', ' ').replace('Z', '');
    const [raw] = await ctx.queryTestDb('SELECT COUNT(*) AS attempts FROM exam_record WHERE started_at >= ? AND started_at < ?',
      [sqlTime(dayStart), sqlTime(dayStart + 86400000)]);
    assert.equal(point.count, Number(raw.attempts), `legacy dashboard counts every raw record on ${point.date}`);
  }

  const unknownQuery = await ctx.request(admin.actor, 'GET', `/statistics/training/summary?paper_id=${paper.id}&unknown=1`);
  assert.equal(unknownQuery.status, 400, 'unknown statistics query key must be rejected');
  const navigation = await ctx.request(admin.actor, 'GET', '/admin/menus/navigation');
  const routes = flattenNavigation(navigation.data).map((item) => item.route_path).filter(Boolean);
  assert.ok(routes.includes('/admin/dashboard'));
  assert.ok(routes.includes('/admin/training-statistics'));
  const learnerActor = await learnerSession(ctx, learnerB.id);
  await assertTrainingOverviewAndSorting(ctx, admin, adminRow.id, narrowLogin.actor, learnerActor);
  await assertLegacyPureTimeoutStatistics(ctx, admin, adminRow.id);
  await assertPublicStatistics(ctx, admin, adminRow.id);
}
