import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './training-access.mjs';

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

export async function run(ctx) {
  ctx.reportOwnedRuntime?.({ stage: 'training-statistics-start', database: ctx.env.DB_DATABASE });
  const admin = await readyAdmin(ctx);
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
  const sheet = workbook.getWorksheet('难度排名');
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
  assert.deepEqual(dashboard.data.metrics, {});
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
  assert.ok(adminDashboard.data.exam_trend.reduce((sum, item) => sum + item.count, 0) >= 9);

  const unknownQuery = await ctx.request(admin.actor, 'GET', `/statistics/training/summary?paper_id=${paper.id}&unknown=1`);
  assert.equal(unknownQuery.status, 400, 'unknown statistics query key must be rejected');
  const navigation = await ctx.request(admin.actor, 'GET', '/admin/menus/navigation');
  const routes = flattenNavigation(navigation.data).map((item) => item.route_path).filter(Boolean);
  assert.ok(routes.includes('/admin/dashboard'));
  assert.ok(routes.includes('/admin/training-statistics'));
}
