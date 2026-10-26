# gooodwork COS 前端交互只读核验

核验时间：2026-10-26。来源工作区：`/Users/caogj/Documents/emodor/gooodwork`。本记录只说明当前源代码和实际执行的窄单测；没有改动 gooodwork 源码、配置或依赖，没有读取 `.env`，没有访问真实 COS。

## 已确认的调用链

```text
useAgentAttachments.handleDialogFilePreview
  -> useAttachment.previewFile
     -> 已有 webSrc：直接预览
     -> 远程 URL：attachmentCache.ensureLocal
        -> Web：原 URL 返回
        -> 原生：命中缓存或完整下载，再返回本地 URI
  -> showAttachmentVideoPreview
  -> AttachmentVideoPreview
  -> AttachmentVideoPlayer / xgplayer
```

来源均位于 gooodwork `client/`：

1. `src/views/AgentsPage/hooks/useAgentAttachments.ts:54`、`:58`：父调用方将 `previewFile` 的视频回调传给 `showAttachmentVideoPreview`，只回写缓存状态，没有重签调用。
2. `src/composables/useAttachment.ts:97`、`:428`：`getRemoteUrl` 取已有 `remoteUrl/url`。视频优先使用已有 `webSrc`；否则调用 `ensureLocal`，把结果交给回调。此入口没有凭 asset ID 重新获取签名 URL。
3. `src/native/attachment-cache/index.ts:8`：按 `Capacitor.isNativePlatform()` 选择 Web 或原生实现。
4. `src/native/attachment-cache/provider.web.ts:4`：Web 不下载文件。它直接把输入远程 URL 同时作为 `localPath`、`webSrc` 返回，并报告 100%。因此此处的“cached”状态不能证明 Web 已完整缓存视频。
5. `src/native/attachment-cache/provider.native.ts:83`、`:88`、`:110`：原生实现先查本地缓存，未命中时等待 `FileTransfer.downloadFile` 完成，再返回本地路径及 `convertToWebSrc`。已完整下载后的播放不再依赖原远程链接；下载开始及下载中的过期行为没有真机证据。
6. `src/components/media/showAttachmentVideoPreview.ts:40`、`:61`：函数式弹层只传入 `options.src`。`AttachmentVideoPreview.vue:19` 继续原样传给播放器。
7. `src/components/media/AttachmentVideoPlayer.vue:41`、`:67`：播放器用 `props.src` 初始化；只有 `props.src` 发生变化时调用 `switchURL`。此组件没有到期时间、重签计时器、重签 API 或续签后恢复进度逻辑。
8. `src/services/mediaUpload.ts:248`：`withDownloadUrl` 在上传完成后申请一次下载地址，调用不传 `expiresSeconds`，返回结果仅保留 `downloadUrl`。其单测 `src/services/__tests__/mediaUpload.spec.ts:235` 的模拟响应为 300 秒，断言的是一次调用与返回地址，没有等待过期。

结论：可以借鉴申请时鉴权、返回 COS 短期签名 GET 的方式。不能把 gooodwork 现有 Web 播放流程当成已经解决长视频过期、过期后拖动或续播的证据。RuleExam 需要保留自己的自动续签和学习会话规则。

## 实际执行的验证

为了避免加载原 Vite 的 mise 环境读取和生成插件，使用临时目录中的最小 Vitest 配置：`envDir: false`、仅 Vue 插件、`@` 指向 client 源码、空 PostCSS 插件、缓存放临时目录；没有加载原 `client/vite.config.ts`。

实际配置：`/var/folders/_b/8g0796l93xbc8__ccj6vg5y40000gn/T/goodwork-cos-media-tests-lzcviw3i/vitest.config.mjs`。执行命令：

```bash
node client/node_modules/vitest/vitest.mjs run \
  --config "$(cat /tmp/goodwork-cos-media-tests-config-path)" \
  --configLoader native \
  src/services/__tests__/mediaUpload.spec.ts \
  src/components/media/__tests__/AttachmentVideoPlayer.spec.ts \
  src/components/media/__tests__/AttachmentVideoPreview.spec.ts \
  src/components/media/__tests__/showAttachmentVideoPreview.spec.ts \
  src/composables/__tests__/useAttachment.spec.ts \
  src/native/attachment-cache/__tests__/provider.web.spec.ts \
  src/native/attachment-cache/__tests__/provider.native.spec.ts \
  --reporter verbose
```

结果：7 文件、50 测试通过，退出码 0。分布为媒体上传 6、播放器 6、预览弹层 6、函数式预览 3、附件 hook 19、Web 缓存 2、原生缓存 8。

另执行了父 hook 的 `src/views/AgentsPage/__tests__/useAgentAttachments.spec.ts`：5 个测试均失败，原因是招工身份测试未提供当前 store 要求的已确认 `companyId`，在 `src/store/assistant.ts:403`、`:423` 被拒绝。这些用例测试附件提交/角色，不覆盖视频预览。未为使其通过而修改来源项目。

## 尚未验证

上述播放器单测使用 xgplayer mock；原生下载测试使用 FileTransfer/Filesystem mock。它们不能代表真实浏览器或原生播放器。

本次没有验证真实 COS 的五分钟后持续播放、重新建立 Range 请求、拖动到未缓冲片段、后台恢复、过期后的下载或断网恢复。也没有验证数千并发或任何生产环境。执行后 `git status --short -- client` 为空。
