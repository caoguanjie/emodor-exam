# 独立随机模拟考 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在现有公共随机考试基础上交付独立模拟卷、无限次随机模拟、正常评分与错题收录，同时隔离正式成绩并保护历史答卷。

**Architecture:** 正式和模拟共用题库及考试引擎，使用不同 paper_id。模拟保留首次 assignment 的来源/难度与单活跃锁，每次新 record 冻结最新模拟 release；进行中、评分、历史与媒体读取对应 record 快照。用途由服务端保存，正式统计过滤模拟，历史记录与错题保留模拟。

**Tech Stack:** Node ≥22、NestJS / TypeORM / MySQL 8 / Redis、Vue 3 / Element Plus、uni-app / Wot UI 2.3.2、Vitest、现有隔离 E2E 与 Playwright。

**Spec:** [已确认模拟考设计](../specs/2026-10-28-practice-random-exam-design.md)。执行时同时阅读本计划、该设计及仓库 AGENTS.md。

状态：已按用户明确指定的 Astra 工作流实施并完成验收；实际命令与未验边界见 [验收记录](../../../review/2026-10-28-practice-random-exam-acceptance.md)。编写基线 HEAD 为 `1f07cd731661f146d95a7ad1d92b4ed8dd454b8c`；执行前重新核对工作区。公共随机考试已在当前源码落地，不重复实施上一期功能。

## Global Constraints

- “模拟考不限次数，及格后仍可以再次参加；不消耗正式考试次数。”不得用 100、9999 等有限值、清空记录或重置次数实现。
- “模拟卷修改并重新发布后，所有学员下一次新模拟使用最新配置；已开始的本次模拟和全部历史记录保持原版本。”正式考试仍沿用首次冻结发布/规则。
- “每次新模拟随机抽题，一次题单内不重复；不同次模拟之间、模拟与正式之间允许重题，不保证题单一定不同。”
- 本期仅 training + random + public 模拟卷；用途创建后不可互转。来源由服务端首次冻结，institution → easy、external → hard；工种可选，登录、实名、账号权限与既有考前学习条件保留。
- 题型 single / multiple / judgment；每题型 1—500 道，省略 0 题规则；总分 0.01—999.99，时限 1—1440 分钟，及格分 >0 且 ≤ 总分。分值按整数分币，沿用多选部分分规则。
- 正式次数 1—100、默认 3；模拟用显式 unlimited 语义。旧未知次数不升级成不限次；历史已评分 timeout 继续只读兼容。
- 超时不自动提交、不评分、不生成答案或错题；恢复不换题、不延时；提交幂等，开始/发布/提交并发保持事务完整。
- 不新增模拟题库、错题专项训练、模拟排行榜、定时开放、专属二维码、底部导航或新评分/媒体模块。
- 敏感值只由现有 harness 在运行期生成/注入；不读取或打印真实凭据。测试只能使用自有隔离库，不接开发库执行重建。
- 新迁移拟用 `043_practice_random_exam.sql`（编写时最新为 042），执行前重新检查；不改既有 checksum。同步 init、entity、设计分册与 API 合同。
- 用户随后明确授权按 Astra 并行实施；本次在独立工作区完成代码、隔离测试和本地提交，不包含升级开发/生产库、创建发布真实模拟卷、重启用户服务、推送或部署。

## Review Focus

1. 看完须知后运营重新发布，或成功开考但响应丢失：新开须知过期零写入，恢复请求不被旧 expected_release_id 阻断（T3、T7、T8）。
2. v1 仍在答题时发布 v2、随后撤回：本次题量/分值/解析/媒体不变，结束后才能按最新有效版本开始下一次（T3、T4、T8）。
3. 伪造用途或把旧 formal 的 null 上限当不限次：后端权威用途与客户端三态展示都不能放宽正式次数（T1、T3、T7）。
4. 模拟分数更高、直接请求模拟 paper_id 的正式报表：指标、排名、导出、首页都排除模拟，但同一账号仍看得到模拟错题和成绩（T4、T5、T8）。
5. 复制长标题/学习条件、取消新建，以及登录中切账号：模板无写入，规则不丢失，跨账号请求与本地草稿不串用（T2、T6、T7）。

## 实际执行裁决

- 后端worker独占服务端契约、DTO、schema和T1—T5；PC/H5 worker各自独占对应包与类型。root负责文档、runner/E2E、集成提交，tester独立验证；并发符合实际槽位限制。下方原分工作为计划记录，执行以此裁决为准。
- 独立前后端审查各发现一项P2，两项均有RED/GREEN及固定提交复审；真实数据库发布竞态另有2个双连接测试。
- 媒体版本/权限由服务单测验证，未新增真实图片专项API测试；其余关键API/PC/H5流程已在隔离环境运行。完整证据与测试编排修正见验收记录。
- 下面复选框表示任务已按该裁决完成，不把构建、桌面浏览器扩大为真机/真实供应商或部署。

## 文件边界、依赖与并行

采用 Astra 分工，root 冻结接口与集成，独立任务按工作区角色配置委派；不在计划中改模型或用户级 Agent 设置。实现前核对隔离工作区，保护已有修改；不对多个 owner 开放同一文件写权限。

```text
T1 契约 / 迁移
 ├─ T2 配置 / 发布 → T3 开考 / 摘要 → T4 历史 / 错题 / 题图
 ├─ T5 正式统计隔离
 ├─ T6 PC（消费 T2 接口）
 └─ T7 H5（消费 T3/T4 接口）
              全部汇合 → T8 隔离联调 / 浏览器 / 审查
```

| owner | 任务与文件边界 | 交接条件 |
|---|---|---|
| root | T1；公共 DTO/类型、迁移/init、设计分册、runner 注册；最终集成 | 接口先定，其他任务不各自改共享字段 |
| 后端考试 worker | T2 → T3 → T4；paper/attempt/history/record 业务及对应单测 | 每任务红绿验证后按明确路径提交 |
| 统计 worker | T5；两份统计服务及对应测试 | T1 后可独立并行 |
| PC worker | T6；web 表单、列表、记录、测试 | T1 后可用冻结响应夹具开发，联调等待 T2/T4 |
| H5 worker | T7；mobile API/store/页面、测试 | T1 后可用冻结响应夹具开发，联调等待 T3/T4 |
| root / tester / reviewer | T8；独立验收与固定候选差异审查 | 受实际并发上限调度，不强求所有角色同时运行 |

公共文件：`server/src/common/training-contracts.ts`、`server/src/common/errors.ts`、`server/src/modules/exams/paper.dto.ts`、`attempt.dto.ts`、`web/src/api/training-types.ts`、`mobile/src/types/exam.ts`、设计分册和 runner 由 root 维护。后续 worker 提交补丁请求，root 在交接点落地，避免相互覆盖。

## T1：冻结用途与不限次契约，完成兼容迁移

**Files:** 新增 `database/migrations/043_practice_random_exam.sql`、`tests/practice-random-paper-migration.test.mjs`、`server/src/modules/exams/exam-purpose.ts`、`server/test/exam-purpose.spec.ts`；修改 `database/init.sql`、`server/src/entities/exam-paper.entity.ts`、`paper-release.entity.ts`、`exam-record.entity.ts`、上述公共 DTO/类型、`tests/migration-contract.test.mjs`、`tests/migration-catalog.test.mjs`、`docs/design/01-需求分析.md`、`03-数据库设计.md`、`04-API设计.md`、`README.md`。另在 `server/src/modules/ai/paper.service.ts` 和 `server/src/modules/exams/paper-release.service.ts` 仅做 nullable 参数与校验收窄适配，随后交给 T2，不并行修改。

**Interfaces（后续所有任务以此命名）:**

```ts
type ExamPurpose = 'formal' | 'practice'
type AttemptLimitKind = 'limited' | 'unlimited' | 'unknown'
// exam-purpose.ts：只接收服务端已解析用途，缺失历史用途在读取边界归一为 formal。
resolveAttemptLimit(purpose: ExamPurpose, maxAttempts: number | null | undefined):
  { kind: AttemptLimitKind; maxAttempts: number | null }
// practice -> unlimited/null；formal 正的安全整数 -> limited；formal 缺失/非法 -> unknown。
// 读取历史正整数上限不强套新建1—100范围，新增/修改/发布另行严格校验。
interface PracticePaperTemplate {
  title: string; exam_purpose: 'practice'; mode: 'random'; pool_scope: 'public'; category_id: null;
  rules: Array<{ type: QuestionType; count: number; score_cents: number }>;
  total_score: number; pass_score: number; duration_minutes: number; partial_credit_ratio: number;
  max_attempts: null; requires_learning: boolean; required_learning_minutes: number | null;
  course_ids: Id[]; regulation_ids: []; remark: null; sort_order: 0;
}
```

- 实体三表新增 `exam_purpose VARCHAR(16) NOT NULL DEFAULT 'formal'`，属性统一 `examPurpose`；试卷不可更改用途，发布/记录写入当时用途。迁移不改历史 JSON、来源、记录或分数。
- `exam_paper.max_attempts` 改为可空、默认 3；`ExamPaper.maxAttempts` 和 `RuleSnapshot.maxAttempts` 改为 `number | null`。practice 必须 null，formal 新建/发布必须 1—100；不向旧 JSON 回填 null。
- API 字段统一 `exam_purpose`；管理新建省略即 formal；修改请求不允许该字段。practice 新建的 `max_attempts` 省略或 null，服务端归一 null，传任何数字拒绝；formal 显式 null 拒绝。更新依据锁内已存用途校验，禁止 `Number(null)` / `?? 3` 抹掉 unlimited。
- `LearnerExamSummary/Detail` 新增 `exam_purpose`、`release_id: Id|null`、`attempt_limit_kind`，保留 `attempts_used/max_attempts/attempts_remaining`。practice 后两项 null；formal unknown 仍标 unknown。
- `AttemptView`、`ExamHistoryItem`、`FinalResult`、`ExamRecordSummary` 返回 `exam_purpose`；`FinalResult` 追加 `paper_id` 供再考导航；`WrongItem` 追加 `exam_purpose/paper_id/paper_title`。这些新增传输属性在 TS 中可选以兼容旧响应/夹具，但 T3/T4 的新版 API 必须逐项断言实际返回；缺用途只读兜底 formal。新模拟结果缺 paper_id 时显示加载异常，不导航到猜测试卷。
- `StartAttemptDto.expected_release_id?: Id`，仅接受正整数字符串。新模拟必须匹配；恢复优先，不在 DTO 层把缺字段一律拒绝。沿用 `40970` 配置变化错误，不新增用途授权参数。
- PC 与服务端类型使用以上 `PracticePaperTemplate`；列表/记录筛选新增可选 `exam_purpose` 并补全所有严格白名单。移动端保留既有 `AttemptRecordViewV2/FinalResultView/WrongItemV2` 命名，只同步新增属性，不为契约统一重命名全部类型。

- [x] **写失败测试。** 复用现有隔离迁移 harness，覆盖旧三表均 formal、旧列和 JSON 字节语义不变、NULL 上限可保存、init/升级结构一致、逐 DDL 中断可续跑、重复执行无变化；增加用途组合与限次三态测试。

  ```ts
  expect(resolveAttemptLimit('practice', null)).toEqual({ kind: 'unlimited', maxAttempts: null })
  expect(resolveAttemptLimit('formal', null)).toEqual({ kind: 'unknown', maxAttempts: null })
  expect(resolveAttemptLimit('formal', 3)).toEqual({ kind: 'limited', maxAttempts: 3 })
  // DTO/service: practice+fixed / category / numeric max_attempts 和 formal+null 均拒绝。
  ```

- [x] **确认失败。** `npm --prefix server test -- test/exam-purpose.spec.ts`；`node --test tests/practice-random-paper-migration.test.mjs`。预期因新契约/迁移缺失失败，不接受环境错误冒充红灯。
- [x] **实现迁移、类型和纯规则。** 在隔离迁移测试中固定实施前真实提交的 init 为升级基线，按既有可续跑协议逐列处理；更新严格白名单及文档，保持表总数不变。`trainingRule` 参数接受 nullable 后先用 `typeof maxAttempts === 'number'` 收窄，`assertRule` 同样显式收窄；本任务保留原有限业务行为，T2 再加入 practice 分支，不能为编译用非空断言或 null 转 3。
- [x] **验证。** 重跑两条命令并执行 `node --test tests/migration-contract.test.mjs tests/migration-catalog.test.mjs`；`npm --prefix server run build`。预期全部退出 0，旧 checksum 一致。
- [x] **提交与交接。** 仅暂存本任务列出的实际改动，提交 `feat(考试): 增加模拟用途与不限次数契约`，交接字段与迁移号；不升级开发库。

## T2：模拟配置模板、独立草稿与发布

**Files:** 修改 `server/src/modules/ai/paper.service.ts`、`server/src/modules/exams/paper-admin.controller.ts`、`paper-release.service.ts`；新增 `server/test/practice-paper.spec.ts`；扩展 `server/test/paper-release.spec.ts`。若 DTO 需要补充由 root 修改 T1 文件。

**Interfaces:** 消费 T1。新增 `GET /admin/papers/:id/practice-template`，`PaperService.practiceTemplate(id: Id): Promise<PracticePaperTemplate>`；遵守现有管理端读/写权限，结果只含配置。表单保存继续 `POST /admin/papers`；新建/列表/详情/预览返回用途，`PublishedPaper` 与 `get/latestForPaper/preview` 统一包含 `examPurpose`。

- [x] **写失败测试。** `template_uses_saved_draft_or_latest_published_release`、`template_is_readonly_and_clones_learning_rules`、`practice_has_independent_release`、`reject_mutating_purpose`：草稿源用已保存配置，published 源用最新冻结规则及课程门槛；仅允许 formal + training + random + public 源。128 字标题加“模拟考 · ”后按字符安全截断至 128，不破坏 Unicode。取消模板不写库。

  ```ts
  expect(template).toMatchObject({ exam_purpose: 'practice', mode: 'random', pool_scope: 'public', max_attempts: null })
  expect(afterTemplate.paperCount).toBe(beforeTemplate.paperCount)
  expect(newPractice.id).not.toBe(source.id)
  expect(newPractice.status).toBe('draft')
  // 50 × 200 分币、100 × 100 分币均为 10000；缺任一难度题目则发布失败。
  ```

- [x] **确认失败。** `npm --prefix server test -- test/practice-paper.spec.ts test/paper-release.spec.ts`。
- [x] **实现配置和发布。** 模板只准备表单，不调用 copyTraining 复制固定题单；保留明确源卷，不猜唯一源。`trainingRule/buildRule/assertRule` 按用途验证 maxAttempts，发布事务复制用途，候选重新从当前题库冻结，沿用现有全局锁题顺序。用途筛选在分页/count 前完成，通用二维码继续不带 paper_id。
- [x] **验证。** 同一组单测退出 0；额外跑 `npm --prefix server test -- test/public-random-paper.spec.ts` 保证正式随机卷规则未退化。所有新正式路径继续保存数值上限。
- [x] **提交。** `feat(考试): 支持创建和发布独立模拟卷`，将模板与发布响应交接 T3/T6。

## T3：不限次数、最新版本开考与摘要

**Files:** 修改 `server/src/modules/exams/attempt.service.ts`、`learner-exam-summary.ts`、`training-exams.controller.ts`、`attempt-reader.service.ts`；扩展 `server/test/attempt-policy.spec.ts`、`learner-exam-summary.spec.ts`；新增 `server/test/practice-attempt.spec.ts`。T1 的 DTO/root 类型按交接维护。

**Interfaces:** `AttemptService.start(userId: Id, paperId: Id, mobile = false, contentVersion: 2|3 = 2, expectedReleaseId?: Id): Promise<AttemptView<2|3>>`；controller 通过 DTO 将 body.expected_release_id 传入。`decideAttemptTransition` 保留现有输入，`maxAttempts` 扩为 `number|null`，增加可选 `examPurpose`（省略 formal），其返回类型不变。`readLearnerExamSummaries` 返回当前适用 release，与详情学习条件一致。

- [x] **写失败测试。** 针对下面边界构造原有事务仓库夹具，使用真实快照而不是只验证调用次数。

  ```ts
  // records 最高 attemptNo 分别为 3、100、10000，practice 的下一次均可创建。
  expect(practiceTransition.attemptNo).toBe(lastAttemptNo + 1)
  await expect(formalFourthStart).rejects.toMatchObject({ code: 40902 })
  expect(v2Record.releaseId).toBe(v2.id)
  expect(v2Record.ruleSnapshot.totalCents).toBe(v2.rule.totalCents)
  expect(assignmentAfter).toEqual(assignmentBefore)
  expect(recovered.record_id).toBe(activeV1.id)
  ```

  用例包括 `practice_retake_uses_latest_release`、`active_v1_survives_v2_and_withdrawal`、`stale_or_missing_expected_release_has_zero_writes`、`retry_with_stale_expectation_recovers_active`、`formal_assignment_stays_pinned`、`practice_source_stays_pinned`、`failure_rolls_back_new_record_and_items`。并发真实数据库证据归 T8。
- [x] **确认失败。** `npm --prefix server test -- test/practice-attempt.spec.ts test/attempt-policy.spec.ts test/learner-exam-summary.spec.ts`。
- [x] **实现开考分支。** 先锁当前用户/归属及活动记录，按既有协议恢复或纯 timeout；该分支不先比较 expected_release_id。确实新开模拟时才检查 published、权限/实名、最新 release、学习条件及预期版本；缺失/不匹配用 `Errors.paperReleaseConflict('模拟考试配置已更新，请刷新须知后再开始')`（40970）拒绝且零写入。正式接口继续允许省略预期版本。
- [x] **冻结本次事实。** 模拟 source/difficulty 取首次 assignment，release/rule 取本次最新发布；新 record 的 releaseId、ruleSnapshot、examPurpose 从本次上下文写入，不能沿用现有“全部从 assignment 复制”的代码。保持唯一 active_assignment_id；不更新 assignment 初次快照。只对可信 practice 跳过有限额度判定，formal 的缺失/非法上限拒绝新开而不放行。
- [x] **同步摘要与读取。** 模拟有未过期活动记录时用该 record 的 release/rule；无活动时用当前最新发布。`release_id`、题量/分数/时限、学习条件来自同一版本；不限次不显示耗尽。恢复/题图/作答读取使用 record，正式摘要继续取 assignment。历史枚举用精确 projection，避免因新列遗漏 purpose。超时本次只返回超时结果，下一次需明确 start。
- [x] **验证并提交。** 重跑本任务测试及 `npm --prefix server test -- test/public-random-attempt.spec.ts test/sampling.spec.ts`，退出 0 后提交 `feat(考试): 实现不限次模拟与最新发布开考`。

## T4：模拟成绩、历史、错题与题图

**Files:** 修改 `server/src/modules/exams/exam-history.service.ts`、`exam-records.service.ts`、`exam-admin.controller.ts`；按需补 `attempt-reader.service.ts` 的用途投影。测试 `server/test/exam-history.spec.ts`、`exam-records.spec.ts`、`submission.spec.ts`、`media-ticket.spec.ts`。

**Interfaces:** 消费 T1 的 `FinalResult/ExamHistoryItem/WrongItem/ExamRecordSummary`。管理记录查询接受可选 `exam_purpose`，缺省显示两种用途；本人历史和错题也保留两种。结果返回真实 record 的 paper_id / exam_purpose，不以当前 paper 或 assignment 重算成绩。

- [x] **写失败测试。** `practice_scores_and_wrong_items_keep_record_snapshot`、`practice_history_and_admin_filter_have_same_counts`、`v1_media_survives_republish_and_rejects_other_user`。设置同一模拟卷 v1/v2 分值不同，assignment 保留 v1，结果必须各按本次 record 计算。

  ```ts
  expect(result).toMatchObject({ exam_purpose: 'practice', paper_id: practiceId, score: 80 })
  expect(wrong.items.map(x => x.record_id)).toContain(practiceRecordId)
  expect(wrong.items.map(x => x.record_id)).not.toContain(timeoutRecordId)
  expect(adminPractice.total).toBe(adminPracticeExpectedCount)
  // 部分得分、未作答都进入错题；同一题多次答错保留各次记录，不用正确新答卷删旧错题。
  ```

- [x] **确认失败。** `npm --prefix server test -- test/exam-history.spec.ts test/exam-records.spec.ts test/submission.spec.ts test/media-ticket.spec.ts`。
- [x] **实现投影与过滤。** history/result/wrong 使用 record 用途，错题补试卷标题；管理端用途条件同时用于 count/list/options。维持 `gained_score < score_cents`，不得给通用 `exam-record-visibility.ts` 加 formal 过滤。`SubmissionService` 的评分与幂等继续复用；媒体仍是 exam_record_question 引用，不新增 owner type。
- [x] **验证。** 上述单测全部退出 0，包含旧 scored-timeout 只读兼容、本人与跨账号访问、新旧两版题干/解析图。无实质缺陷不重写已有评分或媒体服务。
- [x] **提交。** `feat(考试): 展示模拟成绩并纳入现有错题集`，交接返回字段给 T6/T7。

## T5：正式统计和首页指标隔离

**Files:** 修改 `server/src/modules/statistics/training-statistics.service.ts`、`admin-dashboard.service.ts`；测试 `server/test/training-statistics.spec.ts`、`admin-dashboard.spec.ts`、`admin-dashboard-recent.spec.ts`、`admin-dashboard-learning.spec.ts`。

**Interfaces:** 现有统计 options/overview/context/examSummary/ranking/export 和首页接口保持响应结构；正式范围均为 exam_purpose=formal。直接请求 practice paper_id（包括首页学习汇总）返回已有 40401，不把模拟转成正式报表。通用历史/错题不调用此过滤。

- [x] **写失败测试。** 固定测试时钟以排除 as_of 等时间元数据变化；准备正式 60 分、模拟 100 分且时间更近的同一学员记录，以及只有模拟记录的另一学员：正式人数/均分/排名不变，模拟不占分页名额、不进 options/recent/trend；绕过列表直接访问同样拒绝。

  ```ts
  expect(overviewAfterPractice).toEqual(overviewBeforePractice)
  expect(formalRanking.items[0].score).toBe(60)
  await expect(practiceSummaryRequest).rejects.toMatchObject({ code: 40401 })
  await expect(practiceRankingRequest).rejects.toMatchObject({ code: 40401 })
  await expect(practiceExportRequest).rejects.toMatchObject({ code: 40401 })
  ```

- [x] **确认失败。** `npm --prefix server test -- test/training-statistics.spec.ts test/admin-dashboard.spec.ts test/admin-dashboard-recent.spec.ts test/admin-dashboard-learning.spec.ts`。
- [x] **实施过滤。** overview/options 和上下文加载均在服务端过滤；首页试卷数、参考人数/次数、趋势、最近正式考试、学习候选和学习汇总统一正式范围。用 record 冻结用途约束记录，用 paper/release 用途约束试卷入口；计数、列表、分页同源。纯 ranking 算法不增加不必要用途参数。
- [x] **验证。** 重跑本任务测试，确保正式空列表、0 参与、跨难度分组与旧版本统计仍成立。当前 `LearnerHomeController.home()` 只返回网站配置和课程，不增加本来不存在的学员首页考试统计。
- [x] **提交。** `fix(统计): 隔离模拟考试与正式成绩指标`。

## T6：PC 模拟卷配置与记录

**Files:** 修改 `web/src/views/admin/Papers.vue`、`web/src/components/PaperEditDialog.vue`、`web/src/views/admin/ExamRecords.vue`、`web/src/utils/exam-records.ts`；类型由 T1/root 维护。新增 `web/src/components/question-designers/__tests__/practice-paper.spec.ts`；扩展现有 `paper-edit-dialog.spec.ts`、`paper-list-actions.spec.ts`（同目录）与 `web/src/components/__tests__/exam-records.spec.ts`。

**Interfaces:** 消费 T2 的 template GET、既有 POST/PUT、用途列表筛选与 T4 记录筛选。随机规则继续使用 `RandomPaperRules.vue` 及 `web/src/utils/random-paper-rules.ts`；不新增第二套组卷组件。

- [x] **写失败组件测试。** `prefill_practice_without_creating_until_save`、`practice_50_or_100_questions_keeps_independent_rules`、`practice_displays_unlimited_and_immutable_purpose`；验证从指定源带入题数、分值、学习条件，取消时零 POST，保存一次且不是自动发布。

  ```ts
  expect(createBody).toMatchObject({ exam_purpose: 'practice', pool_scope: 'public', mode: 'random', max_attempts: null })
  expect(createBody.rules.reduce((n, r) => n + r.count, 0)).toBe(50)
  expect(createBody.rules.reduce((n, r) => n + r.count * r.score_cents, 0)).toBe(10000)
  expect(publishRequests).toHaveLength(0)
  ```

- [x] **确认失败。** `npm --prefix web test -- src/components/question-designers/__tests__/practice-paper.spec.ts src/components/question-designers/__tests__/paper-edit-dialog.spec.ts src/components/question-designers/__tests__/paper-list-actions.spec.ts`。
- [x] **实施 UI。** 试卷列表增加用途列/筛选，合格正式随机卷显示“创建模拟卷”；新建可选用途，practice 固定公共随机方式、显示“不限次数”。编辑只读用途，保留默认学习条件。没有源卷也可按现有默认新建；多卷不猜源。发布/撤回文案说明模拟下一次用新版本，二维码仍是同一考试 Tab。记录页增加用途标记与筛选，默认全部。
- [x] **验证。** 重跑组件测试及 `npm --prefix web test -- src/components/__tests__/exam-records.spec.ts`，执行 `(cd web && npm exec -- vue-tsc --noEmit)`；预期测试和类型退出 0。表单重开回显、权限隐藏、保存失败可重试继续沿用既有行为。
- [x] **提交。** `feat(管理端): 配置独立模拟卷并查看模拟记录`。

## T7：H5 模拟入口、再考和错题来源

**Files:** 修改 `mobile/src/api/exams.ts`、`mobile/src/stores/exam.ts`、`mobile/src/utils/exam-summary.ts`、`mobile/src/components/exam/LiveExamCenter.vue`、`LiveExamInstructions.vue`、`LiveExamTake.vue`、`LiveExamResult.vue`、`LiveExamReview.vue`、`LiveExamHistory.vue`、`LiveWrongBook.vue`；类型与 `mobile/src/types/exam.ts` 中 `reviewItem()` 的来源映射由 T1/root 维护。新增 `mobile/test/practice-exam.spec.ts`，扩展 `mobile/test/exam-summary.spec.ts`、`exam-attempt-limit.spec.ts`、`exam-store.spec.ts`。

**Interfaces:** `startExam(paperId: string, expectedReleaseId?: string): Promise<AttemptRecordViewV2>` 在 API 层保留原请求/响应包装，仅新增 body 字段；`store.start(paperId, expectedReleaseId?)` 传递须知展示的 release_id。`examEntry` 对 unlimited 不计算有限剩余，优先继续进行中记录；unknown 绝不能显示不限次。结果的 paper_id 用于回到须知，不能自动 start。

- [x] **写失败测试。** `practice_uses_expected_release_and_reconfirms_40970`、`unlimited_does_not_exhaust_at_100`、`formal_unknown_is_not_unlimited`、`retry_returns_to_instructions_without_start`、`account_switch_drops_pending_practice_response`。

  ```ts
  expect(startBody).toEqual({ expected_release_id: displayedReleaseId })
  expect(startRequestsAfterConflict).toHaveLength(1) // 只刷新须知，不自动重发开考。
  expect(startRequestsAfterClickRetry).toHaveLength(0) // “再考一次”仅导航到须知。
  expect(practiceSummaryText).toContain('不限次数')
  expect(wrongCardText).toContain('模拟考')
  ```

- [x] **确认失败。** `npm --prefix mobile run test:unit -- test/practice-exam.spec.ts`，用既有 Pinia/页面测试夹具覆盖加载、错误和账号 epoch，不复制一套网络客户端。
- [x] **实施交互。** 同一考试列表显示用途，须知/答题/结果显示模拟身份；成功交卷结果可“再考一次”，导航当前卷须知并重读最新配置。超时沿用无分结果，并提供明确返回该卷须知入口以便新模拟。40970 清除旧须知并 reload，显示“模拟考试配置已更新，请确认后再开始”，不自动开考。API 的 `validateAttempt`、结果与错题校验保留新增字段，非法枚举或 practice 缺关键字段作为契约错误，不能静默丢失来源或误认有限次数。
- [x] **补历史与错题。** 显示用途/来源，复用原题目和媒体组件；保留每次错误记录。草稿 key 仍按本人、record，不改成按 paper 共用。实践中使用 wot-ui-v2 skill；仅在新增/调整组件 API 时通过项目离线 CLI 指定 `--version 2.3.2` 核对，不安装 Wot MCP 或新增依赖。
- [x] **验证并提交。** `npm --prefix mobile run test:unit -- test/practice-exam.spec.ts test/exam-summary.spec.ts test/exam-attempt-limit.spec.ts test/exam-store.spec.ts test/exam-content-capability.spec.ts` 与 `npm --prefix mobile run type-check` 退出 0。提交 `feat(学员端): 支持不限次模拟和错题复习`。

## T8：隔离联调、浏览器验收与收口

**Files:** 新增 `tests/practice-random-exam.mjs`、`tests/support/practice-random-browser.mjs`、`review/2026-10-28-practice-random-exam-acceptance.md`；修改 `tests/run-e2e.mjs`、`tests/training-exam-runner-env.test.mjs`，按新增 suite 影响更新 runner 的现有测试。复用 `tests/support/public-random-question-fixture.mjs`、隔离服务与现有 API helpers。

**Interfaces:** 注册 `practice-random-exam` suite，仅允许 `--ephemeral`；运行环境与 public-random-exam 使用同一受控测试设置和 `server/test/identity-e2e-main.ts`，实名替身只存在测试模块。`PRACTICE_RANDOM_BROWSER=1` 启用同一临时库的真实 PC/H5 浏览器阶段，不启用生产运行时旁路。

- [x] **先写 runner 断言。** 新 suite 必须选中正确测试 API 入口和环境，未知 suite 不放行；运行 `node --test tests/training-exam-runner-env.test.mjs` 先红后绿，再补 API 套件。
- [x] **完成真实 API 场景。** 用现有导题 fixture 准备 easy/hard 各 ≥100 道，创建正式 100 题与独立模拟 50 题（每题 2 分、满分 100），另外验证模拟 100 题配置。模拟全对100、全错0、部分得分及空答可核对；只从隔离管理端/DB获答案用于断言，学员开考响应不得含答案/解析/全集。
- [x] **验证版本与并发。** 同学员 v1 开始后发布 v2（改题量、分值、时限；图片归属另按执行裁决的服务单测验证），v1恢复/交卷/错题图不变，下一次用 v2；旧须知40970零写入，活动记录恢复忽略旧预期；并发 start、发布、交卷重试只形成合法冻结记录。正式重复发布不重置归属；真实 API 覆盖模拟第4次和第101次（由隔离夹具准备100条合法历史记录），10000次边界复用 T3 纯规则测试，避免重复跑上万份完整答卷。
- [x] **验证隔离与权限。** 模拟成绩与错题可查，正式统计/排名/export/首页不变，直接访问模拟报表拒绝；撤回、超时、账号禁用/未实名、账号切换和跨账号媒体访问符合设计。测试学习门槛调整后的 v1/v2 读法与当前版本一致。
- [x] **浏览器验收。** PC 从指定正式卷带入配置、取消零写入、保存独立草稿、重开修改50/100题、发布/撤回及记录筛选；H5 查看列表不自动开考、须知校验版本、正常出分、再考回须知、错题来源、刷新草稿与账号切换。截图放忽略目录，不入库。
- [x] **运行比例合适的检查。** 已通过且输入未变的任务级测试复用；最终运行如下必要检查，失败只补受影响验证，不机械跑全库 all。

  ```bash
  npm --prefix server run build
  (cd web && npm exec -- vue-tsc --noEmit)
  npm --prefix mobile run type-check
  node scripts/build.mjs web h5
  node scripts/build.mjs mp-weixin
  node --test tests/practice-random-paper-migration.test.mjs tests/training-exam-runner-env.test.mjs
  PRACTICE_RANDOM_BROWSER=1 PLAYWRIGHT_CHANNEL=chrome node tests/run-e2e.mjs --ephemeral --suite practice-random-exam
  node tests/run-e2e.mjs --ephemeral --suite public-random-exam
  node tests/run-e2e.mjs --ephemeral --suite training-statistics
  node tests/run-e2e.mjs --ephemeral --suite admin-dashboard
  ```

  预期所有命令退出 0；新旧 API断言/PC/H5均通过，临时进程、数据库及目录由 harness 清理。小程序构建仅证明编译，真实手机、供应商、真机与生产部署明确未验。
- [x] **独立审查与证据收口。** reviewer 读取固定候选提交及实际证据，重点核对本计划 Review Focus、nullable 上限、逐次 release、用途过滤和媒体归属；修复实质问题后只补相关验证。验收文档逐项记录命令、退出码、业务结果、截图位置和未验边界，不把计划复选框当运行证据。
- [x] **最终提交与交付。** 提交 `test(考试): 验证随机模拟考与正式记录隔离`，仅包含本次任务文件；重查 status 保护用户修改。部署说明顺序为新增迁移→兼容 API→PC/H5；异常时先撤回模拟卷阻止新开，保留兼容 API 处理活动记录，不能删历史或直接降级到会混合统计模拟成绩的旧服务。不执行未经授权的开发库升级、创建实际卷、发布或远程动作。

## 设计覆盖与执行顺序复核

| 设计验收项 | 实现与验证任务 |
|---|---|
| 1 独立配置/带入、2 发布校验 | T1、T2、T6、T8 |
| 3 H5全流程、4 无限次、5 随机抽题 | T3、T7、T8 |
| 6 恢复/幂等/timeout、7 版本切换 | T3、T7、T8 |
| 8 历史快照/来源、9 评分/错题 | T3、T4、T7、T8 |
| 10 统计隔离、11 门禁/媒体 | T4、T5、T8 |
| 12 迁移/文档/分级验收 | T1、T8 |

实施启动后先完成 T1，再按文件 owner 并行，T2→T3→T4保持顺序。本计划不要求再次讨论已经确认的规则；遇到新业务歧义才提出影响结果的问题，同时推进不依赖答案的任务。
