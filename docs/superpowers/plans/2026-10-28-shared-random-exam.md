# 公共题库、随机试卷与考试 Tab 通用二维码实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 按用户指定的 astra-workflow 编排依赖与并行，步骤使用复选框记录。

**Goal:** PC 可配置公共随机卷；同一个考试 Tab 通用二维码与直接打开小程序共用入口；本机构抽简单题、外来抽困难题，每次独立题单，默认每卷每人 3 次，工种不再构成门槛。

**Architecture:** 复用现有试卷发布快照、ExamAssignment、ExamRecord 和 ExamRecordQuestion。新增公共题池范围而不改写旧发布版本；先冻结接口再并行实现，根智能体串行集成共享文件和迁移。扫码只导航，不授权、不绑定试卷、不启动考试。

**Tech Stack:** Node ≥22、NestJS/TypeORM/MySQL 8/Redis、Vue 3/Element Plus、uni-app/Wot UI、Vitest、现有隔离 E2E。

**Spec:** `docs/superpowers/specs/2026-10-28-shared-random-exam-design.md`，以第6节最新的“通用二维码打开考试 Tab”为准。

## 执行收口（2026-10-28）

以下为最终执行状态，下方逐步清单保留原计划以供复现；验收证据以 `review/2026-10-28-shared-random-exam-acceptance.md` 为准。

- [x] T1：公共范围契约、042迁移、init/entity同步与真实隔离迁移回归。
- [x] T2：公共题池、两难度容量校验、发布冻结及全局有序锁题。
- [x] T3：类别解耦、来源难度、每次题单、恢复计次、冻结次数摘要与耗尽状态。
- [x] T4：PC/H5录入和实名链路工种可选。
- [x] T5：PC随机规则/分值/次数与通用二维码。
- [x] T6：Tab登录回跳、选卷实名回跳、刷新换账号重新加载。
- [x] T7：公共统计、空类别显示和冻结历史兼容。
- [x] T8：1000题实际导入、100/80题卷、真实PC/H5、回归构建与独立审查。真实手机/小程序真机/真实供应商/生产部署明确未验，不冒充完成。

按Astra完成独立文件分工、模块审查和最终整体验收。审查发现的发布锁顺序、账号刷新列表重载、次数耗尽UI三项均已修复并复审通过。全部工作保留当前main本地提交，未推送；未改开发库或生产库。

## Global Constraints

- 用户已授权当前main分支实施；开发库/生产库升级、部署和远程推送未包含在本次授权内。迁移运行限本次隔离测试环境。
- 题量/分值由随机规则配置，默认100道100分；每卷每人默认3次，次数1—100；每题型最多500道、总分0.01—999.99、时限1—1440分钟。
- 题库题目无分值；rules 使用整数 `score_cents`；总题数是 rules.count 之和，不新增重复存储字段。
- 仅开始事务成功占一次；超时占一次且不评分；刷新恢复同一记录、顺序、截止时间；提交幂等。
- 保留来源服务端判定、实名、账户权限、媒体授权及反答案泄漏约束；不为测试增加运行时放行接口。
- 历史发布/归属不可变。设计中的“首次归属冻结版本、难度、规则”和默认100道单选、30分钟、60分及格属于实施建议，执行前与完整设计一起确认。
- 迁移新增顺序号，不改历史 checksum；同步 `database/init.sql`、entities、设计03册。执行前重新检查最新迁移号，本文拟用042。
- 所有测试数据库使用隔离 harness，禁止指向开发库；保护工作区已有预约/支付草稿改动。
- 真实供应商与手机扫码另验，不把编译/桌面测试写成真实业务通过。

## Review Focus

1. 多设备同时开考、请求成功但响应丢失：只计一次且恢复同一题单（T3）。
2. 撤回再发布、首次开考后改变来源：不静默重置额度、难度或历史（T3）。
3. 新注册无工种、批量导入空类别：可完成实名并进入考试，不赋予管理权限（T4）。
4. 登录/实名途中切账号、恶意 return URL：不串题单、只接受站内受控目标（T6）。
5. public 类别为null以及零场/多场考试：页面/统计不崩溃，通用二维码仍有效（T5/T7）。

## Astra 分工、文件归属与交付门

根智能体负责架构、契约、迁移号、冲突裁决和最终验证；worker 只写任务允许路径，tester 运行隔离验证，独立 reviewer 审查固定候选差异。使用当前环境角色配置，不在计划中强制覆盖模型或修改用户配置。

```
G0 设计确认与基线 → T1 契约/迁移（串行）
                          ↓
          ┌ T2 题池发布 → T3 开考恢复 ┐
          ├ T4 工种可选               ├→ T7 统计 → T8 集成验收
          └ T5 PC配置与二维码         ┘              ↑
                 T4 完成 → T6 H5导航/回跳 ──────────┘
```

T2/T3 由同一后端 worker 顺序完成；T4 由学员资料 worker 完成；T5 由PC worker完成，可三路并行。T6 涉及 T4 使用的登录、onboarding、实名文件，必须接在 T4 后，由该 worker 继续或明确交接。T7 等待后端和类型稳定，不能与相关统计文件修改重叠。每批受实际并发额度限制，不强求固定代理数。

共享文件只由 root 写：`server/src/common/training-contracts.ts`、`web/src/api/training-types.ts`、公共 DTO 合同、`database/init.sql`、迁移、`tests/run-e2e.mjs`、package manifests/lockfiles、部署模板和设计分册。worker 提交精确补丁建议，root 在阶段边界应用；不得各分支独立安装依赖或抢占同一个迁移号。

每次委派传入目标、批准设计、起始commit、输入接口、允许文件、禁止范围、测试命令、交付格式。交付包含commit/差异、测试命令与退出码、未验项。独立工作在各自worktree/隔离分支执行，root集成前检查用户脏文件，不使用整树暂存或强制推送。

计划编写时 `astra-workflow` 引用的 `.codex/skills/superpower/references/ddd-governance.md` 不存在；不虚构门禁已就绪。按本项目 NestJS 既有模块 owner 交接，实施前 root 核对当前有效审查规范；找不到公共 reviewer 文档时在委派中显式传入本仓库 AGENTS、设计、候选文件和测试证据。此缺项不阻塞本方案编写。

## T1：冻结公共随机卷契约与兼容迁移（root，串行）

**Files:** 新增 `database/migrations/042_public_random_paper.sql`、`tests/public-random-paper-migration.test.mjs`；修改 `database/init.sql`、`server/src/entities/exam-paper.entity.ts`、`server/src/entities/paper-release.entity.ts`、`server/src/common/training-contracts.ts`、`server/src/modules/exams/paper.dto.ts`、`web/src/api/training-types.ts` 以及设计03/04册。

**Interfaces:** `PoolScope = 'category' | 'public'`；试卷/发布版本保存 `poolScope`，API 使用 `pool_scope`；summary/detail 的 `category_id: Id | null`。旧请求缺省 category；新PC随机卷显式 public，public 仅允许 training+random，类别统一null；category卷继续要求有效类别。新卷不提供模式互转。旧已发布版不回填 public。

- [ ] 编写迁移与DTO失败用例：旧行默认category、public random类别null可接受、public fixed与非法枚举拒绝、旧category缺类别拒绝、迁移重跑不破坏数据。
- [ ] 运行 `node --test tests/public-random-paper-migration.test.mjs`，确认缺少新协议导致失败。
- [ ] 增加两表的 `pool_scope VARCHAR(16) NOT NULL DEFAULT 'category'`，发布复制该字段；类型明确区分public与category，保留发布快照读取旧值默认category。既有category_id已可空，无需删列。
- [ ] 修改DTO允许条件可空；业务层再次校验组合。冻结 `rules: {type:'single'|'multiple'|'judgment',count:number,score_cents:number}[]` 和 `max_attempts` 接口。
- [ ] 运行迁移测试及 `npm --prefix server run build`；在隔离MySQL验证升级/重复执行/init建库结构一致。
- [ ] 仅暂存本任务明确路径，中文提交 `feat(考试): 增加公共随机题池范围契约`；把接口与commit交给T2/T4/T5。

## T2：公共题池、随机规则保存和发布（后端worker）

**Files:** 修改 `server/src/modules/ai/paper.service.ts`、`server/src/modules/exams/paper-release.service.ts`、`server/src/modules/questions/question-version.service.ts`、`server/src/modules/exams/paper-learning.ts`；新增 `server/test/public-random-paper.spec.ts`，扩展 `server/test/paper-release.spec.ts`。

**Interfaces:** 复用 createTraining/updateTraining、publish/get，输入T1协议；public取全部类别中合法当前题目版本，category保留原过滤。发布返回现有版本信息及pool_scope；不增加扫码授权接口。

- [ ] 添加 `public_pool_uses_enabled_questions_across_categories`、`both_difficulties_must_satisfy_each_rule`、`score_total_must_match` 用例，断言100×100分币=10000、80题可配10000、easy/hard任一题型不足拒绝、停用/删除题不入池。
- [ ] 运行 `npm --prefix server test -- test/public-random-paper.spec.ts test/paper-release.spec.ts`，确认新行为未实现时失败。
- [ ] 实现范围分支和公共候选查询；public不通过伪造默认类别绕过约束，移除与类别相关的课程/制度候选假设。公共卷本期不接受隐藏的regulation_ids限制；考前学习仍显式配置课程，public可关联任意符合原有效性规则的课程。
- [ ] 发布时按easy/hard×题型分别验证数量，返回结构化缺题信息；冻结候选池、规则、媒体引用。保存默认max_attempts=3且服务端验证1—100。
- [ ] 重跑定向测试，补旧category随机卷、固定卷发布和历史版本读取回归；只提交任务路径 `feat(考试): 支持公共题池随机组卷发布`。

## T3：考试可见性、来源难度、次数与恢复（同后端worker，依赖T2）

**Files:** 修改 `server/src/modules/exams/attempt.service.ts`、`server/src/modules/exams/learner-exam-summary.ts`；按需修改现有attempt状态函数；新增 `server/test/public-random-attempt.spec.ts`，扩展 `server/test/exam-history.spec.ts`、`server/test/exam-mobile-contract.spec.ts`；新增 `tests/public-random-exam.mjs`（root注册suite）。

**Interfaces:** 复用 start/list 和现有考试DTO；source来自数据库；每次新ExamRecord抽样并保存ExamRecordQuestion，既有ExamAssignment保存首次冻结版本/规则。列表按已发布培训卷和个人归属合并，不匹配学员工种；旧制度入口保持隔离。

- [ ] 添加测试：同一public卷institution=easy/external=hard；空工种可开考；缺来源拒绝；前端传来源无效；三次成功开始后第四次拒绝。
- [ ] 添加并发/恢复测试：两个同时start只创建一条记录；响应丢失重试恢复同id和题单；超时计次但不评分；再次开考创建新record并调用抽样，不断言两次题目必然不同。
- [ ] 定向运行新测试确认失败，再移除培训类别开考条件；public assignment允许categoryId=null；旧category发布的历史有效性处理保留，但不比较当前学员工种。
- [ ] 保留锁、幂等提交、截止时间、真实身份校验；测试重新发布及用户来源变更不重写已冻结归属，未开始用户使用新版本；达到及格分不额外禁考。
- [ ] 验证 `npm --prefix server test -- test/public-random-attempt.spec.ts test/exam-history.spec.ts test/exam-mobile-contract.spec.ts`；root注册后执行 `node tests/run-e2e.mjs --ephemeral --suite public-random-exam`，预期全部断言通过且清理临时服务。
- [ ] 提交 `feat(考试): 放开工种限制并验证独立重考题单`。

## T4：学员工种可选贯通（资料worker，可与T2/T5并行）

**Files:** 修改 `server/src/modules/users/users.controller.ts`、`users.service.ts`、`server/src/modules/imports/import-batch.service.ts`、`server/src/modules/identity/identity.service.ts`；修改PC学员录入/导入组件（派发前通过图谱解析确切路径并锁定allowlist）；修改 `mobile/src/utils/learner-onboarding.ts`、`mobile/src/pages/profile/info.vue`、`mobile/src/components/profile/TrainingCategoryField.vue`、`mobile/src/components/exam/LiveExamCenter.vue`；扩展 `server/test/learner-training-category.spec.ts`、`mobile/test/learner-onboarding.spec.ts`、`mobile/test/learner-training-category.spec.ts`。

**Interfaces:** 新建/导入缺category_id归一为null；编辑省略保留旧值，显式null允许管理员清空；有效ID仍校验。H5仍使用现有独立工种确认接口；未填允许保存，已填的锁定语义保留。onboarding只因缺姓名等必要资料触发。

PC精确写入范围：`web/src/views/admin/Users.vue`、`web/src/components/ImportPreview.vue`，对应 `web/src/components/__tests__/student-quick-switches.spec.ts`。这两个组件不交给T5的试卷worker，避免重复处理导入逻辑。

- [ ] 编写断言：空工种新建/导入成功、无效ID拒绝、缺姓名仍拒绝、空工种实名可进入供应商流程、无角色提升；H5空工种不跳强制选择页。
- [ ] 运行相关server/mobile测试确认失败；实现后端DTO、导入模板说明和空值处理，再修改PC/H5必填与提示。
- [ ] 复核实名返回、头像可选、已有工种只读和异常保存收敛，保持其他真实身份/媒体门禁。
- [ ] 运行 `npm --prefix server test -- test/learner-training-category.spec.ts`、`npm --prefix mobile run test:unit -- test/learner-onboarding.spec.ts test/learner-training-category.spec.ts`、隔离 `learner-training-category` suite；补新用例到合适测试文件。
- [ ] 提交 `feat(学员): 将培训工种调整为可选资料`；向T6交接所有mobile修改路径。

## T5：PC随机卷配置与通用二维码（PCworker，可与T2/T4并行）

**Files:** 修改 `web/src/views/admin/Papers.vue`、`web/src/components/PaperEditDialog.vue`；新增 `web/src/components/RandomPaperRules.vue`、`web/src/utils/random-paper-rules.ts`、`web/src/components/ExamEntryQrDialog.vue`、`web/src/utils/exam-entry-url.ts`；扩展 `web/src/components/question-designers/__tests__/paper-edit-dialog.spec.ts`、`paper-list-actions.spec.ts`，新增 `random-paper-rules.spec.ts`、`exam-entry-qr.spec.ts`。部署公开H5 URL配置由root集成。

**Interfaces:** `validateRandomRules(rules: PaperRuleInput[], totalScore: number): string | null`，`summarizeRandomRules(rules): { count:number; scoreCents:number }`。创建random显式发送pool_scope=public/category_id=null，省略0题型；修改category历史卷保留scope，不静默升级。`buildExamEntryUrl(baseUrl: string): string` 输出标准H5考试Tab URL，禁止paper_id及认证参数。

- [ ] 写测试：100单选×1分默认100道100分、60单选×1+10多选×3+10判断×1=80道100分、合计不符阻止保存；默认次数3及边界1/100；编辑回显规则/次数且不改mode；固定卷payload不混入random规则。
- [ ] 运行对应web测试确认失败，再补新建模式和修改入口。新建随机不要求类别，表单不展示可选难度开关；明确来源映射。随机卷保存后返回列表，不进入固定卷选题设计器。
- [ ] 保留未保存提示、异步过期响应保护、失败保留输入和权限按钮规则；公开卷类别显示公共题库。全部编辑入口避免把random送入fixed designer。
- [ ] 复用仓库已有二维码渲染能力；若不存在，root统一评估并锁定本地二维码库及types依赖，禁止在线二维码服务。拟配置 `VITE_PUBLIC_H5_BASE_URL` 为含部署base path的H5 URL，仅用于构建入口；构建部署透传由root串行完成。
- [ ] 二维码按钮放在发布后的试卷操作中，文案“考试入口二维码 / 扫码进入考试列表”；两份试卷输出URL相同；缺配置显示提示不生成localhost码；支持预览和下载。二维码是普通H5网址，不调用微信小程序码API。
- [ ] 跑 `npm --prefix web test -- src/components/question-designers/__tests__/paper-edit-dialog.spec.ts src/components/question-designers/__tests__/paper-list-actions.spec.ts` 及新增两测试，执行 `cd web && npm exec -- vue-tsc --noEmit`；提交 `feat(试卷): 补齐随机规则配置和通用考试入口二维码`。

## T6：H5/小程序考试Tab及回跳（导航worker，依赖T4）

**Files:** `mobile/src/platform/navigation.ts`、`mobile/src/stores/session.ts`、`mobile/src/pages/auth/login.vue`、`mobile/src/pages/profile/info.vue`、`mobile/src/pages/identity/index.vue`、`mobile/src/pages/exam/index.vue`、`mobile/src/pages/exam/instructions.vue`；新增 `mobile/src/utils/exam-entry-intent.ts`、`mobile/test/exam-entry-intent.spec.ts`、`mobile/e2e/exam-entry.spec.ts`；扩展现有session/native-navigation测试。准确回跳实现依据现有路由适配器，不把Web window逻辑写到小程序公共路径。

**Interfaces:** 受控目标 `ExamEntryIntent = { kind:'exam-tab' } | { kind:'exam-instructions'; paperId:string }`；登录和实名返回只接受这两类站内目标，服务端重新判断资格。Tab通过现有跨端适配导航，非Tab说明页使用页面导航。

导航核实补充：现有Tab是 `AppTabBar.vue` 内的 `uni.reLaunch`，不能直接假设为原生 `switchTab`。本任务还独占修改 `mobile/src/platform/session.ts`、`mobile/src/App.vue`、`mobile/src/components/exam/LiveExamInstructions.vue`，按需覆盖 `LiveExamTake.vue` 的实名失败入口；检查 `mobile/src/components/common/AppTabBar.vue` 与 `mobile/src/utils/exam-summary.ts`。统一登录跳转和App会话恢复均须消费受控目标，避免一个入口修好、另一个仍回首页。

- [ ] 测试未登录扫码→登录→考试Tab；直接打开小程序点Tab得到同一列表；已登录未实名可看列表，选卷后实名返回说明页，绝不自动start。
- [ ] 测试外部return URL拒绝、目标刷新恢复、用户切换清除账号相关题单缓存，重新读取资格；扫码不携带paper_id，选卷后才保存该id。
- [ ] 运行新测试确认失败，实现意图保存/清除与回跳；登录首次补姓名后仍保留Tab目标，不再被默认首页跳转吞掉。
- [ ] 运行mobile定向单测、type-check及 `PLAYWRIGHT_CHANNEL=chrome npm --prefix mobile run test:e2e -- e2e/exam-entry.spec.ts e2e/auth-session.spec.ts e2e/identity-flow.spec.ts --workers=1`（沿用仓库配置所需启动方式）；小程序构建与真机导航另记证据。
- [ ] 提交 `feat(学员端): 统一考试Tab入口与登录实名回跳`。

## T7：统计、空值展示与历史兼容（统计worker，依赖T3/T4/T5）

**Files:** `server/src/modules/statistics/training-statistics.service.ts`、`server/src/modules/statistics/admin-dashboard.service.ts`、`server/src/modules/exams/exam-records.service.ts`；对应PC统计、考试记录视图由root先解析并冻结文件清单；`server/test/training-statistics.spec.ts`、`server/test/exam-records.spec.ts`、`tests/training-statistics.mjs`。

**Interfaces:** 公共卷分组标识来自pool_scope，category_id=null不是异常；展示“公共题库/未填写”。公共考试按实际参加/交卷统计，不以类别学员数作应考分母。保留按个人最高分规则、按冻结来源/难度分组；不新造未定义应考率。

PC精确写入范围：`web/src/views/admin/TrainingStatistics.vue`、`web/src/views/admin/ExamRecords.vue`、`web/src/views/admin/Dashboard.vue`；对应 `web/src/components/__tests__/exam-records.spec.ts`。旧 `Statistics.vue` 仅做兼容核对，不恢复旧统计管理入口。

- [ ] 测试空工种、跨类别参考、easy/hard分组、旧类别发布以及来源后来修改后的历史统计；若API已有应考率字段，public返回null并让UI显示不适用，不伪造0%或100%。
- [ ] 运行定向测试确认失败，调整查询/投影及PC空值展示；核对首页考试数量与Tab列表一致。
- [ ] 定向测试及隔离training-statistics suite通过，提交 `fix(统计): 兼容公共考试与可选工种`。

## T8：集成、文档与独立验收（root + tester + reviewer）

**Files:** root整合 `tests/run-e2e.mjs`、部署配置、构建配置与依赖锁；同步 `docs/design/01-需求分析.md`、`03-数据库设计.md`、`04-API设计.md`、其余受影响分册及README；新增 `review/2026-10-28-shared-random-exam-acceptance.md`。

- [ ] 按依赖图逐个集成已通过定向测试的提交；确认公共协议一致、无文件双写、无预约/支付草稿或真实.env混入。
- [ ] root按设计逐项自查，tester执行隔离完整链路：准备两种难度题池→发布→两种来源开考→续考→交卷/超时→三次耗尽；真实短信/实名使用测试provider override，不能声称真实供应商验收。
- [ ] 必要整体验证：`npm --prefix server test`、`npm --prefix mobile run test:unit`、`npm --prefix mobile run type-check`、`cd web && npm exec -- vue-tsc --noEmit`；运行受影响web测试和 `node scripts/build.mjs web h5`、`node scripts/build.mjs mp-weixin`；全部无新增失败。
- [ ] 独立reviewer收到固定基线/候选commit、准确差异文件、批准设计及测试证据，重点检查权限、并发计次、冻结题单、public/null兼容和扫码不自动开考；只报告问题，由owner修复，相关验证重跑。
- [ ] 人工验收记录区分桌面浏览器、手机扫码、真实短信实名、小程序真机；未执行项目明确标注。验证二维码与直接Tab入口一致、撤回/重新发布无需换码、并发设备不增次数。
- [ ] 验收记录写明迁移执行要求和回退边界：部署前备份；新字段可保留但未兼容的旧程序不得处理public卷，回退应用前需停止新公共考试入口并处理进行中记录，不通过删数据回退。
- [ ] 按模块中文提交，远程推送/部署单独遵循用户授权。本方案交付不代表获得实施、数据库变更或部署授权。

## 方案自查

### 必须通过的1000题真实链路验收（用户补充，纳入T8）

此项不是可选抽查，也不是仅向数据库直接插入1000行。新增 `tests/support/public-random-question-fixture.mjs` 生成合成题目及标准答案清单；扩展T3的 `tests/public-random-exam.mjs`，复用 `tests/training-question-import.mjs` 已有文件构造和导入协议。tester独占fixture/验收脚本，root独占suite注册；可在T1契约冻结后并行准备，T2—T7集成后运行。

**数据：** 1000道唯一合成题，简单500、困难500；每种难度各单选300、多选100、判断100。分属两个测试类别，每个类别各含简单/困难的单选150、多选50、判断50，证明公共卷可跨类别；不使用真实题库、手机号或身份证。题干含唯一编号，避免去重算法把合成题合并。答案及预计得分保存在测试侧，不进入学员API。

- [ ] harness启动独立临时MySQL/Redis/API并应用迁移；确认库名为本次生成的 `ruleexam_test_*`，凭据/前缀随机，连接目标不满足约束立即退出。建管理员和两名学员（一名institution、一名external，工种均null），必要身份状态仅通过隔离测试夹具准备。
- [ ] 按正式导入格式生成文件，用有权限的管理员调用 `/admin/questions/import-preview` → 获取批次 → `/admin/questions/import-batches/:id/commit`；确认真实控制器前缀并沿用现有suite。遵守单批上限，必要时按类别/难度分批，总计1000；不通过直接INSERT绕过导入、版本化和去重逻辑。
- [ ] 验证各批preview成功行数、commit成功行数及最终题库累计正好1000；核对类型/难度分布、每题有效当前版本且可供发布。重复提交同一批按既有幂等/拒绝协议处理，不增到2000。
- [ ] 经真实API创建public随机卷：单选60、多选20、判断20，各1分，总100道100分，及格60、时限30分钟、max_attempts=3；发布后核对冻结题池覆盖两个类别和两种难度。
- [ ] 两种学员用实际mobile会话获取考试列表、说明、调用开始接口。每人本次正好100题，按60/20/20分布，个人题单内无重复，分别全easy/全hard，总分100。核对学员响应无答案、解析和未抽中的900题；不从学生端结果反推正确答案。
- [ ] 测试侧按合成答案和展示选项映射构造答卷：全对100分、部分正确按明确规则计算、全错0分；通过整卷提交接口核对成绩与数据库记录一致。重复提交不重复评分、不生成新记录。
- [ ] 刷新/重复start和并发start返回同record_id、题目集合、排列及截止时间；提交后第2/第3次分别创建新record和题单，检查每次抽样过程及记录归属，第4次拒绝。不同次题单允许重叠，不以“必须不同”作为随机正确性断言。
- [ ] 独立超时案例使用测试夹具推进到期状态（不等待30分钟、不改开发库），验证timeout占一次、无自动评分；再按剩余额度开考。另测保存/开考事务失败不产生半份题单或额外次数。
- [ ] 同一批1000题再创建80题100分卷：单选60×1、多选10×3、判断10×1，两种来源各成功开考，验证题量/分值并未写死100。负例创建某难度题型需求超过可用数量的规则，发布必须返回具体不足项且无半成品发布版本。
- [ ] 验证发布后改题/停用题不会改变该发布快照及已开始题单；撤回、新发布、来源变更仍遵守设计的个人归属冻结。核对考试记录、最高分统计及easy/hard分组。
- [ ] 执行 `node tests/run-e2e.mjs --ephemeral --suite public-random-exam`，预期退出0且全部断言通过。输出脱敏报告：导入分布、发布版本、各次题量/分值/难度/次数、成绩校验、失败边界和用时；无凭据或真实个人信息。
- [ ] 在隔离环境保留期间做PC/H5浏览器验证：配置并发布、二维码目标是考试Tab、登录回到Tab、选卷开考；页面与API验证分别记录，不把纯HTTP测试当作扫码/页面操作通过。真实手机和小程序导航仍独立验收。
- [ ] 无论成功失败，harness在finally中回收本次服务与临时数据；只保存脱敏测试证据。失败保留诊断需明确路径和清理责任，不遗留连接生产/开发库的进程。

证据要求：导入路径、发布、开考、交卷、重考走实际API/MySQL/Redis；短信和实名供应商可用测试替身。1000题链路验证功能正确性，不等于大量学员同时考试的压力测试；性能压测不在本任务中冒充完成。

设计1—2→全局约束；设计3—5→T1/T2/T5；设计6→T5/T6；设计7→T3；设计8→T4/T7；设计9→T8。公共字段统一pool_scope，分值统一score_cents，扫码目标无paper_id，次数按paper+user累计。用户已要求当前分支执行；执行状态见review验收记录，未勾选项不能视为完成。
