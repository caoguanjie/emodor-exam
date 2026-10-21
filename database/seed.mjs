// EmodorRuleExam 种子数据脚本：根部门（id=1）+ 超级管理员（id=1，username=admin）
// 依据 docs/design/03-数据库设计.md 第 7 章「初始化数据」口径。
// 安全约束：初始口令一律经环境变量 ADMIN_INITIAL_PASSWORD 注入（运行期生成 bcrypt 哈希），
// 本脚本与库中均不落明文口令；首次登录由应用侧 last_login_at IS NULL 强制改密。
//
// 用法：node database/seed.mjs   （需先以 init.sql 建库）
// 环境变量：DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD / DB_DATABASE /
//           ADMIN_INITIAL_PASSWORD（必填，≥8 位且同时包含字母与数字，与业务层三层统一口径一致）
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const {
  DB_HOST = '127.0.0.1',
  DB_PORT = '3306',
  DB_USERNAME = 'root',
  DB_PASSWORD = '',
  DB_DATABASE = 'ruleexam',
  ADMIN_INITIAL_PASSWORD,
} = process.env;

if (!ADMIN_INITIAL_PASSWORD || !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(ADMIN_INITIAL_PASSWORD)) {
  console.error('缺少环境变量 ADMIN_INITIAL_PASSWORD（≥8 位且同时包含字母与数字，仅运行期注入，不落源码/日志）');
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USERNAME,
  password: DB_PASSWORD,
  database: DB_DATABASE,
  charset: 'utf8mb4_0900_ai_ci',
});

const hash = await bcrypt.hash(ADMIN_INITIAL_PASSWORD, 12);

await conn.execute(
  `INSERT INTO sys_department (id, parent_id, name, sort, status)
   VALUES (1, NULL, '集团总部', 1, 1)
   ON DUPLICATE KEY UPDATE id = id`,
);
await conn.execute(
  `INSERT INTO sys_user (id, username, password_hash, real_name, employee_no, department_id, role, status, last_login_at)
   VALUES (1, 'admin', ?, '超级管理员', NULL, NULL, 'super_admin', 1, NULL)
   ON DUPLICATE KEY UPDATE id = id`,
  [hash],
);

const [[dept]] = await conn.execute(`SELECT COUNT(*) AS c FROM sys_department`);
const [[user]] = await conn.execute(`SELECT COUNT(*) AS c FROM sys_user`);
console.log(`种子数据就绪：部门 ${dept.c} 条，用户 ${user.c} 条（admin / 超级管理员，首登强制改密）`);
await conn.end();
