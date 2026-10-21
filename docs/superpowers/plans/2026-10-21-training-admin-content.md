# 课程学习与统一题库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付视频课程后台与学员学习 API，并保留和扩展制度 AI、人工录题、Excel/TXT 导题进入统一题库的链路。

**Architecture:** 课程/视频学习独立于制度阅读，题目版本独立于制度版本。B1/B2 与 B3/B4 可在 A 阶段契约就绪后并行，不互相借用数据库字段表达不同事实。

**Tech Stack:** 沿用 NestJS / TypeORM / MySQL、Redis、Vue 3 / Element Plus、ExcelJS、sanitize-html、现有 PDF/DOCX 与多模态 AI 服务。

**Spec:** [已批准设计](../specs/2026-10-21-training-admin-integration-design.md) §5—6；遵守[总计划](2026-10-21-training-admin-integration.md)的类型、表归属和执行规则。

## Global Constraints

- 总计划 Global Constraints 全部适用；课程、题库、制度可关联但不混为同一个对象。
- 视频心跳 30 秒，单次最多计 45 秒，位置容差 2 秒，完成覆盖 95%，零必学课时不自动完成。
- 题目难度 `easy/medium/hard`；题型 `single/multiple/judgment/image`；类别必填、考点组可选。
- AI 本期仍生成单选/多选；人工/导入题可无制度来源，AI 必须保存真实来源版本。
- 每个任务修改 schema 时执行总计划的 DDL/升级/实体/设计同步；新 H5 页面不在范围。

## Review Focus

1. 发布空视频、替换课时媒体、下架后学习：校验可用性并保留原版本与进度（B1）。
2. 重放/乱序心跳、跳播、反复观看一段、两个会话抢占：不能重复计时或虚增覆盖（B2）。
3. 学员改类别或来源、课程零必学：应学集合即时变化但不删除历史，不出现虚假完成率（B2）。
4. 未复核改题覆盖已审核版本、富文本脚本/不受控图片：版本隔离、清洗和资源授权（B3）。
5. 混合合法/错误/重复导入行、重复提交：模板与解析一致，可修正重导且不重复入库（B4）。

---

### Task B1: 课程、章节和视频课时管理

**Dependencies:** 课程主体依赖 A2/A3/A4，可与 A5、B3 并行；`/me/home` 组合接口及 B1 最终验收等待 A5 的公开配置接口。B1/B3 对 `RegulationDetail.vue` 的修改交根统一集成，各自 worker 不并发改该文件。B2/B4/C1 只有在各自前置任务集成并验证后才进入下一并发组。

**Files:** Create `server/src/modules/courses/course.service.ts`、`course.controller.ts`、`lesson-version.service.ts`、`course.dto.ts`、`web/src/views/admin/Courses.vue`、`CourseDetail.vue`（同页面目录）；`005_courses.sql` 与总计划对应实体。Modify `server/src/entities/regulation.entity.ts`、`server/src/modules/regulations/regulation.service.ts`、`regulations.controller.ts`（同目录）、`web/src/views/admin/RegulationDetail.vue`；Test `server/test/course-lifecycle.spec.ts`、`tests/training-courses.mjs`。

**Interfaces:** Consumes A2 类别/学员资料、A3 权限、A4 MediaService。Produces `CourseService.visibleCourses(userId:Id,page:number,pageSize:number):Promise<Page<CourseSummary>>`、`assignedCourseIds(userId:Id):Promise<Id[]>`、`LessonVersionService.current(lessonId:Id):Promise<{versionId:Id;assetId:Id;durationMs:number}>`；`CourseSummary={id:Id;title:string;category_id:Id;cover_asset_id:Id|null;status:'draft'|'published'|'offline';required_lesson_count:number}`。管理 `/admin/courses/:id/chapters|lessons`，学员 `/me/courses`、`/me/courses/:id`、`/me/home`。

- [ ] **Step 1: 写课程生命周期测试。** suite `training-courses` 创建一个类别、机构/外来学员、两段可用媒体与一个处理失败媒体；覆盖课程分页、推荐与目录权限。
  ```js
  assert.equal(publishWithoutRequiredVideo.status, 409);
  assert.equal(publishWithReadyVideo.status, 200);
  assert.notEqual(replaceVideo.data.version_id, oldVersionId);
  assert.equal(deleteReferencedVideo.status, 409);
  assert.equal(externalCourses.data.total, 0);
  assert.equal(otherCategoryCourse.status, 403);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/course-lifecycle.spec.ts`，预期课程服务缺失/发布校验失败。
- [ ] **Step 3: 实现课程结构与版本。** 草稿/上架/下架，类别/封面/简介/推荐/排序，章节与课时有独立顺序；`lesson_type=video`，未知类型返回 400。必学视频就绪才能上架；下架不删记录，重新上架需重查资源。已发布课时换视频追加 lesson_version；旧版本不可原地改媒体/时长。course.regulation_ids 是可选信息关联，制度可选 category_id，均验证引用存在，不能影响抽题池计算或成为学习门槛。
- [ ] **Step 4: 实现 PC 编辑与学员读取。** 课程列表/编辑/章节排序/视频上传使用 A4；发布前展示缺失资源。学员读取只返回本类别已上架课程，外来默认无应学课程；首页推荐取同一可见集合和 A5 公开配置，不泄露管理员设置。原制度阅读页不转换成视频课时；发布/撤回有确认和审计。
- [ ] **Step 5: 绿灯。** 同单测；`DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-courses`；前端类型/构建。PC 实操创建课程→章节→视频探测→上架→替换视频→下架；读取目录、推荐分页与权限用真实 API 验证，移动播放不记通过。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: manage versioned training courses and video lessons"`。

### Task B2: 可恢复的视频学习协议与课程进度

**Files:** Create `server/src/modules/video-learning/video-session.service.ts`、`coverage.ts`、`video-learning.controller.ts`、`video-learning.dto.ts`；`006_video_learning.sql` 与实体；Test `server/test/video-coverage.spec.ts`、`tests/training-video-learning.mjs`。Modify `server/src/tasks.service.ts`、`server/src/modules/learning/learning-session.service.ts`（只处理跨类型活动会话协调）、`server/src/modules/courses/course.service.ts`。

**Interfaces:** Consumes A2 trainingProfile、B1 current/assignedCourseIds。Produces `VideoSessionService.start(userId:Id,lessonId:Id):Promise<VideoSessionView>`、`heartbeat(userId:Id,sessionId:Id,input:VideoHeartbeat):Promise<VideoProgress>`、`close(userId:Id,sessionId:Id):Promise<VideoProgress>`、`progress(userId:Id,courseId:Id):Promise<CourseProgress>`。`VideoHeartbeat={seq:number;position_ms:number;state:'playing'|'paused'|'buffering'|'background'|'ended'}`；`VideoProgress={confirmed_position_ms,credited_ms,coverage_ms,duration_ms,completed,last_seq}`；`VideoSessionView={session_id,version_id,heartbeat_interval_ms:30000,progress:VideoProgress}`；`CourseProgress={required,completed,completion_rate:number|null,lessons:VideoProgress[]}`。

- [ ] **Step 1: 写时钟可控的覆盖算法测试和 API 竞态测试。** 在 `coverage.ts` 定义 `PlaybackAnchor={seq:number;positionMs:number;state:VideoHeartbeat['state']}`、`VideoCredit={nextAnchor:PlaybackAnchor;creditedMs:number;interval:[number,number]|null}`；函数为 `creditVideoInterval(previous:PlaybackAnchor,input:VideoHeartbeat,elapsedMs:number,durationMs:number):VideoCredit` 和 `mergeCoverage(intervals:[number,number][],next:[number,number]|null):{intervals:[number,number][];coverageMs:number}`。夹具 duration=100000ms，测试将返回区间合并到学习记录后核对完成状态，不能仅核对累计时间。
  ```ts
  expect(replayed.creditedMs).toBe(0);
  expect(background.creditedMs).toBe(0);
  expect(longHeartbeat.creditedMs).toBeLessThanOrEqual(45000);
  expect(jumped.coverageMs).toBe(previousCoverageMs);
  expect(repeatedSegment.completed).toBe(false);
  expect(at95000.coverageMs / 100000).toBe(0.95);
  expect(at95000.completed).toBe(true);
  expect(zeroRequired.completion_rate).toBeNull();
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/video-coverage.spec.ts`；预期算法/服务不存在，或重复片段错误判完成。
- [ ] **Step 3: 实现状态结算与持久化。** `/me/video-sessions` POST、`/:id/heartbeat` POST、`/:id/close` POST、`/me/courses/:id/progress` GET。服务端时钟和数据库事务序号决定计时，重放返回当前进度；位置跃迁超真实间隔+2秒不确认跳过片段，只回已确认断点。有效时长按 interval、45秒和真实前进量限额，观看覆盖合并去重，重复观看可累计有效时长但不能增加已覆盖区间。暂停/后台/缓冲不计；重启后从数据库恢复，不用客户端累计值。
- [ ] **Step 4: 实现单活动、版本和应学范围。** start 锁 sys_user 行后关闭旧视频/阅读活动会话，再创建；新表用可空 active_user_id 唯一索引兜底，关闭置空。不可把同一用户同时两路时长累计。课时版本变更只更新新版本要求；下架后拒绝新会话并终止后续计时、保留确认进度。来源/类别变化更新当前应学集合，既有记录可查；课程按已完成必学数/必学总数，零总数 null。定时回收过期会话不伪造观看时间。
- [ ] **Step 5: 绿灯。** 同单测及 `DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-video-learning`。API 测试两个会话同时开始、重复/乱序/跳播、进程重启、下架与版本替换、外来应学分母排除；原制度阅读算法测试继续通过。不宣称全屏、锁屏、微信或手机弱网体验已验收。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: persist verified video learning progress"`。

### Task B3: 有版本的四题型题库与 AI 审核链路

**Files:** Modify `server/src/entities/question.entity.ts`、`server/src/modules/ai/question-generation.service.ts`、`question-review.service.ts`、`ai.controller.ts`（同目录）、`web/src/views/admin/Questions.vue`、`RegulationDetail.vue`（同页面目录）；Create `server/src/modules/questions/question-version.service.ts`、`question-concept.service.ts`、`question-validator.ts`、`question.dto.ts`、`web/src/components/QuestionEditor.vue`、`QuestionPreview.vue`（同组件目录）；`007_question_bank.sql` 与实体；Test `server/test/question-bank.spec.ts`、`tests/training-question-bank.mjs`。

**Interfaces:** Consumes A2 类别、A3 权限、A4 媒体、现有生成任务。Produces `QuestionVersionService.create(input:QuestionDraft,actorId:Id):Promise<{questionId:Id;versionId:Id}>`、`revise(questionId:Id,input:QuestionDraft,actorId:Id):Promise<Id>`、`approve(versionId:Id,actorId:Id):Promise<void>`、`approvedCandidates(filter:CandidateFilter):Promise<QuestionVersionSnapshot[]>`。`CandidateFilter={categoryId:Id;regulationIds?:Id[];type:QuestionType;difficulty:Difficulty}`；`QuestionDraft={categoryId:Id;difficulty:Difficulty;type:QuestionType;stem:string;options:QuestionOption[];answer:number[];analysis:string|null;rubric:string|null;scoreCents:number;conceptId?:Id;regulationId?:Id;regulationVersionId?:Id;source:'ai'|'manual'|'import'}`，QuestionOption 沿用现有 `{key:string;text:string}`。`QuestionVersionSnapshot=Readonly<QuestionDraft & {questionId:Id;versionId:Id;revision:number;approvedBy:Id|null;approvedAt:string|null}>`，旧审核轨迹缺失可空但不伪造，新确认必须记录实际管理员与时间；图片题 answer/options 为空数组、rubric 必填，其余题 rubric 为 null。

- [ ] **Step 1: 写题型、版本、来源与清洗测试。** suite `training-question-bank` 定义制度、类别、四题型和同考点夹具；旧题编辑先保存升级时版本。
  ```js
  assert.equal(manualWithoutRegulation.status, 200);
  assert.equal(aiWithoutSourceVersion.status, 400);
  assert.equal(unknownType.status, 400);
  assert.equal(crossCategoryConcept.status, 400);
  assert.equal(newRevision.data.status, 'pending');
  assert.equal(oldVersion.data.stem, originalStem);
  assert.equal(sanitized.data.stem.includes('<script'), false);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/question-bank.spec.ts`，预期新题型/版本服务缺失。
- [ ] **Step 3: 实现版本与校验。** 保留 question 身份和现有兼容字段，内容变更生成版本；核心编辑待复核，不影响已发布引用。单选一个答案，多选至少两个，判断固定正误两项，图片明确 rubric 评分参考且无客观答案；旧建议分值与考试分值分开。同考点必须同类别/题型，不要求三档齐全。富文本采用现有 sanitize-html 白名单和受控媒体引用，拒绝 script/事件/javascript URL/任意外链图片；图片引用写 media_reference 防误删。审核/重新生成/拒绝记录来源与操作者。
- [ ] **Step 4: 扩展 AI 与 PC。** 保留配置/连通测试/PDF/DOCX 解析/多模态/异步进度/失败重试，生成请求新增 category_id/difficulty，AI 输出仍单选/多选、合计100分的原批次交互；难度标签不能被模型输出悄悄改掉。生成、审核、手动编辑、概念组/难度筛选、预览贯通 Questions/RegulationDetail；旧题未知类别不自动入新培训池。旧接口返回兼容视图，业务规则只读统一版本服务。
- [ ] **Step 5: 绿灯。** 同单测与 `DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-question-bank`；`cd server && npm test -- test/pdf-vision.spec.ts`；前端类型/构建。PC 实操制度→解析→Mock AI→审核→改题待审与人工四题型预览。真实 AI 提供商未配置时只记 Mock 闭环，不伪称真实模型验收。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: version question bank and retain AI review workflow"`。

### Task B4: Excel/TXT 导题预览与批次确认

**Files:** Create `server/src/modules/questions/question-import.service.ts`、`question-import.controller.ts`、`question-import-format.ts`、`web/src/views/admin/QuestionImport.vue`、`docs/templates/question-import-format.md`；Modify `server/src/modules/imports/import-batch.service.ts`（仅注册 questions 适配器）、`web/src/views/admin/Questions.vue`；Test `server/test/question-import.spec.ts`、`tests/training-question-import.mjs`。

**Interfaces:** Consumes A2 ImportBatchService、B3 QuestionVersionService。Produces `QuestionImportService.preview(ownerId:Id,file:Buffer,format:'xlsx'|'txt',defaults:{categoryId?:Id;difficulty?:Difficulty}):Promise<ImportPreview>`；`GET /admin/questions/import-template?format=xlsx|txt`、`POST /admin/questions/import-preview`、`POST /admin/questions/import-batches/:id/commit {row_numbers:number[]}`。

- [ ] **Step 1: 写同模板回读、错误行和重试测试。** TXT 用 UTF-8 TSV（首行列名，单元格 JSON 表示 options/answer），与 Excel 同列 category/type/difficulty/concept/stem/options/answer/analysis/rubric/score；支持带 BOM/CRLF，禁止多义手工分隔语法。
  ```js
  assert.deepEqual(xlsxRows, txtRows);
  assert.deepEqual(preview.data.valid_rows, [2, 5]);
  assert.equal(preview.data.errors.some(x => x.row === 3), true);
  assert.deepEqual(preview.data.duplicates, [4]);
  assert.deepEqual(secondCommit.data.created_ids, firstCommit.data.created_ids);
  assert.equal(otherOwnerCommit.status, 403);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/question-import.spec.ts`，预期解析器/一致模板缺失。
- [ ] **Step 3: 实现模板、解析与提交适配器。** 复用 ExcelJS；整批大小/行数限制和行级 schema 校验，非法公式不执行。重复指纹覆盖类别/题型/难度/标准化内容/答案，已存在或批内重复单独列示，默认不导入；用户只能确认 valid_rows。图片题导入评分参考而非考生附件；人工/导入无制度合法，带来源则校验真实版本。确认事务创建 approved 版本与导入审计，同一批不能提交不同集合或重复入库。
- [ ] **Step 4: 接通 PC 导入流程。** 模板下载→上传→默认类别/难度→预览合法/错误/重复行→确认→返回题库；修正错误行重导新批次，网络响应未知先查批次状态，不自动重新创建。预览和提交都不绕过 B3 富文本/概念组校验。
- [ ] **Step 5: 绿灯。** 同单测和 `DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-question-import`；前端类型/构建。PC 分别导入 Excel/TXT，核对数量、三级难度、四题型、失败行修正与重复确认，题库可被 C1 查询。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: preview and confirm idempotent question imports"`。
