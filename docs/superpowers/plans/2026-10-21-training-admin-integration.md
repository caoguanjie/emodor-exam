# 培训机构后台融合升级 Implementation Plan

> **状态（2026-10-22）**：原 A1—C7 实施轨迹保留作依赖与历史说明；现行范围以已批准的培训演示瘦身计划为准，执行不采用 SDD。本文已移除被取消能力的现行交付与验收占位，旧 migration 文件仍保持不可变。

**Goal:** 在现有 EmodorRuleExam 上交付可验收的 PC 培训机构后台与完整业务后端，保留题库资料、AI、固定卷、自动评分、考试记录及统计链路。

**Architecture:** 保留 Vue 与 NestJS 单体架构；新增培训业务对象，不另造旧系统。发布快照固定候选题，个人题单统一驱动答题、判分、历史与报表；课程学习与原制度阅读分开。分成三个子计划，按依赖交付可独立测试的增量。

**Tech Stack:** 现有 Vue 3 / TypeScript / Vite / Element Plus、NestJS / TypeORM、MySQL 8.0 / Redis、Vitest / Node 测试脚本；Node ≥22。视频探测采用系统 `ffprobe`，不建设转码平台。

**Spec:** [已批准设计](../specs/2026-10-21-training-admin-integration-design.md)，包括用户于 2026-10-21 明确批准的 §1.2。

## Global Constraints

- 本期是 PC 管理端与完整后端；独立 H5、旧站数据迁移、生产部署与外部发布不属于本期交付。
- 不重建开发库、不清空现有记录；保留工作区正在进行的项目改名和旧需求文档重命名。
- 本机构 `institution` 抽初级，外来 `external` 抽高级；每人独立抽题，不保证不同考生绝无重复题。
- 100 分制，默认及格线 60、时长 30 分钟、最多作答 3 次（含首次）、多选漏选比例 0.5。
- 新培训考试默认无学习门槛；原制度固定卷保留原门槛。一个学员一个类别；来源不等于权限。
- 新发布冻结规则与候选版本，新开考冻结个人题单；补考沿用本场首次来源、难度和规则。
- 题型严格为 single/multiple/judgment；题干、选项和解析可以包含受控题图，但学员答案不上传图片。
- 视频心跳 30 秒，单次计时最多 45 秒，位置容差 2 秒，完成覆盖率 95%；零必学课时不自动完成。
- 保持 `/api/v1`、`{code,message,data}`、`DtoValidationPipe`、无数据库外键、服务端计时判分、在考不下发答案解析、HttpOnly refresh Cookie、SSRF 白名单。
- 最终总分不可直接修改；主动/超时交卷由服务端对三类客观题自动评分并汇总。考试 heartbeat 不采集切屏、设备或连接状态。敏感值只经运行期环境变量注入。

## Review Focus

1. 测试配置遗漏或 SQL 内硬编码库名：必须在执行任何 DDL 前拒绝非测试库，并确保初始化、种子、应用连接同库（A1）。
2. 权限撤销、账号来源变更或偷换附件 ID：立即拒绝越权，历史考试归属不被当前资料覆盖（A3、A4、C2、C3）。
3. 同考点变体虚增题量、发布后改题：按可抽考点数验池，全部后续读取冻结版本（B3、C1、C2）。
4. 开考重试、保存响应丢失、主动与超时交卷竞态：一次创建/一次自动结算，确认草稿可重启恢复（C2—C4）。
5. 重复补考、人员调类别导致分母变化：同场同难度 finalized 个人最高分，参考率分子取当前集合交集，导出一致（C6）。

---

## 1. 子计划与执行顺序

| 子计划 | 任务 | 可验收交付 |
|---|---|---|
| [A：基础与后台治理](2026-10-21-training-admin-foundation.md) | A1—A5 | 安全测试入口、类别/学员、权限登录、媒体、系统配置与 PC 公共框架 |
| [B：课程与题库内容](2026-10-21-training-admin-content.md) | B1—B4 | 视频课程及学习 API；制度 AI、人工录题与导入进入统一题库 |
| [C：考试闭环与统计](2026-10-21-training-admin-exams.md) | C1—C7 | 固定/随机发布、个人题单、答题交卷、自动结果/历史、考试记录、报表排名及全链验收 |

```text
A1 -> (A2 || A3) -> A4
A4 -> (A5 || B1课程主体 || B3)
A5 + B1课程主体 -> B1验收 -> B2
B3 -> B4
B1 + B3 -> C1 -> C2 -> C3 -> (C4结果历史 || C5考试记录)
B2 + C4 -> C6
全部增量（包含C5记录）+ 旧链路回归 -> C7
```

A4 需同时等待 A2 类别/学员契约与 A3 鉴权契约；B3 的富文本资源接入等待 A4。A4 完成后 A5、B1 课程主体、B3 题库可并行施工，但 B1 最终验收须等待 A5 公开配置就绪。B1/B3 过门后 B2、B4、C1 可并行；C1→C2→C3 必须严格串行。C3 后 C4 统一结果/历史与 C5 考试记录可并行；C6 的计算仅依赖 B2 与 finalized 结果。C7 汇合全部保留任务，不能把已取消能力作为缺口重新实施。

2026-10-21 执行补充：用户明确将 A4 剩余手动文件选择验证暂缓，要求“稍后处理，先继续代码”。因此 A4 代码、真实接口回归与独立审查通过后可放行 A5/B1/B3 的代码实施；伪格式/超限/头像 PC 补验保留为 C7 最终门槛，不以自动化替代、不宣称完整 PC 已验收。实际证据见 `review/2026-10-21-training-a4-media-acceptance.md`。

### 1.1 Astra 并发调度与执行约束

当前运行时共 4 个槽位（含 root），最多同时运行 3 个子任务；每次新派发、复用或后续派发前，root 必须重新核对实际活动槽位，并计入所有层级的活动后代，不按累计创建数或历史完成条目估算。常态调度为“2 个实施 + 1 个独立审查”；当独立就绪实施任务超过 2 个且没有待占用的审查门时，可暂时使用 3 个实施槽，任一实施完成后优先把空槽交给独立 reviewer。reviewer 不得复用被审查实施者冒充独立性；依赖任务须等前置任务的实现验证与审查门通过。下表是并发窗口，不是要求整批等待的屏障：只要自己的前置已通过且有空槽即可启动，不等待无关任务；B2/B4 的尾段也可与 C2/C3 交错推进。

| 调度批次 | 可运行任务 | 放行与汇合规则 |
|---|---|---|
| 0 | A1 | A1 必须先行；完成实现验证并通过独立审查后，才开放 A2/A3。 |
| 1 | A2、A3 | A2 与 A3 可并行；两者都过门后才能派发 A4。 |
| 2 | A4 | A4 同时依赖 A2、A3；完成并过门后开放 A5、B1 课程主体、B3 题库。 |
| 3 | A5、B1 课程主体、B3 题库 | 三者可并行；B1 的施工可先开始，但最终验收必须等待 A5 公开配置；B3 过门后才能进入 B4/C1 的下游门。 |
| 4 | B2、B4、C1 | B2 等 B1，B4 等 B3，C1 等 B1+B3；分别满足前置后立即放行，不互相等待。C1 不等待 B2 视频协议。 |
| 5 | C2 → C3 | C1、C2、C3 严格顺序，不能并行开考、答题交卷链路。 |
| 6 | C4、C5 | C3 过门后并行；C4 负责统一自动结果/历史，C5 负责只读考试记录。 |
| 7 | C6 | B2 与 finalized 结果都过门即可计算报表；C5 不是 C6 前置。 |
| 8 | C7 | 汇合全部保留增量、旧链路回归及 C5 记录交付后做综合验收。 |

根单写共同文件并负责集成：除 `app.module.ts`、路由、配置、DDL、种子、共享实体（如 `sys_user`）和设计分册外，显式包含 `server/src/modules/users/users.controller.ts`、`web/src/views/admin/Users.vue`、`web/src/views/admin/Questions.vue`、`server/src/tasks.service.ts`、`server/src/modules/imports/import-batch.service.ts`。任何任务若需要写入同一文件，必须先向 root 申请并获得文件所有权；未获所有权只能提交精确改动建议，不能并发覆盖。独立实施 worktree 必须从 root 已集成的前置版本创建，不得擅自搬移、stash、重置或覆盖当前脏改。

默认验收采用 root 管理的单一串行队列：集成构建 → 独立测试库 DB e2e → GUI/PC 操作验收；不让多个 lane 同时复用同一测试资源。确需并行验收时，每个 lane 必须有独立测试 DB/API 进程、Mock AI 端口、Redis 前缀、上传临时目录和浏览器会话，不能照抄同一个 `ruleexam_test_training` 同时运行。模型条款沿用本计划既有规定；模型可用性由 root 在实际调用/派发时核验，不以配置文件臆测或静默替换。本节只细化调度，不新增或删除 A1—A5、B1—B4、C1—C7 共 16 项任务，不改变业务 scope、H5 排除或已批准默认规则。

2026-10-21 本轮已成功通过实际接口创建并完成 `codex-auto-review / max` 的 `parallel_schedule_worker` 文档任务；两名 `gpt-5.6-sol / max` reviewer 已并发完成依赖与资源冲突审查。后续按 astra 原角色模型配置派发，不启用此前因模型列表判断而讨论的继承回退；实际调用若失败，再说明错误并处置。这里的成功只证明本轮委派和计划更新，不代表业务实施或应用测试通过。

沿用 astra-workflow，由根负责契约、集成与裁决，独立任务按文件归属并行；模型以执行时可用角色配置为准，不静默替换。根统一合并 `app.module.ts`、路由、配置、DDL、种子、共享实体（如 sys_user）与设计分册，其他执行者提供精确改动，不并发覆盖这些共享文件。每个任务独立测试/审查，再进入依赖它的任务。

## 2. 文件与职责布局

现有入口已通过代码图及源文件核对；以下 `Create` 路径是目标，不代表当前已有实现。延续现有 `app.module.ts` 集中注册方式，不为本次改造先重组所有 Nest 模块。

| 所属 | 现有复用入口 | 新职责边界 |
|---|---|---|
| A | `users/`、`auth/`、`common/guards/`、`common/audit.service.ts` | `training/` 类别；`access/` 权限；`media/` 文件；`system/` 配置；`imports/` 导入批次 |
| B | `regulations/`、`ai/question-generation.service.ts`、`ai/question-review.service.ts` | `courses/` 课程；`video-learning/` 视频协议；`questions/` 版本与导入 |
| C | `ai/paper.service.ts`、`exams/`、`statistics/` | 发布快照、抽样、开考、草稿、自动终结、统一历史、纯考试记录及培训统计各用独立服务 |
| PC | `web/src/views/admin/`、`router/index.ts`、`layouts/MainLayout.vue` | 扩展原页面；增加课程、类别、考试记录、培训统计和权限配置页面；不创建独立 H5 工程 |

### 2.1 跨任务契约（A1 定义，后续只作兼容增补）

定义于 `server/src/common/training-contracts.ts`；HTTP 新接口字段沿用仓库 snake_case，服务内部使用 camelCase。前端镜像类型在 `web/src/api/training-types.ts`，由契约测试核对请求响应，不引入新的全栈框架。

```ts
type Id = string; // bigint 标识不经 Number 转换；旧 AuthUser.id 在入口适配为字符串
type LearnerSource = 'institution' | 'external';
type Difficulty = 'easy' | 'medium' | 'hard'; // 初/中/高
type ExamDifficulty = Difficulty | 'mixed' | 'unknown'; // 固定混档/遗留未知，仅用于考试统计
type QuestionType = 'single' | 'multiple' | 'judgment';
type Page<T> = { items: T[]; total: number; page: number; page_size: number };
type PoolRule = { type: QuestionType; count: number; scoreCents: number };
type RuleSnapshot = { totalCents: 10000; passCents: number; durationMinutes: number;
  maxAttempts: number; partialCreditRatio: number; rules: PoolRule[] };
type AnswerInput = { item_id: Id; selected?: number[] };
type DraftInput = { revision: number; answers: AnswerInput[] }; // 全量草稿，遗漏项清空
type DraftAck = { revision: number; saved_at: string; answered_count: number };
type GradeState = 'not_submitted' | 'finalized';
type SubmissionMethod = 'manual' | 'timeout';
type ImportPreview = { batch_id: Id; valid_rows: number[];
  errors: { row: number; message: string }[]; duplicates: number[] };
type ImportResult = { batch_id: Id; created_ids: Id[]; committed_rows: number[] };
```

分值运算用整数分（100 分 = 10000），落库仍与现有 DECIMAL(5,2) 对齐；比例计算四舍五入到分。判断题保存固定“正确/错误”两项及 0/1 下标，不打乱这两个语义标签。未知题型拒绝。新接口分页默认 20、范围 1—100；不改变保留的原接口返回结构。

`AttemptView` 必有 `record_id/paper_id/release_id/source/category_id/difficulty/deadline_at/server_now/draft_revision/questions/answers`；各 ID 为 Id，旧来源/类别/release 可 null，difficulty 为 ExamDifficulty，时间 ISO 字符串，revision 整数，answers 为 AnswerInput[]；每题仅 `item_id/type/stem/options/score`，分别为 Id/QuestionType/string/QuestionOption[]/number。题库 ID 不作为新答题主键；禁止通过实体展开序列化答案。`FinalResult` 必有 `record_id/grading_state/submission_method/submitted_at/graded_at/score/passed/correct_rate/items`；未提交时无最终分，提交后直接 `finalized`。items 为冻结题内容、本人答案与自动 `gained_score`，标准答案/解析仅交卷后可读；不含 grading_revision、comment 或人工评分版本。详细 DTO 和错误码由所属任务同步 04 册，不能在多个服务各造同名异义字段。

### 2.2 表、升级脚本与约束归属

所有新增实体均为 `server/src/entities/<表名以连字符替换下划线>.entity.ts`。ID 用 BIGINT UNSIGNED，时间 DATETIME(3)，枚举 VARCHAR(32)，名称默认 VARCHAR(128)，标题 VARCHAR(255)，摘要/题干/评语 TEXT，规则/快照 JSON；不用外键。每个脚本同时更新 03 册、`database/init.sql` 和实体。表字段的完整 DDL 属于对应任务，以下锁定跨任务主键与关系，不让执行者各自另建同义表。

| 脚本（`database/migrations/`） | 新增表 / 修改表 | 关键约束 |
|---|---|---|
| `000_migration_registry.sql` A1 | `schema_migration` | migration_id 主键、checksum、applying/applied/failed 状态、progress JSON 记录已验证步骤；失败不可误记完成 |
| `001_training_identity.sql` A2 | `training_category`、`import_batch`；`sys_user` | 类别名唯一；category_id/source 可空仅为旧用户兼容；批次含 owner/kind/hash/status/result |
| `002_access.sql` A3 | `sys_role`、`sys_permission`、`sys_role_permission`、`sys_user_role`、`auth_session` | 权限 code 唯一；两张关联表复合唯一；sid 唯一；最高管理员保护 |
| `003_media.sql` A4 | `media_asset`、`media_reference` | 服务端 storage_key 唯一；引用 owner_type/owner_id/asset_id 唯一 |
| `004_system.sql` A5 | `sys_menu`、`sys_dictionary`、`site_setting` | 菜单 parent 防环由应用校验；字典 type+code 唯一；setting key 唯一 |
| `005_courses.sql` B1 | `training_course`、`course_chapter`、`course_lesson`、`lesson_version`；`regulation` | lesson+version_no 唯一；课时 current_version_id；制度可选 category_id；课程 JSON regulation_ids |
| `006_video_learning.sql` B2 | `video_learning_record`、`video_learning_session` | record(user_id,lesson_version_id) 唯一；活动会话约束见 B2 |
| `007_question_bank.sql` B3 | `question_concept`、`question_version`；`question` | (question_id,revision) 唯一；question.current_version_id；制度来源可空，保留旧行 |
| `008_paper_release.sql` C1 | `paper_release`、`paper_release_question`；`exam_paper`、`paper_question` | release(paper_id,version_no) 唯一；release/question_version 唯一；新业务 scope 明确 |
| `009_attempt_snapshot.sql` C2 | `exam_assignment`、`exam_record_question`；`exam_record` | assignment(paper_id,user_id) 唯一；record(assignment_id,attempt_no) 唯一并保留原(paper_id,user_id,attempt_no) 唯一；active_assignment_id 可空唯一；题单(record_id,position) 唯一 |
| `010_answers.sql` C3 | 修改 `exam_answer`、`exam_record` | answer(record_id,record_question_id) 唯一；draft_revision、heartbeat、提交与自动判分状态 |
| `011_manual_grading.sql`（历史、不可改） | 曾增加 `exam_review_event` 及人工评分字段 | 仅保留 migration checksum；现行应用不注册、不读写，015 在只读历史数据 preflight 通过后删除其专用结构 |
| `012_course_navigation.sql` B1 final | `sys_menu` 数据 | 在不改写已登记 `004/005` checksum 的前提下幂等注册 `/admin/courses`；保留已有合法名称、排序、图标与启停配置，不重复菜单 |
| `015_demo_slimming.sql` | 删除取消能力的菜单/权限/表/列并收缩枚举 | 历史数据 preflight；有限单表 DELETE/DROP；`@replaces-check` 让旧探针以终态不变量判定；36 张业务表 + 1 张元数据表 |

不伪造旧快照：旧结束记录 `snapshot_origin=legacy_unavailable`；旧发布卷的新开考为 `legacy_start`；新发布/开考为 `release`。已有类别/来源/难度未知保持 null，不创建“默认初级”回填。旧引用题编辑前存一份升级时当前版本并注明捕获时间，不称之为历史考试时的原版本。

升级执行器 `database/migrate.mjs` 支持 `--check` 和 `--apply`，显式要求 `DB_DATABASE`；发现进行中答卷或校验和不符立即停止。MySQL DDL 不能依赖整段事务回滚：逐步查元数据、保存进度、重复执行安全、失败可续跑；只备份/恢复经过审阅的目标库，不提供默认破坏性 down 脚本。生产执行需另行授权。

**A1 实施审查后的升级脚本约定：** 每份 SQL 用稳定的 `-- @step <id>` 划分步骤，每步附 `-- @check <single SELECT ... AS complete>` 只读完成探针和一条执行语句。探针先核查所需结构/数据是否完成，未完成才执行，之后再次验证才记录 `schema_migration.progress`；不能仅凭表存在就假定字段结构正确。若后继步骤合法扩展了前一步骤保护的同一结构，可在后继 `@step` 下声明唯一的 `-- @replaces-check <较早 migration>/<step>`；定义集必须包含目标且关系只能按迁移顺序形成单链，拒绝同级、反向、循环或分叉。该声明不代表完成：只有后继完整探针真实返回 1 才能替代旧探针；后继 progress 已确认时，探针失败即按结构退化拒绝且不得回退旧探针，未确认时探针为 0 才继续检查旧探针，SQL 错误直接上抛；后继仍由自己的正常流程记录 progress。扩列后继的完整探针须承接旧命名字段和每个受保护索引的精确不变量，同时允许无冲突的后续新增列或索引，不以全表总数代替结构证明。拒绝无探针、任意多语句、切换数据库等不符合约定的脚本，不建设通用 SQL 引擎。`--apply` 在任何注册表/业务写入前取得同库命名锁，再读校验和与真实 `exam_record.status='in_progress'`；只有锁持有者可以基于元数据接续 failed 或崩溃遗留 applying。`--check` 不写注册表。命名锁只协调升级进程，不阻止仍在运行的业务服务新开考，所以正式升级必须另行授权并在停服维护窗口执行。新初始化、升级、实体及 03 册保持一致；所有后续 migration 必须遵循 A1 验收后的实际解析接口。

## 3. 测试、提交和完成规则

- A1 建立 `tests/support/training-harness.mjs`：`request(actor, method, path, body?) -> Promise<{status,code,data}>`、`upload(actor,path,bytes,filename)`、`restartApi()`、`queryTestDb(sql,params)`；actor 为临时生成账号会话，密钥不落盘。每个 suite 导出 `run(ctx)`，自己的夹具创建放在本 suite，不引用未定义的“通用业务夹具”。
- 每个任务先写指定断言，看到行为失败，再实施并通过。子计划的代码块是必须保留的关键断言，不是完整测试源码；夹具、依赖注入和 setup 由该任务测试文件定义。
- 集成命令统一 `DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite <name>`；**只有 A1 验证隔离后才能运行**。DB 密码由用户现有安全环境注入；未提供时记为待验证，不读取凭据文件。新 suite 参数、测试建库及临时目录由 A1 实现。
- 各 UI 任务均执行 `cd web && npx vue-tsc --noEmit && npm run build`，并做指定 PC 浏览器用例。API 用例通过不替代页面验收。
- 每个任务结束列出本任务文件，用 `git add <逐个明确路径>` 后核对 `git diff --cached`，再独立本地提交；**本轮计划编写不执行这些提交命令**。与用户已有修改重叠时只提交自己的块，不能整文件吞入其他改动；无法分离时交主线程处理。禁止 `git add .`、自动 push。
- 执行开始按 using-git-worktrees 检查隔离方案；不能把当前未提交的改名/需求文件当作不存在。先确认实际集成基线，不擅自 stash、重置、搬移用户改动。

## 4. 设计覆盖与最终交付门槛

| 设计段落 | 负责任务 |
|---|---|
| §1—3 边界、保留链路、红线修订 | A1、C7 |
| §4 PC 公共框架、管理权限与配置 | A2—A5、C5—C6 |
| §5.1 学员；§5.2 课程；§5.3 视频协议 | A2、B1、B2 |
| §6 制度/AI/题库/导入 | B3、B4 |
| §7 发布、候选池、随机、历史兼容 | C1、C2 |
| §8.1 答题交卷；§8.2 自动评分；§8.3 考试记录 | C3、C4、C5 |
| §9 旧统计保留、新口径、导出排名 | C6 |
| §10 全部管理与学员 API、文件配置 | A3—A5、B1—B4、C1—C6 |
| §11—12 验收、文档、H5 排除 | C7；各任务持续同步文档 |

最终同时满足：旧制度内容/学习/固定卷/统计共享链路回归；本机构与外来学员的随机卷真实 API 闭环；三类客观题自动评分与考试记录读取；课程学习协议与统计口径断言；现行管理页面可操作；升级演练与初始化一致；后端构建/单测、前端类型/构建、独立测试库 e2e 通过；独立审查无未处理的关键问题。报告分开列“自动化通过”“PC 人工验收”“尚未验证”，不宣称 H5 已交付。
