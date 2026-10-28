# AGENTS.md — EmodorRuleExam 工作区指引

培训机构管理与考试系统：资料上传解析 → AI 出题/人工导题 → 预览确认并启用 → 组卷发布 → 自动评分 → 记录与统计；课程视频学习独立保留。题库不配置分值，分值归属试卷；停用与逻辑删除不影响历史冻结卷和考试。
**`docs/design/`（8 册）是实现基准**：改数据库/API/流程前先读对应分册，改动后保持文档、`database/init.sql`、`server/src/entities/` 三方一致。

## 目录

- `docs/design/` 设计方案 8 册（01 需求 … 07 安全与非功能、README 对照表）
- `database/` `init.sql`（41 张业务表 + 1 张迁移元数据表，共 42 张物理表，与 03 册一致）+ `seed.mjs`（口令经环境变量注入）；当前迁移 000—041，021 考试稳定选项 ID、022 设计器存储、023 课时软删除、024 学员年龄、025 题库分值历史兼容可空、026 题目启停、027 清理题目审核权限、028 续接一次性密码回填完成探针（不改账号数据）、029 题目逻辑删除、030 试卷考前学习要求、031 试卷排序、032 试卷操作信息、033 COS 媒体定位与上传会话、034 管理员逻辑删除、035 角色备注与名称唯一、036 三模块独立按钮权限、037 独立字典分类、038 清理既有账号提升管理员权限链路、039 网站关于我们配置、040 培训试卷撤回显示字典与状态注释、041 培训试卷撤回回草稿兼容；表变更必须同步迁移、`init.sql`、entities 与设计分册
- `server/` NestJS API：`src/common/`（信封/错误码/守卫链/Redis/审计）、`src/entities/`、`src/modules/`（auth/access/users/training/courses/question-materials/ai/questions/exams/statistics 等）；departments/regulations 只保留共享存储与历史只读依赖，不恢复旧管理 CRUD
- `web/` Vue 3 + TS + Vite + Element Plus；`src/views/employee/` 学习端、`src/views/admin/` 管理端
- `mobile/` uni-app + Vue 3 + TypeScript + Pinia + Wot UI 2.3.2；独立学员 H5 / MP-WEIXIN 入口，PC 管理端不复用其登录状态或答题入口
- `deploy/` nginx 配置与 `.env.example`（环境变量权威清单）
- `tests/` `run-e2e.mjs` 启动器（21 个注册套件）+ `e2e-smoke.mjs`（85 项断言，内置 Mock AI）；`tests/gui-test-env/`（`mock-ai.mjs`、`seed-material.mjs` 预置出题资料）
- `review/` 代码评审报告与修复记录（新增评审/修复记录写入此目录）

## 常用命令

```bash
cd server && npm run build        # tsc 构建到 dist/
cd server && npm test             # vitest 单元测试（评分/乱序/心跳/位图）
cd web && npm run dev             # Vite :5173，/api/v1 代理到 :3000
npm --prefix web run build       # 本地直构建：输出根 dist/，非原子；正式组合发布用下方脚本
npm --prefix mobile run dev:h5       # 学员端 H5 开发
npm --prefix mobile run type-check   # 学员端类型检查
npm --prefix mobile run test:unit    # 学员端单元测试
PLAYWRIGHT_CHANNEL=chrome npm --prefix mobile run test:e2e:static # 学员端静态场景浏览器回归
node scripts/build.mjs web       # 原子更新 PC，保留 dist/mobile/
node scripts/build.mjs h5        # 原子更新 dist/mobile/，保留 PC
node scripts/build.mjs web h5    # 两端都成功后原子发布组合 dist/
node scripts/build.mjs mp-weixin # 独立构建小程序，不修改网站 dist/
node tests/run-e2e.mjs --ephemeral --suite smoke   # 仓库根：自有临时服务、密钥运行期随机、Mock AI
node tests/run-e2e.mjs --ephemeral --suite all     # 注册套件逐个隔离；all 必须使用 ephemeral
DB_PASSWORD=... ADMIN_INITIAL_PASSWORD=... node database/seed.mjs   # 种子：根部门 + admin（口令 ≥8 位且含字母+数字）
# ---- GUI/本地联调回归环境（Mock AI :9101）----
node tests/gui-test-env/mock-ai.mjs                                  # 启动 Mock AI
ADMIN_ACCESS_TOKEN=... BASE_URL=http://127.0.0.1:3000/api/v1 node tests/gui-test-env/seed-material.mjs # 运行期注入令牌，上传 DOCX/PDF 出题资料
AI_EGRESS_ALLOW_HOSTS=127.0.0.1 <其余密钥> node server/dist/main.js   # 本地联调 AI 必须放行 127.0.0.1，否则 SSRF 白名单拒绝 Mock AI
```

API 启动后监听 :3000，全局前缀 `api/v1`。本机开发用宿主 MySQL 8.0（127.0.0.1:3306）与 Redis（6379），无 Docker；口令一律环境变量注入，不要把任何真实凭据写进代码或文档。

## 学员端 Wot UI 与 AI 工具

- 涉及 Wot 组件时，按需加载项目内 `.agents/skills/wot-ui-v2/SKILL.md`；CLI 使用问题加载 `wot-ui-cli`；品牌主题加载 `create-wot-ui-theme`；只有实际涉及 UnoCSS 时才加载 `wot-ui-unocss-preset-guide`。后两项 Skill 的安装不等于已经采用或安装对应运行时方案。
- 官方文档索引：<https://wot-ui.cn/llms.txt>。仅在需要查指南、兼容性或补充 CLI 信息时读取索引，再读取相关页面；不要把全文复制进 AGENTS，也不要默认加载 `llms-full.txt`。
- API、事件、插槽、Demo、CSS 变量优先使用项目内离线 CLI。在仓库根执行 `npm --prefix tools/wot-ui run --silent wot -- <命令>`；缺依赖时先 `npm ci --prefix tools/wot-ui --ignore-scripts`，不要回退到全局 `wot`、`npx @wot-ui/cli@latest` 或 `pnpm dlx`。
- CLI 固定版本见 `tools/wot-ui/package-lock.json`。查询必须指定 Wot UI 数据版本：当前按 `mobile/package-lock.json` 锁定的 `@wot-ui/ui@2.3.2` 使用 `--version 2.3.2`。不要把 CLI 版本、组件库版本和 `latest`/`v2` 别名混为一谈，也不要混用 `wot-design-uni` v1 文档。
- 本项目只接入文档索引、CLI 和 Skills，**不配置或启动 Wot MCP**，不执行 `wot agent init`，不改用户级 Agent 配置。上游 Skill/README 中的全局安装和 MCP 示例不适用于本项目；其中维护 open-wot 源码的构建/发布步骤也不作为本仓库任务。
- 安装来源、命令和更新方式见 [tools/wot-ui/README.md](tools/wot-ui/README.md)。

## 架构红线（改代码前必读）

- 响应统一信封 `{code,message,data}`（`server/src/common/response.interceptor.ts`），错误码表见 `common/errors.ts`（40xxx/50xxx）；DTO 校验一律走 `DtoValidationPipe`。
- 数据库**无外键**，引用完整性由应用层维护；`database/init.sql`、entities、设计分册和迁移须一致。`schema_migration` 只保留一套可续跑协议（03 册 1.10）；不得改写既有迁移 checksum。015 删除专用结构前须阻断待保留历史数据，不能清零成绩或伪造题型。
- 学习时长全部服务端结算（30s 心跳、单次 ≤45s、失焦锚点、10 段位图、单活跃会话）；不要在前端"补"时长逻辑。
- 考试仅支持单选、多选、判断，下发 payload 不含答案与解析；乱序 seed 由 `EXAM_SHUFFLE_SECRET` HMAC 派生；最终总分不可直接修改。新培训移动考试只保存本地最小草稿，学员主动整卷提交后由服务端事务评分；到期只收口为未交卷 timeout，不自动提交、不评分、不生成答案。题干/选项/解析的受控图片继续保留，旧已评分 timeout 只读兼容。
- 旧制度固定卷继续按有效学习双条件取得资格；新培训考试默认不以课程/制度学习完成作为开考门槛，视频课程学习与制度阅读分开，服务端计时、空白答案、反答案泄露与令牌规则不放宽。
- 令牌吊销靠 Redis 封禁键（改密/重置/停用即吊销）；refresh token 走 HttpOnly Cookie。
- 实名运行时仅 `IDENTITY_PROVIDER=disabled|tencent`，腾讯 FaceID 使用 `ImageRecognitionV2`；Fake 只允许测试模块 override，不提供运行时 mock/test-pass。实名与媒体票据遵守[冻结契约](review/2026-10-22-learner-mobile-contract-freezes.md)，文档同步不等于真实供应商或真机已通过。
- 视频只接受 mobile employee，开播/短票要求实名，课程学习不按来源/类别额外拦截；服务端继续按 30 秒心跳、45 秒封顶、2 秒容差和 95% 去重覆盖结算。
- 学员端当前验证结果和未验边界统一查看 [H5 验收记录](review/2026-10-22-learner-mobile-h5-acceptance.md)，不要在本文件复制 Task/Gate 进度快照，也不要把自动化或桌面浏览器结果扩大为真机、真实供应商或生产部署结论。
- 实名材料私有存储；姓名/证件号 AES-256-GCM 加密，证件 HMAC 查重。短期媒体签发/续签须核对精确 `media_reference` 与当前业务授权；local/实名代理读取也复核。用户已选择gooodwork COS短链，已发链接有效期内仍可读（默认300秒、配置上限3600秒），不能承诺即时撤权；不得把JWT放入媒体URL。
- AI 模块出网有 SSRF 白名单校验（仅 http/https、拒绝内网/环回），本地 Mock AI 需 `AI_EGRESS_ALLOW_HOSTS=127.0.0.1`。
- 所有敏感值（DB/JWT/加密密钥/管理员初始口令）只经环境变量运行期注入，仓库与测试不得含可用凭据字面量。

## COS 媒体增量

- 采用[批准设计](docs/superpowers/specs/2026-10-26-cos-media-integration-design.md)与[Astra计划](docs/superpowers/plans/2026-10-26-cos-media-integration.md)，不经过SDD。local/COS按媒体行读取；PDF/DOCX原件仍本地。两边后端共用原COS密钥，浏览器只获精确临时授权。
- 本分支新增 `033_cos_media_storage.sql`。原 COS 候选 030 从未部署；整合主线已应用的 029—032 后顺延为 033，不改写已应用迁移或其 checksum。根 `.env` 由已有工具加载，`import-cos --from-env <明确源路径>` 只导入4项白名单；不得提交或打印真实值。
- 实际实施/云/容量边界见[验收记录](review/2026-10-26-cos-media-acceptance.md)和[G0记录](review/2026-10-26-cos-cloud-gates.md)。不把源码、自动化或同桶配置当成真实分发/迁移完成。

- 培训试卷撤回发布回到真实 `draft`，恢复编辑和重新发布；草稿预览读当前题单，重新发布追加release版本。旧assignment/考试记录保留原冻结版本，有历史引用的草稿禁止物理删除。041兼容既有training withdrawn，不改已应用040或checksum。

## 已知坑

- `web` 的 `npm run build` 只跑 `vite build`，**无类型检查**；需要类型把关时手动执行 `npx vue-tsc --noEmit`。
- 发布构建统一走根命令 `node scripts/build.mjs web|h5|web h5|mp-weixin`。脚本用同盘临时目录、构建锁和原子切换保护 `dist/`；不要再手工复制 H5，也不要用 `npm --prefix web run build` 代替组合发布。
- `server` 没有 lint 脚本；改动后以 `npm run build` 作为编译校验。
- e2e 会重建测试数据库，勿对准开发库跑。
- `.trae/` 目录已 gitignore，不要把其中文件提交进仓库。
- 服务端要求 **Node ≥22**（`unpdf` 的 engines 声明，Dockerfile 已用 node:22-alpine）；`server/package.json` 已声明 `engines.node`。
- GUI 复测截图不入库（`gui-test-screenshots/` 已 gitignore），复现步骤见上方「常用命令」的 gui-test-env 三条命令。

## 培训融合文档状态（2026-10-22）

- 当前范围以[已批准瘦身计划](docs/superpowers/plans/2026-10-22-training-demo-slimming.md)覆盖融合设计的冲突条款；保留培训管理、题库与 AI、三客观题考试、记录和统计。实际验证与未验边界见[瘦身验收记录](review/2026-10-22-training-demo-slimming-acceptance.md)，本地实现不代表已部署。
- 本期仍是单家机构，不迁移旧站数据，也不建设租户、班级、支付或证书平台。课程/视频学习不替代制度阅读；独立学员端的实现与验收状态以 [H5 验收记录](review/2026-10-22-learner-mobile-h5-acceptance.md)为准。
- A1—C7 的 owner 与验收门如下，未标“已验收”的能力只能写成计划：

| 任务 | owner 范围 | 文档验收关注 |
|---|---|---|
| A1 | 基准、契约、迁移安全入口 | DDL/init/migration/entity 同步、测试库隔离 |
| A2—A5 | 学员类别来源、权限会话、媒体、公共后台 | 来源与权限分离、受控上传、PC 公共框架 |
| B1—B4 | 课程视频、视频协议、三客观题题库、导题 | 视频与制度阅读分离、题目版本/来源/难度 |
| C1—C3 | 发布快照、个人题单、草稿/交卷 | 难度抽题、不可变快照、服务端截止与防泄漏 |
| C4—C5 | 自动评分、历史结果、只读考试记录 | 统一冻结结果、最终总分只读、无人工评分或实时监考 |
| C6—C7 | 培训统计、全链回归与交付收口 | 场次/难度/个人最高分口径、旧链路回归 |

- 运行构建、API 测试、PC 操作和真实 H5/视频/外部 AI 验收是不同证据等级；文档一致不等于运行或业务验收通过。
