# 学员移动端联调契约冻结

更新时间：2026-10-22。本文只冻结跨 lane 接口，避免共享工作区中的前后端并行实现漂移。实现和验收状态仍以对应任务、测试与验收记录为准。

## Gate D：静态页面基线

- 路由目录：shell 24、identity 18、exam 33，共 75 个静态场景。
- 页面路径以 `mobile/src/pages.json` 为准；正常业务页面不得依赖 `scenario` 查询参数。
- 静态 fixture 只用于设计验收，进入联调后由 Store/API 接管正常运行数据；不得把 fixture 当成服务端结果。
- 在考数据与复盘数据分离；在考对象不得出现正确答案、解析或管理元数据。

## Auth Contract v1：Task 7 / Task 8

### 路径与方法

所有响应继续使用全局信封 `{ code, message, data }`。

| 方法 | 路径 | 认证 | 请求 data/body | 成功 data |
|---|---|---|---|---|
| POST | `/api/v1/mobile/auth/sms/send` | Public | `{ phone: string }` | `{ challenge_id: string, expires_in: number, retry_after: number, masked_phone: string }` |
| POST | `/api/v1/mobile/auth/sms/login` | Public | `{ phone: string, challenge_id: string, code: string }` | `MobileSessionResult` |
| POST | `/api/v1/mobile/auth/refresh` | mobile refresh Cookie | 无 | `{ access_token: string, expires_in: number, user: MobileSessionUser }` |
| POST | `/api/v1/mobile/auth/logout` | mobile refresh Cookie；公开幂等入口，不要求 access | 无 | `null` |
| POST | `/api/v1/mobile/auth/debug-login` | Public，仅 test/development 显式开启 | `{ phone: string }` | `MobileSessionResult` |

```ts
interface MobileSessionResult {
  access_token: string
  expires_in: number
  user: MobileSessionUser
}

interface MobileSessionUser {
  id: number
  username: string
  real_name: string
  phone_masked: string
  role: 'employee'
  source: 'institution' | 'external' | null
  category_id: number | null
  identity_status: 'unverified' | 'pending' | 'verified' | 'rejected'
}
```

`identity_status` 在 Task 10 实名权威表落地前只能返回 `unverified`；不得根据姓名、头像或手机号推断已实名。Task 10 保持字段同名并改为权威查询。

### 手机号与短信挑战

- 仅接受规范化后的中国大陆 11 位手机号；输入可去除空格和连字符，但规范化结果必须匹配 `^1[3-9]\d{9}$`。
- 验证码固定 6 位；默认有效期 300 秒、重发 60 秒、每 challenge 最多 5 次；手机号每日 10 次、IP 每日 100 次，均由后端配置。
- 客户端只保存内存中的 `challenge_id` 和倒计时；不持久化验证码。
- 发码和验码均不得向响应或日志返回验证码、完整手机号、供应商签名原文或密钥。
- malformed 参数使用现有 `40001`；未认证/刷新失效沿用 `40101/40103/40107`；短信错误、过期、已消费、次数或频率限制由后端返回非零业务码和可展示 `message`，前端不得按文案判断分支。

### 会话与 Cookie

- PC 保持 `ruleexam_refresh`，Path `/api/v1/auth`。
- mobile 使用 `ruleexam_mobile_refresh`，Path `/api/v1/mobile/auth`，`HttpOnly`、`SameSite=Strict`，生产环境 `Secure`。
- access token 只保存在 Pinia 内存，不写 `uni` storage、localStorage、sessionStorage、URL 或 Cookie；refresh token 只存在 HttpOnly Cookie。
- `auth_session.client` 为 `pc | mobile`，`auth_method` 为 `password | sms | debug`。
- mobile access/refresh JWT 必须绑定 durable `sid`；守卫继续校验用户启用状态、`auth_version`、JTI 黑名单、用户封禁和 session 撤销。
- mobile SMS/debug 登录只允许启用的普通 `employee`，并要求数据库中的有效管理权限集合为空；不能只看 `role`。PC 强制改密规则不阻断短信登录，但不被移动登录清除。

### 前端刷新规则

- `request<T>()` 解包统一信封；业务错误原样携带 `code/message/data`。
- Bearer 请求遇到 HTTP 401 时调用一次 `refreshAccessTokenOnce()`；同一时刻所有 401 共用一个 Promise。
- 每个原请求最多重放一次；refresh 自身、登录和发码请求不得进入 refresh 递归。
- refresh 成功替换内存 access token 和 `MobileSessionUser`；失败清空 mobile 内存态并进入登录页，不触碰 PC Cookie。
- 主动退出调用 mobile logout；该接口只读取并撤销有效 mobile refresh Cookie 对应的 JTI/SID，始终清理 mobile Cookie，不读取或清理 PC Cookie。无论退出接口是否成功，前端都清理 mobile 内存态。考试草稿的清理/保留规则由后续考试模块按用户与 attempt 隔离实现。

### Debug Login 边界

- `SERVER_DEBUG_LOGIN_ENABLED` 默认 `false`；只允许 `NODE_ENV=test|development`，production 尝试开启必须启动失败。
- Debug Login 复用手机号规范化、普通学员关联/创建和同一个 `SessionIssuerService`，不自行伪造 JWT。
- 新建调试学员仍为 `unverified`；debug 只绕过短信，不绕过停用、角色、权限、实名、视频或考试守卫。
- H5 页面不得出现 Debug Login 按钮或运行时 mock code。

## Course/Profile Contract v1：Task 9

### 路径与 ID 口径

以下接口均要求 Bearer access，并继续返回统一信封。除 Auth Contract 的 `MobileSessionUser.id/category_id` 为历史 number 口径外，培训业务的用户、课程、章节、课时和媒体 ID 一律为 string。

| 方法 | 路径 | 请求 | 成功 data |
|---|---|---|---|
| GET | `/api/v1/me/home` | `page?`、`page_size?` | `{site_config: PublicSiteConfig, courses: Page<CourseSummary>}` |
| GET | `/api/v1/me/courses` | `page?`、`page_size?` | `Page<CourseSummary>` |
| GET | `/api/v1/me/courses/:id` | — | `CourseDetail` |
| GET | `/api/v1/me/courses/:id/progress` | — | `CourseProgress`；无分配或无必修视频时返回空进度，不伪造完成 |
| GET | `/api/v1/me/profile` | — | `LearnerProfile` |
| POST | `/api/v1/me/profile` | `SelfProfilePatch`；H5/微信共用 | 更新后的 `LearnerProfile` |
| PATCH | `/api/v1/me/profile` | `SelfProfilePatch`；保留 PC/既有兼容 | 更新后的 `LearnerProfile` |

```ts
interface Page<T> { items: T[]; total: number; page: number; page_size: number }
interface PublicSiteConfig { logo_asset_id: string | null; banners: { asset_id: string; sort: number }[] }
interface CourseSummary {
  id: string
  title: string
  category_id: string
  cover_asset_id: string | null
  status: 'published'
  required_lesson_count: number
}
interface CourseLessonVersion { version_id: string; asset_id: string; duration_ms: number }
interface CourseLesson { id: string; title: string; lesson_type: 'video'; required: boolean; sort_order: number; current_version: CourseLessonVersion | null }
interface CourseChapter { id: string; title: string; sort_order: number; lessons: CourseLesson[] }
interface CourseDetail extends CourseSummary { description: string | null; chapters: CourseChapter[] }
interface CourseProgress { required: number; completed: number; completion_rate: number | null; lessons: unknown[] } // completion_rate 为 0..1
type ProfileGender = 'male' | 'female'
interface LearnerProfile {
  id: string
  username: string
  real_name: string
  phone: string | null
  email: string | null
  avatar_id: string | null
  occupation: string | null
  gender: ProfileGender | null
  birthday: string | null // YYYY-MM-DD
  source: 'institution' | 'external' | null
  category_id: string | null
  role: 'employee' | 'regulation_admin' | 'super_admin'
  status: number
}
interface SelfProfilePatch {
  real_name?: string // 保留 PC 兼容；mobile 页面不编辑该字段
  email?: string | null
  avatar_id?: string | null
  occupation?: string | null
  gender?: ProfileGender | null
  birthday?: string | null
}
```

### 课程可见性与进度

- 启用学员可浏览所有 `status=published` 的课程；`source`、`category_id`、实名认证状态和管理权限不能被误当成课程列表/详情筛选条件。mobile 会话本身仍由 Auth Contract 限定为无有效管理权限的普通 employee。
- 列表稳定排序保持推荐优先、`sort_order ASC`、`id DESC`；分页默认与上限沿用现有后端契约。
- Task 9 不改视频计时或完成判定。`CourseProgress.completion_rate` 的服务端口径是 `0..1`；列表卡片显示时乘 100 并四舍五入，`null` 映射为 0%，不得由客户端播放时间或 `completed/required` 自行重算有效学习进度。
- 正常运行用真实 course ID 导航；带 `scenario` 的静态 Pencil 预览继续只用 fixture、不得发 API 请求。

### 个人资料与 schema

- `019_learner_profile` 在 `sys_user` 增加可空 `occupation VARCHAR(64)`、`gender VARCHAR(16)`、`birthday DATE`；同步 migration、`database/init.sql`、entity 与 03/04 册。Task 10 实名迁移顺延为 `020_identity_verification`。
- occupation 可空，非空去首尾空白后长度 1—64；gender 仅 `male/female/null`；birthday 仅 `YYYY-MM-DD/null`，必须是真实日期且不晚于服务端业务当前日期。
- `phone/source/category_id/role/status/identity_status/username` 不在 `SelfProfilePatch` 白名单，篡改返回 40001。手机号继续只走 Auth Contract 的受控流程。
- mobile 页面将 `real_name` 和手机号作为只读权威字段；本阶段不把静态 fixture 覆盖回服务端。Task 10 接入实名权威状态后，再禁止已实名姓名经 PC 兼容字段修改。
- 头像仍遵守现有私有媒体绑定：上传成功不等于资料已保存；只有 PATCH 成功才更新 `avatar_id` 关联，失败保留本地输入并允许重试。

## Identity/Media Contract v1：Task 10 / Task 11

### 路径、方法与 DTO

除媒体内容流外，以下接口都要求 mobile Bearer access，并继续返回统一信封。媒体内容流只接受短期签名票据，不接受 JWT 查询参数。

| 方法 | 路径 | 请求 | 成功 data |
|---|---|---|---|
| GET | `/api/v1/me/identity-verification` | — | `IdentityVerificationView` |
| POST | `/api/v1/me/identity-verification/images` | multipart `image_type` + `file` | `IdentityImageUpload` |
| DELETE | `/api/v1/me/identity-verification/images/:assetId` | — | `null`；只释放本人尚未进入 session/实名事实的临时材料 |
| POST | `/api/v1/me/identity-verification/sessions` | `IdentitySessionCreate` | `IdentitySessionView` |
| GET | `/api/v1/me/identity-verification/sessions/:sessionId` | — | `IdentitySessionView`；只允许会话本人 |
| POST | `/api/v1/media/:assetId/tickets` | `{ owner_type: string, owner_id: string }` | `MediaTicketView`；owner type 必须已注册且当前用户通过业务授权 |
| GET | `/api/v1/media/tickets/:ticket/content` | 可带单段 `Range` | 原始内容流，成功为 200/206 |

```ts
type IdentityStatus = 'unverified' | 'pending' | 'verified' | 'rejected'
type IdentityImageType = 'id_card_portrait' | 'id_card_emblem' | 'face'
type IdentityReasonCode =
  | 'ID_CARD_PORTRAIT_PARSE_FAILED'
  | 'ID_CARD_EMBLEM_PARSE_FAILED'
  | 'ID_CARD_DOCUMENT_INVALID'
  | 'ID_CARD_EXPIRED'
  | 'FACE_MISMATCH'
  | 'FACE_QUALITY_FAILED'
  | 'IDENTITY_ALREADY_BOUND'
  | 'SESSION_EXPIRED'

interface MediaTicketView {
  content_url: string       // 站内相对 URL，不含 JWT、磁盘路径或供应商凭据
  expires_at: string
}
interface IdentityVerificationView {
  status: IdentityStatus
  real_name: string | null
  id_number_masked: string | null
  verified_at: string | null
  current_session_id: string | null
  reason_code: IdentityReasonCode | null
}
interface IdentityImageUpload {
  asset_id: string
  image_type: IdentityImageType
  scan_status: 'safe'
  processed_preview: MediaTicketView | null // 证件面为服务端处理图；正脸使用本地临时预览
}
interface IdentitySessionCreate {
  face_asset_id: string
  id_card_portrait_asset_id: string
  id_card_emblem_asset_id: string
}
interface IdentitySessionView {
  session_id: string
  status: 'pending' | 'verified' | 'rejected'
  reason_code: IdentityReasonCode | null
  clear_materials: IdentityImageType[]
  expires_at: string
}
```

Provider 暂不可用、存储失败、票据无效/过期等基础设施错误使用现有非零业务码与 HTTP 状态，不伪造成 `rejected`。上传/创建接口的可恢复业务错误统一在错误信封 `data` 返回 `{ reason_code, clear_materials }`；前端不能解析 message 决定分支。正脸问题只清 `face`，单面解析问题只清对应证件面，证件整体无效/过期清两面；未知或基础设施错误保留现有材料。

### 三图上传与私有媒体

- 实名图片只能走本人专用上传接口，不能复用 `/media/upload` 的管理端用途。服务端从 access token 取得 user id；客户端不能传 owner、source、category、实名状态或 scan status。
- 新增三个不可混用的媒体 purpose：`identity_id_portrait`、`identity_id_emblem`、`identity_face`。图片仅接受 JPEG/PNG，原文件最大 10 MiB、最小 320×320；普通图片源像素最多 20M，正脸源图最多 60M 且解码后降采样，最终长边不超过 1600、JPEG Base64 不超过约 2.8M。所有图片修正 EXIF 方向、重新编码并清除元数据；声明 MIME、扩展名和客户端预览都不作为安全结论。
- 身份证面上传阶段执行 OCR、裁剪和清洗，只保存处理后的受控图；正脸保存经图片探测后的私有图。上传成功只代表材料可用于核验，不代表实名通过。
- 每个上传资产绑定当前 user 和对应 purpose。创建会话时再次检查三项资产均为 ready、本人所有、purpose 匹配、未删除且未被其他实名会话替换；三图不能跨用户拼接。
- 上传引用在进入实名 session 前属于临时材料。取消、替换或离页可调用 DELETE best-effort 释放；服务端只删除本人 identity purpose 且没有 `identity_verification_session` / `learner_identity` 引用的资产。仅有临时 user reference 且超过 24 小时未提交的材料由清理任务解除引用后删除；活动 session 和已绑定实名证据必须保留，不受临时清理影响。
- 身份证处理预览、头像、课程封面、视频和题目图片都通过已注册业务 owner policy 签发短期媒体票据。当前 owner type 固定为：`identity_verification_user` + user id、`user_avatar` + user id、`training_course_cover` + course id；视频沿用 `lesson_version_video` + version id，题图 owner 在 Exam Contract 再冻结。票据 HMAC 至少绑定版本、asset、user、purpose、owner type、owner id 和 expiry；默认 TTL 300 秒，过期重新签发。
- 签票前必须存在精确的 `media_reference(asset_id, owner_type, owner_id)`，再调用该 owner policy 的 `authorizeRead(actor_id, owner_id, asset_id)`；仅凭“用户能看某门课程”不能给未绑定到该课程的任意封面签票。实名图片上传成功时就建立 `identity_verification_user` reference，因此证件预览也不允许绕过精确引用。内容接口验证 HMAC 后，仍以票内 actor/owner/asset 重新检查同一 reference、当前业务授权、资产 ready/未删除和签名字段一致性，支持现有单段 Range。票据 URL 不含 access/refresh JWT、真实文件名或磁盘路径；泄漏票据只在短 TTL 内有效。
- Gate G 的 mobile `api/media` 负责票据 URL 生命周期，并承接实名处理预览、个人头像上传/保存、课程封面与头像展示；站点公开 logo/banner 继续走现有公开 branding 内容授权。视频播放票据及重签由 Task 12 承接，考试题图由 Task 13/14 承接。

### 数据、状态机与事务边界

- 迁移固定为 `020_identity_verification`，创建 `learner_identity` 和 `identity_verification_session`；数据库仍不建外键，由 service 在事务内维护引用。
- `learner_identity.user_id` 唯一，`id_fingerprint` 唯一。姓名和证件号使用独立 `IDENTITY_DATA_ENCRYPTION_KEY` 做带随机 nonce/tag 的认证加密；证件查重使用独立 `IDENTITY_FINGERPRINT_SECRET` 做 HMAC。只在返回本人实名视图时解密姓名，证件号只返回脱敏值。
- 会话持久化三项 asset id、材料指纹、provider/session/request id、过期时间、失败码、Provider 执行 claim/lease 和必要的加密 Provider 结果；默认有效期 10 分钟。内部可使用 `created/provider_started/provider_pending/provider_unknown/provider_verified/verified/rejected/expired`，API 只映射为上面的三种 session 状态；`provider_started/provider_unknown/provider_verified` 在绑定完成前仍对客户端显示 pending。
- 创建会话时锁定当前 user。同一用户、相同三资产、未过期的会话直接复用，包括已拒绝终态；连续点击不能重复调用 Provider。同一用户同时最多一个 `created/provider_started/provider_pending/provider_unknown/provider_verified` 非终态会话；新三图遇到旧非终态时返回当前会话冲突/视图，不能取消旧 Provider 或并行新建。只有 verified、rejected 或无结果 expired 后，才可用新材料建立新会话；rejected 的相同材料在未过期时仍复用原终态。
- 已存在 `learner_identity` 的 verified 用户不得再创建核验会话；POST 按下一条返回固定冲突，GET 返回权威 verified 视图。绑定事务必须重新锁定 user，确认本 session 仍是该用户当前可绑定会话且用户尚无实名事实；被取代或迟到的旧 Provider 结果不能覆盖、抢先或改写既有实名。不同三图的双实例并发也必须收敛到同一个当前会话/一次 Provider 调用。
- `POST sessions` 的成功响应始终是 `IdentitySessionView`；若账号已 verified，不伪造 session，而是返回固定 409 业务错误及 `data.status='verified'`，客户端随后 GET 权威视图。
- 外部调用前必须在数据库行锁内取得有期限的执行 claim 并先提交 `provider_started`，同一会话跨实例只允许一个调用者。lease 到期仍没有持久结果时转 `provider_unknown`，不自动再次调用腾讯；API 保持 pending，直到会话到期后由用户明确重新提交。供应商返回到结果落库之间若进程崩溃，系统只能安全地保留 unknown，不能虚构 exactly-once 或冒险自动重试。
- Provider 成功结果先持久化，再在事务中锁定 user 和证件指纹完成绑定。会话 TTL 只终结尚无持久 Provider 结果的 `created/provider_started/provider_pending/provider_unknown`；一旦进入 `provider_verified`，即使超过 10 分钟也必须继续从已保存结果恢复本地绑定，不能过期丢弃或再次调用腾讯。若绑定或投影更新失败，供应商事件和重复查询不会重复建实名记录。
- 绑定成功同时写实名事实、三图引用，并在 session 事务性保存唯一 `bound_event_id/bound_at` 作为脱敏审计事实，再把 `sys_user.real_name` 更新为 Provider 姓名。`AuditService` 的文件日志只在事务提交后 best-effort 输出，不声称和数据库原子；恢复/重放不得产生第二个绑定成功事实。此后 PC/mobile 普通资料接口都不得修改实名姓名；手机号、user id、source、category 和历史业务记录不变。
- 同一证件指纹已绑定其他账号时返回 `IDENTITY_ALREADY_BOUND`，不得静默合并账号。GET 当前实名状态先尝试恢复任意 `provider_verified` 的本地绑定（即使已超过普通 TTL），再以 `learner_identity` 为 verified 权威，最后才以本人最新未过期会话映射 pending/rejected；不能从姓名、导入来源或 Debug Login 推断已实名。

### Provider、配置和测试隔离

- 运行时只接受 `IDENTITY_PROVIDER=disabled|tencent`。`disabled` 仍可读取已有实名状态，但上传/创建新核验返回服务不可用；不存在 mock provider、固定通过码或 `test-pass` 业务路由。
- RuleExam 沿用 `TENCENT_ID_CARD_OCR_*` 与 `TENCENT_FACEID_*` 配置组；任一启用时必须完整校验 `SECRET_ID/SECRET_KEY/ENDPOINT/HTTP_TIMEOUT_SECONDS`，`TOKEN` 可选。`IDENTITY_PROVIDER=tencent` 时两组都必须启用并在启动阶段 fail-fast。
- 腾讯身份证 OCR 使用正反面固定 side，校验证件字段、有效期和阻断性风险告警；FaceID 只发送 OCR 姓名、证件号和现场正脸 Base64，相似度阈值沿用参考实现的 70。OCR/FaceID 超时或未知结果都不做 Adapter 内自动重试，避免供应商已经计费却被重复调用；配置、权限、计费、限流和上游不可用 fail-closed，不映射为用户材料拒绝。
- FaceID 本期按 gooodwork 当前源码明确使用 `ImageRecognitionV2`（API version `2018-03-01`），请求只含 `IdCard/Name/ImageBase64`；不得误用已停止接入新客户的旧 `ImageRecognition` action。
- 新增 `IDENTITY_DATA_ENCRYPTION_KEY`、`IDENTITY_FINGERPRINT_SECRET`、`MEDIA_TICKET_SECRET`、`MEDIA_TICKET_TTL_SECONDS`。真实值只经运行环境注入；只要启用 `IDENTITY_PROVIDER=tencent`，任何环境都必须稳定注入前两项，防止重启后密文不可解或证件指纹漂移。响应、日志、异常和测试产物不记录证件号、原图、Secret、Token 或签名原文。
- 自动化只在 Nest 测试模块 override `IdentityProvider` 为 `FakeIdentityProvider`，并使用无真实姓名、证件号或人脸信息的合成图片。Fake 仍必须经过上传、归属校验、session、轮询、Provider 结果持久化和绑定事务，不能直接写 `identity_status`。
- 真实腾讯 OCR/FaceID、真实材料和 H5 相机权限由用户或授权测试人员后续手工验收；自动化通过只证明 RuleExam 业务链路，不代表真实供应商或微信真机通过。

### Mobile 状态机

- 登录不强制跳实名。实名页正常运行先 GET 权威状态；读取失败显示重试，不能当作 unverified 或 verified。
- 身份证两面允许拍照/相册；`face` 只允许现场拍摄入口。取消不上传；替换/离页释放本地 Object URL/临时文件，并对尚未进入 session 的远端材料 best-effort DELETE。页面请求 epoch 立即失效，但不撤销已开始的后端核验。
- 三图均 `safe`、两面证件均有处理预览、已同意协议且无请求进行中才可 POST session。pending 首次立即查询，之后每 800ms 查询一次，合计最多 12 次；耗尽后保留 pending 并允许稍后手动查询。
- session 返回 verified 后必须再次 GET 本人实名视图，只有权威视图为 verified 才显示成功和清理材料。账号切换、退出或新 session 后，旧上传/轮询响应不能覆盖新账号状态。

## Video Contract v1：Task 12

### 路径、方法与 DTO

所有接口继续使用全局信封 `{ code, message, data }`。下列 `/me` 视频接口只接受 `client=mobile` 且当前仍为 `employee` 的 access token；PC password 会话不能借这些接口创建或维持学员视频会话。

| 方法 | 路径 | 请求 | 成功 data |
|---|---|---|---|
| POST | `/api/v1/me/video-sessions` | `{ lesson_id: string }` | `VideoSessionView` |
| POST | `/api/v1/me/video-sessions/:sessionId/heartbeat` | `{ seq: number, position_ms: number, state: VideoPlaybackState }` | `VideoProgress` |
| POST | `/api/v1/me/video-sessions/:sessionId/close` | 无 body | `VideoProgress` |
| GET | `/api/v1/me/video-records?page=&page_size=` | 无 body | `Page<VideoRecordView>` |
| GET | `/api/v1/me/courses/:courseId/progress` | 无 body | `CourseProgress` |
| POST | `/api/v1/media/:assetId/tickets` | `{ owner_type: 'lesson_version_video', owner_id: version_id }` | `MediaTicketView` |

```ts
type VideoPlaybackState = 'playing' | 'paused' | 'buffering' | 'background' | 'ended'

interface MediaTicketView {
  content_url: string
  expires_at: string
}

interface VideoProgress {
  confirmed_position_ms: number
  credited_ms: number
  coverage_ms: number
  duration_ms: number
  completed: boolean
  last_seq: number
}

interface VideoSessionView {
  session_id: string
  version_id: string
  heartbeat_interval_ms: 30000
  media: {
    asset_id: string
    ticket: MediaTicketView
  }
  progress: VideoProgress
}

interface CourseLessonProgress extends VideoProgress {
  lesson_id: string
  version_id: string
}

interface CourseProgress {
  required: number
  completed: number
  completion_rate: number | null
  lessons: CourseLessonProgress[]
}
```

- `lesson_id/session_id/version_id/asset_id` 都是十进制字符串 ID；客户端不得用 number 承载。
- 课程进度的每个课时项必须携带稳定 `lesson_id/version_id`，移动端按 ID 映射目录完成态和断点；不得依赖数组下标、章节内排序或当前页面临时会话推断历史进度。
- `start` 必须按同一轮权威读取选定课时的 current version，并返回该版本的 `asset_id` 和 `lesson_version_video + version_id` 精确引用所签票据。移动端不能用课程详情缓存的旧 asset/version 拼播放地址。
- 票据即将过期时，移动端用 start 返回的 `asset_id/version_id` 调用通用媒体票据接口重签；只更新 `src` 并恢复当前播放器位置，不重建学习会话、不伪造心跳或累计时长。票据 URL 不含 JWT、真实文件名或磁盘路径。
- 若 start 事务提交后、票据返回前发生换版/下架/授权变化，服务端必须收口本次新 session 后再失败，不能留下客户端不知道的活动会话。签票失败不得返回半成品 `VideoSessionView`。

### 开播资格、可见性与错误

- 课程列表、详情、目录、本人历史记录和已有进度仍按登录后的只读能力返回；未实名可以浏览，读取失败不能默认成已实名或未实名。
- 创建/恢复播放会话与签发/读取视频票据必须同时满足：mobile employee 会话、账号启用、`learner_identity` 已存在、课程仍为 published、课时属于该课程且类型为 video、课时仍指向本次 current version、版本时长大于 0、视频 asset ready/purpose=video，并存在精确 `lesson_version_video + version_id` 引用。
- `external` 与 `institution` 学员采用相同课程学习资格；`category_id` 为空或课程类别不同不再额外阻止 published 课程学习。课程进度分母也按当前 published 课程的 required video lessons 计算，不再使用旧的 institution/同类别分配规则；零必修课时仍返回 `completion_rate=null`。
- 未实名/被拒绝返回 40302，`data.reason_code='IDENTITY_REQUIRED'`；核验处理中返回 40302，`data.reason_code='IDENTITY_PENDING'`。移动端只按结构化 `reason_code` 引导实名，不解析 message。
- 已结束/被替换的 session 继续返回 40950；下架、换版、媒体引用失效或课程已不可学返回 40951，并先关闭活动 session。遇到 40950/40951 时客户端停止播放、停止定时心跳并刷新权威课程进度，不自动创建新 session。
- `lesson_version_video` 必须区分两类授权上下文，不能为了学员短票破坏 PC 课程管理员的既有受控预览：通用 Bearer 内容读取继续允许具备 `courses:read` 的管理账号读取其管理范围资源；普通学员走通用读取时也必须满足实名、published/current version，不能绕过播放门槛。video 资产不能使用 `asset.owner_id === actor_id` 的上传者短路授权，必须经过 `lesson_version_video` 精确引用和对应 policy；因此历史上传者后来变成普通学员也不能绕过实名/current。短票的签发和每次读取则使用独立的 learner-only authorizer（可作为 owner policy 的 `authorizeTicket` 上下文），严格重查 actor 仍是启用 employee、无有效管理权限、已有实名事实、published/current version 和精确引用，不接受管理员旁路。换版、下架、引用撤销、角色/权限变化或账号停用会即时使旧学员短票失效。

### 服务端计时红线

- `VideoSessionService.start()` 新建 session 时初始锚点固定为 `paused`，位置取 `confirmed_position_ms`。只有播放器实际触发 `play` 后，客户端才发送第一拍 `playing`；该拍只建立锚点，不计开播请求、加载和 seek 等待时间。
- 心跳周期采用响应的 `heartbeat_interval_ms=30000`。`seq` 从 `progress.last_seq + 1` 开始并严格递增；重复或乱序请求幂等返回现有进度。
- 只有上一锚点是 `playing` 且当前状态是 `playing/ended` 的连续区间可计时。`paused/buffering/background` 不计时；非 playing→playing 的首拍只重置锚点。
- 服务端先校验 `forward_position <= server_elapsed + 2000`，再结算 `credited_ms=min(server_elapsed,45000,forward_position)`；前端不上报自算有效时长，也不发送 elapsed、累计秒数或完成标志。
- 覆盖区间合并去重；重复观看可增加 `credited_ms`，不得重复增加 `coverage_ms`。`coverage_ms >= duration_ms * 0.95` 后完成状态单向置位。
- `close` 只关闭所有权并返回既有进度，不补算未上报区间；90 秒 stale sweep 同样只收口，不补时。算法常量和 `creditVideoInterval()` 语义不因 Task 12 改动。

### Mobile 播放器状态机

- 正常业务路由读取 `course_id/lesson_id`，但进入页面和浏览目录不自动 start。只有用户主动点击播放才创建 session；静态 `scenario` 路由继续使用 fixture，保持零 API 请求。
- 使用 uni-app 原生 `<video>`，不引入 video.js。`play/pause/waiting/ended` 分别映射为 `playing/paused/buffering/ended`。播放器从 `waiting` 自然恢复时，H5/小程序不保证再次触发 `play`；因此在仍有播放意图、页面处于前台且未暂停时，buffering 后首个确认位置继续前进的 `timeupdate` 只发送一次 `playing` 重建锚点。除此之外 `timeupdate` 只更新最新毫秒位置，不能逐事件请求后端。
- `error` 只作为 UI 状态，显示“视频加载失败，请重试”，不能把 `error` 发送给后端；进入错误态前发送可用的非播放状态以截断 playing 锚点。断网沿用原生 loading/buffering，不做离线缓存、补时队列或历史心跳重放。
- 页面/应用隐藏时暂停播放器、立即上报 `background` 并停止周期心跳；回到前台保持暂停，用户再次点击播放后第一拍只重置锚点。`onHide` 不关闭 session，`onUnload` best-effort close；强制关闭或系统回收由服务端 stale sweep 收口。
- `ended` 发送最后一拍后停止周期心跳、移除当前原生播放 src 并刷新课程进度，不能让原生控件脱离 session 直接重播。学员点击“重新播放”时创建新 session，本次播放器从 0 开始；服务端历史进度和完成事实不清零，第一拍仍只建立锚点。
- 票据续签、切换课时、账号切换、页面卸载都必须使用 session/revision/登录 epoch 防迟到响应；旧 session 的 start/ticket/heartbeat 回包不能覆盖当前课时。心跳请求串行，同一 seq 不并发；网络失败不排队重放。
- 同一播放器实例的 start/close 还必须进入一条串行队列，不能只靠 revision 丢弃旧 start 回包：A 课时 start 在途时切到 B，先等待 A；若 A 成功则按其 `session_id` close，再为仍然最新的 B 发 start。A 请求超时、结果未知时保持 stopped，不自动并发补发；用户下一次明确点击播放时由新的 start 走服务端单活跃会话收口。测试必须覆盖 A/B 切换乱序，最终只有最新目标可播放且旧成功 session 不遗留。
- 心跳 flight/待发送状态必须归属于具体 session；旧 session 的 40950/40951 后续权威刷新不得占住新 session 的心跳锁，新 session 的第一拍必须立即发送。
- 正常恢复从 `progress.confirmed_position_ms` 开始，显式重新播放按上一条从 0 开始。移动端可用本地已连续 playing 到的位置限制明显向前拖动；暂停、buffering、background 的墙钟时间不能累积为允许向前 seek 的额度。最终以 heartbeat 返回的 `confirmed_position_ms` 为准，不把本地播放器位置写成权威进度。
- H5 同源相对 `content_url` 可直接作为 video src；微信小程序适配层负责转为已配置合法域名的 HTTPS 完整地址。微信域名白名单、Range、签名 URL、原生拖动和全屏仍需开发者工具/真机验证，H5 自动化不能替代。

## Exam Contract v1：Task 13 / Task 14

本节覆盖新培训考试的 `/me` 移动端链路。旧制度固定卷 `/exams/*` 仅保留历史兼容，不作为 PC 学员入口，也不得读取 training assignment/release 或绕过实名、稳定 ID、整卷提交与 timeout 规则。

### 路径、身份与状态查询

所有 `/me` 考试接口只允许启用中的 mobile employee 会话；PC 管理端只保留 `/admin/exam-records`、题库、组卷和只读结果。PC 删除 `/my/exams`、`/my/exams/:paperId` 路由及对应导航，直接访问也不能进入学员答题页。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/me/exams` | 可考列表；已登录但未实名可以浏览 |
| POST | `/api/v1/me/exams/:paperId/start` | 新开考或恢复本人同卷有效 active attempt |
| GET | `/api/v1/me/exam-records/:recordId` | 权威 attempt 状态；进行中才返回题目 |
| POST | `/api/v1/me/exam-records/:recordId/submit` | 学员主动整卷交卷 |
| GET | `/api/v1/me/exam-records/:recordId/result` | 主动交卷结果或 timeout 结果 |
| GET | `/api/v1/me/exam-records` | 本人考试记录 |
| GET | `/api/v1/me/wrong-questions` | 本人已主动提交结果中的错题 |

新移动端不提供 `PUT /me/exam-records/:id/draft` 和 `POST /me/exam-records/:id/heartbeat`。服务端不得从草稿、读状态、恢复、任务清扫或 Redis 过期事件触发自动交卷或评分。

新开考、恢复进行中题面和主动提交都要求已存在的 `learner_identity` 权威事实。`unverified/rejected` 返回 40302 与 `data.reason_code='IDENTITY_REQUIRED'`，`pending` 返回 40302 与 `data.reason_code='IDENTITY_PENDING'`；Debug Login 不产生实名事实。供应商配置 disabled 不否定已保存的 verified 身份。

已有 active attempt 不因学员之后类别/来源变化、试卷撤回或题库变化而重抽题或重置期限；但没有实名事实时不能再次取得进行中题面或提交。期限仍继续。状态查询先按本人记录在事务锁内检查期限：已过期则先收口为 timeout，再返回终态；终态状态与历史结果不要求再次实名。

```ts
type AttemptTerminalStatus = 'submitted' | 'passed' | 'failed' | 'timeout'

interface AttemptQuestionV2 {
  item_id: string
  type: 'single' | 'multiple' | 'judgment'
  score: number
  stem: ReadonlyTiptapDoc
  options: Array<{ id: string; content: ReadonlyTiptapDoc }>
}

type AttemptRecordViewV2 =
  | {
      status: 'in_progress'
      record_id: string
      paper_id: string
      release_id: string | null
      deadline_at: string
      server_now: string
      questions: AttemptQuestionV2[]
    }
  | {
      status: AttemptTerminalStatus
      record_id: string
      paper_id: string
      release_id: string | null
      deadline_at: string
      server_now: string
      questions: []
    }
```

`POST start` 返回同一结构。恢复已有 active 时沿用原 `record_id/snapshot/deadline_at`，不重新抽题或延时。`server_now` 是本次响应生成时的服务端时间；客户端只能据此校准倒计时，不能把本地墙钟或断网时间补回期限。

### 受限题目内容、稳定 ID 与兼容列

**2026-10-23内容版本增量**：下文“文本节点不允许marks”和深度4等限制继续精确定义schema2，不能宽松解释。schema3使用独立白名单：段落、h1—h4、引用、列表、代码块、水平线、有限表格、受控图片，以及有限marks/字体/字号/颜色/对齐/缩进/行高；每字段最多2,000节点、100,000字符、16层，表格网格/跨度必须合法。作者链接和控件只静态投影可见文本，学员内容仍禁止URL、HTML、CSS字符串、事件、答案标记及管理元数据。mobile使用uni节点只读递归渲染，不安装Tiptap或执行作者控件。

开考、恢复、提交、结果、错题请求支持`X-Question-Content-Version`，缺省/`2`保持schema2原响应，只有字符串`3`声明新显示能力；其题目增加`content_schema_version:2|3`。提交body不变，仍为稳定item/option ID整卷。内容需要3而客户端仅2时返回409/40901及`reason_code=CONTENT_VERSION_REQUIRED,required_content_version=3`；首次创建assignment/record/题单之前拒绝，在考提交拒绝也不写答案或评分。到期状态读取仍先纯timeout，不让升级提示阻止期限收口。前端收到升级提示保留当前attempt、答案、期限和最小本地草稿。

022只追加版本作者原稿、试卷布局与owner/request唯一的提交回执，不回填旧原稿、不改旧内容/快照/答案/成绩。作者原稿、答案与幂等回执仅供管理端；既有表单修订在同事务内同步schema3与原稿，无法无损转换整次拒绝。当前新写/审核/新发布只接受easy/hard，历史medium/unknown继续读取和统计。具体验证与未验边界见[本次验收记录](main-question-designers-acceptance-2026-10-23.md)，不据文档同步宣称浏览器、微信或真机已验。

`ReadonlyTiptapDoc` 首版只接受递归白名单：根节点 `doc`；块节点 `paragraph` 或受控 `image`；段落内只允许 `text`、`hardBreak`、受控 `image`。每个对象只允许该节点声明的字段，文本节点不允许 marks，图片 attrs 只允许十进制字符串 `asset_id`。禁止任意 `src`、HTML、链接、样式、事件属性、答案标记和管理元数据。单文档最多 2,000 个节点、文本合计最多 100,000 字符、最大深度 4；未知、超限或畸形内容整题拒绝，不做宽松透传。

在考投影必须从冻结快照递归重建，只输出 `item_id/type/score/stem/options[{id,content}]`。任何层级都不得出现 `checked/correct/answer/correct_answer/analysis/rubric/source/difficulty/draft_revision/answers`；错误响应也不得带冻结答案或原始管理 JSON。

迁移 `021_exam_stable_option_ids.sql` 只新增兼容列：

- `question.content_schema_version TINYINT UNSIGNED NOT NULL DEFAULT 1` 与 `question.content_json JSON NULL`；
- `question_version.content_schema_version TINYINT UNSIGNED NOT NULL DEFAULT 1` 与 `question_version.content_json JSON NULL`；
- `exam_answer.selected_option_ids JSON NULL`。

v2 `content_json` 保存受限 `stem/options/analysis` 以及 `answer_option_ids`；option ID 在同一 question version 内非空且唯一，编辑重排不得重建既有 ID。现有非空 `stem/options/answer/analysis` 列继续写兼容投影，供旧 PC/导题路径渐进兼容；v2 权威答案是 `answer_option_ids`，不是展示下标。

021 不改写旧 `question/question_version` 内容、版本 checksum、`paper_release_question.snapshot_json`、`exam_record_question.snapshot_json`、历史 `exam_answer` 或既有成绩。legacy 读取适配只使用当时冻结快照：旧数字答案代表原始下标，稳定 ID 映射为该快照 `options[originalIndex].key`，不能使用显示下标或当前题库。旧 key 缺失、重复或不合法时返回数据契约错误，禁止随机补 ID 或静默丢弃。

AI、DOCX/文件导题与现有 PC 表单可以继续提交 legacy HTML、`{key,text}` 和数字答案，但必须统一经过 `question-content.ts` 转成 v2 后再创建新版本。PC 编辑器的 `checked` 只表示编辑中的正确性，保存时转换为 `answer_option_ids`；它与学员本次 `option_ids` 完全独立。

乱序只改变题目和选项展示顺序，不改变 `item_id` 或 option `id`。新 v2 snapshot 直接冻结稳定 ID；legacy snapshot 继续保留原数据和 `display_to_original`，只在读取/评分边界适配，不回写历史。

### 整卷提交、锁与幂等

```ts
interface SubmitAttemptRequest {
  record_id: string
  answers: Array<{
    item_id: string
    option_ids: string[]
  }>
}
```

主动交卷 body 只能有上述字段，嵌套对象也严格拒绝未知字段。`record_id` 必须是十进制字符串且与路径一致；拒绝旧 `revision/selected/asset_ids`、数字 ID 和非数组值。

首次有效提交必须满足：`answers` 的 item 集合与冻结题单完全相等，每题恰好出现一次；未答题显式传 `option_ids=[]`；option ID 在该题内存在且不重复；single/judgment 最多一个，multiple 可以是任意不重复子集。缺项、重复题、未知题、跨题选项、重复选项或题型数量非法均返回 40001。

处理顺序固定为：认证 mobile employee → 查询并确认本人记录 → 事务内悲观锁记录 → 根据锁后状态/期限仲裁 → 仅对仍在进行且未截止的首次提交严格校验 body 与评分。这样既不通过校验错误泄露他人记录，也不让第二次不同答案覆盖首次结果。

- 已为 `passed/failed`：忽略重复请求携带的答案内容，直接返回第一次冻结结果，不重新评分、不新增答案、不重复发布副作用。
- 已为历史 `submitted`：只返回 `LegacySubmittedResult`，不校验或接受新答案、不重试评分；新记录永远不生成该状态。
- 已为 `timeout`：忽略答案并返回 timeout 冻结结果，不能转为主动提交。
- 仍为 `in_progress`：在拿到锁后取唯一 `accepted_at`；只有 `accepted_at < deadline_at` 才接受。相等或更晚立即按纯 timeout 收口。
- 首次主动提交把同一 `accepted_at` 写为 `submitted_at`，在同一事务写答案、评分、`submission_method='manual'`、`grading_state='finalized'` 和 `passed/failed`。
- 事务失败不产生半终态；重试重新锁记录。并发两份不同答案、submit 与 timeout 竞争时只能有一个终态和一组副作用。

`exam_answer.selected_option_ids` 保存 v2 稳定 ID；新 v2 评分只比较冻结 `answer_option_ids`。legacy `/exams/*` 可继续使用数字 selected 的兼容 adapter，但不能访问 training release；其到期规则也必须改为纯 timeout，不再从 Redis 暂存答案评分。

### 纯 timeout 与结果模型

所有到期入口必须调用同一个纯 timeout 收口：主动提交锁后发现过期、attempt 状态读取/恢复、定时任务和 legacy Redis 过期事件语义一致。纯 timeout 原子写入：

```text
status = timeout
score = 0
submitted_at = NULL
submission_method = NULL
grading_state = not_submitted
graded_at = NULL
active_assignment_id = NULL
draft_revision = 0
draft_payload_hash = NULL
draft_saved_at = NULL
```

纯 timeout 不调用评分、不创建 `exam_answer`、不生成逐题得分。若升级前的 active record 已有服务端草稿答案行，收口时只删除该 record 的非终态草稿 `exam_answer` 并清空 draft 元数据；不改写任何历史终态记录、已发布快照或成绩。

```ts
interface FinalResultItemV2 extends AttemptQuestionV2 {
  selected_option_ids: string[]
  correct_option_ids: string[]
  analysis: ReadonlyTiptapDoc | null
  gained_score: number
}

interface FinalResultV2 {
  record_id: string
  status: 'passed' | 'failed' | 'timeout'
  grading_state: 'finalized' | 'not_submitted'
  submission_method: 'manual' | 'timeout' | null
  legacy: boolean
  submitted_at: string | null
  graded_at: string | null
  score: number
  passed: boolean
  correct_rate: number | null
  items: FinalResultItemV2[]
}

interface LegacySubmittedResult {
  record_id: string
  status: 'submitted'
  grading_state: 'not_submitted'
  submission_method: null
  legacy: true
  submitted_at: string | null
  graded_at: null
  score: null
  passed: null
  correct_rate: null
  items: []
}

type FinalResultView = FinalResultV2 | LegacySubmittedResult

interface ExamHistoryItemV2 {
  record_id: string
  paper_id: string
  paper_title: string | null
  attempt_no: number
  status: 'in_progress' | 'submitted' | 'passed' | 'failed' | 'timeout'
  grading_state: 'not_submitted' | 'finalized'
  submission_method: 'manual' | 'timeout' | null
  legacy: boolean
  source: 'institution' | 'external' | null
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed' | 'unknown'
  score: number | null
  started_at: string
  submitted_at: string | null
  graded_at: string | null
}

interface WrongItemV2 extends FinalResultItemV2 {
  record_id: string
  submitted_at: string
  legacy: boolean
}
```

主动提交结果为 `passed/failed + finalized + manual`，返回本人稳定 option IDs、正确 option IDs、解析和逐题得分。timeout 固定返回 `score=0/passed=false/correct_rate=null/items=[]`，移动端展示“超时未交卷”；它不是自动提交，不开放逐题解析，不进入错题本，也不进入 finalized 成绩/排名分母。历史列表仍显示该 timeout 记录。`legacy` 由冻结快照/schema 与历史事实判断，不能再用 `!submission_method` 推断，因为新 timeout 的 submission_method 也为 null。

历史 `submitted/timeout` 等旧终态保持只读兼容；现有历史 timeout 若曾自动评分不回写，最终状态仍按历史事实返回 passed/failed，并可带 `submission_method='timeout'`、历史分数和明细。历史 `status='submitted'` 只按上面的 `LegacySubmittedResult` 返回，移动端显示“历史结果待确认”，不得伪映射为 passed、failed 或新纯 timeout。错题分页沿用统一 `Page<WrongItemV2>`；新纯 timeout 无条目，旧的 finalized 历史 timeout 可继续按既有历史事实出现在错题中。新行为只约束升级后的 active/new records。

### 题图短票与反泄漏

题图统一使用 `owner_type='exam_record_question'`、`owner_id=item_id`，不能改用 question/version ID。v2 JSON 图片节点只保存 `asset_id`，移动端按 item 申请短票；票据和内容读取都重查精确 `media_reference`、当前账号、记录归属及允许阶段。

- `in_progress` 只允许仍在 deadline 前、当前 owner 已实名且可恢复该 attempt 时读取冻结题干和选项引用的资产；解析资产即使猜到 ID 也拒绝。到期读取先按权威状态收口为 timeout，再拒绝题图。
- `passed/failed` 允许该冻结结果题干、选项和解析引用的资产。
- 新纯 `timeout` 不开放任何 exam-record-question 票据或内容；历史已评分 timeout 按既有冻结结果权限保留题干、选项与解析图片，只读兼容且不得回写。
- PC 管理员继续通过独立 Bearer `exam_records:read` 预览；该旁路不能签发 learner 短票。
- 当前账号不能申请其他学员、跨 record 或错误 item 的票据；撤销引用、业务资格失效或票据过期时读取失败。内容 URL 是 `@Public` 短票入口，读取时以票据 claims.user 重查原学员业务资格，不依赖浏览器当前 Bearer 会话；因此单纯在同一浏览器切号不承诺立即吊销尚在 TTL 内且原学员仍有效的旧 URL。客户端切号必须清空旧 URL 和迟到异步结果，新账号不能据此把资产纳入自己的状态。若需要“切号即吊销 URL”，必须另加 session/revocation 版本契约，不在本 Gate 扩大。

legacy HTML 的受控图片提取与 v2 JSON 的 `asset_id` 提取都必须经过同一阶段权限，不得因适配旧数据扩大解析图可见性。

### Mobile 本地草稿、倒计时与结果不明

本地草稿 key 固定为 `ruleexam:mobile:<userId>:exam-draft:<recordId>`，值只能包含：

```ts
interface LocalExamDraft {
  answers: Record<string, string[]>
  currentIndex: number
  savedAt: string
}
```

不得保存题目、正确答案、解析、deadline、token、服务端草稿字段或管理元数据。每次答案变化复制完整快照并用 `uni.setStorage` 写入；同一 key 串行写，旧写不能覆盖新写。`onHide/onUnload` 只补一次同样快照；只有落盘成功才显示“草稿已保存”。写失败必须可见，但不阻止内存继续答题。

每个用户维护 `ruleexam:mobile:<userId>:exam-draft-index` 记录其草稿 record ID，配合写入 generation/tombstone：主动登出、主动提交成功或服务端确认 terminal 后清理时，迟到的旧写入不能复活草稿。普通 401 只清题目内存和会话，保留当前用户草稿；同一用户重新登录、联网查询原 record 仍为 in_progress 且未截止后才可合并恢复。切换用户绝不读取前一用户 key。

重进顺序固定为：联网获取服务端 attempt 状态与不可变题目快照 → 校验本地草稿的 item/option ID → 仅在整份草稿合法时合并。草稿缺失、损坏或含任何未知 item/option ID 时，整份草稿按损坏处理，同一 attempt 以空答案继续，不做部分恢复、不重抽题、不重置期限。刷新后离线因为没有题目快照，只显示网络重试，不能仅靠草稿渲染整卷。

倒计时采用 `offsetMs=Date.parse(server_now)-Date.now()` 校准，剩余时间始终以 `deadline_at-(Date.now()+offsetMs)` 计算。归零只锁定编辑并查询权威 record 状态，绝不调用 submit。短时断网时页面内仍可改答案并保存本地，服务端期限照常推进。

主动交卷二次确认后冻结一份完整 payload，进入 submitting 后不再允许修改。网络结果不明时：先查询 record；已 `passed/failed` 进入第一次结果，已 `timeout` 进入超时结果，历史 `submitted` 进入“历史结果待确认”且绝不重试提交，仍 `in_progress` 且未截止时最多自动重试一次完全相同的冻结 payload。再次不明则停在“结果确认中”，保留冻结 payload 与草稿并提供继续查询/重试；禁止改答案后冒充同一次重试，也不能直接显示成功或失败成绩。

答题页不提供普通返回和底部导航。页面内退出、H5 浏览器返回及小程序返回尽可能弹出强确认；用户明确确认后可以离开且保留草稿。浏览器强关和系统回收无法绝对拦截，由本地草稿兜底。

### Gate H2 最低验收

- 单元/真实数据库竞争覆盖稳定 ID、legacy 快照转换、反泄漏、严格整卷校验、两份不同答案并发、submit/timeout 争锁、锁等待跨 deadline、事务回滚后重试和副作用只发生一次。
- 明确验证 countdown、recover、状态读取、sweeper、heartbeat/旧 draft 路径和 Redis 事件都不会自动提交、评分或写答案。
- mobile 覆盖草稿乱序写、清理后迟到写、401/换号/登出隔离、离线页面内答题、离线刷新失败、主动提交、结果不明、timeout、记录/错题与媒体票据。
- PC 覆盖学员答题菜单与深链接均关闭，题库编辑/预览、AI/文件导题、组卷、管理端只读记录继续可用。
- 静态 `scenario` 的 33 个考试设计场景继续零 API；生产路由不得读取 fixture。
- H5 自动化不能替代真实短信、腾讯实名、微信开发者工具/真机返回拦截和真实弱网验收，这些继续标记未验。
