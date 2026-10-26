# COS 共桶预检与配置提案

RuleExam 沿用 gooodwork 的 COS 桶和同一套后端 `SecretId/SecretKey`。本目录只提供预检工具及追加配置建议，不创建长期身份，不修改桶 ACL、版本控制、CORS、Policy 或已有身份权限。应用前缀约束不等于共享长期密钥之间存在 IAM 隔离。

工具直接加载 `server/node_modules` 已锁定的 `cos-nodejs-sdk-v5@3.0.0` 与 `qcloud-cos-sts@3.1.3`。不需要构建或启动 Nest，不启动定时任务，不连接数据库，不读取任何 `.env` 文件。环境变量由 Node 或调用方注入；仅检查 `COS_BUCKET`、`COS_REGION`、`COS_KEY_PREFIX`、`COS_SECRET_ID`、`COS_SECRET_KEY`，可选 `COS_SESSION_TOKEN`。

## 默认只读检查

从仓库根运行以下准确命令：

```bash
node --env-file=.env scripts/media/cos-preflight.mjs --inspect
```

省略 `--inspect` 仍执行只读检查。工具查询桶是否可访问、实际地域、ACL、版本状态、CORS 规则数量与 Policy 可读性/语句数量。不列举业务对象，不输出密钥、临时凭据、完整签名、Policy Principal、ACL owner 或真实对象键。

如需读取已批准对象的元数据，追加 `--key '<本项目准确对象键>'`，可再追加 `--version-id '<准确版本>'`。键必须严格位于 `COS_KEY_PREFIX` 内，不能是前缀本身、路径穿越、通配符或其它项目的键；校验发生在创建 SDK client 之前。元数据输出只有长度、版本是否已定位、ETag/CRC64 是否存在，不读取正文。

状态含义：

- `pass`：本项查询或明确列出的探针断言成功。ACL 查询成功不证明 Policy 不会额外授予公开读取。
- `unknown`：权限不足、无法确认或供应商响应异常，不能当作通过。
- `fail`：已确认的目标不符或断言失败。
- `not-run`：本次没有验证此能力。

只读检查中的 STS、真实签名传输和浏览器 CORS 均为 `not-run`。`metadata_complete` 只说明已完成所需元数据检查。`ready=false`、`g0=not-verified` 明确保留真实应用及浏览器验收门。版本 `enabled`、`suspended`、`unconfigured` 都是可识别的状态，不会因此要求修改共享桶版本控制。

CLI 退出码：`0` 表示本次所请求的元数据检查完成且探针未失败；`2` 表示元数据仍有未知/未满足项；`1` 表示参数、工具执行或显式探针失败。不得把退出码 `0` 当成 G0、业务、真机或容量已通过。

## 生成可审阅提案

```bash
node --env-file=.env scripts/media/cos-preflight.mjs --render-proposal --out '<受控运维目录>/cos-proposal.json'
```

没有提供页面来源时，文件状态为 `needs-origins`，完整保留现有 CORS 规则，不生成虚构域名或通配来源。确认 PC/H5 的真实页面 origin 后，通过可重复的 `--origin` 参数提供；只接受完整 HTTPS origin，或 HTTP 的 `localhost`、`127.0.0.1`、`[::1]` 开发来源。不得携带路径、用户名、口令、查询参数或 fragment。

文件以 `0600` 创建，新目录为 `0700`；已存在的提案不会被覆盖。建议放在主仓库和 worktree 之外。控制台只报告状态和数量，具体配置在私有提案文件中审阅。

提案包含以下追加建议：

1. **CORS**：原规则逐条原样保留后追加精确来源的 `GET/HEAD/PUT`。允许 `Authorization`、`Content-Type`、`Content-MD5`、`Range`、`x-cos-security-token`、`x-cos-sdk-retry`；这些覆盖已安装浏览器 SDK 的上传、临时授权与重试路径。暴露 `ETag/Content-Range/Content-Length/Accept-Ranges`。保留原 `ResponseVary`，另列推荐值供人工审阅。浏览器自行控制 `Content-Length`，前端不手动设置。
2. **CSP**：仅列出 `img-src/media-src/connect-src` 需追加的标准桶 origin，保留所有现有指令和其它来源。域名固定由有效配置生成：`https://<COS_BUCKET>.cos.<COS_REGION>.myqcloud.com`；不猜测自定义域名，不自动改 nginx。
3. **前端公开配置**：`VITE_COS_MEDIA_ORIGIN` 为上述标准桶 origin；`VITE_COS_MEDIA_PREFIX` 为 `<COS_KEY_PREFIX>media/`。它们是公开定位配置，不能放入 `SecretId/SecretKey/token`。实名 `identity/` 与临时 `staging/` 不进入公开媒体前缀。
4. **微信小程序**：列出对应 request/uploadFile/downloadFile 域名的控制台登记建议。当前小程序仍保留既有代理上传兼容路径；建议不代表已启用小程序直传或已通过设备验收。
5. **必要动作**：只列缺失权限审阅时可能使用的动作与准确键示例，不复制敏感 Principal，不替换现有共享身份策略。桶级 list/metadata 动作的资源及前缀条件须由已有权限 owner 核对。`policy.template.json` 是动作参考，不能作为完整 CAM/桶策略一键覆盖。

`cors.template.json` 的来源数组故意为空；必须先读取真实桶规则并通过工具生成保留原规则的提案。CORS 控制浏览器跨域行为，不提供对象权限隔离。提案没有 `apply` 入口。

## 经准确前缀授权后的写入探针

以下是模板，必须先由操作者确认完整临时前缀和私有 journal 路径；本地自动化不会执行真实 COS 探针：

```bash
node --env-file=.env scripts/media/cos-preflight.mjs --probe --approved-prefix '<COS_KEY_PREFIX>staging/probe/<已批准的UUIDv4>/' --out '<受控运维目录>/cos-probe-journal.json'
```

除显式 `--probe` 外没有任何云写操作。只允许本项目 `staging/probe/<UUIDv4>/` 这个准确命名空间，不接受根前缀或任意业务目录。每次生成三个随机唯一键，先逐键 HEAD 确认全部不存在，再开始云写。403/未知不会被解释为不存在。

探针使用自有的 64 字节随机内容；普通写与 multipart 初始化携带 `private` ACL 及随机 ownership metadata。实际对象 ACL 再通过 SDK 读取确认，不凭桶 ACL/Policy 读取失败推断私有。PUT URL 的 metadata/ACL 请求头通过真实 SDK 参与签名；云端若拒绝这些头或相应动作，探针失败，不能靠放宽授权冒充通过。

探针依次验证精确键临时授权的 simple PUT、multipart UploadPart/ListParts、服务端合并、准确版本元数据、签名 GET 完整哈希、Range 206、越界 416、无签名读取拒绝、已过期签名拒绝以及签名换键拒绝。临时授权拒绝测试只使用本次批准前缀内的另一个自有随机键，不向 gooodwork 业务键发写请求。multipart 越键测试使用本次另建且已登记的 uploadId，不能把 `NoSuchUpload/404` 当作权限拒绝。

STS 探针申请 60 秒有效期，并留出响应余量；逻辑等待上界 10 秒，返回有效期仍受预留截止约束。腾讯 SDK 没有暴露 abort 参数，逻辑超时不代表底层网络请求已经取消。真实供应商是否接受短期授权必须以实际探针结果为准，不假定其它云的最短有效期限制适用。

## 准确清理与未知状态

先以 `0600` journal 持久记录本次键、ownership、实际哈希和写意图，再进行云写；已返回的 uploadId/VersionId 随即以同目录原子替换写回 journal。journal 没有正文、凭据或签名 URL，但包含私有定位，须保存在受控目录。

- 仅 Abort 本次明确登记的 uploadId，不枚举并取消其它任务。SDK 自身若重试初始化，工具会保留“可能存在未返回 ID”的未知状态；即使最后一次成功，也不会把未知任务当成已清完。
- 有真实 VersionId 时只删除已核对的准确版本。供应商的字符串 `"null"` 也是准确版本，不能当作无版本省略。
- 没有 VersionId 且明确未启用版本控制时，仅在本次随机、预先确认不存在的准确键上，HEAD ownership、长度及流式完整内容哈希均匹配后才删除。暂停版本控制若返回 `"null"` 使用准确版本；无法确认版本定位时保留并报告未知。
- 未知 PUT 回应不会盲目重传；仅对登记的准确键分页读取版本，再逐版本核对 ownership 和实际哈希。使用 SDK 真实 `KeyMarker/NextKeyMarker` 与 `VersionIdMarker`，不采用错误类型声明中的 `Marker`。
- 未知、读取拒绝、内容变化、意外 delete marker 或清理失败均保留为 `cleanup.status=unknown`，探针整体不通过。不会删除 ownership 或哈希不符的对象，不扫描或删除其它项目内容。

进程被强制终止时可能留下 journal 和临时对象。工具拒绝覆写/自动续跑旧 journal；先审阅该准确 journal 中的键、版本和未知项，再决定恢复或清理。不要重复写未知键、修改日志把未知改成成功，或以新前缀掩盖旧清理待办。

## 验证边界

```bash
node --test tests/cos-preflight.test.mjs
```

自动化使用 SDK stub 与本机 HTTP/XML/JSON 服务，覆盖实际 SDK 请求形状和安全拒绝路径，不使用真实环境变量或云资源。即使真实探针全部通过，也只证明列出的 COS/STS 能力；真实浏览器 CORS、应用签票与续签、正式 ready 对象、实名隔离、业务引用、学习心跳、设备与并发容量仍须单独验收。统一结果由 `review/2026-10-26-cos-cloud-gates.md` 记录。
