// EmodorRuleExam 端到端测试启动器。
// 默认只接受 ruleexam_test_* 目标库；--ephemeral 会创建本次运行专属的
// 本地 MySQL/Redis，避免任何开发服务连接。口令/密钥只存在运行期环境。
//
// 用法：
//   DB_DATABASE=ruleexam_test_training DB_PASSWORD=... node tests/run-e2e.mjs --suite smoke
//   node tests/run-e2e.mjs --ephemeral --suite smoke
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { validateTestTarget, isSafeTestDatabase } from './support/test-target.mjs';
import { createTrainingHarness, stopApi } from './support/training-harness.mjs';
import { createEphemeralServices, getFreePort } from './support/ephemeral-services.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');

// Registered files are explicit. User input selects a key; it never becomes a
// path or shell fragment.
export const SUITE_REGISTRY = Object.freeze({
  smoke: join(ROOT, 'tests', 'suites', 'e2e-smoke-adapter.mjs'),
  'e2e-smoke': join(ROOT, 'tests', 'suites', 'e2e-smoke-adapter.mjs'),
  'training-identity': join(ROOT, 'tests', 'training-identity.mjs'),
  'training-access': join(ROOT, 'tests', 'training-access.mjs'),
  'training-student-admin-boundary': join(ROOT, 'tests', 'training-student-admin-boundary.mjs'),
  'training-media': join(ROOT, 'tests', 'training-media.mjs'),
  'training-system': join(ROOT, 'tests', 'training-system.mjs'),
  'training-courses': join(ROOT, 'tests', 'training-courses.mjs'),
  'training-video-learning': join(ROOT, 'tests', 'training-video-learning.mjs'),
  'training-question-bank': join(ROOT, 'tests', 'training-question-bank.mjs'),
  'training-question-import': join(ROOT, 'tests', 'training-question-import.mjs'),
  'training-publishing': join(ROOT, 'tests', 'training-publishing.mjs'),
  'training-attempts': join(ROOT, 'tests', 'training-attempts.mjs'),
  'training-submissions': join(ROOT, 'tests', 'training-submissions.mjs'),
  'training-records': join(ROOT, 'tests', 'training-records.mjs'),
  'training-statistics': join(ROOT, 'tests', 'training-statistics.mjs'),
  'training-full-flow': join(ROOT, 'tests', 'training-full-flow.mjs'),
});

export function resolveSuitePaths(selector, registry = SUITE_REGISTRY) {
  if (selector === 'all') return [...new Set(Object.values(registry))];
  if (!Object.hasOwn(registry, selector)) throw new Error(`未知测试套件：${selector}`);
  return [registry[selector]];
}

export function suiteRuntimeEnvOverrides(suitePath) {
  return suitePath === SUITE_REGISTRY['training-video-learning']
    ? { DB_POOL_SIZE: '2' }
    : {};
}

export async function runSelectedSuites(suitePaths, { isInterrupted = () => false, runSuite } = {}) {
  if (typeof runSuite !== 'function') throw new TypeError('runSelectedSuites requires runSuite');
  for (const suitePath of suitePaths) {
    if (isInterrupted()) return;
    await runSuite(suitePath);
    if (isInterrupted()) return;
  }
}

export function parseArgs(argv) {
  let suite = 'smoke';
  let ephemeral = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ephemeral') {
      ephemeral = true;
    } else if (arg === '--suite') {
      suite = argv[++i] || '';
    } else if (arg.startsWith('--suite=')) {
      suite = arg.slice('--suite='.length);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  resolveSuitePaths(suite);
  if (suite === 'all' && !ephemeral) {
    throw new Error('--suite all 必须与 --ephemeral 一起使用');
  }
  return { suite, ephemeral };
}

function quoteDatabase(database) {
  if (!isSafeTestDatabase(database)) throw new Error('测试启动器只接受 ruleexam_test_<suffix> 目标库');
  return `\`${database}\``;
}

async function resetSchema({ host, port, user, password, database }) {
  const sql = await readFile(join(ROOT, 'database', 'init.sql'), 'utf8');
  const target = validateTestTarget({ database, sql });
  const connection = await mysql.createConnection({ host, port, user, password, multipleStatements: true });
  try {
    // database has been validated as an isolated test identifier before it is
    // interpolated; no development database can reach this branch.
    await connection.query(`DROP DATABASE IF EXISTS ${quoteDatabase(database)}`);
    await connection.query(target.sql);
  } finally {
    await connection.end();
  }
}

export async function runSuiteInRuntime(suitePath, ephemeral, runState = { interrupted: false }, { suiteModule = undefined } = {}) {
  let services;
  let harness;
  let interrupted = false;
  let cleanupPromise;
  let releaseLifecycleProbe;
  let resourceGeneration = 0;
  const ownedChildren = new Set();
  const ownedApiPids = [];
  const trackChild = (child) => {
    ownedChildren.add(child);
    child.once('exit', () => ownedChildren.delete(child));
    if (interrupted) void cleanup().catch(() => undefined);
    return child;
  };
  const reportOwnedRuntime = (extra = {}) => {
    if (typeof process.send !== 'function') return;
    try {
      process.send({
        type: 'owned-runtime',
        apiPid: harness?.apiPid ?? null,
        mysqlPid: services?.mysqlPid ?? null,
        redisPid: services?.redisPid ?? null,
        harnessRoot: harness?.root ?? null,
        servicesRoot: services?.root ?? null,
        ...extra,
      });
    } catch {
      // The probe IPC channel can close while cleanup is already in progress.
    }
  };
  const waitForLifecycleProbe = async (stage, metadata = {}) => {
    if (process.env.A1_LIFECYCLE_PROBE !== stage || typeof process.send !== 'function') return;
    reportOwnedRuntime({ ...metadata, stage });
    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        process.removeListener('message', onMessage);
        if (releaseLifecycleProbe === finish) releaseLifecycleProbe = undefined;
        resolve();
      };
      const onMessage = (message) => {
        if (message?.type === 'release-lifecycle' && message.stage === stage) finish();
      };
      releaseLifecycleProbe = finish;
      process.on('message', onMessage);
      if (interrupted) finish();
    });
  };
  const cleanup = async () => {
    if (cleanupPromise) return cleanupPromise;
    if (!harness && !services && ownedChildren.size === 0) return;
    const task = (async () => {
      const attempted = new Set();
      const errors = [];
      const pendingResources = (seen) => [harness, services]
        .filter((resource) => resource && !seen.has(resource));
      while (true) {
        const children = [...ownedChildren].filter((child) => !attempted.has(child));
        const resources = pendingResources(attempted);
        const generation = resourceGeneration;
        if (!children.length && !resources.length) {
          await Promise.resolve();
          if (generation === resourceGeneration && !pendingResources(attempted).length) break;
          continue;
        }
        for (const child of children) {
          attempted.add(child);
          try {
            await stopApi(child);
          } catch (error) {
            errors.push(error);
          }
        }
        for (const resource of resources) {
          attempted.add(resource);
          try {
            await resource.stopProcesses();
          } catch (error) {
            errors.push(error);
          }
        }
      }
      if (errors.length) throw new AggregateError(errors, 'owned runtime cleanup failed');
      const cleanedResources = new Set();
      while (true) {
        const resources = pendingResources(cleanedResources);
        const generation = resourceGeneration;
        if (!resources.length) {
          await Promise.resolve();
          if (generation === resourceGeneration && !pendingResources(cleanedResources).length) break;
          continue;
        }
        for (const resource of resources) {
          cleanedResources.add(resource);
          await resource.cleanup();
        }
      }
    })();
    cleanupPromise = task;
    try {
      return await task;
    } finally {
      if (cleanupPromise === task) cleanupPromise = undefined;
    }
  };
  const signalHandlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      interrupted = true;
      runState.interrupted = true;
      process.exitCode = signal === 'SIGINT' ? 130 : 143;
      releaseLifecycleProbe?.();
      reportOwnedRuntime({ stage: 'signal-received', signal });
      void cleanup().catch(() => undefined);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  try {
    let database = process.env.DB_DATABASE || '';
    let db = {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD,
    };
    let redis = {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD,
    };
    if (ephemeral) {
      services = await createEphemeralServices();
      resourceGeneration += 1;
      console.log(`[owned-ephemeral] servicesRoot=${services.root} mysqlPid=${services.mysqlPid} redisPid=${services.redisPid}`);
      await waitForLifecycleProbe('services-ready');
      if (interrupted) return;
      database = `ruleexam_test_${randomBytes(6).toString('hex')}`;
      db = { host: services.mysql.host, port: services.mysql.port, user: services.mysql.user, password: services.mysql.password };
      redis = { host: services.redis.host, port: services.redis.port, password: undefined };
    } else if (!db.password) {
      // Validate the target before opening a socket. This branch intentionally
      // rejects the default development database even when no password exists.
      quoteDatabase(database);
      throw new Error('缺少 DB_PASSWORD 环境变量（运行期注入，不落盘）；开发库不会被测试启动器访问');
    }
    quoteDatabase(database);
    const apiPort = ephemeral ? await getFreePort() : Number(process.env.API_PORT || process.env.PORT || 3000);
    const createdHarness = await createTrainingHarness({
      port: apiPort,
      redisPrefix: `e2e:${randomBytes(10).toString('hex')}:`,
      database,
      db,
      redis,
      env: {
        DB_HOST: db.host,
        DB_PORT: String(db.port),
        DB_USERNAME: db.user,
        DB_PASSWORD: db.password,
        DB_DATABASE: database,
        REDIS_HOST: redis.host,
        REDIS_PORT: String(redis.port),
        REDIS_PASSWORD: redis.password || '',
        API_PORT: String(apiPort),
        ...(ephemeral ? { MOCK_AI_PORT: '0', MOCK_AI_PORT_MODE: 'ephemeral' } : {}),
        ...suiteRuntimeEnvOverrides(suitePath),
      },
    });
    await waitForLifecycleProbe('harness-created', { harnessRoot: createdHarness.root });
    harness = createdHarness;
    resourceGeneration += 1;
    if (ephemeral) console.log(`[owned-ephemeral] harnessRoot=${harness.root} database=${database}`);
    if (interrupted) return;
    console.log(`[1/4] 创建隔离测试库（${database}）`);
    await resetSchema({ ...db, database });
    if (interrupted) return;

    console.log('[2/4] 启动 API（运行期随机密钥与独立存储目录）');
    const firstApi = await harness.restartApi();
    ownedApiPids.push(firstApi.pid);
    if (ephemeral) console.log(`[owned-ephemeral] apiPid=${firstApi.pid} restart=1`);
    if (interrupted) return;
    console.log('[2/4] 重启 API 并复用同一数据库、密钥、上传与日志目录');
    const secondApi = await harness.restartApi();
    ownedApiPids.push(secondApi.pid);
    if (ephemeral) console.log(`[owned-ephemeral] apiPid=${secondApi.pid} restart=2`);
    if (interrupted) return;

    console.log(`[3/4] 执行测试套件（${suitePath}）`);
    const selectedSuite = suiteModule || await import(pathToFileURL(suitePath).href);
    if (interrupted) return;
    if (typeof selectedSuite.run !== 'function') throw new Error(`测试套件缺少 run(ctx)：${suitePath}`);
    try {
      await selectedSuite.run({
        baseUrl: harness.baseUrl,
        env: harness.env,
        adminPassword: harness.adminPassword,
        request: harness.request,
        upload: harness.upload,
        restartApi: harness.restartApi,
        queryTestDb: harness.queryTestDb,
        trackChild,
        reportOwnedRuntime,
      });
    } catch (error) {
      if (!interrupted) throw error;
    }
    console.log('[4/4] 测试完成');
  } finally {
    const owned = ephemeral && services ? {
      servicesRoot: services.root,
      harnessRoot: harness?.root || null,
      mysqlPid: services.mysqlPid,
      redisPid: services.redisPid,
      apiPids: [...ownedApiPids],
    } : null;
    await cleanup();
    if (owned) {
      const livePids = [owned.mysqlPid, owned.redisPid, ...owned.apiPids].filter((pid) => {
        if (!Number.isInteger(pid) || pid <= 0) return false;
        try { process.kill(pid, 0); return true; }
        catch (error) { if (error?.code === 'ESRCH') return false; throw error; }
      });
      if (livePids.length || existsSync(owned.servicesRoot) || (owned.harnessRoot && existsSync(owned.harnessRoot))) {
        throw new Error(`owned ephemeral cleanup incomplete: livePids=${livePids.join(',')}`);
      }
      console.log(`[owned-ephemeral] stopped pids=${[owned.mysqlPid, owned.redisPid, ...owned.apiPids].join(',')}; removed exact roots=${owned.servicesRoot},${owned.harnessRoot}`);
    }
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  }
}

export async function run() {
  const { suite, ephemeral } = parseArgs(process.argv.slice(2));
  const runState = { interrupted: false };
  await runSelectedSuites(resolveSuitePaths(suite), {
    isInterrupted: () => runState.interrupted,
    runSuite: (suitePath) => runSuiteInRuntime(suitePath, ephemeral, runState),
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().catch((error) => {
    console.error(error.message || error);
    if (process.exitCode !== 130 && process.exitCode !== 143) process.exitCode = 1;
  });
}
