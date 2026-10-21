# Tiptap 题目设计器、考点与两档题池接续改造 Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use `$astra-workflow` to orchestrate and implement this plan. The user's latest instruction overrides the default `writing-plans` execution template: do not use SDD / `subagent-driven-development`, and do not fall back to `executing-plans` as a serial executor. This still requires real worker and independent reviewer subagents under Astra, with tester used when independent verification has value; it does not mean “no subagents”. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 Tiptap 模板编辑器接入培训改造，交付多题编排、考点/两档难度、模板及 AI 编辑、可靠保存、按身份抽题和冻结答卷回看。

**Architecture:** 组件源码迁入现有 Vue 工程，不搬整个 FitsAdmin。编辑文档统一承载多道题，服务器逐题校验并以同一事务保存版本；题库、抽题与回看继续使用原培训改造的服务。本计划是 A/B/C 原计划的增量，不另建题库、考试系统或 H5。

**Tech Stack:** Vue 3 / Element Plus / Tiptap 3.32.0、NestJS / TypeORM / MySQL 8 / Redis、现有 sanitize-html / htmlparser2、Vitest / jsdom / Vue Test Utils、原 A1 隔离测试启动器。

**Spec:** [题目编辑、考点关联与两档题池补充设计](../specs/2026-10-21-question-authoring-concepts-design.md)；兼容[原融合设计](../specs/2026-10-21-training-admin-integration-design.md)。依赖/API 选择依据为[升级调研](../../../review/2026-10-21-tiptap-template-upgrade-research.md)。执行者须同时读取三份文件。

## Global Constraints

- 本期只启用简单 `easy`、困难 `hard` 两档；`medium` 仅保留类型及历史读取位置，人工新建/修订、AI、导入、模板新写入与新发布均不接受中档。历史记录不删除、不重标。
- 本机构 `institution` 随机抽简单，外来 `external` 随机抽困难；来源由管理员维护，前端不能指定抽取身份。保留固定卷同卷同内容规则，不把固定卷偷偷改成随机卷。
- 一个考点可跨题型、跨难度；题目至多关联一个主考点，可空；必须同培训类别。同卷全局去重考点，无考点题按题目身份去重，不要求成对准备或三档齐全。
- 保留制度及真实出题依据版本；不新增教材/书籍管理、知识图谱、固定培训练习题库、独立 H5、实时协作、生产部署或旧站数据迁移。
- 左侧通用控件/模板/相关题目保留；中间多题编排且每题一种题型；右侧当前题考点、难度、答案摘要与解析。普通多行输入采用 plain/rich 模式，不强制显示三栏。
- 使用中的官方 `@tiptap/*` 统一精确锁定 `3.32.0`；不一起升级宿主 Vue/Element Plus/Vite/TypeScript 主版本。保留段落级行高 JSON；不直接替换成官方默认文本 mark 行高。
- `Id` 是 string，不经 Number 转换；HTTP snake_case、服务内部 camelCase；沿用 `/api/v1`、统一信封、DtoValidationPipe、权限守卫、审计、无数据库外键及受控媒体。
- 编辑内容、答案派生字段与媒体引用同版本同事务；历史发布与答卷不可被改题覆盖；回看覆盖层不写回编辑原稿。在考响应不能携带正确标记、答案、解析、rubric 或管理元信息。
- 不重建开发库；不改已执行迁移及其 checksum；不读取凭据文件；测试密码仅来自已有安全环境。不要把本地临时验证的 10 项通过当成应用验收。
- 本文件的执行编排已确认采用 `$astra-workflow`，但 Q1—Q13 业务实施尚未启动；本次只修订计划。写计划不等于授权实施、安装、迁移、提交或 push，开始实施仍需用户另行授权。

## Review Focus

1. 复制同一模板两次、选项改序、切换当前题：标识唯一，答案与元信息不串题，保存后富文本不丢失（Q3/Q4/Q8）。
2. 两个浏览器同时编辑、整批最后一题非法、保存响应丢失或重放不同内容：整批原子、版本冲突明确、查询结果后恢复，不重复创建（Q5）。
3. 正文+解析+预览同时存在，弹窗反复开关或进入只读：实例/监听器隔离，子控件和拖入不能修改 JSON（Q2/Q3）。
4. 两种题型争用同一个考点，或贪心先抽导致后续缺题：联合容量判断准确，有可行组合就能抽出，无组合不降级凑题（Q10）。
5. AI 伪造考点/来源、旧 HTML 含恶意或未知内容、随机选项映射后回看：服务端校验、无静默丢失、冻结显示正确、在考无泄漏（Q4/Q7/Q11/Q12）。

---

## 1. 与正在进行的原计划怎样交接

原计划：[总计划](2026-10-21-training-admin-integration.md)、[基础 A](2026-10-21-training-admin-foundation.md)、[内容 B](2026-10-21-training-admin-content.md)、[考试 C](2026-10-21-training-admin-exams.md)。本轮只新增本计划，不擅自重置旧任务状态；进入实施时由集成负责人执行 Q1，通知受影响任务 owner 并同步冲突规则。

2026-10-21 编写时，主副本为 `b90d1ad`，集成 worktree `/Users/caogj/.codex/worktrees/16b4/RuleExam` 已推进到 `49d7cd4`。这些是定位快照，不是执行时必须回退到的版本。执行前重新 `git worktree list --porcelain`、`git status --short`、`git log -5 --oneline`；使用已集成前置能力的当前分支，保留并发工作。

该快照已有 A1—A3 的契约、身份与权限实现，但没有 A4 媒体、A5 未保存守卫、B3 版本题库/考点和 C 阶段新考试服务。原有题库、AI、固定卷、员工成绩详情仍在运行；“已有任务计划”不能当作“已有可调用接口”。只读源码核查不替代这些任务的运行验收。

| 原任务 | 本计划怎么接，不重复做什么 |
|---|---|
| A1 | Q1 增补可写难度与文档契约；保留测试隔离、迁移器、Id/信封，不重做基础设施 |
| A2/A3/A4/A5 | 复用来源/类别、权限、媒体、未保存确认；未就绪接口只可在隔离组件测试中 stub，不能宣称联调完成 |
| B3 | Q4—Q8 扩展其版本服务/编辑入口/AI 审核；仍由原服务负责题目身份和审核，不另建第二条写入链 |
| B4 | Q9 接统一 codec 和两档校验；保留 Excel/TXT 预览、合法行确认与批次幂等 |
| C1 | Q10 替换独立题型计数/简单贪心为全卷联合可行性判断；保留发布冻结和规则默认值 |
| C2/C3 | Q11 扩展冻结文档与学员投影；保留开考事务、补考、草稿、截止、交卷和判分事实 |
| C4/C5/C6 | Q12 接个人试卷回看/错题与难度显示；不改监控指标和最终分数规则 |
| C7 | Q13 合并本轮证据；不能只验编辑器而跳过原改造闭环 |

若对应旧任务未开始，将 Q 任务要求直接合入其实施；若正在实施，先交接文件归属；若已经完成，则做向后兼容增量及追加迁移。禁止为了迁就本计划回滚、重写或重建已完成部分。

### 1.1 就绪队列和并行窗口

```text
Q1 契约/交接 → R1
 ├─ 前端 lane：Q2 → R2 → Q3 → R3 → Q4-F（节点挂接/跨端测试）
 └─ 后端 lane：Q4-B（codec）→ R4-B ─────────────→ Q5 → R5
Q4-B + Q4-F → R4-final
R4-final + R5
 ├─ Q6（考点/属性文件集）→ R6 ─┐
 └─ Q7（AI/旧题文件集）  → R7 ─┴→ Q8 → R8 + B3 过门
                                         ├─ B4 + Q9 → R9
                                         └─ C1 + Q10 → R10
Q4 完整 + Q5 + Q10 + C1/C2/C3 ─────────────→ Q11 → R11
Q8 + Q11 + C4/C5/C6 ───────────────────────→ Q12 → R12
全部 Q / 原计划依赖 / 审查记录汇合 ─────────→ Q13 → R13 整链审查
```

`R<n>` 表示该 Q 的固定候选经独立 reviewer 审查通过；`R4-B` 只释放 Q4 后端 codec 接口里程碑，`R4-final` 才表示 Q4 全任务通过。实际调度采用就绪队列，不为“每个 Task 一套新代理”机械串行：

- Q1 通过后，Q4-B 可与 Q2 并行；Q4-F 必须等 Q2/Q3。Q5 可消费测试通过且经 `R4-B` 审查的 codec 固定接口，不必等待 Q4 UI，但仍须满足 B3 版本基础、A3/A4。
- Q4 完整候选和 Q5 通过后，Q6 与 Q7 在文件所有权无交叉时并行；若运行时发现同一前置任务或共享文件 owner 正在修改目标文件，root 先裁决并改为顺序移交。
- Q8 与 B3 汇合过门后，B4/Q9 和 C1/Q10 是两个独立窗口，可并行推进。Q11 等待 Q4 完整、Q5、Q10 以及 C1—C3；Q12 等待 Q8、Q11 以及 C4—C6；Q13 等全部业务、原计划依赖、验证和逐任务审查记录汇合。

root（集成负责人）单写路由、`app.module.ts`、`package*.json`、DDL/迁移登记、公共契约、`Questions.vue`、`RegulationDetail.vue`、`QuestionEditor.vue`、`QuestionPreview.vue`、`tests/run-e2e.mjs` 和设计分册，或在派发前明确唯一 owner 与顺序交接；同一时刻不得由两个 worker 编辑同一文件。其他执行者对共享文件先交精确修改建议，取得移交后再写。数据库 e2e、迁移演练和共用浏览器会话默认串行；只有独立 DB/Redis 前缀、API 端口、上传目录和浏览器会话时才能并行。

### 1.2 Astra 派发、容量与 Review 门禁

执行角色只取当前 `.codex/agents/*.toml`：worker=`gpt-5.6-sol/max`，tester=`gpt-5.6-sol/high`，reviewer=`gpt-6-astra/xhigh`，explorer=`codex-auto-review/max`，researcher=`codex-auto-review/xhigh`。当前运行时上限为 4 个并发（含 root），所以通常最多同时运行 3 个子代理；root 每次创建或复用前都必须重查实际限额、活动后代和文件 owner，不把此数字写成永久能力。worker 可按前端、codec/authoring、exam/integration 等 lane 复用并连续承接相关 Q；tester 仅在独立复现或验证有收益时复用，不机械地为每项新建代理。

每次派发至少写明：目标、允许文件、不可改范围、当前有效设计与接口、固定比较基线、验证命令/证据、交付物，以及依赖释放条件。root 负责契约裁决、共享文件集成和最终差异核验；它不能用自审替代独立 reviewer。实现中出现跨 lane 接口变化，先由 root 固定新契约再继续，不能让 worker 自行扩张范围。

Q1—Q13 每项都必须留下独立 reviewer 结论，覆盖 `$astra-workflow` 的“按价值选择 reviewer”默认：同一 reviewer 可复用并依次审查多个候选，但实施者不能审查自己的改动，也不要求每项 fresh agent。review 输入必须是不可移动的候选——固定 commit，或精确文件清单 + SHA-256/diff 快照——并同时提供原始需求、本任务 `Interfaces`/验收步骤及测试证据；候选变化后旧结论失效。发现退回原 worker 修复，固定新候选后重审，未通过不得释放下游依赖。每份结论记录 Q 编号、候选标识、发现及处置、剩余风险和通过/不通过，Q13 汇总这些记录并再做整链独立审查。

当前 `.harness/agents/code-reviewer.md` 不存在，任何派发都不得声称已读取或加载它。root 必须在业务实施前明确当时实际可用的项目审查依据；在该入口仍缺失时，至少把用户提供的 `AGENTS.md` 指令、`$astra-workflow`、本计划及任务专属 Review 关注点直接交给 reviewer。此次计划修订即以这组可用依据和固定候选执行独立审查，不创建缺失文件。

## 2. 文件布局与协议

迁入清单以补充设计 §4.1—4.2 为准。下表锁定增量职责；`Create` 表示目标，若前置任务已创建同职责文件则改为 Modify，不另造重名服务。

下文 `Tiptap/…` 均指 `web/src/components/Tiptap/…`；QuestionEditor/QuestionPreview/QuestionConceptManager 位于 `web/src/components/`，管理页面位于 `web/src/views/admin/`；同一 Files 条目内未重复前缀的服务、测试文件沿用紧邻明确目录。

| 路径 | 职责 / owner |
|---|---|
| `server/src/common/training-contracts.ts`、`web/src/api/training-types.ts` | Q1 两档可写策略与保留历史类型 |
| `server/src/common/question-document.ts`、`web/src/api/question-document-types.ts` | Q1 编辑/模板/提交/展示的镜像类型 |
| `web/src/components/Tiptap/` | Q2 迁入源组件、图标、许可证；Q3 可靠生命周期；Q4 题目节点；Q6 属性面板 |
| `web/src/components/Tiptap/utils/createExtensions.ts`、`document-adapter.ts` | 扩展组合；文档复制/ID 重映射，不承担后端权限 |
| `server/src/modules/questions/question-document.codec.ts` | Q4 白名单校验、旧题转换、HTML 派生；不 import Vue 组件 |
| `server/src/modules/questions/question-authoring.service.ts`、`question-authoring.controller.ts`、`question-authoring.dto.ts` | Q5 组装、原子提交、结果查询 |
| `server/src/modules/questions/question-template.service.ts`、`question-template.controller.ts` | Q5 模板版本、复制和引用管理 |
| `server/src/entities/question-authoring-commit.entity.ts`、`question-template.entity.ts` | Q5 提交去重记录和模板；扩展 B3 question-version 实体 |
| `server/src/modules/questions/question-concept.service.ts`、`question-concept.controller.ts` | Q6 考点查询/维护，跨题型同类别关联 |
| `web/src/components/QuestionEditor.vue`、`QuestionPreview.vue`、`QuestionConceptManager.vue` | 业务组合、统一预览与考点管理弹窗 |
| `web/src/views/admin/QuestionDesigner.vue`、`web/src/api/question-authoring.ts` | Q8 页面生命周期/网络；组件不直接请求题库 |
| `server/src/modules/exams/concept-assignment.ts`、`sampling.service.ts` | Q10 联合容量和随机可行分配 |
| `server/src/modules/questions/question-student-projection.ts` | Q11 管理原稿到安全学员展示内容；不返回整个原对象 |
| `web/src/components/Tiptap/utils/review-state.ts` | Q12 选中、正确、漏选的独立映射 |
| `tests/fixtures/question-authoring/` | Q1—Q13 共用非敏感协议样例；不放真实学员信息 |
| `web/vitest.config.ts`、`web/src/test/setup.ts`、`web/src/components/Tiptap/__tests__/` | Q2 增加前端组件测试设施与回归；不复制独立研究项目 |

### 2.1 跨任务类型（Q1 定义，后续不得各自改名）

下列是必须建立的接口，不是本轮已经存在的代码。`JSONContent` 前端来自 Tiptap，服务端镜像为只含 JSON 数据的类型；以同一 fixtures 验证两端，服务端不加载浏览器 DOM。复用原 `QuestionType/Id/QuestionDraft/QuestionVersionSnapshot/PoolRule/RandomSource`，不重复定义业务枚举。

其中 QuestionDraft/QuestionVersionSnapshot 是原 B3 计划契约、RandomSource 是原 C1 计划契约，当前未全部落地。Q1 由集成负责人把原计划中的定义先落实到 `server/src/common/training-contracts.ts`，让 Q4/Q10 可以编译和使用；不提前实现这些服务，也不让各任务另造同名类型。旧 `common/errors.ts` 的双题型枚举及 number ID DTO 只留在旧接口适配层，新题库统一使用 A1 的四题型和字符串 Id。

```ts
type ActiveDifficulty = 'easy' | 'hard';
// 原 Difficulty = 'easy' | 'medium' | 'hard' 保留；未知历史仍遵守原 null/unknown 规则。
type DocumentIssue = { path: string; code: string; message: string };
type QuestionMeta = {
  type: QuestionType; category_id: Id; difficulty: ActiveDifficulty;
  concept_id: Id | null; regulation_id: Id | null; regulation_version_id: Id | null;
  analysis: JSONContent; rubric: JSONContent | null; score_cents: number;
  question_id?: Id; base_revision?: number;
  generation_ref?: { task_id: Id; item_key: string }; // 仅定位服务端生成上下文，不授予权限
};
type QuestionAuthoringDocument = {
  schema_version: 1; content: JSONContent; questions: Record<string, QuestionMeta>;
}; // questions 的 key 必须与每个 questionBlock.attrs.client_id 一一对应
type CommitInput = { request_id: string; document: QuestionAuthoringDocument };
type CommitResult = { request_id: string; items: {
  client_id: string; question_id: Id; version_id: Id; revision: number;
}[] };
type QuestionTemplate = { id: Id; name: string; category_id: Id;
  revision: number; document: QuestionAuthoringDocument };
type QuestionDisplay = { item_id: Id; type: QuestionType;
  stem: JSONContent; options: { option_id: string; content: JSONContent }[]; score: number };
type ReviewOptionState = { option_id: string; selected: boolean;
  correct: boolean; missed: boolean };
```

工程默认边界：整份提交最多 100 题、UTF-8 JSON 最多 2 MiB、结构深度最多 32、总节点最多 20000；超限返回明确错误且不写入。大小限制仅为该编辑接口配置，不能顺手放开所有上传。空/占位题可以存模板，正式题目提交必须通过四题型校验。`request_id` 使用 UUID；新本地题/选项 ID 使用至少 21 字符的随机标识，服务端检查唯一性，不以可编辑题号识别身份。

题目结构为 `questionBlock(questionStem, questionOption*)`；题型与业务属性只在 metadata 定义，正确选项来自 option.attrs.checked。选项内部保存块级富文本，不用字符串 label 重建。题目 profile 的根只编排 questionBlock，不允许可计分答案控件游离在题目外；模板说明/占位文本写在明确题目内容内，普通文书排版使用 rich profile。图片题没有客观选项，判断题固定正误语义标签且不乱序。未启用的公式/外部节点拒绝，不能暗示迁入即拥有公式功能。

### 2.2 公共验证与提交规则

每个任务的 Step 1 建测试并看到该行为的红灯；模块未创建导致的针对性缺失可作为红灯，无关编译失败不能冒充目标失败。绿灯后执行 `cd server && npm run build`；前端涉及改动则 `cd web && npx vue-tsc --noEmit && npm run build`。前端测试由 Q2 增加 `npm test` = `vitest run`。

API 测试注册为 `tests/run-e2e.mjs` 白名单 suite，导出 `run(ctx)`，复用 A1 harness。优先 `node tests/run-e2e.mjs --ephemeral --suite <name>` 使用本次独立 MySQL/Redis；只有确认隔离目标及安全凭据后才可用 `DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite <name>`。当前启动器强制 `--suite all` 同时带 `--ephemeral`，不得削弱该保护。未注册 suite 必须拒绝，不可拼任意文件路径。每个任务明确自己的 fixtures，不引用未定义的全局 helper。

每任务结束检查 `git diff --check`、精确差异和验证结果；若届时用户授权本地提交，逐路径 `git add <本任务文件>`、核对 `git diff --cached` 后执行任务给出的主题提交。未获授权则保留可审阅修改，不自动 commit/push；共享文件只提交归属本任务的块。

## 3. 实施任务

### Task Q1：接续交接、两档策略与文档契约

**Dependencies:** A1 的测试隔离与基础类型可用；集成负责人确认 B3/C1 当前 owner。

**Astra 调度/Review:** 由契约 worker lane 执行，root 单写或顺序移交公共契约、原计划和设计分册；这是首个门禁，不与依赖其契约的 Q 并发。按 §1.2 固定候选后交独立 reviewer，重点核对两档写入策略、历史 `medium` 兼容、两端类型/fixture 及旧计划冲突是否一致。

**Files:** Modify 两份 training 类型、`server/src/common/errors.ts`、原总计划/B/C 计划、原融合设计、`docs/design/01-需求分析.md`、`04-API设计.md`、`05-模块设计.md`、`06-关键流程.md`；Create 两份 question-document 类型、`server/src/common/question-difficulty.ts`、`server/test/question-authoring-contract.spec.ts`、`tests/fixtures/question-authoring/contracts.json`。同步 `docs/design/README.md` 的实现状态，不勾选尚未完成的任务。

**Interfaces:** Produces `isActiveDifficulty(value:unknown):value is ActiveDifficulty`、`difficultyForSource(source:LearnerSource):ActiveDifficulty` 和 §2.1 全部类型。所有新写入 DTO 调用同一策略，不能只依赖 TS 联合类型。

- [ ] **Step 1: 固定交接基线。** 记录当前 HEAD/dirty 状态、各前置任务通过证据、共享文件 owner 和迁移登记；确认本计划新增序号 `012_question_authoring.sql`、`013_exam_document_snapshot.sql` 未占用。若已被占用，先由根在本文和迁移清单一致改为后续空闲号，不覆盖原文件。
- [ ] **Step 2: 写契约红灯。** 测试 `expect(isActiveDifficulty('medium')).toBe(false)`、`expect(difficultyForSource('institution')).toBe('easy')`、外来为 hard；合法样例 key/Id 保持字符串。执行 `cd server && npm test -- test/question-authoring-contract.spec.ts`。
- [ ] **Step 3: 实现类型与策略。** 镜像 §2.1 并落实其引用的原 B3/C1 类型；新增错误码使用未占用 40xxx；DTO 非法结构 400、权限 403、版本/内容冲突 409。保留历史 medium/unknown 的读取，不批量改数据；两端字段/枚举用 fixture 比对。
- [ ] **Step 4: 同步旧计划的冲突原句。** 把原设计 U06/U07、§1.2/§6/§7、B3 的“同类别/题型”、B4 的“三级难度”、C1 的“中级固定卷”验收调整为补充设计；原默认分数/时限/补考/固定卷规则不变。把 Q 任务附加到原依赖图和验收项，通知对应执行者。
- [ ] **Step 5: 验证与交付。** 同契约测试绿灯；核对文档交叉引用。实际部署/测试 Node 选择满足全部锁定依赖的版本：当前 sanitize-html 2.17.7 已要求 >=22.12.0，不能仅凭 server 声明 >=22 断言 22.0 可用；将此现存差异记录并由根对齐运行说明。提交主题（获准时）：`feat: define two-level question authoring contracts`。

### Task Q2：源码迁入与正式版编辑器基座

**Dependencies:** Q1；可与 Q4 并行。此任务不接题库 HTTP，不搬整个模板工程。

**Astra 调度/Review:** `R1` 后由前端 editor worker lane 执行，可与 Q4-B 并行；该 worker 后续可复用到 Q3，不要求新建代理。按 §1.2 交独立 reviewer，重点审许可证/来源清单、精确依赖锁定、重复 extension/plugin、宿主样式和构建兼容。

**Files:** Create `web/src/components/Tiptap/` 中补充设计 §4.2 的既有组件/图标/资源、README、LICENSE；`utils/createExtensions.ts`、`styles/editor.scss`、`web/vitest.config.ts`、`web/src/test/setup.ts`、`web/src/components/Tiptap/__tests__/extensions.spec.ts`、`web/src/vite-env.d.ts`（当前不存在，若前置任务已创建则增补）。Modify `web/package.json`、`web/package-lock.json`、`web/vite.config.ts`。

**Interfaces:** Produces `createExtensions(profile:'plain'|'rich'|'question'):Extensions`，question 的业务节点由 Q4 增补；本任务 plain/rich 能独立挂载。测试设施固定 Vitest 2.1.9（与现有 server 相同）、jsdom 26.1.0、@vue/test-utils 2.4.6，并复用宿主 Vue 插件。

- [ ] **Step 1: 建立测试设施和兼容样例。** 从源行为制作非敏感 fixtures，测试段落字号/行高、表格、通用控件、无工具栏输入；断言 `extensionNames.filter(n=>n==='horizontalRule').length === 1`、旧段落行高回填后仍为 `'2'`。
- [ ] **Step 2: 确认红灯。** `cd web && npm test -- src/components/Tiptap/__tests__/extensions.spec.ts`，预期缺迁入实现或目标行为不符。
- [ ] **Step 3: 迁入实际引用文件。** 保留许可证及 SHA-256 清单，排除医疗样例和未引用文件；补显式 import、SVG 目录注册、局部 CSS，不复制源锁文件/自动导入/FitsAdmin stores。根只按清单加入依赖，固定 Tiptap 3.32.0，其余按补充设计 §4.3；保留现有日期控件及其交互，日期组件替换不纳入本任务。
- [ ] **Step 4: 完成版本适配。** 官方 FontSize 替代本地实现；ParagraphLineHeight 保留段落属性并验证跨段选择；TableKit 统一入口，CellSelection 来自 pm/tables；消除重复 HorizontalRule。plain/rich 不挂载 question 面板；不让普通字段加载完整三栏逻辑。
- [ ] **Step 5: 验证。** 同单测、前端类型/构建；`cd web && npm ls @tiptap/core @tiptap/pm prosemirror-model prosemirror-state prosemirror-tables dnd-core` 无版本冲突。浏览器实际验证字号/行高/表格 resize/控件拖入和中文输入。提交主题：`feat: integrate upgraded Tiptap editor foundation`。

### Task Q3：输入输出、实例隔离与真正只读

**Dependencies:** Q2；保存/离页页面联调等待 A5，但组件测试不等待。

**Astra 调度/Review:** 优先复用 Q2 的前端 editor worker，在 `R2` 后顺序接续；不得与仍写同一 Tiptap 文件集的任务并行。按 §1.2 交独立 reviewer，重点审多实例/监听器释放、异步回填、IME 与 preview/review 真只读是否仍可能改 JSON。

**Files:** Modify `Tiptap/index.vue`、`type.ts`、`utils/widgetNodeViewRegistry.ts`、`components/WidgetSetting.vue`、`EditDiv.vue`、`ContextMenu.vue`、`DropControl.vue`、`widget/FieldComponent.vue` 及五种输入控件；Create `Tiptap/__tests__/lifecycle.spec.ts`、`readonly.spec.ts`。

**Interfaces:** Produces props `modelValue:JSONContent/profile/mode:'edit'|'preview'|'review'/showToolbar/showPanels/presentation:'inline'|'dialog'`（presentation 默认 inline）；`questions?:Record<string,QuestionMeta>` 和 `review?:Record<string,ReviewOptionState[]>` 单独传入。events 为 `update:modelValue(doc:JSONContent)`、`question-meta-change({client_id:string,patch:Partial<QuestionMeta>})`、`selection-change({client_id:string|null,option_id:string|null})`、`save()`、`close()`；expose `getJSON():JSONContent`、`setContent(doc:JSONContent):void`、`focus():void`、`validate():DocumentIssue[]`。题目事件在 Q6 接通，元信息与 review 数据不混入 content；完整 save 文档由 QuestionEditor 组合。

- [ ] **Step 1: 写失败用例。** 同时挂三实例，销毁第二个后第一/第三个仍可读写；异步 modelValue 在 ready 后回填一次、不发用户 update；preview 点击单多选/日期、粘贴/拖入后 `expect(getJSON()).toEqual(before)`；EditDiv 粘贴同步模型。
- [ ] **Step 2: 红灯。** `cd web && npm test -- src/components/Tiptap/__tests__/lifecycle.spec.ts src/components/Tiptap/__tests__/readonly.spec.ts`。
- [ ] **Step 3: 实现实例生命周期。** registry 按 editor 实例隔离，去掉固定 DOM ID，监听 on/off 对称；computed 不写 attrs。就绪/回填/题目切换重置旧选区，使用 emitUpdate:false；模板更新与用户编辑区分，不建立无限 watcher 循环。
- [ ] **Step 4: 实现输入输出和只读。** 保存只发事件，不自行关闭；成功状态由父页面决定。preview/review 禁止自定义控件命令、粘贴、删除和拖入，不只设置 contenteditable。普通 plain 模式以段落/换行表达多行文本，调用方显式进行 string/JSON 适配。
- [ ] **Step 5: 验证。** 同单测和前端类型/构建；浏览器验证开关弹窗、输入法组合、光标进出/空节点退格、撤销重做、正文+解析+预览共存。提交主题：`fix: isolate editor state and enforce readonly controls`。

### Task Q4：多题节点、统一 codec 与旧题无损转换

**Dependencies:** Q1；纯 codec 可先行，前端节点挂接和完整测试等待 Q2/Q3；B3 类型已按 Q1 对齐。

**Astra 调度/Review:** 拆成 Q4-B 与 Q4-F 两个固定里程碑：后端 codec worker 在 `R1` 后可与 Q2 并行，测试和独立 reviewer 通过 `R4-B` 后才向 Q5 释放接口；前端 editor worker 在 `R3` 后接节点挂接，最后对跨端完整候选再做 `R4-final`。审查重点为白名单/XSS、无损往返、ID 重映射、边界上限，以及后端里程碑与前端实现是否遵守同一协议。

**Files:** Create `Tiptap/extensions/QuestionNodes.ts`、`MediaImage.ts`、`widget/QuestionBlockView.vue`、`QuestionOptionView.vue`、`utils/document-adapter.ts`、`Tiptap/__tests__/question-nodes.spec.ts`；`server/src/modules/questions/question-document.codec.ts`、`server/test/question-document.spec.ts`；`tests/fixtures/question-authoring/roundtrip.json`、`invalid.json`。Modify 两端文档类型及 `server/package.json`/锁文件（htmlparser2 10.1.0 从现有传递依赖转为直接声明，不升级整棵树）。

**Interfaces:** Produces `validateDocument(value:unknown,mode:'question'|'template'):DocumentIssue[]`；`decodeDocument(doc:QuestionAuthoringDocument):{clientId:string;meta:QuestionMeta;draft:QuestionDraft;editorContent:JSONContent}[]`；`fromLegacy(draft:QuestionDraft):QuestionAuthoringDocument`；前端 `cloneDocument(doc:QuestionAuthoringDocument):QuestionAuthoringDocument`。codec 不做数据库授权；Q5 在事务中补引用和权限校验。

- [ ] **Step 1: 写往返与边界测试。** 两题四选项带粗体/表格/图片 asset_id/段落行高，decode 后答案下标正确；`expect(roundtrip.content).toEqual(normalized.content)`；复制后题/选项/通用组 ID 全部独立且 metadata 正确重映射；重复 ID、metadata 缺失、未知节点/属性、超限返回明确 issue。
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/question-document.spec.ts`；前端 `npm test -- src/components/Tiptap/__tests__/question-nodes.spec.ts`。
- [ ] **Step 3: 实现结构与控件归属。** 采用 §2.1；拖单选/多选到画布空白创建对应 questionBlock，到同型题内增加 option，跨型拖入提示拒绝不静默改题型。一般通用控件保留，但不充当另一套考试答案；图片作答区明确显示题型。编辑/新增/删除选项保持 option_id，当前顺序派生答案下标；判断标签不可被随意替换为普通选项。
- [ ] **Step 4: 实现服务端转换。** 明确允许的节点/marks/attrs 列表；使用现有 sanitize-html 清洗和 htmlparser2.parseDocument 解析旧 HTML，再映射到白名单 JSON，JSON 到 HTML 使用同一白名单的递归转义渲染。通过共用 fixtures 与前端实际 getHTML 对照语义；不从 @tiptap/core 调用浏览器专用 HTML 函数，也不加载 Vue（[官方 HTML 工具说明](https://tiptap.dev/docs/editor/api/utilities/html)）。旧 HTML 不支持内容返回带路径的转换错误，原数据不改写；外链图片需明确重传为受控资源，不静默丢图。
- [ ] **Step 5: 验证。** 同单测+两端构建；恶意事件/链接协议/CSS 单位、嵌套题目、图片题 options、单选多答案、多选不足两个、判断语义、未启用公式均覆盖。提交主题：`feat: define lossless question document codec and nodes`。

### Task Q5：版本落库、整批原子保存与模板 API

**Dependencies:** Q4-B 的测试及独立 Review 已通过、原 B3 版本/审核基础、A3 权限、A4 媒体；不等待 Q4-F/UI。未实现 B3 时在原任务内一并完成，不绕过审核。

**Astra 调度/Review:** 由 backend authoring worker lane 执行，可复用 Q4-B worker；只消费已冻结的 `R4-B` 接口，Q4-F 可在无文件冲突时继续。按 §1.2 交独立 reviewer，重点审整批事务、锁顺序、请求幂等/未知结果恢复、权限与媒体引用、模板复制是否绕过审核。

**Files:** Create §2 中 authoring/template 服务、控制器、DTO、两份实体；`database/migrations/012_question_authoring.sql`、`server/test/question-authoring.spec.ts`、`question-template.spec.ts`、`tests/training-question-authoring.mjs`。Modify B3 `question-version.service.ts`/实体、`database/init.sql`、`app.module.ts`、`tests/run-e2e.mjs`、设计 03/04/05/07 册。

**Interfaces:** Produces `QuestionAuthoringService.assemble(actorId:Id,versionIds:Id[],mode:'edit'|'preview'):Promise<QuestionAuthoringDocument>`、`commit(actorId:Id,input:CommitInput):Promise<CommitResult>`、`getCommit(actorId:Id,requestId:string):Promise<CommitResult>`；`QuestionTemplateService.list(actorId:Id,filter:{categoryId:Id;query?:string;page:number;pageSize:number}):Promise<Page<QuestionTemplate>>`、`get(actorId:Id,id:Id):Promise<QuestionTemplate>`、`save(actorId:Id,input:{id?:Id;expectedRevision?:number;name:string;categoryId:Id;document:QuestionAuthoringDocument}):Promise<QuestionTemplate>`、`remove(actorId:Id,id:Id,expectedRevision:number):Promise<void>`。管理路由见补充设计 §4.5；模板 PATCH 必须带 expected_revision。

- [ ] **Step 1: 写真实事务测试。** 两题中第二题非法时新增版本数为 0；同 request_id 同内容并发/响应丢失后返回同映射；不同内容重放 409；过期 base_revision 整批 409；跨类别考点 400、无权编辑/媒体 403；模板复制不带 question_id/base_revision/generation_ref，不复制答案审批资格。
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/question-authoring.spec.ts test/question-template.spec.ts`；注册 `training-question-authoring` suite 后确认未实现 API 的业务断言失败。
- [ ] **Step 3: 追加 schema。** question_version 增加 editor_content/analysis_content/rubric_content/schema_version 可空字段（旧版本保持空）；question_template 保存文档 JSON、类别、revision、操作者和时间；question_authoring_commit 以 `(actor_id,request_id)` 唯一，保存规范化 payload_hash 与 result_json。同步 init/实体/03 册；已有 007 不改 checksum。
- [ ] **Step 4: 实现唯一写入事务。** 给 B3 增加 `writeInTransaction(tx:EntityManager,input:{questionId?:Id;baseRevision?:number;draft:QuestionDraft;editorContent:JSONContent;analysisContent:JSONContent;rubricContent:JSONContent|null},actorId:Id):Promise<{questionId:Id;versionId:Id;revision:number}>`；原 create/revise 与本服务都委托它，不能内部另起独立事务。按 question_id 稳定顺序加锁，重查修订号、引用、权限和源任务；来源由既有记录或验证后的生成/导入上下文确定，不把 codec 输出或客户端 generation_ref 本身当成可信来源。最后写提交结果并一起 commit。并发同 request_id 以 DB 唯一约束及结果读取收敛，失败不留下假成功记录。
- [ ] **Step 5: 实现模板与媒体引用。** 套用得到独立副本；模板占位允许但入题库前严格校验。绑定 question_version/question_template 媒体引用，解析和 rubric 图片也纳入；删除只释放自身引用，不能删除仍被版本/答卷引用的资源。注册 A4 资源授权回调，不以知道 asset_id 即可读取。AI 新生成及已审核题核心修订保持 pending；人工新建/文件确认沿用 B3/B4 的授权与审核策略，不能因来自模板而继承源题 approved 或绕过权限。
- [ ] **Step 6: 验证。** 单测、`DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-question-authoring`、新建/旧结构迁移一致性检查；DB 中验证原子性和并发，不用 mock 冒充。提交主题：`feat: persist atomic question documents and reusable templates`。

### Task Q6：考点管理与当前题属性面板

**Dependencies:** Q3/Q4/Q5、B3 考点模型；复用 A2 类别与 A4 媒体选择。

**Astra 调度/Review:** `R3/R4-final/R5` 后由 concept/settings worker lane 执行；与 Q7 仅在精确文件集和 shared-file owner 均隔离时并行，可复用已熟悉前端 editor 的 worker。B3 已创建或正在写的 concept 服务与 fixtures 必须由 root 明确唯一 owner 并顺序移交。按 §1.2 交独立 reviewer，重点审类别引用完整性、跨题型同考点、计数口径、当前题隔离及类别切换后的显式清理。

**Files:** Create/Modify `server/src/modules/questions/question-concept.service.ts`、`question-concept.controller.ts`、`question.dto.ts`；`web/src/components/QuestionConceptManager.vue`、`Tiptap/components/QuestionSetting.vue`、`server/test/question-concept.spec.ts`、`Tiptap/__tests__/question-setting.spec.ts`。Modify `QuestionEditor.vue`、`Tiptap/index.vue`、`web/src/api/question-authoring.ts`、`tests/training-question-authoring.mjs`。

**Interfaces:** Produces `QuestionConceptService.list(actorId:Id,filter:{categoryId:Id;query?:string;page:number;pageSize:number}):Promise<Page<ConceptSummary>>`、`save(actorId:Id,input:{id?:Id;categoryId:Id;name:string;description:string}):Promise<ConceptSummary>`、`assertLinkable(conceptId:Id,categoryId:Id):Promise<void>`；`ConceptSummary={id:Id;category_id:Id;name:string;description:string;easy_count:number;hard_count:number}`。计数按各 question 当前版本、各计一次，展示名固定“考点”。

- [ ] **Step 1: 写业务/选择测试。** 同类别的 single+multiple 同考点可保存；跨类别拒绝；无考点可保存；只改问题二难度后 `expect(metaOfQ1).toEqual(beforeQ1)`；选项内定位时右侧仍指向所属题；解析内禁止嵌套题目。
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/question-concept.spec.ts`；前端 `npm test -- src/components/Tiptap/__tests__/question-setting.spec.ts`。
- [ ] **Step 3: 实现轻量考点 API。** `/admin/question-concepts` 查询/创建、`/:id` 更新与受控删除；同类别名称去空格后去重，引用中的考点删除返回 409；已被题引用不允许换类别。取消题型一致性校验，不把 node.group 作为 concept_id。
- [ ] **Step 4: 接右侧表单。** 搜索/新建来自同一 API；只显示简单/困难；答案摘要由 checked 派生，解析为独立 rich 实例，图片题另显评分参考。类别变更且旧考点不兼容时明确要求重新选择或清除；批量默认只影响新增题，不覆盖既有题。
- [ ] **Step 5: 验证。** 同单测+authoring suite+前端类型/构建；浏览器做多题切换、搜索新建、计数、跨类别失败后保留输入。提交主题：`feat: manage concepts and per-question authoring settings`。

### Task Q7：AI 与旧题进入统一文档链

**Dependencies:** Q4/Q5、原 B3 AI 生成/审核内部接口；不等待 B4，也不等待 B3 的页面最终验收。不更换 PDF/多模态服务或模型供应商。

**Astra 调度/Review:** `R4-final/R5` 和 B3 内部接口就绪后由 AI/legacy worker lane 执行，可复用 backend authoring worker；先由 root 将 Q5/B3 的 `question-version.service.ts` 所有权明确移交给 Q7，再与 Q6 的隔离文件集并行。按 §1.2 交独立 reviewer，重点审 AI 信任边界、task/item 映射、旧题无损转换、难度/考点伪造拒绝及重试时不重复建题。

**Files:** Modify `server/src/modules/ai/question-generation.service.ts`、`question-review.service.ts`、`ai.controller.ts`、`server/src/modules/questions/question-version.service.ts`、`tests/training-question-bank.mjs`。Create `server/test/question-authoring-inputs.spec.ts`、`tests/fixtures/question-authoring/ai-output.json`。

**Interfaces:** Produces `normalizeGeneratedQuestions(raw:unknown,context:{taskId:Id;items:{itemKey:string;categoryId:Id;difficulty:ActiveDifficulty;conceptId:Id|null;regulationId:Id;regulationVersionId:Id}[]}):QuestionAuthoringDocument`，上下文来自持久化生成任务；保留原生成 DTO/状态，增补合法 concept_id、生成项 key 及文档结果。旧 JSON 路线调用 Q4 fromLegacy，再通过 B3 同一版本写入原语。

- [ ] **Step 1: 写输入归一化测试。** AI 改难度/伪造考点 ID、重复或缺失 item_key 被拒；context 的考点/来源正确绑定；legacy 标准题数组能转 document；请求 medium 被运行时校验拒绝；旧生成任务编辑不重复创建题目。
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/question-authoring-inputs.spec.ts`。
- [ ] **Step 3: 扩展生成提示与输出校验。** 支持目标文档协议，失败可按现有任务机制重试；AI 本期仍只生成 single/multiple，不自动新增考点，不信任模型生成的数据库 ID。服务端记录 task_id/item_key 对应上下文；缺映射不按数组位置猜配。既有生成结果已持久化时 assemble 编辑原 pending 题，不重复创建一批题。
- [ ] **Step 4: 统一 AI 和旧题。** UI 修改/AI 回填走相同文档结构。旧题难度未知不得静默置 easy，编辑提交前由管理员补齐；无考点仍可保存，不伪造旧来源。既有 AI 持久化流程也保存同版本原稿，禁止另开绕过 codec 的快路径。
- [ ] **Step 5: 验证。** 同单测、`test/pdf-vision.spec.ts`、`training-question-bank` suite；Mock AI 整批回填后编辑再保存，原题数不翻倍；未测真实供应商就明确记为未验证。提交主题：`feat: normalize AI and legacy questions into documents`。

### Task Q8：页面入口、模板库、相关题与普通多行输入

**Dependencies:** Q3/Q5/Q6/Q7、A5 未保存确认；组件可提前开发，入口集成由根单写。

**Astra 调度/Review:** 只有不依赖接口的独立展示组件可由前端 worker 提前准备；真实入口、保存联调和 Q8 完成必须等 `R3/R5/R6/R7` 与 A5 就绪。优先复用 Q6 lane，路由和列出的共享文件由 root 单写或明确移交。按 §1.2 交独立 reviewer，重点审副本 ID、保存冲突/响应丢失恢复、dirty 状态、权限路由和 plain 文本往返；通过后才与 B3 一起释放下一窗口。

**Files:** Create `web/src/views/admin/QuestionDesigner.vue`、`Tiptap/components/TemplateLibrary.vue`、`RelatedQuestions.vue`、`Tiptap/__tests__/designer-flow.spec.ts`、`plain-field.spec.ts`；Modify `Questions.vue`、`RegulationDetail.vue`、`QuestionEditor.vue`、`web/src/api/question-authoring.ts`、`web/src/router/index.ts`；普通多行落点随此任务的明确清单记录在 `Tiptap/README.md`，不修改单行身份/密码/数字字段。

**Interfaces:** `QuestionEditor` v-model 为 QuestionAuthoringDocument、save 输出整份文档；QuestionDesigner 通过 API 模块调用 Q5—Q7。路由 `/admin/questions/editor`，query 只包含 version_id/template_id/generation_task_id 等标识，不塞整份 JSON；列表编辑、手工新建、AI 编辑分别进入同页。普通字符串字段适配函数为 `plainTextToDocument(text:string):JSONContent` 与 `documentToPlainText(doc:JSONContent):string`，保留换行和空值语义。

- [ ] **Step 1: 写流程测试。** 模板插两次 IDs 不相同；相关题插入是副本，不修改原题；保存 409/断网后内容保留；未知提交结果先 GET 查询再决定是否重试原 request_id；plain 字段无题目侧栏且往返 `a\nb` 不变。
- [ ] **Step 2: 红灯。** `cd web && npm test -- src/components/Tiptap/__tests__/designer-flow.spec.ts src/components/Tiptap/__tests__/plain-field.spec.ts`。
- [ ] **Step 3: 实现真实页面与入口。** Questions 列表新建/编辑/筛选/考点管理；RegulationDetail 已生成批次转编辑器。新增路由复用权限，异步失败可重试，刷新按 ID 重载；不依赖 Downloads 或另启模板应用。文件导入后的编辑入口由 Q9 接入，不阻塞本任务和 B3 验收。
- [ ] **Step 4: 实现模板/相关题。** 同类别搜索/分页；整份替换先确认未保存内容，插入时 cloneDocument 统一重映射并聚焦新增题；模板管理保存/更新 revision/删除均走 API。复制清除数据库身份与生成任务凭据，已有明确制度引用保留并校验；模板替换不会修改已发布题目。
- [ ] **Step 5: 接多行字段和保存状态。** 本期新建/改造的题干、选项、解析、评分参考、考点说明用 Tiptap；说明/备注原接口为纯文本的使用 plain 适配，不向数据库突然写 HTML。盘点原 A/B/C 后续新增的 textarea 并在各 owner 接续清单采用该入口；不把现有代码配置文本、导入原文等机器格式输入强换成富文本。保存成功更新 question_id/base_revision 后清 dirty，关闭/路由离开接 useUnsavedChanges。
- [ ] **Step 6: 验证。** 同单测+前端类型/构建；PC 完成手工多题、模板复用、相关题、AI 修改、断网/冲突、取消离页/确认离页。提交主题：`feat: connect question designer and reusable authoring templates`。

### Task Q9：Excel/TXT 导入与编辑原稿一致化

**Dependencies:** B3 已汇合 Q4—Q8 并验收；原 B4 进入实施且导入服务接口可用；Q5 的事务写入原语。不重做导入批次系统，可与 C1/Q10 并行。

**Astra 调度/Review:** `R8+B3` 过门后由 import worker lane 与 B4 owner 接续，可复用 backend authoring worker；在资源隔离时与 C1/Q10 并行。按 §1.2 交独立 reviewer，重点审预览/确认语义、合法行部分提交、批次幂等、统一 codec 和确认后进入编辑器时不二次创建。

**Files:** Modify `server/src/modules/questions/question-import.service.ts`、`question-import-format.ts`、`question-version.service.ts`、`web/src/views/admin/QuestionImport.vue`、`docs/templates/question-import-format.md`、`tests/training-question-import.mjs`；Create `server/test/question-authoring-import.spec.ts`。

**Interfaces:** 复用 B4 `QuestionImportService.preview/commit` 和原 ImportBatchService；每个有效行经 Q4 fromLegacy/decodeDocument 转原稿，确认时调用 Q5 writeInTransaction。成功响应沿用 B4 created_ids，前端根据版本查询结果调用 Q5 assemble，不把已确认行再次当新题提交。

- [ ] **Step 1: 写导入契约测试。** medium 行明确报错、跨类别考点行报错、同考点跨题型合法；Excel/TXT 同内容转换出等价 JSON；混合错误行仍按原 B4 只确认合法行；重复确认 created_ids 不变；导入后编辑粗体/选项不会丢失原内容。
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/question-authoring-import.spec.ts test/question-import.spec.ts`。
- [ ] **Step 3: 接统一校验与事务。** 模板说明只提供 easy/hard；导入内容和派生字段同版本保存，复用受控媒体与考点引用校验。保留原 B4 的合法行确认、去重指纹及显式审核策略，不把“编辑文档整批原子”误套成“含错误行文件一律不可预览/确认”。
- [ ] **Step 4: 接 PC 编辑入口。** QuestionImport 确认成功后可打开已创建题，使用 question_id/base_revision，编辑属于原题修订；未知确认结果先查原批次。没有已确认结果时不能擅自提交第二批文档。
- [ ] **Step 5: 验证。** 同单测、`node tests/run-e2e.mjs --ephemeral --suite training-question-import`、前端类型/构建；PC 覆盖错误行重导、重复确认、导入后打开设计器再保存。提交主题：`feat: preserve authoring documents in question imports`。

### Task Q10：跨题型考点联合校验与可行抽题

**Dependencies:** Q1、原 B3 approvedCandidates 与 C1 发布服务；纯算法可在契约固定后提前准备和验证，但正式 C1 集成及 Q10 完成仍等待 `R8+B3` 过门，不能借“不等待编辑器 UI”绕过原计划门禁。

**Astra 调度/Review:** 在 `R8+B3` 过门且 C1 发布契约就绪后，由 exam sampling worker lane 执行；与 B4/Q9 文件和测试资源隔离时并行。按 §1.2 交独立 reviewer，重点审求解完备性、跨题型去重、发布检查与实际抽取同源、随机源使用、固定卷约束及无解时不降级凑题。

**Files:** Create `server/src/modules/exams/concept-assignment.ts`、`server/test/concept-assignment.spec.ts`；Modify `sampling.service.ts`、`paper-release.service.ts`、`paper.dto.ts`、`web/src/views/admin/Papers.vue`、`PaperDetail.vue`、`server/test/sampling.spec.ts`、`paper-release.spec.ts`、`tests/training-publishing.mjs`、04/06 册。

**Interfaces:** Produces `solveConceptAssignment(pool:QuestionVersionSnapshot[],rules:PoolRule[],difficulty:ActiveDifficulty,rng?:RandomSource):{ok:boolean;assignments:{type:QuestionType;conceptKey:string}[];conflict:{required:number;assignable:number;types:QuestionType[]}|null}`。保留原 SamplingService validatePool/draw 外部方法，新增 conflict 解释联合不足，不伪造单题型 available；conceptKey 为 `c:<conceptId>` 或 `q:<questionId>`，防命名碰撞。

- [ ] **Step 1: 写能击穿独立计数/贪心的测试。** 两题同考点分别为单/多选、各需一题→不可行；考点 A 有单+多、B 只有单、各需一题→可行且必须 B 单+A 多；多种 rng 顺序均成功；无考点同题多个版本不能重复。
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/concept-assignment.spec.ts test/sampling.spec.ts test/paper-release.spec.ts`；关键断言 `expect(result.ok).toBe(false)` / `expect(draw(...)).toHaveLength(2)`。
- [ ] **Step 3: 实现联合匹配。** 用容量网络：source→题型容量为 count、题型→有该型候选的考点容量 1、考点→sink 容量 1；最大流等于总题数才可行。抽取时用原 crypto RandomSource 随机排列候选边，求完整匹配后再在已分配“考点+题型”内选一个版本；不用有限次数随机重试赌成功，不宣称均匀采样所有合法试卷。发布检查与抽取使用同一求解器。
- [ ] **Step 4: 接两池与固定卷。** easy/hard 分别联合可行才允许随机发布；禁止降级/跨类别凑题。固定卷检查整卷考点唯一、只用当前 active 难度、总分仍 100；历史中档发布/记录仍可读，不能借重新发布绕过当前规则。样例预览明确非实际个人卷。
- [ ] **Step 5: 验证。** 同单测+`training-publishing` suite；small-pool 穷举对照 solver 是否有解，检查总分/题型配额/两池/全卷唯一；页面显示跨题型冲突而非只显示“每类都有题”。提交主题：`feat: sample feasible cross-type concept pools`。

### Task Q11：冻结编辑原稿、稳定选项映射与安全下发

**Dependencies:** Q4 完整候选、Q5、Q10 均已通过独立 Review，原 C1/C2/C3 已集成；A4 支持版本及答卷媒体引用。

**Astra 调度/Review:** 由 exam snapshot worker lane 在上述门禁全部满足后执行，可复用 Q10 worker；涉及 shared DDL/设计/suite 清单时由 root 单写或顺序移交。按 §1.2 交独立 reviewer，重点审快照不可变性、选项映射、最小学员投影、答案/解析泄漏、历史兼容和各类媒体读取授权。

**Files:** Create `server/src/modules/questions/question-student-projection.ts`、`server/test/question-student-projection.spec.ts`、`tests/training-question-snapshots.mjs`、`database/migrations/013_exam_document_snapshot.sql`；Modify release/record-question 实体、`paper-release.service.ts`、`attempt.service.ts`、`attempt-reader.service.ts`、`legacy-exam-adapter.ts`、`shuffle.service.ts`、`database/init.sql`、测试 suite 白名单、03/04/06/07 册。

**Interfaces:** Produces `toStudentQuestion(snapshot:QuestionVersionSnapshot,input:{itemId:Id;displayToOriginal:number[];scoreCents:number}):QuestionDisplay`；QuestionVersionSnapshot 兼容增补 `editorContent:JSONContent|null;analysisContent:JSONContent|null;rubricContent:JSONContent|null;schemaVersion:1|null`。个人题单保存 option_id 与原下标/显示下标的映射；在考标准答案只留服务端。

- [ ] **Step 1: 写冻结/泄漏测试。** 发布后改题/改考点不影响 release；开考后改题/换 shuffle secret 不改题序；递归断言在考 JSON/HTML/资源属性没有 answer/checked/analysis/rubric/isCorrect 或管理标记；提交显示选项 B 后得分对应映射后的真实选项。
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/question-student-projection.spec.ts test/attempt-policy.spec.ts`；登记 `training-question-snapshots` suite。
- [ ] **Step 3: 扩充快照与媒体。** 013 仅追加所需列和索引，不改已执行 008/009；现有快照字段能完整承载则复用，避免两份不一致内容。发布/开考冻结编辑原稿及元信息、解析、rubric、稳定选项 ID 和映射；把正文/选项/解析/rubric 资源绑定到各自冻结 owner，旧题编辑或模板删除不能使历史图片失效。
- [ ] **Step 4: 实现最小展示投影。** 从允许字段重建 JSON 与兼容 HTML，不直接 spread 原稿后删几个 key。剥离全部正确标记及通用控件的管理状态；题干/选项的可展示资源经 A4 授权加载，解析专属资源不能由在考读取路径访问。保留旧客户端字段结构；需要安全图片展示时复用宿主认证资源获取，不永久暴露外链。
- [ ] **Step 5: 验证。** 同单测、`training-question-snapshots`、原 `training-attempts`/`training-submissions` suites；旧无快照记录明确标识遗留，不能从今天题库伪造历史。提交主题：`feat: freeze rich question snapshots and sanitize exam payloads`。

### Task Q12：PC 整卷回看、学员详情、错题与统计显示

**Dependencies:** Q3/Q8/Q11、原 C4/C5/C6；不修改最终分数规则。

**Astra 调度/Review:** `R8/R11` 与 C4—C6 通过后由 review/history worker lane 执行，可复用前端 integration worker；共享预览/页面文件按 root 的顺序移交处理，不与其他 writer 重叠。按 §1.2 交独立 reviewer，重点审本人/管理员权限边界、冻结快照而非当前题库、乱序映射、只读渲染、待批状态和历史难度统计兼容。

**Files:** Create `Tiptap/utils/review-state.ts`、`Tiptap/__tests__/review-state.spec.ts`、`server/test/question-review-view.spec.ts`；Modify `QuestionPreview.vue`、`QuestionOptionView.vue`、`server/src/modules/exams/exam-history.service.ts`、`exam-admin.controller.ts`、`grading-admin.controller.ts`、`training-exams.controller.ts`；管理端 `web/src/views/admin/Users.vue`、`Questions.vue`、`PaperDetail.vue`、`GradingDetail.vue`、`ExamRecords.vue`、`ExamRecordDetail.vue`、`TrainingStatistics.vue`（后六者同页面目录，使用 B3/C1/C4/C5/C6 落点）；`tests/training-grading.mjs`、`training-statistics.mjs`。旧员工详情 `web/src/views/employee/ScoreDetail.vue` 同步接兼容展示，保留旧路由。若前置最终页面名不同，根在 Q1 交接表记录一对一实际路径，改实际入口而非创建重复页。

**Interfaces:** Produces `buildReviewState(options:{option_id:string}[],selectedIds:string[],correctIds:string[]):ReviewOptionState[]`；扩展原 FinalResult/WrongItem 的冻结 JSON 字段，保留旧兼容字段和 grading_state。在 `ExamHistoryService` 增补 `forAdmin(actorId:Id,recordId:Id):Promise<FinalResult>`、`wrongItemsForAdmin(actorId:Id,userId:Id,page:number,pageSize:number):Promise<Page<WrongItem>>`，路由 `GET /admin/exam-records/:id/result`、`GET /admin/students/:id/wrong-questions`；使用 A3 权限目录的实际记录读取 code，不借本人 API 传任意 userId。学员结果/错题仍只能查本人。

- [ ] **Step 1: 写四种标记测试。** 选中且正确→绿色+圈；选中且错→红色+圈；正确未选→绿色+漏选、不加圈；干扰项未选→普通。断言 review 后原稿 JSON 完全未变；乱序选项按 option_id 映射，不按当前题库下标。另断言学员查他人 403、无记录读取权限的管理员 403、在考管理详情不下发答案。
- [ ] **Step 2: 红灯。** 前端 `npm test -- src/components/Tiptap/__tests__/review-state.spec.ts`；`cd server && npm test -- test/question-review-view.spec.ts`。
- [ ] **Step 3: 接管理端整卷详情。** Users 的“考试情况”进入按 user_id 筛选的 ExamRecords；记录打开 ExamRecordDetail。两页详情及 GradingDetail 复用 QuestionPreview，按当次题序逐题展示，支持题目定位，不加载最新题库替换快照。Questions 的单题预览与 PaperDetail 的整卷预览也用该组件，普通预览与 review 区分；没有答案权限的预览不显示正确标记。图片题显示图片/评语/分数，待批改保留 null，不伪装客观对错。
- [ ] **Step 4: 接错题与统计。** ExamRecords 在已指定学员时提供“错题”抽屉，分页调用受控管理接口，逐题使用 QuestionPreview；wrongItems 仍只返回最终非满分项，待批改不提前入错题，不绕过本人 API。当前筛选文案简单/困难，历史 medium/mixed/unknown 继续如实展示，不过滤掉历史人数或重算分榜身份。
- [ ] **Step 5: 验证。** 单测、`training-grading`/`training-statistics` suites、前端类型/构建；PC 实操两名学员不同卷、漏选/错选、图片待批/已批、历史旧记录，确认所有控件只读。提交主题：`feat: render frozen attempt reviews and wrong questions`。

### Task Q13：集成验收、升级演练与交付收口

**Dependencies:** Q1—Q12 通过，原 A1—C6 的相关前置已集成；与原 C7 一次汇合，不开第二套验收资源。

**Astra 调度/Review:** root 汇合全部固定候选与逐任务审查记录，integration worker 只写其获配文件，tester 按需独立复现全链且共用 DB/Redis/浏览器资源串行；角色均可复用，不要求 fresh agent。完成修复和重验后，独立 reviewer 对最终固定 commit 或文件清单+hash 做 `R13` 整链审查，重点核对迁移/初始化一致性、端到端契约、安全边界、证据状态和是否存在夸大验收；root 只做裁决和集成，不替代该审查。

**Files:** Create `tests/training-question-authoring-flow.mjs`、`review/question-authoring-acceptance-2026-10-21.md`；Modify `tests/run-e2e.mjs`、`tests/migration-contract.test.mjs`、`docs/design/README.md`、`docs/design/02-系统架构.md`、补充设计的实现状态、`Tiptap/README.md`；更新原 C7 验收条目。

**Interfaces:** Produces `training-question-authoring-flow` suite 与实际结果清单；全部新 suite 纳入 `--suite all`。交付状态分“自动化通过 / PC 实操通过 / 未验证”，不称 H5 已完成。

- [ ] **Step 1: 写全链失败用例。** 制度→Mock AI 多题→编辑→模板→入库待审→审核→两个身份分别抽题→保存交卷→整卷回看/错题；人为保存响应丢失后查询确认；发布后改原题与删除模板再回看保持一致。
- [ ] **Step 2: 做 schema 演练。** 隔离库中比较 init 与逐步迁移 INFORMATION_SCHEMA；验证 012/013 重跑安全、旧题/旧答卷不变、迁移中断可续跑、进行中答卷阻断与校验和保护。不得把测试初始化器指向开发库。
- [ ] **Step 3: 运行自动化。** `cd server && npm run build && npm test`；`cd web && npm test && npx vue-tsc --noEmit && npm run build`；`node --test tests/test-target.test.mjs`；`node --test tests/migration-contract.test.mjs`（当前测试自身创建 ephemeral 服务）；`node tests/run-e2e.mjs --ephemeral --suite all`。缺少 MySQL/Redis 二进制等运行条件则记录未验证，不移除隔离保护，也不标已完成。
- [ ] **Step 4: 完成 PC 门槛与独立审查。** 按补充设计 §4.6/§7 和升级调研 §9 实际验收；重点多实例、中文输入、拖入、表格、只读、媒体权限、跨题型匹配、回看圈选。修复本轮引入的关键问题，独立审查不以单测代替浏览器观察。
- [ ] **Step 5: 交付可审阅结果。** 列来源文件清单、依赖锁定、迁移序号、涉及入口、验收证据与未覆盖项；确认代码运行不依赖 Downloads/临时实验目录。按用户授权范围进行本地提交，主题 `test: verify integrated question authoring and exam reviews`；不自动合并到 main、push 或部署。

## 4. 设计覆盖与完成判定

| 设计范围 | 负责任务 |
|---|---|
| 两档身份题池、考点跨题型、来源保留 | Q1/Q6/Q7/Q9/Q10 |
| 模板源码迁入、目录、版本和样式 | Q2/Q3 |
| 多题题干/选项共同编排、JSON、图片 | Q4/Q5 |
| 考点管理和右侧逐题属性/解析 | Q6 |
| AI/旧题/导入统一编辑及审核链 | Q5/Q7/Q8/Q9 |
| 模板库/相关题/页面入口/普通多行输入 | Q8 |
| 全卷联合抽取、固定卷检查 | Q10 |
| 不可变快照、媒体、在考答案裁剪 | Q11 |
| 整卷回看、错题、红绿圈选与历史统计 | Q12 |
| 原计划衔接、数据库一致性和验收 | Q1/Q13 |

“可以开编辑器”只算 Q2/Q3；“题目能保存”只算 Q4—Q8；只有 Q10—Q13 和原改造前置一起过门，才可以交付完整考试业务。未通过项保持未勾选，不能用研究脚本的 10 项结果替代上述任务验收。
