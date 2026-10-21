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
  `INSERT INTO sys_user (id, username, password_hash, real_name, employee_no, department_id, role, status, auth_version, force_password_change, login_count, last_login_at, last_login_ip, roles_configured)
   VALUES (1, 'admin', ?, '超级管理员', NULL, NULL, 'super_admin', 1, 0, 1, 0, NULL, NULL, 0)
   ON DUPLICATE KEY UPDATE id = id`,
  [hash],
);

const permissions = [
  ['training_categories:read', '查看培训类别'], ['training_categories:write', '维护培训类别'],
  ['students:read', '查看学员'], ['students:write', '维护学员'],
  ['departments:read', '查看部门'], ['departments:write', '维护部门'],
  ['regulations:read', '查看制度'], ['regulations:write', '维护制度'], ['regulations:publish', '发布制度'],
  ['ai:read', '查看 AI 任务'], ['ai:write', '发起 AI 出题任务'], ['ai_config:read', '查看 AI 服务配置'], ['ai_config:write', '维护 AI 服务配置'], ['ai:publish', '发布 AI 题目'], ['ai:review', '审核 AI 题目'],
  ['questions:read', '查看题库'], ['questions:write', '维护题库'], ['questions:publish', '发布题库'], ['questions:review', '审核题目'], ['questions:export', '导出题库'],
  ['papers:read', '查看试卷'], ['papers:write', '维护试卷'], ['papers:publish', '发布试卷'], ['papers:review', '审核试卷'], ['papers:export', '导出试卷'],
  ['statistics:read', '查看统计'], ['statistics:export', '导出统计'],
  ['roles:read', '查看角色'], ['roles:write', '维护角色'], ['administrators:read', '查看管理员'], ['administrators:write', '维护管理员角色'],
  ['sessions:read', '查看在线会话'], ['sessions:write', '强制下线会话'], ['media:read', '读取媒体'], ['media:write', '上传媒体'],
  ['courses:read', '查看课程'], ['courses:write', '维护课程'], ['courses:publish', '发布课程'],
  ['system_settings:read', '查看系统配置'], ['system_settings:write', '维护系统配置'],
];
for (const [code, name] of permissions) {
  await conn.execute(
    `INSERT INTO sys_permission (code, name) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [code, name],
  );
}
const legacyRegulation = [
  'departments:read', 'regulations:read', 'regulations:write', 'regulations:publish',
  'ai:read', 'ai:write', 'ai:review', 'questions:read', 'questions:write', 'questions:review',
  'papers:read', 'papers:write', 'papers:publish', 'statistics:read', 'statistics:export',
];
const allPermissionCodes = permissions.map(([code]) => code);
const roleDefinitions = [
  ['super_admin', '超级管理员', 1, allPermissionCodes],
  ['regulation_admin', '制度管理员', 1, legacyRegulation],
  ['employee', '员工', 1, []],
];
for (const [code, name, isSystem, rolePermissions] of roleDefinitions) {
  await conn.execute(
    `INSERT INTO sys_role (code, name, is_system, status) VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), is_system = VALUES(is_system), status = 1`,
    [code, name, isSystem],
  );
  const [[role]] = await conn.execute(`SELECT id FROM sys_role WHERE code = ?`, [code]);
  for (const permissionCode of rolePermissions) {
    const [[permission]] = await conn.execute(`SELECT id FROM sys_permission WHERE code = ?`, [permissionCode]);
    await conn.execute(
      `INSERT IGNORE INTO sys_role_permission (role_id, permission_id) VALUES (?, ?)`,
      [role.id, permission.id],
    );
  }
}

const [[dept]] = await conn.execute(`SELECT COUNT(*) AS c FROM sys_department`);
const [[user]] = await conn.execute(`SELECT COUNT(*) AS c FROM sys_user`);
console.log(`种子数据就绪：部门 ${dept.c} 条，用户 ${user.c} 条（admin / 超级管理员，首登强制改密）`);
await conn.end();
