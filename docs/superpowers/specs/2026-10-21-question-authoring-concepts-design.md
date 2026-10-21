# 题目编辑、考点关联与两档题池补充设计

日期：2026-10-21。

状态：记录本轮已确认的业务方向与设计衔接建议。本文补充[培训机构后台融合升级设计](2026-10-21-training-admin-integration-design.md)，不表示正在实施的 worktree 已实现这些能力；现有实施计划尚未同步本轮调整。本轮只整理文档，不修改业务代码或执行数据库变更。

业务决定来自本轮对话；§4.1—4.6 的源码迁入方式、具体目录、接口和接入顺序是根据实查提出的实施衔接方案，不冒充用户逐项指定。

版本与 API 依据见[2026-10-21 Tiptap 升级调研](../../../review/2026-10-21-tiptap-template-upgrade-research.md)。已完成关键 API 隔离验证，未完成源组件迁入、宿主构建或浏览器验收。

接续实施见[题目设计器集成实施计划](../plans/2026-10-21-question-authoring-integration.md)，包含 Q1—Q13 的前置、文件、契约与验收；进入实施时由 Q1 统一衔接原 A/B/C 任务，本轮未开始执行。

## 1. 已确认的业务规则

- 本期只启用简单 `easy`、困难 `hard` 两档。中等 `medium` 保留未来扩展位置，本期录题、AI 生成、导入和发布不接受它作为新题的有效难度。
- 本机构培训学员 `institution` 从简单题池随机抽取；外来学员 `external` 从困难题池随机抽取。学员来源由管理员维护，服务端决定抽题范围。
- 两个题池是统一题库按难度筛选后的逻辑范围，共用来源、审核、版本和媒体管理，不建立两套题目存储。
- 难度由管理员根据题目内容标定。修改难度字段是重新分类；产生另一道不同难度的题，需要实际编辑或生成新的题干、选项、答案和解析。不承诺按标签即可得到固定通过率。
- 考试允许出现培训原题。培训是否建设固定练习题库暂不纳入本补充设计。
- 一个考点可以关联多道题，包括不同难度和不同题型；考点本身不设置难度，不要求成对准备简单题和困难题。
- 首期每题至多关联一个主考点，关联可空；无考点题可以独立录入和抽取。考点与关联题保持同一培训类别。
- 编辑器左侧保留通用控件、相关题目和模板入口。中间支持在一份文档中连续编排多道题，每道题保持一种题型。
- 右侧按当前选中的题目设置考点、难度、答案摘要和解析。题干及选项在中间同一题目区域编排，解析使用右侧富文本区域。
- 多行文本及富文本编辑统一采用 Tiptap，允许按场景显示或隐藏工具栏；额外通用封装不是接入前提。

## 2. 考点关联设置在哪里

在编辑区选中“问题二”后，右侧显示该题属性；在选项内定位时，仍能明确显示所属题目，并可切换到该选项的控件属性。

```text
当前题目：问题二
------------------------------
题型      单选题
资料来源  制度及出题依据版本
考点      [搜索或选择考点] [+ 新建]
难度      [简单] [困难]
正确答案  B（与中间选项标记同步）
解析      [Tiptap 编辑区域]
```

题库页面另提供“考点管理”入口，维护名称、说明和所属培训类别，查看关联题目及两档数量。编辑器内的搜索、新建与管理入口使用同一份考点数据。界面名称统一为“考点”，可沿用计划中的 `question_concept` 实体名称。

切换选中题目，只改变右侧表单的作用对象，不将修改应用到整份文档。整批题目的默认难度只用于新增及生成；调整已有题的难度使用明确的批量操作。

## 3. 题目、考点和来源的关系

```text
题目
  +-- 资料来源：依据哪份制度及哪个版本
  +-- 考点：具体考查什么知识，可暂不关联
  +-- 难度：简单或困难，决定可进入的题池

同一个考点
  +-- 简单单选题
  +-- 困难单选题
  +-- 简单多选题
  +-- 困难判断题
```

考点关联与原有制度来源关系并存，不用考点替换 `regulation_id`、`version_id`。AI 题继续保存实际出题依据版本；人工及导入题是否需要制度来源沿用原融合设计，不创建虚假制度。

本补充将原设计“同考点必须同题型”调整为“同类别、可跨题型”。原有同卷同考点最多一道的要求继续适用，包括跨题型的全卷去重。固定卷也要检查这一规则。未关联考点的题按自身题目身份去重。

跨题型关联后，发布检查必须联合判断各题型题量能否同时满足，不能仅分别统计每种题型的考点数。例如，某场要求单选和多选各一题，而两个候选题只属于同一个考点，即使每种题型分别都有一道，也不能组成合法试卷。抽题不能因先选走共享考点而误报其他题型缺题；在满足题型配额和考点唯一性的可行组合中抽取，算法细节由后续实施计划确定。

教材、书籍、章节、页码目前没有完整的来源模型。它们是后续来源扩展的候选范围，本轮不把教材管理、自动提取知识点或知识图谱加入实施范围。

## 4. 模板与 AI 生成衔接

一份编辑文档可以容纳多道题，每道题有独立的题目边界、类型、难度和可选考点。拖入的选项控件归属于明确的题目；不依赖“问题一”等可编辑文字判断题目归属。

整份 JSON 用于一次装载和编排，保存时仍须识别各道题，支撑统一题库、随机抽取、按题阅卷和错题集。Tiptap 文档是编辑内容，培训类别、考点与难度是题目业务属性；两者在同一次保存中对应到同一题目版本。

AI 可按指定考点、目标难度和题量生成一批题，整批载入编辑器后逐题修改。考点选择来自本系统已有考点，服务端绑定其标识，不将模型自行生成的标识当作现有考点。多考点生成时，生成任务须保留每题与其生成要求的对应关系。

人工原稿中的正确选项标记可用于生成业务答案字段；答案摘要由同一份内容派生，避免分别编辑造成冲突。AI 生成、文件导入与人工编辑最终进入同一题目版本和审核流程。

下列接入方案基于 `/Users/caogj/Downloads/template-editor-x-main` 的实际源码检查。目录、组件边界和保存链路在本补充中确定；具体索引、DTO 装饰器和节点内部交互实现由实施计划细化，不把现有 `stem/options/answer` 接口视为已经支持完整编辑文档。

### 4.1 接入方式与源码依据

采用**组件源码迁入并适配**。将源工程的 Tiptap 组件及实际引用的资源迁入 RuleExam 的 `web/`，使用 RuleExam 现有 Vue 3、Element Plus、路由、认证、HTTP 客户端和后端。运行时不依赖 Downloads 目录，不单独启动源工程，不使用 iframe，也不整体复制源工程的 FitsAdmin 应用框架。

实际实施位置为当时已集成前置任务的培训改造 worktree，以下目录全部相对于该 worktree 根目录。2026-10-21 核查时集成目录为 `/Users/caogj/.codex/worktrees/16b4/RuleExam`；进入实施前重新确认位置和前置版本，不向旧 main 工作副本直接复制业务代码。

| 已核对的源文件 | 现状与接入处理 |
|---|---|
| `src/components/Tiptap/index.vue` | 已有全屏弹窗、工具栏、左右面板和 DnD Provider；保存按钮仅关闭弹窗，`initData()` 是内部函数。迁入后增加输入、变更、保存和只读接口，移除写死的示例内容。 |
| `components/MenuBtn.vue`、`ContextMenu.vue` | 复用字体、格式、表格及上下文操作；读写状态由外部模式控制。 |
| `components/LeftControlPanel.vue`、`DraggableControl.vue`、`DropControl.vue` | 保留通用控件选择和拖入能力，增加题目及模板入口；原拖拽只会插入新控件，不宣称已经支持整题或选项拖拽排序。 |
| `components/TemplateSetting.vue`、`WidgetSetting.vue` | 保留文档和控件设置；另增加 `QuestionSetting.vue` 管理当前题的业务属性，不把考点、难度塞进字体等通用控件配置。 |
| `extensions/WidgetNodes.ts`、`widget/FieldComponent.vue`、`RadioInput.vue`、`CheckboxInput.vue` | 复用内联控件、NodeView、单选互斥和多选交互；增加明确的题目边界与选项身份。原 `group` 只是控件组，不能直接充当数据库考点。 |
| `type.ts` | `templateContent` 目前声明为 string，但示例是 JSON 对象；改为明确的 JSON 类型。删除张三、李四和固定日期等演示默认值，由真实数据提供元信息。 |
| `utils/commonWidget.ts`、`templateControl.json`、`dataSource*.json` | 保留控件注册与静态选项能力，替换医疗分类、患者字典和演示数据。相关题目和模板通过 RuleExam API 获取。 |
| `utils/widgetNodeViewRegistry.ts` | 原注册表为全局 Map；改为按编辑器实例隔离并在卸载时清理，防止正文、右侧解析和预览多个实例互相影响。 |
| `icons/`、`components/SvgIcon.vue`、`utils/ProseMirror.reset.css` | 迁入被使用的图标与样式，并适配宿主样式边界。 |

源 `OptionType` 和右侧选项输入目前仍使用字符串标签，不能据此声称已支持独立的选项富文本。目标选项须保存自己的富文本内容，不能在从编辑器转成题库字段时丢掉图片、加粗、公式等已支持节点；未启用的扩展节点应明确拒绝，不能静默丢失。

当前无实际引用的 `LineHeightsss.ts`、`TextWidget.vue`、`FieldNodeViewContent.ts`、`useShadowDOM.ts` 不进入迁入清单。源 `utils/data.json` 医疗文书示例不进入生产初始化数据。源 `LICENSE` 内容为 MIT，迁入组件目录保留原许可证及版权文字，并在 README 记录来源路径、迁入日期和源文件校验值；本地源目录无 Git 版本，不编造上游 commit。

### 4.2 目标目录与职责

以下是目标结构，带“新增”的路径在核查时不存在。原 B3 的 `QuestionEditor.vue`、`QuestionPreview.vue` 继续作为业务入口，内部使用迁入的组件，不另外重做一套富文本工具栏。

```text
web/
  src/
    components/
      QuestionEditor.vue                 # B3 业务组合：题目元信息、考点、媒体、编辑文档
      QuestionPreview.vue                # B3/C4 组合：单题、整卷及答卷只读展示
      Tiptap/                            # 从源 components/Tiptap 迁入并适配
        index.vue                        # 编辑界面入口；不直接发题库 HTTP 请求
        type.ts                          # 通用文档/控件类型，修正 JSON 类型
        README.md                        # 新增：来源、迁入范围、依赖、使用示例
        LICENSE.template-editor-x        # 保留源许可证
        components/
          MenuBtn.vue
          ContextMenu.vue
          LeftControlPanel.vue
          DraggableControl.vue
          DropControl.vue
          TemplateSetting.vue
          WidgetSetting.vue
          DataSourceSelect.vue
          EditDiv.vue
          SvgIcon.vue
          QuestionSetting.vue            # 新增：当前题的考点、难度、答案摘要、解析
          TemplateLibrary.vue            # 新增：单题/整份模板的选择及套用
          RelatedQuestions.vue           # 新增：查询并插入已有题的副本
        extensions/
          WidgetNodes.ts
          ClearFormat.ts
          ParagraphLineHeight.ts         # 从 LineHeight.ts 适配，保留旧段落级 JSON 语义
          IndentExtension.ts
          QuestionNodes.ts               # 新增：questionBlock / questionStem / questionOption
          MediaImage.ts                  # 新增：受控图片节点，保存 asset_id
        widget/
          FieldComponent.vue
          TextInput.vue
          SelectInput.vue
          DateInput.vue
          RadioInput.vue
          CheckboxInput.vue
          QuestionBlockView.vue          # 新增：当前题选择和题目边界
          QuestionOptionView.vue         # 新增：富文本选项、正确标记及回看状态
        utils/
          widgetNodeViewRegistry.ts
          commonWidget.ts
          function.ts
          ProseMirror.reset.css
          createExtensions.ts            # 新增：按 plain/rich/question 配置扩展
          document-adapter.ts            # 新增：旧题字段、编辑文档、模板之间的转换
        icons/                           # 迁入实际使用的 SVG
        styles/editor.scss               # 新增：收拢宿主适配与局部样式
    api/
      http.ts                            # 复用现有认证、错误信封与上传
      training-types.ts                  # 复用 A1 的 Id、题型、难度等基础契约
      question-authoring.ts               # 新增：模板、整批保存、考点/相关题查询的调用
      question-document-types.ts         # 新增：编辑文档契约，不复制一套基础枚举
    views/admin/
      Questions.vue                      # 现有：列表、筛选、审核及打开设计器
      RegulationDetail.vue               # 现有：制度 AI 结果转入设计器
      QuestionDesigner.vue               # 新增：完整编辑页面，负责载入/保存/离页提醒
    router/index.ts                      # 新增 /admin/questions/editor，复用权限控制
  vite.config.ts                         # 按需接入 SVG 资源注册
  package.json                           # 仅加入实际需要的编辑依赖
  package-lock.json                      # 按 RuleExam 现有 npm 工作流更新

server/src/
  common/question-document.ts            # 新增：服务端编辑文档契约
  modules/questions/                     # 沿用 B3 规划的题库模块
    question-version.service.ts          # B3：版本、审核及统一题目保存
    question-concept.service.ts          # B3：考点管理
    question-authoring.controller.ts     # 新增：编辑文档读取与整批保存
    question-authoring.service.ts        # 新增：校验、事务、重复请求与版本冲突处理
    question-document.codec.ts           # 新增：JSON校验、字段提取、旧题转换及下发裁剪
    question-template.service.ts         # 新增：可复用模板的存取与复制
    question-template.controller.ts      # 新增：模板管理API
  entities/
    question-version.entity.ts           # B3：增补编辑原稿与 schema_version
    question-template.entity.ts          # 新增：模板名、范围、内容JSON、版本与审计字段

database/migrations/
  <接入时分配序号>_question_authoring.sql  # 新增；不修改已执行迁移的内容与校验和
server/test/question-document.spec.ts     # 新增：结构、答案提取、旧题转换、裁剪验证
tests/training-question-authoring.mjs     # 新增：API保存、模板复用与冻结回看
tests/fixtures/question-authoring/       # 新增：可重复使用的非敏感JSON样例
```

`QuestionDesigner.vue` 处理网络和页面状态；`QuestionEditor.vue` 将业务属性与编辑器组合；`Tiptap/index.vue` 处理编辑交互。只有直接重复的扩展配置和资源逻辑提取为辅助文件，不建立独立编辑器平台或额外前端工程。

普通备注与富文本场景可以直接使用 `Tiptap/index.vue` 的 plain/rich 配置，关闭左右面板并选择是否显示工具栏；解析使用独立 rich 实例，禁止在解析内嵌套题目。不要求所有普通字段都经过 `QuestionEditor.vue`。

### 4.3 依赖与宿主适配

- 源 Tiptap 系列包实际锁定 `3.0.0-beta.7`；RuleExam 当前没有 Tiptap。根据 2026-10-21 调研，目标统一精确锁定实际使用的官方 `@tiptap/*` 包为 `3.32.0`。这是工程选型，不把隔离 API 检查当成整套编辑器已兼容。基线已经是 v3 beta，不能直接套用 v2 升级指南推断所有变化。
- 复用宿主锁定的 Vue `3.5.42`、Element Plus `2.14.5`、Vite `5.4.21`、plugin-vue `5.2.4`、TypeScript `5.9.3`、vue-tsc `2.2.12`；不在迁入时同时追最新主版本。实施前复核当时锁文件。Vite 8 所需 Node `>=22.12`（22.x 路线）比当前声明的 `>=22` 更窄，不能顺手升级构建链。
- 官方扩展使用 core/vue-3/pm/starter-kit、table、text-style、highlight、text-align、superscript、subscript。保留 TableKit，删除无直接使用的独立 table-cell/header/row 依赖。TextStyle、Color、FontFamily、FontSize 从 `@tiptap/extension-text-style` 导入；官方 FontSize 通过旧 JSON 往返验证后替代本地 FontSize.ts。StarterKit 已有 HorizontalRule，移除重复的独立注册。
- 原 LineHeight.ts 的段落/标题/列表项属性与官方默认的 textStyle 标记不同。迁入为 ParagraphLineHeight.ts，保留旧 JSON 语义并审查多段选择命令；不是只改名就算修复。暂不同时启用官方 LineHeight；若使用 TextStyleKit，显式关闭它的 lineHeight。正文回填使用 `setContent(content, { emitUpdate: false, errorOnInvalidContent: true })`，服务端仍独立验证结构及未知属性。
- 将 `CellSelection` 的来源从独立 `prosemirror-tables` 改为 `@tiptap/pm/tables`，不再另行追 tables 版本。保留 `prosemirror-utils 1.2.2`，安装后检查 model/state/view/tables 去重。新增 Vue NodeView 和表格内部行为的浏览器回归，不因公开 API 同名就跳过验证。
- 迁入的周边直接依赖包括 `vue3-dnd 2.1.0`、`react-dnd-html5-backend 16.0.1`、`nanoid 5.1.5`、`@vueuse/core`（先对齐宿主 `14.4.0`）、`fuse.js`（候选 `7.5.0`）；DnD 不要求引入 React，但需检查 dnd-core 单实例。不能依赖宿主偶然传递安装来代替清单声明。原日期控件若保留，声明 `vue-datepicker-next 1.0.3` 和 Moment；若切换 Element Plus，单独适配插槽、焦点、格式和只读，不直接替换包名。
- 开发依赖补齐 SCSS 所需 Sass（候选 `1.106.0`）和 SVG 注册所需 `vite-plugin-svg-icons 2.0.1`。这些周边版本仍以宿主构建及交互验证后锁定为准，不能复制源工程整份 package.json 或 pnpm 锁文件；不把长期未发布的包默认为不能使用或已兼容。
- 源工程依赖自动导入，RuleExam 没有同等配置。迁入文件补齐 Vue、VueUse、Moment、Element Plus 服务函数的显式 import；不为该组件整体引入 FitsAdmin 自动导入框架。当前模板不使用 JSX/TSX，不需要据此增加 JSX 插件。
- `vite-plugin-svg-icons` 只扫描迁入的 Tiptap 图标目录；编辑器入口注册 `virtual:svg-icons-register`，在 `vite-env.d.ts` 声明相应类型。编辑页面按路由加载，普通页面不因初始化题目设计器而加载完整三栏界面。
- CSS 以 `.ruleexam-tiptap` 为边界；ProseMirror reset、右键菜单和弹出层也使用独立 class。`--fits-*` 映射为 Element Plus/RuleExam 的局部变量，不导入源工程全局 `_global.scss`、布局、登录、路由或 stores。纸张大小只用于 PC 排版/打印，不成为 H5 固定宽度协议。
- 图片使用 A4 规划的 `MediaUpload`、`MediaService` 和受控读取接口。JSON 保存资源标识，短期访问 URL 由宿主解析；不把本机路径、临时对象 URL、任意外链或认证令牌写进题目和模板。

### 4.4 编辑器输入输出与模式

迁入后的 `Tiptap/index.vue` 接收 `modelValue: JSONContent`（Tiptap 正文对象）、`profile: plain|rich|question`、`mode: edit|preview|review`、显示设置，以及 question 配置下的逐题元信息和可选回看数据。以 `update:modelValue`、`question-meta-change`、`selection-change`、`save`、`close` 事件输出状态；必要的主动接口仅暴露 `getJSON()`、`setContent()`、`focus()` 和 `validate()`。

`QuestionEditor.vue` 接收整份 QuestionAuthoringDocument，将其中 content 传给 Tiptap，将 questions 元信息与右侧表单对应，合并两个变更事件后把完整 `save` 交给页面处理。页面确认后端保存成功后才清除未保存标记或关闭界面；失败保留内容，重复点击不重复创建题目。关闭和路由离开复用 A5 的 `useUnsavedChanges`。

回填发生在编辑器就绪之后，能够处理页面异步载入；输入回填不再次触发无限的保存/更新循环。preview/review 模式不仅设置正文只读，还禁止自定义控件更改、粘贴、删除和拖入。正文和解析同时打开时各自维护实例与撤销栈。

### 4.5 JSON、题库和模板保存边界

编辑文档协议 QuestionAuthoringDocument 首版固定 `schema_version: 1`，包括 Tiptap `content` 和按 `client_id` 对应的 `questions` 元信息。每个 `questionBlock` 有唯一 `client_id`，内部有明确的 `questionStem` 和独立 `questionOption`；选项有稳定 `option_id`、富文本 content 和管理端正确标记 `checked`。现有单选/多选 NodeView 的交互及样式用于新的选项视图，不能继续以逗号或换行分隔的 label 字符串作为富文本选项存储。

每题元信息保存题型、类别、difficulty、可选 concept_id、制度来源、解析、建议分值；编辑已有题时同时带 question_id 与 base_revision。题目身份由后端校验，客户端不能通过更换标识编辑无权访问的题目。复制模板或相关题目默认创建新题，重新生成本地题目/选项标识；编辑原题必须从显式“编辑”入口进入。

服务端解析已校验的题目 JSON，生成 B3 所需的 `stem/options/answer/analysis` 兼容字段：富文本正文渲染成经清洗的 HTML，正确选项按当时选项顺序转换为现有判分下标。编辑原稿与这些派生字段同版本、同事务保存；服务器重新提取答案，不信任另行提交的矛盾答案数组。图片作答区域单独标明图片题，不用单选/多选控件伪装图片作答。

`question_version` 保存单题编辑原稿、解析 JSON 和 schema_version；历史版本及个人题单冻结这份原稿和显示映射。旧字符串题在打开编辑时经服务端清洗并转换为一份结构化文档，不反向覆盖既有历史答卷。无法识别的结构返回明确错误，不能静默丢掉内容。

`question_template` 保存可复用单题/多题文档的名称、培训类别、默认值、JSON 内容、修订号和创建/更新信息；模板可以包含占位内容。套用模板得到独立的编辑副本，模板后续变化不影响已经生成的题库版本或考试。模板管理沿用题库管理权限；涉及图片资源时同样建立受控引用。当前不新增独立的文档审批流程。

目标管理接口沿用 `/api/v1` 和统一信封，由下列新增服务提供；其具体 DTO 与错误码纳入原 04 册：

| 接口 | 行为 |
|---|---|
| `POST /admin/question-documents/assemble` | 根据有权访问的题目版本组成可编辑或预览文档，返回各题 base_revision。 |
| `POST /admin/question-documents/commit` | 接收 request_id 和整份编辑文档；全部题校验通过后原子创建/修订，返回 client_id 到 question_id/version_id 的映射；非法结构或旧 base_revision 拒绝整批，不部分覆盖。 |
| `GET /admin/question-documents/commits/:request_id` | 查询本人的保存结果，处理响应丢失；相同 request_id 同内容不重复写入，不同内容拒绝。 |
| `/admin/question-templates` 与 `/:id` | 列表、创建、读取、带修订校验的更新和受控删除；复制模板时清除题库身份绑定。 |

AI 新生成协议以同一文档结构为目标，经服务端校验后返回可载入的 JSON；概念、来源和权限由任务上下文绑定。现有 AI 标准题 JSON 以及 Excel/TXT 导入通过 codec 转成相同编辑原稿，无须等所有生成路径同时升级后才能编辑。验证、清洗和答案提取在服务器执行，浏览器编辑器的校验用于即时提示。

学员 payload 从冻结内容按允许字段重新构造，题干与选项可以携带可展示的 JSON；正确标记、答案、解析、rubric 和管理元信息不进入在考响应。旧固定卷客户端通过兼容 HTML/选项字段继续工作，新的 JSON 渲染能力不会被当成旧客户端已经具备。

### 4.6 接入顺序与验收

1. 在集成 worktree 中完成来源清单，统一 Tiptap 3.32.0、复用宿主基础依赖并迁入图标/样式；验证源模板的文本、表格、单选、多选与左侧拖入行为，记录 NodeView、段落行高和依赖去重结果。
2. 增加输入/保存/回填和 edit/preview/review 模式，去掉演示数据，验证正文与解析多个实例共存、无工具栏输入以及宿主页面样式不受影响。
3. 在 B3 中落实题目边界、富文本选项、考点/两档难度、受控图片和模板库，并同步 JSON 契约、版本字段、初始化与增量迁移。
4. 接通整批 JSON 保存、旧题/AI/导入转换，再接 Questions、RegulationDetail 与新设计器页面；模板加载或 AI 回填都走相同适配路径。
5. 与 C1—C4 对接冻结、答案裁剪和答卷回看，核验红绿标记、圈选、漏选及图片评分；文档可编辑不等于已经完成考试链路。

编译检查沿用 `cd web && npx vue-tsc --noEmit && npm run build`、`cd server && npm run build`；新增后端测试 `cd server && npm test -- test/question-document.spec.ts`。整批保存与来源/权限/快照场景使用隔离测试库中的 `training-question-authoring` suite，仍须遵守 A1 测试隔离及原计划的凭据边界。

浏览器验收必须实际完成：左侧控件拖入；多题编辑；单选互斥不跨题；富文本选项保存再打开；模板插入标识不冲突；AI 整批回填；保存失败保留内容；正文/解析/预览多实例隔离；只读控件不能修改；受控图片权限与历史答卷一致；普通无工具栏多行输入不带出题侧栏。新整题或选项拖拽排序不属于原模板已证明的能力，若纳入交付需增加独立用例。

## 5. 预览、答卷回看与错题

PC 试题预览、答卷回看和错题详情共用一致的题目展示规则；回看使用本人当次考试的题目快照、题序和选项顺序。

| 情况 | 显示要求 |
|---|---|
| 正确且学员选中 | 绿色、学员圈选效果 |
| 错误且学员选中 | 红色、学员圈选效果、“选错”提示 |
| 正确但学员未选 | 绿色、“漏选”提示，不标为学员已选 |
| 未选择的干扰项 | 普通样式 |

正确性与学员是否选择是两个独立状态，显示效果不写回题库原稿；正文及选项控件均禁止在回看时修改。图片题展示学员图片、得分和评语，待批改保留待批改状态。错题集沿用原设计的最终未满分题目口径，不把待批改题提前判错。

独立 H5 仍属于下一期，届时根据学员 JSON 独立渲染，不依赖 PC Tiptap 编辑器。在考响应只包含允许展示与作答的字段，不包含标准答案、解析或带正确标记的原始编辑 JSON。

## 6. 与正在实施计划的衔接清单

以下为后续计划修订范围，不是本轮已经完成的实现。

| 原计划位置 | 需要同步的内容 |
|---|---|
| 总设计 U06/U07、§1.2、§6 | 两档可用难度；中档仅预留；考点可跨题型；编辑器三栏职责 |
| A1 总契约与前端镜像 | 当前可写难度仅 easy/hard；现存三档类型的中档保留与启用状态分开，运行时校验不得因类型仍含 medium 而放行 |
| B3 题库与 AI | 考点管理及逐题关联；取消同题型限制；Tiptap 题目边界、原稿与版本；按已选考点生成 |
| B4 文件导入 | 两档校验、考点引用与行级错误，不能绕过题库校验 |
| C1 发布与抽题 | 跨题型考点全卷去重、联合容量校验和可行抽取；固定卷和随机卷一致遵守考点约束 |
| C2/C3 个人题单与作答 | 冻结题目内容、来源、考点、难度和显示映射；明确编辑 JSON 到学员 payload 的转换 |
| C4/C6 回看、错题与统计 | 按冻结内容回看；颜色和圈选分离；简单/困难展示与统计口径一致 |

原[总实施计划](../plans/2026-10-21-training-admin-integration.md)、[内容子计划](../plans/2026-10-21-training-admin-content.md)与[考试子计划](../plans/2026-10-21-training-admin-exams.md)目前仍含三档可用难度及同题型考点约束。接入本文前须由集成方统一修订相关计划、受影响的设计分册和契约，并结合当时 worktree 的实际进度安排，不能只改界面文案。

## 7. 后续验收关注点

- 一份文档包含多题时，修改当前题的考点或难度不改变其他题；左侧控件和模板入口仍可用。
- 同考点下可以建立简单、困难及不同题型的题目；题库按各题难度显示，考点本身没有难度。
- easy/hard 在人工录题、AI、导入、批量编辑和发布中一致生效；medium 本期不能用于新题及新发布，不删除或改写任何已有历史记录。
- 按内部/外来身份抽取对应题池，同卷跨题型不重复考点；缺少可行组合时发布明确失败，题池存在合法组合时抽取成功。
- AI 返回整批题目可载入编辑、保留考点归属并逐题修订；未知考点标识和非法题目结构被拒绝。
- 修改题库内容或关联不改写已发布及已开考的冻结内容；答卷回看和错题的选对、选错、漏选状态正确，正确答案不泄露给在考学员。
