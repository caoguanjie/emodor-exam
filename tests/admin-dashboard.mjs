import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  seedAdminDashboardFixture, dashboardRequest, completeDashboardExam,
  expectedDashboardParticipation, shanghaiDate, utcSql,
} from './support/admin-dashboard-fixtures.mjs';
import { captureDashboardQueryPlans } from './support/admin-dashboard-query-plans.mjs';

async function factSnapshot(ctx) {
  const tables = ['exam_record', 'exam_answer', 'video_learning_record'];
  return Promise.all(tables.map(table => ctx.queryTestDb(`SELECT * FROM ${table} ORDER BY id`)));
}

function assertParticipation(overview, fixture) {
  const today = expectedDashboardParticipation(fixture.records, overview.periods.today.date_from, overview.periods.today.date_to);
  const week = expectedDashboardParticipation(fixture.records, overview.periods.last_7_days.date_from, overview.periods.last_7_days.date_to);
  assert.equal(overview.timezone, 'Asia/Shanghai');
  assert.ok(Number.isFinite(Date.parse(overview.as_of)));
  assert.equal(overview.metrics.today_participant_count, today.people);
  assert.equal(overview.metrics.today_attempt_count, today.attempts);
  assert.equal(overview.metrics.last_7_days_participant_count, week.people);
  assert.equal(overview.metrics.last_7_days_attempt_count, week.attempts);
  for (const [key, value] of Object.entries(fixture.expected)) assert.equal(overview.metrics[key], value, key);
}

async function assertTrend(ctx, fixture, days) {
  const trend = await dashboardRequest(ctx, fixture.admin, 'GET', `/admin/dashboard/exam-trend?days=${days}`);
  assert.equal(trend.days, days);
  assert.equal(trend.timezone, 'Asia/Shanghai');
  assert.equal(trend.points.length, days);
  assert.equal(trend.points.at(-1).date, trend.date_to);
  const firstByPersonDay = new Map();
  for (const record of fixture.records.filter(r => r.visible).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || Number(BigInt(a.id) - BigInt(b.id)))) {
    const date = shanghaiDate(record.startedAt);
    const key = `${date}:${record.userId}`;
    if (!firstByPersonDay.has(key)) firstByPersonDay.set(key, { date, source: record.source });
  }
  for (const point of trend.points) {
    const rows = [...firstByPersonDay.values()].filter(r => r.date === point.date);
    assert.deepEqual(point, { date: point.date, participant_count: rows.length,
      institution_count: rows.filter(r => r.source === 'institution').length,
      external_count: rows.filter(r => r.source === 'external').length,
      unknown_source_count: rows.filter(r => !['institution', 'external'].includes(r.source)).length });
  }
}

async function verifyPermissionsAndInputs(ctx, fixture) {
  const paths = ['/admin/dashboard', '/admin/dashboard/exam-trend', '/admin/dashboard/learning-options',
    `/admin/dashboard/learning-summary?paper_id=${fixture.learningPaper.id}&release_id=${fixture.learningPaper.releaseId}`, '/admin/dashboard/recent-exams'];
  for (const path of paths) assert.equal((await ctx.request(null, 'GET', path)).status, 401, path);
  const student = await dashboardRequest(ctx, fixture.studentsOnly.actor, 'GET', paths[0]);
  assert.deepEqual(Object.keys(student.metrics).sort(), ['learner_count', 'learner_external_count', 'learner_institution_count', 'learner_unknown_source_count'].sort());
  assert.equal(Object.hasOwn(student, 'exam_trend'), false);
  const stats = await dashboardRequest(ctx, fixture.statsOnly.actor, 'GET', paths[0]);
  assert.deepEqual(Object.keys(stats.metrics).sort(), ['today_participant_count', 'today_attempt_count', 'last_7_days_participant_count', 'last_7_days_attempt_count'].sort());
  for (const path of paths.slice(1)) {
    await dashboardRequest(ctx, fixture.statsOnly.actor, 'GET', path);
    const denied = await ctx.request(fixture.studentsOnly.actor, 'GET', path);
    assert.equal(denied.status, 403, path);
    assert.equal(denied.code, 40301, path);
  }
  for (const path of [
    '/admin/dashboard/exam-trend?days=14', '/admin/dashboard/exam-trend?days=7&days=30',
    '/admin/dashboard/exam-trend?days[bad]=7', '/admin/dashboard/exam-trend?extra=1',
    '/admin/dashboard/learning-options?page=0', '/admin/dashboard/learning-options?page_size=101',
    '/admin/dashboard/learning-options?page=1&page=2', '/admin/dashboard/learning-options?extra=1',
    '/admin/dashboard/learning-summary?paper_id=-1&release_id=1',
    '/admin/dashboard/learning-summary?paper_id=1', '/admin/dashboard/recent-exams?limit=100',
  ]) {
    assert.equal((await ctx.request(fixture.admin, 'GET', path)).code, 40001, path);
  }
  assert.equal((await ctx.request(fixture.admin, 'GET', `/admin/dashboard/learning-summary?paper_id=${fixture.learningPaper.id}&release_id=${fixture.openPaper.releaseId}`)).code, 40401);
}

export async function run(ctx) {
  let stage = 'fixture';
  try {
    const f = await seedAdminDashboardFixture(ctx);
    stage = 'overview and independent event oracle';
    const beforeFacts = await factSnapshot(ctx);
    const overview = await dashboardRequest(ctx, f.admin, 'GET', '/admin/dashboard');
    assertParticipation(overview, f);
    assert.ok(Array.isArray(overview.exam_trend), 'legacy attempt trend retained');
    stage = 'daily deduplication and frozen source';
    await assertTrend(ctx, f, 7);
    await assertTrend(ctx, f, 30);
    stage = 'learning candidates and exact credited threshold';
    const options = await dashboardRequest(ctx, f.admin, 'GET', '/admin/dashboard/learning-options');
    assert.deepEqual([options.page, options.page_size, options.total], [1, 20, 2]);
    assert.equal(options.items[0].paper_id, f.learningPaper.id);
    for (const item of options.items) {
      assert.equal(typeof item.paper_id, 'string'); assert.equal(typeof item.release_id, 'string');
    }
    const page2 = await dashboardRequest(ctx, f.admin, 'GET', '/admin/dashboard/learning-options?page=2&page_size=1');
    assert.equal(page2.items[0].paper_id, f.emptyPaper.id);
    const none = await dashboardRequest(ctx, f.admin, 'GET', '/admin/dashboard/learning-options?keyword=missing-training');
    assert.deepEqual(none.items, []);
    const summaryPath = `/admin/dashboard/learning-summary?paper_id=${f.learningPaper.id}&release_id=${f.learningPaper.releaseId}`;
    const learning = await dashboardRequest(ctx, f.admin, 'GET', summaryPath);
    assert.deepEqual([learning.state, learning.eligible_count, learning.achieved_count, learning.pending_count, learning.achievement_rate, learning.required_learning_minutes], ['ready', 4, 2, 2, 0.5, 2]);
    const empty = await dashboardRequest(ctx, f.admin, 'GET', `/admin/dashboard/learning-summary?paper_id=${f.emptyPaper.id}&release_id=${f.emptyPaper.releaseId}`);
    assert.deepEqual([empty.state, empty.eligible_count, empty.achievement_rate], ['no_audience', 0, null]);
    stage = 'recent publication and compatible best scores';
    const recent = await dashboardRequest(ctx, f.admin, 'GET', '/admin/dashboard/recent-exams');
    assert.equal(recent.limit, 4);
    assert.deepEqual(recent.items.map(row => row.paper_id), [f.learningPaper.id, f.openPaper.id, f.archivedPaper.id, f.withdrawnPaper.id]);
    assert.deepEqual([recent.items[0].participant_count, recent.items[0].finalized_users, recent.items[0].average_score], [2, 2, 80]);
    assert.equal(recent.items[2].status, 'archived'); assert.equal(recent.items[2].average_score, null);
    const existingOverview = await dashboardRequest(ctx, f.admin, 'GET', '/statistics/training/overview');
    assert.ok(existingOverview.items.every(row => row.status === 'published'));
    stage = 'read-only business facts';
    assert.deepEqual(await factSnapshot(ctx), beforeFacts, 'dashboard reads must not write learning/exam/score facts');
    stage = 'DTO and permissions';
    await verifyPermissionsAndInputs(ctx, f);
    stage = 'real start and whole-paper submit';
    const completed = await completeDashboardExam(ctx, f);
    const after = await dashboardRequest(ctx, f.admin, 'GET', '/admin/dashboard');
    assert.equal(after.metrics.today_attempt_count, overview.metrics.today_attempt_count + 1);
    assert.equal(after.metrics.today_participant_count, overview.metrics.today_participant_count + 1);
    const records = await dashboardRequest(ctx, f.admin, 'GET', `/admin/exam-records?date_from=${after.periods.today.date_from}&date_to=${after.periods.today.date_to}&page_size=100`);
    assert.equal(records.total, after.metrics.today_attempt_count);
    assert.ok(records.items.some(row => row.record_id === completed.recordId));
    const recentAfter = await dashboardRequest(ctx, f.admin, 'GET', '/admin/dashboard/recent-exams');
    assert.equal(recentAfter.items.find(row => row.paper_id === f.openPaper.id).participant_count, recent.items.find(row => row.paper_id === f.openPaper.id).participant_count + 1);
    stage = 'production SELECT query plans';
    await captureDashboardQueryPlans(ctx, f);
    stage = 'course replacement and version conflict';
    const next = await ctx.queryTestDb('INSERT INTO lesson_version(lesson_id,version_no,asset_id,duration_ms,created_by) VALUES (?,2,1,3600000,?)', [f.course.lessonId, f.admin.userId]);
    await ctx.queryTestDb('UPDATE course_lesson SET current_version_id=? WHERE id=?', [next.insertId, f.course.lessonId]);
    const changed = await dashboardRequest(ctx, f.admin, 'GET', summaryPath);
    assert.deepEqual([changed.eligible_count, changed.achieved_count, changed.pending_count], [4, 0, 4]);
    await ctx.queryTestDb("UPDATE training_course SET status='offline' WHERE id=?", [f.course.id]);
    assert.equal((await dashboardRequest(ctx, f.admin, 'GET', '/admin/dashboard/learning-options')).total, 2, 'course availability does not erase a frozen requirement');
    await ctx.queryTestDb("UPDATE exam_paper SET status='withdrawn' WHERE id=?", [f.learningPaper.id]);
    assert.equal((await ctx.request(f.admin, 'GET', summaryPath)).code, 40970);
    await ctx.queryTestDb("UPDATE exam_paper SET status='published' WHERE id=?", [f.learningPaper.id]);
    await ctx.queryTestDb(`INSERT INTO paper_release(paper_id,version_no,business_scope,mode,category_id,requires_learning,required_learning_minutes,course_ids,rule_snapshot,created_by)
      SELECT paper_id,version_no+1,business_scope,mode,category_id,requires_learning,required_learning_minutes,course_ids,rule_snapshot,created_by FROM paper_release WHERE id=?`, [f.learningPaper.releaseId]);
    assert.equal((await ctx.request(f.admin, 'GET', summaryPath)).code, 40970, 'old release invalid after republishing');
    console.log('[admin-dashboard] API contracts, permissions, independent data reconciliation and real submission passed');
    if (process.env.DASHBOARD_PERF === '1') await verifyDashboardPerformance(ctx, f);
  } catch (error) {
    error.message = `[admin-dashboard: ${stage}] ${error.message}`;
    throw error;
  }
}

async function verifyDashboardPerformance(ctx, f) {
  // The runner owns this database; all generated histories are discarded with it.
  const started = performance.now();
  // Earlier correctness cases replaced the video and took its course offline.
  // Restore the actual effective set so this measurement includes credited_ms aggregation.
  await ctx.queryTestDb("UPDATE training_course SET status='published' WHERE id=?", [f.course.id]);
  await ctx.queryTestDb('UPDATE course_lesson SET current_version_id=? WHERE id=?', [f.course.versionId, f.course.lessonId]);
  const [latest] = await ctx.queryTestDb('SELECT id FROM paper_release WHERE paper_id=? ORDER BY version_no DESC LIMIT 1', [f.learningPaper.id]);
  const summaryPath = `/admin/dashboard/learning-summary?paper_id=${f.learningPaper.id}&release_id=${latest.id}`;
  const baseline = await dashboardRequest(ctx, f.admin, 'GET', summaryPath);
  assert.deepEqual([baseline.eligible_count, baseline.achieved_count], [4, 2], 'effective original video is restored before performance seeding');
  for (let batch = 0; batch < 10; batch++) {
    const rows = Array.from({ length: 1000 }, (_, i) => [
      `dashboard_perf_${batch}_${i}`, `规模学员${batch * 1000 + i}`, f.categoryId, i % 2 ? 'institution' : 'external',
    ]);
    const values = rows.map(() => "(?,(SELECT password_hash FROM (SELECT password_hash FROM sys_user WHERE id=?) AS password_seed),?,?,?,'employee',1,0)").join(',');
    const params = rows.flatMap(([username, name, category, source]) => [username, f.admin.userId, name, category, source]);
    await ctx.queryTestDb(`INSERT INTO sys_user(username,password_hash,real_name,category_id,source,role,status,force_password_change) VALUES ${values}`, params);
  }
  const users = await ctx.queryTestDb("SELECT id,source FROM sys_user WHERE username LIKE 'dashboard_perf_%' ORDER BY id");
  assert.equal(users.length, 10000);
  let seededLearningRows = 0;
  let seededAchieved = 0;
  for (let batch = 0; batch < users.length; batch += 500) {
    const group = users.slice(batch, batch + 500);
    const values = group.flatMap(() => Array(10).fill("(?,?,?,?,'easy',?,'release',?,'failed',20,?,? ,?,'manual','finalized',?)")).join(',');
    const params = group.flatMap((user, offset) => Array.from({ length: 10 }, (_, i) => {
      const date = utcSql(f.dayStart - ((batch + offset + i) % 30) * 86400000);
      return [f.openPaper.id, String(user.id), f.openPaper.releaseId, user.source, JSON.stringify(f.openPaper.rule), i + 1, date, date, date, date];
    }).flat());
    await ctx.queryTestDb(`INSERT INTO exam_record(paper_id,user_id,release_id,source,difficulty,rule_snapshot,snapshot_origin,attempt_no,status,score,started_at,deadline_at,submitted_at,submission_method,grading_state,graded_at) VALUES ${values}`, params);
    // One quarter have no record; the others straddle the exact millisecond threshold.
    const learning = group.flatMap((user, index) => (batch + index) % 4 === 0 ? [] : [{
      userId: String(user.id), creditedMs: (batch + index) % 2 ? 120000 : 119999,
    }]);
    seededLearningRows += learning.length;
    seededAchieved += learning.filter(row => row.creditedMs >= 120000).length;
    await ctx.queryTestDb(`INSERT INTO video_learning_record(user_id,lesson_version_id,duration_ms,credited_ms,coverage_intervals,coverage_ms,confirmed_position_ms,is_completed) VALUES ${learning.map(() => "(?,?,3600000,?,'[]',0,0,0)").join(',')}`, learning.flatMap(row => [row.userId, f.course.versionId, row.creditedMs]));
  }
  const [actual] = await ctx.queryTestDb(`SELECT COUNT(*) AS attempts, COUNT(DISTINCT record.user_id) AS people
    FROM exam_record record INNER JOIN sys_user learner ON learner.id=record.user_id WHERE learner.username LIKE 'dashboard_perf_%'`);
  assert.deepEqual([Number(actual.people), Number(actual.attempts)], [10000, 100000]);
  const populated = await dashboardRequest(ctx, f.admin, 'GET', summaryPath);
  assert.deepEqual([populated.eligible_count, populated.achieved_count, populated.pending_count],
    [baseline.eligible_count + users.length, baseline.achieved_count + seededAchieved, baseline.pending_count + users.length - seededAchieved]);
  assert.equal(seededLearningRows, 7500);
  await captureDashboardQueryPlans(ctx, f, { releaseId: String(latest.id), scenario: 'perf' });
  const paths = ['/admin/dashboard/exam-trend?days=30', summaryPath, '/admin/dashboard/recent-exams'];
  for (const path of paths) {
    for (let i = 0; i < 5; i++) await dashboardRequest(ctx, f.admin, 'GET', path);
    const times = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now(); await dashboardRequest(ctx, f.admin, 'GET', path); times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1];
    console.log(`[admin-dashboard:perf] ${path.split('?')[0]} samples=50 p95_ms=${p95.toFixed(1)}`);
    assert.ok(p95 <= 3000, `statistics P95 exceeds 3 seconds: ${p95.toFixed(1)}ms`);
  }
  console.log(`[admin-dashboard:perf] seeded_people=${Number(actual.people)} seeded_attempts=${Number(actual.attempts)} learning_rows=${seededLearningRows} no_learning_rows=${users.length - seededLearningRows} eligible=${populated.eligible_count} achieved=${populated.achieved_count} pending=${populated.pending_count} elapsed_seconds=${((performance.now() - started) / 1000).toFixed(1)}`);
}
