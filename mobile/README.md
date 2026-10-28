# 学员移动端

uni-app + Vue 3 + TypeScript + Pinia + Wot UI 2.3.2，提供独立学员 H5 与微信小程序入口。PC 管理端的登录状态不与此端混用。Node.js ≥22，依赖固定在本目录 `package-lock.json`。

## 官方底座来源

- 模板仓库：<https://github.com/dcloudio/uni-preset-vue/tree/vite-ts>
- 初始化日期：2026-10-22
- 初始化时 `vite-ts` 分支提交：`e5a5f0539416a0f012c919cc77949d140542a367`
- 官方 CLI 文档：<https://uniapp.dcloud.net.cn/quickstart-cli>
- 项目要求：Node.js ≥22，使用 npm 和本目录的 `package-lock.json`。

首次初始化命令：

```bash
git ls-remote https://github.com/dcloudio/uni-preset-vue.git refs/heads/vite-ts
npx degit dcloudio/uni-preset-vue#vite-ts mobile
npm --prefix mobile install
```

后续安装固定依赖：

```bash
npm --prefix mobile ci
```

## 运行与检查

在仓库根目录执行：

```bash
npm --prefix mobile run dev:h5 -- --host 0.0.0.0
npm --prefix mobile run type-check
npm --prefix mobile run test:unit
node scripts/build.mjs h5
node scripts/build.mjs mp-weixin
```

正式构建统一使用根脚本。MP 输出为 `mobile/dist/build/mp-weixin/`，独立于 PC/H5 的网站 `dist/`。

本地头像上传：后端 `MEDIA_UPLOAD_MODE=auto`（默认）在 development/test 返回中转模式，H5 通过 `/media/upload` 交给后端校验并保存到配置的 COS 或 local；手机局域网 HTTP 不执行直传所需的 Web Crypto 操作。可显式配置 `proxy`（别名 server/backend）或 `direct`（别名 presigned），local 始终中转；修改后手动重启后端。生产 auto + COS 仍直传，需 HTTPS 和匹配的 COS CORS。H5 头像直传的 PUT 若发生网络/CORS 拒绝，可回退一次中转；取消、会话切换、明确 COS HTTP 错误及完成确认异常不回退。该设置不改变 COS 下载短链的跨域要求。

## 微信开发者工具导入

开发测试登录：根 `.env` 配置 `VITE_TEST_LOGIN_ENABLED=true`，后端同时配置 `NODE_ENV=development`、`SERVER_DEBUG_LOGIN_ENABLED=true`，短信可以保持 disabled。重新启动前端开发编译后，H5 和小程序开发版登录页会显示「测试登录（免验证码）」；填写有效测试手机号并同意协议即可登录，未知手机号会创建新学员。复用正式会话管理及小程序内存刷新凭据，不绕过实名、账号停用、管理账号隔离或考试规则。正式生产构建不显示此入口且客户端调用会拒绝。

H5 使用 `npm --prefix mobile run dev:h5`；小程序开发版使用 `npm --prefix mobile run dev:mp-weixin`，导入 `mobile/dist/dev/mp-weixin/`。小程序默认仍需 HTTPS origin；仅开发者工具本机模拟器可显式配置 `VITE_MP_LOCAL_HTTP=true` 和 `VITE_API_ORIGIN=http://127.0.0.1:3000`。此例外须运行 dev:mp-weixin（development 模式），并在工具「详情 → 本地设置」勾选不校验合法域名、web-view 域名、TLS 和 HTTPS 证书；只允许 localhost/127.0.0.1，正式构建仍拒绝 HTTP，真机不能以此连接电脑。正式打包前须将 API 地址改为实际 HTTPS 服务地址。根 `.env` 中的变量只在启动或编译时读取，更改后须重新启动对应进程。

1. 执行 `node scripts/build.mjs mp-weixin`，在微信开发者工具中导入 `mobile/dist/build/mp-weixin/`。
2. 源码 `src/manifest.json` 的 `mp-weixin.appid` 故意留空。导入时选择微信提供的测试号，或填写自己申请的真实 AppID。构建生成的 `touristappid` 不保证被工具接受：本次 ARM 工具 2.02.2609240 导入时报错误码 1，改用工具的测试号后成功。若导入框锁定 AppID，可复制产物到临时目录，仅清除该副本 `project.config.json` 的 `appid` 后重新选择测试号；不要修改源码来伪造 AppID。静态预览不代表可上传、发布或真机业务联调。
3. 需要重复使用真实 AppID 时，在开发者工具项目设置中配置；不要把工具生成文件中的本地修改当成源码配置。若决定把公开 AppID 固定到源码，应填写 `src/manifest.json` 的 `mp-weixin.appid` 后重建。
4. 合法域名校验默认开启，保持该设置。检查服务器域名和隐私保护指引后，用拥有相应权限的测试号/正式 AppID 联调。

无 `VITE_API_ORIGIN` 时允许编译静态场景，在工具启动参数中加入例如 `scenario=home-default`，与现有静态预览保持一致。真实请求会报告配置缺失，不会退回相对路径或虚构服务地址。

## 公开环境配置与域名

示例见 [`.env.mp-weixin.example`](.env.mp-weixin.example)。生产构建使用 Vite 的 `production` 模式，可把所需公开值放到本机 `mobile/.env.production.local`（不提交），也可运行期注入。项目级公开默认值仍可来自根 `.env`，优先级为运行期值、mobile 模式文件、根默认值。**所有 `VITE_*` 都会进入客户端，禁止放置密钥、口令或服务端令牌。**

```bash
# 以下都是占位示例，须替换为实际公开域名；不要填写任何密钥。
VITE_API_ORIGIN=https://api.example.test node mobile/build/check-mp-config.mjs
VITE_API_ORIGIN=https://api.example.test node scripts/build.mjs mp-weixin
```

`check-mp-config.mjs` 只检查当前进程的公开配置，不读取 `.env` 文件，也不执行构建/上传。缺少 API、非 HTTPS、带路径或凭据的 origin、COS 配置缺项会退出 1；通过时输出需要核对的域名列表。Vite 在 MP 编译时也拒绝显式无效的配置；缺少 API 只提示静态预览限制。

| 配置 | 用途与格式 |
| --- | --- |
| `VITE_API_ORIGIN` | 必填业务 API origin，例如 `https://api.example.test`；无 `/api/v1`、尾部 `/`、查询参数或凭据。微信后台 `request`、`uploadFile`、`downloadFile` 合法域名均核对此域名。 |
| `VITE_COS_MEDIA_ORIGIN` | 仅使用 COS 媒体短链时配置，例如 `https://example-1250000000.cos.ap-shanghai.myqcloud.com`；须是后端实际签发的批准桶域名，并配置到 `downloadFile` 合法域名。 |
| `VITE_COS_MEDIA_PREFIX` | 与 COS origin 同时配置，格式 `ruleexam/<scope>/media/`，无开头 `/`；必须匹配后端实际媒体目录。 |

头像、身份证和现场照通过原生 `uni.uploadFile` 上传到受控 API，不把 COS 密钥交给小程序。小程序不自动保持浏览器 HttpOnly Cookie：刷新凭据仅在内存中保留，冷启动需要重新短信登录；不会把刷新凭据写入本机 storage。

## 原生行为与验收边界

自定义导航使用 `uni.getWindowInfo()` 和 `uni.getMenuButtonBoundingClientRect()` 的实际坐标为状态栏、右上胶囊和底部安全区留位；不支持的 API 使用普通导航高度回退，H5 保持现有布局。

答题期间，在支持的微信基础库（2.12.0+）启用 `enableAlertBeforeUnload` 页面返回询问。确认退出、交卷锁定、进入结果和页面卸载时清除提示；页面隐藏/卸载继续保存本人本机草稿。微信手势返回和关闭小程序无法绝对拦截，退出不暂停服务端倒计时；不要依赖 `onBackPress` 拦截微信退出。接口行为依据本地官方 `@dcloudio/types`，对应[微信返回询问文档](https://developers.weixin.qq.com/miniprogram/dev/api/ui/interaction/wx.enableAlertBeforeUnload.html)。

编译、类型与自动化检查不能替代微信开发者工具及真机验收。实际联调需检查短信登录与刷新、相机/相册拒绝后恢复、实名照片上传、COS 视频播放与切后台、草稿退出/恢复及主动交卷。域名备案/主体权限、供应商开通及微信隐私配置由实际账号和部署状态决定。

## 手机照片压缩（2026-10-27）

头像、身份证正反面和现场正脸共用客户端图片处理：选择结果最多 25 MiB、6400 万像素；等比缩至最长边 1600 像素，并检查输出不超过 2.1 MiB。超过输入上限提示改用普通拍照模式，不接受无限大图；压缩失败不回退上传超大原图。人脸仍只能调用现场相机，身份证两面保留相册入口。

- H5：`chooseImage.sizeType` 不保证压缩，使用浏览器图片解码及 Canvas JPEG 编码；缺少 `createImageBitmap` 时使用图片元素兼容路径。
- 微信小程序：`getImageInfo` 检查来源，`compressImage` 指定目标宽高并压缩，再检查实际输出的类型、宽高和字节数。尺寸参数需要基础库 2.26.0+，旧版本忽略尺寸时不会把成功回调当成已压缩。
- Wot UI 2.3.2 的 Upload 用于选择/展示/上传，`max-size` 是字节检查；本项目继续复用独立图片处理与带鉴权的上传链路，没有更换为不受控直传。
- 服务端实名的文件探测、最小 320×320、EXIF 修正、去元数据、OCR/FaceID 和媒体用途校验仍独立执行。前端压缩成功不代表实名认证成功。

核对依据：项目 CLI `wot doc Upload --version 2.3.2`；[uni-app 图片 API 与平台差异](https://uniapp.dcloud.net.cn/api/media/image.html#unicompressimageobject)、[MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)、[MDN Canvas.toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)。
