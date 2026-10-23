# 学员移动端 H5 Implementation Plan

> **Execution:** REQUIRED SKILL: use `$astra-workflow`. Root owns architecture, shared-file integration, Git index and final evidence；workers 按无重叠文件 lane 并行，tester/reviewer 在冻结候选上独立验证。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付独立的学员移动端 H5，完成短信登录、课程与视频学习、三图实名、三类客观题考试、记录与错题闭环，并与 PC 管理端一起安全构建到根 `dist/`。

**Architecture:** 新建传统 uni-app Vue 3 + TypeScript 的 `mobile/` 工程，H5 首发、MP-WEIXIN 首期只做编译兼容；页面和业务共用，平台差异集中在 `platform/`。移动端复用现有 NestJS 领域服务，但新增 mobile 短信会话、实名、媒体票据和稳定 ID 考试契约；所有权威状态继续由服务端维护。

**Tech Stack:** Node.js ≥22、npm、uni-app Vue 3/Vite/TypeScript、Wot UI v2 `@wot-ui/ui@2.3.2`、Pinia、Vitest、Playwright、NestJS 10、TypeORM、MySQL 8、Redis。

**Spec:** `docs/superpowers/specs/2026-10-22-learner-mobile-architecture-design.md`

## Global Constraints

- 实施前完整阅读设计和 `docs/superpowers/specs/2026-10-22-learner-mobile-architecture-decisions.md`；后者 D01—D38 是讨论证据，设计文档是实施基线。
- 首期只交付 H5；MP-WEIXIN 首期只要求编译通过，不把小程序登录或真机业务闭环混入 H5 验收。
- 使用 DCloud 官方 `dcloudio/uni-preset-vue#vite-ts` 最新模板初始化；记录实际模板 commit，提交 `mobile/package-lock.json`，后续只使用 `npm ci`。
- 保留 npm，不迁移 pnpm workspace；不初始化 Wot MCP，不引入 UnoCSS，Wot API 按项目级 CLI/Skills 查询。
- `mobile/` 与 `web/` 分开；PC 继续使用 Element Plus，移动端只使用 Wot UI v2。
- H5 base 固定 `/mobile/`，使用 Hash 路由；API 同域 `/api/v1/`。
- access token 仅放 Pinia 内存；mobile refresh 使用独立 HttpOnly Cookie，PC 现有 Cookie 和强制改密规则不放宽。
- 考试只支持 `single / multiple / judgment`；在考 payload 不含正确答案、解析、`correct`、`checked` 或评分规则。
- 本地答案固定为 `Record<itemId, optionId[]>`；交卷固定为 `record_id + answers[{item_id, option_ids}]`，不转换展示下标。
- 只允许学员主动确认交卷；deadline 后服务端转 `timeout`，不得使用客户端或服务端草稿自动交卷。
- 学习时长只由现有服务端协议结算：30 秒心跳、单段 45 秒上限、前进容差 2 秒、95% 去重覆盖完成。
- 所有数据库变化同步新增迁移、`database/init.sql`、entities 和对应 `docs/design/` 分册；不改写既有迁移 checksum。
- E2E 只能使用 `ruleexam_test_*` 或 `--ephemeral`，不得对开发库运行；不得读取或写入真实凭据。
- `gooodwork` 只作为短信和实名认证的代码、契约、配置名与测试参考；不复制其会话体系、Python 分层、数据库模型或任何 `.env` 值。
- RuleExam 复用相同供应商配置名，`deploy/.env.example` 只登记变量名和安全说明。真实 Key 由用户/运维在运行环境或密钥管理系统注入，不进入计划、源码、提交、日志或测试输出。
- 自动化业务链路通过仅限开发/测试环境的 Debug Login 取得真实 mobile JWT/session，不自动调用真实短信；真实手机号和验证码由用户在最终浏览器验收时亲自输入，不交给 Agent 保存或代填。
- 工作区有并行改动；worker 不操作 Git index、不提交、不清理或回滚他人改动。只有 root 在同步门核对精确差异后逐文件暂存，禁止宽目录 `git add`、`git add .`、`git add -A`。
- 有依赖关系的任务等待同步门；无依赖且无文件冲突的 lane 进入 Astra ready queue 并行执行。模块候选冻结后再做联调、tester 验证和必要的独立 reviewer gate；本计划中的 Commit 均由 root 本地提交，不含 push。

## Review Focus

1. **手机号并发关联**：后台导入与短信自动注册同时发生时，只保留一个学员 ID，停用或高权限账号不能借短信重建；Task 7 的迁移、单元和 E2E 覆盖。
2. **PC/mobile 会话串扰**：并发 401 只 refresh 一次，mobile 退出或刷新失败不清 PC Cookie，权限提升后旧 mobile 会话失效；Task 7、Task 8 覆盖。
3. **实名供应商成功但本地绑定失败**：重试先查权威状态，不重复收费或重复绑定，同一证件不能占用两个账号；Task 10、Task 11 覆盖。
4. **deadline 临界竞态**：仅服务端在截止前锁定并受理的主动交卷成功，超时不评分草稿、不创建伪造答案；Task 13 覆盖。
5. **共享 `dist/` 被单端构建破坏**：web/h5 任一构建失败或只构建一端时，现有另一端产物保持不变；Task 15 覆盖。
6. **Debug Login 泄漏到生产**：默认关闭，生产环境启用时启动失败；只签发普通学员 mobile 会话，不能登录管理员或绕过权限复核；Task 7、Task 16 覆盖。

---

## Astra Execution Orchestration

### 角色与执行原则

- `root`：唯一架构裁决者和集成者；冻结接口契约、维护共享文件、处理跨 lane 冲突、核验差异、操作 Git index、创建本地提交和汇总验收证据。
- `worker`：按后端、mobile、PC/构建等独占文件 lane 实施；不得编辑 root-owned 共享文件，不得 `git add` 或 `git commit`。
- `tester`：在 root 冻结的当前 `main` 工作区候选上运行目标测试、浏览器复现和回归；不以 worker 的自测结果替代独立证据。
- `reviewer`：独立审查认证、实名、考试、构建发布等高风险候选；读取仓库 `AGENTS.md`。当前 `.harness/agents/code-reviewer.md` 不存在，执行时使用现有 `.codex/skills/requesting-code-review/code-reviewer.md`；若后续补齐 Harness 入口，则以 Harness 为准。
- 所有角色使用 `.codex/config.toml` 和 `.codex/agents/*.toml` 的工作区映射，不在计划中覆盖模型。当前配置预期为 worker/tester 使用执行模型、reviewer 使用独立 Astra 审查模型；执行时以实际创建结果为准，不虚报。
- 每次调度前查询实际并发容量。当前会话最多容纳 root 加三个子代理，因此以下 ready queue 同时最多启动三个子任务；容量更小时排队，不把排队任务伪称并行完成。
- 用户明确要求直接在当前 `main` 分支集成，不创建 worktree、不切分支。所有 worker 共享当前工作区，只能修改互不重叠的精确文件；涉及同一文件、同一生成产物或无法隔离的运行资源时必须串行。现有用户脏改动原样保留并排除在学员端暂存范围之外。

每次 `spawn_agent` / `followup_task` 必须从对应 Task 填写完整委派合同，不能只发送任务标题：

```text
目标：本 lane 要交付的一个具体结果
范围：允许修改的精确文件/目录；root-owned 文件只读
上下文：上游 Gate、已冻结契约、关联需求/设计
约束：禁止扩展项、凭据/数据边界、不得暂存或提交
交付物：精确文件清单、实现摘要、命令与结果、风险/未验证项
验收标准：本 Task 中对应测试和 Gate 条件
```

子代理若需要改共享文件、新增依赖、改变 DTO/数据库或跨越分配范围，必须先上报 root；没有 root 裁决不得继续扩大修改。

### 总体依赖图

```text
T1 官方底座
 ↓  Gate A：H5 可打开、MP-WEIXIN 可编译、模板 commit 已记录
T2 Wot/Pinia/平台公共接口
 ↓  Gate B：公共依赖、锁文件、平台契约冻结
T3 公共壳、登录/首页/课程/个人静态基础
 ↓  Gate C：公共组件和 shell 路由冻结
┌───────────────────────────────┐
│ T4 实名静态页  ║  T5 考试静态页 │  同时执行
└───────────────┬───────────────┘
                ↓ root 合入 pages/fixtures/test registry
T6 全路由 Pencil 视觉验收
 ↓  Gate D：全部静态页面通过，才允许业务 API 联调

Auth Contract Freeze
┌───────────────────────────────┐
│ T7 后端认证  ║  T8 mobile 登录  │  同时执行
└───────────────┬───────────────┘
                ↓ 联调 + tester + security reviewer
Gate E：短信/Debug Login/mobile session 契约冻结

Course Contract Freeze
┌────────────────────────────────────┐
│ T9-server 课程 API  ║  T9-mobile 页面 │
└──────────────────┬─────────────────┘
                   ↓ 联调 + tester
Gate F：课程模块完成

Identity Contract Freeze
┌────────────────────────────────────┐
│ T10 实名后端  ║  T11 mobile 实名流程 │
└──────────────────┬─────────────────┘
                   ↓ 联调 + tester + privacy/security reviewer
Gate G：实名/媒体契约冻结

进入同一个 Astra ready queue（受实际并发槽位约束）：
┌──────────────────────────────────────────────┐
│ T12-server 视频后端  ║  T12-mobile 播放器    │
│ T13 考试后端/PC 适配  ║  T14 mobile 考试      │
└──────────────────────┬───────────────────────┘
                       ↓ 各模块分别联调；完成一个就验一个
Gate H1：视频模块通过 tester
Gate H2：考试模块通过 tester + concurrency/security reviewer

Gate H1 + Gate H2
 ↓
T15 组合构建与部署
 ↓  Gate I：web/h5 单独及组合构建、Docker/Nginx 证据
T16 全链 E2E、浏览器与人工供应商验收
 ↓  Gate J：最终验收记录
```

### 派发前契约冻结

root 在创建前后端 worker 之前，先把最小契约写入 `review/2026-10-22-learner-mobile-contract-freezes.md`。只冻结可并行实现所需字段，不在此步写业务实现：

| Gate 前置 | 必须先冻结的内容 | 放行 lane |
|---|---|---|
| Auth Contract | send/login/refresh/logout/debug-login 路径、DTO、错误码、mobile Cookie、`client/auth_method` | T7、T8 |
| Course Contract | `/me/home/courses/profile` 返回字段、可修改资料白名单、分页/空态 | T9-server、T9-mobile |
| Identity Contract | `unverified/pending/verified/rejected`、三图 slot、upload/session/status DTO、媒体票据 | T10、T11 |
| Video Contract | start/heartbeat/close DTO、播放器事件、30/45/2 秒与 95% 规则 | T12-server、T12-mobile |
| Exam Contract | `AttemptViewV2`、稳定 item/option ID、整卷 submit、timeout/幂等和实名开考错误 | T13、T14 |

契约未记录时不得把两个 lane 同时派出。worker 发现契约必须变化时暂停受影响 lane 并上报 root；root 更新记录并通知所有消费者后才能继续，不能由一侧私自漂移。

### 并行 lane 和同步点

| 阶段 | 并行工作 | root 同步动作 | 放行条件 |
|---|---|---|---|
| 静态页面 | T4 identity worker ∥ T5 exam worker | 合并路由、fixture 索引和静态测试注册 | T6 全路由/Pencil 通过 |
| 登录 | T7 backend worker ∥ T8 mobile worker | 先冻结 DTO/Cookie/错误码；后合入模块注册和 E2E suite | mobile auth、Debug Login、PC 隔离测试通过；reviewer 无阻断 |
| 课程 | T9 backend lane ∥ T9 mobile lane | 合并课程契约和 profile 入口 | API、Store、浏览器链路通过 |
| 实名 | T10 backend worker ∥ T11 mobile worker | 先冻结 identity/media DTO；后合入配置、路由和入口 | 三图状态机、媒体归属、隐私测试通过；reviewer 无阻断 |
| 视频 | T12 backend lane ∥ T12 mobile lane | 合并 heartbeat/player 契约 | 计时、缓冲、门槛和浏览器交互通过 |
| 考试 | T13 backend/PC worker ∥ T14 mobile worker | 先冻结 `AttemptViewV2`/submit DTO；后合入共享类型和 E2E | 稳定 ID、timeout、主动交卷、草稿和结果链路通过；reviewer 无阻断 |
| 交付 | T15 build worker；tester 可同时复查已冻结 H1/H2 证据 | root 合并构建入口和部署文件 | 三种构建模式及部署检查通过 |

契约冻结只确定字段、错误码、状态转换和安全边界，不提前实现业务。前后端 lane 可据冻结契约并行编码；真实联调必须等待两边候选完成。

Gate G 后的四个实现 lane 超过当前三个子代理槽位，按动态 ready queue 调度，不强行同时启动四个：优先启动 `T12-server` 与 `T13 backend/PC`；heartbeat 契约冻结后启动 `T12-mobile`；`AttemptViewV2` 契约冻结且有空槽后启动 `T14 mobile`。若三个槽位已满，后就绪 lane 排队；任一 lane 完成并释放执行占用后立即启动下一项。四个 lane 都完成后，root 冻结同一个集成候选，再分别运行 H1/H2 验证。

### Gate 验证矩阵

| Gate | tester 在 root 集成候选上执行的核心证据 | reviewer |
|---|---|---|
| D 静态 | mobile unit/type-check、H5/MP-WEIXIN build、三组 static E2E、Pencil 逐页记录 | 默认不需要；出现安全/契约问题再升级 |
| E 登录 | server build/unit、`mobile-auth`、`training-access`、`training-identity`、mobile auth unit/build、浏览器刷新/退出/隔离 | 必须，重点安全和权限 |
| F 课程 | course/user 目标单元、`training-courses`、`training-student-admin-boundary`、mobile course unit/build、浏览器链路 | 默认不需要 |
| G 实名 | identity/media 目标单元、`mobile-identity`、`mobile-media-ticket`、`training-media`、mobile identity unit/build | 必须，重点隐私、幂等和供应商边界 |
| H1 视频 | video coverage 单元、`training-video-learning`、mobile video unit/build、浏览器缓冲/后台/进度 | 默认不需要 |
| H2 考试 | server 全量与考试目标单元、attempt/submission/record/question E2E、PC 类型/build、mobile exam unit/build/E2E | 必须，重点并发、截止、答案泄漏 |
| I 构建 | build orchestrator 单测、web-only/h5-only/combined、Docker/Nginx（环境可用时） | 必须，重点产物互保和部署回退 |
| J 最终 | `mobile-h5`、`training-full-flow`、`smoke`、`all`、浏览器矩阵和人工供应商状态 | 必须，审查证据分级与未验边界 |

表中 E2E 均使用 `--ephemeral`/隔离数据库。完整命令仍以对应 Task 为准；worker lane 的独立检查不能替代 Gate tester 证据。

### root 独占的共享文件

并行 worker 不直接编辑下列文件；worker 在 receipt 中提供所需条目或补丁意图，由 root 在对应同步门一次合入：

| 共享文件 | 来源任务 |
|---|---|
| `mobile/src/pages.json` | T3、T4、T5 |
| `mobile/src/fixtures/ui-scenarios/index.ts`、`route-catalog/index.ts` | T3、T4、T5 |
| `mobile/e2e/static-pages.spec.ts` | T3—T6 汇总入口 |
| `server/src/config/configuration.ts`、`server/src/app.module.ts`、`deploy/.env.example` | T7、T10 |
| `database/init.sql` | T7、T10、T13，按迁移 018 → 019 → 020 顺序集成 |
| `tests/run-e2e.mjs` | T7、T10、T16 |
| `review/2026-10-22-mobile-provider-reference-map.md` | T7 创建、T10 追加 |
| `review/2026-10-22-learner-mobile-contract-freezes.md` | Auth/Course/Identity/Video/Exam 契约，root 按 Gate 更新 |
| `README.md`、`AGENTS.md`、`.gitignore` | T1、T15 |
| Git index 与所有本地 commit | 全部任务，仅 root |

若 worker 发现必须修改未分配的共享文件，立即上报，不自行扩大范围。root 合入共享文件时先复查工作区现存用户改动，不能用整文件覆盖并行内容。

### 模块分片文件

为避免 T4/T5 和后续移动联调争抢单一汇总文件，静态资料按模块拆分：

```text
mobile/src/fixtures/ui-scenarios/{shell,identity,exam}.ts
mobile/src/fixtures/route-catalog/{shell,identity,exam}.ts
mobile/e2e/{static-shell,static-identity,static-exam}.spec.ts
```

root 维护两个 `index.ts` 和 `static-pages.spec.ts` 汇总入口。Task 8、11、14 分别使用独立的 `auth-session.spec.ts`、`identity-flow.spec.ts`、`exam-flow.spec.ts`，不再共同修改静态汇总测试。

### 两次交接、tester、reviewer 与返修闭环

1. worker 先返回 **implementation receipt**：精确修改文件、仅依赖本 lane 的检查结果、需要 root 合入的共享文件条目、未验证项和风险；不得把尚未集成的全路由/E2E 写成通过。
2. root 核对 lane diff，合入共享文件并形成当前 `main` 工作区候选；静态路由注册、Nest 模块注册、数据库 init、E2E suite 注册等完整验证只能从此步开始。
3. root 冻结候选期间，暂停所有会修改该 Gate 编译/测试输入的 worker；记录精确文件清单和 diff 基线。tester/reviewer 只读当前冻结候选，不在验证期间修改实现文件。
4. tester 在冻结候选上运行计划指定的单元、E2E、构建或浏览器检查，并使用隔离的临时输出、测试数据库和端口；同一资源无法隔离时串行执行。失败只阻塞依赖该候选的节点。
5. worker 根据 tester 结果补充 **final receipt**。高风险 gate 使用未参与实施的 reviewer：Auth Gate E、Identity Gate G、Exam Gate H2、Build Gate I 和最终 Gate J。静态/课程/视频默认由 tester 把关，出现安全或跨契约变更时再升级 reviewer。
6. reviewer 的实质发现交回原 lane owner 修复；root 重新集成并创建新候选。若修复触及原证据覆盖范围，相关 tester/reviewer 证据失效并重跑，不复用旧通过结论。
7. gate 通过后，root 检查 candidate/staged diff、`git diff --cached --check` 和工作区归属，将候选标记为已接受并使用各 Task 给定的 commit message整理本地提交；不得包含其他 lane 或用户改动。

### 失败与容量处理

- 子代理失败时，root 选择重试、缩小范围、重新分配或亲自接管，并在 receipt 中记录回退；不把失败 lane 标为完成。
- 并发槽位不足时按 critical path 排队：契约/后端 lane优先，其次配对前端 lane，再次 tester/reviewer；已冻结候选的独立审查不能由实施 worker 冒充。
- 后续模块的 explorer 可在前一模块 tester/reviewer 期间只读准备；所有会改变当前 Gate 构建/测试输入的 writer 暂停，其他确实互不影响的独占文件 lane 才能继续。
- 任一 gate 未通过时，暂停其依赖节点；不阻塞无共享文件、无依赖关系的其他 ready lane。

---

## Target File Map

### 新建移动端

```text
mobile/
├── README.md                         # 官方模板来源、commit、开发命令
├── package.json / package-lock.json
├── vite.config.ts / vitest.config.ts / playwright.config.ts
├── src/
│   ├── api/{client,auth,courses,identity,media,video,exams}.ts
│   ├── components/
│   │   ├── common/{AppPage,AppTopBar,EmptyState,ConfirmSheet}.vue
│   │   ├── auth/SmsLoginForm.vue
│   │   ├── course/{CourseCard,ChapterList,VideoPanel}.vue
│   │   ├── identity/{IdentityCapture,IdentityStatus}.vue
│   │   ├── rich-content/ReadonlyRichContent.vue
│   │   └── exam/{QuestionView,OptionCard,AnswerCard,ExamTimer}.vue
│   ├── fixtures/
│   │   ├── ui-scenarios/{index,shell,identity,exam}.ts
│   │   └── route-catalog/{index,shell,identity,exam}.ts
│   ├── pages/{auth,home,course,identity,exam,profile}/**/*.vue
│   ├── platform/{session,media-picker,media-player,navigation}.ts
│   ├── stores/{session,learner,course,identity,exam}.ts
│   ├── types/{api,content,exam,identity}.ts
│   ├── utils/{storage-keys,exam-draft,server-clock}.ts
│   ├── App.vue / main.ts / pages.json / manifest.json
│   └── styles/{tokens,mixins}.scss
├── test/**/*.spec.ts                 # Store、契约和纯逻辑测试
└── e2e/{static-pages,static-shell,static-identity,static-exam,auth-session,identity-flow,exam-flow,critical-exam}.spec.ts
```

### 新建后端和数据库

```text
database/migrations/018_mobile_auth.sql
database/migrations/020_identity_verification.sql
database/migrations/021_exam_stable_option_ids.sql
server/src/entities/{learner-identity,identity-verification-session}.entity.ts
server/src/modules/auth/{mobile-auth.controller,debug-mobile-auth.controller,mobile-auth.dto,phone,sms-challenge,sms-provider,session-issuer}.ts
server/src/modules/identity/{identity.controller,identity.dto,identity-provider,identity.service}.ts
server/src/modules/media/media-ticket.service.ts
server/src/modules/questions/question-content.ts
server/test/{mobile-auth,identity-verification,media-ticket,exam-mobile-contract}.spec.ts
tests/{mobile-auth,mobile-identity,mobile-media-ticket,mobile-h5}.mjs
```

### 新建交付工具

```text
scripts/build.mjs
scripts/build-lib.mjs
tests/build-orchestrator.test.mjs
Dockerfile
review/2026-10-22-mobile-provider-reference-map.md
review/2026-10-22-learner-mobile-contract-freezes.md
review/2026-10-22-learner-mobile-static-ui-acceptance.md
review/2026-10-22-learner-mobile-h5-acceptance.md
```

### 主要修改范围

- 认证/用户：`auth.service.ts`、`auth.controller.ts`、`session.service.ts`、`jwt-auth.guard.ts`、`current-user.decorator.ts`、`users.service.ts`、`users.controller.ts`、`import-batch.service.ts`。
- 配置/实体：`configuration.ts`、`app.module.ts`、`sys-user.entity.ts`、`auth-session.entity.ts`、`database/init.sql`、`deploy/.env.example`。
- 课程/视频/媒体：`course.controller.ts`、`course.service.ts`、`video-learning.*`、`video-session.service.ts`、`media.controller.ts`、`media.service.ts`、`media-policy.ts`。
- 题库/考试：`training-contracts.ts`、`question*.ts`、`attempt*.ts`、`submission.service.ts`、`grading.service.ts`、`exam-history.service.ts`、`training-exams.controller.ts` 和相关 entities。
- PC/部署：`web/vite.config.ts`、`web/Dockerfile`（删除或改为兼容入口）、`docker-compose.yml`、`deploy/nginx/default.conf`、`.gitignore`、`README.md`、`AGENTS.md`。

---

## gooodwork 参考链路与凭据交接

root 根据 T7/T10 implementation receipts 建立并维护 `review/2026-10-22-mobile-provider-reference-map.md`，逐项记录“参考源 → RuleExam 目标文件 → 复用的行为/契约 → 对应测试”。只记录路径、配置名和差异，不记录任何配置值。

### 短信验证码参考

参考根目录：`/Users/caogj/Documents/emodor/gooodwork`。

- 业务规则：`server/domains/users/application/sms/sms_verification.py`
- 配置加载：`server/domains/users/infrastructure/integrations/yunxin/config.py`
- 网易云信适配器：`server/domains/users/infrastructure/integrations/yunxin/yunxin_sms_gateway.py`
- Redis challenge：`server/domains/users/infrastructure/cache/sms/redis_sms_challenge_store.py`
- HTTP 路由与会话签发衔接：`server/interfaces/http/modules/users/sms/routes.py`
- 测试：`server/tests/unit/users/test_sms_verification.py`、`server/tests/unit/test_sms_challenge_store.py`、`server/tests/integration/test_sms_auth_routes.py`

### Debug Login 测试旁路参考

- 路由实现：`server/interfaces/http/modules/users/debug_login/routes.py`
- 集成测试：`server/tests/integration/test_debug_login_routes.py`
- 参考契约：`POST /api/auth/debug-login`，由 `SERVER_DEBUG_LOGIN_ENABLED` 显式开启，复用正常用户关联与 session issuer，不伪造 Token。

RuleExam 对应实现为 `POST /api/v1/mobile/auth/debug-login`：仅在 `NODE_ENV=test|development` 且 `SERVER_DEBUG_LOGIN_ENABLED=true` 时可用；生产环境若尝试开启则启动失败。接口使用测试夹具手机号关联/创建普通 `employee`，再通过同一个 `SessionIssuerService` 签发真实 `client=mobile/auth_method=debug` 会话和 `ruleexam_mobile_refresh` Cookie。它只绕过短信验证码，不绕过账号停用、角色、权限、会话吊销或后续业务守卫；新建测试学员的实名状态必须仍为 `unverified`，Debug Login 不得写入或伪造实名结果。

RuleExam 沿用配置名：`SMS_PROVIDER`、`YUNXIN_SMS_APP_KEY`、`YUNXIN_SMS_APP_SECRET`、`YUNXIN_SMS_LOGIN_CODE_TEMPLATE_ID`、`YUNXIN_SMS_BASE_URL`、`YUNXIN_SMS_TIMEOUT_SECONDS`、`YUNXIN_SMS_LOGIN_RESEND_SECONDS`、`YUNXIN_SMS_LOGIN_VERIFY_TTL_SECONDS`、`YUNXIN_SMS_LOGIN_MAX_VERIFY_ATTEMPTS`、`YUNXIN_SMS_LOGIN_PHONE_DAILY_LIMIT`、`YUNXIN_SMS_LOGIN_IP_DAILY_LIMIT`、`YUNXIN_SMS_REDIS_KEY_PREFIX`。运行时代码只支持 `disabled/yunxin`；自动化测试通过 Nest 测试模块注入 `FakeSmsProvider`，不增加 `SMS_MOCK_CODE`、mock 环境开关或测试验证码接口。

### 实名认证参考

- 业务说明：`docs/链路全景/业务/个人实名认证.md`
- 会话与幂等恢复：`server/applications/identity_verification/sessions/service.py`
- 账户实名路由：`server/interfaces/http/modules/identity_verification/account/routes.py`
- 三图上传与原图处理：`server/interfaces/http/modules/media_asset/assets/identity_image_routes.py`
- OCR + FaceID 编排：`server/domains/users/infrastructure/integrations/tencent/real_name_verification_adapter.py`
- 腾讯 FaceID：`server/domains/users/infrastructure/integrations/tencent/tencent_faceid.py`
- 腾讯身份证 OCR：`server/domains/users/infrastructure/integrations/tencent/tencent_id_card_ocr.py`
- 测试：`server/tests/unit/users/test_tencent_real_name_verification.py`、`server/tests/unit/users/test_tencent_faceid.py`、`server/tests/unit/users/test_tencent_id_card_ocr.py`、`server/tests/unit/users/test_identity_verification_service.py`、`server/tests/unit/users/test_identity_verification_routes.py`

RuleExam 沿用 `TENCENT_FACEID_*` 和 `TENCENT_ID_CARD_OCR_*` 两组配置名：每组包含 `ENABLED`、`SECRET_ID`、`SECRET_KEY`、`TOKEN`、`ENDPOINT`、`HTTP_TIMEOUT_SECONDS`。启用但缺失凭据时后端必须启动失败；运行时代码只支持 `disabled/tencent`，自动化测试只在测试模块中注入 `FakeIdentityProvider`，不能把测试替身结果写成真实实名验收。

### 安全交接与真实验收门

```text
gooodwork 代码/配置名（只读参考）
  → RuleExam 正式 Provider 接口；测试进程内注入 Fake Provider
  → 用户/运维从现有密钥来源向 RuleExam 运行环境注入真实值
  → 网易云信受控手机号联调
  → 腾讯 OCR + FaceID 受控三图联调
  → 验收记录只留脱敏 request id、状态和时间，不留验证码、证件号、照片或 Key
```

自动化阶段不需要真实 Key：完整业务 E2E 通过 Debug Login 获取真实会话，短信 challenge/provider 用单元和集成测试验证；除此之外仍运行真实 H5、RuleExam API、Redis 和隔离数据库。真实短信和实名联调必须在 Task 16 单独执行并分级记录；未注入真实凭据时，结论只能是“自动化业务链路通过、真实供应商未验”。

---

## Phase 1：官方底座与公共基座

### Task 1: 用 DCloud 官方最新模板初始化并跑通空工程

**Files:**
- Create: `mobile/**`（由官方 `vite-ts` 模板生成）
- Create: `mobile/README.md`
- Root integrate: `.gitignore`

**Interfaces:**
- Consumes: Node.js ≥22、npm、DCloud 官方 `dcloudio/uni-preset-vue#vite-ts`。
- Produces: 可运行的 `npm run dev:h5`、`npm run build:h5`、`npm run build:mp-weixin` 和锁定的官方模板底座。

- [x] **Step 1: 记录初始化前基线**

Run:

```bash
node --version
git status --short
git ls-remote https://github.com/dcloudio/uni-preset-vue.git refs/heads/vite-ts
```

Expected: Node 主版本 ≥22；保存工作区基线；取得一个 40 位模板 commit。2026-10-22 核实值为 `e5a5f0539416a0f012c919cc77949d140542a367`，执行时以实际返回值为准。

- [x] **Step 2: 用官方模板创建 `mobile/` 并记录来源**

Run:

```bash
npx degit dcloudio/uni-preset-vue#vite-ts mobile
npm --prefix mobile install
```

在 `mobile/README.md` 写明模板 URL、实际 commit、初始化日期和项目 Node ≥22；不得改用 Vue2 CLI 或第三方 `create-uni` 模板。

- [x] **Step 3: 验证官方底座命令**

Run:

```bash
npm --prefix mobile run type-check
npm --prefix mobile run build:h5
npm --prefix mobile run build:mp-weixin
find mobile/dist/build -maxdepth 2 -type f | sort | head -40
```

Expected: 三条命令退出码 0；记录本次模板真实 H5 输出子目录，不能预先假定一定叫 `h5` 或 `web`。

- [x] **Step 4: 打开默认 H5 页面验证底座效果**

Run: `npm --prefix mobile run dev:h5 -- --host 0.0.0.0`

Expected: 在约 390×844 视口打开默认页面，无白屏、编译错误或控制台异常；这一检查只证明底座可运行。

- [x] **Step 5: 向 root 交付底座 receipt**

返回精确文件列表、模板 commit、运行命令和结果；worker 不暂存或提交。Gate A 通过后由 root 逐文件暂存，本地提交信息：`chore(mobile): 初始化 uni-app 官方底座`。

执行记录（2026-10-22）：官方 `vite-ts` 模板 commit 为 `e5a5f0539416a0f012c919cc77949d140542a367`；`type-check`、H5 构建、MP-WEIXIN 构建、依赖树检查及 H5 开发服务访问均通过独立 Gate A。官方模板依赖审计仍报告 101 项风险（22 low、23 moderate、56 high），未执行破坏兼容性的自动升级；微信真机未验。当前 H5 产物使用 `/assets/` 根路径，按 Task 15 改为 `/mobile/`，不在官方底座阶段提前改写。

### Task 2: 安装 Wot UI、Pinia 和测试工具并建立公共基座

**Files:**
- Modify: `mobile/package.json`, `mobile/package-lock.json`, `mobile/vite.config.ts`, `mobile/tsconfig.json`, `mobile/src/main.ts`, `mobile/src/App.vue`
- Root integrate: `mobile/src/pages.json`
- Create: `mobile/vitest.config.ts`, `mobile/playwright.config.ts`
- Create: `mobile/src/styles/tokens.scss`, `mobile/src/styles/mixins.scss`
- Create: `mobile/src/stores/app.ts`
- Modify: `mobile/src/pages/index/index.vue`
- Create: `mobile/src/platform/session.ts`, `mobile/src/platform/media-picker.ts`, `mobile/src/platform/media-player.ts`, `mobile/src/platform/navigation.ts`
- Create: `mobile/src/utils/storage-keys.ts`
- Test: `mobile/test/storage-keys.spec.ts`, `mobile/test/platform-contracts.spec.ts`

**Interfaces:**
- Consumes: Task 1 官方底座。
- Produces: `createMobileStorageKey(scope, ownerId?, resourceId?)`、`SessionTransport`、`MediaPicker`、`MediaPlayerAdapter`、`NavigationGuard`，供所有页面和 Store 使用。

- [x] **Step 1: 写公共接口和存储隔离的失败测试**

```ts
it('uses the mobile prefix and separates learner attempts', () => {
  expect(createMobileStorageKey('exam-draft', 'u1', 'a1'))
    .toBe('ruleexam:mobile:u1:exam-draft:a1')
  expect(createMobileStorageKey('exam-draft', 'u2', 'a1'))
    .not.toBe(createMobileStorageKey('exam-draft', 'u1', 'a1'))
})
```

同时用类型测试固定 `SessionTransport.refresh()`、`MediaPicker.captureLiveFace()` 和 `NavigationGuard.confirmExitExam()` 的签名。

- [x] **Step 2: 运行测试确认公共基座尚不存在**

Run: `npm --prefix mobile run test:unit -- storage-keys platform-contracts`

Expected: FAIL，原因是模块或脚本尚未定义。

- [x] **Step 3: 安装依赖并固定 npm lockfile**

Run:

```bash
npm --prefix mobile install @wot-ui/ui@2.3.2 pinia@2.2.2 vue@3.4.21
npm --prefix mobile install -D sass@1.106.1 vitest@4.1.12 @vue/test-utils@2.4.6 happy-dom@21.0.4 @playwright/test@1.64.1 typescript@5.9.3 vue-tsc@3.2.4 @vue/tsconfig@0.7.0 @vue/runtime-core@3.4.21 @types/wechat-miniprogram@3.4.10 esbuild@0.28.1 yaml@2.9.1
```

在 `pages.json` 配置 `^wd-(.*)` → `@wot-ui/ui/components/wd-$1/wd-$1.vue` 的 easycom；在 `tsconfig.json` 加入 `@wot-ui/ui/global` 类型；不引入 UnoCSS。

`pinia` 固定 `2.2.2`：其 `2.x` 浮动范围当前会解析到要求 Vue ≥3.5.11 的 `2.3.1`，与本次 DCloud 官方模板的 Vue 3.4.21 冲突；不得用 `--force` 或升级整套 DCloud/Vue 绕过 peer dependency。

- [x] **Step 4: 实现公共接口、Pinia 和主题入口**

实现：

```ts
export function createMobileStorageKey(scope: string, ownerId?: string, resourceId?: string): string
export interface SessionTransport { refresh(): Promise<string>; logout(): Promise<void> }
export interface MediaPicker { pickIdentitySide(side: 'portrait'|'emblem'): Promise<PickedMedia>; captureLiveFace(): Promise<PickedMedia> }
export interface NavigationGuard { confirmExitExam(): Promise<boolean> }
```

`main.ts` 只注册 Pinia；Wot 组件走 easycom。`tokens.scss` 承接 Pencil 的颜色、间距、圆角和移动端安全区变量。

- [x] **Step 5: 运行公共基座验证并打开 Wot 示例**

Run:

```bash
npm --prefix mobile run test:unit
npm --prefix mobile run type-check
npm --prefix mobile run build:h5
npm --prefix mobile run build:mp-weixin
```

Expected: 全部退出码 0；默认页能显示一个 Wot Button、Toast 和 Pinia 状态，证明依赖接入完成。

- [x] **Step 6: 向 root 交付公共基座 receipt**

返回精确文件列表、锁文件变化和验证结果；worker 不暂存或提交。Gate B 通过后由 root 本地提交：`feat(mobile): 接入 Wot UI 与公共基座`。

执行记录（2026-10-22）：先看到缺少测试脚本/模块的 RED，再实现并取得 18 项运行与类型断言全绿；`type-check`、H5、MP-WEIXIN 和 `npm ls --all` 均通过。390×844 浏览器实测 Wot Button、Toast、Pinia 计数及无横向溢出。为避免 npm 11 peer 漂移，Pinia、Vue、Vue runtime 和测试工具使用上面的精确版本；DCloud 使用 Vite 5.2.8，Vitest 使用其内部 Vite 8.3.5。审计仍有 98 项（20 low、20 moderate、58 high、0 critical），不执行自动修复；微信真机未验。

---

## Phase 2：先完成所有静态页面

### Task 3: 静态应用壳、登录、首页、课程和个人中心

**Files:**
- Create: `mobile/src/fixtures/ui-scenarios/shell.ts`, `mobile/src/fixtures/route-catalog/shell.ts`
- Root create: `mobile/src/fixtures/types.ts`
- Root copy: `mobile/src/static/brand-logo.png`（复用 `docs/ui/gemini/brand-logo.png`，不重新生成）
- Create: `mobile/src/components/common/{AppPage,AppTopBar,AppTabBar,AppIcon,EmptyState,ConfirmSheet}.vue`
- Create: `mobile/src/components/auth/SmsLoginForm.vue`
- Create: `mobile/src/components/course/{CourseCard,ChapterList,VideoPanel}.vue`
- Create: `mobile/src/pages/auth/login.vue`
- Create: `mobile/src/pages/home/index.vue`
- Create: `mobile/src/pages/course/index.vue`, `mobile/src/pages/course/detail.vue`, `mobile/src/pages/course/player.vue`
- Create: `mobile/src/pages/profile/index.vue`, `info.vue`, `about.vue`, `terms.vue`
- Root integrate: `mobile/src/fixtures/ui-scenarios/index.ts`, `mobile/src/fixtures/route-catalog/index.ts`, `mobile/src/pages.json`
- Test: `mobile/test/shell-route-catalog.spec.ts`, `mobile/e2e/static-shell.spec.ts`

**Interfaces:**
- Consumes: Task 2 Wot/Pinia/主题基座；`docs/ui/gemini.pen` 的登录、首页、课程和“我的”正式画板。
- Produces: `StaticScenarioId`、完整路由目录和不依赖真实 API 的第一批页面。

- [x] **Step 1: 先写路由目录测试**

```ts
it('covers every shell route with at least one Pencil scenario', () => {
  expect(routeCatalog.map((item) => item.path)).toEqual(expect.arrayContaining([
    '/pages/auth/login', '/pages/home/index', '/pages/course/index',
    '/pages/course/detail', '/pages/course/player', '/pages/profile/index',
  ]))
})
```

每个 `RouteScenario` 固定 `path`、`scenario`、`pencilBoard` 和 `expectedText`，只放一份最小静态数据。worker 只维护 `shell.ts`；索引和 `pages.json` 由 root 在 Gate C 合入。

- [x] **Step 2: 运行静态路由测试确认失败**

Run: `npm --prefix mobile run test:unit -- shell-route-catalog`

Expected: FAIL，缺少路由目录和页面。

- [x] **Step 3: 实现公共壳和页面静态状态**

按 Pencil 正式画板实现：验证码未发送/已发送/错误/过期/发送失败、首页推荐、课程进度、目录折叠、无视频、个人资料选择器、关于和服务条款。

生产代码不调用 API；页面只从 `fixtures/ui-scenarios/shell.ts` 读取 fixture。底部四 Tab 只出现在首页、课程、考试、我的主页面。

- [x] **Step 4: 运行 shell lane 独立检查**

Run:

```bash
npm --prefix mobile run test:unit -- shell-route-catalog
npm --prefix mobile run type-check
```

Expected: shell route fragment、组件和类型检查通过；此时不声称正式 URL 已注册。root 合入 shell index 和 `pages.json` 后，由 Gate C tester 运行 H5 build、`static-shell.spec.ts` 并打开页面，确认无 console error 和横向滚动。

- [x] **Step 5: 向 root 交付 shell 静态页 receipt**

返回仅属于 T3 的精确文件列表、shell 路由条目和独立检查结果；不暂存共享入口。root 合入并由 tester 完成 H5/static-shell 验证后 Gate C 才通过，再由 root 本地提交：`feat(mobile): 完成登录课程与个人中心静态页`。

执行记录（2026-10-22）：24 个 Pencil 场景、9 个正式路径和 4 个交互用例已合入；先观测 route/scenario RED，再实现为 26 项单元与类型断言全绿。独立 Gate C 的 H5、MP-WEIXIN、类型检查均通过，Chrome 跑 `static-shell.spec.ts` 28/28；所有场景 0 API、0 page/console error、0 失败资源、0 横向溢出。修正了 favicon 404、Wot Input 选择器及课程目录 `aria-expanded`，姓名/手机号保持不可编辑。微信真机和像素级全量视觉对比仍留后续 Gate D。

### Task 4: 静态三图实名流程与异常状态

**Files:**
- Create: `mobile/src/types/identity.ts`
- Create: `mobile/src/components/identity/IdentityCapture.vue`, `IdentityStatus.vue`
- Create: `mobile/src/pages/identity/index.vue`, `detail.vue`
- Create: `mobile/src/fixtures/ui-scenarios/identity.ts`, `mobile/src/fixtures/route-catalog/identity.ts`
- Root integrate: `mobile/src/components/common/AppIcon.vue`（仅补实名所需既有 Lucide 语义图标）
- Root integrate: fixture indexes and `mobile/src/pages.json`
- Test: `mobile/test/identity-ui-state.spec.ts`, `mobile/e2e/static-identity.spec.ts`

**Interfaces:**
- Consumes: Task 2 `MediaPicker`；Task 3 公共页面壳。
- Produces: `IdentityViewState = unverified | collecting | submitting | pending | verified | rejected | error` 和完整三图静态页面。

- [x] **Step 1: 写实名 UI 状态机失败测试**

```ts
it('does not enable submit until three safe assets and consent exist', () => {
  expect(canSubmitIdentity({ portrait: 'ready', emblem: 'ready', face: null, consent: true })).toBe(false)
  expect(canSubmitIdentity({ portrait: 'ready', emblem: 'ready', face: 'ready', consent: true })).toBe(true)
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm --prefix mobile run test:unit -- identity-ui-state`

Expected: FAIL，状态机尚未实现。

- [x] **Step 3: 实现 Pencil 33—49、32/42 的静态实名状态**

覆盖三图采集、上传中、待提交、核验中、成功、详情、相机拒绝、三图不齐、安全拒绝、供应商失败和可重拍状态。正脸按钮文案明确“现场拍照”；静态阶段不访问相机或后端。

- [x] **Step 4: 运行实名 lane 独立检查**

Run:

```bash
npm --prefix mobile run test:unit -- identity-ui-state
npm --prefix mobile run type-check
```

Expected: T4 自身单元与 route fragment 检查通过。由于 `pages.json` 和索引尚由 root 待集成，此步不声称页面已能通过正式 URL 打开；完整 H5 build 和逐路由验证在 T6 执行。

- [x] **Step 5: 向 root 交付实名静态 lane receipt**

返回 identity 独占文件、路由片段和验证结果；不修改或暂存共享入口。由 root 在 T4/T5 汇合后本地提交：`feat(mobile): 完成三图实名静态流程`。

执行记录（2026-10-22）：完成 18 个实名 route scenario，覆盖三图采集、上传、核验中、pending、成功、详情、拒绝、服务异常、相机拒绝及安全拒绝；自动化只使用合成静态状态，未调用相机、后端或真实供应商。修复离页缓存页面未释放临时材料的问题，并补充 `onHide` 与 `onUnload` 双重清理。实名 lane 已并入 Gate D 的 74 项单元、类型检查、H5/MP-WEIXIN 构建和 91 项浏览器验证；真实三图、腾讯 OCR/FaceID 与真机相机未验。

### Task 5: 受限 Tiptap 渲染器和全部考试静态页面

**Files:**
- Create: `mobile/src/types/content.ts`, `mobile/src/types/exam.ts`
- Create: `mobile/src/components/rich-content/ReadonlyRichContent.vue`
- Create: `mobile/src/components/exam/{QuestionView,OptionCard,AnswerCard,ExamTimer}.vue`
- Create: `mobile/src/pages/exam/index.vue`, `instructions.vue`, `take.vue`, `result.vue`, `review.vue`
- Create: `mobile/src/pages/profile/exam-history.vue`, `wrong-book.vue`
- Create: `mobile/src/fixtures/ui-scenarios/exam.ts`, `mobile/src/fixtures/route-catalog/exam.ts`
- Root copy: `mobile/src/static/exam/question-bank-*.png`（复用 `docs/ui/gemini/` 的 4 张正式题图）
- Root integrate: fixture indexes and `mobile/src/pages.json`
- Test: `mobile/test/rich-content.spec.ts`, `mobile/test/exam-answer-model.spec.ts`, `mobile/e2e/static-exam.spec.ts`

**Interfaces:**
- Consumes: Task 3 公共壳；设计中的 `ReadonlyTiptapDoc`、`ExamAnswers`。
- Produces: `renderableNodes(doc)`、`toggleOption(answers,itemId,optionId,type)` 和完整考试/记录/错题静态页。

- [x] **Step 1: 写渲染白名单和三题型答案失败测试**

```ts
it('rejects unknown or unsafe rich-content nodes', () => {
  expect(validateReadonlyDoc({ type: 'doc', content: [{ type: 'script' }] })).toEqual({ ok: false })
})

it('keeps stable option ids and enforces question cardinality', () => {
  expect(selectOption({}, 'q1', 'B', 'single')).toEqual({ q1: ['B'] })
  expect(selectOption({ q1: ['B'] }, 'q1', 'D', 'multiple')).toEqual({ q1: ['B', 'D'] })
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm --prefix mobile run test:unit -- rich-content exam-answer-model`

Expected: FAIL，类型、验证器和答案模型尚未实现。

- [x] **Step 3: 实现受限只读内容与题目组件**

只支持 `doc/paragraph/text/hardBreak/image(asset_id)`；未知节点显示安全占位并记录不含正文的错误，不执行 HTML。选项显示标签由当前数组顺序生成，提交身份仍是稳定 `option.id`。

- [x] **Step 4: 实现 Pencil 考试全状态页面**

覆盖考试中心、须知、草稿恢复/不可恢复、单选、多选、判断、图片选项、答题卡、退出确认、交卷确认/交卷中/失败、时间到、结果、解析、记录、错题和通用加载失败。多选复用正式选项卡片，不把 Pencil 归档草稿当正式布局。

Pencil `QBcws` 的画板名称仍含“自动交卷”，这里只复用其时间到视觉结构；按 D16 改为“锁定作答、查询服务端超时终态”，不得触发自动交卷。正式画板没有独立多选答题页，多选沿用正式单选卡片视觉并由 `multiple` 逻辑控制，不采用归档画板 `xvllX` / `qFwJa`。

- [x] **Step 5: 运行考试 lane 独立检查**

Run:

```bash
npm --prefix mobile run test:unit -- rich-content exam-answer-model
npm --prefix mobile run type-check
```

Expected: T5 自身渲染器、答案模型和类型检查通过；不读取 T4 并行中的未冻结文件。完整 H5/MP-WEIXIN build、320—430px 布局和正式 route 验证在 root 合入后由 T6 执行。

- [x] **Step 6: 向 root 交付考试静态 lane receipt**

返回 exam 独占文件、路由片段和验证结果；不修改或暂存共享入口。由 root 在 T4/T5 汇合后本地提交：`feat(mobile): 完成考试与复盘静态页面`。

执行记录（2026-10-22）：完成 33 个考试/结果/解析/记录/错题 route scenario 和三类客观题交互；受限内容只接受 `doc/paragraph/text/hardBreak/image(asset_id)`，在考 fixture 不含正确答案与解析，时间到仅锁定作答、不自动交卷。独立复审发现复盘 fixture、结果页和解析卡统计不一致，现已统一为 79 分、16 对/3 错/1 未答并由逐题稳定 ID 答案派生；判断题解析也与 `judgment-true` 一致。另修复场景模板被重试污染及课程/解析/错题返回目标。上述修复均有先失败后通过的单元或浏览器用例。

### Task 6: 逐路由对照 Pencil 完成静态视觉验收门

**Files:**
- Modify: `mobile/src/pages/**/*.vue`, `mobile/src/components/**/*.vue`, `mobile/src/styles/*.scss`
- Modify: `mobile/e2e/static-pages.spec.ts`
- Create: `review/2026-10-22-learner-mobile-static-ui-acceptance.md`

**Interfaces:**
- Consumes: Tasks 3—5 的 `routeCatalog` 和 `docs/ui/gemini.pen`。
- Produces: 所有正式移动路由的静态视觉验收记录；只有通过该门才进入 API 联调。

- [x] **Step 1: root 合并并冻结静态路由入口**

root 合并 `shell/identity/exam` 三组 fixture、route catalog 和 `pages.json`，创建只负责汇总的两个 `index.ts` 与 `static-pages.spec.ts`。先检查 T4/T5 worker 没有修改彼此文件或共享入口，再冻结 Gate D 候选。

- [x] **Step 2: 让静态路由冒烟测试覆盖 routeCatalog 全量**

测试逐项打开 URL，断言 `expectedText` 可见、无 pageerror、无未处理请求；截图输出到已忽略的 `gui-test-screenshots/mobile-static/`。

- [x] **Step 3: 运行 H5 并执行自动路由冒烟**

Run:

```bash
npm --prefix mobile run dev:h5 -- --host 127.0.0.1
npm --prefix mobile run test:e2e:static
```

Expected: routeCatalog 全部页面能打开，无白屏和 console error。

- [x] **Step 4: 在 390×844 逐页对照 Pencil 正式画板**

按登录、首页/课程、考试入口、答题、交卷、结果、记录/个人、实名、通用状态九组检查布局、字号、间距、颜色、圆角、固定栏、弹层和安全区。每页在验收记录标记 `pass/fail`，归档画板不作为正式实现目标。

- [x] **Step 5: 修正差异并复测 320/390/430px**

Expected: 正式 route scenario 全部 pass；无横向滚动、按钮遮挡、底部栏叠加或图片拉伸。静态数据可以少，但状态必须能逐项打开。

- [x] **Step 6: 向 root 交付静态视觉门 receipt**

返回全路由结果、截图位置、验收记录和精确修正文件；root 检查 staged diff 后本地提交：`fix(mobile): 对齐 Pencil 静态视觉基线`。

执行记录（2026-10-22）：三组目录合计 75 个 route scenario（shell 24、identity 18、exam 33），最终 `npm run test:unit` 为 74/74，`type-check`、H5 与 MP-WEIXIN 构建通过；`PLAYWRIGHT_CHANNEL=chrome npm run test:e2e:static` 固定单 worker 后为 91/91。独立视觉审查在 390×844 覆盖全部场景，并以 320/430 两档复核无横向溢出；独立代码复审提出的 4 项 P2 与 1 项 P3 均修复并复审通过。最初默认 4 workers 的全量命令使 uni-app 开发服务退出，后续失败均为 `ERR_CONNECTION_REFUSED`；这是验证编排失败，不是页面回归，命令固定单 worker 后完整通过。真实 API、短信、实名供应商、微信真机和 iOS/Android 安全区仍未验。

---

## Phase 3：按模块逐个前后端联调

### Task 7: 手机号唯一、短信认证和 PC/mobile 会话隔离

**Files:**
- Create: `database/migrations/018_mobile_auth.sql`
- Create: `server/src/modules/auth/mobile-auth.controller.ts`, `debug-mobile-auth.controller.ts`, `mobile-auth.dto.ts`, `phone.ts`, `sms-provider.ts`, `sms-challenge.service.ts`, `session-issuer.service.ts`
- Create: `server/test/mobile-auth.spec.ts`, `tests/mobile-auth.mjs`
- Modify: `server/src/entities/sys-user.entity.ts`, `auth-session.entity.ts`
- Modify: `server/src/modules/auth/auth.service.ts:48-341`, `auth.controller.ts:30-78`, `session.service.ts:12-126`
- Modify: `server/src/common/guards/jwt-auth.guard.ts:29-124`, `server/src/common/decorators/current-user.decorator.ts`, `server/src/common/redis.service.ts`
- Modify: `server/src/modules/users/users.service.ts`, `users.controller.ts`, `server/src/modules/imports/import-batch.service.ts`
- Root integrate: `database/init.sql`, `server/src/config/configuration.ts`, `server/src/app.module.ts`, `deploy/.env.example`, `tests/run-e2e.mjs`
- Root create: `review/2026-10-22-mobile-provider-reference-map.md`
- Test: `tests/migration-contract.test.mjs`, `tests/training-access.mjs`, `tests/training-identity.mjs`

**Interfaces:**
- Consumes: 现有 JWT、Redis、AccessService、SessionService 和用户导入链路。
- Produces: `normalizeChinaMobile()`、`SmsChallengeService.issue/verify()`、`SessionIssuerService.issue()`、`POST /mobile/auth/sms/send|login|refresh|logout`；仅开发/测试可用的 `POST /mobile/auth/debug-login`。

- [x] **Step 1: 向 root 提供 gooodwork 短信复用条目**

只读核对本计划“短信验证码参考”和“Debug Login 测试旁路参考”列出的实现与测试，把配置名、签名算法、云信错误映射、challenge 一次消费、限流口径、Debug 开关、日志脱敏和会话签发边界作为 implementation receipt 条目交给 root。root 创建 `review/2026-10-22-mobile-provider-reference-map.md`；worker 不直接编辑该共享文件。明确哪些行为复用、哪些因 NestJS/RuleExam 现状重写；不得打开或复制 `gooodwork/server/.env`。

- [x] **Step 2: 写迁移与手机号规范化失败测试**

```ts
expect(normalizeChinaMobile('138 0013 8000')).toBe('13800138000')
expect(() => normalizeChinaMobile('123')).toThrow()
```

迁移测试断言：重复非空手机号时迁移阻断；成功后 `phone` 唯一；`auth_session` 有 `client`、`auth_method`；`init.sql` 和实体一致。

- [x] **Step 3: 写短信与会话安全失败测试**

覆盖 6 位码、300 秒、60 秒重发、5 次验码、手机号日 10 次/IP 日 100 次、challenge 一次消费、停用/高权限拒绝、并发注册只建一个用户、PC/mobile Cookie 隔离、mobile 权限提升后失效、PC 强制改密不回归。

Debug Login 另测：默认关闭；生产环境配置为开启时启动失败；关闭时不查询/创建用户；开启后只接受测试夹具手机号和普通 `employee`；管理员、停用账号、非 employee 拒绝；签发真实 mobile access/refresh/session；重复请求不产生重复用户；新建学员仍为 `unverified` 且不得伪造实名行；日志只保留脱敏手机号。未实名的视频门槛由 T12 验收，开考门槛由 T13/T14 验收，T7 不依赖尚未实现的后续模块。

- [x] **Step 4: 运行测试确认失败**

Run:

```bash
cd server && npm test -- mobile-auth
cd .. && node --test tests/migration-contract.test.mjs
```

Expected: FAIL，缺少迁移、短信模块和 mobile 会话。

- [x] **Step 5: 实施迁移与统一手机号入口**

`018_mobile_auth.sql` 先报告/阻断历史重号，再增加唯一索引和 session 字段；后台创建、更新、导入、短信查询共用 `normalizeChinaMobile(input: string): string`。`PATCH /me/profile` 移除普通修改手机号能力。

- [x] **Step 6: 实施短信 Provider、challenge 和共用会话签发**

接口固定为：

```ts
interface SmsProvider { sendLoginCode(phone: string): Promise<{ providerRequestId: string }> }
class SmsChallengeService {
  issue(phone: string, ip: string): Promise<{ challenge_id: string; expires_in: 300; retry_after: 60 }>
  verify(challengeId: string, phone: string, code: string): Promise<void>
}
class SessionIssuerService {
  issue(user: SysUser, input: { client: 'pc'|'mobile'; authMethod: 'password'|'sms'|'debug'; ip: string|null; userAgent: string|null }, res: Response): Promise<TokenPair>
}
```

自动注册 `role=employee/source=external`，生成不可预测的内部 username 和随机密码摘要；管理员、非 employee 或拥有管理权限的用户拒绝短信登录。

配置读取复用 `gooodwork` 的变量名和默认阈值，但由 RuleExam `configuration.ts` 校验。运行时只接受 `SMS_PROVIDER=disabled|yunxin`；使用 `yunxin` 时，缺少 app key、app secret 或登录模板 ID 必须启动失败。自动化通过 Nest provider override 注入 `FakeSmsProvider`，不依赖环境 mock 开关。Provider 日志不得输出手机号全文、验证码、签名原文或供应商密钥。

实现 `debug-mobile-auth.controller.ts`，复用手机号规范化、账号关联和 `SessionIssuerService`，不自行构造 JWT。`SERVER_DEBUG_LOGIN_ENABLED` 默认 `false`；只有 test/development 可开启，production 开启直接拒绝启动。E2E 使用 Playwright browser context 请求该接口取得 HttpOnly mobile refresh Cookie，随后页面启动走正常静默 refresh；不在 mobile 页面添加 Debug Login 按钮。

- [x] **Step 7: 实施 client-aware 守卫与双 Cookie**

PC 保持 `ruleexam_refresh` + `/api/v1/auth`；mobile 使用 `ruleexam_mobile_refresh` + `/api/v1/mobile/auth`。移动 learner route 每次按数据库角色和有效权限复核；mobile SMS 不受导入初始密码阻断，PC 仍必须改密。

- [x] **Step 8: 运行认证 backend lane 独立检查**

Run:

```bash
cd server && npm run build && npm test
```

Expected: T7 后端单元和编译通过；短信测试替身只存在于测试进程且不输出验证码。`mobile-auth/training-access/training-identity` 由 root 合入模块与 suite、T8 候选完成后交 Gate E tester 运行；真实短信仍标记为用户手工未验。

- [x] **Step 9: 向 root 交付 mobile auth backend receipt**

返回 T7 独占文件、共享文件所需条目、测试结果和真实短信未验边界；worker 不提交。Gate E 通过后由 root 本地提交：`feat(auth): 增加学员短信登录与移动会话`。

执行记录（2026-10-22）：018 迁移、手机号规范化/唯一约束、网易云信 Provider、短信 challenge、共用 SessionIssuer、mobile/debug 控制器、PC/mobile 双 Cookie 与 client-aware 守卫已合入当前 `main` 工作区；生产开启 Debug Login、非法短信 provider、云信缺少必填配置均启动失败。后端全量 37 文件/418 项、迁移契约 38/38、server build 通过；`mobile-auth`、`training-identity`、`training-access` 均在自有临时 MySQL/Redis 环境通过。独立 reviewer 发现并关闭大小写路径绕过及 PC 本人资料仍提交 phone 两项 Important，03/04/07 与 02 配置总表已同步。真实云信送达/验码仍由用户手工验收，未读取或写入真实凭据。

### Task 8: 移动端短信登录、静默刷新和 401 单飞

**Files:**
- Create: `mobile/src/types/api.ts`
- Create: `mobile/src/api/client.ts`, `mobile/src/api/auth.ts`
- Create: `mobile/src/stores/session.ts`, `mobile/src/stores/learner.ts`
- Modify: `mobile/src/platform/session.ts`, `mobile/src/pages/auth/login.vue`, `mobile/src/App.vue`
- Test: `mobile/test/api-client.spec.ts`, `mobile/test/session-store.spec.ts`
- Test: `mobile/e2e/auth-session.spec.ts`

**Interfaces:**
- Consumes: Gate D、root 冻结的 Task 7 mobile auth DTO/Cookie/错误码契约、Task 2 `SessionTransport`；不等待 T7 全部实现即可进入 mobile lane。
- Produces: `request<T>()`、`refreshAccessTokenOnce()`、`sessionStore.bootstrap/login/logout()`，供后续所有 mobile API 使用。

- [x] **Step 1: 写请求与会话失败测试**

```ts
it('coalesces concurrent 401 responses into one refresh and replays each request once', async () => {
  const results = await Promise.all([client.get('/a'), client.get('/b')])
  expect(refreshCalls).toBe(1)
  expect(results).toHaveLength(2)
})

it('never persists access or refresh tokens', () => {
  expect(allStorageKeys()).not.toContain('access_token')
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm --prefix mobile run test:unit -- api-client session-store`

Expected: FAIL，API client 和 Store 尚未实现。

- [x] **Step 3: 实现统一信封、内存 token 和单飞 refresh**

`request<T>(config): Promise<T>` 统一处理 `{code,message,data}`；401 只 refresh 一次，每个原请求最多重放一次。启动时 `bootstrap()` 静默 refresh，失败才回登录。

- [x] **Step 4: 将静态登录页接入真实 API**

实现获取验证码倒计时、登录 loading、防重复、错误/过期/限流/网络失败；成功后进入首页，不强制跳实名。退出只清 mobile 会话和非考试状态。

- [x] **Step 5: 运行 mobile 登录 lane 独立检查**

Run:

```bash
npm --prefix mobile run test:unit -- api-client session-store
npm --prefix mobile run type-check
npm --prefix mobile run build:h5
```

Expected: T8 单元、类型和 H5 build 通过。首次外部注册、已有内部账号登录、刷新恢复、退出、停用/管理员拒绝及 PC 独立登录由 T7/T8 合入后的 Gate E tester 在冻结的当前 `main` 候选上验证。

自动化只用 Debug Login 建立后续业务会话；验证码登录页的倒计时、错误、过期、限流和网络失败通过前端单测/请求拦截验证，短信 challenge/provider 由 Task 7 后端测试验证。此处不要求 Agent 使用真实手机号或接收验证码；真实短信成功登录留到 Task 16 由用户手工验收。

- [x] **Step 6: 向 root 交付 mobile 登录 lane receipt**

返回 T8 独占文件和前端验证结果；与 T7 候选联调通过后由 root 本地提交：`feat(mobile): 打通短信登录与会话恢复`。

执行记录（2026-10-22）：移动请求信封、access 内存态、启动静默恢复、并发 401 单飞、短信发码/登录页和真实退出已接入；认证写入以串行队列消除 refresh/login/logout 的 HttpOnly Cookie 竞态，请求绑定 session epoch，旧账号迟到响应不得重放或污染新会话。移动端全量 119 项、类型检查、H5/MP-WEIXIN 构建及认证+静态 shell 39/39 通过；PC profile 回归 54/54、PC 类型检查和构建通过。独立 reviewer 的 4 项 Important 已全部关闭。MP-WEIXIN 编译仍报告 session/api client 循环 chunk 警告但成功产出，微信真机与真实短信未验。

### Task 9: 首页、课程和个人资料模块联调

**Files:**
- Create: `database/migrations/019_learner_profile.sql`
- Modify: `database/init.sql`, `server/src/entities/sys-user.entity.ts`, `docs/design/03-数据库设计.md`, `docs/design/04-API设计.md`
- Create: `mobile/src/api/courses.ts`, `mobile/src/stores/course.ts`
- Modify: `mobile/src/api/auth.ts`, `mobile/src/stores/learner.ts`
- Modify: `mobile/src/pages/home/index.vue`, `mobile/src/pages/course/{index,detail}.vue`, `mobile/src/pages/profile/{index,info}.vue`
- Modify: `server/src/modules/courses/course.controller.ts:183-222`, `course.service.ts`
- Modify: `server/src/modules/users/users.controller.ts:336-353`, `users.service.ts:229-252`
- Test: `server/test/course-lifecycle.spec.ts`, `server/test/training-student-admin-boundary.spec.ts`, `mobile/test/course-store.spec.ts`
- Test E2E: `tests/training-courses.mjs`, `tests/training-student-admin-boundary.mjs`

**Interfaces:**
- Consumes: Task 8 authenticated `request<T>()`；现有 `/me/home`、`/me/courses`、`/me/profile`。
- Produces: `courseStore.loadHome/list/detail()` 和受控 `learnerStore.updateProfile()`。

**Astra lanes:**
- `T9-server` 只修改 course/user read model、DTO 和后端/E2E 测试。
- `T9-mobile` 只修改 courses API、Store 和首页/课程/资料页面。
- root 先冻结课程 DTO，再在 Gate F 合并 profile 入口和联调证据。

- [x] **Step 1: 写课程可见性与受控资料失败测试**

断言：启用的 institution/external 学员都能浏览已发布课程；未实名和类别缺失仍可浏览；普通资料保存不能修改 phone/source/category/role/identity status。

- [x] **Step 2: 写 mobile Store 失败测试**

```ts
it('uses server identity/source/category as authoritative after profile save', async () => {
  await store.updateProfile({ gender: 'male' })
  expect(store.profile.source).toBe(serverProfile.source)
})
```

- [x] **Step 3: 运行目标测试确认失败**

Run:

```bash
cd server && npm test -- course-lifecycle training-student-admin-boundary
cd ../mobile && npm run test:unit -- course-store
```

Expected: external 可见性或受控字段断言失败。

- [x] **Step 4: 调整后端 learner read model**

课程列表/详情允许普通启用学员浏览所有已发布且业务可见的课程；source/category 只影响考试冻结，不在列表层误当管理权限。资料接口只接受头像、工种展示字段、性别、生日等普通字段。

- [x] **Step 5: 替换首页、课程和资料 fixture**

保留 fixture 只供 `routeCatalog` 静态预览；正常运行从 Store/API 取数据。实现分页、空态、失败重试、课程目录折叠和服务端进度展示。

- [x] **Step 6: 运行模块测试与浏览器交互**

Run:

```bash
cd server && npm run build && npm test -- course-lifecycle training-student-admin-boundary
cd .. && node tests/run-e2e.mjs --ephemeral --suite training-courses
cd mobile && npm run test:unit -- course-store && npm run build:h5
```

浏览器检查：首页 → 更多 → 课程列表 → 详情 → 返回；资料保存后权威字段不被本地覆盖。

- [x] **Step 7: 向 root 交付课程模块 receipts**

backend/mobile 两个 lane 分别返回精确文件和测试结果；Gate F 联调通过后由 root 本地提交：`feat(mobile): 打通首页课程与个人资料`。

执行记录（2026-10-22）：`019_learner_profile`、课程可见性 read model、GET/POST/PATCH 本人资料和移动端首页/课程/资料真实模式已合入当前 `main` 工作区；静态 `scenario` 仍保持 API-free。独立 reviewer 提出的保存响应覆盖新输入、静态预览返程进入真实 API、0.995 四舍五入提前宣告完成三项问题均以回归用例关闭；真实 banner/logo/cover/avatar 票据展示由 Gate G 明确承接。独立 Gate F：server 37 文件/450 项、迁移 38/38、`training-courses` 与 `training-student-admin-boundary` 隔离 E2E、mobile 139 项、H5/MP-WEIXIN 构建、浏览器 107/107、web 回归 54/54 与类型检查均通过。MP 构建仍有 session/learner/client 循环 chunk 警告；微信真机、真实短信与实名供应商未验。

### Task 10: 实名认证、私有材料和短期媒体票据后端

**Files:**
- Create: `database/migrations/020_identity_verification.sql`
- Create: `server/src/entities/learner-identity.entity.ts`, `identity-verification-session.entity.ts`
- Create: `server/src/modules/identity/identity.controller.ts`, `identity.dto.ts`, `identity-provider.ts`, `identity.service.ts`
- Create: `server/src/modules/media/media-ticket.service.ts`
- Create: `server/test/identity-verification.spec.ts`, `server/test/media-ticket.spec.ts`
- Create: `tests/mobile-identity.mjs`, `tests/mobile-media-ticket.mjs`
- Modify: `server/src/modules/media/{media-policy,media.controller,media.service}.ts`
- Modify: `server/src/modules/users/{users.controller,users.service}.ts`, `server/src/modules/auth/{mobile-auth.service,session-issuer.service}.ts`
- Root integrate: `database/init.sql`, `server/src/config/configuration.ts`, `server/src/app.module.ts`, `deploy/.env.example`, `tests/run-e2e.mjs`, `review/2026-10-22-mobile-provider-reference-map.md`

**Interfaces:**
- Consumes: Gate F、现有私有 media_asset/reference、Task 7 mobile learner identity。
- Produces: `GET /me/identity-verification`、图片上传/临时释放、`POST/GET identity-verification/sessions`、`MediaTicketService.issue/verify()`。

- [x] **Step 1: 向 root 提供 gooodwork 实名复用条目**

只读核对本计划“实名认证参考”列出的业务说明、session service、三图上传、腾讯编排与测试，把三图字段、图片大小/类型校验、OCR 正反面、FaceID 对比、错误归一、幂等查询、隐私日志和供应商重试边界作为 implementation receipt 条目交给 root，由 root 追加到参考映射。worker 不直接编辑共享文档，也不复制 gooodwork 的用户模型、表结构、会话接口或任何真实配置值。

- [x] **Step 2: 写实名迁移、状态机和证件唯一失败测试**

断言 `learner_identity.user_id` 唯一、`id_fingerprint` 唯一；状态为 `unverified|pending|verified|rejected`；相同三资产重放幂等；其他账号占用同一指纹时拒绝。

另断言 Debug Login 得到的测试学员仍从 `unverified` 开始。自动化使用仓库内不含真实姓名、证件号或人脸信息的合成测试图片，真实调用三图上传、媒体归属、实名 session、状态轮询和数据库绑定；`FakeIdentityProvider` 只替换腾讯 OCR/FaceID 的外部网络调用，不能直接修改用户实名字段或绕过 identity service。仓库、测试产物和截图不得保存真实身份证或正脸材料。

持久化 Provider 成功结果的 `provider_verified` 不受普通 10 分钟 session 过期清理影响；超时后的查询仍从本地结果完成绑定，不能重新调用 Provider。

同一用户同时只允许一个非终态实名会话；相同材料复用，不同材料并发不得另起 Provider。只有 verified/rejected/无结果 expired 后才允许新材料建立下一会话。

已有 verified 实名事实时禁止再次创建会话；绑定事务复核当前 session 与现有实名事实，迟到旧结果不得覆盖。测试包含两个实例以不同三图并发和旧结果晚到。

- [x] **Step 3: 写供应商成功但绑定失败的恢复测试**

```ts
it('replays a verified provider result without charging or binding twice', async () => {
  await expect(service.verify(sessionId)).rejects.toThrow('bind failed')
  await service.verify(sessionId)
  expect(provider.verifyCalls).toBe(1)
  expect(identityRowsFor(userId)).toHaveLength(1)
})
```

另测两个实例并发查询时只有一个数据库 claim 可执行 Provider；调用 lease 到期但没有持久结果时转 `provider_unknown` 并保持 API pending，不自动重调腾讯。

- [x] **Step 4: 写媒体票据失败测试**

覆盖错误用户、错误业务归属、asset 与 owner 没有精确 `media_reference`、签发后 reference/授权被撤销、篡改签名、过期、Range 视频读取；URL 不含 JWT 或真实磁盘路径。

另测临时实名图取消/替换/24 小时清理：只有 `identity_verification_user` 临时引用的材料可释放，活动 session 与已绑定实名材料保留；已实名 POST session 返回固定 409 并要求客户端 GET，不返回伪造 session。

- [x] **Step 5: 运行测试确认失败**

Run: `cd server && npm test -- identity-verification media-ticket`

Expected: FAIL，实体、Provider 和票据服务尚未实现。

- [x] **Step 6: 实施实名数据和 Provider 边界**

```ts
interface IdentityProvider {
  verify(input: IdentityProviderInput): Promise<{ status: 'verified'|'rejected'|'pending'; realName?: string; idNumber?: string; providerRequestId: string }>
}
```

运行时只支持 `disabled/tencent`；自动化通过 Nest provider override 注入 `FakeIdentityProvider`，业务路由和生产配置均无 mock 通过入口。保存证件密文和 HMAC 指纹；日志只记录 session/status/provider code，不记录证件、照片或密钥。

腾讯实现按两个显式 adapter 接入：身份证正反面走 `TENCENT_ID_CARD_OCR_*`，现场正脸与证件头像比对走 `TENCENT_FACEID_*`。两组 `ENABLED=true` 时都必须校验所需凭据并 fail-fast；长期 Key 和可选 STS Token 只从运行环境读取，敏感字段禁止进入对象 `toString`、异常消息或结构化日志。

- [x] **Step 7: 实施三图用途、业务归属和短期票据**

增加 `identity_id_portrait/identity_id_emblem/identity_face` 用途。票据 HMAC 绑定 asset/user/purpose/expiry；题目图片和视频只有业务授权通过后签发，内容接口继续支持 Range。

- [x] **Step 8: 运行实名 backend lane 独立检查**

Run:

```bash
cd server && npm run build && npm test -- identity-verification media-ticket
```

Expected: T10 后端单元和编译通过。`mobile-identity/mobile-media-ticket/training-media` 由 root 合入配置、路由、suite 和 T11 候选后交 Gate G tester 运行；真实腾讯 OCR/FaceID 保持未验，不用测试结果冒充。

- [x] **Step 9: 向 root 交付实名 backend receipt**

返回 T10 独占文件、共享配置条目、迁移一致性和测试结果；worker 不提交。Gate G 通过后由 root 本地提交：`feat(identity): 增加三图实名与媒体票据`。

执行记录（2026-10-22）：020 两张实名表、三图私有上传、持久 Provider 状态机、腾讯 OCR + `ImageRecognitionV2`、AES-GCM/HMAC 实名事实、精确媒体引用与短期票据、临时材料释放/24 小时清理均已合入当前 `main` 工作区；运行时仍只有 `disabled/tencent`，Fake 仅存在测试 bootstrap。独立 reviewer 提出的三项 P2 已关闭：tencent 在所有环境要求稳定实名密钥；停用/删除账号立即失去旧票据内容权限；disabled 不遮蔽 40960 权威事实或 `provider_verified` 本地恢复。返修后 server 43 文件/502 项、migration 39/39、`mobile-identity/mobile-media-ticket/training-media` 隔离 E2E 通过；真实 MySQL 并发验证一次 Provider claim 和 release/create 引用完整性，证据是单 API 进程并发而非双进程部署验证。真实腾讯、真实材料和生产部署仍未验，当前工作未创建 Git commit。

### Task 11: 移动端三图实名模块联调

**Files:**
- Create: `mobile/src/api/identity.ts`, `mobile/src/api/media.ts`, `mobile/src/stores/identity.ts`
- Modify: `mobile/src/platform/media-picker.ts`
- Modify: `mobile/src/pages/identity/{index,detail}.vue`, `mobile/src/pages/profile/index.vue`
- Modify: `mobile/src/pages/profile/info.vue`, `mobile/src/pages/home/index.vue`, `mobile/src/pages/course/{index,detail}.vue`, `mobile/src/components/course/CourseCard.vue`
- Test: `mobile/test/identity-store.spec.ts`, `mobile/test/media-picker.spec.ts`
- Test E2E: `mobile/e2e/identity-flow.spec.ts`

**Interfaces:**
- Consumes: Gate F、root 冻结的 Task 10 identity/media DTO、Task 8 API client、Task 2 `MediaPicker`；不等待 T10 全部实现即可进入 mobile lane。
- Produces: `identityStore.load/upload/createSession/poll()` 和 H5/MP-WEIXIN 媒体选择适配。

- [x] **Step 1: 写三图采集、查询和重试失败测试**

覆盖取消不上传、正脸只现场拍摄、三图未齐不提交、最多 12 次查询（首次立即、之后 800ms）、离页释放临时预览、旧响应不能覆盖新账号状态。完整场景先断言 Debug Login 后实名状态仍为 `unverified`，再走三图流程并刷新为 `verified`。视频门槛解除由 T12 验收，考试门槛解除由 T13/T14 验收，T11 只负责实名页面和权威状态刷新。

- [x] **Step 2: 运行测试确认失败**

Run: `npm --prefix mobile run test:unit -- identity-store media-picker`

Expected: FAIL，Store 与平台实现尚未接入。

- [x] **Step 3: 实现 H5 与 MP-WEIXIN media picker**

H5 使用文件/相机能力并明确权限失败；MP-WEIXIN 代码只需编译。业务页面不出现条件编译。

- [x] **Step 4: 将实名静态页接入真实状态机**

上传成功不等于实名成功；provider 成功后必须刷新 `GET /me/identity-verification` 得到 verified 才显示成功。失败按原因仅清理需重拍的图片。

同时接入 Gate G 冻结的短期媒体票据：证件处理预览只显示服务端受控图；已有头像与课程封面经 owner policy 签票展示；普通头像选择仍走 `purpose=avatar` 的既有上传与 profile 保存，上传成功不能绕过资料保存。公开 logo/banner 继续使用现有 branding 内容授权。视频票据留 Task 12，题图票据留 Task 13/14。

- [x] **Step 5: 运行实名 mobile lane 独立检查**

Run:

```bash
npm --prefix mobile run test:unit -- identity-store media-picker
npm --prefix mobile run type-check
npm --prefix mobile run build:h5
npm --prefix mobile run build:mp-weixin
```

Expected: T11 单元、类型及两端编译通过。主动进入、学习拦截进入、取消返回、pending 查询、失败重拍和成功刷新由 T10/T11 合入后的 Gate G tester 验证；记录真实供应商未验。

- [x] **Step 6: 向 root 交付实名 mobile receipt**

返回 T11 独占文件和浏览器验证结果；与 T10 联调及审查通过后由 root 本地提交：`feat(mobile): 打通三图实名认证`。

执行记录（2026-10-22）：移动端已接入三图采集/压缩/上传、权威状态加载、立即首查后每 800ms 最多 12 次查询、结构化重拍、40960 恢复、账号/离页 epoch 隔离、未提交材料释放、证件处理预览、头像保存、课程封面和票据续签。相机/相册打开期间不会被 `onHide` 误清，真正离页及异常回包会释放本地与未提交远端资产。最终 mobile unit 24 文件/177 项、type-check、H5/MP-WEIXIN build 通过；lane 浏览器 117/117，独立 Gate G 静态浏览器 92/92 及 PC 管理端 54/54 回归通过。MP 仍有既有 session/learner/client 循环 chunk 警告；真实 H5 相机、微信真机和真实供应商未验，当前工作未创建 Git commit。

### Task 12: 视频播放、媒体授权和服务端学习计时联调

**Files:**
- Create: `mobile/src/api/video.ts`
- Create: `mobile/src/stores/video.ts`
- Modify: `mobile/src/stores/course.ts`, `mobile/src/platform/media-player.ts`
- Modify: `mobile/src/pages/course/player.vue`, `mobile/src/components/course/VideoPanel.vue`
- Modify: `server/src/modules/video-learning/video-session.service.ts:103-289`, `video-learning.controller.ts:29-72`, `video-learning.dto.ts`, `coverage.ts`
- Modify: `server/src/modules/courses/course.service.ts`
- Modify: `server/src/modules/media/media.service.ts`
- Test: `server/test/video-coverage.spec.ts`, `mobile/test/video-session.spec.ts`
- Test E2E: `tests/training-video-learning.mjs`

**Interfaces:**
- Consumes: Task 9 课程详情；Task 10 media ticket；Task 11 实名状态。
- Produces: `VideoSessionClient.start/heartbeat/close()`、标准化播放器事件和服务端权威进度。

**Astra lanes:**
- `T12-server` 只修改课程/视频服务、DTO、控制器和服务端测试。
- `T12-mobile` 只修改 video API、课程 Store、播放器适配和播放页面。
- root 冻结 heartbeat/player 事件契约，Gate H1 才合并联调结果。

- [x] **Step 1: 写播放门槛和心跳失败测试**

断言：未实名/处理中不能签发视频票据或创建学习会话；类别缺失不额外阻止课程学习；external 与 institution 同按课程资格；buffering/background 不计时；30/45/2 秒/95% 参数不变。

- [x] **Step 2: 写前端事件映射失败测试**

```ts
it('reports buffering and background without playing credit', () => {
  expect(toHeartbeat('waiting', 12000)).toMatchObject({ state: 'buffering', position_ms: 12000 })
  expect(toHeartbeat('app-hide', 12000)).toMatchObject({ state: 'background' })
})
```

- [x] **Step 3: 运行目标测试确认失败**

Run:

```bash
cd server && npm test -- video-coverage
cd ../mobile && npm run test:unit -- video-session
```

Expected: 身份门槛或 adapter 测试失败。

- [x] **Step 4: 调整后端播放门槛并保留现有计时算法**

`start()` 先查权威实名和课程资格，再签发当前视频票据并创建单活跃学习会话；移除“必须 institution/category”这一过时硬编码，不改 `creditVideoInterval` 参数。

- [x] **Step 5: 实现播放器适配和页面联调**

播放/暂停/等待/错误/切后台转成统一状态；每 30 秒 heartbeat；断网仅显示组件 loading/重试，不新增离线下载或补时队列。

- [x] **Step 6: 运行视频测试和浏览器交互**

Run:

```bash
cd server && npm run build && npm test -- video-coverage
cd .. && node tests/run-e2e.mjs --ephemeral --suite training-video-learning
cd mobile && npm run test:unit -- video-session && npm run build:h5
```

浏览器验证目录切换、断点、缓冲、暂停、后台恢复、失败重试和服务端进度刷新。

- [x] **Step 7: 向 root 交付视频模块 receipts**

backend/mobile lane 分别返回精确文件和验证结果；Gate H1 通过后由 root 本地提交：`feat(mobile): 打通视频学习与服务端计时`。

执行记录（2026-10-22）：Video Contract v1 已冻结并通过独立契约审查。服务端完成 mobile employee 与实名门槛、external/institution/无类别同资格、当前版本短票、paused 初始锚点、稳定 `lesson_id/version_id` 课程进度及 learner-only 票据重查；30/45/2 秒与 95% 的 `creditVideoInterval` 语义未改。移动端完成原生 video、显式开播、断点、30 秒心跳、buffering 自然恢复、后台收口、票据续签、跨课时 start/close 串行、按 session 隔离心跳、结束后显式从 0 重播，以及课程/课时进度竞态保护。

独立 Gate H1 证据：server build 与 44 文件/526 项单测通过；`training-video-learning`、`mobile-media-ticket`、`training-media` 隔离 E2E 通过；mobile 26 文件/245 项单测、type-check、H5/MP-WEIXIN build、视频浏览器 8/8、Chrome 静态 92/92 通过；web build、vue-tsc 与 163/163 回归通过。server/mobile 独立复审均无未关闭 P0—P3。首次静态 Playwright 默认 bundled Chromium 缺失，改用本机 Chrome 后通过；`training-media` 的 aborted/清理失败日志来自套件故障注入并由后续断言验证恢复。真实视频解码、真实断网、微信开发者工具/真机、真实短信和腾讯实名仍未验。当前工作未创建 Git commit。

### Task 13: 改造考试后端为稳定 ID、整卷提交和 timeout 终态

**Files:**
- Create: `database/migrations/021_exam_stable_option_ids.sql`
- Create: `server/src/modules/questions/question-content.ts`
- Create: `server/test/exam-mobile-contract.spec.ts`
- Root integrate: `database/init.sql`
- Modify: `server/src/common/training-contracts.ts`
- Modify: `server/src/modules/questions/question-validator.ts`, `question-version.service.ts`, `question.dto.ts`
- Modify: `server/src/modules/exams/attempt.dto.ts`, `attempt.service.ts`, `attempt-reader.service.ts`, `answer-draft.service.ts`, `submission.service.ts`, `grading.service.ts`, `shuffle.service.ts`, `exam-history.service.ts`, `training-exams.controller.ts`
- Modify: `server/src/entities/question.entity.ts`, `question-version.entity.ts`, `exam-record-question.entity.ts`, `exam-answer.entity.ts`, `exam-record.entity.ts`
- Modify: `web/src/components/QuestionEditor.vue`, `QuestionPreview.vue`, `web/src/api/training-types.ts`
- Modify Test: `server/test/{question-bank,submission,answer-draft,attempt-policy,exam-history}.spec.ts`
- Modify E2E: `tests/training-question-bank.mjs`, `training-attempts.mjs`, `training-submissions.mjs`, `training-records.mjs`

**Interfaces:**
- Consumes: Gate G、现有不可变 attempt snapshot、确定性乱序、实名权威状态和题目媒体授权。
- Produces: `ReadonlyTiptapDoc`、稳定 option ID、`AttemptViewV2`、`SubmitAttemptRequest` 和不自动交卷的 timeout 状态机。

- [x] **Step 1: 写内容兼容和稳定 ID 失败测试**

断言：新题目只接受白名单 Tiptap JSON；legacy `{key,text}`/数字答案读取时转换为稳定 key ID，但不改写既有快照；乱序只改变显示顺序，不改变 option ID。

- [x] **Step 2: 写整卷契约失败测试**

```ts
expect(validateSubmission(allItems, [
  { item_id: 'i1', option_ids: ['B'] },
  { item_id: 'i2', option_ids: [] },
])).toEqual({ ok: true })
```

另测缺项、重复项、未知题目、错误选项、单选/判断多个 ID 均拒绝；在考响应不含答案、解析、server draft 或 `draft_revision`。

- [x] **Step 3: 写 deadline 竞态和幂等失败测试**

覆盖：截止前事务锁成功则提交；截止后请求转 timeout；重复相同/不同答案只返回第一次结果；timeout 分数 0、无 ExamAnswer、`submitted_at` 为空；heartbeat/read sweep 不评分草稿。

同时固定开考实名门槛：`unverified/pending/rejected` 学员不得创建 attempt 或取得题目快照，`verified` 学员按原资格规则开考；Debug Login 不能绕过该检查。T13 是服务端开考门槛 owner，T14 负责移动端提示和跳转，T16 复测完整拒绝/放行链路。

- [x] **Step 4: 运行考试目标测试确认失败**

Run:

```bash
cd server && npm test -- exam-mobile-contract submission attempt-policy question-bank
cd .. && node --test tests/training-attempts-race.test.mjs
```

Expected: FAIL，当前仍是下标答案、服务端草稿和 timeout 自动评分。

- [x] **Step 5: 实施 v2 内容与历史兼容适配**

新问题版本存受限 Tiptap JSON和稳定 option IDs；迁移新增兼容列，不重写旧版本 checksum。`question-content.ts` 负责 legacy → v2 只读转换；PC 编辑器改为生产同一 JSON，`checked` 只用于编辑正确性并在发布快照中转换为服务端答案 ID。

- [x] **Step 6: 实施 attempt 读取和整卷提交**

```ts
interface SubmitAttemptRequest {
  record_id: string
  answers: Array<{ item_id: string; option_ids: string[] }>
}
```

响应保持 `record_id/deadline_at/server_now/questions`；选项按显示顺序返回但保留 ID。training mobile controller 移除服务端 draft 依赖；评分按冻结 snapshot 的 ID 比较。

- [x] **Step 7: 将所有到期路径改成纯 timeout**

`in_progress → timeout` 使用条件更新；不保存/评分最后草稿，不创建答案，不把 `submitted_at` 当超时完成时间。恢复、heartbeat、任务清扫和错误文案都移除“自动交卷”。

- [x] **Step 8: 运行考试单元、E2E 和 PC 题库回归**

Run:

```bash
cd server && npm run build && npm test
cd .. && node tests/run-e2e.mjs --ephemeral --suite training-question-bank
node tests/run-e2e.mjs --ephemeral --suite training-attempts
node tests/run-e2e.mjs --ephemeral --suite training-submissions
node tests/run-e2e.mjs --ephemeral --suite training-records
cd web && npx vue-tsc --noEmit && npm run build && node --test tests/*.test.mjs
```

Expected: 全部 PASS；现有 PC 题库编辑/预览可用，但 PC 不出现学员答题入口。

- [x] **Step 9: 向 root 交付考试 backend/PC receipt**

返回 T13 独占文件、迁移条目、PC 回归和并发测试结果；worker 不提交。Gate H2 通过后由 root 本地提交：`feat(exam): 使用稳定选项 ID 和主动交卷终态`。

执行记录（2026-10-22）：Exam Contract v1 经独立审查后落地。021 仅新增兼容列并保持旧 checksum；题库支持受限 Tiptap JSON、稳定 option ID、legacy 快照只读适配；`/me` 考试改为 mobile employee + 实名门槛、整卷主动提交、锁后 deadline 仲裁和纯 timeout，移除服务端 draft/heartbeat。PC 删除学员答题路由/菜单/旧标签，管理题库、组卷和记录保留。独立 review 发现并关闭历史已评分 timeout、单连接池 recover、纯 timeout 统计、非安全 HTTP option ID、嵌套 HTML 段落五类边界，最终无未关闭 P0—P3。

最终证据：server build、47 文件/561 项单测、39 项迁移契约、`training-question-bank/attempts/submissions/records/full-flow/statistics` 隔离 E2E、真实 MySQL 并发/回滚/跨 deadline、PC 177/177、vue-tsc 与 build 通过。真实 `DB_POOL_SIZE=1` 未单独启动验证，以事务期禁止全局仓库回归覆盖；当前工作未创建 Git commit。

### Task 14: 移动端考试、草稿、结果、记录和错题联调

**Files:**
- Create: `mobile/src/api/exams.ts`, `mobile/src/stores/exam.ts`
- Create: `mobile/src/utils/exam-draft.ts`, `mobile/src/utils/server-clock.ts`
- Modify: `mobile/src/platform/navigation.ts`
- Modify: `mobile/src/pages/exam/{index,instructions,take,result,review}.vue`
- Modify: `mobile/src/pages/profile/{exam-history,wrong-book}.vue`
- Modify: `mobile/src/components/exam/**/*.vue`, `mobile/src/components/rich-content/ReadonlyRichContent.vue`
- Test: `mobile/test/exam-store.spec.ts`, `exam-draft.spec.ts`, `server-clock.spec.ts`
- Test E2E: `mobile/e2e/exam-flow.spec.ts`

**Interfaces:**
- Consumes: root 冻结的 Task 13 `AttemptViewV2`、开考实名门槛和整卷提交契约；Task 8 API client；Task 10 媒体票据。不等待 T13 全部实现即可进入 mobile lane。
- Produces: 本地最小草稿、服务端时钟倒计时、防误退出、主动交卷、结果/历史/错题完整移动闭环。

- [x] **Step 1: 写草稿隔离和损坏恢复失败测试**

```ts
it('stores only answers, currentIndex and savedAt under user+attempt key', async () => {
  await saveDraft('u1', 'a1', draft)
  expect(await loadDraft('u2', 'a1')).toBeNull()
  expect(Object.keys(await loadDraft('u1', 'a1')!)).toEqual(['answers', 'currentIndex', 'savedAt'])
})
```

损坏/缺失返回 null；终态清理；普通 401 不先删除草稿。

- [x] **Step 2: 写时钟、恢复和主动交卷失败测试**

断言使用 `deadline_at/server_now` 校准；倒计时归零只锁定并查询状态；页面内断网继续改答案；刷新后离线不能恢复题目；重进只恢复原 record；未答题生成空数组；不出现自动 submit 调用。

- [x] **Step 3: 运行测试确认失败**

Run: `npm --prefix mobile run test:unit -- exam-store exam-draft server-clock`

Expected: FAIL，Store 与工具尚未接入真实 API。

- [x] **Step 4: 实现开考、恢复和本地草稿**

每次答案变化立即 `uni.setStorage` 整份快照，onHide/onUnload 再补存；完整题目只在内存。恢复先查服务端，再合并同用户同 attempt 草稿；损坏时以空答案继续，不重抽题、不延时。

- [x] **Step 5: 实现防误退出和主动整卷提交**

退出/浏览器返回/小程序返回尽可能确认；用户确认可离开。交卷二次确认后构造全部题目数组，未答传 `[]`；结果不明先查询 record 状态，只有仍进行且未截止才重试相同 payload。

- [x] **Step 6: 接入结果、解析、记录和错题**

终态后才加载答案/解析；timeout 显示“超时未交卷”；结果、历史、解析和错题使用同一冻结版本。受控图片通过 media ticket 渲染。

- [x] **Step 7: 运行考试 mobile lane 独立检查**

Run:

```bash
npm --prefix mobile run test:unit -- exam-store exam-draft server-clock rich-content
npm --prefix mobile run type-check
npm --prefix mobile run build:h5
```

Expected: T14 单元、类型和 H5 build 通过。开考 → 单/多/判断/图片题 → 答题卡 → 断网继续 → 误退出恢复 → 主动交卷 → 结果，以及 deadline 到期不提交，由 T13/T14 合入后的 Gate H2 tester 验证。

- [x] **Step 8: 向 root 交付考试 mobile receipt**

返回 T14 独占文件、本地草稿和浏览器关键链验证结果；与 T13 联调及审查通过后由 root 本地提交：`feat(mobile): 完成考试与复盘闭环`。

执行记录（2026-10-22）：mobile 已接入考试列表/开考/恢复、服务端时钟、最小本地草稿、主动整卷提交、结果不明仲裁、纯 timeout、结果/记录/错题和题图短票；静态 scenario 与生产组件隔离。独立 review 发现并关闭跨考试 flight、同题多图错误、解析图重试及多选部分分显示四类问题，最终无未关闭 P0—P3。

最终证据：mobile 32 文件/291 项单测、type-check、H5/MP-WEIXIN build、Chrome 52/52 通过，其中 33 个设计场景零 API。真实后端浏览器完整链、微信开发者工具/真机、真实短信/腾讯实名和真实弱网仍未验；当前工作未创建 Git commit。

---

## Phase 4：组合打包与关键链路验收

### Task 15: 统一 web/h5 构建、Docker 和 Nginx 部署

**Files:**
- Create: `scripts/build.mjs`, `scripts/build-lib.mjs`, `tests/build-orchestrator.test.mjs`, `Dockerfile`
- Modify: `web/vite.config.ts`, `mobile/vite.config.ts`
- Modify: `docker-compose.yml`, `deploy/nginx/default.conf`
- Root integrate: `.gitignore`, `README.md`, `AGENTS.md`
- Remove after replacement: `web/Dockerfile`

**Interfaces:**
- Consumes: Gate H1、Gate H2、Task 1 记录的真实 H5 构建目录和现有 web Vite 构建。
- Produces: `parseBuildTargets()`、`assembleRelease()`、`atomicPublish()` 和三条约定命令。

- [x] **Step 1: 写构建参数与产物保护失败测试**

```js
test('web-only build preserves dist/mobile', async () => {
  await assembleRelease({ targets: ['web'], existingDist, webOutput })
  assert.equal(await read('dist/mobile/keep.txt'), 'mobile')
})

test('failed combined build leaves current dist byte-identical', async () => {
  const before = await hashTree('dist')
  await assert.rejects(() => runBuild(['web', 'h5'], { failH5: true }))
  assert.equal(await hashTree('dist'), before)
})
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test tests/build-orchestrator.test.mjs`

Expected: FAIL，构建库和脚本尚不存在。

- [x] **Step 3: 实现临时编译、staging 和原子发布**

```ts
parseBuildTargets(argv: string[]): Array<'web'|'h5'|'mp-weixin'>
assembleRelease(input: AssembleInput): Promise<string>
atomicPublish(stagingDir: string, distDir: string): Promise<void>
```

`web`、`h5` 先编译到同文件系统临时目录；单端构建从旧 dist 复制未构建端；组合构建只在两端成功后组装；校验两个 `index.html` 后 rename 切换，失败回滚。

- [x] **Step 4: 让两个 Vite 配置接受脚本输出目录**

`web/vite.config.ts` 不再无条件清空根 dist；`mobile/vite.config.ts` 固定 H5 base `/mobile/`。根脚本根据 Task 1 的真实产物目录复制到 `dist/mobile/`。

- [x] **Step 5: 改造容器和 Nginx**

Docker context 改仓库根，Node build stage 使用 Node 22、分别 `npm ci` 后运行组合构建。Nginx 增加 `/mobile/assets/` 缓存和 `/mobile/` 正确入口，禁止错误回退 PC `index.html`；保留 `/api/v1/` 代理和安全头。

- [x] **Step 6: 运行构建单测和三种构建模式**

Run:

```bash
node --test tests/build-orchestrator.test.mjs
node scripts/build.mjs web
node scripts/build.mjs h5
node scripts/build.mjs web h5
test -f dist/index.html
test -f dist/mobile/index.html
```

Expected: 全部退出码 0；单端互保测试通过；组合目录同时包含 PC/H5；MP-WEIXIN 单独构建不进入网站 dist。

- [ ] **Step 7: 构建 Docker 镜像并检查静态路由（本机无 Docker，未执行）**

Run: `docker compose build nginx`

Expected: 镜像构建成功；容器内有 `/usr/share/nginx/html/index.html` 和 `/usr/share/nginx/html/mobile/index.html`。若本机无 Docker，验收记录必须标“未执行”，不能以本地 build 替代。

- [x] **Step 8: 向 root 交付统一构建 receipt**

返回精确文件、待删除文件、三种构建模式和 Docker 证据；root 复核删除目标与 staged diff 后本地提交：`build: 统一 PC 与 H5 组合发布`。

执行记录（2026-10-22）：统一构建已实现 `web`、`h5`、`web h5` 和独立 `mp-weixin`；网站构建使用同盘临时目录、入口校验、单端互保、构建锁和原子切换，失败回滚不改现有 dist。SIGINT/SIGTERM 会等待编译进程组，发布临界区完成或回滚后清锁；Docker 改为根 context + Node 22，Nginx `/mobile/` 不回退 PC，H5 无内联脚本并满足 CSP。

最终证据：构建编排/Compose/CSP 20/20，四种真实构建通过，MP 前后网站哈希一致，双入口与 `/mobile/` 资源/图标存在；独立 review 的 1 项 P1、2 项 P2 已关闭，无未关闭 P0—P3。Docker CLI 本机不存在，镜像构建、容器内文件及真实 Nginx 响应头未执行，不能以 YAML/构建静态检查替代；当前工作未创建 Git commit。

### Task 16: 关键考试链路 E2E、全量回归和验收记录

**Files:**
- Create: `tests/mobile-h5.mjs`, `mobile/e2e/critical-exam.spec.ts`, `mobile/e2e/critical-timeout.spec.ts`
- Create: `review/2026-10-22-learner-mobile-h5-acceptance.md`
- Modify: `mobile/playwright.config.ts`
- Root integrate: `tests/run-e2e.mjs`
- Report only: T16 不直接修改 Tasks 7—15 的实现文件；失败交回原 lane owner，root 重新集成候选并使相关证据失效重跑。

**Interfaces:**
- Consumes: 完整 H5、仅测试环境可用的 Debug Login、测试进程内 `FakeIdentityProvider`、隔离数据库、组合 dist。
- Produces: `mobile-h5` 注册套件、浏览器关键链路证据和最终分级验收记录。

- [x] **Step 1: 写关键链路 E2E 并确认先失败**

Playwright 用约 390×844 视口覆盖：

```text
Debug Login 关联/创建测试学员并签发真实 mobile 会话
  → 进入首页
  → 浏览课程详情
  → 断言未实名时视频/考试仍受限
  → 测试替身返回实名通过
  → 开考
  → 单选/多选/判断/图片题
  → 本地草稿与一次刷新恢复
  → 主动确认交卷
  → 冻结结果/解析/记录/错题
```

另一个场景覆盖 deadline 到期：不发 submit、服务端 timeout、迟到答案拒绝。

Run: `node tests/run-e2e.mjs --ephemeral --suite mobile-h5`

Expected: 初次 FAIL，suite 尚未注册或关键页面尚有集成缺口。

- [x] **Step 2: 注册 `mobile-h5` 并只修复关键链路阻塞**

复用 `tests/support/training-harness.mjs` 启动隔离 API、MySQL、Redis，显式开启 Debug Login，并仅在测试进程覆盖实名 Provider；启动构建后的 H5 静态服务。Playwright browser context 先调用 Debug Login 获得真实 mobile refresh Cookie，页面再走正常 bootstrap/refresh。不要把真实短信、OCR/FaceID 当自动化依赖，也不要给生产运行时增加测试旁路或 mock 模式。

- [x] **Step 3: 运行移动端、后端和 PC 针对性验证**

Run:

```bash
npm --prefix mobile run test:unit
npm --prefix mobile run type-check
npm --prefix mobile run build:h5
npm --prefix mobile run build:mp-weixin
cd server && npm run build && npm test
cd ../web && npx vue-tsc --noEmit && npm run build && node --test tests/*.test.mjs
cd .. && node tests/run-e2e.mjs --ephemeral --suite mobile-h5
node tests/run-e2e.mjs --ephemeral --suite training-full-flow
node tests/run-e2e.mjs --ephemeral --suite smoke
node scripts/build.mjs web h5
```

Expected: 全部 PASS；最终存在 `dist/index.html` 和 `dist/mobile/index.html`。

- [x] **Step 4: 运行全量隔离 E2E**

Run: `node tests/run-e2e.mjs --ephemeral --suite all`

Expected: 注册套件逐个隔离且全部 PASS。若耗时测试失败，按原套件精确复现，不跳过或改用开发库。

- [ ] **Step 5: 由用户完成真实短信验收，用户/运维完成真实实名验收（NOT RUN / 未执行）**

本轮未执行真实网易云信短信或腾讯 OCR/FaceID 验收；以下保留为后续人工验收步骤，不计入 Gate J 自动化通过结论。

真实值只通过部署环境或密钥管理系统注入，命令行、shell history、`.env.example`、测试夹具和验收文档都不得出现值。执行者不从 `gooodwork/server/.env` 读取或复制密钥。

按以下顺序验收并在记录中分开标记：

1. 网易云信由用户手工验收：用户在 H5 页面亲自输入手机号、点击发送、查看手机短信并亲自输入验证码，确认成功进入首页。Agent 不索要、不接收、不保存、不代填手机号或验证码；只记录用户给出的通过/失败结论和必要的脱敏错误信息。
2. 腾讯身份证 OCR 由用户或获明确授权的测试人员在 H5 页面亲自选择身份证正反面并提交，检查正反面颠倒、模糊图和服务异常不会误判通过。Agent 不索要、接收、下载或保存证件图片、姓名和证件号。
3. 腾讯 FaceID 由同一测试人员在 H5 页面亲自拍摄现场正脸，完成成功和不匹配场景，检查最终 `verified/rejected` 来自后端权威状态。Agent 只记录脱敏结论，不接触原图。
4. 回归启动校验：启用供应商但缺失任一必需变量时 fail-fast；禁用时不发起外网调用。

现在的计划和开发阶段不需要用户提前提供真实物料。只有功能、隐私保护和供应商配置均准备完成后才安排上述人工验收；若届时没有凭据或授权测试人员，保持该项 `not run`，不得阻塞自动化结论，也不得写成真实供应商通过。

- [ ] **Step 6: 完成真实浏览器验收记录（NOT RUN / 未执行）**

本轮仅完成桌面 Chrome；以下移动设备浏览器、微信、视频解码/弱网与相机权限验收均未执行。

至少记录 iOS Safari、Android Chrome、微信内置浏览器的执行/未执行状态；重点复测短信表单、视频全屏/缓冲、答题固定栏、误退出、断网、deadline、重复交卷。真实网易云信、腾讯 OCR/FaceID、Docker、真机分别列证据，不以测试替身、构建或桌面模拟代替。

- [x] **Step 7: 检查最终差异和文档一致性**

确认 `docs/design/`、迁移、`init.sql`、entities、API 类型和计划字段完全一致；扫描仓库没有真实验证码、Token、手机号、证件号或供应商密钥；确认没有意外修改 `.pen` 或无关业务。

- [x] **Step 8: 向 root 交付最终验收 receipt**

返回最终测试矩阵、人工验收状态、精确文件和未验证边界；当前集成保留在 `main` 工作区，未创建 Git 提交。

执行记录（2026-10-22）：Task 16 / Gate J 的自动化与桌面 Chrome 验收已通过。最终 `--suite all` 21/21 注册套件逐个隔离通过；mobile 34 文件 / 313 项、server 47 文件 / 574 项及 build、web 177 项、两端类型检查通过；H5、MP-WEIXIN、PC 与统一 `web h5` 构建通过。`mobile-h5` 分别通过 timeout 1/1 和主链 1/1，覆盖真实 mobile 会话、课程详情、未实名门槛、三张合成图经测试 Provider 绑定、三类题型/题图、本地草稿刷新恢复、主动交卷、结果/解析/记录/错题和跨 deadline 不自动提交；本关键 E2E 每题均作答，不作为未答题空数组的覆盖证据。Playwright 子进程信号回收 5/5，普通 mobile E2E 默认排除两份 critical 文件。

最终导题修复统一 preview 与 v2 入库内容的规范化重复指纹，并仅逐行隔离存量题的 `BizError 40001` 内容异常；定向 31/31、隔离 `training-question-import` 和独立 review 均通过，最终 21/21 全量再次覆盖。验收细节见 [最终验收记录](../../../review/2026-10-22-learner-mobile-h5-acceptance.md)。真实短信、腾讯 OCR/FaceID、iOS/Android/微信真机、视频解码/弱网/相机权限、Docker/Nginx 运行与生产部署均未执行；Step 5/6 及 Task 15 的 Docker 检查保持未勾选。当前工作未创建 Git commit。

---

## Self-Review Result

- **Spec coverage:** 设计 1—17 节均映射到 Tasks 1—16；H5 是首期交付，MP-WEIXIN 只在 Tasks 1、2、5、11、16 做编译兼容，没有扩大为真机交付。
- **Workflow match:** Task 1 先取官方最新底座并运行/打开；Task 2 再装依赖；Tasks 3—6 先完成全部静态页面和 Pencil 视觉门；Tasks 7—14 再按登录、课程、实名、视频、考试逐模块联调；Tasks 15—16 最后打包和关键链路 E2E。外层 Gate 保持这个顺序，Gate 内按冻结契约并行，不提前进入未放行阶段。
- **Astra orchestration:** T4∥T5；T7∥T8；T9 server∥mobile；T10∥T11；T12 server∥mobile 与 T13∥T14 进入容量受限 ready queue。按用户最新决定直接在当前 `main` 集成，不使用 worktree；root 独占共享文件/Git，通过严格文件归属、Gate 冻结和两次 receipt 保证 tester/reviewer 读取稳定候选。
- **Provider readiness:** Task 7 参考 `gooodwork` Debug Login，让自动化以真实 mobile Token/session 进入业务链路；短信 provider 只做后端自动测试，真实短信由用户在 H5 手工验收。Task 10 的实名自动化只在测试进程注入 Fake Provider；运行时代码无 mock 模式。Task 16 将自动化、真实云信、真实腾讯 OCR/FaceID 分级验收，真实 Key 只由用户/运维安全注入。
- **Type consistency:** `record_id`、`item_id`、`option_ids`、`ReadonlyTiptapDoc`、`ExamAnswers`、`ruleexam_mobile_refresh` 在前后任务中保持同名；没有保留下标答案契约。
- **Review Focus coverage:** 六项风险分别由 Tasks 7、8、10、13、15、16 的明确测试覆盖。
- **Proportion:** 计划固定接口、文件、测试和验收门，不内嵌业务实现函数体；实现者仍需按测试编写代码。

## Official Initialization References

- DCloud uni-app CLI：`https://uniapp.dcloud.net.cn/quickstart-cli`
- DCloud CLI 构建命令：`https://uniapp.dcloud.net.cn/worktile/CLI.html`
- DCloud 官方模板：`https://github.com/dcloudio/uni-preset-vue/tree/vite-ts`
- Wot UI v2 快速上手：`https://v2.wot-ui.cn/guide/quick-use.html`

