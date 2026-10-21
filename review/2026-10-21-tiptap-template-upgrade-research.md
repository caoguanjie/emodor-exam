# Tiptap 模板编辑器版本、组件与 API 升级调研

调研日期：2026-10-21。版本结论是该日 npm 官方 registry 的快照，不代表未来始终为最新版本。

范围：`/Users/caogj/Downloads/template-editor-x-main/src/components/Tiptap/` 的实际引用链，以及它接入 RuleExam 培训改造的兼容性。不是源工程全部后台组件的升级审计。

状态：已完成本地源码与锁文件检查、官方版本/API 核对、隔离 API 验证；未迁入组件、未修改两个工程的业务源码和依赖、未运行完整应用或浏览器验收。研究脚本保存在本报告同级目录，不进入应用构建。

## 1. 结论

建议保留现有 Vue 三栏编辑器和通用控件，以组件源码迁入方式接入 RuleExam；将实际使用的 Tiptap 官方包统一到 **3.32.0**，不要照搬源工程全部依赖，也不要同时升级宿主 Vue、Element Plus、Vite 和 TypeScript。

你的源码已经是 **Tiptap 3.0.0-beta.7**，不是 Tiptap 2。官方 v2→v3 指南只能作为背景，不能把其中所有变化算成这次升级的破坏性变化。`TableKit`、`TextStyleKit`、官方字号/行高和 `setContent` 默认触发更新，在 beta.7 中就已经存在。

最需要处理的不是组件名字变化，而是三个层面：

1. **版本适配**：正式版 Vue NodeView、表格和插件调度内部变化，要验证光标、控件、快捷键和重开弹窗。
2. **原代码已有问题**：重复注册分隔线、全局控件注册表、只读下命令仍可写、复制模板标识冲突、异步回填及监听器清理。
3. **题库新增能力**：题目边界、富文本选项、考点、难度、冻结答卷和答案裁剪。这些不是升级 Tiptap 就会自动得到的功能。

最重要的数据兼容警告：**不能直接用官方默认 LineHeight 替换本地 LineHeight**。本地把行高放在段落属性，官方默认放在文本样式标记；直接替换会丢失旧 JSON 的段落行高。已用隔离实验确认。

## 2. 检查基线与证据

| 对象 | 核查位置 | 取值方式 |
|---|---|---|
| 源模板 | `/Users/caogj/Downloads/template-editor-x-main` | `package.json`、`pnpm-lock.yaml` 与实际 Tiptap 引用链 |
| 宿主 | `/Users/caogj/.codex/worktrees/16b4/RuleExam/web` | `package.json`、`package-lock.json` 与 Vite/入口配置 |
| 正式版 | npm 官方 registry、Tiptap 官方文档与 `v3.32.0` 源码 | 不将搜索摘要或第三方文章作为 API 定论 |
| 实验 | `/tmp/ruleexam-tiptap-research.AMtxQ8` | Node v25.9.0、jsdom 26.1.0、隔离安装；不使用应用目录的 node_modules |

本地模板不是 Git 仓库，不能给出可信的上游提交号。实际迁入时应保留原 MIT 许可证及版权文字，记录来源路径、迁入日期和文件校验值；这不是完整法律审计。

源码导航使用代码图及必要的窄范围读取。关键证据：源 `package.json:29–44`、`pnpm-lock.yaml:40–87`；`src/components/Tiptap/index.vue:58–180`；宿主 `web/package.json:11–24`、`web/vite.config.ts`、`web/src/main.ts`。包声明中的 `^` 不是实际安装版本，下表使用锁文件值。

## 3. 版本矩阵：更新了什么，建议用什么

### 3.1 Tiptap 主线

| 依赖 | 源模板锁定 | 2026-10-21 官方 latest | 本次建议 |
|---|---|---|---|
| core / vue-3 / pm / starter-kit | 3.0.0-beta.7 | 3.32.0 | 统一精确锁定 3.32.0 |
| extension-table / extension-text-style | 3.0.0-beta.7 | 3.32.0 | 同步 3.32.0 |
| 源中使用的 highlight / text-align / superscript / subscript | 3.0.0-beta.7 | 3.32.0 | 同步 3.32.0 |
| extension-color / extension-font-family | 3.0.0-beta.7 | 3.32.0 | 可改从 text-style 导入，删除多余直接依赖 |
| extension-table-cell/header/row | 3.0.0-beta.7 | 已有统一 table 入口 | 源组件无直接使用，迁入时不再单独声明 |
| 单独 extension-font-size | 未用 | 3.0.0-next.3 | 不安装；从 extension-text-style 导入 FontSize |
| 单独 extension-line-height | 未用 | registry 404 | 不存在这个包；官方 LineHeight 在 text-style 中 |

3.32.0 发布于 2026-10-13。core 要求同版本 pm；vue-3 要求同版本 core/pm，并有 Vue `^3.0.0`、`@floating-ui/dom ^1.0.0` peer。不能只升级 vue-3 而保留 beta core。上述 Tiptap manifest 没有 engines 字段，不等于整个依赖树对任意 Node 都兼容。[官方发布记录](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0)、[core 元数据](https://registry.npmjs.org/@tiptap/core/3.32.0)、[vue-3 元数据](https://registry.npmjs.org/@tiptap/vue-3/3.32.0)、[text-style 元数据](https://registry.npmjs.org/@tiptap/extension-text-style/3.32.0)。

### 3.2 Vue 与构建工具

| 依赖 | 模板锁定 | RuleExam 锁定 | 官方 latest | 本轮迁入策略 |
|---|---:|---:|---:|---|
| Vue | 3.5.12 | 3.5.42 | 3.5.44 | 复用宿主 3.5.42 |
| Element Plus | 2.9.1 | 2.14.5 | 2.14.7 | 复用宿主 2.14.5 |
| Vite | 5.4.10 | 5.4.21 | 8.3.5 | 迁入先保留宿主版本；主版本升级另立任务 |
| @vitejs/plugin-vue | 5.1.4 | 5.2.4 | 6.0.10 | 保留宿主 5.2.4 |
| TypeScript | 5.6.3 | 5.9.3 | 7.0.2 | 保留宿主 5.9.3 |
| vue-tsc | 1.8.27 | 2.2.12 | 3.3.13 | 保留宿主 2.2.12，必须跑类型检查 |

这些“保留”是控制此次迁入变量，不是对旧构建工具长期维护或安全性的保证。Vue 3.6 RC、TypeScript 7.1 beta 不作为稳定版候选。[Vue registry](https://registry.npmjs.org/vue/latest)、[Element Plus registry](https://registry.npmjs.org/element-plus/latest)、[Vite registry](https://registry.npmjs.org/vite/latest)、[plugin-vue registry](https://registry.npmjs.org/@vitejs%2Fplugin-vue/latest)、[TypeScript registry](https://registry.npmjs.org/typescript/latest)、[vue-tsc registry](https://registry.npmjs.org/vue-tsc/latest)。

### 3.3 编辑器周边依赖

| 依赖 | 模板锁定 | 官方 latest | 判断与建议 |
|---|---:|---:|---|
| @vueuse/core | 11.2.0 | 15.0.0 | 宿主已传递安装 14.4.0；直接使用时明确声明，可先锁 14.4.0 |
| fuse.js | 7.1.0 | 7.5.0 | 字典搜索确实使用；7.5.0 是候选目标，验证查询/选择后锁定 |
| nanoid | 5.1.5 | 6.0.2 | 先保留 5.1.5，修正 ID 长度及复制策略比追主版本更重要 |
| moment | 2.30.1 | 2.31.0 | 保留旧日期逻辑时可验证 2.31.0；若完全移除相关控件则不引入 |
| sass | 1.43.4 | 1.106.0 | 迁入 SCSS 时补开发依赖；1.106.0 为待宿主构建验证候选 |
| prosemirror-tables | 1.7.1 | 1.8.5 | 不独立追版本，改从 @tiptap/pm/tables 取 CellSelection |
| prosemirror-utils | 1.2.2 | 1.2.2 | 保留；确认与 pm 的 model/state 去重 |
| vue3-dnd | 2.1.0 | 2.1.0 | 没有新版；先保留左侧拖入功能，做真实浏览器验证 |
| react-dnd-html5-backend | 16.0.1 | 16.0.1 | 没有新版；与 vue3-dnd 共用同版 dnd-core |
| vue-datepicker-next | 1.0.3 | 1.0.3 | 没有新版；可单独迁到宿主日期控件，不是 API 直接替换 |
| vite-plugin-svg-icons | 2.0.1 | 2.0.1 | 没有新版；短期可按原 sprite 合同接入，单独验证 Vite 兼容 |

版本来源为各包官方 registry，例如 [VueUse](https://registry.npmjs.org/@vueuse%2Fcore/latest)、[Fuse](https://registry.npmjs.org/fuse.js/latest)、[Nanoid](https://registry.npmjs.org/nanoid/latest)、[Moment](https://registry.npmjs.org/moment/latest)、[Sass](https://registry.npmjs.org/sass/latest)、[ProseMirror tables](https://registry.npmjs.org/prosemirror-tables/latest)、[ProseMirror utils](https://registry.npmjs.org/prosemirror-utils/latest)。

vue3-dnd 最近 npm 发布为 2024-02-28；HTML5 backend 为 2022-04-19；日期控件为 2023-03-13；SVG 插件为 2022-01-29。长期未发布意味着需要额外验证和备选方案，不单凭日期认定不可用或已废弃。特别是 HTML5 backend 当前包指向 React DnD monorepo，不能用旧独立仓库的归档状态证明当前整个项目已归档。[Vue3 DnD](https://github.com/hcg1023/vue3-dnd)、[React DnD](https://github.com/react-dnd/react-dnd)、[日期控件](https://github.com/mengxiong10/vue-datepicker-next)、[SVG 插件](https://github.com/vbenjs/vite-plugin-svg-icons)。

### 3.4 Node、peer 和单实例要求

- 项目声明 Node `>=22`；本机实验 Node v25.9.0 不是部署基线。
- Vite 8 / plugin-vue 6 要求 `^20.19.0 || >=22.12.0`。项目仅写 `>=22`，仍包含不满足要求的 22.0–22.11，不能顺手升级。
- Nanoid 6 要求 `^22 || ^24 || >=26`，不接受本机 Node 25；保留 5.1.5 避免额外主版本迁移。
- VueUse 15 要求 Node >=22、Vue ^3.5.0；满足 peer 只是安装前提，不是行为验收。Sass 1.106 要求 Node >=20.19。
- 宿主传递安装的 VueUse、Day.js 不能替代直接依赖声明。源中真正 import 的模块必须在 web 清单明确声明。
- `vue3-dnd` 的 peer 是 Vue，HTML5 backend 依赖 dnd-core，**不要求引入 React**。
- 模板现有锁文件的 ProseMirror 树已对齐，没有发现现存双实例证据。正式版隔离安装也去重成功：tables 1.8.5、model 1.25.12、state 1.4.4、view 1.42.6。实际宿主安装后仍要重查，不能把隔离树当成宿主树。

## 4. API 逐项结论

### 4.1 可保留的公开调用

`useEditor`、`EditorContent`、`VueNodeViewRenderer`、`NodeViewContent`、`NodeViewWrapper` 的主调用方式仍可沿用。自定义 `addCommands`、`addKeyboardShortcuts`、`addProseMirrorPlugins`、`appendTransaction` 不需要因名字变化整体重写。

`TableKit.configure({ table: { resizable: true, handleWidth: 5 } })` 仍有效。源代码已经使用 TableKit；删除没有直接引用的三个独立 cell/header/row 包即可。表格渲染、wrapper、选区和 resize 内部有更新，公开调用不变不等于鼠标交互已经验收。[TableKit](https://tiptap.dev/docs/editor/extensions/functionality/table-kit)、[表格变更记录](https://tiptap.dev/docs/resources/changelog/extension-table)。

### 4.2 字号可以收敛到官方，行高要保留旧语义

建议使用明确的组合，避免套件默认开启与本地扩展重复的能力：

```ts
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
// 段落级行高仍来自迁入的自定义实现，经审查后保留。
import { ParagraphLineHeight } from './extensions/ParagraphLineHeight'
```

本地 FontSize 与官方都保存 `textStyle.attrs.fontSize`，可以在旧 JSON 回填/导出、字号命令和清除格式测试通过后替换。官方实现还有 CSS 值处理，不应继续安装独立的 next 版 font-size 包。[FontSize](https://tiptap.dev/docs/editor/extensions/functionality/fontsize)、[TextStyleKit](https://tiptap.dev/docs/editor/extensions/functionality/text-style-kit)。

本地 LineHeight 保存 `paragraph/heading/listItem.attrs.lineHeight`，官方默认保存 `textStyle.attrs.lineHeight`。迁入时保留块级属性，建议文件和扩展名称改为 ParagraphLineHeight；命令调用同步明确。单纯改名不是修复本地命令的段落选择问题，仍须测试多段选择与列表。若改用 TextStyleKit，必须关闭其 lineHeight，避免两种语义同时注册；或者明确设计旧 JSON 迁移后再切换。[LineHeight](https://tiptap.dev/docs/editor/extensions/functionality/line-height)。

### 4.3 重复注册不是新版引入的问题

源 `index.vue:132,142` 同时加入 StarterKit 和 HorizontalRule。beta.7、3.32.0 的 StarterKit 都已有 HorizontalRule。隔离实验确认重复名称警告。

保留 StarterKit 默认项并删除独立注册即可；若必须自定义独立项，则先 `StarterKit.configure({ horizontalRule: false })`。TableKit 不在 StarterKit 中，应继续注册。Link、Underline、ListKeymap 在本次 beta 基线也已存在，不算这次新增能力。

### 4.4 setContent：签名可用，回填语义要补齐

beta.7 和正式版都默认触发 update。新增 v-model/onUpdate 后，异步载入应明确：

```ts
editor.commands.setContent(document, {
  emitUpdate: false,
  errorOnInvalidContent: true,
})
```

这不是要求所有命令都静默；只对外部回填避免再次触发保存/脏状态。源 `initData()` 在 editor 未就绪时直接返回，而且调用被注释；迁入后需要等待实例就绪并处理后续题目切换。[setContent API](https://tiptap.dev/docs/editor/api/commands/content/set-content)。

结构校验不能只靠此选项：实验中未知的段落行高属性会被忽略。服务端仍需白名单、schema_version、必填字段与序列化往返检查，发现未知结构明确拒绝。

### 4.5 NodeView 和生命周期是本次实际回归重点

NodeView 是“编辑器中的自定义 Vue 控件视图”。源 widgetField 是非叶内联节点，内部还有可编辑内容；FieldComponent 根据类型再挂 TextInput、RadioInput 等子组件的 NodeViewContent。

正式版 Vue NodeView 对非叶节点增加 fallback contentDOM，并通过注入让 NodeViewContent 接管；useEditor 卸载直接 destroy，不再采用旧的克隆替换根节点流程。EditorContent 挂接 DOM 的内部位置也改变。这些变化需要验证控件边界、中文输入、焦点和反复开关弹窗。[v3.32.0 Vue 实现](https://github.com/ueberdosis/tiptap/tree/v3.32.0/packages/vue-3/src)、[NodeView 文档](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views)。

新出现的 selectedOnTextSelection、trackNodeViewPosition、VueWidgetRenderer 都不是要求重写现有控件的理由。VueWidgetRenderer 是 decoration widget 能力，不替代 VueNodeViewRenderer。当前模板没有使用 getPos，不能把 getPos 可返回 undefined 算成已发现的现存 bug；未来新增调用再检查返回值。

ExtensionManager 对插件与快捷键组装有所调整。本地 WidgetNodes 同时实现快捷键和 appendTransaction 数字过滤，需测 Backspace、Enter、方向键、组合输入和撤销重做，不能只看 TypeScript 是否通过。[正式版 core 源码](https://github.com/ueberdosis/tiptap/tree/v3.32.0/packages/core/src)、[Extension API](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/extension)。

### 4.6 schema 与安全边界

JSON 仍是 type/attrs/content/marks 形式；自定义 widgetField 的解析与渲染规则仍由项目承担。3.32.0 新增 schemaSpec，但当前迁入没有必要使用，也不会自动提供业务节点、控件视图或内容迁移。[3.32.0 发布记录](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0)。

Tiptap schema 与 renderHTML 不是应用的安全清洗器。AI、模板导入、旧百度编辑器 HTML 均要在服务端校验节点、属性、CSS 数值/单位、链接协议与媒体权限；旧 HTML 不应直接作为可信输入。此处是安全设计要求，不声称已经证明本地存在可利用的 XSS。[Node API](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/node)、[Schema](https://tiptap.dev/docs/editor/core-concepts/schema)。

## 5. 周边组件能否被新版现成组件替换

### 5.1 不必更换三栏布局或引入 React

Tiptap Vue 绑定本身就可直接使用；不是每个普通多行输入都要再包一层庞大平台。迁入项目的职责是统一必要扩展、JSON 协议与样式，题库页面再组合考点和难度等业务。

官方新 UI Components 的可复制组件/模板目前主要面向 React，不能把它们当作现有 Vue 编辑器的一键替换包。现有 Vue + Element Plus 左侧控件、中间内容、右侧属性仍值得复用；头部工具栏可按 plain/rich/question 场景开关。[官方 UI Components 概览](https://tiptap.dev/docs/ui-components/getting-started/overview)、[组件目录](https://tiptap.dev/docs/ui-components/components/overview)。

### 5.2 日期控件：可以统一，但需单独适配

vue-datepicker-next 没有新版可追。若决定迁到宿主 Element Plus DatePicker，需处理：

| 源组件 | Element Plus 目标 |
|---|---|
| v-model:value | v-model |
| valueType="format" | value-format |
| popup-class | popper-class |
| v-model:open | handleOpen/handleClose 与 visible-change |
| 自定义 #input、#footer 内嵌 NodeViewContent | 重新设计输入区、编辑焦点及清除/今天/确认操作，不是同名插槽替换 |
| Moment 指定格式解析 | 可先保留；换 Day.js 时显式声明依赖并验证 customParseFormat |

源代码有 13 种日期格式组合，需覆盖日期、月份、时间、空值和只读。日期控件不是题目编辑主链路的必要升级前置，不为换包而扩大本轮范围。[Element Plus 日期 API](https://element-plus.org/en-US/component/date-picker.html)、[源日期组件 README](https://github.com/mengxiong10/vue-datepicker-next/blob/main/README.md)。

### 5.3 SVG、自动导入和样式

源图标依赖 `virtual:svg-icons-register` 与 `icon-[dir]-[name]` 规则；宿主未配置对应插件。短期只注册迁入目录中的图标；长期若改内联 SVG，单独验收，不同时更换 Vite 主版本与图标机制。

源工程隐式导入 Vue/VueUse/Moment/Element Plus 服务函数，宿主没有同等自动导入；迁入文件必须补显式 import。不导入 FitsAdmin 路由、stores、全局样式或登录框架。当前 Tiptap 子树无 JSX/TSX，不需要为此增加 JSX 插件。

源 `.ProseMirror`、日期/下拉弹层和 `--fits-*` 样式需收敛到 `.ruleexam-tiptap` 及独立弹层 class。宿主 Element Plus 2.14.5 根包确实导出 useNamespace，现有导入可沿用，不需切入私有路径。[namespace 官方说明](https://element-plus.org/en-US/guide/namespace.html)。

## 6. 原代码问题与题库业务缺口：不要都归咎于升级

以下除标记实验的项目外，属于静态证据及对应风险，尚未全部复现为浏览器故障。

| 项目 | 源文件证据（相对 src/components/Tiptap） | 接入要求 |
|---|---|---|
| 保存仅关闭界面，外部回填不完整 | index.vue:17–20、88、184–191 | 增加 JSON 输入、变更、保存结果及脏状态；后端成功才关闭 |
| 全局 registry、固定 DOM ID | utils/widgetNodeViewRegistry.ts:16–44；index.vue:29–35、283–286 | 实例隔离，卸载不清空其它实例；适应正文+解析+预览 |
| 只读并不阻止控件命令写入 | RadioInput.vue:25–35；CheckboxInput.vue；DateInput.vue:47–57 | 自定义事件与命令共同检查编辑模式；实验确认 editable:false 仍允许程序命令 |
| 计算属性中更新节点 | widget/FieldComponent.vue:99–107 | 去掉渲染/读取期间的写入副作用 |
| ID 过短、按全篇 group 更新 | extensions/WidgetNodes.ts:55–56、379–383、486–524 | 稳定题/选项标识；复制时重映射，互斥限定当前题 |
| 字符串选项重建丢富文本 | type.ts:123–137；WidgetNodes.ts:511–524 | 独立 option content；不能把 label 字符串视为富文本协议 |
| 选区监听未清理 | components/WidgetSetting.vue:249–287 | 对称 on/off；弹窗重开及切换文档回归 |
| 标题粘贴只改 DOM，模型不更新 | components/EditDiv.vue:72–89 | 同步 modelValue 并移除卸载后的监听 |
| 字典字段与 HTML attrs 不一致 | DataSourceSelect.vue:18–22；commonWidget.ts；WidgetNodes.ts:171–193 | 去掉医疗样例依赖，定义可往返的业务 JSON |
| 分隔线重复注册 | index.vue:132、142 | 删除重复注册，已由实验确认 |

富文本选项的准确边界：widgetField 的 inline content 本身可以带 marks，直接编辑/getJSON 并非一概丢失；问题在右侧字符串 label 和按 schema.text 重建选项的路径。题目模型需要保护整段内容，不能只修导出函数。

题目边界、每题难度和考点、题库版本、整批保存、模板复制、AI JSON 校验、答卷冻结与红绿圈选属于 RuleExam 的业务开发，不是 Tiptap 官方 API。尤其回看样式由实际作答与正确答案计算，不写回原题 JSON；学员在考 payload 必须服务端重新按白名单组装。

## 7. 隔离实验：10 项通过，证明到哪里

研究工件：[`probe.mjs`](tiptap-upgrade-probes-2026-10-21/probe.mjs)、[正式版 package.json](tiptap-upgrade-probes-2026-10-21/package.json)、[beta package.json](tiptap-upgrade-probes-2026-10-21/beta/package.json)、[实际结果](tiptap-upgrade-probes-2026-10-21/results.json)。

执行 `npm run probe`，退出码 0，10 项 passed：

| 检查 | 观察结果 |
|---|---|
| Vue 绑定及 TableKit/TextStyleKit 导出 | 存在 |
| StarterKit + 独立 HorizontalRule | 产生重复扩展警告，计数为 2 |
| setContent 更新事件 | 默认触发；emitUpdate:false 抑制 |
| editable:false 后执行 insertContent | 仍改变内容，必须额外防护自定义控件 |
| 官方 FontSize | 写入 textStyle mark 的 fontSize |
| 官方默认 LineHeight 加载旧段落属性 | 旧属性未保留；新命令写入 textStyle mark |
| 保留块级行高 schema | 旧 JSON 与 HTML 行高可保留 |
| TableKit 插入 2×2 表格 | 正确生成 table/tableHeader 结构 |
| beta.7 的相关导出 | 已有 TableKit/TextStyleKit/FontSize/LineHeight |
| beta.7 的默认更新与 StarterKit | setContent 已默认触发；已内置 HorizontalRule |

限制：这些是 **API 行为实验，不是完整编辑器验收**。未挂载源 FieldComponent，未验证真实浏览器拖拽、输入法、表格宽度、光标、弹层或撤销；未运行宿主完整构建和服务端业务链路。正式版 probe 用 Vue 3.5.44，不是宿主 3.5.42，因此不能声称宿主组合已经通过。

beta 实验固定 Tiptap beta.7，但其传递依赖按当日范围重新解析，没有完整复刻源 pnpm 锁文件。它用于证明该 beta 已有的 API 行为，不是历史应用的像素或全量运行基线。

保留的是脚本、顶层版本清单和结果，没有在仓库保存 node_modules 或研究安装锁文件。未来复跑的传递依赖可能变化，报告中的版本树只是当日快照。可将工件复制到新的临时目录，分别在根和 beta 下运行 `npm install --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org`，再在根执行 `npm run probe`。不要在应用 web 目录执行这些安装命令。

## 8. 集成位置与实施顺序

完整业务接口和目录见[补充设计 §4](../docs/superpowers/specs/2026-10-21-question-authoring-concepts-design.md)。目标仍是：

```text
template-editor-x-main/src/components/Tiptap
                 │ 源码迁入、升级与业务适配
                 ▼
RuleExam/web/src/components/Tiptap/
                 │
       ┌─────────┴──────────┐
QuestionEditor.vue    QuestionPreview.vue
       │                     │
QuestionDesigner.vue   PC 试题/答卷/错题回看
       │
RuleExam server/modules/questions
```

迁入使用届时完成前置任务的集成 worktree，不直接向旧主工作副本复制实现。顺序：

1. 固定源快照、许可证、迁入文件清单；保留现有模板行为样例，统一 Tiptap 3.32.0，复用宿主基础版本。
2. 处理显式 import、SVG、样式、重复扩展和 pm 入口；替换字号，保留并修正段落行高；先通过类型检查和构建。
3. 解决实例隔离、只读、保存/异步回填、复制 ID 和监听器清理；验证源控件及 NodeView 的真实交互。
4. 再加入 questionBlock/questionStem/questionOption、右侧业务表单、整批 JSON、模板与 AI 适配；同步数据库、实体、接口文档。
5. 接通题库版本、考点/两档题池、考试快照、学员答案裁剪与 PC 回看；业务验收完成才可以称为“已集成”。

当前计划中的三档难度、同考点同题型约束仍需集成方统一修订；本研究没有偷偷修改进行中的实施计划或 worktree。教材来源模型和固定培训练习题库仍不在本轮范围。

## 9. 实施时的最小验收门槛

- `web`: `npx vue-tsc --noEmit` 和 `npm run build` 都通过；仅 Vite 构建不能替代类型检查。
- 依赖树检查 core/pm 统一 3.32.0，ProseMirror 与 dnd-core 没有不兼容重复实例，显式运行依赖齐全。
- 原 JSON → 编辑 → 保存 → 再打开，文本、marks、段落行高、表格、控件和受控图片不静默丢失；未知节点/属性按协议处理。
- 实际浏览器验证左侧拖入、中文输入、光标进出控件、空节点退格、表格增删/缩放、快捷键、撤销重做、弹窗重开。
- 正文/解析/预览三实例共存；关闭一个不破坏其它实例；所有 preview/review 控件、拖拽、粘贴和命令入口均不可写。
- 多题单选互斥不跨题；模板重复插入无 ID 冲突；只改变当前题的考点/难度；右侧改选项不抹掉富文本。
- AI 异步回填、保存失败、响应丢失重试和旧题转换正确；旧版本与历史答卷不被新编辑覆盖。
- 在考 API 无正确标记/答案/解析；回看冻结顺序正确，选对绿色、选错红色、圈选与正确性独立、漏选可区分。

本轮达到“完成调研并验证关键 API 假设”，没有达到“业务升级完成”或“真实浏览器兼容验收通过”。
