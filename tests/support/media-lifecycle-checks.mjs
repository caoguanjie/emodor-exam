import { request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdir, readlink, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
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

function normalizedOpenPath(value) {
  const withoutDeletedSuffix = value.replace(/ \(deleted\)$/, '');
  if (!withoutDeletedSuffix.startsWith('/')) return null;
  return resolve(withoutDeletedSuffix);
}

async function procFdPaths(pid) {
  if (process.platform !== 'linux') return null;
  let names;
  try {
    names = await readdir(`/proc/${pid}/fd`);
  } catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)) return null;
    throw error;
  }
  const paths = [];
  for (const name of names) {
    try {
      const target = await readlink(`/proc/${pid}/fd/${name}`);
      const normalized = normalizedOpenPath(target);
      if (normalized) paths.push({ fd: name, path: normalized, linkCount: null });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return paths;
}

async function lsofFdPaths(pid, deletedOnly) {
  try {
    const args = ['-a', '-p', String(pid)];
    if (deletedOnly) args.push('+L1');
    args.push('-F', 'fkn');
    const output = await lsofOutput(args);
    const records = [];
    let current;
    for (const line of output.split('\n')) {
      if (line.startsWith('f')) {
        if (current?.path) records.push(current);
        current = { fd: line.slice(1), path: null, linkCount: null };
      } else if (line.startsWith('k') && current) {
        current.linkCount = Number(line.slice(1));
      } else if (line.startsWith('n') && current) {
        current.path = normalizedOpenPath(line.slice(1));
      }
    }
    if (current?.path) records.push(current);
    return records;
  } catch (error) {
    throw new Error(`FD observation unavailable for owned API pid ${pid}: ${error?.code || error?.message || 'unknown error'}`);
  }
}

async function canonicalOpenPath(value) {
  const absolute = resolve(value);
  try {
    return await realpath(absolute);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    try {
      return join(await realpath(dirname(absolute)), basename(absolute));
    } catch (parentError) {
      if (parentError?.code !== 'ENOENT') throw parentError;
      return absolute;
    }
  }
}

async function exactPathObservation(pid, path, { deletedOnly = false } = {}) {
  const expected = await canonicalOpenPath(path);
  const procRecords = await procFdPaths(pid);
  const mechanism = procRecords === null ? 'lsof' : 'proc';
  const observed = procRecords === null ? await lsofFdPaths(pid, deletedOnly) : procRecords;
  for (const record of observed) {
    if (await canonicalOpenPath(record.path) === expected) {
      return { mechanism, pid, fd: record.fd, linkCount: record.linkCount, name: record.path };
    }
  }
  return null;
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
  const apiPid = Number(ctx.apiPid);
  if (!Number.isInteger(apiPid) || apiPid <= 0) throw new Error('owned API pid unavailable for multipart FD proof');
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
    const fdObservation = await waitUntil(
      () => exactPathObservation(apiPid, exactPath),
      'owned API open file descriptor for multipart temporary',
    );
    ownerPids = [apiPid];
    req.destroy(new Error('intentional lifecycle test abort'));
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('aborted HTTP client did not close')), 2_000)),
    ]);
    await waitUntil(async () => !(await mediaTempNames(ctx)).includes(createdName), 'aborted multipart temporary cleanup');
    await waitUntil(
      async () => {
        const lingering = await exactPathObservation(apiPid, exactPath, { deletedOnly: true });
        if (!lingering) return true;
        throw new Error(`pid=${lingering.pid} fd=${lingering.fd} nlink=${lingering.linkCount ?? 'unknown'} name=${lingering.name}`);
      },
      'aborted multipart open file descriptor cleanup',
    );
    return { before, createdName, ownerPids, fdObservation };
  } catch (error) {
    req.destroy();
    await Promise.race([
      closed,
      new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
    ]);
    throw error;
  } finally {
    if (!req.destroyed) req.destroy();
  }
}
