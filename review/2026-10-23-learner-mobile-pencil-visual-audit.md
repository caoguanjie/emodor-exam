# 学员移动端 Pencil 全路由视觉核对

日期：2026-10-23

范围：`docs/ui/gemini.pen`、`mobile/` H5 静态场景路由

结论等级：设计对照完成；不通过“像素级还原”验收；不代表真实接口页面已完成视觉验收

## 1. 结论

本轮已经逐一检查 18 条路由下的 75 个场景，并读取对应的 60 个唯一 Pencil 画板 JSON。Pencil 与浏览器均以 414×844 业务视口对照，浏览器截图关闭动画并等待页面稳定后采集。

当前页面不能称为像素级还原。登录、首页、课程列表、个人资料基础页、实名基础页、考试结果和考试记录已经具备接近设计的主要结构；考试须知、考试弹窗、答题卡、解析卡、资料选择器、图片题、实名错误态、通用空/错状态仍有明显差异。

更重要的是，当前静态 `scenario` 页面不能完全代表生产页面：登录表单存在静态/生产 DOM 差异；考试中心、须知、答题、结果、解析、记录、错题本分别存在 `Static*` 与 `Live*` 两套组件。75 个静态场景全部通过，只能证明静态预览可访问、无报错和可用于设计对照，不能证明真实接口页面已通过 Pencil 视觉验收。

## 2. 核对方法与证据等级

1. 通过 Pencil 工具读取 `gemini.pen` 的 60 个唯一画板完整 JSON、变量和导出图；60/60 画板均存在，正式画板根尺寸均为 414×844。
2. 将 75 个路由场景与 `pencilBoard` 一一建立映射；其中 9 个画板被多个场景复用，因此不是 75 张独立设计页。
3. 执行原有静态浏览器回归：92/92 通过，包括 75 个场景、320/430 两种宽度检查和 15 个交互检查；console error、pageerror、失败资源、意外 API 请求、横向溢出均为 0。
4. 另用临时审计配置在 Chrome 中以 414×844、`fullPage=false`、关闭动画的方式重拍 75 张视口截图；75/75 通过。临时配置和截图在形成报告后删除。
5. 逐张查看 13 张对照表，每张均为“Pencil 左图 / Browser 右图”；像素差异指标只用于排序，未被当作还原率或自动通过标准。

本轮没有向开发数据库写入临时业务数据。无真实数据的页面直接使用项目已有 `scenario` fixture；没有读取 `.env`、真实密钥或短信验证码。

## 3. 系统性差异

### 3.1 设计 token 没有完整落到运行时

- 主色、页面底色、白色卡片和主要蓝色渐变总体一致。
- Pencil 的 `$r-md=12`、`$r-lg=18` 是固定像素；实现大量使用 `rpx`，会随视口换算，无法严格保持 12/18px。
- 考试中心标题设计为 30px，浏览器实际检查为 28px；考试中心卡片和考试记录统计卡也没有使用设计的 18px 大圆角。
- 页面只声明了 Noto Sans SC fallback，没有加载对应字体文件；最终字形由系统字体决定。
- Wot UI 只覆盖了少量主题变量，按钮、输入框、Cell、Popup、Picker、Swiper、Loading 等仍混有组件默认样式。

### 3.2 系统状态栏不是 H5 页面缺陷

Pencil 画板包含 20px 手机系统状态栏，普通 H5 截图不包含浏览器外部的系统栏。正式叠图应从业务内容起点对齐，不能把这 20px 直接算成实现缺陷。

### 3.3 静态预览与生产组件分离

以下生产页面不能用本轮静态截图替代验收：

- 登录：静态使用 `SmsLoginForm`，生产表单写在 `pages/auth/login.vue` 内。
- 首页：静态展示自绘 Banner；真实配置存在时使用 `wd-swiper`。
- 课程媒体：静态为占位播放器；生产为真实 `<video>` 和受控媒体。
- 考试：`StaticExamCenter/LiveExamCenter`、`StaticExamInstructions/LiveExamInstructions`、`StaticExamTake/LiveExamTake`、`StaticExamResult/LiveExamResult`、`StaticExamReview/LiveExamReview`、`StaticExamHistory/LiveExamHistory`、`StaticWrongBook/LiveWrongBook` 分离。

因此，修复视觉差异时应先收敛静态与生产组件，避免只把 `scenario` 页面改漂亮而真实接口页面仍是另一套结构。

## 4. 分组视觉结论

| 范围 | 严重度 | 场景 / 画板 | 已确认差异 |
|---|---|---|---|
| 登录 | 中 | `login-default/v2fcv`、`login-sent/h3DZW`、`login-error/QVBwh` | 品牌背景装饰不足；成功提示由绿色变蓝色；错误态的红色落点不同。 |
| 登录帮助 | 中 | `login-help/Qnobr` | 前置图标、关闭按钮、底部提示颜色和按钮文案均不同。 |
| 首页、课程列表 | 较轻 | `home-default/y208N`、`course-list/Y0ZNqY` | 主要结构接近；品牌区、卡片间距、导航尺寸和文字密度仍不同。 |
| 课程详情、播放器 | 中 | `course-video/esQcE`、`course-no-video/t6Z5eu`、`course-collapsed/B4ZpOc` | 章节容器由圆角卡片变成通栏列表；数量、折叠箭头位置、暂无视频图标不同。 |
| 个人中心 | 中 | `profile-default/gmOqo`、`profile-unverified/jcvqt`、`profile-verified/I69w9x` | 菜单前置图标缺失；已实名颜色由绿色变蓝色；卡片与标题间距不同。 |
| 资料选择器 | 严重 | `profile-job/KNYYf`、`profile-gender/p5YUs`、`profile-birthday/HnYQl` | 选中项底色、取消按钮、分隔线、滚轮选中行、年月日单位和完整日期未按设计实现。 |
| 关于与条款 | 中 | `about-default/PSd26`、`terms-default/cjhAi` | Logo 外框/投影、间距、正文密度和卡片尺寸不同。 |
| 实名基础页 | 较轻至中 | `identity-collect/mRBVM`、`identity-ready/FuNk8`、`identity-detail/P0rCMp` | 主结构接近；图标、复选框、字号和卡片间距不一致。 |
| 实名弹窗 | 较轻至中 | `identity-source/MEvwS`、`identity-face-guide/OMfFk`、`identity-verifying/z3zF4`、`identity-service-error/uD0Us`、`identity-bound/oD7Ix` | 稳定截图中弹窗均已出现；圆角、文字密度、图标和部分按钮文案不同。 |
| 实名错误态 | 严重 | `identity-face-rejected/nJHTm`、`identity-emblem-rejected/M3UfG`、`identity-upload-failed/D8wgXK`、`identity-unsafe/M3UfG` | 红色描边、浅红背景和错误图标弱化或缺失，错误提示强度明显低于设计。 |
| 实名处理中/过期 | 中 | `identity-pending/WfDJI`、`identity-expired/XYPSP` | 状态图标和状态色不符；过期提示实际呈绿色；处理中页保留了额外协议区。 |
| 考试中心 | 中 | `exam-center/JDheF` | 标题字号、卡片圆角、卡片高度和状态标签不同。 |
| 考试须知 | 严重 | `exam-instructions/rMONE` | 蓝色三指标条、三条题型条和规则排版均变成不同的卡片结构。 |
| 草稿与离开弹窗 | 严重 | `exam-draft-recover/pm0zP`、`exam-draft-invalid/qrG44`、`exam-exit-confirm/B2BoLk` | 居中图标、状态胶囊、大圆角和底部分栏操作变成普通文本框与独立按钮。 |
| 交卷状态 | 严重 | `exam-submit-confirm/Te0zp`、`exam-submitting/U56Xsm`、`exam-submit-failed/N1CS8S` | 未答提示、提交阶段、状态图标、按钮布局和底部状态区均不同。 |
| 普通答题 | 较轻至中 | `exam-single/XWexD`、`exam-single-four/E1civC`、`exam-judgment/Og0Md` | 主结构接近；题号、选中数据、间距、圆角和底部按钮细节不同。 |
| 图片题 | 严重 | `exam-images/WsmuO` | 图片素材、卡片高度、字母标签和选中状态位置不同。 |
| 答题卡、解析卡 | 严重 | `exam-answer-card/NThwc`、`exam-review-card/DKmkM` | 格子尺寸、列数、分组、图例和对错表达不同，缺设计中的顶部拖动条。 |
| 超时 | 设计基准过时 | `exam-timeout/QBcws` | Pencil 仍写“自动交卷”；实现按最新决定只锁定并返回，不自动提交。不得要求代码恢复旧行为。 |
| 题目加载失败 | 严重 | `exam-load-failed/bjkJ1` | 图标、说明层级、状态胶囊、操作按钮和整体垂直位置不同。 |
| 考试结果、记录 | 中 | `exam-result/jYoed`、`exam-history/LvODB` | 主信息接近；统计区高度、卡片圆角、标签和底部按钮不同。 |
| 答案解析 | 严重且有覆盖缺口 | `qPj8n`、`jpi31`、`QobCl`、`nSbST`、`DKmkM` | 顶部结果、答案卡和解析区结构不同；错误、未答、漏选状态没有同数据核对。 |
| 错题本 | 严重 | `exam-wrong-book/Mz2RH` | 筛选条、答案描边、答案摘要布局和卡片高度不同。 |
| 通用空/错状态 | 严重 | 所有 `Xgjck` 引用场景 | 实际多用统一灰色书本和实心按钮，未保持设计的语义图标、状态色和描边按钮。 |

较接近但仍不能标成像素一致的场景：`profile-info/OeE1w`、`course-list/Y0ZNqY`、`identity-source/MEvwS`、`identity-detail/P0rCMp`、`identity-service-error/uD0Us`。

## 5. 18 条路由 / 75 个场景覆盖矩阵

| 路由 | 已核对场景 / Pencil 画板 | 路由级结论 |
|---|---|---|
| `/pages/auth/login` | `login-default/v2fcv`、`login-sent/h3DZW`、`login-error/QVBwh`、`login-expired/QVBwh`、`login-loading/U6hQx`、`login-send-failed/O1zuf`、`login-help/Qnobr` | 中等差异；生产表单需另验。 |
| `/pages/home/index` | `home-default/y208N` | 较接近；真实 `wd-swiper` 未验。 |
| `/pages/course/index` | `course-list/Y0ZNqY` | 较接近。 |
| `/pages/course/detail` | `course-video/esQcE`、`course-no-video/t6Z5eu`、`course-collapsed/B4ZpOc` | 中等差异；章节容器明显不同。 |
| `/pages/course/player` | `course-video/esQcE`、`course-no-video/t6Z5eu`、`course-collapsed/B4ZpOc` | 中等差异；真实视频控件未验。 |
| `/pages/profile/index` | `profile-default/gmOqo`、`profile-unverified/jcvqt`、`profile-verified/I69w9x` | 中等差异。 |
| `/pages/profile/info` | `profile-info/OeE1w`、`profile-job/KNYYf`、`profile-gender/p5YUs`、`profile-birthday/HnYQl` | 基础页较接近；选择器严重不一致。 |
| `/pages/profile/about` | `about-default/PSd26` | 中等差异。 |
| `/pages/profile/terms` | `terms-default/cjhAi` | 结构接近，排版仍需精调。 |
| `/pages/identity/index` | `identity-collect/mRBVM`、`identity-source/MEvwS`、`identity-face-guide/OMfFk`、`identity-uploading/rWuDB`、`identity-ready/FuNk8`、`identity-verifying/z3zF4`、`identity-pending/WfDJI`、`identity-success/ePapq`、`identity-face-rejected/nJHTm`、`identity-emblem-rejected/M3UfG`、`identity-upload-failed/D8wgXK`、`identity-load-failed/OLXgA`、`identity-service-error/uD0Us`、`identity-bound/oD7Ix`、`identity-expired/XYPSP`、`identity-camera-denied/mRBVM`、`identity-unsafe/M3UfG` | 基础结构接近；错误态和部分状态色明显不一致。 |
| `/pages/identity/detail` | `identity-detail/P0rCMp` | 较接近。 |
| `/pages/exam/index` | `exam-center/JDheF`、`exam-center-empty/Xgjck`、`exam-not-started/Xgjck` | 中等至严重；生产组件需另验。 |
| `/pages/exam/instructions` | `exam-instructions/rMONE`、`exam-draft-recover/pm0zP`、`exam-draft-invalid/qrG44` | 严重不一致。 |
| `/pages/exam/take` | `exam-single/XWexD`、`exam-single-four/E1civC`、`exam-multiple/E1civC`、`exam-judgment/Og0Md`、`exam-images/WsmuO`、`exam-answer-card/NThwc`、`exam-submit-confirm/Te0zp`、`exam-exit-confirm/B2BoLk`、`exam-timeout/QBcws`、`exam-submitting/U56Xsm`、`exam-submit-failed/N1CS8S`、`exam-load-failed/bjkJ1`、`exam-session-expired/Xgjck` | 普通文字题接近；弹窗、卡片、图片题和异常态严重不一致。 |
| `/pages/exam/result` | `exam-result/jYoed`、`exam-result-unavailable/Xgjck`、`exam-record-missing/Xgjck` | 正常结果中等差异；异常态明显不同。 |
| `/pages/exam/review` | `exam-review-single/qPj8n`、`exam-review-four/jpi31`、`exam-review-judgment/QobCl`、`exam-review-images/nSbST`、`exam-review-multiple/DKmkM`、`exam-review-card/DKmkM` | 严重不一致，且状态数据未对齐。 |
| `/pages/profile/exam-history` | `exam-history/LvODB`、`exam-history-empty/Xgjck` | 正常记录中等差异；空态明显不同。 |
| `/pages/profile/wrong-book` | `exam-wrong-book/Mz2RH`、`exam-wrong-empty/Xgjck`、`exam-wrong-failed/Xgjck` | 明显至严重不一致。 |

## 6. 不能误判的基准限制

- `Xgjck` 是六种状态的组件规范板，不是一张真实业务页。只能比较其中对应的状态卡，不能把“设计六行、页面一项”算成页面缺失。
- `exam-multiple` 复用单选画板 `E1civC`；`exam-review-multiple` 复用带解析卡弹层的 `DKmkM`，没有独立的一对一设计基准。
- `exam-review-single/qPj8n`、`exam-review-four/jpi31` 的设计样例是答错，浏览器样例是答对；`exam-review-judgment/QobCl` 的设计样例是未作答，浏览器样例是答对；`exam-review-multiple/DKmkM` 的设计包含错选和漏选，浏览器样例全对。错误、未答、漏选样式尚未完成同状态核对。
- `exam-timeout/QBcws` 的“自动交卷”是过时设计。当前实现遵守最新业务决定：超时锁定，不自动提交。

## 7. 后续验收门

当前静态场景验收不能作为视觉交付完成。下一轮若实施修正，至少需要：

1. 先统一生产与静态组件，尤其考试七页和登录表单。
2. 按严重度优先修复考试须知、考试弹窗、答题卡/解析卡、资料选择器、实名错误态和通用状态。
3. 为答案解析补齐答错、未答、漏选三类同状态 fixture。
4. 使用真实 API 临时数据重跑生产登录、课程媒体、实名状态和考试全链截图。
5. 再以 414×844 对齐业务内容起点复核；同时保留 320/430 无溢出检查。

在上述门槛完成前，准确表述应为：**功能场景可运行，静态结构大体对应，但未达到 Pencil 像素级还原，真实数据页面尚未完成全量视觉验收。**
