# EmodorRuleExam · 安全培训考试系统

当前仓库面向单家培训机构，主链路为「出题资料上传解析 → AI 出题 → 题目审核 → 三类客观题题库 → 组卷发布 → 自动评分 → 考试记录 → 培训统计」。[docs/design](docs/design/) 是设计基准，本轮培训瘦身边界见[培训计划](docs/superpowers/plans/2026-10-22-training-demo-slimming.md)，学员 H5/微信兼容实现见[学员端计划](docs/superpowers/plans/2026-10-22-learner-mobile-h5.md)。独立制度管理、员工管理、部门管理、图片作答题、人工阅卷与实时监控/切屏采集已经取消；旧制度阅读、旧固定卷执行和历史记录所需后端兼容仍保留，但没有对应管理端 CRUD 入口。源码和自动回归不等于生产升级、真实手机、真实供应商或真实弱网已经验收。

## 技术栈（与 README 3.1 定稿逐项一致）

| 分层 | 选型 | 落点 |
|---|---|---|
| 前端 | Vue 3 + TypeScript + Vite（Pinia / Vue Router）+ Element Plus | `web/` |
| 后端 | Node.js + NestJS（TypeScript）+ TypeORM | `server/` |
| 数据库 | MySQL 8.0（当前源码定义 38 张业务表 + 1 张 `schema_migration` 元数据表，共 39 张物理表，utf8mb4 / DATETIME(3)，无外键、应用层维护） | `database/init.sql`、`database/migrations/`、`database/migrate.mjs` |
| 缓存 | Redis（legacy 考试期限辅助、学习会话累计、AI 配置读缓存；新 training 作答只保存本地草稿，提交/timeout 由 MySQL 事务仲裁） | `server/src/common/redis.service.ts` |
| AI 接入 | OpenAI 兼容协议（base_url / api_key / model 可配置，AES-256-GCM 加密落盘、掩码回显） | `server/src/modules/ai/` |
| 文件解析 | unpdf（PDF→text，内置现代 pdf.js，要求 Node ≥22）+ mammoth（DOCX→HTML+text，双产物一次成型） | `server/src/modules/question-materials/`、共享解析流水线 |
| 在线阅读 | pdfjs-dist（canvas 渲染，滚动可观测） | `web/src/views/employee/Reading.vue` |
| 认证权限 | JWT 双令牌（access 2h / refresh 7d 轮换）+ 三类系统身份兼容 + 可配置业务角色/权限 + Redis 会话吊销 | `server/src/modules/auth/`、`server/src/modules/access/`、`server/src/common/guards/` |
| 部署 | Docker Compose（nginx + api + mysql + redis，仅 nginx 对外） | `docker-compose.yml`、`deploy/` |

## 目录结构

```
├── docs/design/            # 设计方案（8 册，实现基准）
├── database/
│   ├── init.sql            # 当前 38 张业务表 + schema_migration，共 39 张物理表的初始化 DDL
│   ├── migrations/         # 000—021 可复核增量升级脚本（保留当前工程已有记录）
│   ├── migrate.mjs         # 校验 checksum、记录进度并支持失败续跑的迁移入口
│   └── seed.mjs            # 种子数据：根部门 + 超级管理员（口令经环境变量注入）
├── server/                 # NestJS API（六大业务模块 + 横切能力）
│   ├── src/common/         #   统一信封 {code,message,data} / 错误码表 / 守卫链 / Redis / 审计日志
│   ├── src/entities/       #   当前业务表 TypeORM 实体；新增表与迁移/设计同步
│   ├── src/modules/        #   账号权限/系统配置、出题资料/AI/题库、课程/视频、客观题考试、记录、统计、health
│   ├── src/tasks.service.ts#   定时任务：考试纯 timeout 收口(30s) / 会话兜底收口 / 解析兜底扫描
│   ├── test/               #   核心算法单元测试（vitest）
│   └── Dockerfile
├── web/                    # Vue 3 SPA（PC 制度阅读/成绩兼容 + 管理端；无学员答题入口）
│   ├── src/views/employee/ #   保留的旧制度阅读 / 成绩兼容页面
│   ├── src/views/admin/    #   业务首页 / 学习 / 试题与导入 / 试卷与记录 / 统计 / 系统设置
├── mobile/                 # uni-app + Vue 3 + TypeScript + Wot UI，H5 优先、MP-WEIXIN 编译兼容
├── scripts/build.mjs       # PC/H5 单端互保、组合原子发布及独立 MP 构建
├── Dockerfile              # 根 context 组合构建 PC + H5 的 Nginx 镜像
├── deploy/
│   ├── nginx/default.conf  # 静态托管 + /api/v1 反代 + 513MiB 传输上限 + 安全头 + CSP
│   └── .env.example        # 环境变量清单（敏感值运行期生成，不落仓库）
├── tests/
│   ├── e2e-smoke.mjs       # legacy 保留链路冒烟（当前 85 项显式断言，内置 Mock AI）
│   ├── suites/              # legacy 回归适配器；增量套件由 run-e2e.mjs 统一注册
│   └── run-e2e.mjs         # 21 个注册套件的 ephemeral 启动器（实例隔离、密钥运行期随机）
└── docker-compose.yml
```

## 当前 Demo 边界与状态

当前仍是单家培训机构范围，不迁移旧站数据，也不建设租户、班级、支付或证书平台。PC 管理端保持 5 个一级入口；“系统设置”默认收起，管理员侧不显示“我的学习”，PC 学员答题路由和深链接已关闭。独立 `mobile/` 已实现底座、短信会话、课程/资料、三图实名、视频、稳定 ID 考试和组合发布；Task 16 / Gate J 的自动化与桌面 Chrome 验收已完成，全量隔离 E2E 21/21 PASS，详见[学员端验收记录](review/2026-10-22-learner-mobile-h5-acceptance.md)。真实短信、腾讯实名、真机/微信、视频解码/弱网、Docker/Nginx 运行与生产部署仍未验收。

```text
业务首页
学习管理：培训类别 / 学员管理 / 课程管理
考试管理：试题管理 / 试卷管理 / 试题导入 / 考试记录
统计分析
系统设置：AI 服务配置 / 管理员 / 角色权限 / 网站配置 / 字典配置 / 菜单配置 / 在线会话 / 审计日志
```

试题导入页独立提供“文件导入 / AI 生成”两个 Tab。AI 生成上传九列 Excel/TXT 参考题，每题只产生 easy/hard 两个新版本；原文件和参考正文不留存，只有勾选后的生成题会以 pending 状态进入试题库。原资料版本 AI 接口仍保留后端兼容，但试题管理页不再提供资料管理或整批生成入口。

现行题型严格为 `single`、`multiple`、`judgment`。题干、选项与解析中的受控普通图片继续保留；删除的是“上传图片作为答案”的题型及其人工阅卷链路。新培训移动考试下发稳定 item/option ID 与受限 Tiptap JSON，不含答案或解析；答题中只写本人本地最小草稿，学员主动整卷提交后由服务端事务评分。超过 `deadline_at` 只收口为“超时未交卷”，不自动提交、不评分、不生成答案；重复提交按首次终态幂等返回。课程/视频学习与 legacy 制度阅读继续分开，新培训考试默认不以学习完成作为开考门槛。

旧制度管理、员工管理、部门管理、人工阅卷和实时监控的页面、管理接口、权限与快捷入口已删除；旧统计页面只隐藏，旧 URL 回业务首页。当前培训统计提供未完成原因人数聚合、排名与导出，不提供未完成人员明细清单。共享账号表、历史组织/制度数据及旧学习/固定卷执行链路只为兼容既有事实保留，不等于恢复被取消的管理功能。

[培训管理端验收清单](docs/testing/training-admin-acceptance.md)集中登记该阶段的证据边界。学员增量最终自动化已通过：server 47 文件 / 574 项、mobile 34 文件 / 313 项、PC 177 项，以及类型检查、构建和 21 个注册套件的全量隔离 E2E；原迁移与双库升级专项回归 46 项证据保留。隔离 AI 参考题 E2E 已验证 20 道参考题产生 40 道 easy/hard 生成题、生成阶段题目/版本零写入、文件/Redis/审计零留存、owner 隔离、并发幂等确认与 pending 落库，并被最终全量覆盖。PC 既有资料 AI 与发布流程验收证据保留；新双 Tab 页面的组件级与生产构建证据不扩大为真实 PC 操作验收。

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

正式发布构建在仓库根使用统一脚本：

```bash
node scripts/build.mjs web       # 原子更新 PC，保留 dist/mobile/
node scripts/build.mjs h5        # 原子更新 dist/mobile/，保留 PC
node scripts/build.mjs web h5    # 两端都成功后原子发布组合 dist/
node scripts/build.mjs mp-weixin # 独立构建，不修改网站 dist/
```

直接运行 `npm --prefix web run build` 只适合本地检查，不具备统一脚本的构建锁、双端互保与失败回滚。组合产物入口为 `dist/index.html` 和 `dist/mobile/index.html`。

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

学员增量迁移依次为 `018_mobile_auth`（手机号唯一及分端会话）、`019_learner_profile`（可空展示资料）、`020_identity_verification`（`learner_identity` / `identity_verification_session`）、`021_exam_stable_option_ids`（题目 schema v2 与稳定选项答案）。Gate G、视频 Gate H1、考试 Gate H2 与组合构建 Gate I 已通过相应自动化和独立代码审查，最终 Gate J 的自动化与桌面 Chrome 验收也已完成；这些结论不代表已升级开发/生产库，也不代表 Docker/Nginx 运行、真实腾讯/短信、H5 相机、真实视频解码、真实弱网或微信真机通过。

- 学习时长以服务端时钟差结算：30 秒心跳、单次最大计入 45 秒、失焦 pause/resume 锚点、10 段覆盖位图（仅计停留 ≥10 秒的段）、单活跃会话约束——全部服务端生效。
- 考试：确定性 seed（HMAC-SHA256）乱序；新 training 下发稳定 ID 且不含答案/解析，答案本地保存、主动整卷提交，服务端以锁后受理时间和 `deadline_at` 仲裁。到期只写 pure timeout，不自动交卷或评分；历史已评分 timeout 只读兼容。系统不采集或上报切屏事件。
- 单选、多选、判断题均由服务端自动评分，最终总分没有直接修改入口；多次作答取最高分为旧统计/新场次各自明确口径。
- 口令 bcrypt(cost=12)；首次登录（last_login_at IS NULL）强制改密；改密 / 重置 / 停用即吊销存量令牌（Redis 封禁键）。
- 所有敏感值（DB 口令 / JWT_SECRET / EXAM_SHUFFLE_SECRET / APP_ENCRYPTION_KEY / 管理员初始口令）一律环境变量运行期注入，仓库与测试代码不含任何可用凭据字面量。
- 实名仅 `disabled|tencent` 两种运行时 Provider；腾讯 FaceID 使用 `ImageRecognitionV2`。`IDENTITY_DATA_ENCRYPTION_KEY`、`IDENTITY_FINGERPRINT_SECRET`、`MEDIA_TICKET_SECRET` 独立注入；Fake 仅测试模块 override，无运行时测试通过入口。媒体票据签发与内容读取均检查精确业务引用和当前权限。
- 审计日志（发布 / 审核 / 导入 / 导出 / 开考 / 交卷等敏感操作）为结构化 JSON 文件，独立通道保留 180 天。

## 设计文档 → 实现对照（摘要）

| 设计分册 | 关键落点 |
|---|---|
| 03-数据库设计 | 当前 38 张业务表 + 1 张迁移元数据表及索引，共 39 张物理表；定义同步于 `database/init.sql`、000—021 迁移、`server/src/entities/` 与本册 |
| 04-API设计 | 各模块 Controller；`{code,message,data}` 信封、40xxx/50xxx 错误码表（`server/src/common/errors.ts`） |
| 05-模块设计 | 六大模块 Service（解析流水线、出题任务、心跳结算、评分引擎、统计口径等） |
| 06-关键流程 | 定时任务双触发、聚合落库事务、交卷评分决策（`server/src/modules/`） |
| 07-安全与非功能 | 守卫链、封禁键、上传校验链（扩展名+魔数+大小）、content_html 白名单净化、审计日志、Redis AOF |
