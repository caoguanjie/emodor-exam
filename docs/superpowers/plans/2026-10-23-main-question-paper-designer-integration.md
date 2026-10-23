# main 完整 PaperDesigner 定向集成 Implementation Plan

> **执行方式：** 使用 Astra 依赖队列；根智能体负责接口裁决、共享文件整合、验证和统一提交，独立任务由配置角色并行执行。用户已明确要求在当前项目 `/Users/caogj/Documents/emodor/RuleExam` 直接执行，不切换或新建 worktree；这覆盖旧计划中的 worktree 步骤和 Skill 的通用执行建议。本轮只修订计划，不开始业务实施。

**Goal:** 在 main 当前题库和考试链路上完整接入来源分支的 PaperDesigner；新增和编辑题目继续使用现有表单，启用可扩展的简单／困难两档，并保证两条编辑链路的数据保真、试卷保存重开、发布和学员展示一致。

**Architecture:** 保留完整 PaperDesigner 及其真实依赖的 Tiptap、QuestionDocumentEditor、QuestionProperties 与共享工具，新增作者原稿和幂等提交能力，适配 main 的题目版本、媒体授权及稳定选项 ID。现有新增／编辑表单通过无损内容映射继续读写，服务端同步新版本作者原稿。新增内容 schema 3 支撑受控富文本，继续读取旧 schema 1／2；考试提交、判分、纯 timeout 和历史快照沿用 main。先完成合同，再并行实现存储、PC 和移动端，最后接入固定卷入口并验收。

**Tech Stack:** Node.js ≥22、NestJS、TypeORM、MySQL 8.0、Redis；PC Vue 3／Element Plus／来源锁定的 Tiptap 3.32.0；mobile uni-app／Vue 3／Wot UI 2.3.2 独立只读渲染；Vitest、Node test runner、Playwright 与隔离 API harness。

**Spec:** [集成设计](../specs/2026-10-23-main-question-paper-designer-integration-design.md)。`e10dce7197d618eaa56a8ddb6ba404ed9d488f7f` 只是历史设计基线；实施时以同一路径中已按用户最新决定修订的文件为准，必须同时阅读设计与本计划。

## Global Constraints

- main 为基线，只定向移植完整 PaperDesigner 及实际依赖闭包，不整体合并旧工作区或复制整个设计器目录。
- 新增和编辑题目都保留现有表单与交互；不接独立 QuestionDesigner，不新增 `/admin/questions/editor`，不给 AI 导题新增独立编辑器入口。
- 当前难度只启用 `easy`／简单和 `hard`／困难，保留未来扩展能力；历史 `medium` 不自动重分类，不改历史试卷和成绩。
- 本轮保留 main 的同类别、同题型考点约束；不迁入跨题型联合抽样、图片作答、rubric、人工阅卷、监考或旧 AI 任务平台。
- 完整保留来源 PaperDesigner 界面与交互；固定卷使用一个主 Tiptap 实例，最大 100 题；随机卷继续原配置页。
- 普通试卷保存留在 PaperDesigner；试卷修改库中题另存新题，未修改题复用原版本。原题目表单的保存、新增和修订行为沿用 main。
- 现有表单编辑 schema 3 时未改字段保留原始富文结构与格式；已有选项保留稳定 ID。新内容与作者原稿同事务同步，无法保真时返回明确错误并保留草稿，不静默打平、降级或复用陈旧原稿。
- 作者原稿只供管理端；进行中 payload 不含答案、解析、`checked/correct`、管理元数据或任意资源 URL。
- 选项排序不改变已有稳定 ID；新移动端提交继续 `{record_id,answers:[{item_id,option_ids}]}`。
- 旧 schema 1／2 与冻结历史不批量改写；schema 3 使用独立校验路径，不直接放宽旧白名单。
- 媒体只存受控 `asset_id`，签票与读取校验精确业务归属；不把 JWT 放入 URL。
- 迁移当前从 `022` 起追加，执行前复核最新序号；同步 migration/init/entities/设计，不改既有 checksum。
- 不读业务 `.env` 或输出凭据；所有服务凭据运行期注入；数据库验证使用自有 ephemeral 实例。
- 在当前项目执行并保护当前 dirty；来源工作区只读，不自动提交来源分支。无需切换分支或新建 worktree，不 stash/reset、不 `git add .`／`-A`。各 worker 不提交，根智能体仅对核验过的任务文件统一提交；没有另行授权不推送、部署或执行生产迁移。
- Node.js ≥22；先检查并复用现有已安装依赖，不在当前在用目录无差别执行 `npm ci`。确需增加的依赖限定为 T5 的 web 真实依赖，并由其单一 owner 修改 `web/package.json` 和锁文件。
- 本计划各项测试结果目前均为待执行，不沿用旧 Q1—Q13 数量或截图充当 main 集成证据。

## Review Focus

1. **旧题短 ID 与重新排序：** `A/B` 等 main 合法 ID 不能被来源长度校验拒绝或被重新生成；T1、T5、T8 用同一 fixture 验证。
2. **响应丢失与部分保存：** 题目已提交但试卷未保存、用户重试或退出时不重复建题，不错误清除脏状态；T3、T9 覆盖。
3. **合法表格／格式与恶意近似输入：** 合并单元格和格式经过 PaperDesigner、现有表单和原稿重开不丢失；事件、未知 attrs、嵌套答案和外链图片不透传；T1、T3、T4、T6、T8 覆盖。
4. **旧客户端与长时间打开的页面：** schema 3 能力不足在首次开考写入前拦截；已有记录不重抽、不重置 deadline；T4、T6 覆盖。
5. **旧中级题与同名考点：** medium 草稿可读但不能静默删题发布，历史已发布卷继续原规则，切换题型不偷偷建立跨题型考点；T7、T8、T9 覆盖。

---

## 文件责任与来源边界

历史 main 业务基线为 `562b46d`，历史设计提交为 `e10dce7`；来源为 `/Users/caogj/.codex/worktrees/155a/RuleExam`，其历史 HEAD `09ddb1f` 不包含全部设计器未提交内容。执行时在当前项目记录实际 HEAD、分支和 dirty，并对只读来源记录 HEAD、dirty 及候选文件哈希，不把历史值当作当前输入。

| owner | 创建／主要修改范围 | 职责 |
|---|---|---|
| T1 内容合同 | `server/src/common/question-content-v3.ts`、`modules/questions/question-content-v3.ts`、共享 JSON fixtures | 严格内容结构、纯转换、稳定 ID 与安全输出合同 |
| T2 存储 | migration、init、`question-version.entity.ts`、`exam-paper.entity.ts`、回执 entity、paper DTO/service | 作者原稿、布局与回执存储；升级安全 |
| T3 作者服务 | `question-authoring.*`、codec、`question-version.service.ts`、题目 DTO／validator | 装配、锁版本、批量事务、回执、既有表单写入与原稿同步 |
| T4 考试合同 | 发布／attempt reader／controller／submission／错误码 | schema 3 冻结、安全投影、客户端能力检查、媒体读取 |
| T5 PC 内核 | PaperDesigner、Tiptap 实际依赖、QuestionDocumentEditor／QuestionProperties、web 类型/API 与测试配置 | 完整试卷界面、稳定 ID 适配、布局受控、HTTP facade；不迁入独立单题设计器 |
| T6 mobile | 内容类型／只读渲染／exams API／相关测试 | 独立渲染及能力声明，不搬入 PC 编辑器 |
| T7 难度 | 服务端 difficulty policy、现有录题/导题/发布校验、web 选项目录 | 两档启用与旧值兼容 |
| T8 现有题目表单 | Questions、现有 QuestionEditor／QuestionPreview、表单内容 adapter 和已有题目 API | 保留新增／编辑 UI，schema 3 无损映射、稳定 ID 与新版本原稿一致 |
| T9 试卷入口 | Papers、PaperDetail、paper host/controller/state | 创建固定草稿、完整设计器、分步保存收敛 |
| T10 集成 | runner 注册、隔离整链、验收报告、现行设计分册 | 全链验证和证据归档 |

T2→T3→T7 顺序处理 `question-version` 相关共享文件；T2→T7 顺序处理 `paper.service.ts`。T4 完成后 T7 才修改发布难度校验。`app.module.ts` 由根代理集中接入 T2/T3/T7 的注册增量。web 共享类型/API 先由 T5 定稿，T8/T9 通过其接口工作；不得各自复制一套类型。现行设计分册由根代理统一整合各任务提供的修订段落，不让多个 worker 并写。

来源的 `QuestionEditor.vue` 和 main 同名组件职责不同：来源版本仅在 PaperDesigner 实际依赖时于 T5 落为 `question-designers/QuestionDocumentEditor.vue` 并调整 import；QuestionProperties 同理按真实引用迁入。main 现有 `QuestionEditor.vue` 继续服务新增／编辑表单，在 T8 增加数据兼容，不替换为设计器。独立 QuestionDesigner 组件、页面、单题宿主及其独有依赖不进入来源清单。

## 任务依赖与并行

```text
T1 合同与内容 codec
 ├─ T2 存储 ─ T3 作者保存 ─┐
 ├─ T4 考试合同 ──────────┴─ T7 两档贯通
 ├─ T5 PC 内核/API
 └─ T6 mobile 渲染与能力声明

T3 + T5 + T7      → T8 现有表单数据兼容
T2 + T3 + T5 + T7 → T9 试卷宿主
T4 + T6 + T8 + T9 → T10 tester 验收 → reviewer 独立审查 → 根整合提交
```

T1 完成后 T2/T4/T5 可并行，T6 不依赖 PC 实现，按空出的槽位启动；T3 等待 T2，T7 等待 T3/T4，T8/T9 再并行。当前会话并发上限为 4（含根），每次调度动态复核工具限额和全部活动后代；优先 T2/T4/T5，不超额同时启动 T6。各任务先通过自身检查再交接；T10 不用于掩盖此前任务未闭环。

采用 Astra 实际角色而非 default 替代：普通实施用 `worker`，独立测试用 `tester`，独立审查用 `reviewer`；必要的只读发现用 `explorer`、外部文档核验用 `researcher`。本轮已核实的配置为 root/explorer `codex-auto-review/max`、worker `gpt-6.1-sol/xhigh`、tester `codex-auto-review/high`、reviewer `gpt-6-astra/xhigh`、researcher `codex-auto-review/xhigh`。实施前重读 `.codex/config.toml` 与 `.codex/agents/*.toml`，以实际文件为准；`.codex/skills/astra-workflow/SKILL.md` 中 worker/tester 的 `gpt-5.6-sol` 示例已过时，不能覆盖配置。配置事实不冒充运行证明，禁止在会话中更换根模型；若角色实际能力与配置不符，报告差异并由根裁决，不暗中改用 default 或其他模型。

每次派发包含允许文件、输入接口、交付物、检查命令与禁止项；共享文件单一 owner，不自动创建子代理的子代理。根收取实际结果后按依赖解锁后续任务，测试和独立审查均审固定候选。每项末尾的“交接”只提交证据给根，不执行 Git 提交。

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
- **现有表单合同：** 新增／修订继续使用现有题目 API、精确版本锁和权限，不新增页面或独立编辑端点。T8 按原始规范内容和稳定选项 ID 计算字段变化；未改题干、选项、解析保留原始 JSON，不能用预览文本或 `textContent` 重建整题。普通新增可继续 main 当前 schema2 路径；服务端 T3 按实际内容版本校验，已有 schema3 不降级，并在写新版本的同一事务重建／同步单题作者原稿及其中镜像的业务属性；若编辑结果无法无损表达，沿用现有错误信封返回 40001 与具体字段／节点路径，前端显示原因并保留草稿。
- **发布切换：** 先部署兼容读者和能力校验，再开放设计器写入／发布；测试环境完整启用验证。生产开启由后续发布授权决定，不增加绕过客户端能力检查的参数。

## Task 1：来源基线、schema 3 合同与纯内容校验

**Files:** 新增 `server/src/common/question-content-v3.ts`、`server/src/common/question-authoring.ts`、`server/src/modules/questions/question-content-v3.ts`、`server/src/modules/questions/question-content-dispatch.ts`；新增 `server/test/question-content-v3.spec.ts`；新增 `tests/fixtures/question-authoring-v3/{rich-authoring,rich-content,student-content,legacy-short-ids,unsafe-content}.json`；新增 `review/main-designers-source-manifest-2026-10-23.json` 和 `review/main-designers-content-contract-2026-10-23.md`。

**Interfaces:** 产出 `parseRichDocV3(input:unknown):ReadonlyRichDocV3`、`parseQuestionContent(input:unknown):CanonicalQuestionContent`、`projectStudentContent(content:CanonicalQuestionContent):StudentQuestionContent`、`collectContentAssetIds(content:CanonicalQuestionContent):string[]`。`CanonicalQuestionContent` 固定为 `{schema:2|3,stem,options:[{id,content}],analysis,answer_option_ids}`，2/3 用判别联合；复用现有 schema 1/2 适配，不更改 `readonlyDoc` 的旧语义。在 `common/question-authoring.ts` 定义收窄后的 `QuestionAuthoringDocument` 及上文 bundle/receipt/token/layout 类型，不依赖未迁入的旧分支类型或服务。

- [ ] **1. 固定实施输入。** 留在当前项目，不切分支或建 worktree。执行 `git rev-parse HEAD`、`git branch --show-current`、`git status --short`，来源只读执行 `git -C /Users/caogj/.codex/worktrees/155a/RuleExam rev-parse HEAD` 与 `git -C /Users/caogj/.codex/worktrees/155a/RuleExam status --short`。将两端 dirty 和任务候选文件 SHA-256 写入 manifest，先登记当前用户改动和共享文件 owner。只纳入 PaperDesigner 实际 import 闭包、必要后端和许可证，逐文件记录依赖理由；排除独立 QuestionDesigner、单题页面／宿主、cache、凭据、旧阅卷与 AI 任务平台。记录相同视口来源截图、测试题和工具栏命令清单，不自动提交源分支。先执行 `node --version` 及 `npm --prefix server ls --depth=0`、`npm --prefix web ls --depth=0`、`npm --prefix mobile ls --depth=0` 检查并复用已安装依赖，再采集影响路径基线；Node 须≥22，已有失败单列。缺包仅针对缺失项恢复，新增包仅由 T5 修改 web 依赖；不得以基线准备为由无差别 `npm ci` 覆盖正在使用的 node_modules。
- [ ] **2. 写失败测试。** `question-content-v3.spec.ts` 验证合并单元格/多层列表/图文/格式完整输出；`A/B` 选项 ID 原样；`projectStudentContent` 只返回题干和选项；递归注入 checked/analysis/src/onerror/未知 attrs 必须拒绝。schema 2 遇 marks 仍失败。

  ```ts
  expect(parseQuestionContent(legacyShortIds).options.map(o => o.id)).toEqual(['A', 'B']);
  expect(projectStudentContent(parseQuestionContent(richContent))).toEqual(studentContent);
  expect(() => parseRichDocV3(unsafeContent)).toThrow();
  ```
- [ ] **3. 验证失败。** `npm --prefix server test -- test/question-content-v3.spec.ts`；预期新函数缺失或明确断言失败，不能把依赖、数据库或环境异常当作有效红灯。
- [ ] **4. 实现纯 codec 和合同。** 受控节点覆盖设计 §6.2；复用来源的表格占位校验。字体沿用 SimSun/SimHei/Microsoft YaHei/FangSong/KaiTi，字号 9–36 整数 pt，标题 1–4，缩进 0–10，行距 1/1.2/1.5/1.75/2/2.5/3；颜色只接受来源已验证的 hex/rgb 并规范化。作者文档上限 2 MiB/20,000 节点/深度32/100题；单个考试富文上限2,000节点/100,000文本字符/深度16，表格展开网格上限10,000格。表格越界、重叠和冲突列宽拒绝。普通控件转换静态安全内容，链接保留作者原稿但考试输出无 href 的可见文本；清单逐项声明其语义。未知节点定位报错，不静默打平。布局清单记录源字段、默认值和单位，不引入医疗示例数据。
- [ ] **5. 验证并交接。** 重跑同一测试，预期全部 PASS；检查 fixtures 无身份/密钥，记录 codec 与 PaperDesigner 工具栏覆盖表、文件清单和检查结果，交根复核；worker 不提交。

## Task 2：作者原稿、试卷布局与回执存储

**Files:** 新增 `database/migrations/022_question_designer_storage.sql`、`server/src/entities/question-authoring-commit.entity.ts`、`tests/question-designer-migration.test.mjs`；修改 `database/init.sql`、`server/src/entities/question-version.entity.ts`、`server/src/entities/exam-paper.entity.ts`、`server/src/modules/exams/paper.dto.ts`、`server/src/modules/ai/paper.service.ts`、迁移 catalog/contract 测试和 `docs/design/03-数据库设计.md`。序号被占用时统一顺延并更新计划引用，不重写已存在迁移。

**Interfaces:** `QuestionVersion.authoringSchemaVersion:number|null`／`authoringJson:AuthoringBundle|null`；`ExamPaper.designerLayout:DesignerLayoutV1|null`；`QuestionAuthoringCommit` 保存 owner/request/contentHash/resultJson/createdAt，唯一键 `(owner_id,request_id)`；`PaperService.createTraining/updateTraining/trainingDetail` 接收／返回 `designer_layout`。

- [ ] **1. 写失败升级测试。** 仿 `training-question-bank-migration.test.mjs` 使用 `createEphemeralServices` 和临时库，加载执行基线提交的 init，放入 medium、已发布快照、历史答案；断言新增结构不改原行、`--check` 不写、重复 apply 无变化、断点续跑和同名错结构被拒绝，新装与升级终态一致。
- [ ] **2. 验证失败。** `node --test --test-concurrency=1 --test-timeout=120000 tests/question-designer-migration.test.mjs`；预期缺新列/表。不得换成开发 MySQL 跑该测试。
- [ ] **3. 实现追加迁移、实体和布局 DTO。** 作者原稿列仅加在版本表；布局可空，旧卷读取采用默认布局但不回填。新回执不设短期自动过期造成重复建题窗口。校验布局白名单，主表不双写作者 JSON。注册增量交由根代理合入 app.module。
- [ ] **4. 验证新装与升级。** 执行上一步测试及 `node --test --test-concurrency=1 --test-timeout=120000 tests/migration-catalog.test.mjs tests/migration-contract.test.mjs`，再 `npm --prefix server run build`；预期 exit 0，历史数据摘要一致。
- [ ] **5. 交接。** 核对 migration/init/entity/03 册增量一致，提供文件清单、历史摘要与检查结果，由根统一整合设计分册和提交。

## Task 3：作者原稿装配与幂等批量保存

**Files:** 新增 `server/src/modules/questions/question-authoring.controller.ts`、`question-authoring.dto.ts`、`question-authoring.service.ts`、`question-authoring-codec.ts`、`question-authoring-media.ts`；修改 `question-version.service.ts`、`question-validator.ts`、`question.dto.ts`，`app.module.ts` 注册交根整合；新增 `server/test/question-authoring-service.spec.ts`、`question-authoring-idempotency.spec.ts`、`question-authoring-media.spec.ts`、`question-form-authoring-compatibility.spec.ts`。来源 codec 选择性迁入到新文件，不能注册 image/rubric/AI manifest/template CRUD。

**Interfaces:** `QuestionAuthoringService.assemble(versionIds:string[],actorId:string):Promise<AuthoringBundle>`、`commit(input:AuthoringCommitRequest,actorId:string):Promise<AuthoringReceipt>`、`getCommit(requestId:string,actorId:string):Promise<AuthoringReceipt>`。在现有 `QuestionVersionService` 内提取 `writeAuthoringInTransaction(manager:EntityManager,input:AuthoringQuestionWrite,actorId:string):Promise<AuthoringSavedItem>`；`AuthoringQuestionWrite` 包含单题 bundle、可选 identity、`CanonicalQuestionContent` 和复用现有 DTO 类型的 category_id/type/difficulty/score/concept_id，PaperDesigner 完整富文采用 schema3，普通表单保留 main 当前内容路径，可继续 schema2；不能接收任意 source/status/approved_by。codec 产出 `synchronizeFormAuthoring(base:AuthoringBundle|null,input:AuthoringQuestionWrite):AuthoringBundle`，供既有新增／修订 API 的事务复用：以最终内容和业务属性更新受影响题块、正确标记及镜像属性，保留未变节点、稳定 ID 和有效布局，返回与新版本事实一致的单题原稿，无法保真抛出带字段／节点路径的 40001。

- [ ] **1. 写失败测试。** 单题旧版本装配、短 ID 往返、人工新题 approved／既有题修订 pending、expected_version_id 冲突零写、真实来源保持；批次第二题失败第一题也回滚；同 owner+request 同内容回原回执、不同内容拒绝、跨 owner 不可读；模拟事务成功后响应丢失，查询回执取得本次 saved_version_id。兼容测试验证既有表单普通新增继续 main 当前内容路径（含 schema2）；修订已有 schema3 不降级：仅改难度／答案时原始富文不变；修改可表达字段后原稿、考试内容、答案映射一致，PaperDesigner 装配取得新内容；无法保真时内容／原稿／媒体绑定全部零写；旧 schema1/2 和已发布快照不变。媒体测试覆盖解析图不能被当题干授权；实际 HTTP 测试覆盖整个 commit 请求接近／超过现有 2 MiB JSON body 上限，前端按包含外层身份映射的完整序列化大小预检并保留失败草稿，不为作者端放宽全站上限。
- [ ] **2. 验证失败。** `npm --prefix server test -- test/question-authoring-service.spec.ts test/question-authoring-idempotency.spec.ts test/question-authoring-media.spec.ts test/question-form-authoring-compatibility.spec.ts`；预期缺服务或上述明确断言失败。
- [ ] **3. 实现 codec 与版本写入。** 沿用 main `versionEntity/applyCompatibility/createMany/revise` 的真实规则，提取可共享事务函数而非在一个事务中调用另一个自开事务方法。所有涉及 identity 按稳定顺序加锁；保存规范化内容、单题原稿、媒体绑定与回执同事务提交。既有表单 create/revise 复用该写入及原稿同步，不要求前端改用 QuestionDesigner 或 commit 端点。旧输入仍走兼容适配，新版本显式记录 schema。仅缺作者原稿时从已知旧内容构造原稿，不伪造历史格式；已有原稿必须与本次内容同步，不能照抄旧 authoring_json 或把富文转成纯文本重建。
- [ ] **4. 实现 HTTP 与验证。** 接入统一信封、DtoValidationPipe、现有 questions 权限；query 参数不泄露其他 owner 回执。执行本任务测试与 `test/question-bank.spec.ts test/media-policy.spec.ts`，预期全部 PASS；版本冲突、无权限与来源伪造都由服务端拒绝。
- [ ] **5. 交接。** 记录公开接口、表单原稿同步规则与回执样例（脱敏），连同实际文件及检查结果交根；worker 不提交。

## Task 4：schema 3 发布、考试安全投影与能力协商

**Files:** 修改 `server/src/common/training-contracts.ts`、`server/src/modules/exams/paper-release.service.ts`、`attempt.service.ts`、`attempt-reader.service.ts`、`submission.service.ts`、`training-exams.controller.ts`、`exam-history.service.ts`；新增 `server/src/modules/exams/question-content-capability.ts`、`server/test/question-content-capability.spec.ts`、`question-rich-exam.spec.ts`；扩展 `paper-release.spec.ts`、`exam-mobile-contract.spec.ts`、`answer-draft.spec.ts`。

**Interfaces:** `readContentCapability(header:unknown):2|3`、`assertContentCapability(required:2|3,available:2|3):void`；`AttemptService.start` 及返回题面的 reader 接收 `contentVersion:2|3`，controller 统一解析一次。冻结 snapshot 保留 schema/contentJson，媒体和评分读取 T1 的 `CanonicalQuestionContent`。

- [ ] **1. 写失败测试。** schema3 发布后改题不改变 release/record 内容；任意层级答案和管理字段不下发；图权限从实际安全内容收集。无 header 开新schema3卷时 assignment/record数量及attempt_no都不变；已有schema2 active可恢复，已有schema3 active旧端报升级且deadline不变。终态只读查询正常；新端结果/错题显示schema3。
- [ ] **2. 验证失败。** `npm --prefix server test -- test/question-content-capability.spec.ts test/question-rich-exam.spec.ts`；预期版本3被旧链拒绝或能力检查断言失败。
- [ ] **3. 实现兼容分派与检查。** 能力检查在首次开考写入前、针对实际将使用的冻结题单／候选池完成；随机卷按当前学员来源所用题池计算，不因为另一来源题池含3而误拦。恢复按当前记录快照判断。发布不提前下发作者原稿，读状态到期仍先执行纯timeout。CORS 仅在显式 header 白名单存在时补允许新header，不扩大凭据规则。
- [ ] **4. 验证评分与媒体。** 执行本任务测试及 `npm --prefix server test -- test/paper-release.spec.ts test/exam-mobile-contract.spec.ts test/answer-draft.spec.ts test/media-ticket.spec.ts`；预期稳定ID评分、空答案、主动提交并发、纯timeout和旧快照均通过，不增加自动提交入口。
- [ ] **5. 交接。** 提供冻结契约新增版本段落，明确 schema2 禁令原样保留，将文件与检查结果交根统一整合和提交。

## Task 5：迁入完整 PaperDesigner 的 PC 依赖、布局状态与共享 API

**Files:** 以 T1 manifest 为准逐文件迁入 `web/src/components/question-designers/PaperDesigner.vue`、`QuestionProperties.vue`、`designer-shell.css` 及其实际引用的 composable／state／工具；迁入 `web/src/components/Tiptap/` 真实依赖闭包，来源 `QuestionEditor.vue` 作为共享内核落为 `question-designers/QuestionDocumentEditor.vue`。不整体复制 `question-designers/`，不迁入独立 QuestionDesigner 组件、页面、单题 composable 或其独有测试／依赖。新增/适配 `web/src/api/question-document-types.ts`、`question-authoring.ts`、`web/src/composables/useAuthoringOptions.ts`、`web/src/components/question-designers/__tests__/main-contract-adapter.spec.ts`；修改 `web/src/api/training-types.ts`、`web/src/composables/useUnsavedChanges.ts`、`web/package.json`、`web/package-lock.json`、`web/vite.config.ts`；新增 `web/vitest.config.ts`、`web/src/test/setup.ts`。来源全局样式只迁必需增量并收敛到 PaperDesigner 作用域。共享离开 guard 由 T5 适配，T9 消费；现有表单继续当前离开行为。

**Interfaces:** 保留来源 PaperDesigner 的 `modelValue/saveDraft/dirty-change/close` 契约及其 QuestionDocumentEditor／QuestionProperties 内部合同；`questionAuthoringApi.assemble/commit/getCommit` 严格对应统一 HTTP 合同。新增 `toAuthoringBundle(value:QuestionAuthoringDocument,session:DesignerSession):AuthoringBundle`、`applyAuthoringReceipt(value:DesignerState,receipt:AuthoringReceipt):DesignerState`，adapter 状态保留本地 ID→稳定 ID 映射；布局进入受控状态和 dirty 比较。T8 只复用内容类型和难度目录，继续既有题目 API。

共享guard保留来源 `useUnsavedChanges(dirty, {canDiscard,onDiscard,onBlocked,routeKey})` 接口及 `confirmDiscard` 返回方法。保存结果未知时 `canDiscard` 返回false；浏览器beforeunload仅提示，不承诺强制阻止关页。既有页面未传options仍兼容。

- [ ] **1. 写失败组件测试。** 用来源 PaperDesigner 三栏组件测试加 main fixture：ID `A/B` 重排和返回回执不变；同一主实例100题；类型切换、未保存关闭、只读快捷键、上传失败原位重试；改模板边距产生dirty，保存回执后重开恢复。接口 mock 只允许确定端点，旧 AI 任务／模板 CRUD、独立单题路由或设计器加载视为失败。
- [ ] **2. 建立测试运行条件并验证失败。** 先对照 T1 manifest、来源锁文件与当前 `web/node_modules`，复用已满足的安装。只给 web 补 PaperDesigner 真实需要的 Tiptap3.32.0、VueUse、DnD、图标与 SVG 插件；测试确需且当前缺失时补 Vitest2.1.9/jsdom26.1.0/@vue/test-utils2.4.6 和 setup。逐包记录用途与锁定版本，不安装仅被独立 QuestionDesigner 引用的包；不在 server/mobile 或当前项目执行整体 `npm ci`。`web/vitest.config.ts` 的 `include` 必须覆盖 `src/components/Tiptap/__tests__/**/*.spec.ts`、`src/components/question-designers/__tests__/**/*.spec.ts`、`src/utils/__tests__/**/*.spec.ts`、`src/components/__tests__/**/*.spec.ts` 四类路径，不能照搬来源仅前两类的配置而漏掉 T8。运行 `npm --prefix web test -- src/components/question-designers/__tests__/main-contract-adapter.spec.ts`；须实际收集该文件且取得接口/状态断言失败，不能把“无test脚本”或“No test files found”当红灯，不启用 `passWithNoTests` 掩盖空收集。
- [ ] **3. 迁入组件并适配。** 保留完整 PaperDesigner 的视觉与 DOM 结构、图标及许可证；清除运行时旧 worktree/Downloads 依赖。作者 option_id 仍可用来源本地 ID，通过映射保留 main 稳定 ID。完整页纸设置保存到布局字段，不再只是 ref 临时状态。与 PaperDesigner 共享的 QuestionDocumentEditor／QuestionProperties 保留，独立 QuestionDesigner 不因整目录复制、懒加载、菜单或导题入口重新出现；实际开放工具栏逐项对齐 T1 清单。
- [ ] **4. 验证内核。** `npm --prefix web test`；`cd web && ./node_modules/.bin/vue-tsc --noEmit`；`cd web && ./node_modules/.bin/vite build --outDir ../outputs/designer-web-build`。均须exit0。这里只写独立构建输出，不原子发布共享dist；旧录题页仍可构建使用。
- [ ] **5. 交接。** 交付逐文件来源／依赖理由、锁文件增量和实际检查结果，排除 node_modules 与 outputs；由根复核后统一提交。

## Task 6：mobile 独立富文渲染与升级提示

**Files:** 修改 `mobile/src/types/content.ts`、`mobile/src/components/rich-content/ReadonlyRichContent.vue`、`mobile/src/api/exams.ts`、`mobile/src/types/exam.ts`，以及 `mobile/src/components/exam/QuestionView.vue`、`OptionCard.vue`、`LiveExamReview.vue`、`LiveWrongBook.vue` 的内容版本传递；静态fixture消费者 `StaticExamReview.vue`、`StaticWrongBook.vue` 继续明确使用schema2。新增 `mobile/src/components/rich-content/RichNode.vue`、`mobile/src/types/content-v3.ts`、`mobile/test/rich-content-v3.spec.ts`、`mobile/test/exam-content-capability.spec.ts`、`mobile/e2e/rich-content-v3.spec.ts`；复用 `mobile/src/api/client.ts` 的headers参数，不替换transport或登录流程。

**Interfaces:** `validateRichDocV3(value:unknown):ReadonlyRichDocV3`、`renderableRichNodes(doc:ReadonlyRichDocV3):RenderableRichNode[]`；`ReadonlyRichContent` 新增 `schemaVersion?:2|3` 输入，默认2；`startExam/getAttempt/getExamResult/getWrongQuestions` 用同一内容能力header常量，按响应marker分派校验。

- [ ] **1. 写失败测试。** T1同一合法/非法fixture在mobile得到相同接受/拒绝结果；表格网格、图片占位/重试、列表编号、上下标和字体回退可见；升级错误不自动重试start、不清已有草稿、不重置计时。新增浏览器fixture覆盖窄屏表格横向滚动。
- [ ] **2. 验证失败。** `npm --prefix mobile run test:unit -- test/rich-content-v3.spec.ts test/exam-content-capability.spec.ts`；预期新内容不支持或缺能力头。
- [ ] **3. 实现只读递归渲染。** 使用明确uni节点/CSS映射，不 `v-html`、不执行作者控件、不引入Tiptap；各字段只用经过校验的属性。题干、选项、结果解析和错题共用组件。图片继续使用当前media票据/asset map。具体渲染需兼容H5和现有MP-WEIXIN目标，不复制修改用户当前dirty错题布局。
- [ ] **4. 验证。** 重跑定向单测；`npm --prefix mobile run type-check`；`PLAYWRIGHT_CHANNEL=chrome npm --prefix mobile run test:e2e -- rich-content-v3.spec.ts --workers=1`；必要的MP编译检查用 `node scripts/build.mjs mp-weixin`。标记浏览器结果不等于开发者工具/真机验收。
- [ ] **5. 交接。** 提供本任务实际路径、检查证据与 H5／MP 未验边界，由根统一整合和提交。

## Task 7：集中两档难度与历史兼容贯通

**Files:** 新增 `server/src/common/question-difficulty.ts`、`server/src/modules/questions/question-authoring-options.controller.ts`、`server/test/question-difficulty.spec.ts`、`server/test/question-difficulty-compatibility.spec.ts`；修改 `server/src/modules/questions/` 下 `question.dto.ts`、`question-validator.ts`、`question-version.service.ts`、`question-import-format.ts`、`question-import.service.ts`、`ai-question-import.service.ts`，以及 `server/src/modules/ai/question-generation.service.ts`、`server/src/modules/exams/paper-release.service.ts`、`server/src/modules/ai/paper.service.ts` 的新选题入口。web修改 `QuestionImport.vue`、`TrainingStatistics.vue` 中相关选项，不改历史筛选语义；Questions/Papers标签由T8/T9接入。

**Interfaces:** `difficultyCatalog():readonly DifficultyOption[]`、`activeDifficulties():('easy'|'hard')[]`、`assertActiveDifficulty(value:unknown):asserts value is ActiveDifficulty`、`difficultyForSource(source):ActiveDifficulty`；`GET /admin/questions/authoring-options` 返回 `{difficulties:[{code,label,enabled,sort}]}`，新建控件只取enabled，历史筛选可展示全目录。

- [ ] **1. 写失败测试。** `activeDifficulties()`严格等于`['easy','hard']`；HTTP录题/修订/AI/导入/新发布拒绝medium且不回写旧行；旧medium列表、历史发布及统计仍可读，既有assignment不重抽。固定卷新增题单拒绝medium但GET旧草稿保留它；无题可抽明确报缺题，不降档。模拟未来配置启用medium时校验与目录一致，但不在当前生产配置启用。
- [ ] **2. 验证失败。** `npm --prefix server test -- test/question-difficulty.spec.ts test/question-difficulty-compatibility.spec.ts`；预期旧三档新写入口断言失败。
- [ ] **3. 实现集中策略。** 服务端各入口调用同一policy；来源映射保持institution→easy/external→hard。修订版本及新增候选采用启用集合，历史快照读取不调用新题池过滤。AI生成请求值由服务端固定。main同类别同题型考点规则原样保留。
- [ ] **4. 验证并盘点。** 重跑定向测试和相关题库/导入/发布测试。在隔离fixture库运行只读影响查询，按题目、草稿、release列出medium/未知引用；若后续有运行期授权连接实际业务库，只执行同样SELECT并记录真实数量，当前不得推定为空或迁移改值。验证web历史标签仍显示中级。
- [ ] **5. 交接。** 提供设计01/04/05/06中启用与历史区别的修订段落、文件清单和检查结果，由根统一整合分册和提交。

## Task 8：现有题目表单的数据兼容

**Files:** 修改 `web/src/views/admin/Questions.vue`、`web/src/components/QuestionEditor.vue`、必要的现有 `QuestionPreview.vue` 与已有题目 API 类型；新增 `web/src/utils/question-form-content.ts`、`web/src/utils/__tests__/question-form-content.spec.ts`、`web/src/components/__tests__/question-form-compatibility.spec.ts`，扩展 `web/tests/question-bank-ui.test.mjs`。保留现有表单 DOM、字段、按钮和新增／编辑入口；不新增 QuestionDesigner 页面、单题宿主、路由，不给 QuestionImport／AI 导题加独立设计器入口。

**Interfaces:** `question-form-content.ts` 复用 `web/src/api/training-types.ts` 中现有类型，定义 `QuestionFormValue = Pick<QuestionDraftPayload,'stem'|'options'|'analysis'|'answer'>`、`QuestionFormField = keyof QuestionFormValue`；提供 `toQuestionFormValue(content:CanonicalQuestionContent):QuestionFormValue`、`applyQuestionFormChanges(base:CanonicalQuestionContent,value:QuestionFormValue,changedFields:readonly QuestionFormField[]):CanonicalQuestionContent`。adapter 在表单外留存原始 canonical 内容，按字段和 `options[].key` 稳定身份合并；`answer` 索引按当前选项顺序映射为稳定 ID。未修改字段返回原结构，新增选项首次生成 ID，已有项不因显示序号重建身份。输出继续走 main 既有新增／修订 API 与版本锁，服务端调用 T3 的 `synchronizeFormAuthoring`；预览值不能充当写回来源。

- [ ] **1. 写失败兼容测试。** 新增与编辑仍打开现有表单，不出现 `/admin/questions/editor` 或独立设计器；普通新题经现有 API 保存成功、已有题修订 pending、精确版本冲突保留草稿。用 T1 schema3 全格式和 `A/B` fixture：只改难度／答案后原始题干、选项、解析 JSON 不变；只改一个可表达字段时其余字段及选项格式保留；排序和正确项变更保留已有稳定 ID；表单保存后 PaperDesigner 重开读取同步原稿而非旧内容。无法保真字段给出明确错误、无 HTTP 写入或服务端零写，前端草稿可继续修改。medium 载入提示但不自动改值，同名不同题型考点不能误绑定，人工题不能伪造 AI 来源。
- [ ] **2. 验证失败。** `npm --prefix web test -- src/utils/__tests__/question-form-content.spec.ts src/components/__tests__/question-form-compatibility.spec.ts`；预期缺少无损映射或旧写回会丢格式的明确断言失败，不能以缺页面／缺路由作为失败目标。
- [ ] **3. 增加兼容映射。** 在现有 Questions／QuestionEditor 的数据边界接入 adapter，保留新增和编辑 UI，不改成 QuestionDocumentEditor 或 QuestionDesigner。原 `clone` 会剥离 content_schema_version/content_json，不能让这份展示编辑值替代 schema3 原始快照；保存时依原始 canonical 和实际修改字段合并。普通新增沿用 main 当前内容路径，可继续 schema2；旧 schema1/2 继续兼容读取，已有 schema3 编辑后仍为3，不降级为旧格式。未改富文直接保留原始节点，编辑过的字段只有经过无损转换验证才写回，不能以 textContent／展示 HTML 打平整题。既有题目 API 的内容和原稿同步由 T3 实现，不复制第二套保存服务。保留资料上传、AI 参考题入口、列表、权限和审批行为，AI 导题继续当前预览／修改／入库流程。历史预览继续冻结读。
- [ ] **4. 验证。** 重跑兼容测试、`node --test web/tests/question-bank-ui.test.mjs`、`cd web && ./node_modules/.bin/vue-tsc --noEmit`。测试报告必须明确列出 `question-form-content.spec.ts` 与 `question-form-compatibility.spec.ts`，两文件各自实际执行的测试数均大于 0 且全部通过，不能以空收集或全 skip 作为通过。再由 tester 在 ephemeral PC 环境实际使用现有表单新增、编辑、上传题图、改变富文题元数据／答案，保存后从表单和 PaperDesigner 双向重开，检查格式、稳定 ID、新版本及审批状态；对无法保真输入验证明确错误和无损草稿。记录实际浏览器证据，不访问开发库造数据。
- [ ] **5. 交接。** 交付现有 UI 保留证据、字段映射／拒绝规则、服务端兼容测试关联和实际文件清单，由根统一整合和提交。

## Task 9：main 固定试卷设计器与分步保存

**Files:** 适配 `web/src/composables/paper-designer-host.ts`、`paper-designer-controller.ts`、`web/src/components/question-designers/paper-designer-state.ts`；修改 `web/src/views/admin/Papers.vue`、`PaperDetail.vue`；新增 `web/src/components/question-designers/__tests__/paper-host-main.spec.ts`、`paper-save-recovery.spec.ts`，扩展 `web/tests/paper-management-state.test.mjs`。不覆盖随机卷或legacy详情链路。

**Interfaces:** `createPaperDesignerHost({api,paperId,access})` 产出 `load():Promise<PaperDesignerValue>`、`questionLibrarySource`、`paperLibrarySource`、`saveDraft(value,context):Promise<SaveOutcome<PaperDesignerValue>>`、`dispose():void`。保存状态严格分 `unsubmitted → question_receipt_known → config_saved → questions_saved`，`request_id`稳定；bound无变化不调用commit。

- [ ] **1. 写失败测试。** 新建fixed只POST一次并query自动开设计器；random不进入。新题入库、复用题无新增、修改副本不动原题、改回基线复用、仅拖序无新题。追加冲突整次不变；已有medium草稿保留且提示。断网位置覆盖commit响应丢失、配置成功题单失败、重试、放弃后再保存、关闭/切标签时未知回执不被丢弃。
- [ ] **2. 验证失败。** `npm --prefix web test -- src/components/question-designers/__tests__/paper-host-main.spec.ts src/components/question-designers/__tests__/paper-save-recovery.spec.ts`；预期旧详情/保存编排缺失。
- [ ] **3. 实现来源host适配。** 库分页依旧main接口；完整内容走assemble。保持同类别、当前approved版本、考点/总分约束。题目先commit并保存receipt，再更新main配置/布局及固定题单；receipt未知只GET查询/原ID重试，不换ID。布局、bindings、最终指纹和临时身份变化正确区分；只有全步骤确认才清dirty。
- [ ] **4. 验证。** 重跑本任务测试与 `node --test web/tests/paper-management-state.test.mjs`，再类型检查。实际PC操作完整三栏设计器、试题库/试卷库、追加/替换、100题、格式与模板设置保存重开；保存后仍留设计器，关闭后进入草稿详情并可发布。
- [ ] **5. 交接。** 提供完整 PaperDesigner 操作及保存恢复证据、文件清单和检查结果，由根统一整合和提交。

## Task 10：隔离全链、界面对照与文档收口

**Files:** 新增 `tests/main-question-designers.mjs`、`tests/main-question-designers-compatibility.mjs`、`review/main-question-designers-acceptance-2026-10-23.md`；修改 `tests/run-e2e.mjs`、`tests/suite-selection.test.mjs`、`docs/design/01-需求分析.md` 至 `07-安全与非功能.md` 中本期实际改动段落、`docs/design/README.md`、`review/2026-10-22-learner-mobile-contract-freezes.md`、本计划勾选状态。GUI截图写已忽略目录，不入库。

**Interfaces:** 注册两个 suite key `main-question-designers`、`main-question-designers-compatibility`，沿用 `createTrainingHarness` 的suite导出形状和自有ephemeral生命周期。合同报告与验收报告引用实际候选commit/文件哈希、执行命令和结果，不把旧source报告当现行证据。

- [ ] **1. 写隔离全链断言。** 现有表单普通新增／编辑与完整 PaperDesigner 保存→相互重开→固定卷发布→mobile开始→题图→乱序稳定ID交卷→结果/错题；schema3全格式fixture经表单修改元数据／答案仍保真且作者原稿同步，无法保真输入明确拒绝、无持久化损坏；旧schema1/2普通录题与medium已发布历史；401/无权/恶意节点/旧客户端；事务失败与回执恢复。断言新增／编辑仍为原表单，不增加单题设计器路由或 AI 导题独立编辑入口。首次运行应能定位尚未整合的接线失败，已通过的独立逻辑不重复制造红灯。
- [ ] **2. 接通并验证两个suite。** `node tests/run-e2e.mjs --ephemeral --suite main-question-designers` 和 `node tests/run-e2e.mjs --ephemeral --suite main-question-designers-compatibility`。两者使用Mock AI及测试模块实名override，不开启运行时test-pass，不触发真实供应商。
- [ ] **3. 完成集成候选检查。** 由 tester 对根固定的当前项目候选运行 `npm --prefix server run build`、`npm --prefix server test`、`npm --prefix web test`、`cd web && ./node_modules/.bin/vue-tsc --noEmit`、`node --test web/tests/*.test.mjs`、`npm --prefix mobile run test:unit`、`npm --prefix mobile run type-check`；全量 web 报告须包含 T8 的两个兼容测试文件，且两文件各自实际执行测试数大于 0、全部通过，空收集或全 skip 不通过。仍在当前项目执行 `node scripts/build.mjs web h5` 和必要的 `node scripts/build.mjs mp-weixin`，不创建构建 worktree。数据库操作全部走自有 ephemeral harness。对最终候选运行一次 `node tests/run-e2e.mjs --ephemeral --suite all`；无新改动或新失败不重复全量，已有同输入且覆盖充分的任务证据可复用。
- [ ] **4. 完成可见验收与独立审查。** tester 用相同题目／视口对照来源 PaperDesigner 冻结截图，实际操作完整试卷设计器、原新增／编辑表单、两者之间数据往返、H5题面、失败重试及提交结果；表单只核验现有 UI 保留和数据兼容，不承诺独立 QuestionDesigner。保持桌面浏览器、原生IME/文件选择器、开发者工具/真机、真实供应商分栏，未跑项明确未验。根向独立 reviewer 提供固定候选文件／哈希、基线、设计与计划、实际测试证据，审查保存／投影／迁移、原表单保真与原稿同步关键合同；reviewer 不由实施者或 default 代理代替，实质问题修复后只补受影响验证。
- [ ] **5. 同步和交付。** 根把真正实现的 schema3、安全边界、两档目录、历史行为、表单兼容、API字段和 migration 统一写回现行文档，记录全部测试结果与残留边界。重新核对 `git status --short` 和任务文件 diff，对比 T1 dirty 快照，排除用户并发改动和来源独立 QuestionDesigner 文件；仅以明确路径 `git add <本任务核验过的文件>` 后检查 `git diff --cached`，根按已获授权统一本地提交，worker 不提交且不得 `git add .`／`-A`。交付当前项目分支／候选提交清单、证据和待发布步骤；不切换／新建 worktree，不自动提交源分支、推送、部署或执行业务库迁移。

## 计划自检与交付条件

| Spec 范围 | 负责的任务 |
|---|---|
| §1–4 来源、完整 PaperDesigner、现有表单入口和保存交互 | T1、T5、T8、T9、T10 |
| §5 两档、扩展、medium和历史兼容 | T7，T8/T9宿主提示，T10整链 |
| §6 原稿、schema3、稳定ID、布局、表单无损兼容 | T1、T2、T3、T5、T6、T8 |
| §7 版本、表单原稿同步、另存副本、幂等回执 | T3、T8、T9 |
| §8 来源、权限、受控媒体 | T3、T4、T8、T10 |
| §9 迁移、旧客户端、发布顺序 | T2、T4、T6、T10 |
| §10 PC/H5实际操作与证据等级 | T8、T9、T10 |

主代理在计划交付前逐项核对以上覆盖、跨任务接口名称、Five Review Focus对应测试、并发文件owner及命令可执行条件。本节是计划自检，不代替实施验收；本计划所有任务初始均为未完成。

执行方式为用户指定的 Astra 依赖队列，在当前项目直接实施、保护 dirty、共享文件单 owner、根统一提交。当前新增／编辑表单继续保留，只有固定卷接入完整 PaperDesigner；本计划不授权独立 QuestionDesigner、新单题路由或 AI 导题编辑入口。所有 checkbox 仍待实际实施和证据核验，不把计划修订当作代码、依赖安装、迁移、浏览器或业务验收已完成。
