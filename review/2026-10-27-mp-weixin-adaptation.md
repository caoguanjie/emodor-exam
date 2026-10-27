# 微信小程序原生适配验收记录

日期：2026-10-27。范围为既有 `mobile/` 的 MP-WEIXIN 适配，不包含账号申请、上传发布或生产部署。实施计划见 [原生适配计划](../docs/superpowers/plans/2026-10-27-mp-weixin-adaptation.md)。当前工作区包含其他会话的引导页、关于页等改动，不将其归为本次交付。

## 已实现

- 网络：统一 API/上传 URL，MP 必须使用明确 HTTPS origin；H5 保留同源请求。缺配置显式报错，不退回无效相对地址。
- 会话：MP 原生请求不自动保持 Cookie，新增精确来源、路径和 Cookie 名称的内存容器；只向 refresh/logout 发送刷新凭据，隔离账号切换、并发退出和迟到回包。凭据不进入持久化、Pinia、日志或 URL。H5 继续使用浏览器 HttpOnly Cookie；MP 内存隔离不等同于浏览器 HttpOnly，冷启动需要重新短信登录。
- 媒体：COS 短链校验不依赖浏览器 URL 全局；原生图片选择核对真实类型、尺寸和大小，压缩后复核，只清理本次拥有的临时文件。相机/相册拒绝给出原生权限提示，上传继续走既有受控 API。
- 界面与生命周期：普通页面、首页及静态/动态答题头部适配状态栏、胶囊和底部安全区；动态考试接入可用时的原生返回询问及 hide/show/unload 草稿生命周期。不能保证拦截微信手势返回或关闭小程序。视频沿用既有原生 videoContext 与服务端计时协议。
- 构建：保持 MP 独立输出，开启合法域名校验，补充公开配置示例、预检查与导入说明。没有生成真实 AppID，没有关闭工具安全设置。

## 自动化证据

| 检查 | 结果 |
| --- | --- |
| mobile 全量单元测试与类型断言 | 64 个文件、610 项通过；网络实现者执行 |
| 原生导航补充检查 | 静态答题头部补齐后，以及登录/首页布局修复后，14 项分别通过 |
| `npm --prefix mobile run type-check` | 通过 |
| `node scripts/build.mjs mp-weixin` | 通过；产物 `mobile/dist/build/mp-weixin/` |
| `node scripts/build.mjs h5` | 通过；根脚本更新 H5 产物 |
| `node --test mobile/test/rich-content-mp-artifact.test.mjs` | 3 项通过 |
| MP 编译产物静态检查 | `platform/`、`api/`、`components/` 未发现浏览器专用 URL/URLSearchParams/window/document/fetch/AbortController 标识；仅为静态证据 |
| H5 登录、课程、考试、富文本浏览器回归 | 34 项通过，Chrome，单 worker |
| 独立代码审查 | 指定范围及后续登录/首页布局补丁均无阻断问题；COS 与基线对比 6,474 个合成变体无新增放行 |

登录/首页布局补丁后再次完成 MP 与 H5 构建、类型检查和 MP 富文本产物检查。34 项 H5 回归执行于这两处仅 MP 布局补丁之前。构建保留上游 Sass legacy API 警告，以及现有 stores/session → stores/learner → api/client → stores/session chunk 循环提示。当前未配置真实 `VITE_API_ORIGIN`，构建只支持静态预览，不代表业务请求可用。

## 微信开发者工具与外部边界

按用户指定，由 `gpt-6.1-terra` 子代理操作 `/Applications/wechatwebdevtools.app`，确认主程序与 Electron 为 arm64，版本 `2.02.2609240`；未使用旧 x86_64 工具。

初次以生成的 `touristappid` 导入时报“系统错误，错误码：1”。通过工具提供的测试号成功导入临时构建副本，原构建配置未改。默认登录页、`pages/home/index?scenario=home-default`、`pages/exam/take?scenario=exam-single` 已渲染，控制台 Errors 0，未见 URL/window 未定义错误。

初轮观察到登录页“帮助”与系统状态栏重叠、首页机构名称出现孤字换行，已修复并由 Terra 更新临时副本重新编译验证：登录标题与帮助位于状态栏下方，帮助在胶囊左侧；首页名称单行省略，未被胶囊覆盖；答题页退出、倒计时、交卷与胶囊未重叠，底部按钮避开手势条。首页底部导航也未遮挡安全区。三页调试器均显示 Errors 0。

本次观察设备为 iPhone 12/13 (Pro)，模拟器缩放 94%，基础库 3.17.4，仅代表这一模拟配置。工具仍出现热重载/资源预加载提示，以及 Wot swiper、LiveExamTake/StaticExamTake 的 WXSS 选择器警告；答题标签选择器在本次修改前已存在，未将这些告警描述为零警告通过。截图由 Terra 的 CUA 工具结果展示，没有单独保存图像文件。

真实业务联调仍需要有效 AppID/测试权限、公开 HTTPS API 与合法域名、隐私配置及实际供应商服务。短信与刷新、真实相机/相册、实名照片、COS 视频切后台、草稿恢复和主动交卷尚未完成微信真机验收。自动化、编译和模拟器静态页面都不能替代上述验收。

## 头部双端兼容修正

用户截图指出上一轮仅检查不重叠，遗漏了标题全屏居中和背景连续性。Terra 在原登录与个人资料页均观察到标题左偏约 48 个截图像素：根因是公共导航行右 padding 包含胶囊宽度，标题在剩余空间中居中。

已查阅用户指定 `.agents/skills/wot-ui-cli/SKILL.md`，并通过项目 CLI 查询 `info/doc navbar --version 2.3.2`。Wot 文档明确不建议小程序自定义导航使用右侧按钮/插槽；[uni-nav-bar 官方说明](https://uniapp.dcloud.net.cn/component/uniui/uni-nav-bar)也说明开启胶囊避让会使标题不再页面水平居中。[uni-app CSS 说明](https://uniapp.dcloud.net.cn/tutorial/syntax-css.html)指出微信端 `--status-bar-height` 为固定 25px；因此继续使用实际窗口与胶囊坐标，不以该固定值代替设备高度。

修正：AppTopBar 标题独立按全宽居中，对称限制标题宽度；MP 解析计数放次行，H5 保持单行；无右侧内容的内页不增加次行。登录顶部帮助两端均移除，底部验证码帮助保留。普通导航透明跟随页面底色，登录蓝色头部保持连续；未调整考试退出/交卷业务。

补丁后 14 项原生导航测试/类型断言、type-check、MP/H5 构建通过。H5 Chrome 390×844 实测登录、个人资料、答案解析标题中心偏差均为 0px，MP 次行未泄漏至 H5、解析计数仍在主行、底部验证码帮助可打开、普通导航背景透明。扩展 H5 回归初次 70 项通过、1 项因 profile-info 场景仍查找旧提示文案失败；同步场景目录到当前页面提示后，该项单独复跑通过（未改页面业务）。独立审查无阻断问题。

Terra 在新版 ARM 工具完成两种模拟机型复验：iPhone 12/13 (Pro) 登录/个人资料标题居中，帮助仅保留底部，普通页浅灰与登录蓝色头部分别连续；答案解析标题居中，19/20 计数独立在胶囊下方次行。Pixel 9（412×923，缩放86%）登录及个人资料同样居中、无胶囊重叠、背景连续。上述场景 Errors 0；解析组件仍有既有 WXSS 选择器警告，另有微信预加载/热重载提示。仅为模拟器静态视觉证据，不等同真机业务验收。

### 18:06 配色调整（覆盖上述普通页灰头决定）

用户最终指定普通页面采用白色导航头，蓝色头保留。AppTopBar 默认使用 surface 白色，并向上覆盖状态栏安全区；light 模式继续透明且不覆盖安全区，保留登录/结果原有蓝色设计。内容区保持浅灰，居中与避让逻辑未改。

H5 Chrome 实测考试记录、个人资料为白头，登录、考试结果保持透明蓝色宿主，4 页标题中心均为 195/390px。H5 与 MP 分别构建通过；Terra 在微信工具 Pixel 9 模拟器确认个人资料状态栏与导航头白色、正文浅灰，登录保留蓝色连续头部；两页标题居中、胶囊未碰撞、Errors 0。仅模拟器静态观察。
