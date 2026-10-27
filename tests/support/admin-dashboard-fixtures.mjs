import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { captchaLogin, randomStrongPassword } from '../training-access.mjs';
import { examLearner, wholeAnswers } from './exam-mobile-fixtures.mjs';

export async function dashboardRequest(ctx, actor, method, path, body) {
  const result = await ctx.request(actor, method, path, body);
  assert.equal(result.status, 200, `${method} ${path}: HTTP ${result.status}, code ${result.code}`);
  return result.data;
}

export const utcSql = date => new Date(date).toISOString().replace('T', ' ').replace('Z', '');
export const shanghaiDate = date => new Date(new Date(date).getTime() + 8 * 3600000).toISOString().slice(0, 10);

export async function insertDashboardUser(ctx, adminId, { label, categoryId = null, source = 'institution', status = 1 }) {
  const result = await ctx.queryTestDb(`INSERT INTO sys_user
    (username,password_hash,real_name,category_id,source,role,status,force_password_change)
    SELECT ?,password_hash,?,?,?,'employee',?,0 FROM sys_user WHERE id=?`,
  [`dashboard_${label}_${randomBytes(4).toString('hex')}`, label, categoryId, source, status, adminId]);
  const [user] = await ctx.queryTestDb('SELECT id,username,real_name FROM sys_user WHERE id=?', [result.insertId]);
  return { ...user, id: String(user.id), categoryId, source, status };
}

export async function createDashboardRoleActor(ctx, fixture, label, permissions) {
  const role = await dashboardRequest(ctx, fixture.admin, 'POST', '/admin/roles', {
    code: `dashboard_${randomBytes(6).toString('hex')}`, name: label, permissions,
  });
  const user = await insertDashboardUser(ctx, fixture.admin.userId, { label, categoryId: fixture.categoryId });
  await ctx.queryTestDb('INSERT INTO sys_user_role(user_id,role_id) VALUES (?,?)', [user.id, role.id]);
  await ctx.queryTestDb('UPDATE sys_user SET roles_configured=1 WHERE id=?', [user.id]);
  const { actor } = await captchaLogin(ctx, user.username, fixture.adminPassword);
  return { actor, roleId: String(role.id), username: user.username, password: fixture.adminPassword, userId: user.id };
}

async function course(ctx, categoryId, adminId, title) {
  const c = await ctx.queryTestDb("INSERT INTO training_course(title,category_id,status,created_by,published_at) VALUES (?,?,'published',?,UTC_TIMESTAMP(3))", [title, categoryId, adminId]);
  const chapter = await ctx.queryTestDb('INSERT INTO course_chapter(course_id,title) VALUES (?,?)', [c.insertId, '必修课程']);
  const lesson = await ctx.queryTestDb("INSERT INTO course_lesson(course_id,chapter_id,title,lesson_type,is_required) VALUES (?,?,?,'video',0)", [c.insertId, chapter.insertId, title]);
  const version = await ctx.queryTestDb('INSERT INTO lesson_version(lesson_id,version_no,asset_id,duration_ms,created_by) VALUES (?,1,1,3600000,?)', [lesson.insertId, adminId]);
  await ctx.queryTestDb('UPDATE course_lesson SET current_version_id=? WHERE id=?', [version.insertId, lesson.insertId]);
  return { id: String(c.insertId), lessonId: String(lesson.insertId), versionId: String(version.insertId) };
}

export async function addDashboardRecord(ctx, fixture, values) {
  const paper = values.paper || fixture.learningPaper;
  const status = values.status || 'passed';
  const scored = !['in_progress', 'submitted'].includes(status) && !(status === 'timeout' && !values.legacyScoredTimeout);
  const startedAt = new Date(values.startedAt || fixture.todayInstant);
  const record = {
    paperId: paper.id, releaseId: paper.releaseId, rule: paper.rule,
    userId: String(values.userId), source: values.source ?? null,
    status, score: scored ? values.score ?? 90 : status === 'timeout' ? 0 : null,
    gradingState: scored ? 'finalized' : status === 'submitted' ? 'pending_manual' : 'not_submitted',
    startedAt: startedAt.toISOString(), visible: status !== 'submitted' && !values.legacyScoredTimeout,
  };
  const finalAt = scored || status === 'submitted' ? utcSql(startedAt.getTime() + 1000) : null;
  const result = await ctx.queryTestDb(`INSERT INTO exam_record
    (paper_id,user_id,release_id,source,category_id,difficulty,rule_snapshot,snapshot_origin,attempt_no,status,score,
     started_at,deadline_at,submitted_at,submission_method,grading_state,graded_at)
    VALUES (?,?,?,?,?,'easy',?,'release',?,?,?,?,?,?,?,?,?)`,
  [record.paperId, record.userId, record.releaseId, record.source, paper.categoryId, JSON.stringify(record.rule),
    values.attemptNo || 1, record.status, record.score, utcSql(startedAt), utcSql(Date.now() + 3600000), finalAt,
    scored ? (values.legacyScoredTimeout ? 'timeout' : 'manual') : status === 'submitted' ? 'manual' : null,
    record.gradingState, scored ? finalAt : null]);
  record.id = String(result.insertId);
  fixture.records.push(record);
  return record;
}

export async function seedAdminDashboardFixture(ctx) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_[A-Za-z0-9_]+$/);
  const first = await captchaLogin(ctx, 'admin', ctx.adminPassword);
  let adminPassword = ctx.adminPassword;
  if (first.result.data.force_change_password) {
    adminPassword = randomStrongPassword('admin', 'dashboard');
    const changed = await dashboardRequest(ctx, first.actor, 'PUT', '/auth/password', { old_password: ctx.adminPassword, new_password: adminPassword });
    first.actor.accessToken = changed.access_token;
  }
  first.actor.userId = String(first.result.data.user.id);
  const fixture = { admin: first.actor, adminPassword, records: [], papers: [] };
  const category = await dashboardRequest(ctx, fixture.admin, 'POST', '/admin/training-categories', { name: '运营看板安全培训' });
  const emptyCategory = await dashboardRequest(ctx, fixture.admin, 'POST', '/admin/training-categories', { name: '运营看板空应学范围' });
  fixture.categoryId = String(category.id);
  fixture.emptyCategoryId = String(emptyCategory.id);
  fixture.course = await course(ctx, fixture.categoryId, fixture.admin.userId, '安全生产必修视频');
  const emptyCourse = await course(ctx, fixture.emptyCategoryId, fixture.admin.userId, '空类别视频');
  const question = await dashboardRequest(ctx, fixture.admin, 'POST', '/ai/questions', {
    category_id: fixture.categoryId, difficulty: 'easy', type: 'single', stem: '<p>安全作业前首先做什么？</p>',
    options: [{ text: '检查安全条件' }, { text: '直接作业' }], answer: [0], analysis: '<p>先检查。</p>',
  });
  for (const [title, enabled, deleted] of [['停用题目', 0, false], ['已删除题目', 1, true]]) {
    const q = await dashboardRequest(ctx, fixture.admin, 'POST', '/ai/questions', {
      category_id: fixture.categoryId, difficulty: 'easy', type: 'single', stem: `<p>${title}</p>`,
      options: [{ text: '是' }, { text: '否' }], answer: [0], analysis: '<p>测试。</p>',
    });
    await ctx.queryTestDb(`UPDATE question SET is_enabled=?,deleted_at=${deleted ? 'UTC_TIMESTAMP(3)' : 'NULL'} WHERE id=?`, [enabled, q.id]);
  }
  const publish = async (title, requiresLearning) => {
    const p = await dashboardRequest(ctx, fixture.admin, 'POST', '/admin/papers', {
      title, mode: 'fixed', category_id: fixture.categoryId, requires_learning: requiresLearning,
      ...(requiresLearning ? { required_learning_minutes: 2, course_ids: [fixture.course.id] } : {}),
    });
    await dashboardRequest(ctx, fixture.admin, 'PUT', `/admin/papers/${p.id}/questions`, { items: [{ question_version_id: String(question.saved_version_id), score_cents: 10000 }] });
    const published = await dashboardRequest(ctx, fixture.admin, 'POST', `/admin/papers/${p.id}/publish`);
    const [release] = await ctx.queryTestDb('SELECT rule_snapshot FROM paper_release WHERE id=?', [published.release_id]);
    const row = { id: String(p.id), releaseId: String(published.release_id), title, categoryId: fixture.categoryId,
      rule: typeof release.rule_snapshot === 'string' ? JSON.parse(release.rule_snapshot) : release.rule_snapshot };
    fixture.papers.push(row);
    return row;
  };
  fixture.learningPaper = await publish('安全生产基础培训', true);
  fixture.openPaper = await publish('外来人员直接考试', false);
  const extraPaper = async (title, status, categoryId, learningCourseId = null) => {
    const p = await ctx.queryTestDb(`INSERT INTO exam_paper
      (business_scope,mode,category_id,title,status,total_score,pass_score,duration_minutes,max_attempts,created_by)
      VALUES ('training','fixed',?,?,?,100,60,30,3,?)`, [categoryId, title, status, fixture.admin.userId]);
    const r = await ctx.queryTestDb(`INSERT INTO paper_release
      (paper_id,version_no,business_scope,mode,category_id,requires_learning,required_learning_minutes,course_ids,rule_snapshot,created_by)
      VALUES (?,1,'training','fixed',?,?,?,?,?,?)`, [p.insertId, categoryId, learningCourseId ? 1 : 0,
      learningCourseId ? 2 : null, JSON.stringify(learningCourseId ? [learningCourseId] : []), JSON.stringify(fixture.openPaper.rule), fixture.admin.userId]);
    const row = { id: String(p.insertId), releaseId: String(r.insertId), categoryId, title, rule: fixture.openPaper.rule };
    fixture.papers.push(row);
    return row;
  };
  fixture.emptyPaper = await extraPaper('无人应学的必修培训', 'published', fixture.emptyCategoryId, emptyCourse.id);
  fixture.archivedPaper = await extraPaper('新入职人员安全培训（已归档）', 'archived', fixture.categoryId);
  fixture.withdrawnPaper = await extraPaper('消防安全专项培训（已撤回）', 'withdrawn', fixture.categoryId);
  await dashboardRequest(ctx, fixture.admin, 'POST', '/admin/papers', { title: '未发布草稿', mode: 'fixed', category_id: fixture.categoryId });
  await ctx.queryTestDb("INSERT INTO exam_paper(business_scope,mode,title,status,created_by) VALUES ('regulation','fixed','旧制度试卷','draft',?)", [fixture.admin.userId]);
  // Stable distinct publication order: the latest required option is the main training.
  const now = Date.now();
  for (const [i, paper] of [fixture.learningPaper, fixture.openPaper, fixture.archivedPaper, fixture.withdrawnPaper, fixture.emptyPaper].entries()) {
    await ctx.queryTestDb('UPDATE paper_release SET released_at=? WHERE id=?', [utcSql(now - i * 60000), paper.releaseId]);
  }
  fixture.day = shanghaiDate(now);
  fixture.dayStart = new Date(`${fixture.day}T00:00:00+08:00`).getTime();
  fixture.todayInstant = new Date(fixture.dayStart + Math.max(0, Math.min(3600000, now - fixture.dayStart - 1000)));
  fixture.learners = [];
  for (const [label, source] of [['本机构甲', 'institution'], ['本机构乙', 'institution'], ['外来丙', 'external']]) {
    fixture.learners.push(await insertDashboardUser(ctx, fixture.admin.userId, { label, categoryId: fixture.categoryId, source }));
  }
  fixture.examActor = await examLearner(ctx, { categoryId: fixture.categoryId, source: 'external' });
  fixture.learners.push({ id: fixture.examActor.userId, categoryId: fixture.categoryId, source: 'external', status: 1 });
  fixture.unknown = await insertDashboardUser(ctx, fixture.admin.userId, { label: '历史未知来源', categoryId: fixture.categoryId, source: null });
  fixture.disabled = await insertDashboardUser(ctx, fixture.admin.userId, { label: '停用学员', categoryId: fixture.categoryId, status: 0 });
  fixture.statsOnly = await createDashboardRoleActor(ctx, fixture, '仅统计管理员', ['statistics:read']);
  fixture.studentsOnly = await createDashboardRoleActor(ctx, fixture, '仅学员管理员', ['students:read']);
  for (const [i, milliseconds] of [0, 119999, 120000, 120001].entries()) {
    if (!milliseconds) continue;
    await ctx.queryTestDb(`INSERT INTO video_learning_record
      (user_id,lesson_version_id,duration_ms,credited_ms,coverage_intervals,coverage_ms,confirmed_position_ms,is_completed)
      VALUES (?,?,3600000,?,'[]',0,0,0)`, [fixture.learners[i].id, fixture.course.versionId, milliseconds]);
  }
  const a = fixture.learners[0].id;
  await addDashboardRecord(ctx, fixture, { userId: a, source: 'institution', score: 40 });
  await addDashboardRecord(ctx, fixture, { userId: a, source: 'external', score: 90, attemptNo: 2 });
  await addDashboardRecord(ctx, fixture, { userId: fixture.learners[1].id, source: 'institution', score: 70 });
  await addDashboardRecord(ctx, fixture, { userId: a, source: 'institution', score: 80, attemptNo: 3, startedAt: new Date(fixture.dayStart - 1) });
  await addDashboardRecord(ctx, fixture, { paper: fixture.openPaper, userId: fixture.unknown.id, status: 'timeout' });
  await addDashboardRecord(ctx, fixture, { paper: fixture.openPaper, userId: fixture.disabled.id, source: 'institution', startedAt: new Date(fixture.dayStart - 2 * 86400000) });
  await addDashboardRecord(ctx, fixture, { paper: fixture.openPaper, userId: fixture.learners[2].id, source: 'external', status: 'submitted' });
  await addDashboardRecord(ctx, fixture, { paper: fixture.openPaper, userId: fixture.learners[2].id, source: 'external', status: 'timeout', legacyScoredTimeout: true, attemptNo: 2 });
  fixture.expected = { learner_count: 5, learner_institution_count: 2, learner_external_count: 2, learner_unknown_source_count: 1,
    question_count: 2, enabled_question_count: 1, paper_count: 6, published_paper_count: 3 };
  return fixture;
}

export async function completeDashboardExam(ctx, fixture) {
  const attempt = await dashboardRequest(ctx, fixture.examActor, 'POST', `/me/exams/${fixture.openPaper.id}/start`);
  await dashboardRequest(ctx, fixture.examActor, 'POST', `/me/exam-records/${attempt.record_id}/submit`, wholeAnswers(attempt));
  return { recordId: String(attempt.record_id), paperId: fixture.openPaper.id, releaseId: fixture.openPaper.releaseId };
}

// Expected values come from fixture events, never from the production aggregation helpers.
export function expectedDashboardParticipation(records, from, through) {
  const visible = records.filter(r => r.visible && shanghaiDate(r.startedAt) >= from && shanghaiDate(r.startedAt) <= through);
  return { people: new Set(visible.map(r => r.userId)).size, attempts: visible.length };
}
