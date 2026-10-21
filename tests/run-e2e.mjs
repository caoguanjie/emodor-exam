// EmodorRuleExam 端到端测试启动器。
// 默认只接受 ruleexam_test_* 目标库；--ephemeral 会创建本次运行专属的
// 本地 MySQL/Redis，避免任何开发服务连接。口令/密钥只存在运行期环境。
//
// 用法：
//   DB_DATABASE=ruleexam_test_training DB_PASSWORD=... node tests/run-e2e.mjs --suite smoke
//   node tests/run-e2e.mjs --ephemeral --suite smoke
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { validateTestTarget, isSafeTestDatabase } from './support/test-target.mjs';
import { createTrainingHarness } from './support/training-harness.mjs';
import { createEphemeralServices, getFreePort } from './support/ephemeral-services.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');

// Registered files are explicit. User input selects a key; it never becomes a
// path or shell fragment.
export const SUITE_REGISTRY = Object.freeze({
  smoke: join(ROOT, 'tests', 'suites', 'e2e-smoke-adapter.mjs'),
  'e2e-smoke': join(ROOT, 'tests', 'suites', 'e2e-smoke-adapter.mjs'),
  all: join(ROOT, 'tests', 'suites', 'e2e-smoke-adapter.mjs'),
});

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
  if (!Object.hasOwn(SUITE_REGISTRY, suite)) throw new Error(`未知测试套件：${suite}`);
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

export async function run() {
  const { suite, ephemeral } = parseArgs(process.argv.slice(2));
  let services;
  let harness;
  let interrupted = false;
  let cleanupPromise;
  const cleanup = async () => {
    if (!harness && !services) return;
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        await harness?.cleanup();
        await services?.cleanup();
      })();
    }
    await cleanupPromise;
  };
  const signalHandlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      interrupted = true;
      process.exitCode = signal === 'SIGINT' ? 130 : 143;
      void cleanup();
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
      if (interrupted) {
        await services.cleanup();
        return;
      }
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
    harness = await createTrainingHarness({
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
      },
    });
    if (interrupted) {
      await harness.cleanup();
      return;
    }
    console.log(`[1/4] 创建隔离测试库（${database}）`);
    await resetSchema({ ...db, database });
    if (interrupted) return;

    console.log('[2/4] 启动 API（运行期随机密钥与独立存储目录）');
    await harness.restartApi();
    if (interrupted) return;
    console.log('[2/4] 重启 API 并复用同一数据库、密钥、上传与日志目录');
    await harness.restartApi();
    if (interrupted) return;

    console.log(`[3/4] 执行测试套件（${suite}）`);
    const suiteModule = await import(pathToFileURL(SUITE_REGISTRY[suite]).href);
    if (typeof suiteModule.run !== 'function') throw new Error(`测试套件缺少 run(ctx)：${suite}`);
    await suiteModule.run({
      baseUrl: harness.baseUrl,
      env: harness.env,
      adminPassword: harness.adminPassword,
      request: harness.request,
      upload: harness.upload,
      restartApi: harness.restartApi,
      queryTestDb: harness.queryTestDb,
    });
    console.log('[4/4] 测试完成');
  } finally {
    await cleanup();
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
