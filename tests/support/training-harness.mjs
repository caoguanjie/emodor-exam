import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { isSafeTestDatabase } from './test-target.mjs';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_API_ENTRY = join(PROJECT_ROOT, 'server', 'dist', 'main.js');

function runtimeSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function contentTypeFor(filename) {
  const lower = String(filename).toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

function relativeApiPath(path) {
  if (typeof path !== 'string' || !path || /^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw new Error('API path must be a non-empty relative path');
  }
  return path.replace(/^\/+/, '');
}

function actorHeaders(actor) {
  if (typeof actor === 'string') actor = { accessToken: actor };
  const headers = {};
  const accessToken = actor?.accessToken || actor?.access_token;
  if (accessToken) headers.Authorization = String(accessToken).startsWith('Bearer ')
    ? String(accessToken)
    : `Bearer ${accessToken}`;
  if (actor?.cookie) headers.Cookie = String(actor.cookie);
  return headers;
}

function cookieHeader(setCookies) {
  if (!Array.isArray(setCookies) || !setCookies.length) return undefined;
  return setCookies
    .map((cookie) => String(cookie).split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}

async function responseResult(response) {
  const headers = Object.fromEntries(response.headers.entries());
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (headers['set-cookie'] ? [headers['set-cookie']] : []);
  if (setCookies.length) headers['set-cookie'] = setCookies;
  const contentType = response.headers.get('content-type') || '';
  let body;
  if (contentType.includes('json')) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } else {
    const bytes = Buffer.from(await response.arrayBuffer());
    body = bytes.length ? bytes : null;
  }
  return {
    status: response.status,
    code: body && typeof body === 'object' && !Buffer.isBuffer(body) && 'code' in body ? body.code : response.status,
    data: body && typeof body === 'object' && !Buffer.isBuffer(body) && 'data' in body ? body.data : body,
    headers,
    setCookies,
    json: body && typeof body === 'object' && !Buffer.isBuffer(body) ? body : undefined,
    body,
  };
}

async function waitForApi(baseUrl, child, getSpawnError = () => undefined, timeoutMs = 40_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const spawnError = getSpawnError();
    if (spawnError) throw spawnError;
    if (childExited(child)) throw new Error(`API exited before becoming ready (code ${child.exitCode ?? child.signalCode})`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch { /* process is still booting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API 服务未在 40 秒内就绪');
}

function childExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child, timeoutMs) {
  if (childExited(child)) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      child.removeListener('error', onExit);
      resolve(childExited(child));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
    child.once('error', onExit);
  });
}

async function stopApi(child) {
  if (!child || childExited(child)) return;
  child.kill('SIGTERM');
  if (await waitForChildExit(child, 5_000)) return;
  if (!childExited(child)) {
    child.kill('SIGKILL');
    if (!(await waitForChildExit(child, 5_000)) && !childExited(child)) {
      throw new Error('API process did not exit; refusing to remove its task directory');
    }
  }
}

/**
 * Creates run-owned data paths, runtime secrets and test-only API helpers.
 * The API process is optional until restartApi() is called; restarts always
 * reuse the same env, database, Redis prefix and filesystem paths.
 */
export async function createTrainingHarness({
  root = undefined,
  redisPrefix = undefined,
  port = undefined,
  baseUrl = undefined,
  database = undefined,
  db = undefined,
  redis = undefined,
  env: envOverrides = {},
  apiEntry = DEFAULT_API_ENTRY,
  apiArgs = [],
  apiCwd = PROJECT_ROOT,
} = {}) {
  const ownsRoot = !root;
  const ownedRoot = root || await mkdtemp(join(tmpdir(), 'ruleexam-training-'));
  const dataDir = join(ownedRoot, 'data');
  const uploadDir = join(dataDir, 'uploads');
  const logDir = join(dataDir, 'logs');
  await mkdir(uploadDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
  const prefix = redisPrefix || `training:${randomBytes(10).toString('hex')}:`;
  const adminPassword = envOverrides.ADMIN_INITIAL_PASSWORD || `A9${runtimeSecret(18)}`;
  const env = {
    ...process.env,
    ...envOverrides,
    NODE_ENV: envOverrides.NODE_ENV || process.env.NODE_ENV || 'development',
    JWT_SECRET: envOverrides.JWT_SECRET || runtimeSecret(48),
    JWT_SECRET_PRIOR: envOverrides.JWT_SECRET_PRIOR || runtimeSecret(48),
    EXAM_SHUFFLE_SECRET: envOverrides.EXAM_SHUFFLE_SECRET || runtimeSecret(32),
    APP_ENCRYPTION_KEY: envOverrides.APP_ENCRYPTION_KEY || runtimeSecret(32),
    ADMIN_INITIAL_PASSWORD: adminPassword,
    REDIS_KEY_PREFIX: prefix,
    UPLOAD_DIR: uploadDir,
    DATA_DIR: dataDir,
    LOG_DIR: logDir,
    AI_EGRESS_ALLOW_HOSTS: envOverrides.AI_EGRESS_ALLOW_HOSTS || process.env.AI_EGRESS_ALLOW_HOSTS || '127.0.0.1',
  };
  if (database !== undefined) env.DB_DATABASE = database;
  if (db) {
    env.DB_HOST = db.host;
    env.DB_PORT = String(db.port);
    env.DB_USERNAME = db.user;
    env.DB_PASSWORD = db.password;
  }
  if (redis) {
    env.REDIS_HOST = redis.host;
    env.REDIS_PORT = String(redis.port);
    env.REDIS_PASSWORD = redis.password || '';
  }
  if (port !== undefined) env.PORT = String(port);
  else if (!env.PORT) env.PORT = '3000';
  const apiPort = Number(env.PORT);
  const apiBaseUrl = baseUrl || `http://127.0.0.1:${apiPort}/api/v1`;
  const dbConfig = db || {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USERNAME || 'root',
    password: env.DB_PASSWORD,
  };
  const testDatabase = database || env.DB_DATABASE;
  const redisConfig = redis || {
    host: env.REDIS_HOST || '127.0.0.1',
    port: Number(env.REDIS_PORT || 6379),
    password: env.REDIS_PASSWORD || undefined,
  };
  let api;
  let cleaned = false;
  let restartPromise;

  async function restartApi() {
    if (cleaned) throw new Error('training harness has already been cleaned up');
    if (restartPromise) return restartPromise;
    if (!isSafeTestDatabase(testDatabase)) {
      throw new Error('restartApi only permits ruleexam_test_<suffix> databases');
    }
    restartPromise = (async () => {
      await stopApi(api);
      api = spawn(process.execPath, [apiEntry, ...apiArgs], {
        cwd: apiCwd,
        env: { ...env, PORT: String(apiPort) },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      let spawnError;
      api.once('error', (error) => { spawnError = error; });
      try {
        await waitForApi(apiBaseUrl, api, () => spawnError);
      } catch (error) {
        await stopApi(api);
        api = undefined;
        throw error;
      }
      return { pid: api.pid, baseUrl: apiBaseUrl };
    })();
    try {
      return await restartPromise;
    } finally {
      restartPromise = undefined;
    }
  }

  async function request(actor, method, path, body = undefined, extraHeaders = {}) {
    const headers = { ...actorHeaders(actor), ...extraHeaders };
    let payload;
    if (body !== undefined) {
      if (Buffer.isBuffer(body) || body instanceof Uint8Array || typeof body === 'string') {
        payload = body;
      } else {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        payload = JSON.stringify(body);
      }
    }
    const response = await fetch(`${apiBaseUrl}/${relativeApiPath(path)}`, {
      method,
      headers,
      body: payload,
    });
    const result = await responseResult(response);
    if (actor && typeof actor === 'object') {
      const captured = cookieHeader(result.setCookies);
      if (captured) actor.cookie = captured;
    }
    return result;
  }

  async function upload(actor, path, bytes, filename) {
    const boundary = `----ruleexam-harness-${randomBytes(12).toString('hex')}`;
    const safeFilename = String(filename || 'upload.bin').replace(/["\r\n]/g, '_');
    const fileBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const multipart = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${contentTypeFor(safeFilename)}\r\n\r\n`),
      fileBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return request(actor, 'POST', path, multipart, { 'Content-Type': `multipart/form-data; boundary=${boundary}` });
  }

  async function queryTestDb(sql, params = []) {
    if (!isSafeTestDatabase(testDatabase)) {
      throw new Error('queryTestDb only permits ruleexam_test_<suffix> databases');
    }
    if (typeof sql !== 'string' || !sql.trim()) throw new Error('queryTestDb requires SQL');
    const connection = await mysql.createConnection({ ...dbConfig, database: testDatabase });
    try {
      const [rows, fields] = await connection.execute(sql, params);
      if (Array.isArray(rows)) {
        Object.defineProperty(rows, 'rows', { value: rows, enumerable: false });
        Object.defineProperty(rows, 'fields', { value: fields, enumerable: false });
      }
      return rows;
    } finally {
      await connection.end();
    }
  }

  return {
    root: ownedRoot,
    dataDir,
    uploadDir,
    logDir,
    redisPrefix: prefix,
    adminPassword,
    env,
    baseUrl: apiBaseUrl,
    database: testDatabase,
    db: dbConfig,
    redis: redisConfig,
    request,
    upload,
    restartApi,
    queryTestDb,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await stopApi(api);
      if (ownsRoot) await rm(ownedRoot, { recursive: true, force: true });
    },
  };
}
