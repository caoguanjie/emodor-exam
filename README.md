# RuleExam · 制度学习及考试系统

依据 [docs/design](docs/design/) 全套设计方案（8 册）实现的完整系统，覆盖「制度上传 → 在线学习 → AI 出题 → 考试评分 → 统计跟进」闭环。

## 技术栈（与 README 3.1 定稿逐项一致）

| 分层 | 选型 | 落点 |
|---|---|---|
| 前端 | Vue 3 + TypeScript + Vite（Pinia / Vue Router）+ Element Plus | `web/` |
| 后端 | Node.js + NestJS（TypeScript）+ TypeORM | `server/` |
| 数据库 | MySQL 8.0（12 张表，utf8mb4 / DATETIME(3)，无外键、应用层维护） | `database/init.sql` |
| 缓存 | Redis（考试计时 / 学习会话累计 / 防重复提交 / AI 配置读缓存；不可用时进程内兜底降级） | `server/src/common/redis.service.ts` |
| AI 接入 | OpenAI 兼容协议（base_url / api_key / model 可配置，AES-256-GCM 加密落盘、掩码回显） | `server/src/modules/ai/` |
| 文件解析 | unpdf（PDF→text，内置现代 pdf.js，要求 Node ≥22）+ mammoth（DOCX→HTML+text，双产物一次成型） | `server/src/modules/regulations/parse-pipeline.service.ts` |
| 在线阅读 | pdfjs-dist（canvas 渲染，滚动可观测） | `web/src/views/employee/Reading.vue` |
| 认证权限 | JWT 双令牌（access 2h / refresh 7d 轮换）+ RBAC 三角色守卫链 + Redis 黑名单吊销 | `server/src/modules/auth/`、`server/src/common/guards/` |
| 部署 | Docker Compose（nginx + api + mysql + redis，仅 nginx 对外） | `docker-compose.yml`、`deploy/` |

## 目录结构

```
├── docs/design/            # 设计方案（8 册，实现基准）
├── database/
│   ├── init.sql            # 12 张表 DDL（03 册逐字建表）+ 建库
│   └── seed.mjs            # 种子数据：根部门 + 超级管理员（口令经环境变量注入）
├── server/                 # NestJS API（六大业务模块 + 横切能力）
│   ├── src/common/         #   统一信封 {code,message,data} / 错误码表 / 守卫链 / Redis / 审计日志
│   ├── src/entities/       #   12 张表 TypeORM 实体
│   ├── src/modules/        #   auth·users·departments | regulations | ai | learning | exams | statistics | health
│   ├── src/tasks.service.ts#   定时任务：超时自动交卷(30s) / 会话兜底收口(60s) / 解析兜底扫描(60s)
│   ├── test/               #   核心算法单元测试（vitest）
│   └── Dockerfile
├── web/                    # Vue 3 SPA（员工学习端 + 管理端）
│   ├── src/views/employee/ #   我的制度 / 在线阅读(心跳·失焦·位图) / 考试 / 成绩
│   ├── src/views/admin/    #   部门 / 员工(Excel导入) / 制度 / 题库与出题 / 试卷 / 统计 / AI配置
│   └── Dockerfile
├── deploy/
│   ├── nginx/default.conf  # 静态托管 + /api/v1 反代 + 50MB 上传限制 + 安全头 + CSP
│   └── .env.example        # 环境变量清单（敏感值运行期生成，不落仓库）
├── tests/
│   ├── e2e-smoke.mjs       # 端到端冒烟测试（86 项断言，内置 Mock AI 服务）
│   └── run-e2e.mjs         # 冒烟启动器（密钥全部运行期随机生成）
└── docker-compose.yml
```

## 快速开始

### 方式一：Docker Compose（一键部署，NFR-16）

```bash
cp deploy/.env.example .env
# 在 .env 中生成全部密钥（文件内有生成命令注释），然后：
docker compose up -d --build
# 数据库表结构由 mysql 容器初始化脚本自动装载（database/init.sql）
# 超级管理员首登口令：部署时执行一次
DB_PASSWORD=<.env 中的口令> ADMIN_INITIAL_PASSWORD=<自定义初始口令> \
  docker compose exec api node dist/seed.js   # 或在宿主机：node database/seed.mjs
```

### 方式二：本地开发

```bash
# 1. 准备 MySQL 8.0 + Redis，装载表结构与种子数据（口令经环境变量注入，不落盘）
mysql -h127.0.0.1 -uroot -p < database/init.sql
DB_PASSWORD=... ADMIN_INITIAL_PASSWORD=... node database/seed.mjs

# 2. 启动 API（环境变量见 deploy/.env.example）
cd server && npm install && npm run build && node dist/main.js   # :3000

# 3. 启动前端（Vite dev server，/api/v1 已代理至 :3000）
cd web && npm install && npm run dev   # :5173

# 4. 用 admin / <ADMIN_INITIAL_PASSWORD> 登录 → 首次登录强制改密 → 创建部门 / 员工
```

扫描版 PDF 的 AI 出题：后端会在文本层不足时自动将页面渲染为图片，
通过 OpenAI 兼容的 `image_url` 内容块交给支持视觉输入的模型。macOS 可先安装 Poppler：

```bash
brew install poppler
```

默认自动启用；如需关闭可设置 `AI_MULTIMODAL_ENABLED=false`。可选参数：
`AI_MULTIMODAL_TRIGGER_CHARS`（文本触发阈值，默认 1000）、
`AI_MULTIMODAL_PAGES_PER_REQUEST`（每次发送页数，默认 4）、
`AI_MULTIMODAL_DPI`（渲染清晰度，默认 144）、`AI_MULTIMODAL_MAX_IMAGE_BYTES`
（单页图片上限，默认 6MB）和 `AI_MULTIMODAL_MAX_PAGES`（单个 PDF 上限，默认 200）。

### 测试

```bash
cd server && npm test                 # 核心算法单元测试（评分 / 乱序 / 心跳容差 / 位图）
DB_PASSWORD=... node tests/run-e2e.mjs  # 端到端冒烟（自动重建测试库、随机密钥、Mock AI 服务）
```

## 安全约束（实现遵循）

- 学习时长以服务端时钟差结算：30 秒心跳、单次最大计入 45 秒、失焦 pause/resume 锚点、10 段覆盖位图（仅计停留 ≥10 秒的段）、单活跃会话约束——全部服务端生效。
- 考试：确定性 seed（HMAC-SHA256）乱序、下发不含答案与解析、deadline_at 快照计时、切屏计数（1 秒去抖）、三层幂等交卷、超时自动交卷双触发、漏选部分分可配。
- 成绩不可人工修改；多次作答取最高分为统计口径。
- 口令 bcrypt(cost=12)；首次登录（last_login_at IS NULL）强制改密；改密 / 重置 / 停用即吊销存量令牌（Redis 封禁键）。
- 所有敏感值（DB 口令 / JWT_SECRET / EXAM_SHUFFLE_SECRET / APP_ENCRYPTION_KEY / 管理员初始口令）一律环境变量运行期注入，仓库与测试代码不含任何可用凭据字面量。
- 审计日志（发布 / 审核 / 导入 / 导出 / 开考 / 交卷等敏感操作）为结构化 JSON 文件，独立通道保留 180 天。

## 设计文档 → 实现对照（摘要）

| 设计分册 | 关键落点 |
|---|---|
| 03-数据库设计 | `database/init.sql`（12 张表、索引逐字一致）、`server/src/entities/` |
| 04-API设计 | 各模块 Controller；`{code,message,data}` 信封、40xxx/50xxx 错误码表（`server/src/common/errors.ts`） |
| 05-模块设计 | 六大模块 Service（解析流水线、出题任务、心跳结算、评分引擎、统计口径等） |
| 06-关键流程 | 定时任务双触发、聚合落库事务、交卷评分决策（`server/src/modules/`） |
| 07-安全与非功能 | 守卫链、封禁键、上传校验链（扩展名+魔数+大小）、content_html 白名单净化、审计日志、Redis AOF |
