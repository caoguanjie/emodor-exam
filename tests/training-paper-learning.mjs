import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './training-access.mjs';
import { assertAttemptView, examLearner, wholeAnswers } from './support/exam-mobile-fixtures.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');

async function adminLogin(ctx) {
  const headers = { 'X-Forwarded-For': '198.51.100.187' };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert.equal(captcha.status, 200);
  const redis = new Redis({ host: ctx.env.REDIS_HOST, port: Number(ctx.env.REDIS_PORT), password: ctx.env.REDIS_PASSWORD || undefined });
  let answer;
  try { answer = await redis.get(`${ctx.env.REDIS_KEY_PREFIX || ''}auth:captcha:${captcha.data.captcha_id}`); }
  finally { await redis.quit(); }
  const actor = {};
  const login = await ctx.request(actor, 'POST', '/auth/login', {
    username: 'admin', password: ctx.adminPassword, captcha_id: captcha.data.captcha_id, captcha_code: answer,
  }, headers);
  assert.equal(login.status, 200, 'isolated learning-gate administrator login');
  actor.accessToken = login.data.access_token;
  actor.userId = String(login.data.user.id);
  if (login.data.force_change_password) {
    const changed = await ctx.request(actor, 'PUT', '/auth/password', {
      old_password: ctx.adminPassword, new_password: randomStrongPassword('admin', '学习要求测试'),
    });
    assert.equal(changed.status, 200);
    actor.accessToken = changed.data.access_token;
  }
  return actor;
}

async function ok(ctx, actor, method, path, body) {
  const result = await ctx.request(actor, method, path, body);
  assert.equal(result.status, 200, `${method} ${path}: ${result.status}/${result.code} ${result.json?.message}`);
  return result.data;
}

async function insert(ctx, sql, params) {
  return String((await ctx.queryTestDb(sql, params)).insertId);
}

async function courseFixture(ctx, categoryId, adminId, label, status = 'published') {
  const courseId = await insert(ctx,
    'INSERT INTO training_course(title,category_id,status,created_by,published_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))',
    [label, categoryId, status, adminId]);
  const chapterId = await insert(ctx, 'INSERT INTO course_chapter(course_id,title) VALUES (?,?)', [courseId, '第一章']);
  // Optional video lessons also contribute: the requirement is total effective
  // time in selected courses, independent of the 95% course-completion metric.
  const lessonId = await insert(ctx,
    "INSERT INTO course_lesson(course_id,chapter_id,title,lesson_type,is_required) VALUES (?,?,?,'video',0)",
    [courseId, chapterId, label]);
  const versionId = await insert(ctx,
    'INSERT INTO lesson_version(lesson_id,version_no,asset_id,duration_ms,created_by) VALUES (?,1,1,180000,?)',
    [lessonId, adminId]);
  await ctx.queryTestDb('UPDATE course_lesson SET current_version_id=? WHERE id=?', [versionId, lessonId]);
  return { courseId, lessonId, versionId, chapterId };
}

async function learning(ctx, userId, versionId, creditedMs) {
  // Persisted learning facts are controlled fixtures. Playback timing itself is
  // covered by training-video-learning; this suite proves gate aggregation.
  await ctx.queryTestDb(
    'INSERT INTO video_learning_record(user_id,lesson_version_id,duration_ms,credited_ms,coverage_intervals,coverage_ms,confirmed_position_ms,is_completed) VALUES (?,?,180000,?,?,0,0,0)',
    [userId, versionId, creditedMs, '[]']);
}

async function assertNoAttempt(ctx, userId, paperId) {
  const [row] = await ctx.queryTestDb(
    'SELECT (SELECT COUNT(*) FROM exam_record WHERE user_id=? AND paper_id=?) AS records,(SELECT COUNT(*) FROM exam_assignment WHERE user_id=? AND paper_id=?) AS assignments',
    [userId, paperId, userId, paperId]);
  assert.equal(Number(row.records), 0);
  assert.equal(Number(row.assignments), 0);
}

export async function run(ctx) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_[A-Za-z0-9_]+$/);
  let stage = 'fixtures';
  try {
    const admin = await adminLogin(ctx);
    const category = await ok(ctx, admin, 'POST', '/admin/training-categories', { name: `考前学习 ${randomBytes(4).toString('hex')}` });
    const categoryId = String(category.id);
    const alpha = await courseFixture(ctx, categoryId, admin.userId, '累计课程甲');
    const beta = await courseFixture(ctx, categoryId, admin.userId, '累计课程乙');
    const unrelated = await courseFixture(ctx, categoryId, admin.userId, '未选择课程');
    const draft = await courseFixture(ctx, categoryId, admin.userId, '草稿课程', 'draft');
    const offline = await courseFixture(ctx, categoryId, admin.userId, '下架课程', 'offline');
    const question = await ok(ctx, admin, 'POST', '/ai/questions', {
      category_id: categoryId, difficulty: 'easy', type: 'single', stem: '<p>门槛测试题</p>',
      options: [{ text: '正确' }, { text: '错误' }], answer: [0], analysis: '<p>冻结解析</p>',
    });
    const base = { title: '累计有效视频学习要求', mode: 'fixed', category_id: categoryId };
    const enabled = { ...base, requires_learning: true, required_learning_minutes: 2, course_ids: [alpha.courseId, beta.courseId], remark: '  考前说明  ' };

    stage = 'published course options and request validation';
    const options = await ok(ctx, admin, 'GET', `/admin/papers/course-options?category_id=${categoryId}&page=2&page_size=1`);
    assert.equal(options.total, 3, 'draft/offline courses must be excluded before pagination');
    assert.equal(options.items.length, 1);
    assert.equal(options.items[0].id, beta.courseId);
    for (const [body, expectedCode] of [
      [{ ...enabled, course_ids: [] }, 40972],
      [{ ...enabled, required_learning_minutes: null }, 40972],
      [{ ...enabled, required_learning_minutes: 0 }, 40001],
      [{ ...enabled, required_learning_minutes: 1.5 }, 40001],
      [{ ...enabled, required_learning_minutes: 2147483648 }, 40001],
      [{ ...enabled, remark: '字'.repeat(1001) }, 40001],
      [{ ...enabled, course_ids: [draft.courseId] }, 40972],
      [{ ...enabled, course_ids: [offline.courseId] }, 40972],
    ]) {
      const denied = await ctx.request(admin, 'POST', '/admin/papers', body);
      assert.equal(denied.code, expectedCode, `invalid gate body must fail: ${denied.json?.message}`);
    }

    stage = 'remark persistence and merged patch validation';
    const paper = await ok(ctx, admin, 'POST', '/admin/papers', enabled);
    const paperId = String(paper.id);
    assert.equal(paper.remark, '考前说明');
    assert.equal(paper.required_learning_minutes, 2);
    const [stored] = await ctx.queryTestDb('SELECT remark,required_learning_minutes FROM exam_paper WHERE id=?', [paperId]);
    assert.equal(stored.remark, '考前说明');
    assert.equal(Number(stored.required_learning_minutes), 2);
    for (const body of [{ required_learning_minutes: null }, { course_ids: [] }]) {
      assert.equal((await ctx.request(admin, 'PUT', `/admin/papers/${paperId}`, body)).code, 40972);
    }
    const changed = await ok(ctx, admin, 'PUT', `/admin/papers/${paperId}`, { title: '只改名称', remark: '已更新备注' });
    assert.equal(changed.required_learning_minutes, 2);
    assert.deepEqual(changed.course_ids, [alpha.courseId, beta.courseId]);
    assert.equal((await ok(ctx, admin, 'GET', `/admin/papers/${paperId}`)).remark, '已更新备注');
    const copy = await ok(ctx, admin, 'POST', `/admin/papers/${paperId}/copy`);
    assert.equal(copy.remark, '已更新备注');
    assert.equal(copy.required_learning_minutes, 2);
    assert.deepEqual(copy.course_ids, [alpha.courseId, beta.courseId]);
    assert.equal((await ok(ctx, admin, 'PUT', `/admin/papers/${copy.id}`, { requires_learning: false })).required_learning_minutes, null);
    const disabledCopy = await ok(ctx, admin, 'GET', `/admin/papers/${copy.id}`);
    assert.deepEqual(disabledCopy.course_ids, []);
    assert.equal((await ctx.request(admin, 'PUT', `/admin/papers/${copy.id}`, { requires_learning: true })).code, 40972);

    stage = 'publication freezes learning configuration';
    const setQuestion = async (id) => ok(ctx, admin, 'PUT', `/admin/papers/${id}/questions`, { items: [{ question_version_id: String(question.saved_version_id), score_cents: 10000 }] });
    await setQuestion(paperId);
    const published = await ok(ctx, admin, 'POST', `/admin/papers/${paperId}/publish`);
    const releaseId = String(published.release_id);
    const [release] = await ctx.queryTestDb('SELECT requires_learning,required_learning_minutes,course_ids FROM paper_release WHERE id=?', [releaseId]);
    assert.equal(Number(release.requires_learning), 1);
    assert.equal(Number(release.required_learning_minutes), 2);
    const frozenCourses = typeof release.course_ids === 'string' ? JSON.parse(release.course_ids) : release.course_ids;
    assert.deepEqual(frozenCourses, [alpha.courseId, beta.courseId]);
    await ctx.queryTestDb('UPDATE exam_paper SET course_ids=?,required_learning_minutes=999 WHERE id=?', [JSON.stringify([unrelated.courseId]), paperId]);

    const learner = await examLearner(ctx, { categoryId });
    const otherLearner = await examLearner(ctx, { categoryId });
    stage = 'no history and no assignment side effects';
    const noHistory = await ctx.request(learner, 'POST', `/me/exams/${paperId}/start`);
    assert.equal(noHistory.code, 40901);
    assert.equal(noHistory.data.reason_code, 'LEARNING_REQUIRED');
    await assertNoAttempt(ctx, learner.userId, paperId);

    stage = 'real SQL excludes unrelated learners, courses, deleted lessons and old versions';
    await learning(ctx, otherLearner.userId, alpha.versionId, '900000');
    await learning(ctx, learner.userId, unrelated.versionId, '900000');
    const oldVersion = await insert(ctx,
      'INSERT INTO lesson_version(lesson_id,version_no,asset_id,duration_ms,created_by) VALUES (?,2,1,180000,?)',
      [alpha.lessonId, admin.userId]);
    await learning(ctx, learner.userId, oldVersion, '900000');
    const removedLesson = await insert(ctx,
      "INSERT INTO course_lesson(course_id,chapter_id,title,deleted_at) VALUES (?,?,?,UTC_TIMESTAMP(3))",
      [alpha.courseId, alpha.chapterId, '已删除课时']);
    const removedVersion = await insert(ctx,
      'INSERT INTO lesson_version(lesson_id,version_no,asset_id,duration_ms,created_by) VALUES (?,1,1,180000,?)',
      [removedLesson, admin.userId]);
    await ctx.queryTestDb('UPDATE course_lesson SET current_version_id=? WHERE id=?', [removedVersion, removedLesson]);
    await learning(ctx, learner.userId, removedVersion, '900000');
    await learning(ctx, learner.userId, alpha.versionId, '60000');
    await learning(ctx, learner.userId, beta.versionId, '59999');
    const short = await ctx.request(learner, 'POST', `/me/exams/${paperId}/start`);
    assert.equal(short.code, 40901);
    assert.deepEqual(short.data, { reason_code: 'LEARNING_REQUIRED', required_learning_minutes: 2, credited_seconds: 119, remaining_seconds: 1, course_ids: [alpha.courseId, beta.courseId] });
    assert.match(short.json.message, /还需学习1分钟/);
    await assertNoAttempt(ctx, learner.userId, paperId);

    stage = 'exact millisecond threshold across selected courses';
    await ctx.queryTestDb('UPDATE video_learning_record SET credited_ms=60000 WHERE user_id=? AND lesson_version_id=?', [learner.userId, beta.versionId]);
    const started = await ok(ctx, learner, 'POST', `/me/exams/${paperId}/start`);
    assertAttemptView(started);
    const recordId = started.record_id;
    await ctx.queryTestDb("UPDATE training_course SET status='offline' WHERE id=?", [alpha.courseId]);
    const betaNewVersion = await insert(ctx,
      'INSERT INTO lesson_version(lesson_id,version_no,asset_id,duration_ms,created_by) VALUES (?,2,1,180000,?)',
      [beta.lessonId, admin.userId]);
    await ctx.queryTestDb('UPDATE course_lesson SET current_version_id=? WHERE id=?', [betaNewVersion, beta.lessonId]);

    stage = 'active recovery ignores later learning availability changes';
    const recovered = await ok(ctx, learner, 'POST', `/me/exams/${paperId}/start`);
    assert.equal(recovered.record_id, recordId);
    assert.equal(recovered.deadline_at, started.deadline_at);
    assert.deepEqual(recovered.questions, started.questions);
    const read = await ok(ctx, learner, 'GET', `/me/exam-records/${recordId}`);
    assert.equal(read.deadline_at, started.deadline_at);

    stage = 'retake requires current effective records and keeps the original release';
    const failed = await ok(ctx, learner, 'POST', `/me/exam-records/${recordId}/submit`, wholeAnswers(started));
    assert.equal(failed.status, 'failed');
    const deniedRetake = await ctx.request(learner, 'POST', `/me/exams/${paperId}/start`);
    assert.equal(deniedRetake.code, 40901);
    const [beforeRetake] = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM exam_record WHERE paper_id=? AND user_id=?', [paperId, learner.userId]);
    assert.equal(Number(beforeRetake.count), 1);
    await ctx.queryTestDb("UPDATE training_course SET status='published' WHERE id=?", [alpha.courseId]);
    await learning(ctx, learner.userId, betaNewVersion, '60000');
    const retake = await ok(ctx, learner, 'POST', `/me/exams/${paperId}/start`);
    assert.notEqual(retake.record_id, recordId);
    assert.equal(retake.release_id, releaseId);
    const [retakeFact] = await ctx.queryTestDb('SELECT attempt_no FROM exam_record WHERE id=?', [retake.record_id]);
    assert.equal(Number(retakeFact.attempt_no), 2);

    stage = 'disabled requirements and legacy null thresholds remain unrestricted';
    const openPaper = await ok(ctx, admin, 'POST', '/admin/papers', { ...base, title: '无学习要求', requires_learning: false, required_learning_minutes: null, course_ids: [draft.courseId], remark: '   ' });
    assert.equal(openPaper.remark, null);
    assert.deepEqual(openPaper.course_ids, []);
    await setQuestion(openPaper.id);
    const openRelease = await ok(ctx, admin, 'POST', `/admin/papers/${openPaper.id}/publish`);
    const noStudy = await examLearner(ctx, { categoryId });
    assertAttemptView(await ok(ctx, noStudy, 'POST', `/me/exams/${openPaper.id}/start`));
    await ctx.queryTestDb('UPDATE paper_release SET requires_learning=1,required_learning_minutes=NULL WHERE id=?', [openRelease.release_id]);
    assertAttemptView(await ok(ctx, otherLearner, 'POST', `/me/exams/${openPaper.id}/start`));

    stage = 'publish rechecks course availability without partial release';
    const pending = await ok(ctx, admin, 'POST', '/admin/papers', enabled);
    await setQuestion(pending.id);
    await ctx.queryTestDb("UPDATE training_course SET status='offline' WHERE id=?", [beta.courseId]);
    assert.equal((await ctx.request(admin, 'POST', `/admin/papers/${pending.id}/publish`)).code, 40972);
    const [unpublished] = await ctx.queryTestDb('SELECT status,(SELECT COUNT(*) FROM paper_release WHERE paper_id=?) AS releases FROM exam_paper WHERE id=?', [pending.id, pending.id]);
    assert.equal(unpublished.status, 'draft');
    assert.equal(Number(unpublished.releases), 0);
  } catch (error) {
    error.message = `[training-paper-learning: ${stage}] ${error.message}`;
    throw error;
  }
}
