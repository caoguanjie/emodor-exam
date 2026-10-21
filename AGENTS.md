# AGENTS.md — EmodorRuleExam 工作区指引

制度学习及考试系统：制度上传 → 在线学习 → AI 出题 → 考试评分 → 统计跟进。
**`docs/design/`（8 册）是实现基准**：改数据库/API/流程前先读对应分册，改动后保持文档、`database/init.sql`、`server/src/entities/` 三方一致。

## 目录

- `docs/design/` 设计方案 8 册（01 需求 … 07 安全与非功能、README 对照表）
- `database/` `init.sql`（12 张表 DDL，与 03 册逐字一致）+ `seed.mjs`（口令经环境变量注入）
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
- 数据库**无外键**，引用完整性由应用层维护；新增/修改表必须同步 `database/init.sql` 与 entities。
- 学习时长全部服务端结算（30s 心跳、单次 ≤45s、失焦锚点、10 段位图、单活跃会话）；不要在前端"补"时长逻辑。
- 考试下发 payload 不含答案与解析；乱序 seed 由 `EXAM_SHUFFLE_SECRET` HMAC 派生；成绩不可人工修改。
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
