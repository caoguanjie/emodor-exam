# gooodwork COS 业务链与前端交互只读核验

核验时间：2026-10-26。来源工作区：`/Users/caogj/Documents/emodor/gooodwork`。本记录区分当前源码、原项目窄单测与另行执行的真实桶检查。未改动 gooodwork 源码、配置或依赖；原项目前端测试没有加载 `.env`，也没有访问真实 COS。

根智能体另按用户授权将四项 COS 配置导入 RuleExam 私有 `.env`，并使用 RuleExam 专属随机前缀执行真实 COS 探针；该独立证据见 `2026-10-26-cos-cloud-gates.md`，不作为 gooodwork 业务验收，未读取其历史对象。

## 后端业务顺序与可借鉴边界

源码通过图谱定位，再读取具体实现确认：

```text
申请上传会话 → 建 uploading 资产行 → 返回准确对象 PUT 指令
    → 客户端直接上传 COS → complete 读取已上传对象元数据
    → 更新资产状态／扫描结果 → 业务绑定资产
    → 下载接口核对当前用户和 ready 状态 → 返回限时 COS GET URL
```

- `server/applications/conversation_runtime/infrastructure/media_assets/upload.py:38` 的 `create_upload_session` 先校验元数据、生成对象键并创建资产行，再签发上传地址；`:152` 的 `complete_upload` 复核所有者、幂等返回 ready、HEAD 核对元数据，并处理不存在和不匹配的对象。扫描状态还取决于其 `trust_uploads` 和特定用途分支，不能直接把这一分支搬成 RuleExam 的“所有文件可信”。
- `server/applications/conversation_runtime/infrastructure/media_assets/media_asset_service.py:73` 的 `create_download_url` 使用 `get_owned_ready(tenant_id,user_id,asset_id)`，并拒绝实名用途，然后调用存储签名方法。RuleExam 仍需用自己的精确 `media_reference`、课程/考试/头像/品牌授权规则，不能只复制“上传者所有权”。
- `server/interfaces/http/modules/media_asset/assets/asset_routes.py:240` 的下载接口接受 `expiresSeconds`，默认 **300 秒**，允许 **1—3600 秒**；因此 5 分钟不是 gooodwork 后端的硬上限。
- `server/domains/shared/infrastructure/storage/tencent_cos.py:192` 使用官方客户端 `get_presigned_url(Method='GET', Bucket, Key, Expired)`；这里直接签 COS，没有 EdgeOne 重写或播放期间的后台续签。

RuleExam 借鉴“先建记录、直传、完成确认、业务绑定、授权后签 GET”的交互顺序；保留自己的 BIGINT 资源 ID、数据表和历史引用。可恢复分块上传、实际正文探测/哈希、发布竞争保护和网页续签是本次补充能力，不能声称已从该 gooodwork 链路验证成熟。

## 不能照搬的对象权限缺口

根实际只读检查的，是用户要求复用的 gooodwork 本地配置所指向的桶：桶 ACL 为 `public-read`，没有 Bucket Policy。本次没有访问 gooodwork 既有对象，也没有判断其生产进程实际启用了哪个存储实例。

源码证据：

- `server/domains/shared/infrastructure/storage/tencent_cos.py:7` 明确写明依赖桶的公有读，`put_object` 不带 ACL。
- 同文件 `save_private_bytes`（`:133`）、`save_private_file`（`:164`）虽然以 private 命名，但发给 SDK 的参数不含 `ACL='private'`；`create_presigned_upload_url`（`:222`）的签名请求头也没有 `x-cos-acl: private`。
- `server/interfaces/http/composition/media_storage_wiring.py:98` 的私有媒体装配使用同一组 `app_config.cos_bucket/cos_region/cos_key_prefix`，没有在这里切到另一套私有桶配置。

据此可以确定：**在上述公读桶配置下启用这些路径，且没有其它对象权限补写时，新对象会继承桶权限；签名下载接口存在不等于对象已受限时保护。** 腾讯云明确说明上传不指定 ACL 时继承桶权限，[PUT Object 文档](https://cloud.tencent.com/document/product/436/7749)；对象显式 private 可以单独要求签名，[对象权限说明](https://cloud.tencent.com/document/api/436/13324)。根的 RuleExam 临时探针也验证了后一行为。

不能由此断言所有 gooodwork 历史对象均公开，历史对象可能另设了 ACL；本轮未枚举、下载或修改这些对象。RuleExam 已在正式发布、迁移、multipart 初始化及 simple 暂存直传全部显式使用 private；simple 的 ACL 头参与签名，客户端不能移除或改成公读。没有通过修改整个共用桶 ACL 来影响 gooodwork。

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
