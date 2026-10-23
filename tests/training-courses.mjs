import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { deepStrictEqual } from 'node:assert/strict';
import { randomStrongPassword } from './training-access.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function flattenNavigation(nodes, output = []) {
  for (const node of nodes || []) {
    output.push(node);
    flattenNavigation(node.children, output);
  }
  return output;
}

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
  const sourceIp = `198.51.100.${(login.sequence = ((login.sequence || 0) % 200) + 1)}`;
  const headers = { 'X-Forwarded-For': sourceIp };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert(captcha.status === 200 && captcha.data?.captcha_id, `${username} captcha failed`);
  const answer = await captchaAnswer(ctx, captcha.data.captcha_id);
  assert(answer, `${username} captcha answer missing`);
  const actor = {};
  const result = await ctx.request(actor, 'POST', '/auth/login', {
    username, password, captcha_id: captcha.data.captcha_id, captcha_code: answer,
  }, headers);
  assert(result.status === 200 && result.data?.access_token, `${username} login failed: ${result.status}`);
  actor.accessToken = result.data.access_token;
  if (!result.data.force_change_password) return actor;
  const nextPassword = randomStrongPassword(username, ...personalValues);
  const changed = await ctx.request(actor, 'PUT', '/auth/password', { old_password: password, new_password: nextPassword });
  assert(changed.status === 200 && changed.data?.access_token, `${username} first password change failed`);
  actor.accessToken = changed.data.access_token;
  return actor;
}

function multipart(fields, bytes, filename, contentType) {
  const boundary = `----ruleexam-courses-${randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  chunks.push(bytes);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

async function uploadMedia(ctx, actor, purpose, bytes, filename, contentType) {
  const payload = multipart({ purpose }, bytes, filename, contentType);
  return ctx.request(actor, 'POST', '/media/upload', payload.body, payload.headers);
}

async function videoFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-course-video-'));
  const output = join(root, 'lesson.mp4');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-y', output,
      ], { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      let stderrBytes = 0;
      let settled = false;
      let stopReason;
      let processError;
      let timer;
      const requestStop = (error) => {
        if (settled || stopReason) return;
        stopReason = error;
        child.kill('SIGKILL');
      };
      child.stderr.on('data', (chunk) => {
        if (settled || stopReason) return;
        stderrBytes += chunk.length;
        if (stderrBytes > 256 * 1024) {
          requestStop(new Error('ffmpeg fixture output exceeded limit'));
          return;
        }
        stderr += chunk.toString();
      });
      child.once('error', (error) => { processError = error; });
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (stopReason) reject(stopReason);
        else if (processError) reject(processError);
        else if (code === 0) resolve();
        else reject(new Error(`ffmpeg fixture failed: ${stderr.slice(0, 200)}`));
      });
      timer = setTimeout(() => requestStop(new Error('ffmpeg fixture timed out')), 15_000);
    });
    return await readFile(output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createCategory(ctx, admin, name) {
  const response = await ctx.request(admin, 'POST', '/admin/training-categories', { name, description: 'B1 fixture' });
  assert(response.status === 200 && response.data?.id, `category create failed: ${response.status}`);
  return String(response.data.id);
}

async function createStudent(ctx, admin, categoryId, source, label) {
  const username = `course_${label}_${randomBytes(4).toString('hex')}`;
  const employeeNo = `C${randomBytes(5).toString('hex')}`;
  const password = randomStrongPassword(username, employeeNo, label);
  const response = await ctx.request(admin, 'POST', '/admin/students', {
    username, password, real_name: label, employee_no: employeeNo,
    category_id: String(categoryId), source,
  });
  assert(response.status === 200 && response.data?.id, `${label} create failed: ${response.status}`);
  return { id: String(response.data.id), username, password, employeeNo, realName: label };
}

async function mobileLogin(ctx, learner) {
  const phone = `138${String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, '0')}`;
  await ctx.queryTestDb('UPDATE sys_user SET phone = ? WHERE id = ?', [phone, learner.id]);
  const actor = {};
  const response = await ctx.request(actor, 'POST', '/mobile/auth/debug-login', { phone });
  assert(response.status === 200 && response.data?.access_token
    && String(response.data.user?.id) === learner.id && response.data.user?.identity_status === 'unverified',
  `mobile course learner login failed: ${response.status}/${response.code}`);
  actor.accessToken = response.data.access_token;
  return actor;
}

async function runBody(ctx) {
  ctx.reportOwnedRuntime?.({ stage: 'training-courses-start', database: ctx.env.DB_DATABASE });
  const admin = await login(ctx, 'admin', ctx.adminPassword, '超级管理员');
  const adminProfile = await ctx.request(admin, 'GET', '/auth/profile');
  assert(adminProfile.status === 200 && adminProfile.data?.id, 'admin profile failed');
  const adminId = String(adminProfile.data.id);

  const categoryA = await createCategory(ctx, admin, `B1 初级 ${randomBytes(3).toString('hex')}`);
  const categoryB = await createCategory(ctx, admin, `B1 其他 ${randomBytes(3).toString('hex')}`);
  const institution = await createStudent(ctx, admin, categoryA, 'institution', '机构学员');
  const external = await createStudent(ctx, admin, categoryA, 'external', '外来学员');
  const otherCategory = await createStudent(ctx, admin, categoryB, 'institution', '其他类别学员');
  const unclassified = await createStudent(ctx, admin, categoryA, 'external', '资料未补齐学员');
  institution.actor = await login(ctx, institution.username, institution.password, institution.employeeNo, institution.realName);
  external.actor = await login(ctx, external.username, external.password, external.employeeNo, external.realName);
  otherCategory.actor = await login(ctx, otherCategory.username, otherCategory.password, otherCategory.employeeNo, otherCategory.realName);
  unclassified.actor = await login(ctx, unclassified.username, unclassified.password, unclassified.employeeNo, unclassified.realName);
  // Model the valid SMS-created learner before source/category have been assigned.
  await ctx.queryTestDb('UPDATE sys_user SET source = NULL, category_id = NULL WHERE id = ?', [unclassified.id]);

  const permissionUser = await createStudent(ctx, admin, categoryA, 'institution', '窄权限管理员');
  const role = await ctx.request(admin, 'POST', '/admin/roles', {
    code: `course_writer_${randomBytes(4).toString('hex')}`,
    name: 'B1 课程编辑',
    permissions: ['courses:write'],
  });
  assert(role.status === 200 && role.data?.id, `role create failed: ${role.status}`);
  const assigned = await ctx.request(admin, 'PUT', `/admin/administrators/${permissionUser.id}/roles`, { role_ids: [String(role.data.id)] });
  assert(assigned.status === 200, `role assign failed: ${assigned.status}`);
  permissionUser.actor = await login(ctx, permissionUser.username, permissionUser.password, permissionUser.employeeNo, permissionUser.realName);
  const regulationOptions = await ctx.request(permissionUser.actor, 'GET', '/regulations/category-options?page=1&page_size=100');
  assert(regulationOptions.status === 404, `removed regulation category options remained reachable: ${regulationOptions.status}`);
  const courseOptions = await ctx.request(permissionUser.actor, 'GET', '/admin/courses/category-options?page=1&page_size=100');
  assert(courseOptions.status === 200 && courseOptions.data?.items?.some((item) => String(item.id) === categoryA), `course category options denied: ${courseOptions.status}`);
  const categoryAdminList = await ctx.request(permissionUser.actor, 'GET', '/admin/training-categories');
  assert(categoryAdminList.status === 403, `narrow writer reached category management: ${categoryAdminList.status}`);
  const narrowWriterCourse = await ctx.request(permissionUser.actor, 'POST', '/admin/courses', {
    title: 'B1 仅写权限草稿', category_id: categoryB,
  });
  assert(narrowWriterCourse.status === 200 && narrowWriterCourse.data?.id, `courses:write could not create: ${narrowWriterCourse.status}`);
  const narrowWriterList = await ctx.request(permissionUser.actor, 'GET', '/admin/courses');
  assert(narrowWriterList.status === 403, `courses:write unexpectedly granted courses:read: ${narrowWriterList.status}`);
  const narrowWriterNavigation = await ctx.request(permissionUser.actor, 'GET', '/admin/menus/navigation');
  const courseMenu = flattenNavigation(narrowWriterNavigation.data)
    .find((item) => item.route_path === '/admin/courses');
  assert(narrowWriterNavigation.status === 200 && courseMenu?.permission_code === null,
    `write-only course navigation missing or over-constrained: ${narrowWriterNavigation.status}`);

  const regulation = await ctx.request(admin, 'POST', '/admin/question-materials', {
    title: `B1 关联资料 ${randomBytes(3).toString('hex')}`,
    description: '课程信息关联',
  });
  assert(regulation.status === 200 && regulation.data?.id, `question material create failed: ${regulation.status}`);

  const course = await ctx.request(admin, 'POST', '/admin/courses', {
    title: 'B1 视频课程', category_id: categoryA, description: '生命周期闭环',
    regulation_ids: [String(regulation.data.id)], is_recommended: true, sort_order: 1,
  });
  assert(course.status === 200 && course.data?.id, `course create failed: ${course.status}/${course.code}`);
  const courseId = String(course.data.id);
  const chapter = await ctx.request(admin, 'POST', `/admin/courses/${courseId}/chapters`, { title: '第一章', sort_order: 1 });
  assert(chapter.status === 200 && chapter.data?.id, `chapter create failed: ${chapter.status}`);
  const unknownLesson = await ctx.request(admin, 'POST', `/admin/courses/${courseId}/lessons`, {
    chapter_id: String(chapter.data.id), title: '未知课时', lesson_type: 'document', required: true, sort_order: 1,
  });
  assert(unknownLesson.status === 400, `unknown lesson type expected 400, got ${unknownLesson.status}`);
  const lesson = await ctx.request(admin, 'POST', `/admin/courses/${courseId}/lessons`, {
    chapter_id: String(chapter.data.id), title: '视频课时', lesson_type: 'video', required: true, sort_order: 1,
  });
  assert(lesson.status === 200 && lesson.data?.id, `lesson create failed: ${lesson.status}`);
  const lessonId = String(lesson.data.id);

  const publishWithoutRequiredVideo = await ctx.request(admin, 'POST', `/admin/courses/${courseId}/publish`);
  assert(publishWithoutRequiredVideo.status === 409, `publish without required video expected 409, got ${publishWithoutRequiredVideo.status}`);

  const failedUpload = await uploadMedia(ctx, admin, 'video', Buffer.from('not-an-mp4'), 'failed.mp4', 'video/mp4');
  assert(failedUpload.status === 400, `failed media expected 400, got ${failedUpload.status}`);
  const failedRows = await ctx.queryTestDb('SELECT id FROM media_asset WHERE uploaded_by = ? AND purpose = ? AND status = ? ORDER BY id DESC LIMIT 1', [adminId, 'video', 'failed']);
  assert(failedRows.length === 1, 'processing-failed media row missing');

  const videoBytes = await videoFixture();
  const firstUpload = await uploadMedia(ctx, admin, 'video', videoBytes, 'lesson-v1.mp4', 'video/mp4');
  assert(firstUpload.status === 200 && firstUpload.data?.status === 'ready', `first video upload failed: ${firstUpload.status}`);
  const firstAssetId = String(firstUpload.data.asset_id);
  const firstVersion = await ctx.request(admin, 'POST', `/admin/courses/${courseId}/lessons/${lessonId}/versions`, { asset_id: firstAssetId });
  assert(firstVersion.status === 200 && firstVersion.data?.version_id, `first lesson version failed: ${firstVersion.status}`);
  const oldVersionId = String(firstVersion.data.version_id);

  const publishWithReadyVideo = await ctx.request(admin, 'POST', `/admin/courses/${courseId}/publish`);
  assert(publishWithReadyVideo.status === 200, `publish with ready video failed: ${publishWithReadyVideo.status}`);

  const secondUpload = await uploadMedia(ctx, admin, 'video', videoBytes, 'lesson-v2.mp4', 'video/mp4');
  assert(secondUpload.status === 200 && secondUpload.data?.status === 'ready', `second video upload failed: ${secondUpload.status}`);
  const replaceVideo = await ctx.request(admin, 'POST', `/admin/courses/${courseId}/lessons/${lessonId}/versions`, { asset_id: String(secondUpload.data.asset_id) });
  assert(replaceVideo.status === 200 && replaceVideo.data?.version_id, `replace video failed: ${replaceVideo.status}`);
  assert(String(replaceVideo.data.version_id) !== oldVersionId, 'replace video mutated the old version');
  const deleteReferencedVideo = await ctx.request(admin, 'DELETE', `/media/${firstAssetId}`);
  assert(deleteReferencedVideo.status === 409, `referenced video delete expected 409, got ${deleteReferencedVideo.status}`);

  const secondary = await ctx.request(admin, 'POST', '/admin/courses', {
    title: 'B1 非推荐课程', category_id: categoryA, is_recommended: false, sort_order: 99,
  });
  assert(secondary.status === 200 && secondary.data?.id, `secondary course create failed: ${secondary.status}`);
  const secondaryId = String(secondary.data.id);
  const publishSecondary = await ctx.request(admin, 'POST', `/admin/courses/${secondaryId}/publish`);
  assert(publishSecondary.status === 200, `secondary course publish failed: ${publishSecondary.status}`);

  const adminPage = await ctx.request(admin, 'GET', `/admin/courses?page=1&page_size=1&category_id=${categoryA}`);
  assert(adminPage.status === 200 && adminPage.data?.total === 2 && adminPage.data?.items?.length === 1, 'admin course pagination mismatch');
  const browsingLearners = [institution, external, otherCategory, unclassified];
  const assertNoVideoActivity = async () => {
    const ids = browsingLearners.map((learner) => learner.id);
    const placeholders = ids.map(() => '?').join(',');
    for (const table of ['video_learning_record', 'video_learning_session']) {
      const [row] = await ctx.queryTestDb(`SELECT COUNT(*) AS total FROM ${table} WHERE user_id IN (${placeholders})`, ids);
      assert(Number(row.total) === 0, `course browsing or progress reads created ${table}`);
    }
  };
  await assertNoVideoActivity();
  const institutionCourses = await ctx.request(institution.actor, 'GET', '/me/courses?page=1&page_size=1');
  assert(institutionCourses.status === 200 && institutionCourses.data?.total === 2 && institutionCourses.data?.items?.length === 1
    && String(institutionCourses.data.items[0]?.id) === courseId, 'institution recommendation/page 1 mismatch');
  const institutionPageTwo = await ctx.request(institution.actor, 'GET', '/me/courses?page=2&page_size=1');
  assert(institutionPageTwo.status === 200 && institutionPageTwo.data?.total === 2
    && String(institutionPageTwo.data.items[0]?.id) === secondaryId, 'institution course page 2 mismatch');
  const externalCourses = await ctx.request(external.actor, 'GET', '/me/courses?page=1&page_size=20');
  assert(externalCourses.status === 200 && externalCourses.data?.total === 2
    && String(externalCourses.data.items[0]?.id) === courseId, 'external learner could not browse published courses');
  const unclassifiedCourses = await ctx.request(unclassified.actor, 'GET', '/me/courses');
  assert(unclassifiedCourses.status === 200 && unclassifiedCourses.data?.total === 2,
    'missing source/category blocked published course browsing');
  const publicSiteConfig = await ctx.request(null, 'GET', '/site-config');
  const institutionHome = await ctx.request(institution.actor, 'GET', '/me/home');
  assert(institutionHome.status === 200
    && JSON.stringify(Object.keys(institutionHome.data || {}).sort()) === JSON.stringify(['courses', 'site_config'])
    && JSON.stringify(institutionHome.data.site_config) === JSON.stringify(publicSiteConfig.data)
    && institutionHome.data.courses?.page === 1
    && institutionHome.data.courses?.page_size === 20
    && institutionHome.data.courses?.total === 2
    && String(institutionHome.data.courses?.items?.[0]?.id) === courseId,
  `learner home composition/defaults mismatch: ${institutionHome.status}`);
  const institutionHomePageTwo = await ctx.request(institution.actor, 'GET', '/me/home?page=2&page_size=1');
  assert(institutionHomePageTwo.status === 200
    && JSON.stringify(institutionHomePageTwo.data.site_config) === JSON.stringify(publicSiteConfig.data)
    && institutionHomePageTwo.data.courses?.page === 2
    && institutionHomePageTwo.data.courses?.page_size === 1
    && String(institutionHomePageTwo.data.courses?.items?.[0]?.id) === secondaryId,
  `learner home pagination mismatch: ${institutionHomePageTwo.status}`);
  const externalHome = await ctx.request(external.actor, 'GET', '/me/home');
  assert(externalHome.status === 200 && externalHome.data?.courses?.total === 2
    && JSON.stringify(externalHome.data.site_config) === JSON.stringify(publicSiteConfig.data),
  'external learner home did not reuse the published-course set');
  const invalidHomeQuery = await ctx.request(institution.actor, 'GET', '/me/home?unexpected=1');
  assert(invalidHomeQuery.status === 400, `learner home accepted an unknown query: ${invalidHomeQuery.status}`);
  const institutionDetail = await ctx.request(institution.actor, 'GET', `/me/courses/${courseId}`);
  assert(institutionDetail.status === 200 && institutionDetail.data?.chapters?.[0]?.lessons?.[0]?.current_version?.version_id === String(replaceVideo.data.version_id), 'learner course detail/current version mismatch');
  const otherCategoryCourse = await ctx.request(otherCategory.actor, 'GET', `/me/courses/${courseId}`);
  assert(otherCategoryCourse.status === 200, `other category course was not browsable: ${otherCategoryCourse.status}`);
  const unclassifiedDetail = await ctx.request(unclassified.actor, 'GET', `/me/courses/${courseId}`);
  assert(unclassifiedDetail.status === 200, `unclassified learner course detail failed: ${unclassifiedDetail.status}`);
  const pcProgress = await ctx.request(external.actor, 'GET', `/me/courses/${courseId}/progress`);
  assert(pcProgress.status === 403 && pcProgress.code === 40301,
    `PC session reached mobile video progress: ${pcProgress.status}/${pcProgress.code}`);
  for (const learner of browsingLearners) {
    const mobileActor = await mobileLogin(ctx, learner);
    const courses = await ctx.request(mobileActor, 'GET', '/me/courses');
    assert(courses.status === 200 && courses.data?.total === 2,
      `mobile published course browsing failed for ${learner.realName}`);
    const detail = await ctx.request(mobileActor, 'GET', `/me/courses/${courseId}`);
    assert(detail.status === 200, `mobile course detail failed for ${learner.realName}: ${detail.status}`);
    const progress = await ctx.request(mobileActor, 'GET', `/me/courses/${courseId}/progress`);
    assert(progress.status === 200, `course progress read failed for ${learner.realName}: ${progress.status}/${progress.code}`);
    deepStrictEqual(progress.data, {
      required: 1, completed: 0, completion_rate: 0,
      lessons: [{
        confirmed_position_ms: 0, credited_ms: 0, coverage_ms: 0, duration_ms: 1000,
        completed: false, last_seq: 0, lesson_id: lessonId, version_id: String(replaceVideo.data.version_id),
      }],
    }, `unplayed course did not expose stable zero progress for ${learner.realName}`);
    const repeatedProgress = await ctx.request(mobileActor, 'GET', `/me/courses/${courseId}/progress`);
    deepStrictEqual(repeatedProgress.data, progress.data, `repeated course progress read changed progress for ${learner.realName}`);
    const emptyProgress = await ctx.request(mobileActor, 'GET', `/me/courses/${secondaryId}/progress`);
    assert(emptyProgress.status === 200, `zero-lesson course progress failed: ${emptyProgress.status}`);
    deepStrictEqual(emptyProgress.data, { required: 0, completed: 0, completion_rate: null, lessons: [] });
    const records = await ctx.request(mobileActor, 'GET', '/me/video-records');
    assert(records.status === 200 && records.data?.total === 0 && records.data?.items?.length === 0,
      `course browsing or progress reads created video history for ${learner.realName}`);
  }
  await assertNoVideoActivity();

  const offline = await ctx.request(admin, 'POST', `/admin/courses/${courseId}/offline`);
  assert(offline.status === 200 && offline.data?.status === 'offline', `course offline failed: ${offline.status}`);
  const afterOffline = await ctx.request(institution.actor, 'GET', '/me/courses?page=1&page_size=20');
  assert(afterOffline.status === 200 && afterOffline.data?.total === 1
    && !afterOffline.data.items.some((item) => String(item.id) === courseId), 'offline course remained visible');
  const offlineDetail = await ctx.request(external.actor, 'GET', `/me/courses/${courseId}`);
  assert(offlineDetail.status === 403, `offline course detail remained browsable: ${offlineDetail.status}`);
  const republish = await ctx.request(admin, 'POST', `/admin/courses/${courseId}/publish`);
  assert(republish.status === 200 && republish.data?.status === 'published', `course republish failed: ${republish.status}`);

  const disableCategory = await ctx.request(admin, 'PUT', `/admin/training-categories/${categoryA}/status`, { status: 0 });
  assert(disableCategory.status === 200, `category disable failed: ${disableCategory.status}`);
  const removedRegulationUpdate = await ctx.request(admin, 'PUT', `/regulations/${regulation.data.id}`, {
    title: '不得恢复制度管理', category_id: categoryA,
  });
  assert(removedRegulationUpdate.status === 404, `removed regulation update remained reachable: ${removedRegulationUpdate.status}`);

  const deleteCategory = await ctx.request(admin, 'DELETE', `/admin/training-categories/${categoryA}`);
  assert(deleteCategory.status === 409, `referenced category delete expected 409, got ${deleteCategory.status}`);
}

export async function run(ctx) {
  await runBody(ctx);
  console.log('training-courses: passed');
}
