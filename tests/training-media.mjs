import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './training-access.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function login(ctx, username, password, label) {
  const sourceIp = `198.51.100.${(login.sequence = (login.sequence || 0) + 1)}`;
  const headers = { 'X-Forwarded-For': sourceIp };
  const captcha = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert(captcha.status === 200 && captcha.data?.captcha_id, `${label} captcha failed`);
  const code = await captchaAnswer(ctx, captcha.data.captcha_id);
  const actor = {};
  const result = await ctx.request(actor, 'POST', '/auth/login', {
    username, password, captcha_id: captcha.data.captcha_id, captcha_code: code,
  }, headers);
  assert(result.status === 200, `${label} login failed: ${result.status}`);
  actor.accessToken = result.data.access_token;
  if (!result.data.force_change_password) return actor;
  const nextPassword = randomStrongPassword(username, label);
  const changed = await ctx.request(actor, 'PUT', '/auth/password', { old_password: password, new_password: nextPassword });
  assert(changed.status === 200 && changed.data?.access_token, `${label} first password change failed`);
  actor.accessToken = changed.data.access_token;
  return actor;
}

function multipart(fields, bytes, filename, contentType) {
  const boundary = `----ruleexam-media-${randomBytes(12).toString('hex')}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
  parts.push(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(ctx, actor, fields, bytes, filename, contentType) {
  const payload = multipart(fields, bytes, filename, contentType);
  return ctx.request(actor, 'POST', '/media/upload', payload.body, payload.headers);
}

function pngFixture() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
}

async function ffmpegFixture(extension = '.mp4') {
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-fixture-'));
  const output = join(root, `silent-h264${extension}`);
  const executable = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    await new Promise((resolve, reject) => {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:d=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an',
      ];
      if (extension === '.mp4') args.push('-movflags', '+faststart');
      args.push('-y', output);
      const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      let stderrBytes = 0;
      let settled = false;
      let timer;
      const stop = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(error);
      };
      child.stderr.on('data', (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > 256 * 1024) {
          stop(new Error('ffmpeg fixture output exceeded limit'));
          return;
        }
        stderr += chunk.toString();
      });
      child.once('error', stop);
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg failed: ${stderr.slice(0, 200)}`));
      });
      timer = setTimeout(() => stop(new Error('ffmpeg fixture timed out')), 15_000);
    });
    return await readFile(output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function tempNames(ctx) {
  try { return (await readdir(join(ctx.uploadDir, 'tmp', 'media'))).sort(); }
  catch { return []; }
}

async function createStudent(ctx, admin, categoryId, label) {
  const username = `media_${label}_${randomBytes(4).toString('hex')}`;
  const password = randomStrongPassword(username, label);
  const created = await ctx.request(admin, 'POST', '/admin/students', {
    username, password, real_name: label, category_id: String(categoryId), source: 'institution',
  });
  assert(created.status === 200 && created.data?.id, `${label} create failed: ${created.status}`);
  return { id: String(created.data.id), actor: await login(ctx, username, password, label) };
}

export async function run(ctx) {
  const admin = await login(ctx, 'admin', ctx.adminPassword, 'admin');
  const limits = await ctx.request(admin, 'GET', '/media/limits');
  assert(limits.status === 200 && limits.data.video_max_bytes === 512 * 1024 * 1024, 'media limits mismatch');
  assert(limits.data.image_max_bytes === 10 * 1024 * 1024 && limits.data.image_max_pixels === 25_000_000 && limits.data.probe_timeout_ms === 30_000, 'media limits incomplete');

  const category = await ctx.request(admin, 'POST', '/admin/training-categories', { name: `媒体回归 ${randomBytes(4).toString('hex')}` });
  assert(category.status === 200 && category.data?.id, `media category failed: ${category.status}`);
  const studentA = await createStudent(ctx, admin, category.data.id, '媒体甲');
  const studentB = await createStudent(ctx, admin, category.data.id, '媒体乙');
  const png = pngFixture();

  const own = await upload(ctx, studentA.actor, { purpose: 'avatar' }, png, 'avatar.png', 'image/png');
  assert(own.status === 200 && own.data?.asset_id && own.data.status === 'ready', `avatar upload failed: ${own.status} ${JSON.stringify(own.json || own.body)}`);
  assert(own.data.duration_ms === null, 'image duration should be null');
  const profile = await ctx.request(studentA.actor, 'PATCH', '/me/profile', { avatar_id: String(own.data.asset_id) });
  assert(profile.status === 200 && profile.data.avatar_id === String(own.data.asset_id), `avatar bind failed: ${profile.status}`);
  const refs = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM media_reference WHERE asset_id = ?', [String(own.data.asset_id)]);
  assert(Number(refs[0]?.count || 0) === 1, 'avatar reference was not created');

  const range = await ctx.request(studentA.actor, 'GET', `/media/${own.data.asset_id}/content`, undefined, { Range: 'bytes=0-7' });
  assert(range.status === 206 && range.headers['content-range']?.startsWith('bytes 0-7/'), `range read failed: ${range.status}`);
  assert(Buffer.isBuffer(range.body) && range.body.equals(png.subarray(0, 8)), 'range body did not match stored bytes');
  const denied = await ctx.request(studentB.actor, 'GET', `/media/${own.data.asset_id}/content`);
  assert(denied.status === 403, `cross-user media read unexpectedly allowed: ${denied.status}`);
  const deleteReferenced = await ctx.request(studentA.actor, 'DELETE', `/media/${own.data.asset_id}`);
  assert(deleteReferenced.status === 409, `referenced media delete expected 409: ${deleteReferenced.status}`);

  const beforeRejectedMultipart = await tempNames(ctx);
  const fake = await upload(ctx, admin, { purpose: 'video' }, Buffer.from('not an mp4'), 'fake.mp4', 'video/mp4');
  assert(fake.status === 400, `fake mp4 expected 400: ${fake.status}`);
  const missingPurpose = await upload(ctx, studentA.actor, {}, png, 'missing-purpose.png', 'image/png');
  assert(missingPurpose.status === 400, `missing purpose expected 400: ${missingPurpose.status}`);
  const unknownField = await upload(ctx, studentA.actor, { purpose: 'avatar', unexpected: 'x' }, png, 'unknown-field.png', 'image/png');
  assert(unknownField.status === 400, `unknown multipart field expected 400: ${unknownField.status}`);
  const afterRejectedMultipart = await tempNames(ctx);
  assert(JSON.stringify(afterRejectedMultipart) === JSON.stringify(beforeRejectedMultipart), 'rejected multipart left a temporary file');
  const answer = await upload(ctx, studentA.actor, { purpose: 'answer' }, png, 'answer.png', 'image/png');
  assert(answer.status === 400, `generic answer upload expected 400: ${answer.status}`);
  const oversized = await upload(ctx, studentA.actor, { purpose: 'avatar' }, Buffer.alloc(10 * 1024 * 1024 + 1), 'oversize.png', 'image/png');
  assert(oversized.status === 422, `oversize image expected 422: ${oversized.status}`);

  const delegated = await upload(ctx, admin, { purpose: 'avatar', owner_id: studentB.id }, png, 'student-avatar.png', 'image/png');
  assert(delegated.status === 200 && delegated.data?.asset_id, `delegated avatar upload failed: ${delegated.status} ${JSON.stringify(delegated.json || delegated.body)}`);
  const delegatedBind = await ctx.request(admin, 'PUT', `/admin/students/${studentB.id}/avatar`, { avatar_id: String(delegated.data.asset_id) });
  assert(delegatedBind.status === 200 && delegatedBind.data.avatar_id === String(delegated.data.asset_id), `delegated avatar bind failed: ${delegatedBind.status}`);
  const delegatedMetadata = await ctx.request(admin, 'GET', `/media/${delegated.data.asset_id}`);
  assert(delegatedMetadata.status === 200 && delegatedMetadata.data.asset_id === String(delegated.data.asset_id), 'student avatar manager read failed');
  const stopStudent = await ctx.request(admin, 'PUT', `/admin/students/${studentB.id}/status`, { status: 0 });
  assert(stopStudent.status === 200, `inactive managed student setup failed: ${stopStudent.status}`);
  const inactiveMetadata = await ctx.request(admin, 'GET', `/media/${delegated.data.asset_id}`);
  assert(inactiveMetadata.status === 200, `inactive managed student avatar read denied: ${inactiveMetadata.status}`);
  await ctx.request(admin, 'PUT', `/admin/students/${studentB.id}/status`, { status: 1 });

  const role = await ctx.request(admin, 'POST', '/admin/roles', {
    code: `media_role_${randomBytes(4).toString('hex')}`,
    name: '媒体业务角色',
    permissions: ['statistics:read'],
  });
  assert(role.status === 200 && role.data?.id, `media business role create failed: ${role.status}`);
  const businessUsername = `media_business_${randomBytes(4).toString('hex')}`;
  const businessPassword = randomStrongPassword(businessUsername, 'business-role');
  const business = await ctx.request(admin, 'POST', '/users', {
    username: businessUsername,
    password: businessPassword,
    real_name: '媒体业务账号',
    role: 'employee',
  });
  assert(business.status === 200 && business.data?.id, `media business account create failed: ${business.status}`);
  const assigned = await ctx.request(admin, 'PUT', `/admin/administrators/${business.data.id}/roles`, {
    role_ids: [String(role.data.id)],
  });
  assert(assigned.status === 200, `media business role assignment failed: ${assigned.status}`);
  const businessAsset = await upload(ctx, admin, { purpose: 'avatar', owner_id: String(business.data.id) }, png, 'business-avatar.png', 'image/png');
  assert(businessAsset.status === 200, `business-role avatar upload failed: ${businessAsset.status}`);
  await ctx.queryTestDb(
    'INSERT INTO media_reference (asset_id, owner_type, owner_id) VALUES (?, ?, ?)',
    [String(businessAsset.data.asset_id), 'user_avatar', String(business.data.id)],
  );
  const businessRead = await ctx.request(admin, 'GET', `/media/${businessAsset.data.asset_id}`);
  assert(businessRead.status === 403, `business-role avatar read unexpectedly allowed: ${businessRead.status}`);

  const wrongContainer = await upload(ctx, admin, { purpose: 'video' }, await ffmpegFixture('.mkv'), 'lesson.mkv', 'video/mp4');
  assert(wrongContainer.status === 400, `non-MP4 container expected 400: ${wrongContainer.status}`);
  const quickTime = await upload(ctx, admin, { purpose: 'video' }, await ffmpegFixture('.mov'), 'lesson.mov', 'video/mp4');
  assert(quickTime.status === 400, `QuickTime container expected 400: ${quickTime.status}`);
  const videoBytes = await ffmpegFixture();
  const video = await upload(ctx, admin, { purpose: 'video' }, videoBytes, 'lesson.mp4', 'video/mp4');
  assert(video.status === 200 && video.data.status === 'ready' && video.data.duration_ms > 0, `real video probe failed: ${video.status}`);
  const videoOwner = await ctx.request(admin, 'GET', `/media/${video.data.asset_id}`);
  assert(videoOwner.status === 200 && videoOwner.data.duration_ms > 0, 'video metadata duration missing');
  const videoAvatar = await upload(ctx, admin, { purpose: 'avatar' }, videoBytes, 'video-avatar.png', 'image/png');
  assert(videoAvatar.status === 400, `video-as-avatar expected 400: ${videoAvatar.status}`);
  const videoRange = await ctx.request(admin, 'GET', `/media/${video.data.asset_id}/content`, undefined, { Range: 'bytes=0-31' });
  assert(videoRange.status === 206 && Buffer.isBuffer(videoRange.body) && videoRange.body.equals(videoBytes.subarray(0, 32)), 'video range body did not match stored bytes');
  const invalidRange = await ctx.request(admin, 'GET', `/media/${video.data.asset_id}/content`, undefined, { Range: 'bytes=999999999-' });
  assert(invalidRange.status === 416 && invalidRange.code === 41601, `invalid media range expected 41601: ${invalidRange.status}/${invalidRange.code}`);

  const orphan = await upload(ctx, studentA.actor, { purpose: 'avatar' }, png, 'orphan.png', 'image/png');
  assert(orphan.status === 200, `orphan upload failed: ${orphan.status}`);
  const removed = await ctx.request(studentA.actor, 'DELETE', `/media/${orphan.data.asset_id}`);
  assert(removed.status === 200, `orphan delete failed: ${removed.status}`);
  const missing = await ctx.request(studentA.actor, 'GET', `/media/${orphan.data.asset_id}`);
  assert(missing.status === 404, `deleted media metadata expected 404: ${missing.status}`);
}
