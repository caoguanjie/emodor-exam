import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { randomStrongPassword } from './training-access.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');
const mysql = require('mysql2/promise');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function captchaAnswer(ctx, captchaId) {
  const redis = new Redis({
    host: ctx.env.REDIS_HOST || '127.0.0.1',
    port: Number(ctx.env.REDIS_PORT || 6379),
    password: ctx.env.REDIS_PASSWORD || undefined,
  });
  try { return await redis.get(`${ctx.env.REDIS_KEY_PREFIX || ''}auth:captcha:${captchaId}`); }
  finally { await redis.quit(); }
}

async function login(ctx, username, password, ...personalValues) {
  const headers = { 'X-Forwarded-For': `198.51.100.${Math.floor(Math.random() * 200) + 1}` };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  const answer = await captchaAnswer(ctx, captcha.data?.captcha_id);
  const actor = {};
  const result = await ctx.request(actor, 'POST', '/auth/login', {
    username, password, captcha_id: captcha.data?.captcha_id, captcha_code: answer,
  }, headers);
  assert(result.status === 200 && result.data?.access_token, `${username} login failed: ${result.status}`);
  actor.accessToken = result.data.access_token;
  if (!result.data.force_change_password) return actor;
  const nextPassword = randomStrongPassword(username, ...personalValues);
  const changed = await ctx.request(actor, 'PUT', '/auth/password', { old_password: password, new_password: nextPassword });
  assert(changed.status === 200 && changed.data?.access_token, `${username} password change failed`);
  actor.accessToken = changed.data.access_token;
  return actor;
}

async function createCategory(ctx, admin) {
  const response = await ctx.request(admin, 'POST', '/admin/training-categories', {
    name: `B2 视频 ${randomBytes(4).toString('hex')}`,
    description: 'B2 isolated runtime fixture',
  });
  assert(response.status === 200 && response.data?.id, `category create failed: ${response.status}`);
  return String(response.data.id);
}

async function createStudent(ctx, admin, categoryId) {
  const username = `video_${randomBytes(5).toString('hex')}`;
  const employeeNo = `V${randomBytes(5).toString('hex')}`;
  const password = randomStrongPassword(username, employeeNo, 'B2');
  const response = await ctx.request(admin, 'POST', '/admin/students', {
    username, password, real_name: 'B2 视频学员', employee_no: employeeNo,
    category_id: categoryId, source: 'institution',
  });
  assert(response.status === 200 && response.data?.id, `student create failed: ${response.status}`);
  return {
    id: String(response.data.id),
    actor: await login(ctx, username, password, employeeNo, 'B2 视频学员'),
  };
}

async function insertId(ctx, sql, params) {
  const result = await ctx.queryTestDb(sql, params);
  assert(result?.insertId, `fixture insert did not return id: ${sql.slice(0, 60)}`);
  return String(result.insertId);
}

async function createCourseFixture(ctx, { categoryId, adminId, required = true, title = 'B2 可恢复视频课程' }) {
  const courseId = await insertId(ctx,
    'INSERT INTO training_course(title, category_id, status, created_by, published_at) VALUES (?, ?, ?, ?, NOW(3))',
    [title, categoryId, 'published', adminId]);
  if (!required) return { courseId, lessonId: null, versionId: null };
  const chapterId = await insertId(ctx,
    'INSERT INTO course_chapter(course_id, title, sort_order) VALUES (?, ?, ?)',
    [courseId, '第一章', 1]);
  const lessonId = await insertId(ctx,
    'INSERT INTO course_lesson(course_id, chapter_id, title, lesson_type, is_required, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    [courseId, chapterId, '100 秒视频课时', 'video', 1, 1]);
  const versionId = await insertId(ctx,
    'INSERT INTO lesson_version(lesson_id, version_no, asset_id, duration_ms, created_by) VALUES (?, ?, ?, ?, ?)',
    [lessonId, 1, '900001', 100_000, adminId]);
  await ctx.queryTestDb('UPDATE course_lesson SET current_version_id = ? WHERE id = ?', [versionId, lessonId]);
  return { courseId, lessonId, versionId };
}

async function createReadingFixture(ctx, { categoryId, adminId, title = 'B2 并发阅读制度' }) {
  const regulationId = await insertId(ctx,
    'INSERT INTO regulation(title, category, category_id, status, required_minutes, scroll_segments, created_by, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))',
    [title, 'B2', categoryId, 'published', 10, 10, adminId]);
  const versionId = await insertId(ctx,
    'INSERT INTO regulation_version(regulation_id, version_no, file_path, file_type, file_hash, content_html, text_content, parse_status, parsed_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?)',
    [regulationId, 1, 'b2/reading.docx', 'docx', randomBytes(32).toString('hex'), '<p>B2</p>', 'B2', 'parsed', adminId]);
  await ctx.queryTestDb('UPDATE regulation SET current_version_id = ? WHERE id = ?', [versionId, regulationId]);
  await ctx.queryTestDb('INSERT INTO regulation_scope(regulation_id, department_id, is_all) VALUES (?, NULL, 1)', [regulationId]);
  return { regulationId, versionId };
}

async function holdUserRow(ctx, userId) {
  const connection = await mysql.createConnection({
    host: ctx.env.DB_HOST || '127.0.0.1',
    port: Number(ctx.env.DB_PORT || 3306),
    user: ctx.env.DB_USERNAME || 'root',
    password: ctx.env.DB_PASSWORD || undefined,
    database: ctx.env.DB_DATABASE,
  });
  await connection.beginTransaction();
  await connection.execute('SELECT id FROM sys_user WHERE id = ? FOR UPDATE', [userId]);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try { await connection.commit(); }
    finally { await connection.end(); }
  };
}

async function waitForLockWaits(ctx, minimum, label) {
  const observer = await mysql.createConnection({
    host: ctx.env.DB_HOST || '127.0.0.1',
    port: Number(ctx.env.DB_PORT || 3306),
    user: ctx.env.DB_USERNAME || 'root',
    password: ctx.env.DB_PASSWORD || undefined,
    database: ctx.env.DB_DATABASE,
  });
  const started = Date.now();
  try {
    while (Date.now() - started < 8_000) {
      const [rows] = await observer.query('SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits');
      if (Number(rows[0]?.count || 0) >= minimum) return;
      await delay(25);
    }
  } finally {
    await observer.end();
  }
  throw new Error(`${label} did not reach ${minimum} owned lock waits`);
}

async function raceStarts(ctx, userId, first, second) {
  const release = await holdUserRow(ctx, userId);
  try {
    const firstPromise = first();
    await waitForLockWaits(ctx, 1, 'first learning start');
    const secondPromise = second();
    await waitForLockWaits(ctx, 2, 'second learning start');
    await release();
    return await Promise.all([firstPromise, secondPromise]);
  } catch (error) {
    await release().catch(() => undefined);
    throw error;
  }
}

async function videoHeartbeat(ctx, actor, sessionId, seq, positionMs, state, elapsedMs = 30_000) {
  await ctx.queryTestDb(
    'UPDATE video_learning_session SET last_heartbeat_at = TIMESTAMPADD(MICROSECOND, ?, UTC_TIMESTAMP(3)) WHERE id = ?',
    [-elapsedMs * 1000, sessionId],
  );
  return ctx.request(actor, 'POST', `/me/video-sessions/${sessionId}/heartbeat`, {
    seq, position_ms: positionMs, state,
  });
}

async function ageReadingHeartbeat(ctx, sessionId) {
  const redis = new Redis({
    host: ctx.env.REDIS_HOST || '127.0.0.1',
    port: Number(ctx.env.REDIS_PORT || 6379),
    password: ctx.env.REDIS_PASSWORD || undefined,
  });
  try {
    await redis.hset(`${ctx.env.REDIS_KEY_PREFIX || ''}learn:session:${sessionId}`, 'last_beat_at', String(Date.now() - 11_000));
  } finally {
    await redis.quit();
  }
}

async function runBody(ctx) {
  ctx.reportOwnedRuntime?.({ stage: 'training-video-learning-start', database: ctx.env.DB_DATABASE });
  const admin = await login(ctx, 'admin', ctx.adminPassword, '超级管理员');
  const adminProfile = await ctx.request(admin, 'GET', '/auth/profile');
  const adminId = String(adminProfile.data?.id);
  const categoryId = await createCategory(ctx, admin);
  const learner = await createStudent(ctx, admin, categoryId);
  const course = await createCourseFixture(ctx, { categoryId, adminId });
  const zeroRequired = await createCourseFixture(ctx, {
    categoryId, adminId, required: false, title: 'B2 零必学课程',
  });
  const reading = await createReadingFixture(ctx, { categoryId, adminId });
  const otherReading = await createReadingFixture(ctx, {
    categoryId, adminId, title: 'B2 跨制度单活动回归',
  });

  const zeroProgress = await ctx.request(learner.actor, 'GET', `/me/courses/${zeroRequired.courseId}/progress`);
  assert(zeroProgress.status === 200 && zeroProgress.data?.required === 0
    && zeroProgress.data?.completed === 0 && zeroProgress.data?.completion_rate === null,
  `zero-required course auto-completed: ${zeroProgress.status}`);
  const numericLessonId = await ctx.request(learner.actor, 'POST', '/me/video-sessions', {
    lesson_id: Number(course.lessonId),
  });
  assert(numericLessonId.status === 400 && numericLessonId.code === 40001,
    `numeric lesson id was accepted: ${numericLessonId.status}/${numericLessonId.code}`);
  const unknownStartField = await ctx.request(learner.actor, 'POST', '/me/video-sessions', {
    lesson_id: course.lessonId, client_elapsed_ms: 30_000,
  });
  assert(unknownStartField.status === 400 && unknownStartField.code === 40001,
    `unknown video start field was accepted: ${unknownStartField.status}/${unknownStartField.code}`);

  // Concurrent reading -> video: video is queued second and must become the only owner.
  const [readingFirst, videoSecond] = await raceStarts(
    ctx,
    learner.id,
    () => ctx.request(learner.actor, 'POST', '/learning/sessions/start', { regulation_id: reading.regulationId }),
    () => ctx.request(learner.actor, 'POST', '/me/video-sessions', { lesson_id: course.lessonId }),
  );
  assert(readingFirst.status === 409 && videoSecond.status === 200,
    `reading->video race failed: ${readingFirst.status}/${videoSecond.status}`);
  assert(typeof videoSecond.data?.session_id === 'string' && typeof videoSecond.data?.version_id === 'string',
    'video start did not preserve bigint IDs as strings');
  const activeAfterVideo = await ctx.queryTestDb(
    'SELECT id FROM video_learning_session WHERE active_user_id = ? AND ended_at IS NULL', [learner.id]);
  const activeReadingsAfterVideo = await ctx.queryTestDb(
    'SELECT id FROM learning_session WHERE user_id = ? AND ended_at IS NULL', [learner.id]);
  assert(activeAfterVideo.length === 1 && activeReadingsAfterVideo.length === 0,
    'reading->video race left multiple active session types');
  const replacedReadingRows = await ctx.queryTestDb(
    'SELECT id FROM learning_session WHERE user_id = ? ORDER BY id DESC LIMIT 1', [learner.id]);
  assert(replacedReadingRows.length === 1, 'reading->video race did not create a reading row');
  const replacedReadingHeartbeat = await ctx.request(learner.actor, 'POST', '/learning/heartbeat', {
    session_id: String(replacedReadingRows[0].id), dwell_segments: [], scroll_percent: 0,
  });
  assert(replacedReadingHeartbeat.status === 409,
    `replaced reading heartbeat expected 409, got ${replacedReadingHeartbeat.status}`);
  const winningVideoHeartbeat = await videoHeartbeat(
    ctx, learner.actor, String(activeAfterVideo[0].id), 1, 0, 'paused');
  assert(winningVideoHeartbeat.status === 200, `winning video heartbeat failed: ${winningVideoHeartbeat.status}`);

  // Concurrent video -> reading: reading is queued second and must become the only owner.
  const [videoFirst, readingSecond] = await raceStarts(
    ctx,
    learner.id,
    () => ctx.request(learner.actor, 'POST', '/me/video-sessions', { lesson_id: course.lessonId }),
    () => ctx.request(learner.actor, 'POST', '/learning/sessions/start', { regulation_id: reading.regulationId }),
  );
  assert(videoFirst.status === 200 && readingSecond.status === 200,
    `video->reading race failed: ${videoFirst.status}/${readingSecond.status}`);
  const activeVideosAfterReading = await ctx.queryTestDb(
    'SELECT id FROM video_learning_session WHERE active_user_id = ? AND ended_at IS NULL', [learner.id]);
  const activeReadings = await ctx.queryTestDb(
    'SELECT id FROM learning_session WHERE user_id = ? AND ended_at IS NULL', [learner.id]);
  assert(activeVideosAfterReading.length === 0 && activeReadings.length === 1,
    'video->reading race left multiple active session types');
  const replacedVideoHeartbeat = await videoHeartbeat(
    ctx, learner.actor, String(videoFirst.data.session_id), 1, 0, 'paused');
  assert(replacedVideoHeartbeat.status === 409 && replacedVideoHeartbeat.code === 40950,
    `replaced video heartbeat expected 40950, got ${replacedVideoHeartbeat.status}/${replacedVideoHeartbeat.code}`);
  await ageReadingHeartbeat(ctx, String(activeReadings[0].id));
  const winningReadingHeartbeat = await ctx.request(learner.actor, 'POST', '/learning/heartbeat', {
    session_id: String(activeReadings[0].id), dwell_segments: [], scroll_percent: 0,
  });
  assert(winningReadingHeartbeat.status === 200, `winning reading heartbeat failed: ${winningReadingHeartbeat.status}`);

  // A reading start for another regulation must close the prior regulation too;
  // the legacy per-regulation Redis pointer is not the global ownership authority.
  const otherReadingStart = await ctx.request(learner.actor, 'POST', '/learning/sessions/start', {
    regulation_id: otherReading.regulationId,
  });
  assert(otherReadingStart.status === 200, `cross-regulation reading start failed: ${otherReadingStart.status}`);
  const activeCrossRegulation = await ctx.queryTestDb(
    'SELECT id, regulation_id FROM learning_session WHERE user_id = ? AND ended_at IS NULL', [learner.id]);
  assert(activeCrossRegulation.length === 1
    && String(activeCrossRegulation[0].regulation_id) === otherReading.regulationId,
  'reading start did not enforce one active session across regulations');
  const replacedCrossRegulationHeartbeat = await ctx.request(learner.actor, 'POST', '/learning/heartbeat', {
    session_id: String(activeReadings[0].id), dwell_segments: [], scroll_percent: 0,
  });
  assert(replacedCrossRegulationHeartbeat.status === 409,
    `cross-regulation replaced heartbeat expected 409, got ${replacedCrossRegulationHeartbeat.status}`);
  await ageReadingHeartbeat(ctx, String(activeCrossRegulation[0].id));
  const activeCrossRegulationHeartbeat = await ctx.request(learner.actor, 'POST', '/learning/heartbeat', {
    session_id: String(activeCrossRegulation[0].id), dwell_segments: [], scroll_percent: 0,
  });
  assert(activeCrossRegulationHeartbeat.status === 200,
    `cross-regulation winning heartbeat failed: ${activeCrossRegulationHeartbeat.status}`);

  // Two simultaneous video starts serialize on sys_user and leave one active owner.
  const [videoA, videoB] = await raceStarts(
    ctx,
    learner.id,
    () => ctx.request(learner.actor, 'POST', '/me/video-sessions', { lesson_id: course.lessonId }),
    () => ctx.request(learner.actor, 'POST', '/me/video-sessions', { lesson_id: course.lessonId }),
  );
  assert(videoA.status === 200 && videoB.status === 200, `video/video starts failed: ${videoA.status}/${videoB.status}`);
  const activeVideos = await ctx.queryTestDb(
    'SELECT id FROM video_learning_session WHERE active_user_id = ? AND ended_at IS NULL', [learner.id]);
  assert(activeVideos.length === 1, `video/video race active count=${activeVideos.length}`);
  const activeVideoId = String(activeVideos[0].id);
  const staleVideoId = String(videoA.data.session_id) === activeVideoId
    ? String(videoB.data.session_id) : String(videoA.data.session_id);
  const staleBeat = await videoHeartbeat(ctx, learner.actor, staleVideoId, 1, 0, 'paused');
  assert(staleBeat.status === 409 && staleBeat.code === 40950,
    `stale video heartbeat expected 40950, got ${staleBeat.status}/${staleBeat.code}`);

  // Fresh session for deterministic coverage checks.
  const fresh = await ctx.request(learner.actor, 'POST', '/me/video-sessions', { lesson_id: course.lessonId });
  assert(fresh.status === 200 && fresh.data?.session_id, `fresh video start failed: ${fresh.status}`);
  const sessionId = String(fresh.data.session_id);
  const normal = await videoHeartbeat(ctx, learner.actor, sessionId, 1, 30_000, 'playing');
  assert(normal.status === 200 && normal.data?.credited_ms === 30_000 && normal.data?.coverage_ms === 30_000,
    `normal coverage mismatch: ${JSON.stringify(normal.data)}`);
  const replay = await videoHeartbeat(ctx, learner.actor, sessionId, 1, 60_000, 'playing');
  assert(replay.status === 200 && replay.data?.credited_ms === 30_000 && replay.data?.coverage_ms === 30_000,
    'replayed heartbeat changed progress');
  const background = await videoHeartbeat(ctx, learner.actor, sessionId, 2, 30_000, 'background');
  assert(background.status === 200 && background.data?.credited_ms === 30_000,
    'background heartbeat credited time');
  const outOfOrder = await videoHeartbeat(ctx, learner.actor, sessionId, 1, 60_000, 'playing');
  assert(outOfOrder.status === 200 && outOfOrder.data?.last_seq === 2 && outOfOrder.data?.coverage_ms === 30_000,
    'out-of-order heartbeat changed progress');
  const resumedAnchor = await videoHeartbeat(ctx, learner.actor, sessionId, 3, 30_000, 'playing');
  assert(resumedAnchor.status === 200 && resumedAnchor.data?.credited_ms === 30_000,
    'first playing beat after background credited time');
  const jumped = await videoHeartbeat(ctx, learner.actor, sessionId, 4, 70_000, 'playing');
  assert(jumped.status === 200 && jumped.data?.coverage_ms === 30_000,
    'forward jump increased coverage');
  const seekBack = await videoHeartbeat(ctx, learner.actor, sessionId, 5, 0, 'playing');
  assert(seekBack.status === 200 && seekBack.data?.coverage_ms === 30_000,
    'backward seek increased coverage');
  const repeated = await videoHeartbeat(ctx, learner.actor, sessionId, 6, 30_000, 'playing');
  assert(repeated.status === 200 && repeated.data?.credited_ms === 60_000
    && repeated.data?.coverage_ms === 30_000 && repeated.data?.completed === false,
  'repeated segment incorrectly increased unique coverage');

  await ctx.restartApi();
  const afterRestart = await videoHeartbeat(ctx, learner.actor, sessionId, 7, 60_000, 'playing');
  assert(afterRestart.status === 200 && afterRestart.data?.coverage_ms === 60_000,
    `persisted restart heartbeat failed: ${afterRestart.status}`);
  const at90 = await videoHeartbeat(ctx, learner.actor, sessionId, 8, 90_000, 'playing');
  assert(at90.status === 200 && at90.data?.coverage_ms === 90_000 && at90.data?.completed === false,
    '90 percent coverage completion mismatch');
  const at95 = await videoHeartbeat(ctx, learner.actor, sessionId, 9, 95_000, 'playing');
  assert(at95.status === 200 && at95.data?.coverage_ms === 95_000 && at95.data?.completed === true,
    '95 percent coverage did not complete');
  const courseProgress = await ctx.request(learner.actor, 'GET', `/me/courses/${course.courseId}/progress`);
  assert(courseProgress.status === 200 && courseProgress.data?.required === 1
    && courseProgress.data?.completed === 1 && courseProgress.data?.completion_rate === 1,
  'course progress did not use current required coverage');

  const closed = await ctx.request(learner.actor, 'POST', `/me/video-sessions/${sessionId}/close`);
  assert(closed.status === 200 && closed.data?.completed === true, `video close failed: ${closed.status}`);

  // Replacing the immutable current version resets the requirement and invalidates old-session heartbeats.
  const oldSession = await ctx.request(learner.actor, 'POST', '/me/video-sessions', { lesson_id: course.lessonId });
  assert(oldSession.status === 200, `old version session start failed: ${oldSession.status}`);
  const version2 = await insertId(ctx,
    'INSERT INTO lesson_version(lesson_id, version_no, asset_id, duration_ms, created_by) VALUES (?, ?, ?, ?, ?)',
    [course.lessonId, 2, '900002', 100_000, adminId]);
  await ctx.queryTestDb('UPDATE course_lesson SET current_version_id = ? WHERE id = ?', [version2, course.lessonId]);
  const replacedBeat = await videoHeartbeat(ctx, learner.actor, String(oldSession.data.session_id), 1, 30_000, 'playing');
  assert(replacedBeat.status === 409 && replacedBeat.code === 40951,
    `version replacement heartbeat expected 40951, got ${replacedBeat.status}/${replacedBeat.code}`);
  const resetProgress = await ctx.request(learner.actor, 'GET', `/me/courses/${course.courseId}/progress`);
  assert(resetProgress.status === 200 && resetProgress.data?.required === 1
    && resetProgress.data?.completed === 0 && resetProgress.data?.completion_rate === 0,
  'new current version reused old completion');

  const currentSession = await ctx.request(learner.actor, 'POST', '/me/video-sessions', { lesson_id: course.lessonId });
  assert(currentSession.status === 200 && String(currentSession.data?.version_id) === version2,
    'new session did not use replacement version');
  await ctx.queryTestDb('UPDATE training_course SET status = ? WHERE id = ?', ['offline', course.courseId]);
  const offlineBeat = await videoHeartbeat(ctx, learner.actor, String(currentSession.data.session_id), 1, 30_000, 'playing');
  assert(offlineBeat.status === 409 && offlineBeat.code === 40951,
    `offline heartbeat expected 40951, got ${offlineBeat.status}/${offlineBeat.code}`);
  const offlineStart = await ctx.request(learner.actor, 'POST', '/me/video-sessions', { lesson_id: course.lessonId });
  assert(offlineStart.status === 409 && offlineStart.code === 40951,
    `offline start expected 40951, got ${offlineStart.status}/${offlineStart.code}`);

  await ctx.queryTestDb('UPDATE training_course SET status = ? WHERE id = ?', ['published', course.courseId]);
  await ctx.queryTestDb('UPDATE sys_user SET source = ? WHERE id = ?', ['external', learner.id]);
  const externalProgress = await ctx.request(learner.actor, 'GET', `/me/courses/${course.courseId}/progress`);
  assert(externalProgress.status === 200 && externalProgress.data?.required === 0
    && externalProgress.data?.completed === 0 && externalProgress.data?.completion_rate === null,
  'external learner remained in required denominator');
  const retained = await ctx.queryTestDb(
    'SELECT COUNT(*) AS count FROM video_learning_record WHERE user_id = ?', [learner.id]);
  assert(Number(retained[0]?.count) >= 2, 'source change deleted historical video records');
  const externalStart = await ctx.request(learner.actor, 'POST', '/me/video-sessions', { lesson_id: course.lessonId });
  assert(externalStart.status === 403, `external video start expected 403, got ${externalStart.status}`);
}

export async function run(ctx) {
  await runBody(ctx);
  console.log('training-video-learning: passed');
}
