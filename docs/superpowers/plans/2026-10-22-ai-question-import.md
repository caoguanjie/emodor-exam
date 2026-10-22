# 试题菜单拆分与 AI 参考题生成 Implementation Plan

> **For workflow workers:** 按当前会话的 Astra 工作流并行实施和独立审查；本计划明确不使用 SDD。步骤使用 checkbox（`- [ ]`）跟踪。

**Goal:** 将考试管理拆成独立的试题、试卷、导入入口，并在导入页实现不保留参考文件的 easy/hard AI 生成、预览和待审核入库。

**Architecture:** 继续复用严格 9 列模板解析和导入批次事务；新增内存型 AI 参考题任务与 `questions_ai` 批次，只在确认时创建 pending 题目。前端复用 QuestionImport 页面和现有导入工作流，以两个 Tab 分隔普通文件导入与 AI 生成。

**Tech Stack:** NestJS、TypeORM、Redis 状态、Vue 3、TypeScript、Element Plus、Node test/Vitest、MySQL 8。

**Spec:** `docs/superpowers/specs/2026-10-22-ai-question-import-design.md`

## Global Constraints

- 不执行 SDD；按当前会话的 workflow 子代理编排实施与独立审查。
- 不保存参考文件或参考题正文；Redis 任务状态不得包含参考题文本。
- AI 生成只产生 easy/hard，生成阶段题目零写入，确认后统一 pending。
- 保留现有普通 Excel/TXT 导入、制度资料 AI 出题、试卷发布和未保存保护行为。
- 不提交 Git，除非用户另行明确要求。

## Review Focus

- 参考文件解析后是否仍可能写入数据库、Redis、磁盘、审计或日志。
- 模型是否能伪造类别、题型、考点、分值、难度、来源或审核状态。
- AI 任务和预览批次是否严格校验 owner、权限与 kind。
- 选择部分生成题确认时，批次回执、题目和 revision 是否同事务且幂等。
- 普通导入 approved 行为和制度资料 AI pending 行为是否保持原样。

---

### Task 1: AI 参考题生成与 pending 批次

**Files:**
- Create: `server/src/modules/questions/ai-question-import.service.ts`
- Create: `server/src/modules/questions/ai-question-import.controller.ts`
- Modify: `server/src/modules/questions/question-import-format.ts`
- Modify: `server/src/modules/questions/question-import.service.ts`
- Modify: `server/src/modules/questions/question-version.service.ts`
- Modify: `server/src/modules/questions/question-validator.ts`
- Modify: `server/src/modules/imports/import-batch.service.ts`
- Modify: `server/src/entities/import-batch.entity.ts`
- Modify: `server/src/app.module.ts`
- Test: `server/test/ai-question-import.spec.ts`

**Interfaces:**
- Produces: `POST /admin/questions/ai-import-tasks` multipart；`GET /admin/questions/ai-import-tasks/:id`；`GET/POST /admin/questions/ai-import-batches/:id[/commit]`。
- Produces: `AiQuestionImportService.start/status/readBatch/commit`，任务状态按 owner 隔离。
- Consumes: `parseQuestionImportFile()`、`AiGatewayService.chat()`、题目统一校验、导入批次事务。

- [x] 写失败测试：标准 xlsx/txt 参考题只产生 easy/hard，模型篡改可信字段被覆盖，参考题和生成阶段零写入。
- [x] 写失败测试：任务 owner/权限隔离、全部失败、部分失败、超时、任务缓存不含参考正文。
- [x] 实现内存任务和严格 JSON 解析；每道参考题最多生成一对 easy/hard，限制文件 5MB、参考行 50。
- [x] 扩展 `questions_ai` 批次和预览条目；批次只保存生成后的规范化 9 字段题。
- [x] 新增事务内 pending 创建路径；确认只接受服务端批次行号，写 `source=ai`、无制度版本。
- [x] 运行 `npm --prefix server test -- ai-question-import.spec.ts` 与 `npm --prefix server run build`。

### Task 2: 试题导入双 Tab 页面

**Files:**
- Modify: `web/src/views/admin/QuestionImport.vue`
- Modify: `web/src/utils/question-import-workflow.ts`
- Modify: `web/src/api/training-types.ts`
- Test: `web/tests/question-bank-ui.test.mjs`

**Interfaces:**
- Consumes: Task 1 的任务、批次读取和确认接口。
- Produces: 文件导入/AI 生成两个 Tab；easy/hard/全部结果筛选；默认选择有效行；下载、修改、单题重新生成和确认导入入口。

- [x] 写失败测试：AI Tab 上传后轮询任务，参考题不渲染为可导入行，只展示 easy/hard。
- [x] 写失败测试：有效行默认选中、异常行排除、按难度筛选、选行确认后跳转试题管理。
- [x] 实现双 Tab 与任务生命周期；离页清理轮询但不把文件放进状态存储。
- [x] 复用现有表格和导入样式，补齐生成结果修改、重新生成与 Excel/TXT 下载。
- [x] 运行 `node --test web/tests/question-bank-ui.test.mjs` 与 `npx --prefix web vue-tsc --noEmit`。

### Task 3: 菜单和列表职责拆分

**Files:**
- Modify: `web/src/router/index.ts`
- Modify: `web/src/views/admin/Questions.vue`
- Modify: `web/src/views/admin/Menus.vue`
- Modify: `database/init.sql`
- Create: `database/migrations/017_exam_question_navigation.sql`
- Test: `web/tests/admin-shell-regression.test.mjs`
- Test: `web/tests/router-access.test.mjs`
- Test: `tests/demo-slimming-migration.test.mjs`
- Test: `tests/migration-contract.test.mjs`

**Interfaces:**
- Produces: 考试管理依次显示试题管理、试卷管理、试题导入、考试记录。
- Produces: `/admin/questions` 仅承担列表/录题/修改/审核；`/admin/questions/import` 作为独立菜单并可缓存。

- [x] 写失败测试固定菜单名称、顺序、权限和新旧库迁移结果。
- [x] 更新路由标题、routeOptions、init 和前向迁移；按 route_path 复用既有菜单 ID。
- [x] 从 Questions 移除文件导入与整批 AI 出题/资料管理 UI，保留人工录题、审核、预览和单题重新生成。
- [x] 运行菜单、路由、迁移和题库页面测试。

### Task 4: 文档、一致性与端到端验收

**Files:**
- Modify: `docs/design/04-API设计.md`
- Modify: `docs/design/05-模块设计.md`
- Modify: `docs/design/06-关键流程.md`
- Modify: `docs/design/07-安全与非功能设计.md`
- Modify: `docs/design/README.md`
- Create: `tests/training-ai-question-import.mjs`
- Modify: `tests/run-e2e.mjs`

**Interfaces:**
- Consumes: Tasks 1–3 的最终接口、路由和状态语义。
- Produces: 可重复的 Mock AI E2E 与设计文档一致性证据。

- [x] 添加 E2E：20 参考行零写入、只生成 easy/hard、选择确认后 pending、owner/kind/权限隔离、重复确认幂等。
- [x] 同步 API、模块、流程、安全和路由文档，明确参考文件不保留与无制度版本 AI 来源例外。
- [x] 运行 server build/test、web 142+ 回归、类型检查、生产构建、迁移测试和隔离 E2E。
- [ ] 浏览器验收菜单、两个导入 Tab、生成预览与待审核题库落点（本轮浏览器控制通道不可用，保留为手工 PC 验收项）。
- [x] 使用独立 reviewer 审查实际 diff，修复高/中风险后再交付。
