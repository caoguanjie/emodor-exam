# 试卷列表与草稿操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 按用户确认的旧系统使用习惯补齐试卷列表、草稿平铺操作按钮和无答案打印预览。

**Architecture:** 保留现有培训试卷 API 与共享设计器。列表通过平铺操作按钮进入设计器、修改弹框和打印预览；删除由后端事务校验草稿状态与历史引用，不触碰题库和已发布记录。

**Tech Stack:** Vue 3、Element Plus、NestJS、TypeORM、MySQL、Vitest。

**Spec:** 本轮用户确认（2026-10-27）：列表显示试卷名称、培训类别、考试时间、状态、备注、创建时间、操作；不显示考前学习要求（包括名称下方）；“修改信息”改为“修改”，“组卷”改为“试卷管理”；预览用于无答案打印；其余已讨论的复制、发布、草稿删除保留。实现遵循 `docs/design/04-API设计.md`、`docs/design/05-模块设计.md` 与当前已发布试卷冻结契约。

## Global Constraints

- 保留工作区已有未提交改动，不提交或推送。
- 不加多选框或批量操作；不恢复资料来源链路。
- 考前学习要求只从列表移除，新增/修改配置及服务端开考校验保留。
- 普通预览不显示答案或解析，不在该入口提供答案版切换。
- 已发布试卷不可修改或删除；权限继续在后端校验。
- 不自动重试复制、发布、删除；迟到响应不得覆盖其他试卷或已关闭弹框。
- 基本修改固定发送 `preserve_questions:true`；后端试卷锁内拒绝对非空题单换类/换模式，保留设计器原有显式换类行为。
- 不改变既有迁移 checksum；若确认需要表结构变化，须同步 migration、init.sql、entity、设计分册。

## Review Focus

- 删除与发布并发：同一试卷行锁下重新判断状态，不能删除已发布历史。
- 修改仅提交基本配置，不覆盖题单、题目分值、设计器文档和隐藏规则。
- 修改/预览切换试卷及关闭后的迟到响应不污染新会话。
- 只读权限不能触发修改、删除、复制和发布；普通预览永不请求答案接口。
- 删除当前页最后一条后正确回到上一页；图片未就绪或失败时不可打印。

### Task 1: 试卷列表与修改弹框

**Files:** `web/src/views/admin/Papers.vue`；新增 `web/src/components/PaperEditDialog.vue`；`web/src/components/question-designers/__tests__/paper-list-actions.spec.ts`；新增弹框行为测试。

**Interfaces:** 编辑沿用 `GET/PUT /admin/papers/:id`；删除调用 `DELETE /admin/papers/:id`；设计器沿用 `/admin/papers/:id?scope=training&designer=1`；预览调用 `PaperPreviewDialog.open(row, false)`。

- [x] 对真实列表/弹框写必要行为测试：字段显示、权限与状态菜单、修改回填和最小 PUT、迟到响应、删除确认与重复点击保护。
- [x] 运行测试确认新增行为失败。
- [x] 列表补齐七列，名称与备注超长提示；移除学习要求展示与答案版入口；草稿平铺按钮为“试卷管理、修改、预览/打印、复制、发布、删除”。已发布保留只读预览和复制。
- [x] 独立修改弹框回填最新详情，保存基本信息；复用当前字段约束与未保存提醒，保存成功刷新列表，不跳入设计器。
- [x] 必要测试与前端类型检查通过。

### Task 2: 草稿删除事务

**Files:** `server/src/modules/exams/paper-admin.controller.ts`、`server/src/modules/ai/paper.service.ts`、相关服务端测试；`docs/design/04-API设计.md`、`docs/design/05-模块设计.md`。

**Interfaces:** `DELETE /admin/papers/:id`，`papers:write` 权限；只接受培训草稿，非草稿返回既有 40970；成功返回统一响应信封。缺失目标使用既有 not-found 语义。

- [x] 确认引用与清理范围，测试草稿删除、非草稿拒绝、历史引用拒绝及发布并发互斥。
- [x] 运行测试确认删除行为缺失。
- [x] 在事务内取得试卷写锁，重新核对草稿与引用，删除其专属草稿数据及试卷；保留共享题库、课程、学习记录、发布快照与考试记录。沿用审计记录。
- [x] 运行针对性测试与服务端构建；更新 API 与模块设计。

### Task 3: 打印预览与集成验收

**Files:** `web/src/components/PaperPreviewDialog.vue`、`web/src/style.css`、预览行为测试；本计划。

- [x] 预览展示试卷标题，普通预览固定隐藏答案/解析，提供打印与关闭；保留图片就绪门禁和请求隔离。
- [x] 验证原有预览与相关列表测试、前端类型检查；浏览器检查列、平铺按钮、修改回填；组件回归验证无答案预览。
- [x] 独立审查本轮差异，修复实质问题；记录已验内容及专属临时验收数据清理结果。

## 验证中补充的裁决

- 用户最终明确公共列表操作须平铺，移除“操作”下拉按钮；保留六项操作原名称、权限与状态规则。

- 审查确认既有配置更新会在换类别时清题：新增基本修改保题控制参数及锁内校验；前端对已加载题单锁类别，后端覆盖打开空卷后另一会话先加题的竞态。
- 新创建时间列暴露本机 MySQL 默认时间与 UTC 驱动混用：仅为后续培训创建/复制显式写入应用 UTC 时间，不改历史记录或数据库会话设置。
- 隔离发布回归的旧手工服务夹具缺少操作人查询依赖：补齐 SysUser 实体及真实 repository 后原套件通过，不改生产逻辑规避失败。

## 验证结果

- 前端平铺最终增量：列表与修改弹框 34 项通过；Node 状态回归 12 项通过；`vue-tsc --noEmit` 通过。全量前端运行中唯一旧列断言与新需求冲突，已修正并复跑相关文件通过。
- 服务端：删除实现阶段全量 1181 项通过；后续保题与时间增量相关 9 文件 139 项通过并完成构建。
- `node tests/run-e2e.mjs --ephemeral --suite training-publishing` 最终通过，覆盖真实 DELETE、权限/历史引用拒绝、删除与发布两种并发顺序、保题换类冲突与空卷换类；临时 MySQL、Redis、API 及目录已由启动器清理。
- 浏览器实测七列及六项平铺操作，无学习要求展示；专属临时草稿完成新建、修改时间/备注、复制、删除，复制后创建时间与本地时钟一致。仅删除本轮新建的 id=3、4，列表恢复原 id=2 一条记录。
- 普通预览组件回归确认题干/选项可见，答案/解析及导出入口不可见；本机原试卷为空卷，未以其宣称非空卷实物打印验收。
- 独立审查闭环：无未解决阻断问题；本机API已重启加载新接口。没有提交或推送，也未对历史时间批量回填。
