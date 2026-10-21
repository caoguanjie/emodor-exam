// EmodorRuleExam 端到端冒烟测试启动器：
// 全部敏感值（MySQL 口令 / JWT 密钥 / 管理员初始口令）在运行期生成、经子进程 env 注入，
// 不写入任何文件（安全约束：源码/示例/测试不落可用凭据字面量）。
//
// 用法：DB_PASSWORD=... node tests/run-e2e.mjs
//       （可覆盖：DB_HOST / DB_PORT / DB_USERNAME / DB_DATABASE / API_PORT）
import { spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = process.env.DB_PORT || '3306';
const DB_USERNAME = process.env.DB_USERNAME || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_DATABASE = process.env.DB_DATABASE || 'ruleexam';
const API_PORT = process.env.API_PORT || '3000';

if (!DB_PASSWORD) {
  console.error('缺少 DB_PASSWORD 环境变量（运行期注入，不落盘）');
  process.exit(1);
}

function exists(p) {
  try {
    accessSync(p);
    return true;
  } catch {
    return false;
  }
}

const mysqlBin = ['/usr/local/mysql/bin/mysql', '/opt/homebrew/bin/mysql', '/usr/bin/mysql'].find(exists);
if (!mysqlBin) {
  console.error('未找到 mysql 客户端，请安装后重试');
  process.exit(1);
}

const baseEnv = { ...process.env, DB_HOST, DB_PORT, DB_USERNAME, DB_DATABASE, DB_PASSWORD };

console.log('[1/4] 重建数据库 Schema（' + DB_DATABASE + '，测试库先 DROP 重建）');
const schemaSql = readFileSync(join(ROOT, 'database', 'init.sql'), 'utf8');
const schemaRes = spawnSync(
  mysqlBin,
  ['--no-defaults', '-h' + DB_HOST, '-P' + DB_PORT, '-u' + DB_USERNAME, '-p' + DB_PASSWORD],
  { input: `DROP DATABASE IF EXISTS \`${DB_DATABASE}\`;\n` + schemaSql, env: baseEnv, encoding: 'utf8' },
);
if (schemaRes.status !== 0) {
  console.error('Schema 装载失败：', schemaRes.stderr);
  process.exit(1);
}

console.log('[2/4] 生成运行期管理员初始口令（由 API 启动种子写入）');
// 前缀 A9 保证满足「≥8 位且同时包含字母与数字」的种子校验（base64 随机体理论上可能无数字）
const adminInitial = 'A9' + randomBytes(18).toString('base64');

console.log('[3/4] 启动 API 服务（随机密钥，仅本进程有效）');
const serverEnv = {
  ...baseEnv,
  ADMIN_INITIAL_PASSWORD: adminInitial,
  NODE_ENV: 'development',
  PORT: API_PORT,
  JWT_SECRET: randomBytes(48).toString('base64'),
  JWT_SECRET_PRIOR: randomBytes(48).toString('base64'),
  EXAM_SHUFFLE_SECRET: randomBytes(32).toString('base64'),
  APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  // 本地 Mock AI（127.0.0.1:9101）走 SSRF 白名单例外；生产环境不设置该变量
  AI_EGRESS_ALLOW_HOSTS: '127.0.0.1',
  UPLOAD_DIR: join(ROOT, 'server', 'data', 'uploads'),
  DATA_DIR: join(ROOT, 'server', 'data'),
  LOG_DIR: join(ROOT, 'server', 'data', 'logs'),
};
const api = spawn('node', [join(ROOT, 'server', 'dist', 'main.js')], { env: serverEnv, stdio: ['ignore', 'inherit', 'inherit'] });
const cleanup = () => {
  try {
    api.kill('SIGTERM');
  } catch { /* ignore */ }
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

console.log('[4/4] 等待服务就绪并执行冒烟测试');
let ready = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const res = await fetch(`http://127.0.0.1:${API_PORT}/api/v1/health`);
    if (res.ok) {
      ready = true;
      break;
    }
  } catch { /* not ready */ }
}
if (!ready) {
  console.error('API 服务未在 40 秒内就绪');
  process.exit(1);
}

const smoke = spawnSync('node', [join(ROOT, 'tests', 'e2e-smoke.mjs')], {
  env: {
    ...baseEnv,
    BASE_URL: `http://127.0.0.1:${API_PORT}/api/v1`,
    ADMIN_INITIAL_PASSWORD: adminInitial,
  },
  stdio: 'inherit',
});
cleanup();
process.exit(smoke.status || 0);
