import { mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './training-access.mjs';
import {
  abortMultipartAfterTempCreated,
  createMediaServicePair,
  mediaTempNames,
  storagePathFor,
} from './support/media-lifecycle-checks.mjs';

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

async function pathStat(path) {
  try { return await stat(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function captureError(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

async function verifyPhysicalDeleteRetry(ctx, lifecycle, studentA, studentB, png) {
  assert(studentA.id !== studentB.id && /^\d+$/.test(studentA.id) && /^\d+$/.test(studentB.id), 'physical-delete lifecycle owners must be valid distinct decimal ids');
  const uploaded = await upload(ctx, studentA.actor, { purpose: 'avatar' }, png, 'delete-fault.png', 'image/png');
  assert(uploaded.status === 200 && uploaded.data?.asset_id, `delete-fault upload failed: ${uploaded.status}`);
  const assetId = String(uploaded.data.asset_id);
  const rows = await ctx.queryTestDb('SELECT owner_id, storage_key, status FROM media_asset WHERE id = ?', [assetId]);
  assert(rows.length === 1 && String(rows[0].owner_id) === studentA.id && rows[0].status === 'ready', 'delete-fault asset setup mismatch');
  const assetPath = storagePathFor(ctx, rows[0].storage_key);
  const backupPath = `${assetPath}.lifecycle-${randomBytes(6).toString('hex')}.bak`;
  await rename(assetPath, backupPath);
  await mkdir(assetPath);
  try {
    const failedDelete = await ctx.request(studentA.actor, 'DELETE', `/media/${assetId}`);
    assert(failedDelete.status === 503 && failedDelete.code === 50004, `physical delete failure expected 50004: ${failedDelete.status}/${failedDelete.code}`);
    const retained = await ctx.queryTestDb('SELECT storage_key, status FROM media_asset WHERE id = ?', [assetId]);
    assert(retained.length === 1 && retained[0].status === 'deleting' && retained[0].storage_key === rows[0].storage_key, 'physical delete failure lost durable row/file tracking');
    assert((await pathStat(assetPath))?.isDirectory() && (await pathStat(backupPath))?.isFile(), 'physical delete fault fixture was not preserved');
    const metadata = await ctx.request(studentA.actor, 'GET', `/media/${assetId}`);
    const content = await ctx.request(studentA.actor, 'GET', `/media/${assetId}/content`);
    assert(metadata.status === 404 && content.status === 404, `deleting asset remained publicly visible: ${metadata.status}/${content.status}`);
    const bindError = await captureError(lifecycle.bindDataSource.transaction((manager) => (
      lifecycle.bindMedia.bind(manager, assetId, 'lifecycle_business_media', studentB.id)
    )));
    assert(bindError?.code === 40401, `new bind to deleting asset expected 40401: ${bindError?.code ?? 'resolved'}`);
    const refs = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM media_reference WHERE asset_id = ?', [assetId]);
    assert(Number(refs[0]?.count || 0) === 0, 'rejected bind created a reference for deleting media');
  } finally {
    if ((await pathStat(assetPath))?.isDirectory()) await rm(assetPath, { recursive: true, force: true });
    if (await pathStat(backupPath)) await rename(backupPath, assetPath);
  }
  const removed = await lifecycle.deleteMedia.cleanupOrphans(60_000);
  assert(removed === 1, `physical delete retry must count one actual success, got ${removed}`);
  const after = await ctx.queryTestDb('SELECT id FROM media_asset WHERE id = ?', [assetId]);
  assert(after.length === 0 && !(await pathStat(assetPath)) && !(await pathStat(backupPath)), 'physical delete retry did not remove the row and exact owned file');
}

async function verifyBindDeleteRace(ctx, lifecycle, admin, businessId, png) {
  const uploaded = await upload(ctx, admin, { purpose: 'course_cover' }, png, 'bind-race.png', 'image/png');
  assert(uploaded.status === 200 && uploaded.data?.asset_id, `bind/delete race upload failed: ${uploaded.status}`);
  const assetId = String(uploaded.data.asset_id);
  const rows = await ctx.queryTestDb('SELECT owner_id, storage_key FROM media_asset WHERE id = ?', [assetId]);
  const ownerId = String(rows[0]?.owner_id || '');
  assert(/^\d+$/.test(ownerId) && /^\d+$/.test(businessId) && ownerId !== businessId, 'bind/delete race requires valid distinct owner and business ids');
  const assetPath = storagePathFor(ctx, rows[0].storage_key);
  const runner = lifecycle.bindDataSource.createQueryRunner();
  let transactionOpen = false;
  let runnerReleased = false;
  let deletionOutcome;
  try {
    await runner.connect();
    await runner.startTransaction();
    transactionOpen = true;
    await lifecycle.bindMedia.bind(runner.manager, assetId, 'lifecycle_business_media', businessId);
    const inside = await runner.query('SELECT COUNT(*) AS count FROM media_reference WHERE asset_id = ? AND owner_type = ? AND owner_id = ?', [assetId, 'lifecycle_business_media', businessId]);
    assert(Number(inside[0]?.count || 0) === 1, 'production bind did not create the reference inside its transaction');

    deletionOutcome = lifecycle.deleteMedia.remove(ownerId, assetId).then(
      () => ({ resolved: true }),
      (error) => ({ resolved: false, error }),
    );
    const blocked = await Promise.race([
      deletionOutcome.then((outcome) => ({ state: 'settled', outcome })),
      new Promise((resolvePromise) => setTimeout(() => resolvePromise({ state: 'waiting' }), 250)),
    ]);
    assert(blocked.state === 'waiting', `delete did not wait for the bind transaction's asset lock: ${blocked.outcome?.error?.code ?? 'resolved'}`);

    await runner.commitTransaction();
    transactionOpen = false;
    await runner.release();
    runnerReleased = true;
    const outcome = await Promise.race([
      deletionOutcome,
      new Promise((_, reject) => setTimeout(() => reject(new Error('delete did not settle after bind commit')), 5_000)),
    ]);
    assert(!outcome.resolved && outcome.error?.code === 40913, `delete after committed bind expected 40913: ${outcome.error?.code ?? 'resolved'}`);
    const retained = await ctx.queryTestDb('SELECT status FROM media_asset WHERE id = ?', [assetId]);
    const refs = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM media_reference WHERE asset_id = ? AND owner_type = ? AND owner_id = ?', [assetId, 'lifecycle_business_media', businessId]);
    assert(retained[0]?.status === 'ready' && Number(refs[0]?.count || 0) === 1 && (await pathStat(assetPath))?.isFile(), 'bind/delete race lost the ready asset, reference, or physical file');
  } finally {
    if (transactionOpen) await runner.rollbackTransaction().catch(() => undefined);
    if (!runnerReleased) await runner.release().catch(() => undefined);
    await lifecycle.deleteDataSource.transaction((manager) => (
      lifecycle.deleteMedia.unbind(manager, assetId, 'lifecycle_business_media', businessId)
    )).catch(() => undefined);
    await lifecycle.deleteMedia.remove(ownerId, assetId).catch(() => undefined);
  }
  const cleaned = await ctx.queryTestDb('SELECT id FROM media_asset WHERE id = ?', [assetId]);
  assert(cleaned.length === 0 && !(await pathStat(assetPath)), 'bind/delete race exact cleanup failed');
}

async function verifyAbortedMultipartCleanup(ctx, actor) {
  const beforeAssets = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM media_asset');
  const observed = await abortMultipartAfterTempCreated(ctx, actor);
  const afterTemps = await mediaTempNames(ctx);
  const afterAssets = await ctx.queryTestDb('SELECT COUNT(*) AS count FROM media_asset');
  const health = await ctx.request(actor, 'GET', '/media/limits');
  assert(observed.ownerPids.length >= 1, 'HTTP abort test did not observe the API open file descriptor for its exact temporary path');
  assert(!afterTemps.includes(observed.createdName) && JSON.stringify(afterTemps) === JSON.stringify(observed.before), 'HTTP abort left its exact multipart temporary file');
  assert(Number(afterAssets[0]?.count || 0) === Number(beforeAssets[0]?.count || 0), 'HTTP abort published a media asset');
  assert(health.status === 200, `API did not accept a follow-up request after multipart abort: ${health.status}`);
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

  const beforeRejectedMultipart = await mediaTempNames(ctx);
  const fake = await upload(ctx, admin, { purpose: 'video' }, Buffer.from('not an mp4'), 'fake.mp4', 'video/mp4');
  assert(fake.status === 400, `fake mp4 expected 400: ${fake.status}`);
  const missingPurpose = await upload(ctx, studentA.actor, {}, png, 'missing-purpose.png', 'image/png');
  assert(missingPurpose.status === 400, `missing purpose expected 400: ${missingPurpose.status}`);
  const unknownField = await upload(ctx, studentA.actor, { purpose: 'avatar', unexpected: 'x' }, png, 'unknown-field.png', 'image/png');
  assert(unknownField.status === 400, `unknown multipart field expected 400: ${unknownField.status}`);
  const afterRejectedMultipart = await mediaTempNames(ctx);
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

  await verifyAbortedMultipartCleanup(ctx, studentA.actor);
  const lifecycle = await createMediaServicePair(ctx);
  try {
    await verifyPhysicalDeleteRetry(ctx, lifecycle, studentA, studentB, png);
    await verifyBindDeleteRace(ctx, lifecycle, admin, studentB.id, png);
  } finally {
    await lifecycle.close();
  }
}
