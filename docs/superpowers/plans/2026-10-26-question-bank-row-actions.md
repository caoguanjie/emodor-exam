# 题库状态开关与逻辑删除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 状态列使用学员管理同款开关，操作列提供居中的预览／修改／删除，逻辑删除题目但保留历史。

**Architecture:** 在稳定题目身份新增普通 deleted_at 列；当前题库与新候选显式排除，历史读取不隐式过滤。删除和启停／修订／发布共享现有身份锁与版本基线，前端复用确认值、逐题忙碌与 GET 对账。

**Tech Stack:** NestJS、TypeORM、MySQL 8、Vue 3、Element Plus、Vitest、隔离迁移与 HTTP E2E。

**Spec:** ../specs/2026-10-26-question-bank-row-actions-design.md

**执行方式：** 用户已要求在当前项目实施并确认逻辑删除与本地升级授权；沿用 Astra 并行分工，不新增 SDD 流程或提交步骤。根负责集成、文档、HTTP 验证和获授权的本地升级。

## Global Constraints

- 不物理删除身份、版本、媒体引用、试卷关联、发布快照或考试；旧题库分值与已评分结果不动。
- 不使用 TypeORM DeleteDateColumn，不把全局历史查询改成自动过滤；不建立回收站或已删恢复接口。
- DELETE 仅 questions:write，显式 expected_version_id（可 null）与 expected_enabled:boolean；原信封、DTO 和审计继续有效。
- 029 仅追加，替代最后有效 question 全形状 probe；不得改 000—028 或旧登记 checksum。
- 只升级已授权的本地 ruleexam；先备份并核对 022 原制品，不读出或打印凭据，不涉及生产。
- 保留工作树其它会话改动，前后端不同 owner 并行，不暂存、提交或推送。

## Review Focus

- 并发修订／恢复不能复活已删身份：Task 1 在身份锁内检查并测试。
- 发布与删除并发不能产生失效新卷或改变已有快照：Task 3 真实数据库验证。
- DDL 已落盘、progress 未写的恢复不能重加列或误判旧探针：Task 1 隔离迁移测试。
- 不确定写结果不能重发或污染另一行／页：Task 2 延迟响应与 GET 对账测试。
- 旧无 release 考试和媒体读取不能被普通 deleted_at 过滤误伤：Task 3 固定历史兼容回归。

### Task 1: 后端逻辑删除与存储（独占后端 worker）

**Files:** database/migrations/029_question_soft_delete.sql、database/init.sql、server/src/entities/question.entity.ts、server/src/modules/questions/question-bank.service.ts、question-version.service.ts、question.dto.ts、server/src/modules/ai/ai.controller.ts；server/test/question-bank.spec.ts、question-authoring-service.spec.ts 及必要版本测试；tests/question-soft-delete-migration.test.mjs、迁移目录／合同和 schema-migration 测试。

**Interfaces:** 新增 DELETE /ai/questions/:id；body 与 receipt 按 Spec。普通 deletedAt 字段只影响显式当前业务。QuestionBankService.softDelete 在事务内锁定、比较双令牌、首次写标记并停用，重复回原时间；当前 getOne 已删 40401，history 保留。编辑、恢复、作者提交和 assertCurrentUsable 拒绝已删。

- [x] 写并运行失败测试：删除不增 revision／不删行，双令牌冲突、重复回执、全部列表排除、恢复和 authoring 拒绝；029 漂移与续跑。
- [x] 实现最小接口、显式过滤和 029，保持 legacy／release／attempt 读取原行为。
- [x] 定向服务端与隔离迁移测试 PASS，交接文件和实际命令；不得在开发库自行迁移。

### Task 2: 列布局与行内操作（独占 Web worker，与 Task 1 并行）

**Files:** web/src/views/admin/Questions.vue、web/tests/question-bank-ui.test.mjs、web/src/components/__tests__/question-list-actions.spec.ts；必要时窄改 question-bank-without-scores.spec.ts 的操作按钮查找；其它人工录题和导入改动保留。

**Interfaces:** 原 PUT 返回 QuestionView；DELETE Axios config.data 使用 Task 1 的请求／回执，40401 用于当前详情对账。状态开关 68 px，操作列 180 px、align/header-align=center，按钮组居中。

- [x] 写并运行失败测试：真实开关、权限、逐题 busy、不确认启停、未知响应只 GET、三操作和居中列、删除确认／取消／幂等对账／分页。
- [x] 复用现有 openEdit 与用户管理开关尺寸，实现互锁和可靠状态，不以停用冒充删除。
- [x] 相关 Node 与 Vitest PASS、类型检查通过，交根构建；不改全局滚动条或 Users.vue。

### Task 3: 集成、历史边界与本地联调（root）

**Files:** tests/training-question-bank.mjs、tests/support/paper-release-concurrency-checks.mjs 或专用逻辑删除检查；docs/design/01／03／04／05／06／README、原瘦身 spec 的范围引用、AGENTS 迁移目录；review/2026-10-26-question-bank-row-actions.md。

- [x] HTTP 测试删除退出列表／候选、草稿仍在但发布拒绝、既有发布与考试不变、并发删／发布合法、旧无 release 读取不受影响；使用自有临时数据库。
- [x] 独立 reviewer 审查实际后端／Web／迁移增量，修复实质问题并复验；源文档同步实际字段与接口。
- [x] 最终运行 server/web tests、必要 Node／迁移测试、Web 类型检查及 node scripts/build.mjs web；不得把隔离测试写成生产验收。
- [x] 先备份本地开发库，使用已登记匹配的 022 原制品走原 runner 仅升级 029，再重启当前本地 API；核对旧业务表及 registry 保留。
- [x] 浏览器核对状态开关、列宽／居中、修改和预览，对新建明确验收题执行逻辑删除；记录实际证据和未验边界。

### Task 4: 用户15:20补充的题型／难度独立Tag列

**Files:** Questions.vue、question-list-actions.spec.ts，必要时窄调Node题库UI；其它代码不变。

- [x] 先失败真实组件测试：题型与难度独立表头，各自Element Plus Tag，三题型／easy／hard／null与历史标签不篡改。
- [x] 最小复用导入预览plain语义色与现有全局圆角，保留68px开关、180px居中操作和所有并发保护。
- [x] 定向与完整Web、Node、类型、原子构建、独立增量复审和浏览器Tag核对通过；不重复迁移或后端全套。

### Task 5: 用户15:32补充的六色基础Tag与紧凑列

**Files:** Questions.vue、question-list-actions.spec.ts及本文档的窄同步；不改全局样式、导入预览、表单或数据。

- [x] 调整5组真实Tag组件断言并新增紧凑列回归，先取得6项RED：旧灰色、plain和104px宽度不满足要求。
- [x] 题型单选蓝／多选紫／判断青，难度未知灰／简单绿／困难红；使用light、小圆角边框Tag，仅局部覆盖全局胶囊样式；列宽84／80px，不改历史难度或启停／删除逻辑。
- [x] 6项定向GREEN、完整Web511/511、vue-tsc和原子Web构建通过；复用独立reviewer核对固定候选，浏览器核对可用数据的样式与列宽，记录未验边界。
