# 学员移动端静态 UI 验收记录（Gate D）

日期：2026-10-22。结论：Task 1—6 / Gate A—D 的学员端底座、静态页面和本记录所列交互通过，可进入按模块 API 联调。此结论不代表真实业务链路、供应商或手机真机验收完成。

## 1. 对象与范围

工作区：`/Users/caogj/Documents/emodor/RuleExam`，当前分支 `main`。实现位于 `mobile/`，采用 uni-app、Vue 3、TypeScript、Wot UI 2.3.2 与 Pinia。依据为 [H5 需求](../docs/design/00-旧系统-学员移动端H5需求分析.md)、[架构决策](../docs/superpowers/specs/2026-10-22-learner-mobile-architecture-decisions.md)、[实施计划 Task 1—6](../docs/superpowers/plans/2026-10-22-learner-mobile-h5.md)及 `docs/ui/gemini.pen` 正式画板。

静态目录合计 75 个路由场景：shell 24、identity 18、exam 33。覆盖登录、首页、课程与播放器占位、个人资料、三图实名状态、考试入口、三种客观题、答题卡、交卷/退出确认、超时锁定、结果、解析、考试记录、错题及通用失败/空态。场景和预期文字的可执行清单位于 `mobile/src/fixtures/route-catalog/{shell,identity,exam}.ts`，由 `index.ts` 汇总。

页面使用少量静态 fixture；实名采集、发送验证码、交卷等动作在本阶段只验证界面状态和交互。考试作答数据与交卷后解析数据分型，正式作答 fixture 不含正确答案、解析或 `checked`；本地选择使用稳定题目/选项 ID，超时锁定编辑且不自动交卷。上述是前端静态实现证据，服务端契约和权威评分留到后续任务。

## 2. 自动化证据

以下结果来自本轮主代理执行记录及独立验证代理回执；本记录编写者核对了计划、场景目录、测试入口和末次 Playwright 状态，没有重复运行构建或浏览器测试。

在仓库根执行：

```bash
npm --prefix mobile run test:unit
npm --prefix mobile run type-check
npm --prefix mobile run build:h5
npm --prefix mobile run build:mp-weixin
PLAYWRIGHT_CHANNEL=chrome npm --prefix mobile run test:e2e:static
```

| 检查 | 最终结果 | 覆盖与限制 |
|---|---|---|
| 单元测试 | 74/74 通过 | 类型/fixture、渲染、选择、状态隔离、返回目标等定向回归 |
| `vue-tsc --noEmit` | 通过 | 学员端类型检查 |
| H5 构建 | 通过 | 产物 `mobile/dist/build/h5/` |
| MP-WEIXIN 构建 | 通过 | 产物 `mobile/dist/build/mp-weixin/`；仅编译兼容 |
| 最终静态 Chrome E2E | 单 worker，91/91 通过 | 四个静态测试文件；全部 75 场景及交互、320/430px 宽度检查 |
| 独立视觉代理浏览器验证 | 86/86 通过，另 responsive 2/2 通过 | 当次候选的 75 场景与交互；与最终 91 项为不同轮次，不相加计数 |

浏览器配置在 `mobile/playwright.config.ts`：系统 Chrome、390×844、触摸/移动视口，开发服务 `http://127.0.0.1:5174`。测试入口为 `mobile/e2e/static-{shell,identity,exam,pages}.spec.ts`。场景通过 `/#<path>?scenario=<scenario>` 打开。自动检查预期内容可见、无 console/pageerror、无失败资源、无意外 `/api/v1/` 请求及无横向溢出；`static-pages.spec.ts` 在 320/430px 各遍历全部 75 场景。

首次全量验证采用默认 4 workers，uni-app 开发服务退出，后续请求出现 `ERR_CONNECTION_REFUSED`。这轮不能作为通过证据。修正为 `test:e2e:static` 显式 `--workers=1` 后完整重跑，最终 91/91 通过；失败归因于验证编排，不据此认定页面业务回归。

## 3. Pencil 与视觉证据

独立视觉代理在 390×844 打开全部场景，并按登录、首页/课程、考试入口、答题、交卷、结果、记录/个人、实名、通用状态九组抽查 Pencil 与浏览器效果；主代理另抽查实名及考试代表页。核对布局层级、字号、间距、颜色、圆角、固定栏、弹层、图片比例和安全区占位，未留下阻断本阶段交付的差异。320/390/430px 检查未见横向溢出。

这是截图/人工抽查与自动布局检查，不是逐像素一致性验收。`identity-camera-denied`、`identity-unsafe` 是无独立正式画板的补充交互状态，复用表中画板布局；多选题复用正式选项卡布局，归档画板不作为实现目标。截图属于已忽略或临时测试产物，后续测试可能覆盖，不作为仓库持久交付物。

下表逐项登记静态场景结果；画板 ID 与 route catalog 一致。`pass` 表示本阶段场景显示及所列布局检查通过，人工视觉覆盖方式以上述九组抽查为准。

### shell：24 场景

| 路由 | 场景 | Pencil | 结果 |
|---|---|---|---|
| `/pages/auth/login` | `login-default` | `v2fcv` | pass |
| `/pages/auth/login` | `login-sent` | `h3DZW` | pass |
| `/pages/auth/login` | `login-error` | `QVBwh` | pass |
| `/pages/auth/login` | `login-expired` | `QVBwh` | pass |
| `/pages/auth/login` | `login-loading` | `U6hQx` | pass |
| `/pages/auth/login` | `login-send-failed` | `O1zuf` | pass |
| `/pages/auth/login` | `login-help` | `Qnobr` | pass |
| `/pages/home/index` | `home-default` | `y208N` | pass |
| `/pages/course/index` | `course-list` | `Y0ZNqY` | pass |
| `/pages/course/detail` | `course-video` | `esQcE` | pass |
| `/pages/course/detail` | `course-no-video` | `t6Z5eu` | pass |
| `/pages/course/detail` | `course-collapsed` | `B4ZpOc` | pass |
| `/pages/course/player` | `course-video` | `esQcE` | pass |
| `/pages/course/player` | `course-no-video` | `t6Z5eu` | pass |
| `/pages/course/player` | `course-collapsed` | `B4ZpOc` | pass |
| `/pages/profile/index` | `profile-default` | `gmOqo` | pass |
| `/pages/profile/index` | `profile-unverified` | `jcvqt` | pass |
| `/pages/profile/index` | `profile-verified` | `I69w9x` | pass |
| `/pages/profile/info` | `profile-info` | `OeE1w` | pass |
| `/pages/profile/info` | `profile-job` | `KNYYf` | pass |
| `/pages/profile/info` | `profile-gender` | `p5YUs` | pass |
| `/pages/profile/info` | `profile-birthday` | `HnYQl` | pass |
| `/pages/profile/about` | `about-default` | `PSd26` | pass |
| `/pages/profile/terms` | `terms-default` | `cjhAi` | pass |

### identity：18 场景

| 路由 | 场景 | Pencil | 结果 |
|---|---|---|---|
| `/pages/identity/index` | `identity-collect` | `mRBVM` | pass |
| `/pages/identity/index` | `identity-source` | `MEvwS` | pass |
| `/pages/identity/index` | `identity-face-guide` | `OMfFk` | pass |
| `/pages/identity/index` | `identity-uploading` | `rWuDB` | pass |
| `/pages/identity/index` | `identity-ready` | `FuNk8` | pass |
| `/pages/identity/index` | `identity-verifying` | `z3zF4` | pass |
| `/pages/identity/index` | `identity-pending` | `WfDJI` | pass |
| `/pages/identity/index` | `identity-success` | `ePapq` | pass |
| `/pages/identity/detail` | `identity-detail` | `P0rCMp` | pass |
| `/pages/identity/index` | `identity-face-rejected` | `nJHTm` | pass |
| `/pages/identity/index` | `identity-emblem-rejected` | `M3UfG` | pass |
| `/pages/identity/index` | `identity-upload-failed` | `D8wgXK` | pass |
| `/pages/identity/index` | `identity-load-failed` | `OLXgA` | pass |
| `/pages/identity/index` | `identity-service-error` | `uD0Us` | pass |
| `/pages/identity/index` | `identity-bound` | `oD7Ix` | pass |
| `/pages/identity/index` | `identity-expired` | `XYPSP` | pass |
| `/pages/identity/index` | `identity-camera-denied` | `mRBVM`（复用） | pass |
| `/pages/identity/index` | `identity-unsafe` | `M3UfG`（复用） | pass |

### exam：33 场景

| 路由 | 场景 | Pencil | 结果 |
|---|---|---|---|
| `/pages/exam/index` | `exam-center` | `JDheF` | pass |
| `/pages/exam/index` | `exam-center-empty` | `Xgjck` | pass |
| `/pages/exam/index` | `exam-not-started` | `Xgjck` | pass |
| `/pages/exam/instructions` | `exam-instructions` | `rMONE` | pass |
| `/pages/exam/instructions` | `exam-draft-recover` | `pm0zP` | pass |
| `/pages/exam/instructions` | `exam-draft-invalid` | `qrG44` | pass |
| `/pages/exam/take` | `exam-single` | `XWexD` | pass |
| `/pages/exam/take` | `exam-single-four` | `E1civC` | pass |
| `/pages/exam/take` | `exam-multiple` | `E1civC` | pass |
| `/pages/exam/take` | `exam-judgment` | `Og0Md` | pass |
| `/pages/exam/take` | `exam-images` | `WsmuO` | pass |
| `/pages/exam/take` | `exam-answer-card` | `NThwc` | pass |
| `/pages/exam/take` | `exam-submit-confirm` | `Te0zp` | pass |
| `/pages/exam/take` | `exam-exit-confirm` | `B2BoLk` | pass |
| `/pages/exam/take` | `exam-timeout` | `QBcws` | pass |
| `/pages/exam/take` | `exam-submitting` | `U56Xsm` | pass |
| `/pages/exam/take` | `exam-submit-failed` | `N1CS8S` | pass |
| `/pages/exam/take` | `exam-load-failed` | `bjkJ1` | pass |
| `/pages/exam/take` | `exam-session-expired` | `Xgjck` | pass |
| `/pages/exam/result` | `exam-result` | `jYoed` | pass |
| `/pages/exam/result` | `exam-result-unavailable` | `Xgjck` | pass |
| `/pages/exam/result` | `exam-record-missing` | `Xgjck` | pass |
| `/pages/exam/review` | `exam-review-single` | `qPj8n` | pass |
| `/pages/exam/review` | `exam-review-four` | `jpi31` | pass |
| `/pages/exam/review` | `exam-review-judgment` | `QobCl` | pass |
| `/pages/exam/review` | `exam-review-images` | `nSbST` | pass |
| `/pages/exam/review` | `exam-review-multiple` | `DKmkM` | pass |
| `/pages/exam/review` | `exam-review-card` | `DKmkM` | pass |
| `/pages/profile/exam-history` | `exam-history` | `LvODB` | pass |
| `/pages/profile/exam-history` | `exam-history-empty` | `Xgjck` | pass |
| `/pages/profile/wrong-book` | `exam-wrong-book` | `Mz2RH` | pass |
| `/pages/profile/wrong-book` | `exam-wrong-empty` | `Xgjck` | pass |
| `/pages/profile/wrong-book` | `exam-wrong-failed` | `Xgjck` | pass |

## 4. 独立代码审查与返修

独立 reviewer 初轮提出 4 项 P2、1 项 P3；定向返修、回归后复审均关闭，Gate D 通过。

| 级别 | 发现 | 修复与关闭依据 |
|---|---|---|
| P2 | `ConfirmSheet` 的 Wot 默认层级 10 低于底部 Tab 20 | `mobile/src/components/common/ConfirmSheet.vue` 显式设为 30；E2E 用 `elementFromPoint` 确认背景 Tab 不可命中，并实测取消留个人中心、确认回登录 |
| P2 | 解析 fixture 实际为 51 分、11 对/8 错/1 未答，结果却硬编码 79 分、16/3/1 | `mobile/src/fixtures/ui-scenarios/exam.ts` 统一派生逐题、类型分、总分和汇总；稳定 ID、`earnedScore`、解析卡及判断题解析均有一致性回归，最终 79 分、16 对/3 错/1 未答一致 |
| P2 | 场景 resolver 返回共享对象，重试会污染 fixture 模板 | shell/identity/exam 三组 resolver 返回 fresh copy，定向测试验证跨调用隔离 |
| P2 | `AppTopBar` 统一 history/home 返回策略不符合 FR-H5-06/14/34 | `mobile/src/components/common/AppTopBar.vue` 增加 `backTarget`/`historyFirst`；课程回课程列表、解析优先历史且无历史回考试中心、错题回个人中心，E2E 验证 |
| P3 | 计划要求 `test:e2e:static`，实际缺少脚本 | `mobile/package.json` 新增对应脚本并固定 `--workers=1`，最终完整命令 91/91 通过 |

此外，浏览器验证发现实名临时材料只在 `onUnload` 清理会被 uni-app 页面缓存/隐藏绕过；已在 `onHide` 与 `onUnload` 均释放，并通过离页再进入的交互回归。资料页姓名、手机号保持只读；课程目录展开/折叠及 `aria-expanded`、favicon 资源均已复核。

## 5. 未验边界与交接

尚未验证真实 API/数据库/Redis 业务闭环、真实短信送达与验证码登录、真实腾讯 OCR/FaceID、真实相机/相册权限与实名材料上传、服务端计时/评分/会话隔离，以及真实视频网络行为。静态登录和实名状态切换不能作为这些能力完成的证明。

微信小程序本轮只验 MP-WEIXIN 构建；微信开发者工具、微信真机、iOS/Android 设备、安全区与系统返回行为均未验。H5 `/mobile/` 子路径、PC/H5 统一构建合包、部署及最终关键考试链路 E2E 属于后续任务。

后续从 Task 7 backend SMS/auth 与 Task 8 mobile auth 开始，按已确认契约并行联调。真实短信成功登录及真实实名认证由用户/明确授权测试人员在功能就绪后亲自操作；本轮未要求或收集真实手机号验证码、身份证或人脸材料。
