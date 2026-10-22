# EmodorRuleExam · 安全培训考试系统

当前仓库面向单家培训机构，主链路为「出题资料上传解析 → AI 出题 → 题目审核 → 三类客观题题库 → 组卷发布 → 自动评分 → 考试记录 → 培训统计」。[docs/design](docs/design/) 是设计基准，本轮已批准的精确瘦身边界见[实施计划](docs/superpowers/plans/2026-10-22-training-demo-slimming.md)。独立制度管理、员工管理、部门管理、图片作答题、人工阅卷与实时监控/切屏采集已经取消；旧制度阅读、旧固定卷执行和历史记录所需后端兼容仍保留，但没有对应管理端 CRUD 入口。源码、自动回归与 PC 操作证据不等于生产升级、独立 H5、真实手机或真实商业 AI 已验收。

## 技术栈（与 README 3.1 定稿逐项一致）

| 分层 | 选型 | 落点 |
|---|---|---|
| 前端 | Vue 3 + TypeScript + Vite（Pinia / Vue Router）+ Element Plus | `web/` |
| 后端 | Node.js + NestJS（TypeScript）+ TypeORM | `server/` |
| 数据库 | MySQL 8.0（当前源码定义 36 张业务表 + 1 张 `schema_migration` 元数据表，utf8mb4 / DATETIME(3)，无外键、应用层维护） | `database/init.sql`、`database/migrations/`、`database/migrate.mjs` |
| 缓存 | Redis（legacy 考试计时与防重复提交、学习会话累计、AI 配置读缓存；training 草稿与交卷正确性由 MySQL 事务保证） | `server/src/common/redis.service.ts` |
| AI 接入 | OpenAI 兼容协议（base_url / api_key / model 可配置，AES-256-GCM 加密落盘、掩码回显） | `server/src/modules/ai/` |
| 文件解析 | unpdf（PDF→text，内置现代 pdf.js，要求 Node ≥22）+ mammoth（DOCX→HTML+text，双产物一次成型） | `server/src/modules/question-materials/`、共享解析流水线 |
| 在线阅读 | pdfjs-dist（canvas 渲染，滚动可观测） | `web/src/views/employee/Reading.vue` |
| 认证权限 | JWT 双令牌（access 2h / refresh 7d 轮换）+ 三类系统身份兼容 + 可配置业务角色/权限 + Redis 会话吊销 | `server/src/modules/auth/`、`server/src/modules/access/`、`server/src/common/guards/` |
| 部署 | Docker Compose（nginx + api + mysql + redis，仅 nginx 对外） | `docker-compose.yml`、`deploy/` |

## 目录结构

```
├── docs/design/            # 设计方案（8 册，实现基准）
├── database/
│   ├── init.sql            # 当前 36 张业务表 + schema_migration 的全新初始化 DDL
│   ├── migrations/         # 000—015 可复核增量升级脚本（保留当前工程已有记录）
│   ├── migrate.mjs         # 校验 checksum、记录进度并支持失败续跑的迁移入口
│   └── seed.mjs            # 种子数据：根部门 + 超级管理员（口令经环境变量注入）
├── server/                 # NestJS API（六大业务模块 + 横切能力）
│   ├── src/common/         #   统一信封 {code,message,data} / 错误码表 / 守卫链 / Redis / 审计日志
│   ├── src/entities/       #   当前业务表 TypeORM 实体；新增表与迁移/设计同步
│   ├── src/modules/        #   账号权限/系统配置、出题资料/AI/题库、课程/视频、客观题考试、记录、统计、health
│   ├── src/tasks.service.ts#   定时任务：超时自动交卷(30s) / 会话兜底收口(60s) / 解析兜底扫描(60s)
│   ├── test/               #   核心算法单元测试（vitest）
│   └── Dockerfile
├── web/                    # Vue 3 SPA（员工学习端 + 管理端）
│   ├── src/views/employee/ #   保留的旧制度阅读 / 考试 / 成绩页面（培训课程仅有后端能力）
│   ├── src/views/admin/    #   业务首页 / 培训 / 题库与资料出题 / 试卷与记录 / 统计 / 系统设置
│   └── Dockerfile
├── deploy/
│   ├── nginx/default.conf  # 静态托管 + /api/v1 反代 + 513MiB 传输上限 + 安全头 + CSP
│   └── .env.example        # 环境变量清单（敏感值运行期生成，不落仓库）
├── tests/
│   ├── e2e-smoke.mjs       # legacy 保留链路冒烟（当前 85 项显式断言，内置 Mock AI）
│   ├── suites/              # legacy 回归适配器；增量套件由 run-e2e.mjs 统一注册
│   └── run-e2e.mjs         # ephemeral 套件启动器（实例隔离、密钥运行期随机）
└── docker-compose.yml
```

## 当前 Demo 边界与状态

本期只交付单家培训机构的 PC 管理端与既有 legacy 学员 Vue 页面，不迁移旧站数据、不新建独立 H5，也不建设租户、班级、支付或证书平台。培训课程/视频协议保留完整后端能力，但旧 Vue 学员端没有课程入口。管理端固定为以下 5 个一级入口、16 个可达页面；“系统设置”默认收起，管理员侧不显示“我的学习”。

```text
业务首页
培训管理：培训类别 / 学员管理 / 课程管理
考试管理：题库管理 / 试卷管理 / 考试记录
统计分析
系统设置：AI 服务配置 / 管理员 / 角色权限 / 网站配置 / 字典配置 / 菜单配置 / 在线会话 / 审计日志
```

出题资料不设独立菜单，统一放在“题库管理 → AI 出题”。资料先创建，再上传 PDF/DOCX 不可变版本并等待 `parsed`；管理员必须显式选择已解析版本，AI 请求传字符串 `material_id + material_version_id`。资料分类保持中立，培训试卷按本类别题目的实际来源关联；历史类别资料继续兼容。内部存储可复用 legacy 来源列，但管理端和新 API 不再暴露制度发布、范围、学习要求或生效版本切换语义。

现行题型严格为 `single`、`multiple`、`judgment`。题干、选项与解析中的受控普通图片继续保留；删除的是“上传图片作为答案”的题型及其人工阅卷链路。三类题均由服务端自动评分；答案与解析不进入开考载荷，草稿保存、服务端 `deadline_at`、超时自动提交和重复提交幂等保持不变。课程/视频学习与 legacy 制度阅读继续分开，新培训考试默认不以学习完成作为开考门槛。

旧制度管理、员工管理、部门管理、人工阅卷和实时监控的页面、管理接口、权限与快捷入口已删除；旧统计页面只隐藏，旧 URL 回业务首页。当前培训统计提供未完成原因人数聚合、排名与导出，不提供未完成人员明细清单。共享账号表、历史组织/制度数据及旧学习/固定卷执行链路只为兼容既有事实保留，不等于恢复被取消的管理功能。

[培训管理端验收清单](docs/testing/training-admin-acceptance.md)集中登记证据边界。当前已执行：服务端 34 个测试文件、362 项通过；前端 114 项行为测试、`vue-tsc` 与生产构建通过；迁移/测试库保护 9 项通过；smoke 85 项通过（由 84 项加 1 项类别 fixture 断言组成，取代旧 94 项口径）；隔离 full-flow 已通过新资料 Mock AI、审核/导入、视频、两难度、重启、自动评分 90/20、记录与统计导出；最终 16 套独立 API 总回归全部通过。PC 已操作真实 DOCX 字节经 DataTransfer 触发资料组件上传、解析、AI 生成 15 题并审核、按资料筛选创建并发布固定卷，以及管理员/学员创建、记录结果、统计、6 个旧 URL 和缓存标签清理。

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

# 4. 用 admin / <ADMIN_INITIAL_PASSWORD> 登录 → 首次登录强制改密 → 创建培训类别、学员与课程
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
node tests/run-e2e.mjs --ephemeral --suite smoke  # 仓库根：自有临时 MySQL/Redis、随机密钥与 Mock AI
node tests/run-e2e.mjs --ephemeral --suite all    # 注册套件逐个隔离执行，遇失败停止
```

临时模式需要本机 MySQL/Redis 可执行文件。连接外部测试服务时仅运行单套件，必须显式注入 `DB_DATABASE=ruleexam_test_<suffix>` 与 `DB_PASSWORD`；启动器不会接受开发库默认值。不得读取凭据文件或把真实口令写入命令示例。

GUI 联调如需预置出题资料，先以测试环境管理员登录取得本次运行的访问令牌，再显式注入目标地址；脚本创建资料并上传/解析 DOCX、PDF，不创建制度管理记录，也不内置任何账号或密钥：

```bash
ADMIN_ACCESS_TOKEN=<本次测试令牌> \
BASE_URL=http://127.0.0.1:3000/api/v1 \
node tests/gui-test-env/seed-material.mjs
```

## 安全约束（实现遵循）

- 学习时长以服务端时钟差结算：30 秒心跳、单次最大计入 45 秒、失焦 pause/resume 锚点、10 段覆盖位图（仅计停留 ≥10 秒的段）、单活跃会话约束——全部服务端生效。
- 考试：确定性 seed（HMAC-SHA256）乱序、下发不含答案与解析、`deadline_at` 快照计时、答案服务端保存、超时自动交卷双触发、漏选部分分可配。training 以数据库行锁和终态保证幂等；legacy 兼容路径保留 Redis 防重锁与状态条件更新。系统不采集或上报切屏事件。
- 单选、多选、判断题均由服务端自动评分，最终总分没有直接修改入口；多次作答取最高分为旧统计/新场次各自明确口径。
- 口令 bcrypt(cost=12)；首次登录（last_login_at IS NULL）强制改密；改密 / 重置 / 停用即吊销存量令牌（Redis 封禁键）。
- 所有敏感值（DB 口令 / JWT_SECRET / EXAM_SHUFFLE_SECRET / APP_ENCRYPTION_KEY / 管理员初始口令）一律环境变量运行期注入，仓库与测试代码不含任何可用凭据字面量。
- 审计日志（发布 / 审核 / 导入 / 导出 / 开考 / 交卷等敏感操作）为结构化 JSON 文件，独立通道保留 180 天。

## 设计文档 → 实现对照（摘要）

| 设计分册 | 关键落点 |
|---|---|
| 03-数据库设计 | 当前 36 张业务表 + 1 张迁移元数据表及索引；定义同步于 `database/init.sql`、迁移脚本、`server/src/entities/` 与本册 |
| 04-API设计 | 各模块 Controller；`{code,message,data}` 信封、40xxx/50xxx 错误码表（`server/src/common/errors.ts`） |
| 05-模块设计 | 六大模块 Service（解析流水线、出题任务、心跳结算、评分引擎、统计口径等） |
| 06-关键流程 | 定时任务双触发、聚合落库事务、交卷评分决策（`server/src/modules/`） |
| 07-安全与非功能 | 守卫链、封禁键、上传校验链（扩展名+魔数+大小）、content_html 白名单净化、审计日志、Redis AOF |
