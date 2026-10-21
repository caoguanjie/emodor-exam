import { request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdir, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { MediaAsset } = require('./dist/entities/media-asset.entity.js');
const { MediaReference } = require('./dist/entities/media-reference.entity.js');
const { MediaService } = require('./dist/modules/media/media.service.js');
const { DEFAULT_MEDIA_LIMITS } = require('./dist/modules/media/media-policy.js');
const execFileAsync = promisify(execFile);

const TEMP_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.upload$/i;

export function mediaTempDir(ctx) {
  return join(ctx.env.UPLOAD_DIR, 'tmp', 'media');
}

export async function mediaTempNames(ctx) {
  try {
    return (await readdir(mediaTempDir(ctx))).filter((name) => TEMP_NAME.test(name)).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export function storagePathFor(ctx, storageKey) {
  const root = resolve(ctx.env.UPLOAD_DIR);
  const path = resolve(root, storageKey);
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new Error('media lifecycle test refused an unmanaged storage path');
  }
  return path;
}

export async function waitUntil(check, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function lsofOutput(args) {
  try {
    const result = await execFileAsync('lsof', args, { encoding: 'utf8', maxBuffer: 512 * 1024, timeout: 2_000 });
    return result.stdout;
  } catch (error) {
    if (error?.code === 1) return error.stdout || '';
    throw error;
  }
}

async function exactPathOwnerPids(path) {
  const output = await lsofOutput(['-F', 'pn', '--', path]);
  return [...new Set(output.split('\n')
    .filter((line) => /^p\d+$/.test(line))
    .map((line) => Number(line.slice(1))))];
}

async function processHoldsDeletedPath(pid, path) {
  const output = await lsofOutput(['-a', '-p', String(pid), '+L1', '-F', 'n']);
  const expected = resolve(path);
  return output.split('\n').some((line) => {
    if (!line.startsWith('n')) return false;
    const openPath = line.slice(1).replace(/ \(deleted\)$/, '');
    return resolve(openPath) === expected;
  });
}

function dataSourceOptions(ctx) {
  return {
    type: 'mysql',
    host: ctx.env.DB_HOST,
    port: Number(ctx.env.DB_PORT),
    username: ctx.env.DB_USERNAME,
    password: ctx.env.DB_PASSWORD,
    database: ctx.env.DB_DATABASE,
    charset: 'utf8mb4_0900_ai_ci',
    timezone: 'Z',
    entities: [MediaAsset, MediaReference],
    synchronize: false,
    logging: false,
    extra: { connectionLimit: 4 },
  };
}

function serviceFor(ctx, dataSource) {
  const config = {
    upload: { dir: ctx.env.UPLOAD_DIR },
    media: DEFAULT_MEDIA_LIMITS,
  };
  const probeMustNotRun = {
    probe: async () => { throw new Error('media lifecycle check unexpectedly invoked probe'); },
  };
  return new MediaService(
    dataSource.getRepository(MediaAsset),
    dataSource.getRepository(MediaReference),
    dataSource,
    config,
    probeMustNotRun,
  );
}

function registerLifecyclePolicy(media) {
  media.registerOwnerPolicy('lifecycle_business_media', {
    allowedPurposes: ['avatar', 'course_cover'],
    authorizeRead: () => true,
    validateBinding: async (manager, _asset, businessId) => {
      const rows = await manager.query('SELECT id FROM sys_user WHERE id = ? LIMIT 1', [String(businessId)]);
      if (!rows.length) throw new Error('lifecycle business owner must be an existing user');
    },
  });
}

export async function createMediaServicePair(ctx) {
  const bindDataSource = new DataSource(dataSourceOptions(ctx));
  const deleteDataSource = new DataSource(dataSourceOptions(ctx));
  try {
    await bindDataSource.initialize();
    await deleteDataSource.initialize();
  } catch (error) {
    if (bindDataSource.isInitialized) await bindDataSource.destroy();
    if (deleteDataSource.isInitialized) await deleteDataSource.destroy();
    throw error;
  }
  const bindMedia = serviceFor(ctx, bindDataSource);
  const deleteMedia = serviceFor(ctx, deleteDataSource);
  registerLifecyclePolicy(bindMedia);
  registerLifecyclePolicy(deleteMedia);
  return {
    bindDataSource,
    deleteDataSource,
    bindMedia,
    deleteMedia,
    async close() {
      const errors = [];
      for (const dataSource of [bindDataSource, deleteDataSource]) {
        if (!dataSource.isInitialized) continue;
        try { await dataSource.destroy(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'media lifecycle DataSource cleanup failed');
    },
  };
}

export async function abortMultipartAfterTempCreated(ctx, actor) {
  const before = await mediaTempNames(ctx);
  const beforeSet = new Set(before);
  const boundary = `----ruleexam-abort-${Date.now().toString(16)}`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\navatar\r\n`
    + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="aborted.png"\r\n`
    + 'Content-Type: image/png\r\n\r\n',
  );
  const url = new URL(`${ctx.baseUrl.replace(/\/$/, '')}/media/upload`);
  const req = httpRequest(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${actor.accessToken}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Transfer-Encoding': 'chunked',
    },
  });
  req.on('error', () => undefined);
  req.on('response', (response) => response.resume());
  const closed = new Promise((resolvePromise) => req.once('close', resolvePromise));
  let createdName;
  let exactPath;
  let ownerPids = [];
  try {
    req.flushHeaders();
    req.write(prefix);
    req.write(Buffer.alloc(256 * 1024, 0x61));
    createdName = await waitUntil(async () => {
      const added = (await mediaTempNames(ctx)).filter((name) => !beforeSet.has(name));
      return added.length === 1 ? added[0] : false;
    }, 'server-created multipart temporary file');
    exactPath = join(mediaTempDir(ctx), createdName);
    ownerPids = await waitUntil(async () => {
      const owners = await exactPathOwnerPids(exactPath);
      return owners.length ? owners : false;
    }, 'API open file descriptor for multipart temporary');
    req.destroy(new Error('intentional lifecycle test abort'));
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('aborted HTTP client did not close')), 2_000)),
    ]);
    await waitUntil(async () => !(await mediaTempNames(ctx)).includes(createdName), 'aborted multipart temporary cleanup');
    await waitUntil(async () => {
      const held = await Promise.all(ownerPids.map((pid) => processHoldsDeletedPath(pid, exactPath)));
      return held.every((value) => !value);
    }, 'aborted multipart open file descriptor cleanup');
    return { before, createdName, ownerPids };
  } catch (error) {
    req.destroy();
    await closed.catch(() => undefined);
    if (createdName) await rm(join(mediaTempDir(ctx), createdName), { force: true }).catch(() => undefined);
    throw error;
  } finally {
    if (!req.destroyed) req.destroy();
  }
}
