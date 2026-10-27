# 管理端运营看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有管理端首页接入真实运营数据，完成指标、趋势、必修学时、最近考试及业务入口，并通过接口、真实浏览器和视觉验收后同步正式设计文档。

**Architecture:** 保留 `/admin/dashboard`，在现有统计目录新增只读 `AdminDashboardService`，通过根 `AppModule` 装配，扩展概览并新增四个读取接口。前端以独立 API 客户端和 composable 管理请求，各业务列表接收最小路由协议；统计口径在服务端计算，共享考试可见范围、有效学习版本和最终成绩计算。

**Tech Stack:** Node.js ≥22、NestJS、TypeORM、MySQL 8、Redis（沿用认证与测试设施）、Vue 3、TypeScript、Element Plus、SVG、Vitest、Node test runner、Playwright。

**Spec:** [管理端运营看板实现设计](../specs/2026-10-27-admin-operations-dashboard-design.md)。执行者须同时阅读实现设计与本计划；状态为待执行，以下复选框不是完成记录。

## Global Constraints

- 设计资源：`docs/ui/pen-gemini.pen`；绝对路径 `/Users/caogj/Documents/emodor/RuleExam/docs/ui/pen-gemini.pen`；主节点 **`Y8KAi`**，画板 `28 PC 运营驾驶舱 · 已确认方案 1600×1110`；预览 `docs/ui/exports/home-dashboard-2026-10-27/Y8KAi.png`。实施前通过 Pencil 读取实时节点，不直接解析加密 `.pen`。
- 常用操作沿用完整深色 2×2 样式：原节点 `SplYL`，当前画板内对应节点 `AmDRw`。仅按已确认节点实现，不新增「设计 UI 的依据」章节。
- 五卡顺序为学员总数、今日参考、近 7 日参考、题目总数、试卷总数；学员来源在总人数同一卡内。第二行趋势/常用操作，第三行必修学时/最近考试。
- 不设首页难度筛选、左右模块联动、独立页尾说明或重复页尾统计按钮；页头保留更新时间和刷新图标。
- 学时只统计实际适用必修要求的学员，使用 `credited_ms` 和发布冻结分钟数；不使用考试通过率、`is_completed` 或 `course_completion` 替代。
- 统一信封 `{code,message,data}`、字符串 ID、DTO 白名单；概览逐字段授权，其他四个接口要求 `statistics:read`。展示与入口权限分开。
- 数据库按 UTC 存储，统计按 `Asia/Shanghai` 自然日；参考人数与人次分开，日人数之和不得充当周期去重人数。
- 首期直接查库，不加业务表、统计快照、定时汇总、Redis 统计缓存、轮询、WebSocket 或图表依赖；不修改已有 C6 历史报表分母。
- 保留当前未提交的试卷、考试记录、统计页、页签及设计文档改动。执行前记录基线；若隔离工作区，使用 `using-git-worktrees` 并保留所需未提交基线，不能只从 HEAD 启动后丢失依赖。
- E2E 只走 `--ephemeral` 自有临时 MySQL/Redis/API，不接开发库或生产库；凭据只运行期传递，不输出或写入文档、截图元数据与测试报告。
- 实施与验证结束后才同步 `docs/design/` 对应分册；当前计划阶段不改正式架构文档。没有结构变更就记录无变更，不虚构迁移、不改旧 checksum。
- 下列命令均为待执行；相对路径以仓库根为准，命令注明 `server/` 或 `web/` 时在对应目录运行。各任务完成后检查差异；提交须符合用户当时授权，仅含本任务改动，不整批暂存已有脏文件。

## Review Focus

1. 同人同日重考、跨日参考及午夜响应：人数、人次、冻结来源与日期入口各自正确，期间人数不由日人数求和。由 Task 1、5、7 验证。
2. 登录中权限收回或账号仅有部分业务权限：无权字段省略，旧敏感数据清除，展示权限不能获得记录/编辑入口。由 Task 1、5、6、8 验证。
3. 学时阈值差 1 毫秒、没有学习记录、重复视频版本及重新发布：分母不漏人、时长不重复，失效选择清空且不跳到别的培训。由 Task 2、5、7 验证。
4. 缓存列表残留筛选、一次性新建意图和未保存表单：入口正确重置、同一业务页不重复开签，新建只打开一次，取消离开不得丢草稿。由 Task 4、8 验证。
5. 已归档/撤回的最近考试与无成绩数据：首页可展示并直达该试卷分析，均分为空值，现有总览仍只列已发布试卷。由 Task 3、4、8 验证。

---

## 文件职责与任务依赖

以下新增路径是实施约定，不表示文件当前已存在。

| 任务 | 文件范围 | 职责 |
|---|---|---|
| 1 | 新增 `server/src/modules/statistics/admin-dashboard.service.ts`、`admin-dashboard.dto.ts`、`dashboard-time.ts`；修改 `server/src/app.module.ts`、`server/src/common/training-contracts.ts`、`server/src/modules/statistics/training-statistics.controller.ts`、`training-statistics.service.ts` | 概览、趋势、DTO、服务注入；旧 dashboard 方法迁入新服务，HTTP 兼容保留 |
| 1 | 新增 `server/src/modules/exams/exam-record-visibility.ts`；修改同目录 `exam-records.service.ts` | 列表与聚合共用可见记录条件，不共用带答题子查询的投影 |
| 2 | 修改 `server/src/modules/exams/paper-learning.ts` 及 Task 1 服务/DTO/控制器/契约 | 学习版本查询复用、候选与学时聚合 |
| 3 | 修改 `server/src/modules/statistics/ranking.ts`、`training-statistics.service.ts` 及 Task 1 服务/控制器/契约 | 同版本个人最高分摘要复用、最近考试专用查询 |
| 4 | 新增 `web/src/utils/admin-dashboard-navigation.ts`；修改 `web/src/views/admin/{Users,Questions,Papers,TrainingStatistics}.vue`、`web/src/stores/{tabs,tab-cache}.ts`；核对 `web/src/layouts/MainLayout.vue` 调用处 | 参数解析/消费、四个目标页接收、页签与缓存身份一致 |
| 5 | 新增 `web/src/api/admin-dashboard.ts`、`web/src/composables/useAdminDashboard.ts`；修改 `web/src/api/training-types.ts`、`http.ts` | 五个响应类型、请求隔离、权限与刷新状态；HTTP 仅补主动取消的静默处理 |
| 6 | 修改 `web/src/views/admin/Dashboard.vue`；新增同目录 `dashboard/{DashboardExamTrend,DashboardLearningSummary,DashboardRecentExams}.vue` | 卡片/常用操作由首页承载，三个区域组件只展示与发出交互事件 |
| 7 | 新增 `tests/admin-dashboard.mjs`、`tests/support/admin-dashboard-fixtures.mjs`；修改 `tests/run-e2e.mjs`、`tests/suite-selection.test.mjs` | 隔离真实 API、数据对账与查询性能验证 |
| 8 | 新增 `tests/admin-dashboard-browser.mjs`、`tests/support/admin-dashboard-browser-harness.mjs`、`web/playwright.config.ts`、`web/e2e/admin-dashboard.spec.ts`；修改 `web/package.json`、`web/package-lock.json` 及套件注册/选择测试 | PC 真实浏览器 runner、同源代理、业务闭环和视觉证据 |
| 9 | 新增 `review/<执行日期>-admin-operations-dashboard-acceptance.md`；回填受影响的 `docs/design` 分册 | 真实验收事实和最终文档一致性 |

单元/组件测试路径在各任务明确列出。数据库索引为 Task 7 的条件分支，先测量再决定，不预留可能与其他工作冲突的迁移编号。

```text
Task 1 → Task 2 → Task 3 → Task 7 ───────┐
Task 4 ──────────────────┐              │
Task 5 ──────────────────┴→ Task 6 ─────┴→ Task 8 → Task 9
```

接口类型以实现设计第 5 节为共同契约。Task 1—3 同一后端负责人串行，避免同时修改同一服务；Task 4 可独立进行，Task 5 按冻结契约与后端并行。根执行者整合后进入 Task 6—9；Task 7 通过前不得将 Task 8 记为真实接入验收。

### Task 1: 概览卡与每日参与趋势

**Files:** 文件职责表 Task 1 范围；新增 `server/test/admin-dashboard.spec.ts`、`server/test/admin-dashboard-dto.spec.ts`、`server/test/dashboard-time.spec.ts`；修改 `server/test/exam-records.spec.ts`、`server/test/training-statistics.spec.ts` 中受服务迁移影响的首页断言，保留其他既有覆盖。

**Interfaces:**

- 新增 `AdminDashboardService.overview(actorId: string, now?: Date): Promise<AdminDashboard>`。
- 新增 `AdminDashboardService.examTrend(actorId: string, days: 7 | 30, now?: Date): Promise<DashboardExamTrend>`。
- 新增 `dashboardPeriod(now: Date, days: 7 | 30 | 1): { startUtc: Date; endUtc: Date; date_from: string; date_to: string }`；`endUtc=now`，日期字段为上海日期。
- 新增 `applyVisibleExamRecordScope(query: SelectQueryBuilder<ExamRecord>): SelectQueryBuilder<ExamRecord>`，约定主别名 `record`；包含必要 learner/paper 内关联与可见状态条件，不选取列，不加日期范围，不含答案子查询。
- `AdminDashboard`、`DashboardDateRange`、`DashboardExamTrend` 严格按 spec 第 5 节定义；新增 `DashboardTrendQueryDto`（`days` 默认 7，只允 7/30）。控制器继续放在 `training-statistics.controller.ts`，不新建不存在的 `statistics.module.ts`。

- [ ] **Step 1: 固定工作基线并读实现约束。** 记录 `git status --short` 和相关差异，读 `docs/design/04-API设计.md`、`05-模块设计.md`、`07-安全与非功能设计.md` 相关章节及 spec；核对 `Y8KAi` 存在。已有相邻改动作为输入保留，不 reset/stash 或覆盖。
- [ ] **Step 2: 写失败测试。** 在新服务测试中设置启用 institution/external/未知来源各 1 人，另有停用账号和挂业务角色账号；题目含启用、停用和逻辑删除；试卷含 training 各状态及 legacy。参与夹具：今日 A 两次（首条 institution，后条 external）、B 一次，昨日 A 一次。固定 `now=2026-10-27T02:00:00Z`。补上海边界 `2026-10-26T16:00:00Z` 前后、跨月、同时间按记录 ID 排序、纯 timeout 计入而旧 submitted/已评分 timeout 排除、后续停用不删参与事实。测试名及核心断言：

```ts
// it('counts people and attempts independently using the record-list scope')
expect(result.metrics).toMatchObject({ learner_count: 3, learner_institution_count: 1,
  learner_external_count: 1, learner_unknown_source_count: 1,
  today_participant_count: 2, today_attempt_count: 3,
  last_7_days_participant_count: 2, last_7_days_attempt_count: 4,
  question_count: 2, enabled_question_count: 1, paper_count: 4, published_paper_count: 1 });
// it('uses Shanghai calendar boundaries without losing UTC precision')
expect(dashboardPeriod(new Date('2026-10-27T02:00:00Z'), 7).startUtc.toISOString())
  .toBe('2026-10-20T16:00:00.000Z');
// it('omits unauthorized groups rather than returning zero')
expect(studentOnly.metrics).not.toHaveProperty('today_participant_count');
expect(studentOnly).not.toHaveProperty('exam_trend');
// it('zero-fills days and assigns one frozen source per person-day')
expect(trend.points).toHaveLength(7);
expect(today.participant_count).toBe(today.institution_count + today.external_count + today.unknown_source_count);
```

DTO 测试拒绝 `days=14`、数组/重复键、对象和未知参数，确认 `40001`；默认 7 与 30 正常。补兼容字段测试，旧 `exam_trend` 继续按原始 7 日记录数计算，不偷偷换为新可见集合/去重人数。

- [ ] **Step 3: 运行红灯。** 在 `server/`：`npx vitest run test/admin-dashboard.spec.ts test/admin-dashboard-dto.spec.ts test/dashboard-time.spec.ts test/exam-records.spec.ts`。新增行为因接口/实现缺失失败；依赖或环境失败先定位，不当作有效红灯。
- [ ] **Step 4: 实现概览和趋势。** `overview` 按权限只查询并返回有权字段；学员使用 `NOT EXISTS sys_user_role`，题目使用 `deleted_at IS NULL`，试卷限定 `business_scope=training`。新参与指标使用共享可见范围，UTC 半开区间分别 `COUNT(DISTINCT user_id)` 与计数。趋势在范围过滤后按上海日、学员取 `started_at,id` 首条再分来源，并补零。原记录列表改用 helper 后保留其筛选/投影。迁移旧 dashboard 方法及依赖测试，根 `AppModule` 注入新 service。
- [ ] **Step 5: 实现 HTTP 边界。** 概览维持登录后字段裁剪，不添加全局 `statistics:read`；趋势显式加该权限。使用现有 `StrictDtoValidationPipe` 和原始 query 白名单检查，拒绝意外数组、额外字段与非法天数；固定返回服务端 `as_of/timezone/periods`，不给新客户端模拟旧字段。
- [ ] **Step 6: 运行绿灯和编译。** 重跑 Step 3 并加入 `test/training-statistics.spec.ts`；`npm --prefix server run build`。新测试通过，旧记录范围和培训统计回归无变化；真实 SQL 结果将在 Task 7 对账。
- [ ] **Step 7: 保存任务检查点。** 检查本任务 diff 和 `git diff --check`；若执行阶段已授权提交，只暂存本任务的新文件和已有文件的所属片段，建议 `feat(dashboard): 接入概览与参与趋势`。

### Task 2: 必修培训候选与学时达标

**Files:** Task 1 服务/DTO/控制器/契约；修改 `server/src/modules/exams/paper-learning.ts`；新增 `server/test/admin-dashboard-learning.spec.ts`；修改 `server/test/paper-learning.spec.ts`、`server/test/admin-dashboard-dto.spec.ts`。

**Interfaces:**

- 新增 `getEffectiveLearningVersionIds(manager: EntityManager, courseIds: readonly string[]): Promise<string[]>`，放在 `paper-learning.ts`；返回唯一当前有效视频版本。原 `assertPaperLearningEligible(...)` 签名不变，改用此 helper。
- 新增 `AdminDashboardService.learningOptions(actorId: string, filter: { keyword?: string; page?: number; pageSize?: number }): Promise<DashboardLearningOptions>`。
- 新增 `AdminDashboardService.learningSummary(actorId: string, paperId: string, releaseId: string): Promise<DashboardLearningSummary>`。
- 新增 `DashboardLearningOptionsQueryDto`、`DashboardLearningSummaryQueryDto`，前者 `toFilter()` 转换下划线分页参数；响应按 spec 的 `DashboardLearningOptions/DashboardLearningSummary`，不改原 C6 options 返回形状。

- [ ] **Step 1: 写失败测试。** `admin-dashboard-learning.spec.ts` 预置 60 分钟阈值和 4 名正常应学人员：无记录、3,599,999 ms、3,600,000 ms、3,600,001 ms，其中至少一名外来学员；另设角色账号、停用及不同类别人员。覆盖重复版本不累计两次、当前课程换版/下架、非视频/删除课时、不因未实名/已通过/次数耗尽排除人员，以及 BIGINT 累加精度。

```ts
// it('includes zero-learning people and compares credited milliseconds exactly')
expect(summary).toMatchObject({ state: 'ready', eligible_count: 4,
  achieved_count: 2, pending_count: 2, achievement_rate: 0.5 });
// it('distinguishes no audience from zero achievement')
expect(empty).toMatchObject({ state: 'no_audience', eligible_count: 0,
  achieved_count: 0, pending_count: 0, achievement_rate: null });
// it('rejects an obsolete release without mixing its threshold with current data')
await expect(service.learningSummary(actorId, paperId, obsoleteReleaseId))
  .rejects.toMatchObject({ code: 40970 });
```

候选测试覆盖最高 `version_no`、正整数分钟/合法非空课程集合、分页 20/100 上限、关键词、发布时间/ID 稳定倒序；旧 NULL 阈值不发明要求，课程下架不删除候选。summary 不存在或版本错配 `40401`，重新发布/撤回/要求失效 `40970`，`1/3` 达标率 `0.3333`。

- [ ] **Step 2: 运行红灯。** 在 `server/`：`npx vitest run test/admin-dashboard-learning.spec.ts test/admin-dashboard-dto.spec.ts test/paper-learning.spec.ts`。确认新增能力失败且现有开考学习校验基线可识别。
- [ ] **Step 3: 实现共享只读版本查询。** 保留 `assertPaperLearningEligible` 对 legacy/未启用/NULL 阈值的原放行语义；提取当前 published 课程、未删除 video 课时、匹配当前版本且正时长的唯一版本集合。无有效版本时按 0 时长处理，不生成空 `IN ()`，不写学习事实。
- [ ] **Step 4: 实现两个聚合接口。** 候选严格选择当前 published training 试卷最新合法要求，`page_size` 默认 20、上限 100。summary 在同一次一致性读取中校验纸卷/版本、取得有效版本和应学集合，数据库按用户汇总 `credited_ms` 后 LEFT JOIN 应学集合，再统计达标与未达标；不要把全部用户搬到 Node 或逐用户查询。阈值以整数/DECIMAL/BIGINT 比较，比例四舍五入到四位，无应学人员为 null；不加写锁。两个接口均 `statistics:read`，ID 全程为字符串。
- [ ] **Step 5: 运行绿灯。** 重跑 Step 2，`npm --prefix server run build`。确认旧学习资格/剩余时间报错、未完成考试续接和旧发布 NULL 阈值兼容仍通过。
- [ ] **Step 6: 保存任务检查点。** 审核只读查询与事务边界，`git diff --check`；按授权范围提交，建议 `feat(dashboard): 增加必修学时统计`。

### Task 3: 最近考试与既有成绩口径复用

**Files:** 修改 `server/src/modules/statistics/{admin-dashboard.service,training-statistics.controller,training-statistics.service,ranking}.ts`、`server/src/common/training-contracts.ts`；新增 `server/test/admin-dashboard-recent.spec.ts`；修改 `server/test/training-statistics.spec.ts`。

**Interfaces:**

- 新增 `AdminDashboardService.recentExams(actorId: string): Promise<DashboardRecentExams>`；固定最多 4 条，没有客户端 limit/difficulty 参数。
- 在 `ranking.ts` 新增 `summarizeReleaseRecords(records: StatisticsRecord[], releaseId: string, rule: RuleSnapshot | null): Pick<TrainingExamOverviewRow, 'participant_count' | 'finalized_users' | 'average_score'>`。输入先按 release 筛选，人数保持现有 overview 语义，最终分使用既有 `bestFinalizedRecords(records, undefined, releaseId, rule)`；服务端 overview 与新首页共用。
- `DashboardRecentExams.items` 为 `Array<TrainingExamOverviewRow & { released_at: string }>`；无成绩均分 null，金额/分数精度沿用原两位小数。

- [ ] **Step 1: 写失败测试。** 构造 6 份有发布记录试卷、一个未发布草稿和多版本旧卷；发布时间与 ID 次序刻意不同，同时间以发布 ID 倒序稳定排序。覆盖归档、撤回、不同冻结规则、同人多次取最高分、无成绩。

```ts
// it('orders latest releases and retains archived or withdrawn exams')
expect(recent.limit).toBe(4);
expect(recent.items.map(row => row.paper_id)).toEqual(expectedLatestFour);
// it('shares best-score aggregation without changing overview publication scope')
expect(recentRow).toMatchObject({ participant_count: 2, finalized_users: 1, average_score: 90 });
expect(noScoreRow.average_score).toBeNull();
expect(overview.items.every(row => row.status === 'published')).toBe(true);
```

- [ ] **Step 2: 运行红灯。** 在 `server/`：`npx vitest run test/admin-dashboard-recent.spec.ts test/training-statistics.spec.ts`。
- [ ] **Step 3: 实现最近考试。** 每份试卷先定位最高发布版本，再按 `released_at DESC, release.id DESC` 取 4 份；当前已撤回/归档保留，未发布草稿不参与。批量读取这些版本所需最小成绩字段及类别信息，不取答案、题面，不逐卷查询。提取上述摘要 helper 后替换 overview 对应计算，保留其 published 过滤与原分页/排序。
- [ ] **Step 4: 运行绿灯。** 重跑 Step 2，`npm --prefix server run build`；`recent-exams` 拒绝额外 query、无权 `40301`、返回当前真实状态，Task 7 再做真实数据库验证。
- [ ] **Step 5: 保存任务检查点。** 检查现有 overview 差异仅为计算复用，`git diff --check`；按授权范围提交，建议 `feat(dashboard): 展示最近发布考试`。

### Task 4: 四个目标页面接收入口与页签一致性

**Files:** 文件职责表 Task 4 范围；新增 `web/src/utils/__tests__/admin-dashboard-navigation.spec.ts`；扩展 `web/tests/{tabs-store,admin-shell-regression,paper-management-state,training-statistics-pagination,question-bank-ui,student-avatar-save,router-access}.test.mjs` 中对应行为测试。

**Interfaces:**

- 新增 `dashboardListIdentity(fullPath: string): string`：只对 `/admin/students`、`/admin/questions`、`/admin/papers`、`/admin/training-statistics` 返回无 query/hash 的路径，其他输入原样返回。tabs 保留已有考试记录归一规则，新增四路径规则；`tabCacheKey/invalidateTabCache` 对这四路径使用同一 helper，不改变其他路由的身份。
- 新增 `parseDashboardEntry(path: string, query: LocationQuery): DashboardEntryResult`。`DashboardEntryResult` 含 `explicitEntry: boolean`、`intent: DashboardEntry | null`、`invalidKeys: string[]`、`cleanQuery: LocationQueryRaw`；`DashboardEntry` 是 `kind=students|questions|papers|statistics` 的区分联合，分别带 `source/status`、`enabled`、`status/create`、`paperId`。
- `all` 在 intent 中表示对应筛选 undefined；`cleanQuery` 去非法值与已消费 entry，`create` 仅在实际打开弹窗成功后消费。普通菜单无相关 query 时 intent=null，维持原默认值；已消费 entry 后保留的合法筛选仍能从 URL 恢复。
- 入口路由与权限完整沿用 spec 第 3 节；考试记录继续使用 `web/src/utils/exam-records.ts` 现有日期协议，本任务不重做记录页筛选。

- [ ] **Step 1: 写失败测试。** 真实页面测试先置入旧 keyword/category/page，然后应用首页入口；断言 source/status/全状态/第一页及 API 白名单。新建测试保留现有防重复 POST 基线并增加「只开一次弹窗」。补数组、非法枚举、非法 ID、同组件 query 变化、缓存重新激活、手动筛选同步 URL、消费 query 不重发同一初始化请求。

```ts
// it('shares list identity but preserves paper detail identity')
expect(dashboardListIdentity('/admin/students?source=external')).toBe('/admin/students');
expect(dashboardListIdentity('/admin/papers/8?designer=1')).toBe('/admin/papers/8?designer=1');
// it('resets stale filters and never forwards route-only flags to APIs')
expect(lastListParams).toMatchObject({ status: 1, source: 'external', page: 1 });
expect(lastListParams).not.toHaveProperty('entry');
// it('consumes create only after opening and does not reopen on activation')
expect(openDialogCalls).toBe(1);
expect(router.currentRoute.value.query).not.toHaveProperty('create');
// it('retains the unsaved form when leaving is declined')
expect(formAfterCancelledNavigation).toEqual(formBeforeNavigation);
```

同路径多 query 只保留一个业务页签；刷新/关闭仅失效对应缓存，其他详情不受影响。统计总览入口清单场状态，带 `paper_id` 直接请求 summary，即使目标归档且不在 options 中也可进入。

- [ ] **Step 2: 运行红灯。** `npm --prefix web test -- src/utils/__tests__/admin-dashboard-navigation.spec.ts`；执行 Step 4 所列 Node 测试。先记录当前既有失败，缺 route stub 的测试按新增真实调用补齐，不把既有受控媒体超时当成入口实现失败。
- [ ] **Step 3: 实现入口解析与接收。** 四页在挂载、query 变化、激活时复用本页单一初始化入口并去重；显式入口经过既有未保存保护后清旧条件、应用有效值再加载。API 参数重新按白名单组装，不传 `entry/create/all`。新建复用 `openTrainingCreate()`，同时检查 `papers:read` 与 `papers:write`；处理成功后 `router.replace` 消费。统计深链直接以 paper ID 加载，不能通过当前 options 作存在性判断。
- [ ] **Step 4: 实现并验证业务身份。** tabs 查找/恢复/合并、cache key 与 invalidate 使用共同四路径规则；`MainLayout` 继续调用公共 cache helper，不引入第二套 key。保留 `useUnsavedChanges` 的关闭、刷新和跳转保护。运行：

```bash
npm --prefix web test -- src/utils/__tests__/admin-dashboard-navigation.spec.ts
node --test web/tests/tabs-store.test.mjs web/tests/admin-shell-regression.test.mjs web/tests/paper-management-state.test.mjs web/tests/training-statistics-pagination.test.mjs web/tests/question-bank-ui.test.mjs web/tests/student-avatar-save.test.mjs web/tests/router-access.test.mjs
```

预期新增行为和受影响回归通过；修复本任务引入的问题，既有无关阻断单列，不删测试/放宽断言凑通过。

- [ ] **Step 5: 保存任务检查点。** 检查未触碰其他列表协议或详情路由，`git diff --check`；按授权范围提交，建议 `feat(dashboard): 接通业务入口与筛选恢复`。

### Task 5: 类型化请求与首页刷新状态

**Files:** 新增 `web/src/api/admin-dashboard.ts`、`web/src/composables/useAdminDashboard.ts`、`web/src/composables/__tests__/useAdminDashboard.spec.ts`、`web/src/api/__tests__/http-cancellation.spec.ts`；修改 `web/src/api/training-types.ts`、`web/src/api/http.ts`；复用 `web/src/utils/latest-request-scope.ts`，不改变该工具公共语义。

**Interfaces:**

```ts
// admin-dashboard.ts；均复用现有 http 与 AbortSignal
getDashboard(signal?: AbortSignal): Promise<AdminDashboard>;
getDashboardTrend(days: 7 | 30, signal?: AbortSignal): Promise<DashboardExamTrend>;
getDashboardLearningOptions(query: { keyword?: string; page?: number; page_size?: number }, signal?: AbortSignal): Promise<DashboardLearningOptions>;
getDashboardLearningSummary(paperId: string, releaseId: string, signal?: AbortSignal): Promise<DashboardLearningSummary>;
getDashboardRecentExams(signal?: AbortSignal): Promise<DashboardRecentExams>;
// useAdminDashboard.ts
useAdminDashboard(hasPermission: (permission: string) => boolean): UseAdminDashboardReturn;
```

`UseAdminDashboardReturn` 暴露 `overview/trend/learningOptions/learningSummary/recentExams` 五个 `Ref<DashboardSection<T>>`、`days: Ref<7|30>`、`selection: Ref<{paper_id:string;release_id:string}|null>`、`updatedAt: Ref<string|null>`；`DashboardSection<T>={data:T|null;loading:boolean;error:string|null;asOf:string|null}`。方法 `activate()/refresh()/setDays(days)/searchLearningOptions(keyword,page)/selectLearning(selection)/retry(module)` 均返回 `Promise<void>`，`deactivate():void`；`module` 固定为上述五个区域名。类型以 spec 为准，不在组件重新声明另一套响应。

- [ ] **Step 1: 写失败测试。** 用可控 deferred promise 测试真实 composable，不用快照替代状态测试。覆盖初次 mounted+activated 只一批、再次激活正常读取、7→30 的迟到 7 不覆盖、切培训只更新学时、候选分页不切当前摘要、停用后响应不落地、刷新保留有效选项、无统计权限不发四类请求。

```ts
// it('drops old responses and creates a live request scope after reactivation')
expect(state.trend.value.data?.days).toBe(30);
expect(fetchAfterReactivation).toHaveBeenCalledTimes(1);
// it('replaces permission-trimmed metrics and clears forbidden data')
expect(state.overview.value.data?.metrics).not.toHaveProperty('question_count');
expect(state.learningSummary.value.data).toBeNull();
// it('does not advance the header time after a partial failure')
expect(state.updatedAt.value).toBe(previousSuccessfulTime);
// it('clears obsolete learning data without choosing a different paper')
expect(state.selection.value).toBeNull();
expect(state.learningSummary.value.data).toBeNull();
```

补全部成功取最早 `as_of`、局部切换不推进页头、跨上海午夜只重读概览+趋势并对齐日期。`40970` 展示「培训要求已更新，请重新选择」，刷新选项后仍不自动换卷；无候选、no_audience、达标数为 0、网络错误分别区分；403 清旧数据，最终 401 沿用退出登录并清页面状态。HTTP 测试 `it('does not toast or refresh authentication for an aborted request')` 断言 `ElMessage.error`、刷新登录、拉取 profile 均调用 0 次，普通 500/401/403 的原处理不变。

- [ ] **Step 2: 运行红灯。** `npm --prefix web test -- src/composables/__tests__/useAdminDashboard.spec.ts src/api/__tests__/http-cancellation.spec.ts`。
- [ ] **Step 3: 实现客户端和状态编排。** HTTP 函数精确拼接五条接口，传取消 signal；各区域独立请求代次，整页批次另做更新时间归属保护。`createLatestRequestScope.stop()` 后不会恢复，重新激活必须重建；`http.ts` 在错误拦截器最前识别 Axios 主动取消并原样 reject，不弹错、不触发鉴权刷新，其他错误逻辑保留。概览 metrics 整体替换，不 merge；403 或当前权限移除时清数据与可操作入口。首次 options 第一项可默认选择，已有有效选择不因搜索/刷新消失在第一页而被替换；有效性由 summary 核验。
- [ ] **Step 4: 运行绿灯。** 重跑 Step 2；在 `web/` 执行 `npx vue-tsc --noEmit`。既有 HTTP 拦截器负责统一错误提示，页面负责具体空态/错误/重试，避免重复「成功」或两次报错提示。
- [ ] **Step 5: 保存任务检查点。** 核对无轮询与额外状态仓库，`git diff --check`；按授权范围提交，建议 `feat(dashboard): 管理分区请求与刷新状态`。

### Task 6: 按 Y8KAi 实现首页展示

**Files:** 文件职责表 Task 6 范围；新增 `web/src/components/__tests__/admin-dashboard.spec.ts`，挂载真实 `Dashboard.vue` 及区域组件；复用现有鉴权、页面框架、图标及站点资源，不改其他页面全局样式。

**Interfaces:** 消费 Task 5 composable 与 Task 4 入口协议。`DashboardExamTrend` props 为 `section: DashboardSection<DashboardExamTrend>, days:7|30, canViewRecords:boolean`，emit `changeDays(days)`、`openDay(date)`、`retry()`；`DashboardLearningSummary` props 为 `section`、`options`、`selection`，采用 Task 5 对应类型，emit `select(value)`、`search(keyword,page)`、`retry()`；`DashboardRecentExams` props 为对应 `section`，emit `openDetail(paperId)`、`openOverview()`、`retry()`。组件自身不请求 API，不互相修改选择。

- [ ] **Step 1: 读取实时设计并写行为测试。** 用 Pencil 查看 `Y8KAi` 及常用操作节点，预览不一致则重新导出核对。测试总人数与来源同卡、五卡顺序、权限隐藏/禁跳、所有约定路由、零值不当空值、学时状态、无成绩均分 `—`、未知来源中性分段；记录截图路径计划但不把示例数字写入产品。

```ts
// it('renders total and source counts in one learner card')
expect(learnerCard.text()).toContain('1,286');
expect(learnerCard.text()).toContain('本机构');
expect(learnerCard.text()).toContain('外来');
// it('allows statistics display without granting record navigation')
expect(todayCard.text()).toContain('今日');
expect(recordNavigationCalls).toBe(0);
// it('keeps learning selection independent from recent exam details')
expect(selectedLearningPaperAfterOpenDetail).toBe(selectedLearningPaperBefore);
```

- [ ] **Step 2: 运行红灯。** `npm --prefix web test -- src/components/__tests__/admin-dashboard.spec.ts`。
- [ ] **Step 3: 实现布局与交互。** 第一行五卡：来源文字可分别跳启用来源列表，其余辅助数字不扩展入口；考试主数字为人、辅助为人次。第二行来源堆叠 SVG 柱图和完整深色 2×2 常用操作；第三行必修学时环图/阈值/人数与最多四行最近考试。候选选择器支持关键词和翻页，选中项离开当前页时用已选摘要标题保留显示，不把第一页当全部候选。页头刷新图标带可访问名称和加载状态；不追加页尾。长标题省略可查看全文，日期/图例/数字清晰，键盘可聚焦柱子与数据提示，图形提供文本等价信息。
- [ ] **Step 4: 接入生命周期与入口。** mounted/activated/deactivated/unmounted 调用 Task 5，首次去重；入口按 spec 原样发送，日期使用服务端 periods/point.date。题库入口需 questions:read，新建需 papers:read+papers:write；仅有展示权限的指标不得产生无权跳转。局部错误提供本区域重试，其他数据继续可用，学时空态不显示误导的 0% 全部未完成。
- [ ] **Step 5: 运行绿灯与前端检查。** 重跑 Step 2 和 Task 5 测试；在 `web/` 执行 `npx vue-tsc --noEmit`，根目录 `node scripts/build.mjs web`。仅把这些结果记为组件/类型/构建通过，浏览器视觉和真实数据验收留给 Task 8。
- [ ] **Step 6: 保存任务检查点。** 核对 scoped 样式、设计删减项与交互覆盖，`git diff --check`；按授权范围提交，建议 `feat(dashboard): 完成运营看板页面`。

### Task 7: 隔离 API 对账与查询性能

**Files:** 文件职责表 Task 7 范围；参考既有 `tests/training-statistics.mjs`、`tests/training-paper-learning.mjs`、`tests/support/exam-mobile-fixtures.mjs` 的登录/发布/开考/整卷提交。条件修改：`database/migrations/` 新增未占用编号、`database/init.sql`、对应实体索引定义。

**Interfaces:** 新套件 `tests/admin-dashboard.mjs` 导出 `run(ctx): Promise<void>`，ctx 完全沿用 `tests/run-e2e.mjs` 的 `request/queryTestDb/adminPassword/restartApi/trackChild/...`。新夹具导出 `seedAdminDashboardFixture(ctx): Promise<DashboardFixture>`；`DashboardFixture` 包含当前运行生成的管理员/学员会话、试卷/发布/用户 ID、日期与独立预期值，敏感字段只留内存。导出 `completeDashboardExam(ctx, fixture): Promise<{recordId:string;paperId:string;releaseId:string}>`，必须通过真实开考/交卷 API 生成考试事实，供 Task 8 复用。

- [ ] **Step 1: 写套件注册和数据断言。** 在 `suite-selection.test.mjs` 验证 `admin-dashboard` 注册及运行时设置，套件需真实学员开考，使用既有 `identity-e2e-main.ts` 测试入口和对应 test-only env 分支，不增加生产实名后门。新 API 套件覆盖五接口成功、字段类型/零值/空值、401、分权限账号、40301、40001、40401、40970；所有拒绝场景比较真实信封代码。
- [ ] **Step 2: 完成测试入口后运行红灯。** 注册路径和最小 `run(ctx)` 后执行 `node --test tests/suite-selection.test.mjs`、`node tests/run-e2e.mjs --ephemeral --suite admin-dashboard`。Task 1—3 已正确实现的断言可直接通过；发现真实 SQL/权限偏差时先保留失败用例，不能制造虚假红灯。
- [ ] **Step 3: 实现独立夹具与对账。** 分别预置正常/外来/未知来源/角色账号、重复与跨日记录、纯 timeout/历史兼容记录、软删除题目、不同状态和发布版本、学时阈值与无记录人员。预期值按夹具原始清单独立计算，不能调用生产 helper 计算期望。实际开考/交卷前后检查概览人数/人次、日柱、最近考试个人最高分和记录详情；快照比较读取前后学习/考试/成绩业务事实，确认看板不产生写入。修复新发现偏差后复跑对应断言。
- [ ] **Step 4: 验证 SQL 与性能，按证据决定索引。** 正常套件记录 30 日趋势、学时聚合和最近考试的 `EXPLAIN`；禁止扫描答案表、逐用户/逐卷查询。`DASHBOARD_PERF=1` 分支在自己的临时库批量预置 1 万账号、30 日 10 万考试记录及有/无学习记录，记录实际行数、执行计划、5 次预热后 50 次请求的 P95，与 07 册统计报表 P95 ≤3秒目标对照。此为本机样本证据，不宣称生产容量。

若不达目标且 EXPLAIN 支持新增索引，核对迁移最新编号后仅追加所需索引，同时修改 init 与实体；在隔离库验证迁移可续跑、新装结构一致，并复测原查询。优先评估 `exam_record.started_at` 范围索引，不能仅凭计划提前认定需要所有索引。03 册在 Task 9 按实际结果回填。

- [ ] **Step 5: 运行绿灯与相关回归。** 下列套件分别使用启动器创建的独立环境：

```bash
npm --prefix server run build
node --test tests/suite-selection.test.mjs
node tests/run-e2e.mjs --ephemeral --suite admin-dashboard
node tests/run-e2e.mjs --ephemeral --suite training-statistics
node tests/run-e2e.mjs --ephemeral --suite training-paper-learning
node tests/run-e2e.mjs --ephemeral --suite training-records
DASHBOARD_PERF=1 node tests/run-e2e.mjs --ephemeral --suite admin-dashboard
```

全部必要断言通过、临时服务清理完成；性能结果如未达标须保留问题与复验，不能将功能通过替代性能结论。不默认跑 `--suite all`。

- [ ] **Step 6: 保存任务检查点。** 记录接口/性能证据，不含凭据；`git diff --check`；按授权范围提交，建议 `test(dashboard): 校验接口口径与数据库聚合`。

### Task 8: 真实 PC 浏览器闭环、提示与视觉验收

**Files:** 文件职责表 Task 8 范围；复用 Task 7 夹具与真实业务写入 helper；截图在 `gui-test-screenshots/admin-dashboard/`，非敏感测试报告在系统临时目录并清理，不写入正式产品目录。关闭 trace/HAR/视频与 storageState 落盘，不记录认证请求、令牌或密码；仅保留看板和业务目标页截图。

**Interfaces:** 新浏览器套件 `tests/admin-dashboard-browser.mjs` 导出 `run(ctx): Promise<void>`，注册为 `admin-dashboard-browser` 并使用同样隔离 API/测试实名入口。新增 `startAdminDashboardBrowserServer(ctx): Promise<{baseUrl:string;close():Promise<void>}>`：使用 web 的 Vite 配置，覆盖监听到 `127.0.0.1` 随机端口及 `/api/v1` 代理到 `ctx.baseUrl` 所在真实临时 API，不访问固定 :3000。`web/playwright.config.ts` 读取本次 `RULEEXAM_E2E_BASE_URL`，缺少隔离参数直接失败，默认单 worker。

- [ ] **Step 1: 增加 PC 浏览器测试设施。** 当前 web 没有真实浏览器 E2E runner；在 web 添加与仓库 mobile 当前固定版本一致的测试依赖：`npm --prefix web install --save-dev --save-exact @playwright/test@1.64.1`，仅改 devDependency/lock。package 增加 `test:e2e` 脚本 `playwright test --config=playwright.config.ts`；包装器启动临时页面服务后 spawn `npm --prefix web run test:e2e`。运行期通过环境传递本次随机登录信息、学员会话和夹具 ID，禁止日志/报告记录其值；测试端以真实 HTTP request 适配 Task 7 helper 所需的 `ctx.request`，复用开考/提交操作。复用 `ctx.trackChild` 并在 finally 关闭浏览器/Vite。禁止把 mobile 页面测试结果当 PC 验收。
- [ ] **Step 2: 写真实浏览器场景及 runner 测试。** 在 `web/e2e/admin-dashboard.spec.ts` 经真实登录页面登录；先写核心失败断言再补接入。至少包含：

```ts
// test('real exam submission is reconciled after dashboard refresh')
expect(after.metrics.today_attempt_count).toBe(before.metrics.today_attempt_count + 1);
await expect(todayAttemptLocator).toHaveText(String(after.metrics.today_attempt_count));
// test('cached student and question filters are reset by dashboard entry')
expect(studentRequest.query).toMatchObject({ status: '1', source: 'external', page: '1' });
expect(questionRequest.query).not.toHaveProperty('enabled');
// test('create intent opens once and unsaved cancellation preserves form')
await expect(existingCreateDialog).toBeVisible();
expect(newCreateCallsAfterReactivate).toBe(0);
await expect(editedFieldAfterCancelledNavigation).toHaveValue(unsavedValue);
// test('archived recent exam opens its summary without changing learning choice')
expect(summaryRequest.query.paper_id).toBe(fixture.archivedPaperId);
expect(learningSelectionAfterReturn).toEqual(learningSelectionBeforeLeave);
// test('revoked permission removes old data and entry points')
await expect(restrictedModuleLocator).toHaveCount(0);
expect(forbiddenResponse.code).toBe(40301);
```

以上断言的页面 locator 和响应变量由同一场景的实际页面/网络事件获取，不用静态假数据填充。另覆盖今日/7日/日柱的日期范围、四个常用操作、总览返回、7/30切换、培训候选、没有要求/没有人员/没人达标、长名称和窄屏。主业务链不得 route.fulfill 全部接口；局部故障/延迟可拦截指定请求作为独立异常场景，记录其证据等级。

- [ ] **Step 3: 执行并修复真实链路。** Task 7 的 `completeDashboardExam` 通过真实学员开考/交卷生成事实，浏览器刷新首页并逐项比较 API/夹具预期，日期列表条数对人次、主卡人数单独去重。测试加载/刷新/无权/参数错误/失败重试/40970 更新要求提示与结果对应；不新增站内信或外部通知。真实主链完成后再运行指定单请求故障、迟到响应和组件级午夜测试，不能以模拟替代真实主链。
- [ ] **Step 4: 按设计逐区看图。** 1600×1110 截图对照 `Y8KAi`，核对总数和来源同卡、五卡顺序、堆叠图、完整常用操作、学时环图、最近考试；另用 1280 宽检查长文本/布局溢出和空态。确认无难度、无联动、无被取消页尾；检查焦点、图表文本提示、控制台未捕获异常。截图与 API/业务证据分别记录。
- [ ] **Step 5: 运行绿灯。** 注册后才执行：

```bash
node --test tests/suite-selection.test.mjs
PLAYWRIGHT_CHANNEL=chrome node tests/run-e2e.mjs --ephemeral --suite admin-dashboard-browser
```

配置实现须支持 `PLAYWRIGHT_CHANNEL`；Chrome 不可用时，在 `web/` 执行 `npx playwright install chromium`，不设置 `PLAYWRIGHT_CHANNEL` 重跑浏览器套件，不能跳过后声明通过。必要失败修复后只复跑受影响场景和最终主链。测试关闭后校验自有服务/进程清理，不终止用户原有服务。

- [ ] **Step 6: 保存任务检查点。** 记录场景结果与截图定位，`git diff --check`；按授权范围提交，建议 `test(dashboard): 增加真实浏览器验收`。

### Task 9: 验收收口及正式设计文档回填

**Files:** 新增 `review/<执行日期>-admin-operations-dashboard-acceptance.md`；修改 `docs/design/04-API设计.md`、`05-模块设计.md`、`06-关键流程.md`、`README.md` 的看板相关条目；按实际差异决定 `03-数据库设计.md`、`07-安全与非功能设计.md`，不批量重写 01/02。本计划勾选只对应已实际完成步骤。

**Interfaces:** 输入为 Task 1—8 的最终代码、命令结果、API 数据对账、真实浏览器结果、Pencil 资源与实际数据库增量；输出为可追溯验收记录和一致的正式设计，不把计划或截图当作业务通过证据。

- [ ] **Step 1: 完成范围审查与必要复验。** 使用 `requesting-code-review` 对本次完整差异独立审查，重点覆盖五项 Review Focus、原有脏改动是否保留及读接口是否写业务事实。修复实质问题并复跑受影响测试；相关检查已通过且代码未再变更时不重复跑全库测试。
- [ ] **Step 2: 写验收记录。** 记录执行日期、工作版本与未提交基线、实际 Node/浏览器/数据库环境、隔离库标识、命令/退出码/断言结果、数据量与查询计划、页面/消息反馈、截图路径、修复复验和未验边界。未跑/失败单列，禁止记录令牌/密码；本地通过不代表部署、供应商或真机验收。
- [ ] **Step 3: 按实际实现同步 API、模块与流程。** 04 册列五接口、字段、参数白名单、权限、错误码、空值与旧趋势兼容；05 册落实区域、服务归属、数据来源和口径；06 册落实请求/刷新/下钻/入口消费/版本冲突。README 只更新本模块状态及验收链接，不再次添加与实现无关的架构重写。设计资源路径、Y8KAi 和预览继续保留在独立 spec/本计划中。
- [ ] **Step 4: 核对数据库及非功能事实。** 无结构变化就在验收记录明确「无数据库结构变更」，核对数据表复用关系；若 Task 7 新增索引，03 册与新迁移、init、实体逐项一致，附隔离验证结果且旧 checksum 不变。07 册仅回填实际权限/查询性能边界，不扩展统计缓存或未实测容量承诺。
- [ ] **Step 5: 文档与最终差异检查。** `git diff --check`；核对 Markdown 路径、五接口与前后端类型逐项一致、无 `docs/desing` 错目录、无将未完成步骤写成已验收。验收记录链接能到达，本次变更没有覆盖其他任务；需要重新构建/测试的新增代码改动完成验证后再交付。
- [ ] **Step 6: 交付检查点。** 报告功能完成情况、实际通过的 API/浏览器/视觉检查、文档同步路径和剩余边界。仅在用户已要求提交时形成限定范围提交，建议 `docs(dashboard): 同步实现与验收结果`；本计划不授权推送、部署或清理既有工作。

## 计划自检与完成标准

本计划已将 spec §1/1.1 映射到 Task 6/8，§2/6 映射到 Task 5，§3 映射到 Task 4/6/8，§4/5 映射到 Task 1—3/7，§7/8 映射到 Task 7/8，§9 映射到 Task 9。五项 Review Focus 均有对应测试任务；响应名、服务方法、入口协议和请求状态保持一致。

交付须同时满足：真实 API 数据正确、权限/DTO/统计边界通过、入口与缓存/未保存行为正确、真实浏览器主链通过、视觉对照 Y8KAi 通过、实际数据库定义一致、正式设计回填完成且验收证据可追溯。仅写完页面、接口返回 200、构建通过或文档写完，都不能单独标记整项完成。
