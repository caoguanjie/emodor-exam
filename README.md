# EmodorRuleExam · 制度学习及考试系统

当前仓库实现基线覆盖「制度上传 → 在线学习 → AI 出题 → 旧固定卷考试 → 统计跟进」闭环，并已在同一工程内集成安全培训机构后台 A1—C6 的源码增量；[docs/design](docs/design/) 是设计基准。融合边界详见[已批准设计](docs/superpowers/specs/2026-10-21-training-admin-integration-design.md)与[实施总计划](docs/superpowers/plans/2026-10-21-training-admin-integration.md)。C7 代码集成、自动回归与升级演练已收口，用户暂缓的手动验收仍单独登记；源码集成不等于开发库或生产库已升级，也不等于独立 H5、真机视频或真实外部 AI 已验收。

## 技术栈（与 README 3.1 定稿逐项一致）

| 分层 | 选型 | 落点 |
|---|---|---|
| 前端 | Vue 3 + TypeScript + Vite（Pinia / Vue Router）+ Element Plus | `web/` |
| 后端 | Node.js + NestJS（TypeScript）+ TypeORM | `server/` |
| 数据库 | MySQL 8.0（当前源码定义 37 张业务表 + 1 张 `schema_migration` 元数据表，utf8mb4 / DATETIME(3)，无外键、应用层维护） | `database/init.sql`、`database/migrations/`、`database/migrate.mjs` |
| 缓存 | Redis（考试计时 / 学习会话累计 / 防重复提交 / AI 配置读缓存；不可用时进程内兜底降级） | `server/src/common/redis.service.ts` |
| AI 接入 | OpenAI 兼容协议（base_url / api_key / model 可配置，AES-256-GCM 加密落盘、掩码回显） | `server/src/modules/ai/` |
| 文件解析 | unpdf（PDF→text，内置现代 pdf.js，要求 Node ≥22）+ mammoth（DOCX→HTML+text，双产物一次成型） | `server/src/modules/regulations/parse-pipeline.service.ts` |
| 在线阅读 | pdfjs-dist（canvas 渲染，滚动可观测） | `web/src/views/employee/Reading.vue` |
| 认证权限 | JWT 双令牌（access 2h / refresh 7d 轮换）+ 三类系统身份兼容 + 可配置业务角色/权限 + Redis 会话吊销 | `server/src/modules/auth/`、`server/src/modules/access/`、`server/src/common/guards/` |
| 部署 | Docker Compose（nginx + api + mysql + redis，仅 nginx 对外） | `docker-compose.yml`、`deploy/` |

## 目录结构

```
├── docs/design/            # 设计方案（8 册，实现基准）
├── database/
│   ├── init.sql            # 当前 37 张业务表 + schema_migration 的全新初始化 DDL
│   ├── migrations/         # 000—014 可复核增量升级脚本（保留当前工程已有记录）
│   ├── migrate.mjs         # 校验 checksum、记录进度并支持失败续跑的迁移入口
│   └── seed.mjs            # 种子数据：根部门 + 超级管理员（口令经环境变量注入）
├── server/                 # NestJS API（六大业务模块 + 横切能力）
│   ├── src/common/         #   统一信封 {code,message,data} / 错误码表 / 守卫链 / Redis / 审计日志
│   ├── src/entities/       #   当前业务表 TypeORM 实体；新增表与迁移/设计同步
│   ├── src/modules/        #   组织权限/系统配置、制度/AI/题库、课程/视频、考试/阅卷/监控、统计、health
│   ├── src/tasks.service.ts#   定时任务：超时自动交卷(30s) / 会话兜底收口(60s) / 解析兜底扫描(60s)
│   ├── test/               #   核心算法单元测试（vitest）
│   └── Dockerfile
├── web/                    # Vue 3 SPA（员工学习端 + 管理端）
│   ├── src/views/employee/ #   我的制度 / 在线阅读(心跳·失焦·位图) / 考试 / 成绩
│   ├── src/views/admin/    #   部门 / 员工(Excel导入) / 制度 / 题库与出题 / 试卷 / 统计 / AI配置
│   └── Dockerfile
├── deploy/
│   ├── nginx/default.conf  # 静态托管 + /api/v1 反代 + 513MiB 传输上限 + 安全头 + CSP
│   └── .env.example        # 环境变量清单（敏感值运行期生成，不落仓库）
├── tests/
│   ├── e2e-smoke.mjs       # legacy 端到端冒烟（当前 97 项显式断言，内置 Mock AI）
│   ├── suites/              # legacy 回归适配器；增量套件由 run-e2e.mjs 统一注册
│   └── run-e2e.mjs         # ephemeral 套件启动器（实例隔离、密钥运行期随机）
└── docker-compose.yml
```

## 培训融合增量的边界与状态

本期批准的是单家培训机构的 PC 管理端与完整后端链路，不迁移旧站数据；独立学员 H5 下一期，课程/视频学习与制度阅读分开。不建设租户、班级、支付或证书平台。A1—C6 当前已具备所需迁移/数据模型、控制器/服务与 PC 入口：C3 将确认草稿、图片答案和主动/超时交卷收敛到持久存储与统一终结器（finalizer，即两种交卷共用同一套结算逻辑）；C4 提供图片题逐题受控评分、不可变阅卷事件、统一结果、本人历史与错题；C5 将考试记录读取和监控拆为 `exam_records:read` / `exam_records:monitor` 两项独立权限；C6 提供当前应考/历史开考统计、按难度分榜、同筛选分页 Excel 导出及按实际权限裁剪的管理首页。这里的迁移是当前 RuleExam schema 的保留数据升级，不是已排除的旧站数据搬迁。

| 任务 | 当前状态 / 目标 | 主要验收口径 |
|---|---|---|
| A1 | 已集成：基准、契约、迁移安全入口 | 测试库隔离；DDL、初始化、迁移、实体与文档同步 |
| A2—A5 | 已集成：类别来源、权限会话、媒体、后台公共框架 | 来源不等于权限；受控资源；PC 管理端 |
| B1—B4 | 已集成：课程视频、学习协议、版本题库、Excel/TXT 导题 | 视频与制度阅读分开；题目难度/题型/考点/来源版本 |
| C1—C3 | 已集成：固定/随机发布、个人题单、持久草稿与统一交卷 | 本机构初级、外来高级；100/60/30/3/0.5；不泄答案解析 |
| C4—C5 | 已集成：逐题阅卷、统一结果/历史/错题、考试记录与只读监控 | 单题 0..满分、审计/乐观版本；最终总分只读；权限分离；5 秒轮询、90 秒待确认 |
| C6 | 已集成：场次统计、难度分榜、同筛选导出与权限首页 | 当前应考集合交集；当前 release/同规则/已最终批改个人最高分；排名与导出同筛选同分页 |
| C7 | 代码与自动验收已收口；手动暂缓项保留 | 17 套件分段通过、PC 关键链路、升级演练、独立审查修复；完整边界见验收清单 |

### 已落地统一规则与待验边界（不改 legacy 约束）

- 新培训考试默认不要求完成学习；旧制度固定卷仍保留制度阅读“累计有效时长 + 底部段覆盖”双条件。服务端计时、空白答案、答案/解析不下发、令牌吊销、Redis/SSRF/环境变量密钥边界不放宽。
- 题目按 `easy/medium/hard` 标难度，题型为 `single/multiple/judgment/image`；来源 `institution/external` 与权限角色分开。制度/制度版本是可选来源，AI 题记录真实来源版本，人工/导入题可无制度来源；中级题可录入、审核并用于固定组卷，随机混抽中级仍留待明确需求。
- 默认考试 100 分、60 分及格、30 分钟、最多 3 次（含首次）、多选漏选 0.5；视频心跳 30 秒、单次最多 45 秒、位置容差 2 秒、覆盖 95%；图片题单题最多确认 9 张；监控页 5 秒轮询，超过 90 秒无服务端确认心跳只显示“连接待确认”。
- 最终总分不可直接编辑。图片题仅在最终结算前按题评分，写入 `exam_review_event` 与乐观版本后由服务端汇总；最终结算后只读。本人结果、历史与错题共用 `ExamHistoryService`，考试记录读取与监控分别受独立权限保护。

[培训管理端验收清单](docs/testing/training-admin-acceptance.md)是当前证据和未验项的集中登记入口。已执行证据包括：C6 集成提交 `c2b8858`；`ce7a99c` 的隔离 full-flow 已串联真实 DOCX、Mock AI 审核、人工/TXT 录题、视频服务端学习、两类学员抽题、重启草稿恢复、主动/超时交卷、80/35 分阅卷、监控、统计分榜与同筛选 Excel；迁移组合测试经 `b052688`、`9bd881e` 覆盖 000—014 的首跑、重复执行、latest-init 空 registry 及旧 20—26 菜单保留并实际通过 37/37；当前服务端测试为 352/352（33 files），前端 `vue-tsc`、5 项最终聚焦测试与构建通过（1799 modules），C6 五个端点均拒绝未知 query。

首次 `--suite all` 遇到旧测试夹具失败后停止；按同一注册表分段续跑、修复夹具并单项复验，17 个独立套件均取得通过结果，并非声称单次 all 无失败。培训统计、权限首页、阅卷/预览打印的关键 PC 路径已复核，分页 P2 已以 `8953c01` 修复并通过组件事件回归。文档、构建/单测、独立测试库 API、PC 操作和真实 H5/视频/外部 AI 分属不同证据等级；用户暂缓的原生选文件及其他明确未验场景仍见清单，未执行生产升级或远程发布。

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
node tests/run-e2e.mjs --ephemeral --suite smoke  # 仓库根：自有临时 MySQL/Redis、随机密钥与 Mock AI
node tests/run-e2e.mjs --ephemeral --suite all    # 注册套件逐个隔离执行，遇失败停止
```

临时模式需要本机 MySQL/Redis 可执行文件。连接外部测试服务时仅运行单套件，必须显式注入 `DB_DATABASE=ruleexam_test_<suffix>` 与 `DB_PASSWORD`；启动器不会接受开发库默认值。不得读取凭据文件或把真实口令写入命令示例。

## 安全约束（实现遵循）

- 学习时长以服务端时钟差结算：30 秒心跳、单次最大计入 45 秒、失焦 pause/resume 锚点、10 段覆盖位图（仅计停留 ≥10 秒的段）、单活跃会话约束——全部服务端生效。
- 考试：确定性 seed（HMAC-SHA256）乱序、下发不含答案与解析、deadline_at 快照计时、切屏计数（1 秒去抖）、三层幂等交卷、超时自动交卷双触发、漏选部分分可配。
- 最终总分不可直接修改；图片题可在最终结算前受控逐题评分并由服务端聚合，最终结算后只读；多次作答取最高分为旧统计/新场次各自明确口径。
- 口令 bcrypt(cost=12)；首次登录（last_login_at IS NULL）强制改密；改密 / 重置 / 停用即吊销存量令牌（Redis 封禁键）。
- 所有敏感值（DB 口令 / JWT_SECRET / EXAM_SHUFFLE_SECRET / APP_ENCRYPTION_KEY / 管理员初始口令）一律环境变量运行期注入，仓库与测试代码不含任何可用凭据字面量。
- 审计日志（发布 / 审核 / 导入 / 导出 / 开考 / 交卷等敏感操作）为结构化 JSON 文件，独立通道保留 180 天。

## 设计文档 → 实现对照（摘要）

| 设计分册 | 关键落点 |
|---|---|
| 03-数据库设计 | 当前 37 张业务表 + 1 张迁移元数据表及索引；定义同步于 `database/init.sql`、迁移脚本、`server/src/entities/` 与本册 |
| 04-API设计 | 各模块 Controller；`{code,message,data}` 信封、40xxx/50xxx 错误码表（`server/src/common/errors.ts`） |
| 05-模块设计 | 六大模块 Service（解析流水线、出题任务、心跳结算、评分引擎、统计口径等） |
| 06-关键流程 | 定时任务双触发、聚合落库事务、交卷评分决策（`server/src/modules/`） |
| 07-安全与非功能 | 守卫链、封禁键、上传校验链（扩展名+魔数+大小）、content_html 白名单净化、审计日志、Redis AOF |
