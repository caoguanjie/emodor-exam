# 试题管理瘦身与题目启停 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 取消考点组和独立题目审核流，把试题管理收敛为直接入库、不可变版本、可恢复启停和历史快照安全兼容的题库工作台。

**Architecture:** 在 `question` 身份上新增唯一权威的 `is_enabled` 生命周期字段，内容继续由不可变 `question_version` 和 `current_version_id` 管理；新题、导入确认、AI 确认和修订直接创建当前版本并启用。新组卷只读取启用身份的当前版本并按题目 ID 去重，历史审核／考点字段只读保留，不进入当前业务判断。

**Tech Stack:** Node.js 22、NestJS 10、TypeORM 0.3、MySQL 8、Vue 3、TypeScript、Element Plus、Vitest、Node test runner、项目隔离 E2E 启动器。

**Spec:** `docs/superpowers/specs/2026-10-26-question-bank-slimming-design.md`

## Global Constraints

- 只支持 `single / multiple / judgment`；新建和修订只接受启用的 `easy / hard`，历史 `medium` 只读保留。
- 人工录题和修改保留 main 现有弹窗与保存链路，内容区按[最新融合设计](../specs/2026-10-26-manual-question-tiptap-design.md)接入 Tiptap；不新增独立试题设计器路由。组件/页面接入由该融合计划交付后复用，不退回旧 textarea。
- 新业务不再读写 `concept_id`；历史表、字段和冻结快照本期不物理删除。
- 不再产生或操作 `pending / approved / rejected` 审核流；旧审核字段只读保留，不伪造审核人、时间或原因。
- `question.is_enabled` 是新候选是否可用的唯一生命周期事实；启停不创建内容 revision。
- 已发布 release、个人题单、attempt、结果和统计必须继续读取冻结事实，当前启停不能改写历史。
- 迁移只追加，不修改既有迁移 checksum；不得在开发库或生产库运行迁移。
- 统一响应信封、严格 DTO 校验、无数据库外键、审计日志和受控媒体边界继续有效。
- 保存结果不确定时先读取权威详情／批次状态，不重复发送写请求。
- 保留现有未提交 `docs/ui/gemini.pen`，各任务只能暂存自己的明确文件，禁止 `git add .` 或 `git add -A`。

## Review Focus

- 旧 `pending/rejected` 题迁移后必须停用，恢复前重新校验当前版本，不能因移除审核而自动进入题池；由 Task 1、Task 2 的迁移与生命周期测试固定。
- 题目停用与试卷发布并发时，发布事务必须锁内重检并整体失败，不能留下部分 release；由 Task 6 的并发测试固定。
- 草稿已选题随后停用时必须保留可见并阻断发布，不能静默移除或仍然发布；由 Task 6、Task 7 的服务端和页面测试固定。
- 旧九列导入模板的非空 `concept` 必须明确报错，空列可兼容，新模板不得继续输出该列；由 Task 3 的解析和模板测试固定。
- AI 生成／重生成在确认前不得写 `question` 或 `question_version`，确认重试必须幂等；由 Task 4 的任务、批次和未知响应测试固定。

---

## File and Dependency Map

```text
Task 1  migration + Question.isEnabled
   ↓
Task 2  QuestionBankService + enable API + remove review permission
   ├──────────────┬─────────────────┐
   ↓              ↓                 ↓
Task 3 import     Task 4 AI preview Task 5 concept retirement
   └──────────────┴──────────┬──────┘
                             ↓
Task 6 candidates / paper draft / publish
                  ┌──────────┴──────────┐
                  ↓                     ↓
Task 7 question UI                Task 8 import / AI UI
                  └──────────┬──────────┘
                             ↓
Task 9 docs + E2E contracts
                             ↓
Task 10 full verification + acceptance record
```

Tasks 3、4、5 在 Task 2 接口冻结后可并行，文件 owner 不重叠；Tasks 7、8 在后端合同完成后可并行。Task 6 统一集成题池和发布边界，不能由多个 worker 同时修改 `paper-release.service.ts` 或 `paper.service.ts`。

### Task 1: 建立题目启停数据库事实

**Files:**
- Create: `database/migrations/025_question_lifecycle_slimming.sql`
- Modify: `database/init.sql:296-373`
- Modify: `server/src/entities/question.entity.ts:1-75`
- Create: `tests/question-lifecycle-migration.test.mjs`
- Modify: `tests/migration-catalog.test.mjs`
- Modify: `tests/migration-contract.test.mjs`
- Modify: `server/test/schema-migration.spec.ts`

**Interfaces:**
- Produces: `Question.isEnabled: boolean` 映射 `question.is_enabled TINYINT(1) NOT NULL DEFAULT 1`。
- Produces: 迁移规则 `approved -> is_enabled=1`，其它旧审核状态及未知值 `-> 0`。
- Preserves: `question.status`、`question_version.status`、审核元数据、`question_concept` 和所有 `concept_id`。

- [ ] **Step 1: 写迁移失败测试**

在 `tests/question-lifecycle-migration.test.mjs` 断言：迁移编号紧随 024；添加并回填 `is_enabled`；重复执行安全；不包含 `DROP question_concept`、`DROP concept_id` 或删除审核历史列；`database/init.sql` 与实体字段一致。给 `migration-contract` 增加同样的列、索引和 checksum 续跑约束。

- [ ] **Step 2: 运行迁移测试确认失败**

Run: `node --test tests/question-lifecycle-migration.test.mjs tests/migration-catalog.test.mjs tests/migration-contract.test.mjs`

Expected: FAIL，提示 025 迁移或 `is_enabled` 缺失。

- [ ] **Step 3: 实现 025 迁移和实体映射**

迁移使用项目既有 `@migration/@check` 协议：添加列后显式 `UPDATE question SET is_enabled = CASE WHEN status='approved' THEN 1 ELSE 0 END`，再建立候选索引 `(is_enabled,category_id,type,difficulty,current_version_id)`。`init.sql` 新装默认启用；实体添加 `@Column({name:'is_enabled',type:'tinyint',width:1,default:1}) isEnabled:boolean`。

- [ ] **Step 4: 运行迁移和服务端编译测试**

Run: `node --test tests/question-lifecycle-migration.test.mjs tests/migration-catalog.test.mjs tests/migration-contract.test.mjs && npm --prefix server run build && npm --prefix server test -- schema-migration.spec.ts`

Expected: 全部 PASS。

- [ ] **Step 5: 提交 Task 1**

```bash
git add database/migrations/025_question_lifecycle_slimming.sql database/init.sql server/src/entities/question.entity.ts tests/question-lifecycle-migration.test.mjs tests/migration-catalog.test.mjs tests/migration-contract.test.mjs server/test/schema-migration.spec.ts
git commit -m "feat(题库): 建立题目启停数据事实"
```

### Task 2: 用题库生命周期替换审核服务和权限

**Files:**
- Create: `server/src/modules/questions/question-bank.service.ts`
- Delete: `server/src/modules/ai/question-review.service.ts`
- Modify: `server/src/modules/questions/question-version.service.ts`
- Modify: `server/src/modules/questions/question.dto.ts`
- Modify: `server/src/modules/ai/ai.controller.ts`
- Modify: `server/src/app.module.ts`
- Modify: `server/src/modules/access/permission-catalog.ts`
- Modify: `server/src/common/guards/permissions.guard.ts`
- Modify: `database/seed.mjs`
- Create: `database/migrations/026_question_review_permission_cleanup.sql`
- Modify: `tests/migration-catalog.test.mjs`
- Modify: `tests/migration-contract.test.mjs`
- Modify: `server/test/question-bank.spec.ts`
- Modify: `server/test/admin-slimming.spec.ts`
- Modify: `server/test/permissions-any.spec.ts`

**Interfaces:**
- Consumes: `Question.isEnabled` from Task 1。
- Produces: `QuestionBankService.list(query: QuestionListQueryDto)`，query 使用 `enabled?: boolean`，不接受 `status`、`concept_id`。
- Produces: `QuestionBankService.setEnabled(id:string, enabled:boolean, expectedVersionId:string|null, actor:{id:number;name:string}, ip:string|null)`。
- Produces: `PUT /ai/questions/:id/enabled` body `{enabled:boolean, expected_version_id:string|null}`，权限 `questions:write`。
- Produces: 列表／详情 `enabled:boolean`；不再输出当前业务审核字段和 `concept_id`。

- [ ] **Step 1: 写生命周期和权限失败测试**

在 `question-bank.spec.ts` 增加：人工创建启用；修订启用并生成新 revision；停用不建 revision；重复停用幂等且不重复审计；恢复执行当前版本完整校验；错误 `expected_version_id` 返回 40940；列表默认／显式 enabled 过滤；旧 pending/rejected 只由 `isEnabled` 决定。权限测试断言 `questions:review` 不再注册、review URL 不存在、write 可启停；迁移测试断言 026 只清理该权限及角色关系且可重复执行。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `npm --prefix server test -- question-bank.spec.ts admin-slimming.spec.ts permissions-any.spec.ts`

Expected: FAIL，提示 `QuestionBankService`、enabled DTO 或新路由缺失。

- [ ] **Step 3: 实现 `QuestionBankService`**

从旧服务迁入 list/get/history/create/edit，但移除 review 和直接重生成写入。`setEnabled` 在事务中锁定 Question，比较 `expectedVersionId`；恢复时调用 `QuestionVersionService.assertCurrentUsable(questionId, manager)`，成功后写 `isEnabled` 并提交后审计。修订服务固定新 draft `conceptId=undefined`，写入成功后设置 `isEnabled=true`。

- [ ] **Step 4: 收敛版本创建语义**

把 `QuestionVersionService.create/createMany/revise` 的当前业务路径改为直接创建兼容 `status='approved'` 的 revision，但 `approvedBy/approvedAt/reviewed*` 保持 null；删除 `reviewCurrent/approve` 的当前调用。新增 `assertCurrentUsable(questionId, manager)`，只校验当前版本、类别、启用难度、题型、内容、来源和媒体，不读取旧审核状态。

- [ ] **Step 5: 更新 Controller、DTO、Provider 和权限**

`AiController` 注入 `QuestionBankService`，删除 review 与考点路由（考点主体清理在 Task 5），增加 enabled 路由。DTO 删除 review 类型、status/concept query key，新增严格布尔 enabled DTO。移除 `questions:review` 权限目录、种子、默认角色及 path fallback；追加 026 迁移删除对应 role permission 和 permission 行，但不碰其它同名 `ai:review/papers:review`，也不改写已提交的 025。

- [ ] **Step 6: 运行服务端定向测试和构建**

Run: `npm --prefix server test -- question-bank.spec.ts admin-slimming.spec.ts permissions-any.spec.ts && node --test tests/migration-catalog.test.mjs tests/migration-contract.test.mjs && npm --prefix server run build`

Expected: 全部 PASS，源码不再注册 `/questions/:id/review`。

- [ ] **Step 7: 提交 Task 2**

```bash
git add server/src/modules/questions/question-bank.service.ts server/src/modules/ai/question-review.service.ts server/src/modules/questions/question-version.service.ts server/src/modules/questions/question.dto.ts server/src/modules/ai/ai.controller.ts server/src/app.module.ts server/src/modules/access/permission-catalog.ts server/src/common/guards/permissions.guard.ts database/seed.mjs database/migrations/026_question_review_permission_cleanup.sql tests/migration-catalog.test.mjs tests/migration-contract.test.mjs server/test/question-bank.spec.ts server/test/admin-slimming.spec.ts server/test/permissions-any.spec.ts
git commit -m "feat(题库): 以启停生命周期替换审核流"
```

### Task 3: 收敛文件导入和参考题 AI 确认

**Files:**
- Modify: `server/src/modules/questions/question-import-format.ts`
- Modify: `server/src/modules/questions/question-import.service.ts`
- Modify: `server/src/modules/questions/question-import.controller.ts`
- Modify: `server/src/modules/questions/ai-question-import.service.ts`
- Modify: `server/src/modules/questions/ai-question-import.controller.ts`
- Modify: `server/test/question-import.spec.ts`
- Modify: `server/test/question-import-workflow.spec.ts`
- Modify: `server/test/ai-question-import.spec.ts`
- Modify: `tests/training-question-import.mjs`
- Modify: `tests/training-ai-question-import.mjs`

**Interfaces:**
- Consumes: Task 2 的直接启用 `QuestionVersionService.createMany`。
- Produces: 新模板字段 `category,type,difficulty,stem,options,answer,analysis,score`。
- Produces: 旧九列模板仅允许空 `concept`；非空行错误码／文案固定为“考点组已取消，请清空后重试”。
- Produces: 普通文件和 `questions_ai` 批次确认回执中的题目均 `enabled=true`。

- [ ] **Step 1: 写模板、预检、确认失败测试**

覆盖新八列表头、旧九列空 concept 兼容、非空 concept 行失败、重复指纹不含 concept、确认直接启用、整批事务失败不留题目、相同选择幂等和未知响应后 GET 对账。

- [ ] **Step 2: 运行导入测试确认失败**

Run: `npm --prefix server test -- question-import.spec.ts question-import-workflow.spec.ts ai-question-import.spec.ts`

Expected: FAIL，显示模板仍含 concept 或 AI 确认仍创建 pending。

- [ ] **Step 3: 修改格式和普通导入**

`parseQuestionImportFile` 同时识别新八列和旧九列；`QuestionImportService` 删除 `resolveConcept` 和 concept 指纹／DTO，所有 `QuestionDraft.conceptId` 固定 undefined。模板下载只生成八列。确认事务复用 Task 2 直接启用创建路径，回执返回 `enabled:true`。

- [ ] **Step 4: 修改参考题 AI 批次**

从 `AiQuestionImportService.generatedDraft`、更新 DTO、下载列和 prompt 固定元数据中删除 concept。`commitAiGenerated` 选择确认后直接启用；批次预览状态不再使用“待审核”文案或字段。

- [ ] **Step 5: 运行服务端和隔离契约测试**

Run: `npm --prefix server test -- question-import.spec.ts question-import-workflow.spec.ts ai-question-import.spec.ts`

Expected: 全部 PASS；完整 HTTP 合同留给 Task 9 的隔离 `run-e2e` 验证。

- [ ] **Step 6: 提交 Task 3**

```bash
git add server/src/modules/questions/question-import-format.ts server/src/modules/questions/question-import.service.ts server/src/modules/questions/question-import.controller.ts server/src/modules/questions/ai-question-import.service.ts server/src/modules/questions/ai-question-import.controller.ts server/test/question-import.spec.ts server/test/question-import-workflow.spec.ts server/test/ai-question-import.spec.ts tests/training-question-import.mjs tests/training-ai-question-import.mjs
git commit -m "feat(导题): 确认后直接启用并取消考点列"
```

### Task 4: 把资料 AI 出题和单题重生成改为预览确认

**Files:**
- Modify: `server/src/modules/ai/question-generation.service.ts`
- Modify: `server/src/modules/questions/question-import.service.ts`
- Modify: `server/src/modules/ai/ai.controller.ts`
- Modify: `server/src/modules/questions/ai-question-import.controller.ts`
- Modify: `server/src/modules/questions/ai-question-import.service.ts`
- Modify: `server/test/question-bank.spec.ts`
- Modify: `server/test/ai-question-import.spec.ts`
- Modify: `tests/training-question-bank.mjs`

**Interfaces:**
- Consumes: Task 3 的生成批次预览、逐行修改、幂等确认能力。
- Produces: material AI 批次 kind `questions_material_ai`，生成完成只返回 `batch_id` 和预览，不写题库。
- Produces: `POST /ai/questions/:id/regenerate-preview` → `{batch_id,row}`。
- Produces: `POST /ai/questions/:id/regenerate-confirm` body `{batch_id,row_id,expected_version_id}` → 新 `saved_version_id`、`enabled:true`。
- Removes: 旧 `POST /ai/questions/:id/regenerate` 直接创建 revision 的语义。

- [ ] **Step 1: 写“确认前零写入”失败测试**

资料 AI 完成和单题重生成预览后断言 question/version repository 零写入；确认时验证 owner、kind、来源资料版本、题目 identity 和 expected version；相同确认重试返回原回执，不同集合或陈旧版本失败且不写新 revision。

- [ ] **Step 2: 运行 AI 定向测试确认失败**

Run: `npm --prefix server test -- ai-question-import.spec.ts question-bank.spec.ts`

Expected: FAIL，显示旧生成／重生成仍直接持久化。

- [ ] **Step 3: 扩展生成批次合同**

`QuestionGenerationService.runTaskInner` 将已验证生成行交给 `QuestionImportService.previewAiGenerated(..., kind='questions_material_ai')`，保留可信 material/version/category/difficulty/source page 信息；task status 只暴露批次指针和计数。不得把模型返回的来源或启用状态写入批次。

- [ ] **Step 4: 实现单题重生成预览／确认**

预览复用原题当前可信来源生成单行、保存 owner-bound 批次；确认事务再次锁 identity、比较 `expected_version_id`、校验批次来源，调用 `revise` 创建新版本并启用。旧直接 regenerate 路由移除或返回 404，不保留旁路。

- [ ] **Step 5: 运行定向测试和构建**

Run: `npm --prefix server test -- ai-question-import.spec.ts question-bank.spec.ts && npm --prefix server run build`

Expected: 全部 PASS，确认前数据库零写入。

- [ ] **Step 6: 提交 Task 4**

```bash
git add server/src/modules/ai/question-generation.service.ts server/src/modules/questions/question-import.service.ts server/src/modules/ai/ai.controller.ts server/src/modules/questions/ai-question-import.controller.ts server/src/modules/questions/ai-question-import.service.ts server/test/question-bank.spec.ts server/test/ai-question-import.spec.ts tests/training-question-bank.mjs
git commit -m "feat(AI导题): 改为预览确认后启用"
```

### Task 5: 让考点组从当前作者和设计器合同退场

**Files:**
- Delete: `server/src/modules/questions/question-concept.service.ts`
- Modify: `server/src/modules/questions/question-version.service.ts`
- Modify: `server/src/modules/questions/question-validator.ts`
- Modify: `server/src/modules/questions/question-authoring-codec.ts`
- Modify: `server/src/modules/questions/question-authoring.service.ts`
- Modify: `server/src/common/question-authoring.ts`
- Modify: `server/src/app.module.ts`
- Modify: `web/src/api/question-document-types.ts`
- Modify: `web/src/api/training-types.ts`
- Modify: `web/src/components/question-designers/PaperDesigner.vue`
- Modify: `web/src/components/question-designers/QuestionProperties.vue`
- Modify: `web/src/components/question-designers/paper-designer-state.ts`
- Modify: `web/src/views/admin/PaperDetail.vue`
- Modify: `server/test/question-authoring-service.spec.ts`
- Modify: `server/test/question-editor-state.spec.ts`
- Modify: `web/src/components/question-designers/__tests__/main-contract-adapter.spec.ts`
- Modify: `web/src/components/question-designers/__tests__/paper-designer-state.spec.ts`
- Modify: `web/src/components/question-designers/__tests__/paper-designer.spec.ts`
- Modify: `tests/fixtures/question-authoring-v3/rich-authoring.json`

**Interfaces:**
- Consumes: Task 2 当前写入固定 `conceptId=undefined`。
- Produces: 当前 AuthoringBundle、designer state 和写 DTO 不含 concept；读取旧 authoring JSON 时忽略历史 concept，但不改写旧版本。
- Produces: 设计器题目属性只保留类别、难度、题型、分值等当前字段。

- [ ] **Step 1: 写当前合同不含 concept 的失败测试**

测试新作者原稿、表单适配、试卷设计器保存 payload 和候选 UI 均不出现 concept；载入旧 fixture 的 concept 不崩溃但下一次新 revision 输出 null／省略；服务端严格 DTO 拒绝新写请求携带 concept。

- [ ] **Step 2: 运行作者与设计器测试确认失败**

Run: `npm --prefix server test -- question-authoring-service.spec.ts question-editor-state.spec.ts && npm --prefix web test -- src/components/question-designers/__tests__/main-contract-adapter.spec.ts src/components/question-designers/__tests__/paper-designer-state.spec.ts src/components/question-designers/__tests__/paper-designer.spec.ts`

Expected: FAIL，指出类型、payload 或界面仍有 concept。

- [ ] **Step 3: 删除当前考点服务和写合同**

删除 Controller 注入、Provider 和 `QuestionConceptService`；QuestionVersion 写关系只锁类别，不再 `assertCompatible`。从 DTO、validator、authoring codec 和作者原稿当前类型删除 concept。历史 entity／DDL／snapshot 字段保留，不注册 CRUD。

- [ ] **Step 4: 删除设计器和固定卷候选中的考点 UI**

移除 `QuestionProperties` 考点选择、新建、分页、远程搜索及 PaperDetail 候选考点列；designer state 序列化不再输出 concept。兼容读取仅丢弃 UI 不使用的旧字段，不能重写旧数据库版本。

- [ ] **Step 5: 运行定向测试、类型检查和构建**

Run: `npm --prefix server test -- question-authoring-service.spec.ts question-editor-state.spec.ts && npm --prefix web test -- src/components/question-designers/__tests__/main-contract-adapter.spec.ts src/components/question-designers/__tests__/paper-designer-state.spec.ts src/components/question-designers/__tests__/paper-designer.spec.ts && npm --prefix web exec vue-tsc -- --noEmit && npm --prefix web run build`

Expected: 全部 PASS，当前 web/server 写合同不再含 concept。

- [ ] **Step 6: 提交 Task 5**

```bash
git add server/src/modules/questions/question-concept.service.ts server/src/modules/questions/question-version.service.ts server/src/modules/questions/question-validator.ts server/src/modules/questions/question-authoring-codec.ts server/src/modules/questions/question-authoring.service.ts server/src/common/question-authoring.ts server/src/app.module.ts web/src/api/question-document-types.ts web/src/api/training-types.ts web/src/components/question-designers/PaperDesigner.vue web/src/components/question-designers/QuestionProperties.vue web/src/components/question-designers/paper-designer-state.ts web/src/views/admin/PaperDetail.vue server/test/question-authoring-service.spec.ts server/test/question-editor-state.spec.ts web/src/components/question-designers/__tests__/main-contract-adapter.spec.ts web/src/components/question-designers/__tests__/paper-designer-state.spec.ts web/src/components/question-designers/__tests__/paper-designer.spec.ts tests/fixtures/question-authoring-v3/rich-authoring.json
git commit -m "refactor(题库): 取消当前考点组合同"
```

### Task 6: 让候选、抽题和发布统一服从启停状态

**Files:**
- Modify: `server/src/modules/questions/question-version.service.ts`
- Modify: `server/src/modules/ai/paper.service.ts`
- Modify: `server/src/modules/exams/paper-release.service.ts`
- Modify: `server/src/modules/exams/sampling.service.ts`
- Modify: `server/src/modules/exams/paper-admin.controller.ts`
- Modify: `server/src/entities/paper-question.entity.ts`
- Modify: `server/test/paper-release.spec.ts`
- Modify: `server/test/paper-release-fix1.spec.ts`
- Modify: `server/test/sampling.spec.ts`
- Modify: `tests/support/paper-release-concurrency-checks.mjs`
- Modify: `web/tests/paper-management-state.test.mjs`

**Interfaces:**
- Consumes: `Question.isEnabled`、Task 2 的当前版本校验、Task 5 的无考点当前合同。
- Produces: `QuestionVersionService.enabledCandidates(filter:CandidateFilter, manager?:EntityManager)`。
- Produces: 新固定／随机组卷唯一键始终是 `questionId`。
- Produces: 草稿题目 view 含 `enabled:boolean`；停用项可见但 publish 返回题目 ID 缺口并整体回滚。

- [ ] **Step 1: 写题池、草稿和并发发布失败测试**

覆盖：enabledCandidates 只返回启用 identity 的精确 current version；旧 version.status 不影响；同 concept 的两个题仍可同时入新卷；同 question 不能重复；停用题不能新增；已选后停用仍在草稿 view；发布阻断；停用与发布并发只允许一个合法结果；release 后停用不改变预览、开考和评分。

- [ ] **Step 2: 运行发布与采样测试确认失败**

Run: `npm --prefix server test -- paper-release.spec.ts paper-release-fix1.spec.ts sampling.spec.ts`

Expected: FAIL，显示仍使用 approved 或 concept 分组。

- [ ] **Step 3: 实现启用候选查询和题目 ID 去重**

`enabledCandidates` 在调用方事务的 manager 中 join/锁定 question，要求 `is_enabled=1` 且 `current_version_id=version.id`；移除 version.status 条件。`poolKey`、`questionGroupKey` 和固定卷重复检查只返回 `question:<questionId>`。

- [ ] **Step 4: 实现草稿可见、发布阻断和 release 冻结**

候选添加拒绝停用题；草稿详情读取已选精确版本并补 `enabled`，不因停用删行。发布事务锁题后重新校验 enabled/current version，任一失败返回可定位题目 ID 且不创建 release。历史 release、attempt 不调用当前 enabled 查询。

- [ ] **Step 5: 运行定向测试和并发探针**

Run: `npm --prefix server test -- paper-release.spec.ts paper-release-fix1.spec.ts sampling.spec.ts && node --test web/tests/paper-management-state.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 6: 提交 Task 6**

```bash
git add server/src/modules/questions/question-version.service.ts server/src/modules/ai/paper.service.ts server/src/modules/exams/paper-release.service.ts server/src/modules/exams/sampling.service.ts server/src/modules/exams/paper-admin.controller.ts server/src/entities/paper-question.entity.ts server/test/paper-release.spec.ts server/test/paper-release-fix1.spec.ts server/test/sampling.spec.ts tests/support/paper-release-concurrency-checks.mjs web/tests/paper-management-state.test.mjs
git commit -m "feat(组卷): 按启用题目生成并冻结试卷"
```

### Task 7: 瘦身试题管理页面和人工录题

**Files:**
- Modify: `web/src/views/admin/Questions.vue`
- Modify: `web/src/components/QuestionEditor.vue`
- Modify: `web/src/components/QuestionPreview.vue`
- Modify: `web/src/api/training-types.ts`
- Modify: `web/src/api/question-authoring.ts`
- Modify: `web/tests/question-bank-ui.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `enabled` 列表字段和 `/questions/:id/enabled`。
- Consumes: Task 4 的重生成预览／确认 API。
- Produces: 主筛选 `category_id/keyword`，高级筛选 `type/difficulty/enabled`；默认 `enabled=true`。
- Produces: 启用行“预览／修订／停用”，停用行“预览／修订／恢复”。

- [ ] **Step 1: 写页面结构和行为失败测试**

断言统计卡、`QUESTION INDEX`、审核状态、通过／驳回、考点控件和 `questions:review` 不再出现；人工录题、试题导入、类别、题干搜索、更多筛选、更新时间和启停操作存在；筛选提交／重置回第 1 页；write-only 空态正确；预览先打开且历史失败可重试；停用题修订按钮显示“保存并启用”。

- [ ] **Step 2: 运行 UI 测试确认失败**

Run: `node --test web/tests/question-bank-ui.test.mjs`

Expected: FAIL，命中旧统计、审核或考点结构。

- [ ] **Step 3: 重构 `Questions.vue` 页面布局**

保留现有 FitsTable 体系和表单弹窗，不另造页面框架。删除统计卡和概念请求状态；增加明确查询／重置／更多筛选和启停 API；把来源、revision、旧审核元数据移入预览兼容信息。行操作中的 AI 重生成打开 Task 4 预览，不直接写入。

- [ ] **Step 4: 精简 `QuestionEditor` 和预览失败边界**

移除 concept props/events/UI；保存文案按新建、启用修订、停用修订区分。`openView` 先显示 current view，再独立加载 history；失败显示内联重试，不关闭预览。

- [ ] **Step 5: 运行 UI、类型和构建验证**

Run: `node --test web/tests/question-bank-ui.test.mjs && npm --prefix web exec vue-tsc -- --noEmit && npm --prefix web run build`

Expected: 全部 PASS。

- [ ] **Step 6: 提交 Task 7**

```bash
git add web/src/views/admin/Questions.vue web/src/components/QuestionEditor.vue web/src/components/QuestionPreview.vue web/src/api/training-types.ts web/src/api/question-authoring.ts web/tests/question-bank-ui.test.mjs
git commit -m "feat(试题管理): 精简页面并接入启停操作"
```

### Task 8: 完成导入和 AI 确认页面闭环

**Files:**
- Modify: `web/src/views/admin/QuestionImport.vue`
- Modify: `web/src/utils/question-import-workflow.ts`
- Modify: `web/src/api/training-types.ts`
- Modify: `web/tests/question-bank-ui.test.mjs`

**Interfaces:**
- Consumes: Tasks 3、4 的八列模板、有效行预览、批次更新／重生成／确认和 `enabled:true` 回执。
- Produces: 文件导入“有效题预览 → 选择确认 → 已启用”；AI 导入“生成预览 → 修改／重生成 → 选择确认 → 已启用”。

- [ ] **Step 1: 写导入页面失败测试**

覆盖普通文件有效题逐题预览、错误行保留、确认选择集合、确认按钮文案“确认导入并启用”、AI 确认后返回题库、未知响应锁定原批次并 GET 对账、页面离开后迟到响应不导航；页面中不存在考点或待审核文案。

- [ ] **Step 2: 运行题库 UI 测试确认失败**

Run: `node --test web/tests/question-bank-ui.test.mjs`

Expected: FAIL，显示文件有效题不可预览或仍写“待审核”。

- [ ] **Step 3: 实现文件有效题预览和直接启用反馈**

复用 `QuestionPreview` 展示 valid rows，选择集合只允许本批 valid row ID。确认成功展示创建数量和“已启用”，随后导航 `/admin/questions`；保留失败行、重复行和修文件后重传路径。

- [ ] **Step 4: 更新 AI 工作流状态机和文案**

删除 pending-review 假设；确认成功以回执收口。资料 AI 和参考题 AI 复用同一预览组件，不混淆 batch kind 或 owner；单题重生成预览确认仍返回原题详情。

- [ ] **Step 5: 运行 UI、类型和构建验证**

Run: `node --test web/tests/question-bank-ui.test.mjs && npm --prefix web exec vue-tsc -- --noEmit && npm --prefix web run build`

Expected: 全部 PASS。

- [ ] **Step 6: 提交 Task 8**

```bash
git add web/src/views/admin/QuestionImport.vue web/src/utils/question-import-workflow.ts web/src/api/training-types.ts web/tests/question-bank-ui.test.mjs
git commit -m "feat(试题导入): 预览确认后直接启用"
```

### Task 9: 同步现行设计并升级全链 E2E

**Files:**
- Modify: `docs/design/README.md`
- Modify: `docs/design/01-需求分析.md`
- Modify: `docs/design/03-数据库设计.md`
- Modify: `docs/design/04-API设计.md`
- Modify: `docs/design/05-模块设计.md`
- Modify: `docs/design/06-关键流程.md`
- Modify: `docs/superpowers/plans/2026-10-22-training-demo-slimming.md`
- Modify: `docs/superpowers/specs/2026-10-23-main-question-paper-designer-integration-design.md`
- Modify: `tests/training-question-bank.mjs`
- Modify: `tests/training-question-import.mjs`
- Modify: `tests/training-ai-question-import.mjs`
- Modify: `tests/training-publishing.mjs`
- Modify: `tests/training-full-flow.mjs`
- Modify: `tests/main-question-designers.mjs`
- Modify: `tests/main-question-designers-compatibility.mjs`

**Interfaces:**
- Consumes: Tasks 1—8 的最终 API 和 UI 合同。
- Produces: 现行 8 册设计不再承诺题目审核或新业务考点；旧系统两册不改写历史事实。
- Produces: E2E 覆盖直接启用、停用／恢复、草稿阻断、历史 release 保持、AI 零写入至确认。

- [ ] **Step 1: 先修改 E2E 断言并观察旧实现不满足**

更新套件删除 review 调用，增加：人工／文件／AI 确认后直接出现在启用题池；停用后候选消失；草稿保留停用题且发布失败；恢复后发布成功；release 后停用不改变考试；新流程无 concept。逐条先确认测试能在缺少对应条件或回归突变时失败，再在当前候选实现上运行，避免只断言固定成功响应。

- [ ] **Step 2: 运行五个隔离 E2E 套件**

Run:

```bash
node tests/run-e2e.mjs --ephemeral --suite training-question-bank
node tests/run-e2e.mjs --ephemeral --suite training-question-import
node tests/run-e2e.mjs --ephemeral --suite training-ai-question-import
node tests/run-e2e.mjs --ephemeral --suite training-publishing
node tests/run-e2e.mjs --ephemeral --suite main-question-designers
```

Expected: 全部 PASS；每套使用独立临时数据库。

- [ ] **Step 3: 同步现行设计文档**

将审核状态机改为启停生命周期，候选从 approved 改为 enabled current version，删除新业务考点合同、模板列、API 和 UI；保留历史字段／快照解释。旧系统两册只增加指向现行覆盖设计的说明（如确有需要），不得把新功能伪装成旧站事实。

- [ ] **Step 4: 运行文档和术语残留检查**

Run:

```bash
rg -n "questions:review|待审核|审核通过|驳回|question-concepts|新建考点|同考点" docs/design server/src web/src database/seed.mjs
```

Expected: 只剩明确标记为历史兼容、旧系统事实或实名等其它业务域的命中；逐条登记而不是盲目要求零结果。

- [ ] **Step 5: 提交 Task 9**

```bash
git add docs/design/README.md docs/design/01-需求分析.md docs/design/03-数据库设计.md docs/design/04-API设计.md docs/design/05-模块设计.md docs/design/06-关键流程.md docs/superpowers/plans/2026-10-22-training-demo-slimming.md docs/superpowers/specs/2026-10-23-main-question-paper-designer-integration-design.md tests/training-question-bank.mjs tests/training-question-import.mjs tests/training-ai-question-import.mjs tests/training-publishing.mjs tests/training-full-flow.mjs tests/main-question-designers.mjs tests/main-question-designers-compatibility.mjs
git commit -m "docs(题库): 同步启停生命周期与全链契约"
```

### Task 10: 完整验证和验收记录

**Files:**
- Create: `review/2026-10-26-question-bank-slimming-acceptance.md`
- Modify only if failures prove necessary: Task 1—9 owned files and their tests

**Interfaces:**
- Consumes: 全部实现提交。
- Produces: 按自动化、浏览器／PC、未验证、部署四类分层的验收证据。

- [ ] **Step 1: 运行静态和构建验证**

Run:

```bash
git diff --check
npm --prefix server run build
npm --prefix web exec vue-tsc -- --noEmit
npm --prefix web run build
```

Expected: 全部 exit 0。

- [ ] **Step 2: 运行完整单元测试**

Run:

```bash
npm --prefix server test
npm --prefix web test
node --test web/tests/question-bank-ui.test.mjs web/tests/paper-management-state.test.mjs
```

Expected: 全部 PASS；如出现既有无关失败，必须给出基线复现证据，不能把它计作本任务通过。

- [ ] **Step 3: 运行完整隔离 E2E**

Run: `node tests/run-e2e.mjs --ephemeral --suite all`

Expected: 所有注册套件逐个使用隔离环境并 PASS；不得连接开发库。

- [ ] **Step 4: 做 PC 浏览器验收**

验证：紧凑列表和筛选；人工录题直接启用；文件／AI 预览确认；修订；停用／恢复；停用题草稿提示与发布阻断；已发布卷和历史考试仍可读取。截图写入 gitignore 的 `gui-test-screenshots/`，不提交仓库。

- [ ] **Step 5: 独立 reviewer 审查**

审查重点：审核旁路是否残留、旧 pending 是否误启用、考点是否仍影响新抽题、停用／发布并发、历史 release／attempt 是否回读当前题库、权限和媒体泄漏。实质问题修复后重跑受影响测试。

- [ ] **Step 6: 写验收记录并提交**

记录每条命令、实际结果、浏览器证据、迁移仅在测试库执行、未推送／未部署及未验边界。

```bash
git add review/2026-10-26-question-bank-slimming-acceptance.md
git commit -m "test(题库): 记录试题管理瘦身验收"
```

## Plan Self-Review

- Spec coverage：§1—§11 分别由 Tasks 1—10 覆盖；旧状态迁移、启停、考点退场、AI 确认、页面瘦身、草稿阻断、历史冻结和文档同步均有 owner。
- Step scan：每个任务先产生可观察失败，再实现一个明确合同，随后定向验证和 scoped commit；没有以“处理边界情况”代替具体行为。
- Type consistency：统一使用 `Question.isEnabled`（实体）、`enabled`（API）、`is_enabled`（数据库）；候选方法统一为 `enabledCandidates`；启停写接口统一为 `PUT /ai/questions/:id/enabled`。
- Review Focus：五项高风险分别落在 Tasks 1/2、6、6/7、3、4 的命名测试中。
- Proportion：计划描述接口、测试和顺序，不转录实现函数体；具体 codec 和 SQL 仍由任务 worker 按现有模式实现。
