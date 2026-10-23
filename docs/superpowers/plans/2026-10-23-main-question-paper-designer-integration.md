# main 双设计器定向集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 项目执行约定优先：沿用 AGENTS.md 的主代理整合、独立任务并行、共享文件单一 owner。上面的通用建议不构成强制切换 SDD 的指令；执行时按实际采用的工作流加载对应 Skill。本轮只编写计划，不开始实施。

**Goal:** 在 main 当前题库和考试链路上完整接入来源分支的试题设计器、试卷设计器，启用可扩展的简单／困难两档，并保证富文本保存重开、发布和学员展示一致。

**Architecture:** 保留来源 PC 组件与交互，新增作者原稿和幂等提交能力，适配 main 的题目版本、媒体授权及稳定选项 ID。新增内容 schema 3 支撑受控富文本，继续读取旧 schema 1／2；考试提交、判分、纯 timeout 和历史快照沿用 main。先完成合同，再并行实现存储、PC 和移动端，最后接入现有入口并验收。

**Tech Stack:** Node.js ≥22、NestJS、TypeORM、MySQL 8.0、Redis；PC Vue 3／Element Plus／来源锁定的 Tiptap 3.32.0；mobile uni-app／Vue 3／Wot UI 2.3.2 独立只读渲染；Vitest、Node test runner、Playwright 与隔离 API harness。

**Spec:** [已确认的集成设计](../specs/2026-10-23-main-question-paper-designer-integration-design.md)，提交 `e10dce7197d618eaa56a8ddb6ba404ed9d488f7f`。实施者必须同时阅读设计与本计划。

## Global Constraints

- main 为基线，定向移植两个设计器，不整体合并旧工作区。
- 当前难度只启用 `easy`／简单和 `hard`／困难，保留未来扩展能力；历史 `medium` 不自动重分类，不改历史试卷和成绩。
- 本轮保留 main 的同类别、同题型考点约束；不迁入跨题型联合抽样、图片作答、rubric、人工阅卷、监考或旧 AI 任务平台。
- 完整保留来源设计器界面与交互；固定卷使用一个主 Tiptap 实例，最大 100 题；随机卷继续原配置页。
- 普通保存留在设计器；保存并新增必须先确认保存成功；试卷修改库中题另存新题，未修改题复用原版本。
- 作者原稿只供管理端；进行中 payload 不含答案、解析、`checked/correct`、管理元数据或任意资源 URL。
- 选项排序不改变已有稳定 ID；新移动端提交继续 `{record_id,answers:[{item_id,option_ids}]}`。
- 旧 schema 1／2 与冻结历史不批量改写；schema 3 使用独立校验路径，不直接放宽旧白名单。
- 媒体只存受控 `asset_id`，签票与读取校验精确业务归属；不把 JWT 放入 URL。
- 迁移当前从 `022` 起追加，执行前复核最新序号；同步 migration/init/entities/设计，不改既有 checksum。
- 不读业务 `.env` 或输出凭据；所有服务凭据运行期注入；数据库验证使用自有 ephemeral 实例。
- 保留两个工作区的并发改动，不 stash/reset、不 `git add .`／`-A`；仅提交本任务明确文件。没有另行授权不推送、部署或执行生产迁移。
- 本计划各项测试结果目前均为待执行，不沿用旧 Q1—Q13 数量或截图充当 main 集成证据。

## Review Focus

1. **旧题短 ID 与重新排序：** `A/B` 等 main 合法 ID 不能被来源长度校验拒绝或被重新生成；T1、T5、T8 用同一 fixture 验证。
2. **响应丢失与部分保存：** 题目已提交但试卷未保存、用户重试或退出时不重复建题，不错误清除脏状态；T3、T9 覆盖。
3. **合法表格／格式与恶意近似输入：** 合并单元格和格式不丢失；事件、未知 attrs、嵌套答案和外链图片不透传；T1、T4、T6 覆盖。
4. **旧客户端与长时间打开的页面：** schema 3 能力不足在首次开考写入前拦截；已有记录不重抽、不重置 deadline；T4、T6 覆盖。
5. **旧中级题与同名考点：** medium 草稿可读但不能静默删题发布，历史已发布卷继续原规则，切换题型不偷偷建立跨题型考点；T7、T8、T9 覆盖。

---

## 文件责任与来源边界

当前 main 业务基线为 `562b46d`，设计提交后 HEAD 为 `e10dce7`；来源为 `/Users/caogj/.codex/worktrees/155a/RuleExam`，其 HEAD `09ddb1f` 不包含全部设计器未提交内容。执行时重新记录实际值。

| owner | 创建／主要修改范围 | 职责 |
|---|---|---|
| T1 内容合同 | `server/src/common/question-content-v3.ts`、`modules/questions/question-content-v3.ts`、共享 JSON fixtures | 严格内容结构、纯转换、稳定 ID 与安全输出合同 |
| T2 存储 | migration、init、`question-version.entity.ts`、`exam-paper.entity.ts`、回执 entity、paper DTO/service | 作者原稿、布局与回执存储；升级安全 |
| T3 作者服务 | `question-authoring.*`、codec、`question-version.service.ts`、`app.module.ts` | 装配、锁版本、批量事务、回执和原稿往返 |
| T4 考试合同 | 发布／attempt reader／controller／submission／错误码 | schema 3 冻结、安全投影、客户端能力检查、媒体读取 |
| T5 PC 内核 | Tiptap、question-designers、共享编辑器、web 类型/API 与测试配置 | 保留来源组件、稳定 ID 适配、布局受控、HTTP facade |
| T6 mobile | 内容类型／只读渲染／exams API／相关测试 | 独立渲染及能力声明，不搬入 PC 编辑器 |
| T7 难度 | 服务端 difficulty policy、现有录题/导题/发布校验、web 选项目录 | 两档启用与旧值兼容 |
| T8 单题入口 | Questions、QuestionDesigner 页面、单题 composable、路由 | main 录题、修订和已有来源入口 |
| T9 试卷入口 | Papers、PaperDetail、paper host/controller/state | 创建固定草稿、完整设计器、分步保存收敛 |
| T10 集成 | runner 注册、隔离整链、验收报告、现行设计分册 | 全链验证和证据归档 |

T2→T3→T7 顺序处理 `question-version` 相关共享文件；T2→T7 顺序处理 `paper.service.ts`。T4 完成后 T7 才修改发布难度校验。`app.module.ts` 由根代理集中接入 T2/T3/T7 的注册增量。web 共享类型/API 先由 T5 定稿，T8/T9 通过其接口工作；不得各自复制一套类型。

来源的 `QuestionEditor.vue` 和 main 同名组件职责不同：来源版本在 T5 暂落为 `question-designers/QuestionDocumentEditor.vue`，调整来源设计器 import；main 旧 `QuestionEditor.vue` 在 T8/T9 消费方迁完前继续可用。不能在组件可复用阶段就破坏现有录题页。

## 任务依赖与并行

```text
T1 合同与内容 codec
 ├─ T2 存储 ─ T3 作者保存 ─┐
 ├─ T4 考试合同 ──────────┴─ T7 两档贯通
 ├─ T5 PC 内核/API
 └─ T6 mobile 渲染与能力声明

T3 + T5 + T7      → T8 单题宿主
T2 + T3 + T5 + T7 → T9 试卷宿主
T4 + T6 + T8 + T9 → T10 集成验收
```

T7 只需 T3/T4 的后端合同；T8/T9 同时依赖 T5。并发上限按运行时工具计算，根代理也占槽位；优先启动 T2/T4/T5，空出槽位后安排 T6。各任务先通过自身检查再交接；T10 不用于掩盖此前任务未闭环。

## 统一接口决定

以下是本计划固定的技术接口，名称不得由各 lane 各改一套；实现仍复用现有服务。

```ts
// T1 server common；T5/T6 按同一 JSON fixtures 对齐端侧类型。
type ContentSchema = 1 | 2 | 3;
type StableOptionIds = Record<string, Record<string, string>>; // client_id -> editor option_id -> stable ID
type VersionTokens = Record<string, { question_id: string; expected_version_id: string | null }>;
interface DesignerLayoutV1 {
  schema_version: 1;
  settings: Record<string, unknown>; // 仅来源 TemplateSettingModel 实际字段，经 codec 明确白名单收窄
}
interface AuthoringBundle {
  document: QuestionAuthoringDocument; // 来源 schema_version=1，收窄为三客观题
  option_ids: StableOptionIds;
  identities: VersionTokens;          // 新题／试卷修改副本不携带原题写身份
  layouts: Record<string, DesignerLayoutV1>;
}
interface AuthoringCommitRequest { request_id: string; bundle: AuthoringBundle }
interface AuthoringReceipt {
  request_id: string;
  bundle: AuthoringBundle;            // 本次保存版本和规范化原稿，不是事后 GET 当前版本
  items: Array<{ client_id: string; question_id: string; saved_version_id: string; revision: number }>;
}
type DesignerState = AuthoringBundle; // 宿主状态；传入可视组件的 modelValue 仍是 bundle.document
type DesignerSession = Pick<AuthoringBundle, 'option_ids' | 'identities' | 'layouts'>;
```

`DesignerLayoutV1.settings` 的精确键从来源 `TemplateSettingModel` 与面板实际可编辑字段生成 T1 清单，T5 收窄类型并实现校验；不存在“任意 JSON 属性可持久化”的默认权限。作者存储为每题 `AuthoringBundle` 的单题切片，不能把整卷其他题答案一起存入该题原稿。

- **能力协商：** 新 mobile 在考试 start/read/result/wrong-questions 请求发送 `X-Question-Content-Version: 3`。缺失按 2；只接受 `2`／`3`，非法值返回 40001。服务端不得把该头视为认证或授权。
- **升级错误：** 复用 `Errors.notEligible` 的 40901，`data.reason_code='CONTENT_VERSION_REQUIRED'`、`required_content_version:3`；提示“请更新学员端后再打开此试卷”。在创建 assignment/record 和消耗次数之前判断。已有 schema 3 active 被旧端打开也只返回此错误，不改 deadline 或题单；终态仅查状态不因内容能力失败。
- **内容响应：** 能力 3 的题项增加 `content_schema_version:2|3`；legacy 通过现有适配输出 2。能力 2 的旧响应保持原结构；只有整份目标题单／结果均可按 2 读取时返回内容，不逐题丢弃。submit body 不增加版本字段。
- **保存 HTTP：** `POST /admin/question-documents/assemble` 请求 `{version_ids:string[]}`，返回 `AuthoringBundle`；`POST .../commit` 接收 `AuthoringCommitRequest` 返回 `AuthoringReceipt`；`GET .../commits/:requestId` 返回同一 receipt，尚无成功回执返回 40401，不据此自动生成新 ID。
- **发布切换：** 先部署兼容读者和能力校验，再开放设计器写入／发布；测试环境完整启用验证。生产开启由后续发布授权决定，不增加绕过客户端能力检查的参数。

## Task 1：来源基线、schema 3 合同与纯内容校验

**Files:** 新增 `server/src/common/question-content-v3.ts`、`server/src/common/question-authoring.ts`、`server/src/modules/questions/question-content-v3.ts`、`server/src/modules/questions/question-content-dispatch.ts`；新增 `server/test/question-content-v3.spec.ts`；新增 `tests/fixtures/question-authoring-v3/{rich-authoring,rich-content,student-content,legacy-short-ids,unsafe-content}.json`；新增 `review/main-designers-source-manifest-2026-10-23.json` 和 `review/main-designers-content-contract-2026-10-23.md`。

**Interfaces:** 产出 `parseRichDocV3(input:unknown):ReadonlyRichDocV3`、`parseQuestionContent(input:unknown):CanonicalQuestionContent`、`projectStudentContent(content:CanonicalQuestionContent):StudentQuestionContent`、`collectContentAssetIds(content:CanonicalQuestionContent):string[]`。`CanonicalQuestionContent` 固定为 `{schema:2|3,stem,options:[{id,content}],analysis,answer_option_ids}`，2/3 用判别联合；复用现有 schema 1/2 适配，不更改 `readonlyDoc` 的旧语义。在 `common/question-authoring.ts` 定义收窄后的 `QuestionAuthoringDocument` 及上文 bundle/receipt/token/layout 类型，不依赖未迁入的旧分支类型或服务。

- [ ] **1. 固定实施输入。** 在执行时使用 using-git-worktrees 从最新 main 建独立集成 worktree；记录 main/source HEAD、dirty 清单和依赖文件 SHA-256。只纳入设计器实际 import 闭包、必要后端和许可证，排除 cache、凭据、旧阅卷与 AI 任务平台。记录相同视口的来源截图、测试题和工具栏命令清单；原工作区只读。先在新worktree用 `npm ci --prefix server`、`npm ci --prefix web`、`npm ci --prefix mobile` 安装当前锁定依赖，再采集影响路径的基线测试结果；已有失败单独标注。T5引入新依赖后再更新其锁文件，不为执行旧基线升级包。
- [ ] **2. 写失败测试。** `question-content-v3.spec.ts` 验证合并单元格/多层列表/图文/格式完整输出；`A/B` 选项 ID 原样；`projectStudentContent` 只返回题干和选项；递归注入 checked/analysis/src/onerror/未知 attrs 必须拒绝。schema 2 遇 marks 仍失败。

  ```ts
  expect(parseQuestionContent(legacyShortIds).options.map(o => o.id)).toEqual(['A', 'B']);
  expect(projectStudentContent(parseQuestionContent(richContent))).toEqual(studentContent);
  expect(() => parseRichDocV3(unsafeContent)).toThrow();
  ```
- [ ] **3. 验证失败。** `npm --prefix server test -- test/question-content-v3.spec.ts`；预期新函数缺失或明确断言失败，不能把依赖、数据库或环境异常当作有效红灯。
- [ ] **4. 实现纯 codec 和合同。** 受控节点覆盖设计 §6.2；复用来源的表格占位校验。字体沿用 SimSun/SimHei/Microsoft YaHei/FangSong/KaiTi，字号 9–36 整数 pt，标题 1–4，缩进 0–10，行距 1/1.2/1.5/1.75/2/2.5/3；颜色只接受来源已验证的 hex/rgb 并规范化。作者文档上限 2 MiB/20,000 节点/深度32/100题；单个考试富文上限2,000节点/100,000文本字符/深度16，表格展开网格上限10,000格。表格越界、重叠和冲突列宽拒绝。普通控件转换静态安全内容，链接保留作者原稿但考试输出无 href 的可见文本；清单逐项声明其语义。未知节点定位报错，不静默打平。布局清单记录源字段、默认值和单位，不引入医疗示例数据。
- [ ] **5. 验证并提交。** 重跑同一测试，预期全部 PASS；检查 fixtures 无身份/密钥，记录 codec 与源工具栏覆盖表。仅暂存本任务 Files 中实际文件，提交 `feat(内容): 增加版本化富文本与稳定选项合同`。

## Task 2：作者原稿、试卷布局与回执存储

**Files:** 新增 `database/migrations/022_question_designer_storage.sql`、`server/src/entities/question-authoring-commit.entity.ts`、`tests/question-designer-migration.test.mjs`；修改 `database/init.sql`、`server/src/entities/question-version.entity.ts`、`server/src/entities/exam-paper.entity.ts`、`server/src/modules/exams/paper.dto.ts`、`server/src/modules/ai/paper.service.ts`、迁移 catalog/contract 测试和 `docs/design/03-数据库设计.md`。序号被占用时统一顺延并更新计划引用，不重写已存在迁移。

**Interfaces:** `QuestionVersion.authoringSchemaVersion:number|null`／`authoringJson:AuthoringBundle|null`；`ExamPaper.designerLayout:DesignerLayoutV1|null`；`QuestionAuthoringCommit` 保存 owner/request/contentHash/resultJson/createdAt，唯一键 `(owner_id,request_id)`；`PaperService.createTraining/updateTraining/trainingDetail` 接收／返回 `designer_layout`。

- [ ] **1. 写失败升级测试。** 仿 `training-question-bank-migration.test.mjs` 使用 `createEphemeralServices` 和临时库，加载执行基线提交的 init，放入 medium、已发布快照、历史答案；断言新增结构不改原行、`--check` 不写、重复 apply 无变化、断点续跑和同名错结构被拒绝，新装与升级终态一致。
- [ ] **2. 验证失败。** `node --test --test-concurrency=1 --test-timeout=120000 tests/question-designer-migration.test.mjs`；预期缺新列/表。不得换成开发 MySQL 跑该测试。
- [ ] **3. 实现追加迁移、实体和布局 DTO。** 作者原稿列仅加在版本表；布局可空，旧卷读取采用默认布局但不回填。新回执不设短期自动过期造成重复建题窗口。校验布局白名单，主表不双写作者 JSON。注册增量交由根代理合入 app.module。
- [ ] **4. 验证新装与升级。** 执行上一步测试及 `node --test --test-concurrency=1 --test-timeout=120000 tests/migration-catalog.test.mjs tests/migration-contract.test.mjs`，再 `npm --prefix server run build`；预期 exit 0，历史数据摘要一致。
- [ ] **5. 提交。** 核对 migration/init/entity/03 册一致，只暂存 Files 内实际变化，提交 `feat(存储): 保存设计器原稿布局和提交回执`。

## Task 3：作者原稿装配与幂等批量保存

**Files:** 新增 `server/src/modules/questions/question-authoring.controller.ts`、`question-authoring.dto.ts`、`question-authoring.service.ts`、`question-authoring-codec.ts`、`question-authoring-media.ts`；修改 `question-version.service.ts`、`question-validator.ts`、`question.dto.ts`、`app.module.ts`；新增 `server/test/question-authoring-service.spec.ts`、`question-authoring-idempotency.spec.ts`、`question-authoring-media.spec.ts`。来源 codec 选择性迁入到新文件，不能注册 image/rubric/AI manifest/template CRUD。

**Interfaces:** `QuestionAuthoringService.assemble(versionIds:string[],actorId:string):Promise<AuthoringBundle>`、`commit(input:AuthoringCommitRequest,actorId:string):Promise<AuthoringReceipt>`、`getCommit(requestId:string,actorId:string):Promise<AuthoringReceipt>`。在现有 `QuestionVersionService` 内提取 `writeAuthoringInTransaction(manager:EntityManager,input:AuthoringQuestionWrite,actorId:string):Promise<AuthoringSavedItem>`；`AuthoringQuestionWrite` 包含单题 bundle、可选 identity 和规范化 schema3 内容，不能接收任意 source/status/approved_by。

- [ ] **1. 写失败测试。** 单题旧版本装配、短 ID 往返、人工新题 approved／既有题修订 pending、expected_version_id 冲突零写、真实来源保持；批次第二题失败第一题也回滚；同 owner+request 同内容回原回执、不同内容拒绝、跨 owner 不可读；模拟事务成功后响应丢失，查询回执取得本次 saved_version_id。媒体测试覆盖解析图不能被当题干授权；实际 HTTP 测试覆盖整个 commit 请求接近／超过现有 2 MiB JSON body 上限，前端按包含外层身份映射的完整序列化大小预检并保留失败草稿，不为作者端放宽全站上限。
- [ ] **2. 验证失败。** `npm --prefix server test -- test/question-authoring-service.spec.ts test/question-authoring-idempotency.spec.ts test/question-authoring-media.spec.ts`；预期缺服务或上述明确断言失败。
- [ ] **3. 实现 codec 与版本写入。** 沿用 main `versionEntity/applyCompatibility/createMany/revise` 的真实规则，提取可共享事务函数而非在一个事务中调用另一个自开事务方法。所有涉及 identity 按稳定顺序加锁；保存规范化内容、单题原稿、媒体绑定与回执同事务提交。旧输入仍走兼容适配，新版本显式记录 schema。仅缺作者原稿时从已知旧内容构造原稿，不伪造历史格式。
- [ ] **4. 实现 HTTP 与验证。** 接入统一信封、DtoValidationPipe、现有 questions 权限；query 参数不泄露其他 owner 回执。执行本任务测试与 `test/question-bank.spec.ts test/media-policy.spec.ts`，预期全部 PASS；版本冲突、无权限与来源伪造都由服务端拒绝。
- [ ] **5. 提交。** 记录公开接口与回执样例（脱敏），只暂存本任务实际文件，提交 `feat(题库): 接入设计器原稿与幂等保存`。

## Task 4：schema 3 发布、考试安全投影与能力协商

**Files:** 修改 `server/src/common/training-contracts.ts`、`server/src/modules/exams/paper-release.service.ts`、`attempt.service.ts`、`attempt-reader.service.ts`、`submission.service.ts`、`training-exams.controller.ts`、`exam-history.service.ts`；新增 `server/src/modules/exams/question-content-capability.ts`、`server/test/question-content-capability.spec.ts`、`question-rich-exam.spec.ts`；扩展 `paper-release.spec.ts`、`exam-mobile-contract.spec.ts`、`answer-draft.spec.ts`。

**Interfaces:** `readContentCapability(header:unknown):2|3`、`assertContentCapability(required:2|3,available:2|3):void`；`AttemptService.start` 及返回题面的 reader 接收 `contentVersion:2|3`，controller 统一解析一次。冻结 snapshot 保留 schema/contentJson，媒体和评分读取 T1 的 `CanonicalQuestionContent`。

- [ ] **1. 写失败测试。** schema3 发布后改题不改变 release/record 内容；任意层级答案和管理字段不下发；图权限从实际安全内容收集。无 header 开新schema3卷时 assignment/record数量及attempt_no都不变；已有schema2 active可恢复，已有schema3 active旧端报升级且deadline不变。终态只读查询正常；新端结果/错题显示schema3。
- [ ] **2. 验证失败。** `npm --prefix server test -- test/question-content-capability.spec.ts test/question-rich-exam.spec.ts`；预期版本3被旧链拒绝或能力检查断言失败。
- [ ] **3. 实现兼容分派与检查。** 能力检查在首次开考写入前、针对实际将使用的冻结题单／候选池完成；随机卷按当前学员来源所用题池计算，不因为另一来源题池含3而误拦。恢复按当前记录快照判断。发布不提前下发作者原稿，读状态到期仍先执行纯timeout。CORS 仅在显式 header 白名单存在时补允许新header，不扩大凭据规则。
- [ ] **4. 验证评分与媒体。** 执行本任务测试及 `npm --prefix server test -- test/paper-release.spec.ts test/exam-mobile-contract.spec.ts test/answer-draft.spec.ts test/media-ticket.spec.ts`；预期稳定ID评分、空答案、主动提交并发、纯timeout和旧快照均通过，不增加自动提交入口。
- [ ] **5. 提交。** 同步冻结契约新增版本部分，明确 schema2 禁令原样保留，提交 `feat(考试): 支持受控富文本快照与客户端能力协商`。

## Task 5：完整迁入 PC 内核、布局状态与共享 API

**Files:** 从固定来源迁入 `web/src/components/Tiptap/` 实际引用闭包、`web/src/components/question-designers/`；来源 `QuestionEditor.vue` 落为 `question-designers/QuestionDocumentEditor.vue`；新增/适配 `web/src/api/question-document-types.ts`、`question-authoring.ts`、`web/src/composables/useAuthoringOptions.ts`、`web/src/components/question-designers/__tests__/main-contract-adapter.spec.ts`；修改 `web/src/api/training-types.ts`、`web/src/composables/useUnsavedChanges.ts`、`package.json`、`package-lock.json`、`vite.config.ts`；新增 `web/vitest.config.ts`、`web/src/test/setup.ts`。来源全局样式只迁必需增量并收敛到设计器作用域。共享离开guard由T5适配，T8/T9消费，避免并发改同一文件。

**Interfaces:** 保留来源两个组件的 `modelValue/saveDraft/dirty-change/close` 契约；`questionAuthoringApi.assemble/commit/getCommit` 严格对应统一 HTTP 合同。新增 `toAuthoringBundle(value:QuestionAuthoringDocument,session:DesignerSession):AuthoringBundle`、`applyAuthoringReceipt(value:DesignerState,receipt:AuthoringReceipt):DesignerState`，adapter 状态保留本地 ID→稳定 ID 映射；布局进入受控状态和 dirty 比较。

共享guard保留来源 `useUnsavedChanges(dirty, {canDiscard,onDiscard,onBlocked,routeKey})` 接口及 `confirmDiscard` 返回方法。保存结果未知时 `canDiscard` 返回false；浏览器beforeunload仅提示，不承诺强制阻止关页。既有页面未传options仍兼容。

- [ ] **1. 写失败组件测试。** 用来源三栏／两栏组件测试加 main fixture：ID `A/B` 重排和返回回执不变；同一主实例100题；类型切换、未保存关闭、只读快捷键、上传失败原位重试；改模板边距产生dirty，保存回执后重开恢复。接口mock只允许新确定端点，旧AI任务／模板CRUD调用视为失败。
- [ ] **2. 建立测试运行条件并验证失败。** 按来源锁定版本接入 Tiptap3.32.0、VueUse、DnD、图标及实际依赖，补 Vitest2.1.9/jsdom26.1.0/@vue/test-utils2.4.6、SVG插件与setup。运行 `npm --prefix web test -- src/components/question-designers/__tests__/main-contract-adapter.spec.ts`；须取得接口/状态断言失败，不能把“无test脚本”当红灯。
- [ ] **3. 迁入组件并适配。** 保留来源视觉与DOM结构、图标及许可证；清除运行时旧worktree/Downloads依赖。作者option_id仍可用来源本地ID，通过映射保留main稳定ID。完整页纸设置保存到布局字段，不再只是ref临时状态。来源非本期控件不可因懒加载/菜单路径重新出现；实际开放工具栏逐项对齐T1清单。
- [ ] **4. 验证内核。** `npm --prefix web test`；`cd web && ./node_modules/.bin/vue-tsc --noEmit`；`cd web && ./node_modules/.bin/vite build --outDir ../outputs/designer-web-build`。均须exit0。这里只写独立构建输出，不原子发布共享dist；旧录题页仍可构建使用。
- [ ] **5. 提交。** 新增文件逐路径/明确目录暂存，排除node_modules与outputs，提交 `feat(设计器): 迁入完整PC编辑组件并适配main合同`。

## Task 6：mobile 独立富文渲染与升级提示

**Files:** 修改 `mobile/src/types/content.ts`、`mobile/src/components/rich-content/ReadonlyRichContent.vue`、`mobile/src/api/exams.ts`、`mobile/src/types/exam.ts`，以及 `mobile/src/components/exam/QuestionView.vue`、`OptionCard.vue`、`LiveExamReview.vue`、`LiveWrongBook.vue` 的内容版本传递；静态fixture消费者 `StaticExamReview.vue`、`StaticWrongBook.vue` 继续明确使用schema2。新增 `mobile/src/components/rich-content/RichNode.vue`、`mobile/src/types/content-v3.ts`、`mobile/test/rich-content-v3.spec.ts`、`mobile/test/exam-content-capability.spec.ts`、`mobile/e2e/rich-content-v3.spec.ts`；复用 `mobile/src/api/client.ts` 的headers参数，不替换transport或登录流程。

**Interfaces:** `validateRichDocV3(value:unknown):ReadonlyRichDocV3`、`renderableRichNodes(doc:ReadonlyRichDocV3):RenderableRichNode[]`；`ReadonlyRichContent` 新增 `schemaVersion?:2|3` 输入，默认2；`startExam/getAttempt/getExamResult/getWrongQuestions` 用同一内容能力header常量，按响应marker分派校验。

- [ ] **1. 写失败测试。** T1同一合法/非法fixture在mobile得到相同接受/拒绝结果；表格网格、图片占位/重试、列表编号、上下标和字体回退可见；升级错误不自动重试start、不清已有草稿、不重置计时。新增浏览器fixture覆盖窄屏表格横向滚动。
- [ ] **2. 验证失败。** `npm --prefix mobile run test:unit -- test/rich-content-v3.spec.ts test/exam-content-capability.spec.ts`；预期新内容不支持或缺能力头。
- [ ] **3. 实现只读递归渲染。** 使用明确uni节点/CSS映射，不 `v-html`、不执行作者控件、不引入Tiptap；各字段只用经过校验的属性。题干、选项、结果解析和错题共用组件。图片继续使用当前media票据/asset map。具体渲染需兼容H5和现有MP-WEIXIN目标，不复制修改用户当前dirty错题布局。
- [ ] **4. 验证。** 重跑定向单测；`npm --prefix mobile run type-check`；`PLAYWRIGHT_CHANNEL=chrome npm --prefix mobile run test:e2e -- rich-content-v3.spec.ts --workers=1`；必要的MP编译检查用 `node scripts/build.mjs mp-weixin`。标记浏览器结果不等于开发者工具/真机验收。
- [ ] **5. 提交。** 仅本任务路径，提交 `feat(学员端): 渲染版本化题面并声明内容能力`。

## Task 7：集中两档难度与历史兼容贯通

**Files:** 新增 `server/src/common/question-difficulty.ts`、`server/src/modules/questions/question-authoring-options.controller.ts`、`server/test/question-difficulty.spec.ts`、`server/test/question-difficulty-compatibility.spec.ts`；修改 `server/src/modules/questions/` 下 `question.dto.ts`、`question-validator.ts`、`question-version.service.ts`、`question-import-format.ts`、`question-import.service.ts`、`ai-question-import.service.ts`，以及 `server/src/modules/ai/question-generation.service.ts`、`server/src/modules/exams/paper-release.service.ts`、`server/src/modules/ai/paper.service.ts` 的新选题入口。web修改 `QuestionImport.vue`、`TrainingStatistics.vue` 中相关选项，不改历史筛选语义；Questions/Papers标签由T8/T9接入。

**Interfaces:** `difficultyCatalog():readonly DifficultyOption[]`、`activeDifficulties():('easy'|'hard')[]`、`assertActiveDifficulty(value:unknown):asserts value is ActiveDifficulty`、`difficultyForSource(source):ActiveDifficulty`；`GET /admin/questions/authoring-options` 返回 `{difficulties:[{code,label,enabled,sort}]}`，新建控件只取enabled，历史筛选可展示全目录。

- [ ] **1. 写失败测试。** `activeDifficulties()`严格等于`['easy','hard']`；HTTP录题/修订/AI/导入/新发布拒绝medium且不回写旧行；旧medium列表、历史发布及统计仍可读，既有assignment不重抽。固定卷新增题单拒绝medium但GET旧草稿保留它；无题可抽明确报缺题，不降档。模拟未来配置启用medium时校验与目录一致，但不在当前生产配置启用。
- [ ] **2. 验证失败。** `npm --prefix server test -- test/question-difficulty.spec.ts test/question-difficulty-compatibility.spec.ts`；预期旧三档新写入口断言失败。
- [ ] **3. 实现集中策略。** 服务端各入口调用同一policy；来源映射保持institution→easy/external→hard。修订版本及新增候选采用启用集合，历史快照读取不调用新题池过滤。AI生成请求值由服务端固定。main同类别同题型考点规则原样保留。
- [ ] **4. 验证并盘点。** 重跑定向测试和相关题库/导入/发布测试。在隔离fixture库运行只读影响查询，按题目、草稿、release列出medium/未知引用；若后续有运行期授权连接实际业务库，只执行同样SELECT并记录真实数量，当前不得推定为空或迁移改值。验证web历史标签仍显示中级。
- [ ] **5. 提交。** 更新对应设计01/04/05/06中的启用与历史区别，提交 `feat(难度): 统一两档配置并保留历史兼容`。

## Task 8：main 人工录题、修订与来源入口接入

**Files:** 新增/适配 `web/src/views/admin/QuestionDesigner.vue`、`web/src/composables/question-designer.ts`、`single-question-designer.ts`；修改 `web/src/views/admin/Questions.vue`、`web/src/router/index.ts`、必要的旧 `QuestionPreview.vue`；新增 `web/src/components/question-designers/__tests__/question-host-main.spec.ts`，扩展 `web/tests/question-bank-ui.test.mjs`。旧编辑器其他消费者逐一适配或保留明确legacy入口，不无条件删文件。

**Interfaces:** `createSingleQuestionHost({api,questionId?,categoryId?})` 产出 `load():Promise<DesignerState>`、`saveDraft(value,context):Promise<SaveOutcome<DesignerState>>`、`close():void`；内部使用T5 facade和T3 receipt，组件继续接收来源既有saveDraft形状。

- [ ] **1. 写失败宿主测试。** 人工新增→保存留在编辑器→保存并新增清空；失败原稿不丢；已有题修订pending及saved_version_id串联；medium载入显示待分类但不自动改值；题型切换时同名不同类型考点不能误绑定；人工题无法通过来源控件伪造AI来源。
- [ ] **2. 验证失败。** `npm --prefix web test -- src/components/question-designers/__tests__/question-host-main.spec.ts`；预期旧弹窗/缺host断言失败。
- [ ] **3. 接入 main 入口。** 以现有Questions页面为底修改入口，不覆盖资料上传、AI参考题入口、列表样式或权限；新增路由兼容来源`/admin/questions/editor`。legacy/schema2装配进完整设计器；已发布历史预览继续冻结读。只迁入当前main需要的来源query参数，不请求旧generation task平台。
- [ ] **4. 验证。** 重跑宿主测试、`node --test web/tests/question-bank-ui.test.mjs` 与web类型检查；测试成功后在隔离PC环境实际创建、修订、上传题图、保存重开并检查版本/审批状态，记录浏览器证据，不访问开发库造数据。
- [ ] **5. 提交。** scoped提交 `feat(题库): 在main接入完整试题设计器`。

## Task 9：main 固定试卷设计器与分步保存

**Files:** 适配 `web/src/composables/paper-designer-host.ts`、`paper-designer-controller.ts`、`web/src/components/question-designers/paper-designer-state.ts`；修改 `web/src/views/admin/Papers.vue`、`PaperDetail.vue`；新增 `web/src/components/question-designers/__tests__/paper-host-main.spec.ts`、`paper-save-recovery.spec.ts`，扩展 `web/tests/paper-management-state.test.mjs`。不覆盖随机卷或legacy详情链路。

**Interfaces:** `createPaperDesignerHost({api,paperId,access})` 产出 `load():Promise<PaperDesignerValue>`、`questionLibrarySource`、`paperLibrarySource`、`saveDraft(value,context):Promise<SaveOutcome<PaperDesignerValue>>`、`dispose():void`。保存状态严格分 `unsubmitted → question_receipt_known → config_saved → questions_saved`，`request_id`稳定；bound无变化不调用commit。

- [ ] **1. 写失败测试。** 新建fixed只POST一次并query自动开设计器；random不进入。新题入库、复用题无新增、修改副本不动原题、改回基线复用、仅拖序无新题。追加冲突整次不变；已有medium草稿保留且提示。断网位置覆盖commit响应丢失、配置成功题单失败、重试、放弃后再保存、关闭/切标签时未知回执不被丢弃。
- [ ] **2. 验证失败。** `npm --prefix web test -- src/components/question-designers/__tests__/paper-host-main.spec.ts src/components/question-designers/__tests__/paper-save-recovery.spec.ts`；预期旧详情/保存编排缺失。
- [ ] **3. 实现来源host适配。** 库分页依旧main接口；完整内容走assemble。保持同类别、当前approved版本、考点/总分约束。题目先commit并保存receipt，再更新main配置/布局及固定题单；receipt未知只GET查询/原ID重试，不换ID。布局、bindings、最终指纹和临时身份变化正确区分；只有全步骤确认才清dirty。
- [ ] **4. 验证。** 重跑本任务测试与 `node --test web/tests/paper-management-state.test.mjs`，再类型检查。实际PC操作完整三栏设计器、试题库/试卷库、追加/替换、100题、格式与模板设置保存重开；保存后仍留设计器，关闭后进入草稿详情并可发布。
- [ ] **5. 提交。** scoped提交 `feat(试卷): 接入完整试卷设计器与可靠保存`。

## Task 10：隔离全链、界面对照与文档收口

**Files:** 新增 `tests/main-question-designers.mjs`、`tests/main-question-designers-compatibility.mjs`、`review/main-question-designers-acceptance-2026-10-23.md`；修改 `tests/run-e2e.mjs`、`tests/suite-selection.test.mjs`、`docs/design/01-需求分析.md` 至 `07-安全与非功能.md` 中本期实际改动段落、`docs/design/README.md`、`review/2026-10-22-learner-mobile-contract-freezes.md`、本计划勾选状态。GUI截图写已忽略目录，不入库。

**Interfaces:** 注册两个 suite key `main-question-designers`、`main-question-designers-compatibility`，沿用 `createTrainingHarness` 的suite导出形状和自有ephemeral生命周期。合同报告与验收报告引用实际候选commit/文件哈希、执行命令和结果，不把旧source报告当现行证据。

- [ ] **1. 写隔离全链断言。** 两类设计器保存→重开→固定卷发布→mobile开始→题图→乱序稳定ID交卷→结果/错题；schema3全格式fixture；旧schema1/2和medium已发布历史；401/无权/恶意节点/旧客户端；事务失败与回执恢复。首次运行应能定位尚未整合的接线失败，已通过的独立逻辑不重复制造红灯。
- [ ] **2. 接通并验证两个suite。** `node tests/run-e2e.mjs --ephemeral --suite main-question-designers` 和 `node tests/run-e2e.mjs --ephemeral --suite main-question-designers-compatibility`。两者使用Mock AI及测试模块实名override，不开启运行时test-pass，不触发真实供应商。
- [ ] **3. 完成集成候选检查。** `npm --prefix server test`、`npm --prefix web test`、web `vue-tsc --noEmit`、`node --test web/tests/*.test.mjs`、`npm --prefix mobile run test:unit`、`npm --prefix mobile run type-check`；隔离worktree内执行 `node scripts/build.mjs web h5` 和必要的mp-weixin构建。对最终候选运行一次 `node tests/run-e2e.mjs --ephemeral --suite all`；无新改动或新失败不重复全量。
- [ ] **4. 完成可见验收与独立审查。** 用相同题目/视口对照冻结来源截图；实际操作两个设计器和H5题面、失败重试及提交结果。保持桌面浏览器、原生IME/文件选择器、开发者工具/真机、真实供应商分栏，未跑项明确未验。独立reviewer审查固定候选及保存/投影/迁移关键合同，实质问题修复后只补受影响验证。
- [ ] **5. 同步和交付。** 把真正实现的schema3、安全边界、两档目录、历史行为、API字段和migration写回现行文档；记录全部测试结果与残留边界。scoped提交 `test(设计器): 完成main集成验收与文档同步`。交付集成分支、提交清单、证据和待发布步骤；不自动合并main、推送或部署。

## 计划自检与交付条件

| Spec 范围 | 负责的任务 |
|---|---|
| §1–4 来源、完整界面、入口和保存交互 | T1、T5、T8、T9、T10 |
| §5 两档、扩展、medium和历史兼容 | T7，T8/T9宿主提示，T10整链 |
| §6 原稿、schema3、稳定ID、布局 | T1、T2、T3、T5、T6 |
| §7 版本、另存副本、幂等回执 | T3、T8、T9 |
| §8 来源、权限、受控媒体 | T3、T4、T8、T10 |
| §9 迁移、旧客户端、发布顺序 | T2、T4、T6、T10 |
| §10 PC/H5实际操作与证据等级 | T8、T9、T10 |

主代理在计划交付前逐项核对以上覆盖、跨任务接口名称、Five Review Focus对应测试、并发文件owner及命令可执行条件。本节是计划自检，不代替实施验收；本计划所有任务初始均为未完成。

执行方式沿用项目的主代理整合与独立任务并行，不再为已明确的常规路由重复提问。用户确认开始实施后才创建执行worktree、安装依赖、运行测试及改业务代码；本轮写计划不意味着这些步骤已经授权执行。
