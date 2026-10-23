# main schema 3 纯内容合同

日期：2026-10-23。依据当前集成设计与计划 Task 1。本文记录纯内容校验与类型合同的实际实现，不表示完整 PaperDesigner、作者 codec、HTTP 接线、发布／学员端或真机已通过。

## 公开接口与输入

| 接口 | 所在文件 | 行为 |
| --- | --- | --- |
| `parseRichDocV3(input)` | `server/src/modules/questions/question-content-v3.ts` | 严格校验并逐节点重建考试富文；错误使用 40001，并在消息与 `data.path` 中给出节点路径 |
| `assertAuthoringDocumentLimits(input)` | 同上 | 只检查作者文档预算，不代替作者节点／业务属性校验 |
| `parseQuestionContent(input)` | `server/src/modules/questions/question-content-dispatch.ts` | 接受现有 entity/DTO 的 camelCase 或 snake_case 内容字段，以及 canonical 输入；输出 schema 2／3 判别联合 |
| `projectStudentContent(content)` | 同上 | 重新校验内容，返回独立重建的 `{stem,options}`，不返回 schema、答案或解析 |
| `collectContentAssetIds(content)` | 同上 | 重新校验后按首次出现顺序收集题干、选项、解析的去重资产 ID；业务授权仍由调用方决定 |

`server/src/common/question-content-v3.ts` 定义 `ContentSchema = 1|2|3`、受控节点／marks 及 `CanonicalQuestionContent`。canonical 固定为 `{schema:2|3,stem,options:[{id,content}],analysis,answer_option_ids}`，输出不增加题型或管理字段。只有输入提供 `type` 时检查单选／判断恰一答案、多选至少两答案及判断两选项；无 `type` 时仍检查非空答案、唯一 ID 与集合归属。T3 必须在业务写入边界提供并强制校验题型。

## schema 1／2 保持原意

没有修改 `question-content.ts`、`readonlyDoc` 或旧合同。schema 1 使用原有 `questionContent` 的历史 HTML 适配并输出 schema 2；schema 2 直接委托原有 `questionContent`／`readonlyDoc`。旧深度、节点、图片、字段和 marks 禁令保持原样，不因新增 schema 3 放宽旧快照。

## schema 3 白名单

| 分类 | 允许内容与限制 |
| --- | --- |
| 根与块 | `doc`、`paragraph`、`heading`、`blockquote`、`bulletList`、`orderedList`、`listItem`、`codeBlock`、`horizontalRule`、`table`、`tableRow`、`tableCell`、`tableHeader`；严格检查父子位置，列表项首块必须为段落 |
| 行内 | `text`、`hardBreak`、`image`；图片只接受 `attrs.asset_id` |
| 无属性格式 | `bold`、`italic`、`underline`、`strike`、`code`、`superscript`、`subscript`；重复 mark 拒绝 |
| 文本样式 | `textStyle` 只允许 `fontFamily/fontSize/color`，至少一个非空样式；`highlight` 只允许颜色 |
| 字体／字号 | `SimSun/SimHei/Microsoft YaHei/FangSong/KaiTi`；字号为 9–36 整数 `pt` 字符串 |
| 块属性 | 标题 1–4；文本对齐 `left/center/right/justify`（可保留来源 null）；缩进 0–10 整数；行距字符串 `1/1.2/1.5/1.75/2/2.5/3`，兼容来源的 null／0 未设置值 |
| 列表／代码 | 有序列表 start 为正安全整数，编号 `1/a/A/i/I` 或 null；代码块只含无 marks 文本，language 只能未设置或 null |
| 表格 | 单元格必含 `colspan/rowspan/colwidth/align`；跨度 1–100，colwidth 为 null 或与 colspan 等长的 0–10000 整数数组，align 为 `left/center/right` 或 null；拒绝越界、区域重叠、内部／尾部缺格、同列宽度冲突 |
| 颜色 | 仅 `#rgb/#rrggbb/rgb(r,g,b)`；hex 规范为小写六位，rgb 通道 0–255 并规范空格；不接受颜色名、任意 CSS 或 URL |

节点／mark／attrs 的白名单均逐层生效。未知节点定位报错，不打平、不丢弃。`answer/analysis/checked/correct/src`、事件、任意 HTML／CSS／href 和未知属性不能嵌入考试节点。`mediaImage/widgetField/questionBlock/questionOption` 是作者节点，不能直接通过考试 parser；来源链接或控件必须由 T3 明确转换成安全可见内容后再校验。

## 预算、稳定身份与媒体

单个考试富文最多 2,000 节点、100,000 文本字符、深度 16；单表格展开最多 10,000 格。作者预算最多 2 MiB（UTF-8 序列化大小）、20,000 内容节点、深度 32、100 题；正文和各题解析共用节点预算。作者 guard 仅执行预算扫描，不能单独作为可发布证明。整份 HTTP bundle 大小及服务端 body 上限由 T3 接线验证。

选项 ID 延续 main 的 `[A-Za-z0-9_-]{1,64}`，`A/B` 合法。排序只改变数组顺序，不重建 ID，也不改变答案映射。新 ID 的分配与作者本地 option ID 映射属于 T3／T5。

媒体仅保留十进制字符串 `asset_id`；无任意 src、资源 URL、本地路径或 JWT。纯内容函数不查数据库、不签票、不赋予读取权限。资产收集包含解析图，调用方必须按使用场景及精确业务归属授权，不能据此把解析图授予进行中题面。

## 作者与布局类型

`server/src/common/question-authoring.ts` 定义浏览器无关 JSON 类型、三客观题 `QuestionMeta/QuestionAuthoringDocument`、`StableOptionIds/VersionTokens`、`AuthoringBundle/AuthoringCommitRequest/AuthoringReceipt` 及宿主类型。没有 rubric、图片答案题型或旧 AI generation_ref。历史 `medium` 在类型中可表达，不等于允许新写，启用规则由 T7 policy 约束。

`DesignerLayoutV1.settings` 已按根代理核实的来源字段收窄为 `templateName`、`pageSize:A4|A5`、`pageOrientation:1|2`、`pageSizeReduce:{top,bottom,left,right}`；T2／T5 分别负责运行校验及来源默认值／单位。

## 工具栏与未覆盖边界

共享 fixtures 覆盖表格合并、多层列表、图文、当前受控 marks 和短 ID；没有把作者格式直接透传到学生。实际工具栏“命令 → 作者节点 → 安全考试内容 → PC/mobile 渲染”逐项映射仍需 T5 来源清单和 T3 作者 codec 完成，链接可见文本、普通控件静态化、作者原稿往返及 100 题 UI 不能凭本报告宣称通过。此 lane 未接 DTO／服务、发布、客户端能力协商或 UI。

## 实际验证

- RED：`npm --prefix server test -- test/question-content-v3.spec.ts`，生产 pretest 编译通过；Vitest 实际收集 106 项，105 项因新增模块／函数尚不存在失败，旧 schema 2 marks 防回归一项通过。测试编写期间修正过语法错误与 fixture 表格下标，二者不计为有效 RED。
- GREEN：同一命令，106/106 通过，生产 pretest 编译通过，exit 0。
- 完整服务端：`npm --prefix server test`，49 个文件，694 通过／5 失败。唯一失败文件为并发 T2 的 `paper-designer-layout.spec.ts`：DTO 白名单接受、创建／更新持久化、旧空布局默认值、拒绝非法 service 写入、随机卷无布局保持五项；已向根和 T2 报告，不算 T1 回归，后续由 T2／根对固定候选复核。
- 运行保留现有 Vite CJS API 弃用提示；没有安装依赖、读取 `.env`、访问开发／业务库、执行迁移、暂存或提交。

实际修改为本报告、上述四个新源码文件、`server/test/question-content-v3.spec.ts` 及 `tests/fixtures/question-authoring-v3/` 下五个 JSON。来源 manifest 由根维护，本 lane 未修改它。
