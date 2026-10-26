# 试题管理瘦身、题库无分值与题目启停 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 取消当前考点组和题目审核流，让无分值题库直接入库、可恢复启停，并保证卷内分值、草稿发布和历史快照各自安全。

**Architecture:** 题目身份上的 question.is_enabled 决定新题池可用性，不可变 question_version 保存内容。题库新增、修订、读取、文件导入和参考题 AI 导入均不携带分值；分值只保存在卷内关联、随机规则、发布和考试快照中。先接收并核验另一个会话的无分值候选实现，复用通过部分，再按共享文件 owner 串行补齐本计划的缺口。

**Tech Stack:** Node.js 22、NestJS 10、TypeORM 0.3、MySQL 8、Vue 3、TypeScript、Element Plus、Vitest、Node test runner、项目隔离 E2E 启动器。

**Spec:** docs/superpowers/specs/2026-10-26-question-bank-slimming-design.md

**状态：** 2026-10-26 已接收题库无分值及人工 Tiptap 两个会话的完成交接，在同一 main 工作区完成集成。题库生命周期、导入、Web 与组卷已落地，最终冻结 000—028 目录的 24/24 全量隔离套件通过；用户追加的五项筛选常驻已完成增量验证。已获授权完成本地开发库升级和 API 重启，PC 人工录题／修订／启停实际闭环通过，完整 PC 矩阵仍有下述未验项。实际命令和边界以[验收记录](../../../review/2026-10-26-question-bank-slimming.md)为准。本线程未提交、推送或生产部署。

**后续独立授权：** 用户已批准升级当前本地开发服务，执行 025—027 并重启 API。正式 runner 被旧 002 的一次性密码回填探针拦住后，用户再次批准追加 028 前向修正，再继续本地升级；不得改账号数据、旧 SQL 或旧登记校验和。此授权不包含生产、提交或推送。

## Global Constraints

- 只支持 single / multiple / judgment；新建和修订只接受启用的 easy / hard，历史 medium 只读保留。
- 人工录题和修改保留 main 现有弹窗与保存链路，内容区按[最新融合设计](../specs/2026-10-26-manual-question-tiptap-design.md)接入 Tiptap；不新增独立试题设计器路由。组件/页面接入由该融合计划交付后复用，不退回旧 textarea。
- 题库新增／修订／list／detail／预览／文件导入／当前 AI 参考题导入均不携带 score 或 score_cents；不得用 0、5 或其它默认分占位。
- question.score 与 question_version.score_cents 仅为可空历史兼容列；新题和新 revision 为 NULL，已有值不回填、不清零，不重算历史试卷或成绩。
- 分值只属于 paper_question 等卷内关联、随机规则、发布和考试快照；只改本卷分值不得新建题、修订题库版本或调用 question commit。现有试卷总分 100 分规则不改。
- 新作者原稿剥离分值；内容判等排除卷内分值，不能因卷内分值变化制造新题或新 revision。
- 新业务不再读写 concept_id；历史表、字段和冻结快照本期不物理删除。新 revision 的 concept_id 为 NULL。
- 不再产生或操作 pending / approved / rejected 审核流；旧字段只读保留，不伪造审核人、时间或原因。新 revision 仅按旧列兼容要求写固定 approved，该值不决定可用性。
- question.is_enabled 是新候选是否可用的唯一生命周期事实；启停不创建内容 revision。草稿停用题保留可见并阻断发布。
- 修订现有题目必须携带 expected_version_id 与 expected_enabled:boolean，在同一身份锁内比较；另一管理员在同版本停用后，旧编辑保存返回 40940并保留草稿，刷新后才可显式“保存并启用”。此约束仅针对带既有 identity 的修订；设计器无 identity 派生新题、新建／AI 批次确认保持新建语义，不要求原题 expected_enabled。启停请求仍仅使用目标 enabled 与 expected_version_id，不增加生命周期版本列。
- 已发布 release、个人题单、attempt、结果和统计读取冻结事实；当前启停、题库无分值和考点退场不得改写历史。
- 当前批量 AI 生成入口仅 /admin/questions/import 的“AI 生成”tab，以参考题生成简单／困难试题，不生成整张试卷。
- 原计划 Task 4 的资料 AI 批次、新单题重生成预览／确认全部撤出本期；不新增 questions_material_ai 类型、生成路由、资料 AI 页面或流程。
- 既有试题管理的历史来源条件式“重生成”行操作退场；旧 POST /ai/questions/:id/regenerate 与无当前正式调用者的 POST /ai/generate-questions 写入口退场，旧任务／结果只读接口可保留。先核对消费者，不机械删除共享模块或历史记录。
- 保存响应不确定时先读权威详情／批次状态／幂等回执，不重复发送写请求。
- 迁移只追加、不改已有 checksum；025_question_bank_without_scores.sql 已由另一个会话占用，生命周期暂按 026、权限清理暂按 027，实施前按真实最新编号顺延。暂号不表示文件已存在。
- 保留所有并发 dirty 工作，包括 docs/ui/gemini.pen、无分值计划、025 和源码；不得暂存别人的代码，禁止 git add . 或 git add -A。本计划不自动授权提交、推送、部署或非测试库迁移。
- 当前并发开发期间不修改对方负责的 docs/design/ 与其它源设计文档，本期 spec／plan 暂覆盖冲突。Task 0 停写交接后须逐文件冻结文档 owner；Task 9 按明确交接实际同步源文档，或核验外部 owner 的实际交付，不能只以本期 spec／plan 覆盖代替同步。旧系统两册继续只读保留历史事实。
- 统一响应信封、严格 DTO 校验、无数据库外键、审计、稳定选项 ID 和受控媒体边界继续有效；不读取或输出真实凭据。

## Review Focus

- 只改卷内分值必须复用原 question_id／version_id，question commit 调用次数和题库写入数均为 0；由 Task 0、Task 5 的状态／宿主／服务端测试及 Task 9 E2E 固定。
- 新七列、旧九列和两种过渡八列表头不能错位；旧 score 只触发一次明确提示、不进指纹或存储，非空 concept 仍报错；由 Task 3、Task 8 固定，不声称八列已发出或部署。
- 旧 pending／rejected 必须映射停用；迁移 replacement-check 链须接实际最后有效 probe，兼容 025 后两项分值可空约束；由 Task 1、Task 2 固定。
- 同版本先停用再修订不能隐式复活，停用与发布并发必须锁内重检、整体回滚；草稿可见，历史 release／attempt 不受影响；由 Task 2、Task 5、Task 6、Task 7、Task 9 固定。
- 替换共享题库服务后，旧资料 AI／历史重生成不得变成未经确认直接启用旁路；当前参考题 AI 确认前零题库写入、确认重试幂等；由 Task 2、Task 3、Task 4 固定。

---

## File and Dependency Map

~~~text
Task 0  并发停写交接 → 候选核验 → 缺口／owner／迁移编号冻结
   ↓
Task 1  生命周期迁移（暂026，承接025的实际probe）
   ↓
Task 2  题库服务／版本／权限（清理迁移暂027）
   ↓
Task 3  文件导入 → 参考题AI导入（同一owner串行）
   ↓
Task 4  旧共享AI兼容和写入口退场核对
   ↓
Task 5  作者合同／考点退场／卷内分值隔离
   ↓
Task 6  候选／草稿／随机规则／发布
   ↓
Task 7  Questions UI → Task 8 Import UI（共享types/tests，串行）
   ↓
Task 9  集成E2E／文档同步交付 → Task 10 验收记录
~~~

上述是安全的默认串行顺序。只有 Task 0 的文件清单证明 owner 完全不交叉、接口与候选版本已冻结时，才可安排独立任务并行。不得再宣称 Tasks 3／4／5 或 Tasks 7／8 天然无交叉：

- question-import.service.ts、ai-question-import.service.ts 及导入测试由同一 owner 串行处理文件导入与 AI 适配。
- QuestionVersionService 在 Task 2、Task 5、Task 6 的改动串行；app.module.ts、ai.controller.ts 等公共注册文件也只能单 owner 交接。
- Questions UI、Import UI 共用 training-types.ts、QuestionPreview.vue 和 question-bank-ui.test.mjs，Task 7 完成并交接后才开始 Task 8。
- PaperDetail.vue、paper-designer-state.ts、web/src/composables/paper-designer-host.ts、paper-designer-controller.ts 及设计器测试由 Task 5 owner 完成交接后供 Task 6／Task 7 使用；不得同时改 paper.service.ts 或 paper-release.service.ts。
- 原“025 生命周期迁移”任务 brief、分工和验收口径全部失效；Task 0 之后按新编号和本计划合同重新生成，不能继续执行旧 brief。

### Task 0: 建立前置并发集成门

**Files:**
- Read only: docs/superpowers/plans/2026-10-26-question-bank-without-scores.md
- Read only: database/migrations/025_question_bank_without_scores.sql
- Read only: 并发会话交接的精确源码／测试／docs/design 文件清单与 diff。
- Read only: 本期 Spec、本计划、git status 和候选版本信息。

**Interfaces:**
- Consumes: 另一个会话“已停止写入”的明确交接、范围清单、基准 HEAD／候选 commit 或精确 diff、实际验证命令／结果／未验边界。
- Produces: 可复现候选版本、通过／缺口清单、共享文件及逐文件文档 owner、实际迁移编号及最后有效 replacement-check probe，供 Tasks 1—10 使用。

- [x] **Step 1: 取得停写和候选交接**

未取得停写确认前，仅可读本期文档与已授权的窄范围事实；不运行构建／测试、不重写源码、不迁移、不暂存、不给 worker 派发覆盖性源码任务。HEAD 相同但 diff 继续变化不算候选已冻结。

- [x] **Step 2: 核验无分值合同与“只改卷分”行为**

交接后逐项检查：题库新增／修订 payload 和读取投影无分值；新题及 revision 为 NULL、旧值未改；导入／AI 不制造默认分；authoring JSON 剥离分值；分值唯一变化时 questionFingerprint 不变、planPaperSave.submit 为空、保存宿主不调用 /admin/question-documents/commit，question／version 数量及当前版本不变，卷内关联分值改变且仍满足 100 分。复用候选现有测试；缺失行为由 Task 5 补测试后验证，不能以“文件已改”判通过。

- [x] **Step 3: 核验迁移链和旧 AI 消费者**

读取真实迁移目录、迁移元数据和 schema-migration 测试，找出 question 与 question_version 分值约束各自最后有效 probe。窄查旧两个 AI 写入口的页面／服务／注册 E2E 调用者，区分当前参考题导入、历史条件式重生成和旧只读任务接口。若发现旧写入口仍有当前正式消费者，只将该特定退场项交根智能体裁决，继续不依赖它的项，不擅自恢复资料 AI。

- [x] **Step 4: 冻结缺口和执行清单**

逐项标注“已验证复用／需补齐／阻断”，重新生成失效的旧 025 brief。对 Task 9 的每份源文档明确由本计划 owner 接手修改，还是继续由外部 owner 交付并由本计划核验；停写交接后方可接手，禁止两个 owner 同时写同一文件。每个后续任务只修改其已确认缺口；有通过证据的候选实现不得重复开发。交付项未通过不得勾选，门未打开不得进入 Task 1。

**Verification:** 核对交接包含停写确认、候选版本、范围、命令实际结果、迁移链与 owner 七项；缺任何一项门保持未通过。已接收的实际交接及验证见验收记录，不以本计划文本代替证据。

### Task 1: 建立启停数据库事实并接续真实迁移链

**Files:**
- Create: database/migrations/026_question_lifecycle_slimming.sql（暂号，Task 0 后顺延）。
- Modify: database/init.sql、server/src/entities/question.entity.ts。
- Create: tests/question-lifecycle-migration.test.mjs。
- Modify: tests/migration-catalog.test.mjs、tests/migration-contract.test.mjs、server/test/schema-migration.spec.ts。
- Preserve: 并发会话的 025 与历史迁移内容／checksum；分值可空与实体结果以 Task 0 验证候选为基准。

**Interfaces:**
- Produces: Question.isEnabled: boolean，映射 question.is_enabled TINYINT(1) NOT NULL DEFAULT 1。
- Produces: 旧 status='approved' → 1，其它旧状态／未知值 → 0；保留审核、考点和历史分值。
- Produces: 接到实际最后有效 probe 的线性 replacement-check 链，包含 question.score 和 question_version.score_cents 可空后约束。

- [x] **Step 1: 写迁移合同测试**

断言真实编号连续、is_enabled 添加／回填／重复执行安全；旧 approved 启用、pending／rejected／未知停用；不删历史字段、不 UPDATE 旧 score。验证 025 后两个分值列仍可空、旧非空值原样保留；从旧库升级、当前候选续跑和新装 init 的结构一致，replacement-check 不跳过、不分叉、不回接被替代的旧非空 probe。

- [x] **Step 2: 运行失败测试**

Run: node --test tests/question-lifecycle-migration.test.mjs tests/migration-catalog.test.mjs tests/migration-contract.test.mjs

Expected: 新测试在缺少启停列或正确 replacement-check 时失败；候选已有通过部分记录为复用，不强行制造失败。

- [x] **Step 3: 实现前向迁移和实体映射**

沿现有 @step／@check／replacement-check 协议新增列、显式 CASE 回填、候选索引 (is_enabled,category_id,type,difficulty,current_version_id)。新增迁移从实际有效前驱接链，不改 025 或其它旧 checksum；init 新装默认启用，分值兼容列继续可空。

- [x] **Step 4: 定向验证并交接**

Run: 上述 Node tests；npm --prefix server test -- schema-migration.spec.ts；npm --prefix server run build。

Expected: 全部 PASS，迁移只在隔离测试库执行；交付准确迁移路径和前驱 probe，不以暂定 026 文件名冒充当前事实。

### Task 2: 用题库生命周期替换审核并核验无分值写入

**Files:**
- Create: server/src/modules/questions/question-bank.service.ts。
- Replace/remove after caller audit: server/src/modules/ai/question-review.service.ts。
- Modify: server/src/modules/questions/question-version.service.ts、question.dto.ts、server/src/modules/ai/ai.controller.ts、server/src/app.module.ts。
- Modify: server/src/modules/questions/question-authoring-codec.ts、server/src/common/question-authoring.ts、web/src/api/question-document-types.ts（既有 identity token）；后续 Task 5 串行接手。
- Modify: server/src/modules/access/permission-catalog.ts、server/src/common/guards/permissions.guard.ts、database/seed.mjs。
- Create: database/migrations/027_question_review_permission_cleanup.sql（暂号，紧随 Task 1 实际编号）。
- Test: server/test/question-bank.spec.ts、admin-slimming.spec.ts、permissions-any.spec.ts、tests/migration-catalog.test.mjs、tests/migration-contract.test.mjs。
- Test: server/test/question-authoring-service.spec.ts、question-editor-state.spec.ts、question-authoring-idempotency.spec.ts。

**Interfaces:**
- Consumes: Question.isEnabled 和 Task 0 验证过的无分值版本创建合同。
- Produces: QuestionBankService.list(query:QuestionListQueryDto)，支持 enabled?:boolean，不接受 status／concept_id／score。
- Produces: QuestionBankService.setEnabled(id:string, enabled:boolean, expectedVersionId:string|null, actor:{id:number;name:string}, ip:string|null)。
- Produces: PUT /ai/questions/:id/enabled，body {enabled:boolean,expected_version_id:string|null}，权限 questions:write；list／detail 输出 enabled:boolean，不含当前审核／考点／分值字段。
- Produces: PUT /ai/questions/:id 的现有内容 body 新增必填 expected_enabled:boolean；QuestionVersionService.revise(questionId:string,input:QuestionDraft,actorId:string,expectedVersionId:string|null,expectedEnabled:boolean):Promise<string>。
- Produces: 既有 VersionTokens identity 为 {question_id:string,expected_version_id:string|null,expected_enabled:boolean}，只约束既有题修订；新建无 identity，AI 批次确认沿用原合同。setEnabled 的 body／签名保持上一行启停合同。
- Produces: QuestionVersionService.assertCurrentUsable(questionId:string, manager:EntityManager)，不依赖旧审核状态或题库分值。

- [x] **Step 1: 写生命周期／无分值／权限失败测试**

固定人工创建启用、修订创建新 revision 并启用；两项兼容分值为 NULL且旧值不改。停用不建 revision、重复操作不重复审计、恢复重验内容／来源／媒体。新增双管理员交错测试：A 读到 enabled=true／version=V，B 停用且版本仍 V，A 带旧 expected_enabled=true 修订必须 40940、零 revision／零启用；带既有 identity 的 authoring commit 同样失败，刷新后 expected_enabled=false 的显式保存才可启用。陈旧 version 仍 40940；无 identity 派生新题、新建／AI 确认无需原题该字段，重复目标启停仍幂等。旧 pending／rejected 仅服从 isEnabled；list／detail 无 score。权限迁移只清理 questions:review，不碰 ai:review／papers:review。

- [x] **Step 2: 运行定向失败测试**

Run: npm --prefix server test -- question-bank.spec.ts admin-slimming.spec.ts permissions-any.spec.ts question-authoring-service.spec.ts question-editor-state.spec.ts question-authoring-idempotency.spec.ts

Expected: 未实现启停或仍泄出题库分值的断言失败；Task 0 已验证项直接复用。

- [x] **Step 3: 实现题库和版本服务**

迁入 list／get／history／create／edit，当前写路径不接受分值、conceptId 为 undefined／NULL。create／createMany 直接启用；revise 和 authoring 既有 identity 写入在同一锁内比较 expectedVersionId／expectedEnabled，两项均匹配后才建新版本并启用。固定兼容 approved 但审核元数据为 NULL；兼容分值为 NULL，不从旧 question.score 推导。启停锁 identity、比对版本、恢复调用 assertCurrentUsable，成功提交后审计。按 Task 4 合同处理旧 review／regenerate 调用，不把旧写路径机械改成直接启用。

- [x] **Step 4: 更新路由、Provider、DTO 和权限**

删除 review 与当前考点管理路由，新增 enabled 路由；修订 DTO 严格校验 expected_enabled，authoring codec／服务端与 web VersionTokens 同步，assemble／编辑投影从 identity 提供当前启停基线。严格 DTO 拒绝当前写请求中的 status／concept／score，历史详情只在兼容区按需展示原审核事实。移除 questions:review 目录、种子、默认角色和 fallback；新增实际编号权限清理迁移，按 Task 1 规则延续校验链。确认所有当前调用者迁移后再删除旧服务，不删除历史记录。

- [x] **Step 5: 运行定向验证并交接**

Run: 上述服务端定向 tests；node --test tests/migration-catalog.test.mjs tests/migration-contract.test.mjs；npm --prefix server run build。

Expected: 全部 PASS；启停不改内容版本，任何题库新写入均无分值，旧写入口无直接启用旁路。

### Task 3: 串行收敛文件导入与当前参考题 AI 导入

**Files:**
- Modify: server/src/modules/questions/question-import-format.ts、question-import.service.ts、question-import.controller.ts。
- Modify after file import handoff: server/src/modules/questions/ai-question-import.service.ts、ai-question-import.controller.ts。
- Test: server/test/question-import.spec.ts、question-import-workflow.spec.ts、ai-question-import.spec.ts。
- Test: tests/training-question-import.mjs、tests/training-ai-question-import.mjs。

**Interfaces:**
- Consumes: Task 2 的无分值且直接启用的 QuestionVersionService.createMany。
- Produces: 新模板恰好七列 category,type,difficulty,stem,options,answer,analysis。
- Accepts: 旧九列 category,type,difficulty,concept,stem,options,answer,analysis,score；两种过渡八列分别只少 concept 或只少 score，按表头映射。兼容支持不表示八列已发出或部署。
- Produces: 非空 concept 行错误“考点组已取消，请清空后重试”；旧 score 被识别但不进入 draft／预览题目／指纹／题库／卷分，批次一次性提示“旧模板分值已忽略，请在组卷时设置”。
- Preserves: 现有 questions_ai 批次、owner、逐行修改／重生成、选择确认、幂等回执和未知响应 GET 对账接口；不新增批次类型或路由。

- [x] **Step 1: 写模板与确认失败测试**

为 XLSX／TXT 各测新七列、旧九列、只少 concept 的八列、只少 score 的八列，无字段错位；concept 空可过、非空报固定文案。旧 score 为正数、0、空或非数字均仅忽略，不凑 100 分、不报题目分值错误；同内容不同旧 score 指纹相同。确认集合一次性创建 enabled=true 的无分值题，整批失败零新增，重试回原回执。旧未提交批次转换为无分值投影；已提交批次返回原幂等回执，不重写旧回执、不重复建题。

- [x] **Step 2: 运行定向失败测试**

Run: npm --prefix server test -- question-import.spec.ts question-import-workflow.spec.ts ai-question-import.spec.ts

Expected: 七列／旧模板提示／无分值确认缺口被测试检出。

- [x] **Step 3: 完成文件格式与普通导入**

按表头选择列映射，不按去掉一列后的固定下标读取旧模板。下载只生成七列；预检明确记录是否识别旧 score，重复读取同一批次仍能供 UI 显示一次提示。移除 resolveConcept、concept／score 指纹及 draft 分值；确认复用无分值事务，不自动赋任何卷分。

- [x] **Step 4: 完成参考题 AI 适配**

文件导入 owner 交接后再改 AI 服务：生成简单／困难试题，prompt／generatedDraft／行更新／预览／下载不含 score 或 concept。显式兼容转换旧未提交批次，已提交批次保持原回执。生成完成、修改和批次内单行重生成不写题库；只在选择确认时原子创建启用题。保持 /admin/questions/ai-import-tasks、ai-import-batches 既有接口，不把它解释为整卷生成或资料 AI。

- [x] **Step 5: 运行定向测试并交接**

Run: 上述三个服务端 suites。

Expected: 全部 PASS；记录七列下载、旧 score 单次提示、确认前零写入和幂等证据；HTTP 全链在 Task 9 运行。

### Task 4: 核对旧共享 AI 兼容并使旧写入口退场

**Files:**
- Audit/modify only necessary adaptation: server/src/modules/ai/question-generation.service.ts、ai.controller.ts、question-review.service.ts。
- Audit: server/src/modules/questions/question-version.service.ts、question-import.service.ts、ai-question-import.service.ts、web/src/views/admin/Questions.vue。
- Test: server/test/question-bank.spec.ts、ai-question-import.spec.ts、admin-slimming.spec.ts、tests/training-question-bank.mjs。

**Interfaces:**
- Consumes: Task 0 消费者清单、Task 2 服务替换、Task 3 现有参考题批次。
- Removes: 试题管理旧历史来源条件式“重生成”行操作与 POST /ai/questions/:id/regenerate。
- Removes after current-caller check: POST /ai/generate-questions 直接写入口；旧任务／结果只读可保留。
- Does not produce: 资料 AI 批次、新生成路由、新 UI、单题预览／确认接口。

- [x] **Step 1: 固定窄范围路由与写入测试**

断言当前批量入口仅试题导入 AI tab；旧两个写 URL 不能调用，旧任务／结果仍可按原权限读取。参考题批次生成／修改／单行重生成均零 question／version 写入，确认才启用。若 Task 0 发现当前正式消费者尚未裁决，只阻断对应旧入口项。

- [x] **Step 2: 最小适配共享代码与路由**

共享代码仅因无分值或题库服务替换做必要修改；退出可调用写路由，不机械删除整个模块、历史任务、结果和只读接口。不得把旧 QuestionGenerationService.runTaskInner 接入新资料批次，不增加 regenerate-preview／regenerate-confirm 路由，不让旧共享 createMany 成为直接启用旁路。Questions.vue 的行操作删除由 Task 7 owner 落地。

- [x] **Step 3: 定向验证并交接**

Run: npm --prefix server test -- question-bank.spec.ts ai-question-import.spec.ts admin-slimming.spec.ts；npm --prefix server run build。

Expected: 全部 PASS；交付旧路由消费者、退场处理、保留只读与零新增业务清单。所有历史共享调用已核对，不能仅用新参考题测试代表旧入口安全。

### Task 5: 取消当前考点合同并隔离卷内分值

**Files:**
- Remove after caller audit: server/src/modules/questions/question-concept.service.ts。
- Modify: server/src/modules/questions/question-version.service.ts、question-validator.ts、question-authoring-codec.ts、question-authoring.service.ts、server/src/common/question-authoring.ts、server/src/app.module.ts。
- Modify: web/src/api/question-document-types.ts、training-types.ts、question-authoring.ts。
- Modify: web/src/components/question-designers/contracts.ts、PaperDesigner.vue、QuestionProperties.vue、paper-designer-state.ts、web/src/composables/paper-designer-host.ts、web/src/composables/paper-designer-controller.ts、web/src/views/admin/PaperDetail.vue。
- Test: server/test/question-authoring-service.spec.ts、question-editor-state.spec.ts、question-form-authoring-compatibility.spec.ts。
- Test: web/src/components/question-designers/__tests__/main-contract-adapter.spec.ts、paper-designer-state.spec.ts、paper-host-main.spec.ts、paper-designer.spec.ts、paper-save-recovery.spec.ts。
- Fixture: tests/fixtures/question-authoring-v3/rich-authoring.json。

**Interfaces:**
- Consumes: Task 2 无分值版本合同与 Task 0 已验证的候选实现，沿用现有 AuthoringBundle、PaperDesignerValue、PaperSavePlan。
- Consumes: Task 2 的 VersionTokens.expected_enabled，仅带既有 identity 的题目修订保留编辑时基线并执行锁内比较；刷新才能更新基线，不能在提交前静默重读并代换。设计器现有无 identity 派生新题保持原新建语义，不要求原题 expected_enabled。
- Produces: questionFingerprint 的内容判等不含 score_cents；planPaperSave(value:PaperDesignerValue):PaperSavePlan 在仅卷分变化时 reuse 原身份／版本，submit 无题。
- Produces: toAuthoringBundle 和服务端 question authoring 存储投影剥离卷内分值与当前 concept；卷内 score_cents 留在 PaperDesignerValue／paper_question，不传回题库作者原稿。
- Preserves: 新题或真实内容变化的既有 commit、稳定选项 ID、幂等回执和未知响应保护；本期不重新设计其业务。

- [x] **Step 1: 写卷分隔离与历史兼容失败测试**

绑定题只改本卷分值：fingerprint 不变、reuse 保留精确 question_id／version_id、submit 为空、保存宿主 paper-designer-host.ts 的 questionAuthoringApi.commit 调用 0 次、服务端 question／version insert／update 0 次；保存卷内分值正确，其他卷及发布快照不变。带既有 identity 的题目修订携带原 expected_enabled，覆盖同版本被他人停用后 40940且保留输入，不能静默刷新 token 重试。设计器现有无 identity 派生新题按原新建路径提交，不带原题 expected_enabled，不把原题停用当作新题修订冲突。两类写入保存的题库 authoring JSON 均无分值、版本分值 NULL。新写 payload 无 concept，旧 JSON concept 可读取但新 revision 为 NULL。

- [x] **Step 2: 运行失败测试并复用已通过候选**

Run: npm --prefix server test -- question-authoring-service.spec.ts question-editor-state.spec.ts question-form-authoring-compatibility.spec.ts

Run: npm --prefix web test -- src/components/question-designers/__tests__/main-contract-adapter.spec.ts src/components/question-designers/__tests__/paper-designer-state.spec.ts src/components/question-designers/__tests__/paper-host-main.spec.ts src/components/question-designers/__tests__/paper-designer.spec.ts src/components/question-designers/__tests__/paper-save-recovery.spec.ts

Expected: 未覆盖的卷分误触发 commit／新 revision 或 authoring JSON 污染被检出；不能只测隐藏输入框。

- [x] **Step 3: 实现最小缺口**

在现有 codec／adapter／state／paper-designer-host.ts 保存链路分别分离题库内容与卷内分值；不能只在一处删 UI。去掉当前考点 CRUD、属性和候选控件，历史 entity／DDL／snapshot 保留。仅卷分修改走保存卷内关联，空 submit 不调用 question commit；只对带既有 identity 的修订传递并校验 expected_enabled，无 identity 派生新题沿用新建路径。题库提交与存储投影统一剥离分值，防直接 API 请求绕过前端。设计器仍保留卷内分值编辑与 100 分校验。

- [x] **Step 4: 定向验证和类型检查**

Run: 上述服务端和 web suites；npm --prefix server run build。

Working directory: web。Run: npm exec -- vue-tsc --noEmit。Expected: exit 0；不要使用曾在本机输出 tsc 帮助的 npm --prefix web exec 写法。

Expected: 全部 PASS，已通过部分不重复改写；把 PaperDetail.vue 和共享 types／tests 交给后续 owner 后再继续。

### Task 6: 统一候选、草稿、随机规则和发布边界

**Files:**
- Modify: server/src/modules/questions/question-version.service.ts、server/src/modules/ai/paper.service.ts。
- Modify: server/src/modules/exams/paper-release.service.ts、sampling.service.ts、paper-admin.controller.ts、server/src/entities/paper-question.entity.ts。
- Modify after Task 5 handoff: web/src/views/admin/PaperDetail.vue。
- Test: server/test/paper-release.spec.ts、paper-release-fix1.spec.ts、sampling.spec.ts、tests/support/paper-release-concurrency-checks.mjs、web/tests/paper-management-state.test.mjs。

**Interfaces:**
- Produces: QuestionVersionService.enabledCandidates(filter:CandidateFilter, manager?:EntityManager)，只取启用 identity 的精确 current version。
- Produces: 固定／随机组卷以 questionId 去重；草稿行含 enabled:boolean，停用行保留可见，发布失败可定位题目 ID。
- Preserves: 卷内关联／随机规则提供实际 score_cents，固定／随机现有 100 分约束和发布／考试冻结合同；不回退读取题库 score。

- [x] **Step 1: 写题池、卷分和并发失败测试**

断言旧 version.status／concept 不参与新候选；同 concept 不同题可同时入卷，同 question 不重复；NULL 历史兼容分值不阻断候选。停用不能新增，已选后停用草稿仍可见、发布整体失败；随机容量按启用 identity 计算。卷内分值由关联／规则决定，旧题库分值不能当默认；并发停用／发布只有合法结果，release 后停用不改预览、开考和评分。

- [x] **Step 2: 实现候选、草稿与发布**

使用调用方 manager 查询／锁定 question，要求 is_enabled=1 且 current_version_id 精确匹配，不检查 approved；去重键只含 questionId。草稿详情补 enabled，不删除停用行；发布锁内重验 enabled／version，任一失败整体回滚，历史读取不调用当前 enabled 查询。分值始终来自卷内关联／规则和冻结快照，保留 100 分校验。

- [x] **Step 3: 定向验证并交接**

Run: npm --prefix server test -- paper-release.spec.ts paper-release-fix1.spec.ts sampling.spec.ts

Run: node --test web/tests/paper-management-state.test.mjs

Expected: 全部 PASS；tests/support/paper-release-concurrency-checks.mjs 的数据库并发探针随 Task 9 隔离 publishing 套件执行，不把纯状态测试写成已验证真实事务并发。

### Task 7: 瘦身试题管理和无分值人工录题

**Tiptap 衔接（用户最新纠正）**：复用[人工录题融合计划](2026-10-26-manual-question-tiptap.md)交付的 `ManualQuestionEditor`，不退回旧文本框组件。现有弹窗直接编辑题干/选项/解析 JSON，右侧设答案、正确标识和 × 删除同步字母操作；保存并新增只在成功凭据返回后清空。启停基线及未知保存保护继续按本任务要求保留。

**Files:**
- Modify: web/src/views/admin/Questions.vue、web/src/components/QuestionEditor.vue、QuestionPreview.vue。
- Modify: web/src/api/training-types.ts、question-authoring.ts。
- Test: web/tests/question-bank-ui.test.mjs。

**Interfaces:**
- Consumes: Task 2 enabled 字段／启停 API，Task 4 旧行操作退场，Task 5 无分值作者合同。
- Produces: category_id／keyword／type／difficulty／enabled 五项常驻筛选，不折叠，默认 enabled=true；查询／重置成组排在字段之后。
- Produces: 启用行“预览／修订／停用”，停用行“预览／修订／恢复”；保持现有表单弹窗和未保存保护。

- [x] **Step 1: 写 UI 行为失败测试**

页面无统计卡、QUESTION INDEX、审核操作、考点控件、题库分值列／预览分值／建议分和旧重生成行操作。保留人工录题、试题导入、紧凑查询、更新时间和启停；按用户最新纠正，五项筛选全部常驻，移除“更多筛选”及折叠状态，查询／重置保持成组，筛选提交／重置回第 1 页。write-only 显示明确无查看权限文案，预览先显示当前题、历史失败可重试。沿人工 Tiptap 已交接设计统一使用“保存”及“保存并新增”，停用修订在按钮附近显式提示保存会创建新版本并启用；提交 payload 无 score。双管理员停用交错后，旧编辑以原 expected_enabled 保存返回 40940，输入保留，刷新后显示保存并启用的提示，用户再次显式保存才恢复。共享预览的卷内模式仍显示实际分值。

- [x] **Step 2: 实现页面与表单缺口**

沿用 FitsTable 和 main 表单；移除统计／概念请求、审核与旧重生成入口。题库来源、revision、旧审核事实按需放预览兼容区，不展示兼容分值；题库无分值模式不能全局隐藏试卷预览／打印／学员／结果的实际分值。表单 baseline 保存 expected_enabled，修订原样提交，40940保留草稿并要求显式刷新，不自动替换基线重试；新建不发送该字段。表单不增加资料来源或独立设计器；题型／类别／难度、题干／选项／答案／解析／受控图片继续可用。未知响应保留输入并先查回执／详情。

- [x] **Step 3: 验证后交接共享文件**

Run: node --test web/tests/question-bank-ui.test.mjs

Working directory: web。Run: npm exec -- vue-tsc --noEmit。

Expected: PASS／exit 0；交接 training-types.ts、QuestionPreview.vue、question-bank-ui.test.mjs 后 Task 8 才能写入。

### Task 8: 完成文件导入与当前参考题 AI 页面闭环

**Files:**
- Modify: web/src/views/admin/QuestionImport.vue、web/src/utils/question-import-workflow.ts、web/src/api/training-types.ts。
- Modify only after Task 7 handoff: web/src/components/QuestionPreview.vue、web/tests/question-bank-ui.test.mjs。

**Interfaces:**
- Consumes: Task 3 七列模板、旧模板元数据／固定文案、有效行预览、既有参考题批次更新／重生成／确认和 enabled:true 回执。
- Produces: 文件“有效题预览 → 选择确认 → 已启用”；AI tab“参考题生成简单／困难题 → 预览修改／批次内单行重生成 → 选择确认 → 已启用”。

- [x] **Step 1: 写页面流程失败测试**

有效题可逐题预览，错误行保留，确认只接受 valid row ID；按钮为“确认导入并启用”。旧 score 在单次批次预览明确提示一次“旧模板分值已忽略，请在组卷时设置”，重渲染／翻页不重复弹出；非空 concept 保留行错误。页面不显示／提交题目分值，不要求参考题或导入题总分 100；确认前无题库写，未知响应 GET 对账，迟到响应不导航。

- [x] **Step 2: 实现页面合同**

复用 QuestionPreview，确认成功以回执展示数量与“已启用”并返回题库；保留失败行和修文件重传路径。AI tab 只承载参考题，不接资料任务、旧历史单题入口或整卷生成；删除 pending-review 假设，不新增 batch kind／路由／UI。

- [x] **Step 3: 定向验证**

Run: node --test web/tests/question-bank-ui.test.mjs

Working directory: web。Run: npm exec -- vue-tsc --noEmit。

Expected: PASS／exit 0，文件和 AI 均无分值、无考点、无第二次审核。

### Task 9: 集成 E2E 与源文档同步交付

**Files:**
- Modify: tests/training-question-bank.mjs、training-question-import.mjs、training-ai-question-import.mjs、training-publishing.mjs、training-full-flow.mjs、main-question-designers.mjs、main-question-designers-compatibility.mjs。
- Modify after Task 0 owner handoff, or verify actual external-owner delivery: docs/design/README.md、docs/design/01-需求分析.md、docs/design/03-数据库设计.md、docs/design/04-API设计.md、docs/design/05-模块设计.md、docs/design/06-关键流程.md。
- Modify after Task 0 owner handoff, or verify actual external-owner delivery: docs/superpowers/plans/2026-10-22-training-demo-slimming.md、docs/superpowers/specs/2026-10-23-main-question-paper-designer-integration-design.md 中与本期相冲突的说明。
- Read only: docs/design/00-旧系统-培训机构端需求分析.md、docs/design/00-旧系统-学员移动端H5需求分析.md，保留旧系统事实。
- Ownership: 并发开发期间不抢改；Task 0 停写交接后按逐文件 owner 修改或核验外部交付，不能只靠本期 Spec／plan 覆盖代替源文档同步。

**Interfaces:**
- Consumes: Tasks 0—8 通过证据和候选最终版本、并发会话文档交接。
- Produces: 从无分值题库、文件／参考题 AI 到卷内分值、启停、发布和考试历史的隔离 HTTP 证据。
- Produces: 上述源文档实际同步后的交付与逐文件核验结果，覆盖启停、审核／考点退场、分值归属、迁移与 API／流程；旧系统两册事实保持不变。

- [x] **Step 1: 更新集成断言**

人工／文件／AI 确认直接启用，题库 payload 与读取无分值、DB 新写 NULL、旧值不改；七列、旧九列及两种过渡八列兼容，不凑导入总分。设计器仅改卷分时无 question commit、精确 identity／version 不变，同题两卷不同分互不影响，现有 100 分规则保持，试卷预览／打印／学员／结果仍显示实际分值。带既有 identity 的修订在同版本被另一管理员停用后返回 40940且不复活，刷新后显式保存再启用；无 identity 派生新题保持原新建语义、不要求原题 expected_enabled。停用退出候选、草稿可见阻断、恢复可发布、历史快照不变。旧 review／两个生成写入口不可调用，旧只读任务结果按权限保留。

- [x] **Step 2: 运行相关隔离 E2E**

Run:

~~~bash
node tests/run-e2e.mjs --ephemeral --suite training-question-bank
node tests/run-e2e.mjs --ephemeral --suite training-question-import
node tests/run-e2e.mjs --ephemeral --suite training-ai-question-import
node tests/run-e2e.mjs --ephemeral --suite training-publishing
node tests/run-e2e.mjs --ephemeral --suite main-question-designers
~~~

Expected: 全部 PASS，逐套独立测试库；并发探针真实执行，不连接开发库。

- [x] **Step 3: 按交接实际同步文档并核验数据合同**

先核对 Task 0 冻结的逐文件文档 owner。本计划接手的文件按明确交接实际修改；外部 owner 负责的文件须取得最终版本和 diff，逐条核验实际交付。同步 docs/design/README、01／03／04／05／06 及既有瘦身计划／试卷设计器设计的冲突说明，使题库无分值、卷分归属、启停、审核／考点退场、数据库结构、API 和流程与实际 init／entities／迁移／源码一致。旧系统两册只读保留历史事实。缺漏必须由已冻结 owner 补齐并重新核验；未实际同步前本任务不通过，不能以本期 Spec／plan 已覆盖替代，也不抢改仍在进行中的工作。

- [x] **Step 4: 静态残留逐条分类**

Run: rg -n "questions:review|待审核|question-concepts|新建考点|同考点|generate-questions|regenerate-preview|regenerate-confirm|questions_material_ai" server/src web/src database/seed.mjs docs/superpowers/specs/2026-10-26-question-bank-slimming-design.md docs/superpowers/plans/2026-10-26-question-bank-slimming.md

Expected: 当前可调用业务无审核／考点／撤出的生成写路由；历史兼容、只读、测试和明确“撤出／禁止”说明分别登记，不机械追求零命中或删除旧系统事实。

### Task 10: 完成比例适当的验证与验收记录

**Files:**
- Create: review/2026-10-26-question-bank-slimming.md（最终采用的实际文件名）。
- Modify only if a failure proves necessary and owner handed off: Tasks 1—9 的自有文件与测试。

**Interfaces:**
- Consumes: 全部交付、实际候选版本、所有已解决门项。
- Produces: 静态、自动化、浏览器／PC、未验证与部署状态分层的证据；不得将本地结果扩大为真机、真实供应商或生产部署。

- [x] **Step 1: 运行构建／类型／测试**

Run:

~~~bash
git diff --check
npm --prefix server run build
npm --prefix server test
npm --prefix web test
node --test web/tests/question-bank-ui.test.mjs web/tests/paper-management-state.test.mjs
~~~

Working directory: web。Run: npm exec -- vue-tsc --noEmit。

Expected: 全部 PASS／exit 0；既有无关失败须给出基线证据，不计作本期通过。已在同一最终候选上通过的定向测试不机械重跑，只有新变化／失败／未解风险才追加测试。

- [x] **Step 2: 运行必要完整回归与构建**

迁移、共享版本／发布服务和权限均涉及跨链影响，Run: node tests/run-e2e.mjs --ephemeral --suite all。Expected: 注册套件逐个隔离且全部 PASS。

Task 0 停写交接后，最终候选必须完成 Web 构建验证，Run: node scripts/build.mjs web（保留 dist/mobile）。Expected: exit 0；这是本地原子构建，不是远端部署，不用直接 web vite build 代替原子构建脚本。不执行推送、生产部署或非测试库迁移。

- [ ] **Step 3: PC 浏览器验收**

验证紧凑筛选、无分值人工录题／修订／预览、七列下载及旧模板提示、参考题 AI 确认、启停、停用草稿发布阻断、只改卷分无题库写入、旧行操作退场和历史试卷／考试分值不变。截图放已忽略的 gui-test-screenshots/，不入库；浏览器结果不等于 H5 真机或生产验收。

2026-10-26 实际进度：五项常驻筛选、人工录题“保存并新增”、再打开预览、停用、带明确启用提示的修订和恢复均通过真实开发页面；唯一验收题 ID 51 最终保留停用，原 50 题未变。模板和 AI 页面说明已查看，但扩展未开放文件网址权限，上传在请求前被拒绝；文件预览／确认、外部 AI、图片和试卷专项 PC 检查未重新逐项操作。因此本步骤保留未勾选，隔离自动化结果另列，不能代替全部 PC 验收。

- [x] **Step 4: 独立审查并记录**

审查默认分值是否藏在 adapter／AI／导入／旧共享路径、卷分是否误触发 commit、新 revision NULL 与旧值保留、迁移 probe 线性续跑、pending 误启用、旧写旁路、停用／发布并发、历史回读和媒体权限。实质问题只补必要缺口并重跑受影响测试。

记录精确候选、每条实际命令／结果、最终候选 Web 构建结果、并发交接和复用范围、PC 证据、文档 owner 的实际同步与核验结果、测试库隔离与未验边界。未授权提交／推送／部署保持未执行；不得把本计划勾选、源文件 dirty 或另一个会话的口头完成等同验收。

### Task 11: 用户追加授权的本地升级兼容修正

- [x] **Step 1: 追加 028 并完成隔离 RED/GREEN**

只新增 `028_access_password_backfill_probe.sql`，线性替代 002 的一次性回填探针。校验列形状、合法标记及首次回填完成证据；正常后续账号不改写，新装仍须真正完成首次回填。固定重跑、旧登记不变、非法状态拒绝的隔离测试；不修改 runner 或历史迁移。

- [x] **Step 2: 独立复核并升级本地开发库**

复核实际待执行项仅 025—028。停当前本地 API、做私有 SQL 备份，使用已登记 022 的真实历史原制品进行完整 checksum/probe 核验，再走正式 runner；不重写旧登记或直接跳过校验。迁移前后比较账号、题目版本、试卷、发布、考试和答案摘要。通过后用持久配置重启当前 API；PC 保存／启停仍由 Task 10 Step 3 单独验收，不把服务健康响应当成真实页面闭环。仅有尾部空行差异的 022 运维制品差异须留档，不声称默认磁盘 catalog 已修复。

## Plan Self-Review

- Spec coverage：Task 0 接住并发无分值候选并冻结文档 owner；Tasks 1／2 负责启停和迁移／权限，Task 3／8 负责七列及旧模板、参考题 AI，Task 4 收口旧写入口，Task 5 固定卷分隔离与作者原稿，Task 6／7 负责题池和页面，Task 9／10 覆盖集成、源文档实际同步、必需 Web 构建与分层验收。
- Step scan：每个任务都有明确文件、消费／产出合同、可观察断言和验证命令；不新增资料 AI 或单题预览业务，不重复实现候选已通过部分。
- Type consistency：is_enabled（DB）、isEnabled（实体）、enabled（API）一致；expected_enabled 只用于带既有 identity 的题目修订，无 identity 派生新题保持原新建语义，启停 API 不变；题库无 score，卷内保留 score_cents；QuestionBankService／assertCurrentUsable／enabledCandidates／planPaperSave 沿各自合同使用。
- Review Focus：卷分隔离由 Tasks 0／5／9，旧模板由 Tasks 3／8，迁移由 Tasks 1／2，同版本停用后修订及发布并发／历史由 Tasks 2／5／6／7／9，AI 旁路由 Tasks 2／3／4 固定。
- Dependency／ownership：导入与 AI、T2／考点／组卷共享 QuestionVersionService、Questions／Import 共享 types／tests 均串行；并行必须先证明 owner 无交叉。025 已占用，暂026／027 均须实施前复核。
- Evidence boundary：本期已进入实施和集成；逐项证据以验收记录为准。旧系统事实、已交接的无分值和人工 Tiptap 改动继续保留，未授权外部发布或开发库迁移不执行。
