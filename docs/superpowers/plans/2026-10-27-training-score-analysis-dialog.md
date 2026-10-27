# Training Score Analysis Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将培训成绩分析改为内容区弹窗，并让固定卷无需难度即可查看排名，历史随机卷继续按难度隔离。

**Architecture:** 保留现有统计列表和 URL 深链状态，在 `TrainingStatistics.vue` 内将详情区域改为 `el-dialog`。服务端摘要返回发布模式，排名按模式决定是否要求难度；现有冻结发布、规则一致性和个人最高分算法继续复用。

**Tech Stack:** Vue 3、TypeScript、Element Plus、NestJS、TypeORM、Vitest、Node test harness

**Spec:** `docs/superpowers/specs/2026-10-27-training-score-analysis-dialog-design.md`

## Global Constraints

- 弹窗只覆盖后台内容区，复用 `contentDialogTarget` 与 `re-form-dialog`。
- 当前固定卷不暴露难度筛选；历史随机卷仍不可跨难度合榜。
- 保留现有首页 `paper_id` 深链、总览筛选和页码。
- 不改数据库，不覆盖当前工作区其他未提交改动，不自动提交。

## Review Focus

- 固定卷无 `difficulty` 时必须能加载排名和导出。
- 历史随机卷无难度时必须由前端选定已有组，服务端仍拒绝模糊合榜。
- 弹窗关闭、切换场次和迟到响应不能污染列表或新场次。
- 无成绩、零分、未配置优秀线必须分别显示正确。
- 从排名打开答卷详情后关闭，成绩分析弹窗和排名状态仍保留。

---

### Task 1: 固定卷排名契约

**Files:**
- Modify: `server/src/common/training-contracts.ts`
- Modify: `server/src/modules/statistics/ranking.ts`
- Modify: `server/src/modules/statistics/training-statistics.service.ts`
- Modify: `server/src/modules/statistics/training-statistics.controller.ts`
- Test: `server/test/training-statistics.spec.ts`

**Interfaces:**
- Produces: `TrainingExamSummary.exam.mode: 'fixed' | 'random'`；`buildRankingRows(..., difficulty?: ExamDifficulty)`；固定卷 `ranking/export` 可省略难度。

- [x] 写失败测试：固定卷无难度返回全卷排名；随机卷无难度仍返回 40001；摘要返回冻结发布模式；导出工作表名和列不含冗余难度。
- [x] 运行 `npm --prefix server test -- --run test/training-statistics.spec.ts` 确认失败。
- [x] 实现可选难度排名、模式校验、通用成绩排名导出与文件名。
- [x] 重跑定向服务端测试确认通过。

### Task 2: 成绩分析内容区弹窗

**Files:**
- Modify: `web/src/api/training-types.ts`
- Modify: `web/src/views/admin/TrainingStatistics.vue`
- Test: `web/tests/training-statistics-overview.test.mjs`
- Test: `web/tests/training-statistics-pagination.test.mjs`

**Interfaces:**
- Consumes: `TrainingExamSummary.exam.mode`；固定卷排名允许无难度。
- Produces: 列表上方内容区弹窗、描述列表、条件难度筛选、答卷详情入口。

- [x] 写失败测试：总览始终存在；成绩分析使用 `el-dialog` 与 `el-descriptions`；固定卷自动加载排名且无难度控件；随机卷保留难度；关闭恢复原页；排名无答卷 ID、有查看答卷。
- [x] 运行两份前端统计测试确认失败。
- [x] 将详情模板重组为弹窗，增加描述字段计算与现有答卷详情弹窗联动。
- [x] 保留请求 epoch、URL `paper_id`、排序、分页与导出状态。
- [x] 重跑两份前端统计测试确认通过。

### Task 3: 文档、静态契约与整体验证

**Files:**
- Modify: `docs/design/01-需求分析.md`
- Modify: `docs/design/04-API设计.md`
- Modify: `docs/design/05-模块设计.md`
- Modify: `review/2026-10-23-training-statistics-upgrade-acceptance.md` only if the current record is explicitly maintained as a historical addendum; otherwise leave unchanged.

**Interfaces:**
- Consumes: Tasks 1–2 final behavior.

- [x] 更新现行设计：成绩分析弹窗、固定卷统一排名、随机卷分难度兼容、导出名称。
- [x] 运行服务端统计测试、前端统计测试、`vue-tsc --noEmit`、web build 和 `git diff --check`。
- [x] 用当前浏览器验证列表不离页、弹窗层级、滚动锁、描述列表、排名与关闭返回；无可用业务数据时明确记录未验边界。
