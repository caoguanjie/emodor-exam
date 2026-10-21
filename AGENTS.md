# AGENTS.md — EmodorRuleExam 工作区指引

制度学习及考试系统：制度上传 → 在线学习 → AI 出题 → 考试评分 → 统计跟进。
**`docs/design/`（8 册）是实现基准**：改数据库/API/流程前先读对应分册，改动后保持文档、`database/init.sql`、`server/src/entities/` 三方一致。

## 目录

- `docs/design/` 设计方案 8 册（01 需求 … 07 安全与非功能、README 对照表）
- `database/` `init.sql`（当前 12 张业务表基线 DDL，与 03 册一致）+ `seed.mjs`（口令经环境变量注入）；培训融合新增表必须通过可复核迁移脚本、`init.sql`、entities 与设计分册同步维护
- `server/` NestJS API：`src/common/`（信封/错误码/守卫链/Redis/审计）、`src/entities/`、`src/modules/`（auth·users·departments|regulations|ai|learning|exams|statistics|health）、`src/tasks.service.ts`（超时交卷/会话收口/解析兜底定时任务）
- `web/` Vue 3 + TS + Vite + Element Plus；`src/views/employee/` 学习端、`src/views/admin/` 管理端
- `deploy/` nginx 配置与 `.env.example`（环境变量权威清单）
- `tests/` `run-e2e.mjs` 启动器 + `e2e-smoke.mjs`（94 项断言，内置 Mock AI）；`tests/gui-test-env/` GUI 回归环境（`mock-ai.mjs` Mock AI 服务、`seed-regulation.mjs` 预置制度）
- `review/` 代码评审报告与修复记录（新增评审/修复记录写入此目录）

## 常用命令

```bash
cd server && npm run build        # tsc 构建到 dist/
cd server && npm test             # vitest 单元测试（评分/乱序/心跳/位图）
cd web && npm run dev             # Vite :5173，/api/v1 代理到 :3000
DB_PASSWORD=... node tests/run-e2e.mjs   # 仓库根执行；自动重建测试库、密钥运行期随机、Mock AI
DB_PASSWORD=... ADMIN_INITIAL_PASSWORD=... node database/seed.mjs   # 种子：根部门 + admin（口令 ≥8 位且含字母+数字）
# ---- GUI/本地联调回归环境（Mock AI :9101）----
node tests/gui-test-env/mock-ai.mjs                                  # 启动 Mock AI
node tests/gui-test-env/seed-regulation.mjs                          # 经 API 预置「安全生产管理制度」及 docx/pdf 版本（ADMIN_PASSWORD=当前 admin 口令）
AI_EGRESS_ALLOW_HOSTS=127.0.0.1 <其余密钥> node server/dist/main.js   # 本地联调 AI 必须放行 127.0.0.1，否则 SSRF 白名单拒绝 Mock AI
```

API 启动后监听 :3000，全局前缀 `api/v1`。本机开发用宿主 MySQL 8.0（127.0.0.1:3306）与 Redis（6379），无 Docker；口令一律环境变量注入，不要把任何真实凭据写进代码或文档。

## 架构红线（改代码前必读）

- 响应统一信封 `{code,message,data}`（`server/src/common/response.interceptor.ts`），错误码表见 `common/errors.ts`（40xxx/50xxx）；DTO 校验一律走 `DtoValidationPipe`。
- 数据库**无外键**，引用完整性由应用层维护；当前 12 张业务表保持不变时，`database/init.sql`、entities 与设计分册须一致；培训融合新增/修改表还必须同步 `database/migrations/`（如已建立）并保留可续跑的迁移记录。迁移注册表的实际字段以 A1 代码实现与根集成后的源码为准，文档不得另造一套字段。
- 学习时长全部服务端结算（30s 心跳、单次 ≤45s、失焦锚点、10 段位图、单活跃会话）；不要在前端"补"时长逻辑。
- 考试下发 payload 不含答案与解析；乱序 seed 由 `EXAM_SHUFFLE_SECRET` HMAC 派生；最终总分不可直接修改。图片题允许在最终结算前受控逐题评分，必须经过审计、乐观版本校验并由服务端汇总；最终结算后只读。
- 旧制度固定卷继续按有效学习双条件取得资格；新培训考试默认不以课程/制度学习完成作为开考门槛，视频课程学习与制度阅读分开，服务端计时、空白答案、反答案泄露与令牌规则不放宽。
- 令牌吊销靠 Redis 封禁键（改密/重置/停用即吊销）；refresh token 走 HttpOnly Cookie。
- AI 模块出网有 SSRF 白名单校验（仅 http/https、拒绝内网/环回），本地 Mock AI 需 `AI_EGRESS_ALLOW_HOSTS=127.0.0.1`。
- 所有敏感值（DB/JWT/加密密钥/管理员初始口令）只经环境变量运行期注入，仓库与测试不得含可用凭据字面量。

## 已知坑

- `web` 的 `npm run build` 只跑 `vite build`，**无类型检查**；需要类型把关时手动执行 `npx vue-tsc --noEmit`。
- `server` 没有 lint 脚本；改动后以 `npm run build` 作为编译校验。
- e2e 会重建测试数据库，勿对准开发库跑。
- `.trae/` 目录已 gitignore，不要把其中文件提交进仓库。
- 服务端要求 **Node ≥22**（`unpdf` 的 engines 声明，Dockerfile 已用 node:22-alpine）；`server/package.json` 已声明 `engines.node`。
- GUI 复测截图不入库（`gui-test-screenshots/` 已 gitignore），复现步骤见上方「常用命令」的 gui-test-env 三条命令。

## 培训融合文档状态（2026-10-21）

- 当前实现基线仍是制度上传/解析、AI 出题审核、制度阅读、旧固定卷考试与原统计链路；[已批准融合设计](docs/superpowers/specs/2026-10-21-training-admin-integration-design.md)及[实施总计划](docs/superpowers/plans/2026-10-21-training-admin-integration.md)是增量目标，不代表目标功能已部署或已验收。
- 本期边界是单家机构、PC 管理端与完整后端；不迁移旧站数据，独立学员 H5 下一期，课程/视频学习不替代制度阅读；不建设租户、班级、支付或证书平台。
- A1—C7 的 owner 与验收门如下，未标“已验收”的能力只能写成计划：

| 任务 | owner 范围 | 文档验收关注 |
|---|---|---|
| A1 | 基准、契约、迁移安全入口 | DDL/init/migration/entity 同步、测试库隔离 |
| A2—A5 | 学员类别来源、权限会话、媒体、公共后台 | 来源与权限分离、受控上传、PC 公共框架 |
| B1—B4 | 课程视频、视频协议、四题型题库、导题 | 视频与制度阅读分离、题目版本/来源/难度 |
| C1—C3 | 发布快照、个人题单、草稿/交卷 | 难度抽题、不可变快照、服务端截止与防泄漏 |
| C4—C5 | 图片阅卷、历史结果、监控 | 逐题受控评分、最终总分只读、5 秒/90 秒监控 |
| C6—C7 | 培训统计、全链回归与交付收口 | 场次/难度/个人最高分口径、旧链路回归 |

- 运行构建、API 测试、PC 操作和真实 H5/视频/外部 AI 验收是不同证据等级；文档一致不等于运行或业务验收通过。
