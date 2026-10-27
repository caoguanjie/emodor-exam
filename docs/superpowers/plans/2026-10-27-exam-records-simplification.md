# 考试记录精简实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将考试记录收敛为按人、按卷查询每次考试及只读答卷的页面，修正未交卷展示及管理端旧状态清理。

**Architecture:** 保留冻结考试事实与旧 API 参数，在管理端查询接口补充业务筛选、展示字段及独立选项接口。前端把筛选写入路由，列表和详情共用结果展示逻辑；学员页面提供带精确内部 ID 的入口；按用户最新要求，试卷列表不提供考试记录按钮。

**Tech Stack:** NestJS / TypeORM / MySQL；Vue 3 / Element Plus / Vitest。

**Spec:** 本对话已批准的精简方案，以及用户最终修订：“来源这个已经没有来源了，这个类可以不要。更多筛选：不要。所有筛选框都要平铺出来。其他我没有问题了”。

## Global Constraints

- 考试记录列表、详情均去掉来源；不改本次范围外的学员来源模型、抽题策略或统计规则。
- 关键字、试卷、培训类别、难度、考试状态、考试日期全部平铺；没有“更多筛选”。
- 难度筛选仅提供简单、困难；中级/混合/未知保留后台历史读取，不作为界面筛选选项。旧链接的这些值不再形成隐藏筛选。
- 不改数据库结构、历史记录、分数、交卷、实名、答案权限；不读或打印凭据。
- 本次保留当前工作区已有未提交改动；不提交、不推送。按文件分工，接口契约先固定。
- 测试与改动成比例：状态/日期筛选/权限/路由恢复有行为测试；普通文案与样式不单独写测试。

## Review Focus

- 未交卷内部零值不得显示为已评分零分；真正已出分零分必须显示。
- 管理端不再接受或派生两种历史状态，排除旧 submitted 和已评分 timeout，禁止伪装为普通状态；共享历史读取保持。
- 日期以北京时间开考日期计算，结束日期含整日；无效/倒置日期拒绝。
- 选项接口仅需 exam_records:read；不依赖试卷、统计或学员管理的额外权限。
- 按学员/试卷进入记录和详情返回保留过滤、分页；迟到响应不覆盖当前数据。

## Task 1: 查询 API 与回归（后端 worker）

**Files:** `server/src/modules/exams/exam-admin.controller.ts`、`exam-records.service.ts`、`server/test/exam-records.spec.ts`、`tests/training-records.mjs`，必要时新增同范围测试。

**Interfaces:**
- 保留旧参数，增加 `user_id`、`category_id`、`result_status`、`date_from`、`date_to`。
- 日期为 YYYY-MM-DD，按 Asia/Shanghai 的 started_at 起止半开区间；上下界可单独传。
- `result_status`: `in_progress | passed | failed | timeout`；管理端排除旧 submitted 和已评分历史 timeout，摘要/结果详情返回404，共享历史reader不改。
- 列表/详情增加 `category_name: string|null`、`total_score: number|null`、`result_status`；满分只读 `rule_snapshot.totalCents / 100`，不读取当前试卷满分，不伪造旧历史满分。
- GET `/admin/exam-records/options` 返回 `{papers:[{id,title}],categories:[{id,name}]}`；权限 `exam_records:read`；选项包含有效试卷与历史记录关联的试卷/类别，供名称查询，不能把停用/软删历史关联丢掉。

- [x] 补充并先运行状态、日期、ID/选项权限和冻结满分回归测试，确认原实现失败。
- [x] 实现兼容的查询/展示投影及 options 静态路由，放在 `:id` 之前。
- [x] 运行针对性单元测试与 server build；扩充 training-records 临时库集成断言供根代理执行。

## Task 2: 列表与详情（前端 worker）

**Files:** `web/src/views/admin/ExamRecords.vue`、`ExamRecordDetail.vue`、`web/src/api/training-types.ts`，新增 `web/src/utils/exam-records.ts` 与行为测试。

**Interfaces:** 消费 Task 1 的附加字段/筛选及 options；不请求统计权限接口。路由入口 `/admin/exam-records?paper_id=...` 或 `?user_id=...`，可带 `paper_title`/`learner_name` 仅用于界面提示，不能作为 API 参数。详情携带 `return_to`（只接受记录列表内部地址）保存返回位置。

- [x] 先写行为测试：未交卷不显示零分、历史已评分超时、真实零分、六项平铺筛选请求、详情返回恢复。
- [x] 列表列为学员、试卷（第二行第 N 次）、培训类别、成绩、考试结果、考试时间、操作；移除 ID/来源/难度/进度/重复结果列。
- [x] 筛选平铺：关键字、可搜索试卷、类别、难度、结果、日期范围；查询/重置/分页同步 URL，处理后退、迟到响应、选项加载失败。
- [x] 详情主要展示学员、试卷、次数、结果、得分/满分和时间；进行中/纯超时展示业务说明，仅已出分正常考试请求结果。只读逐题结果保留；ID/截止/提交方式在次要信息区域。
- [x] 运行新增针对性 Vitest。

## Task 3: 入口、文档和验收（根代理）

**Files:** `web/src/views/admin/Papers.vue`、`Users.vue`（保留已有 dirty 改动）、相关行为测试；`docs/design/04-API设计.md`、`05-模块设计.md`，`review/2026-10-27-exam-records-simplification.md`。

- [x] 添加按 `exam_records:read` 控制的学员“考试记录”入口（试卷入口按用户最新要求取消），自动按内部 ID 筛选；测试入口权限和路由。
- [x] 同步 API/模块文档，不改其它既有修改。
- [x] 运行针对性前后端测试、server build、web 类型检查和隔离产物构建；临时库 training-records 集成测试。
- [x] 用现有浏览器页面验证平铺筛选和列表布局，并用无真实个人数据的浏览器 fixture 验证关键状态与详情。
- [x] 独立审查本次差异并处理实质问题，记录验证与未验边界。

## 执行记录

- 初始状态：主工作区有试卷管理、编辑器、设计文档等既有修改。本次不覆盖或提交它们。
- 范围判断：用户“来源不要”应用于本次考试记录界面；不删除历史事实字段或改变其它模块的抽题规则。
- 方案已获用户批准，直接按当前工作区文件归属实施；不再次要求选择执行方式。

- 最终完成：后端42项、前端相关63项、标签/详情Node11项与ephemeral training-records通过；类型检查和最终隔离构建通过；真实空列表与虚构六状态/答卷浏览器检查通过。
- 浏览器补充修复：记录筛选URL不再增生同名业务标签；只对记录列表/同答卷pathname合并，保留最新完整URL。独立审查通过。
- 验收证据与边界见 `review/2026-10-27-exam-records-simplification.md`。未提交、未部署生产。
- 10:51 用户补充：移除列表刷新与时间说明，使用公共列表的 `el-empty` 图示空状态，时间列直接标注“开考时间”。已按现有 FitsTable/课程/学员/题库列表方式落实。

- 11:04 用户补充：改为“考试状态”，仅保留四态；考试日期用单个daterange，外宽260px；旧单侧UI日期取消，范围成对恢复/清除。
- 清理边界：本地ruleexam考试记录0条，旧两类关联答案/题单/媒体引用均0，无数据需要删；管理端移除派生、过滤选项和展示分支，并在列表/detail/result统一排除旧类。共享旧制度、移动历史和统计读逻辑不拆。
