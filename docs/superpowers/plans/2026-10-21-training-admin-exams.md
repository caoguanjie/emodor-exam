# 随机考试、自动评分、考试记录与统计 Implementation Plan

> **状态（2026-10-22）**：保留原 C1—C7 任务脉络，现行实施以已批准瘦身计划为准，不采用 SDD。C3 只处理三类客观题与持久草稿，C4 收敛为统一结果/历史，C5 收敛为只读考试记录。

**Goal:** 完成从固定/随机发布到个人题单、持久答题、主动/超时交卷、自动评分、PC 考试记录及报表排名的可验收闭环。

**Architecture:** 保留旧接口适配层，将发布、抽题、题单读取、草稿、自动结算、统一历史、纯记录查询和统计拆成单一职责服务。新答卷只从冻结题单读题和评分；数据库约束与事务是正确性依据，Redis 只做缓存及辅助锁。

**Tech Stack:** 现有 NestJS / TypeORM / MySQL / Redis、Vue 3 / Element Plus、ExcelJS、Vitest、独立测试库 API 场景。

**Spec:** [已批准设计](../specs/2026-10-21-training-admin-integration-design.md) §7—12；共同数据与前置依赖见[总计划](2026-10-21-training-admin-integration.md)。

## Global Constraints

- 总计划 Global Constraints 全部适用；本机构随机初级、外来随机高级，不能降级或跨类别凑题。
- 同卷不重复题目/考点；补考可重复历史题，不要求所有考生拿到完全不同题。
- 100 分；默认 60 分通过、30 分钟、总作答 3 次、多选漏选比例 0.5。
- 在考 payload 不含答案、解析或管理元信息；确认保存先落库；服务端截止后不可改答。
- 题型只允许 single/multiple/judgment，主动/超时交卷直接自动评分为 finalized，最终总分无编辑入口。
- 考试 heartbeat 只服务期限与会话校验；不采集切屏、设备摘要或连接状态，不提供监控/强制交卷入口。

## Review Focus

1. 有十条题但只有一个考点、候选版本发布后变更：阻止容量虚高，冻结规则不可被动态数据覆盖（C1）。
2. 第三次开考重试、并发首次、来源变更后补考、Redis 锁失效：恢复原题单优先、只占一次机会（C2）。
3. 上传未保存、旧 revision 重放、保存/交卷/超时争锁、进程重启：只采用截止前确认答案并只结算一次（C3）。
4. 主动/超时与重复请求竞态、未答及多选部分分：防重复汇总，最终结果与历史读取同一冻结事实（C4）。
5. 当前应考人数为零、历史考生已调离、同人补考、不同难度同分：分母、最高分与分榜精确，旧报表仍保留（C6）。

---

### Task C1: 固定/随机试卷配置与发布快照

**Files:** Modify `server/src/modules/ai/paper.service.ts`、`ai.controller.ts`（同目录）、`server/src/entities/exam-paper.entity.ts`、`paper-question.entity.ts`（同目录）、`web/src/views/admin/Papers.vue`、`PaperDetail.vue`（同页面目录）；Create `server/src/modules/exams/paper-release.service.ts`、`sampling.service.ts`、`paper-admin.controller.ts`、`paper.dto.ts`；`008_paper_release.sql` 与实体；Test `server/test/paper-release.spec.ts`、`server/test/sampling.spec.ts`、`tests/training-publishing.mjs`。

**Interfaces:** Consumes B3 `approvedCandidates/QuestionVersionSnapshot` 和总计划 `RuleSnapshot`。Produces `PaperReleaseService.publish(paperId:Id,actorId:Id):Promise<{releaseId:Id}>`、`get(releaseId:Id):Promise<PublishedPaper>`；`PublishedPaper={id:Id;paperId:Id;categoryId:Id|null;businessScope:'regulation'|'training';mode:'fixed'|'random';rule:RuleSnapshot;pool:QuestionVersionSnapshot[];requiresLearning:boolean}`。`SamplingService.validatePool(pool:QuestionVersionSnapshot[],rules:PoolRule[],difficulty:Difficulty):{ok:boolean;deficits:{type:QuestionType;required:number;available:number}[]}`、`draw(pool:QuestionVersionSnapshot[],rules:PoolRule[],difficulty:Difficulty,rng:RandomSource):SelectedQuestion[]`；`RandomSource.nextInt(maxExclusive:number):number`，生产用 crypto，测试可注入；`SelectedQuestion=QuestionVersionSnapshot & {scoreCents:number}`，scoreCents 覆盖题库建议值为考试实际值。

- [ ] **Step 1: 写容量/抽样/快照测试。** 构造同概念十个变体、独立题、初/高级各题型、无制度人工题和跨类别题。
  ```ts
  expect(sampling.validatePool(sameConceptVariants, needTwo, 'easy')).toMatchObject({ ok: false, deficits: [{ type: 'single', required: 2, available: 1 }] });
  expect(new Set(draw.map(x => x.conceptId ?? `q:${x.questionId}`)).size).toBe(draw.length);
  expect(draw.reduce((n, x) => n + x.scoreCents, 0)).toBe(10000);
  expect(releaseAfterEdit.pool).toEqual(releaseBeforeEdit.pool);
  expect(withoutRegulationFilter.includes(manualQuestionId)).toBe(true);
  expect(withRegulationFilter.includes(manualQuestionId)).toBe(false);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/paper-release.spec.ts test/sampling.spec.ts`，预期冻结/按考点计数实现缺失。
- [ ] **Step 3: 实现规则与发布事务。** 新增 business_scope、mode、category_id、requires_learning；旧卷 scope=regulation，training 默认 false，不建报名审批。随机池硬条件仅类别、可选资料来源集合、三类客观题型、难度和审核状态；课程 ID 仅说明关联。资料来源选项允许“本类别题目已实际关联该底层 regulation”或“旧资料自身 category 直接匹配”，新资料本身不预绑类别，跨类别来源拒绝。按考点分组/无组独立题计数，两类难度都够且总分100才发布；组内抽一个变体、组间无放回。固定题单也验证审核、无重复考点、合计100；同类别可跨资料来源，不强制固定卷按学员来源变难度。
- [ ] **Step 4: 固定发布内容并接通 PC。** release 与 release_question 保存规则/版本/考点/分值；发布后不允许改规则或池，复制新试卷后重新发布；撤回/归档只阻新开始。预览随机显示规则、两池可用量与样例并注明非实际考生卷；固定卷预览可打印/导出，随机只导出规则/样例，不能冒充所有考生同一张卷。答案版打印/导出仅授予题库/考试管理权限，后续个人答卷导出走 C4 权限与快照。
- [ ] **Step 5: 绿灯。** 同单测；`DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-publishing`；前端类型/构建。PC 验证固定卷、中级固定卷、随机双难度、缺题/考点容量、跨资料来源过滤、复制/撤回/打印导出。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: publish immutable fixed and random exam releases"`。

### Task C2: 原子开考、个人题单、补考与旧卷适配

**Files:** Create `server/src/modules/exams/attempt.service.ts`、`attempt-reader.service.ts`、`legacy-exam-adapter.ts`、`training-exams.controller.ts`；`009_attempt_snapshot.sql` 与实体；Test `server/test/attempt-policy.spec.ts`、`tests/training-attempts.mjs`。Modify `server/src/modules/exams/exam.service.ts`、`exams.controller.ts`、`shuffle.service.ts`、`server/src/entities/exam-record.entity.ts`。

**Interfaces:** Consumes A2 trainingProfile、C1 get/draw。Produces `AttemptService.start(userId:Id,paperId:Id):Promise<AttemptView>`、`recover(userId:Id,recordId:Id):Promise<AttemptView>`；`AttemptReaderService.forStudent(userId:Id,recordId:Id):Promise<AttemptView>`、`forGrading(tx:EntityManager,recordId:Id):Promise<GradingSnapshot>`；`GradingSnapshot={recordId:Id;rule:RuleSnapshot;items:(SelectedQuestion & {itemId:Id;displayToOriginal:number[];position:number})[]}`，不可被控制器直接序列化。新路由 `/me/exams`、`/me/exams/:id/start`、`/me/exam-records/:id`；旧 `/exams/*` 由适配器保留结构。

- [ ] **Step 1: 写并发/失败/兼容测试。** suite `training-attempts` 使用真实数据库同时发送20次开考，在第三次作答恢复、Redis 锁不可用、抽样异常回滚等情况下检查事实；不以两人题目必须不同作为随机测试。
  ```js
  assert.equal(new Set(starts.map(x => x.data.record_id)).size, 1);
  assert.equal(await countCommittedAttempts(userId, paperId), 1);
  assert.deepEqual(recovered.data.questions, first.data.questions);
  assert.equal(recovered.data.deadline_at, first.data.deadline_at);
  assert.equal(retakeAfterSourceChange.data.difficulty, 'easy');
  assert.equal(failedDrawAttemptCount, 0);
  assert.deepEqual(findForbiddenKeys(first.data, ['answer', 'analysis', 'rubric']), []);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/attempt-policy.spec.ts`，预期新题单/归属策略未实现；集成并发断言在事务实现后必须执行，不用 mock 证明数据库正确性。
- [ ] **Step 3: 实现开考事务。** 锁定用户行，读取或创建唯一 assignment；先恢复已有有效进行中答卷，再判次数/已通过，避免第三次无法恢复。首次用当前类别及来源；后续本场沿用冻结类别/来源/难度/规则，账号停用仍拒绝。开始和撤回对 paper 行采用一致锁序；每次新开考要求 published，在考恢复不受后续撤回影响。事务内分配 attempt_no、抽题、写记录和全部题单；失败全回滚，active_assignment_id 可空唯一约束兜住一个活动答卷，提交后置空。补考独立抽题，但继续同 release/规则。原卷有升级前记录时，次数/已通过检查包含全部旧记录，不能新增 assignment 就从首次重算；新增测试“旧记录已用2次→新快照第3次，不能再第4次”。
- [ ] **Step 4: 实现快照读取与兼容适配。** 保存题干/题型/选项/标准答案/解析/分值/难度/考点/来源版本及完整显示顺序和选项映射；沿用 HMAC shuffle 但把结果存下，不因以后密钥或题库变化重排。题干、选项、解析可包含受控题图，但快照不含 rubric 或答案附件。随机难度按来源；新固定卷同卷同内容，卷面全同档则用该档、混档标 `mixed`；旧固定卷标 `unknown`，两者不反推来源难度。旧已结束记录不伪造；旧已发布卷新开始以 legacy_start 捕获当前内容。旧客户端仍使用 question_id 与原字段，适配为本次 item_id；新随机/判断题不混入旧员工页面可开列表，改用本期 `/me/*` API 验收。
- [ ] **Step 5: 绿灯。** 同单测；`DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-attempts`。验证旧卷学习门槛、新卷无门槛、并发恢复、跨账号拒绝、已通过/三次用完、资料变化与发布后改题不改变快照；固定卷旧员工 PC 流程回归。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: create immutable per-learner exam attempts atomically"`。

### Task C3: 持久草稿与幂等自动交卷

**Files:** Create `server/src/modules/exams/answer-draft.service.ts`、`submission.service.ts`、`attempt.dto.ts`；`010_answers.sql`；Modify `server/src/modules/exams/training-exams.controller.ts`、`exam.service.ts`、`grading.service.ts`、`server/src/entities/exam-answer.entity.ts`、`exam-record.entity.ts`、`server/src/tasks.service.ts`；Test `server/test/answer-draft.spec.ts`、`server/test/submission.spec.ts`、`tests/training-submissions.mjs`。答案媒体 controller 不属于现行模块。

**Interfaces:** Consumes C2 forGrading 与总计划 DraftInput/AnswerInput。Produces `AnswerDraftService.save(userId:Id,recordId:Id,input:DraftInput):Promise<DraftAck>`；`SubmissionService.submit(userId:Id,recordId:Id,input?:DraftInput):Promise<FinalResult>`、`timeout(recordId:Id):Promise<FinalResult>`，两者进入同一个 `finalize(tx,recordId,method):Promise<FinalResult>`；`PUT /me/exam-records/:id/draft`、`POST /:id/heartbeat|submit`。不存在 switch 或 answer-images 路由。

- [ ] **Step 1: 写答案、期限和终结竞态测试。** suite `training-submissions` 的夹具包含 single/multiple/judgment、未答和多选漏选；定义中断响应/重启 API 的辅助动作，保存后直接查 DB 防假持久化。
  ```js
  assert.deepEqual(recovered.data.answers, acknowledgedAnswers);
  assert.equal(staleRevision.status, 409);
  assert.equal(afterDeadlineSave.status, 409);
  assert.equal(await countFinalizations(recordId), 1);
  assert.equal(result.data.grading_state, 'finalized');
  assert.equal(result.data.score, expectedScore);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/answer-draft.spec.ts test/submission.spec.ts`，预期持久 revision 或一次终结失败。
- [ ] **Step 3: 实现确认草稿。** 保存全量答案，新 revision 必须等于当前+1；当前 revision 同 payload 哈希重试返回原确认，不同 payload 或旧 revision 返回409并可 GET 恢复。锁记录后按服务端时间、本人本卷 item、三类题型、选项下标和无重复规则校验；事务提交后才 ACK。截止后同 payload 的已成功确认可查询回放，但不能产生新答案写入。
- [ ] **Step 4: 统一主动和超时交卷。** 主动提交可带最新 DraftInput，同事务先保存再终结；如已经过截止，只按此前确认稿走 timeout，不采客户端时间/新 payload。定时任务与主动提交锁同 exam_record，终态重试回原结果；清理 active_assignment_id，提交方式另存 manual/timeout。training 路径由 `SubmissionService.gradeSubmissionSnapshot` 从 snapshot 判分并在终结事务保存：单选/判断全对得分，多选沿用漏选比例，未答为0；三类题直接写 `grading_state=finalized` 与 `graded_at`。旧 `GradingService` 只保留 legacy 固定卷自动评分。旧接口 heartbeat/submit 经适配器保存同一事实，迟到 heartbeat 不得续期，也不写监控专用字段。
- [ ] **Step 5: 绿灯。** 同单测；`DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-submissions`。真实进程重启后确认稿可恢复；数据库并发测试覆盖保存与截止边界、主动/超时竞态、重复提交和三类客观判分。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: persist exam drafts and finalize submissions idempotently"`。

### Task C4: 统一历史结果与错题

**Files:** Create `server/src/modules/exams/exam-history.service.ts`；Modify `server/src/modules/exams/training-exams.controller.ts`、`exam.service.ts`；Test `server/test/exam-history.spec.ts`、`tests/training-submissions.mjs`。历史 `011_manual_grading.sql` 保持 checksum 不变；现行实体、controller 和 provider 不注册其人工阅卷能力，015 在数据 preflight 后删除专用结构。

**Interfaces:** Consumes C2 冻结题单与 C3 FinalResult。Produces `ExamHistoryService.result(viewerId:Id,recordId:Id):Promise<FinalResult>`、`wrongItems(userId:Id,page:number,pageSize:number):Promise<Page<WrongItem>>`，WrongItem=冻结题及本人答案/自动分数/记录 ID，答案解析仅交卷后可读；`/me/exam-records`、`/:id/result`、`/me/wrong-questions` GET。管理端结果路由由 C5 以 `exam_records:read` 复用该服务。

- [ ] **Step 1: 写结果口径测试。** 夹具覆盖满分、错选、多选部分分与未答；本人和管理员结果必须读取同一快照，动态改题不能改变历史。
  ```js
  assert.equal(final.data.score, expectedTotal);
  assert.equal(final.data.grading_state, 'finalized');
  assert.equal(final.data.passed, expectedPassed);
  assert.deepEqual(wrongItemIds.sort(), [partialItemId, unansweredItemId].sort());
  assert.equal(otherLearnerResult.status, 403);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/exam-history.spec.ts`，预期统一快照结果或权限边界缺失。
- [ ] **Step 3: 实现统一结果读取。** 交卷后解析与错题来自同一 snapshot 和自动评分事实；错题是 finalized 记录中的非满分项，正确率=满分题数/总题数。历史/个人卷与成绩查询都走 ExamHistoryService；遗留记录明显标注旧口径。最终结果只读，不提供逐题评分、评语或总分修改接口。
- [ ] **Step 4: 绿灯。** 同单测及 `DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-submissions`；学员 API 验证本人历史/结果/解析/错题分页与他人拒绝。
- [ ] **Step 5: 本地提交。** `git commit -m "feat: read snapshot-based exam results"`。

### Task C5: 考试记录管理

**Files:** Create `server/src/modules/exams/exam-records.service.ts`、`exam-admin.controller.ts`、`web/src/views/admin/ExamRecords.vue`、`ExamRecordDetail.vue`（同页面目录）；Test `server/test/exam-records.spec.ts`、`tests/training-records.mjs`。Modify `web/src/router/index.ts`（根集成）。

**Interfaces:** Consumes C2 snapshot/归属、C3 持久草稿/状态与 C4 ExamHistoryService。Produces `ExamRecordsService.list(actorId:Id,query):Promise<Page<RecordSummary>>` 与 `detail(actorId:Id,recordId:Id):Promise<RecordDetail>`；`GET /admin/exam-records`、`GET /admin/exam-records/:id`、`GET /admin/exam-records/:id/result`，全部要求 `exam_records:read`。服务不返回 last_heartbeat_at、connection_state、switch_count、device_summary 或评分版本。

- [ ] **Step 1: 写安全投影与权限测试。** 未 ACK 的草稿不算已答；在考记录不带标准答案，管理员缺少 read 权限时列表、详情与结果都拒绝。
  ```ts
  expect(savedOnly.answered_count).toBe(2);
  expect(JSON.stringify(inProgress)).not.toMatch(/answer|analysis/);
  expect(withoutReadPermission.status).toBe(403);
  expect(adminResult.data.items).toEqual(studentResult.data.items);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/exam-records.spec.ts`，预期记录投影或管理员 result 路由缺失。
- [ ] **Step 3: 实现纯记录投影和 PC 页面。** 列表按学员/试卷关键字、试卷、来源、难度、考试状态和 `not_submitted/finalized` 分页；详情返回稳定记录事实与题目/已答数，不推断连接或作弊。`/admin/exam-records/:id/result` 由 ExamAdminController 委派 ExamHistoryService，不另造结果模型。页面只提供记录查询、详情和终态结果，不保留监控/强交占位。
- [ ] **Step 4: 绿灯。** 同单测；`DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-records`；前端类型/构建。两个真实测试学员由 API 开考、保存、交卷，PC 验证列表、详情和结果与学员侧一致。
- [ ] **Step 5: 本地提交。** `git commit -m "feat: add read-only exam records"`。

### Task C6: 保留旧报表，增加培训统计、分榜与首页

**Files:** Create `server/src/modules/statistics/training-statistics.service.ts`、`training-statistics.controller.ts`、`ranking.ts`、`web/src/views/admin/Dashboard.vue`、`TrainingStatistics.vue`（同页面目录）；Modify `server/src/modules/statistics/statistics.service.ts`、`statistics.controller.ts`、`server/src/modules/exams/submission.service.ts`（只接缓存失效）；Test `server/test/training-statistics.spec.ts`、`tests/training-statistics.mjs`。旧 `Statistics.vue` 菜单隐藏但后端接口兼容保留。

**Interfaces:** Consumes B2 应学/课程进度、C2 assignment、C4 finalized/result。Produces `TrainingStatisticsService.examSummary(filter:StatsFilter):Promise<ExamSummary>`、`ranking(filter:StatsFilter):Promise<Page<RankRow>>`、`export(filter:StatsFilter):Promise<Buffer>`、`invalidate(paperId:Id):Promise<void>`，`StatsFilter={paperId:Id;categoryId?:Id;source?:LearnerSource;difficulty?:ExamDifficulty;page:number;pageSize:number}`。ExamSummary 包含当前应考、成功开考、历史开考、finalized 作答/人数、参与率、按难度的平均分/通过率/分布、难度构成、未完成原因聚合与 `as_of`；不含 pending grading 指标。RankRow 包含 `rank:number;user_id:Id;name:string;source:LearnerSource|null;difficulty:ExamDifficulty;score:number;duration_seconds:number;record_id:Id`。

- [ ] **Step 1: 写人工可算的统计夹具。** 当前应考A/B/C/D四人；A初级两次50/80，B初级80，C高级最终90，D未开考；调离的E曾开考。另测试无人应考、legacy unknown、固定 mixed、学习仅机构学员及未完成原因聚合。
  ```ts
  expect(summary.eligible_count).toBe(4);
  expect(summary.eligible_started_count).toBe(4);
  expect(summary.historical_started_count).toBe(5);
  expect(summary.participation_rate).toBe(1);
  expect(easyRanking.map(x => x.rank)).toEqual([1, 1]);
  expect(summary.finalized_users).toBe(3);
  expect(noEligible.participation_rate).toBeNull();
  expect(exportedRows).toEqual(screenRows);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/training-statistics.spec.ts`，预期旧查询错误混合难度，或新服务缺失。
- [ ] **Step 3: 实现唯一统计口径。** 排名/平均/通过/分布使用同 paper+release评分规则+difficulty 内每人 finalized 最高分；同分选较早 graded_at 记录展示，标准竞争排名1/1/3，用时不打破同分名次。ranking 要求明确 difficulty，未指定返回400；summary 未筛难度时均分/通过率/分布按难度分组返回，不产生跨档总分榜。分子取当前应考集合与历史成功开考人的交集，历史总人数另列；来源/难度相关历史筛选读冻结归属，当前应考筛选读当前人群并标时点。旧制度跨卷最高分继续独立旧口径，未知难度不回填。
- [ ] **Step 4: 实现 PC 筛选、首页及导出。** 课程完成率用 B2 当前必学版本，只统计本机构应学；培训统计返回未学/未考/未通过的原因聚合和排名，不提供逐人未完成名单。旧制度/部门/个人报表后端及 Excel 接口兼容保留，旧菜单隐藏；新场次报表按类别/来源/难度查询和导出，共用查询函数。首页学员/题目/试卷数量与按日考试记录趋势来自权限允许的聚合接口（`/admin/dashboard`），Asia/Shanghai 展示日期；没有权限的模块不返回指标。自动结算、人员范围/课程版本变化失效相关缓存。
- [ ] **Step 5: 绿灯。** 同单测；`DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-statistics`；前端类型/构建。PC 对夹具逐项核算表格/趋势/排名/导出与空分母；旧统计后端回归和新报表均有证据。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: add scoped training reports and difficulty rankings"`。

### Task C7: 全链回归、升级演练与交付收口

**Files:** Create `tests/training-full-flow.mjs`、`docs/testing/training-admin-acceptance.md`、`review/training-admin-implementation-review.md`；Modify `tests/run-e2e.mjs`、`tests/e2e-smoke.mjs`（必要兼容，不删除原断言）、`README.md`、`docs/design/README.md`、受影响 01—07 册。不得改写旧站盘点成“现已实现”。

**Interfaces:** Consumes A1—C6 全部 API、数据库脚本、PC 页面与报告；Produces 有明确实际结果的验收清单、升级运行说明、独立审查记录和下一期 H5 API 接口清单。不创建 H5 工程。

- [ ] **Step 1: 写组合用例并记录实际结果。** 临时管理员→两类学员→课程视频→题库资料解析→AI待审→人工审核→手动/文件补题→双难度发布→两人开考→草稿重启恢复→一人主动一人超时→三类题自动评分→考试记录→统计/导出。使用 `assert.equal(finalScore, expectedScore)`、`assert.deepEqual(exportedRows, reportRows)` 和在考敏感字段递归断言；尚未串通时记录首个业务断言失败并修复，不得删掉失败场景让它变绿；各增量已集成而直接通过时如实记录，不人为制造失败。
- [ ] **Step 2: 运行比例合适的自动验证。** `cd server && npm run build && npm test`；`cd web && npx vue-tsc --noEmit && npm run build`；`node --test tests/test-target.test.mjs`；隔离运行 `node tests/run-e2e.mjs --ephemeral --suite all`（包含 smoke 及 training-full-flow；每个 suite 独立实例与随机凭据）。`DB_DATABASE=ruleexam_test_training node --test tests/migration-contract.test.mjs` 验全新初始化/旧结构升级一致；均须实际通过，日志无凭据。不运行生产升级。
- [ ] **Step 3: 完成 PC 操作验收与升级预检演练。** 覆盖五根菜单、权限按钮/对应 API、失败/取消/恢复路径、两名学员的记录与结果；旧固定卷学习到考试完整走通。升级演练有旧数据保留、进行中阻断、取消能力历史数据 preflight、失败续跑和备份恢复说明；执行只在独立测试库。H5 体验、真实 AI 提供商、部署大文件上限未经运行的部分明确列待验证，不能被构建结果替代。
- [ ] **Step 4: 独立审查并解决阻断问题。** 按 astra reviewer 当前作用域配置派发可复核候选 diff、设计/计划及测试证据；重点审事务与权限、快照所有读取入口、空值/统计口径、文件归属和升级安全。根逐项裁决并只补跑受影响验证；必要检查通过即停止扩大范围。
- [ ] **Step 5: 更新交付证据并本地提交。** 清单逐项记实际执行命令、结果、PC证据位置和未覆盖范围；只有实际完成项打勾。核对 git diff 无其他任务改动被覆盖后 `git commit -m "test: verify training admin end-to-end acceptance"`；不 push、不生产部署。最后报告 PC/后端完成程度与下一期 H5 仍未实施。
