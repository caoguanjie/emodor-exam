# 04 · API 设计 —— 制度学习及考试系统（EmodorRuleExam）

> **一句话定位**：本文档定义 EmodorRuleExam 的 `/api/v1` 全量 REST 接口契约——统一响应结构、八大模块路由、接口清单与参数、核心接口 JSON 示例、统一错误码表与限流幂等约定，是前后端并行开发的对接契约。
>
> **口径基准**：本文档所有表名、字段名、枚举值、角色值、模块名与 [README.md](README.md) 逐字一致；接口行为与 [05-模块设计.md](05-模块设计.md) 的模块内部设计逐条对应（章节引用形如「05 册 5.4.3 节」）。

> **状态边界（2026-10-22）**：Task13/14 / Gate H2已实现并自动验证：新移动考试使用三类客观题、稳定ID/受限Tiptap、本地草稿、实名主动整卷提交与纯timeout。主动截止前受理才自动评分；到期不提交、不评分。旧`/exams`数字协议仅兼容制度固定卷，不能访问training release；历史已评分timeout保持只读。PC只保留题库、组卷与只读记录。真实后端浏览器全链、真实短信/腾讯、真实弱网和微信开发者工具/真机仍未验。其他已删除能力不因兼容路由恢复。

> **试题入口合同（2026-10-26）**：`/admin/questions` 提供查询、人工录题、修改、预览、状态开关与逻辑删除；独立 `/admin/questions/import` 提供文件导入和参考题AI预览确认。旧考点CRUD、审核、资料直接生成与历史题直接重生成写路由退场；AI配置、旧任务／结果及历史来源读取继续保留。当前AI确认入口见§3.5.3，不新增资料AI或单题预览路由。

> **移动认证增量（2026-10-22）**：§3.1.1 登记学员 H5 短信认证、独立 mobile 会话与调试登录的当前接口。真实手机号收码/验码仍需人工验收；接口与自动回归通过不能替代真实短信、实名供应商或微信真机验收。

---

## 1. API 总体规范

### 1.0 作者文档与显示能力增量（2026-10-23）

下列接口均使用现有信封和管理端权限，不建立独立单题设计器入口：

| 方法 | 路径 | 权限与合同 |
|---|---|---|
| GET | `/admin/questions/authoring-options` | `questions:read OR questions:write`；仅非敏感目录元数据，`{difficulties:[{code,label,enabled,sort}]}`，当前 easy/hard 启用，medium 识别但停用 |
| POST | `/admin/question-documents/assemble` | `questions:read`；`{version_ids:string[]}`，1—100个不重复精确版本，返回 `AuthoringBundle` |
| POST | `/admin/question-documents/commit` | `questions:write`；`{request_id:UUID,bundle:AuthoringBundle}`，整个批次与回执同事务保存 |
| GET | `/admin/question-documents/commits/{requestId}` | `questions:write`；仅当前owner回执可见，未知或其他owner为404；成功返回原精确版本结果 |

`AuthoringBundle={document,option_ids,identities,layouts}`；document为schema_version=1的作者正文/题目属性；`identities[client_id]={question_id,expected_version_id,expected_enabled}`，已版本化的expected_version_id传字符串、真正legacy显式null；既有身份还必须显式传所见布尔expected_enabled；`option_ids`映射编辑器本地选项到稳定ID；`layouts`为单题布局。新题/另存副本不携带已有identity。回执是`{request_id,bundle,items:[{client_id,question_id,saved_version_id,revision}]}`。同owner/request同内容重放返回原回执；不同内容40940；失败不留题目、原稿或半回执。保存结果不明先GET原请求回执，不能换UUID重复建题。作者文档序列化上限2MiB，超限HTTP413/41301。

现有 `POST /ai/questions` / `PUT /ai/questions/{id}` 接受 `content_schema_version:2|3` 与 `content_json`。schema3修订保留原格式、稳定ID、图片与布局并同事务同步作者原稿；无法无损转换返回40001且不建revision；旧schema2白名单不放宽。`POST/PUT /admin/papers` 接受完整 `designer_layout`（03册4.0.1），undefined保持，null拒绝；题单仍由独立PUT questions有序版本ID决定。

`POST /me/exams/{id}/start`、`GET /me/exam-records/{id}`、`POST /me/exam-records/{id}/submit`、`GET /me/exam-records/{id}/result` 与 `GET /me/wrong-questions` 接收 `X-Question-Content-Version`：缺省或字符串`2`为原合同，仅字符串`3`声明富文能力，其他值40001。能力3题目额外返回`content_schema_version:2|3`，提交body仍为稳定ID整卷。实际题单需要3而客户端仅2时409/40901，data为`{reason_code:'CONTENT_VERSION_REQUIRED',required_content_version:3}`；首次开考在写assignment/record/题单前拒绝，在考提交同样无答案/评分写入。到期状态读取仍优先纯timeout。新旧内容均不得泄漏作者原稿、答案、解析或任意资源URL。

### 1.1 基础约定

| 项 | 约定 |
|---|---|
| 基础 URL | `/api/v1`（由 nginx 反向代理至 NestJS 应用） |
| 协议风格 | REST：资源名词复数、动作用HTTP方法表达；legacy PUT可为字段修改。新移动考试不提供服务端draft/heartbeat。非幂等动作（retry、publish等）用POST |
| 请求格式 | `application/json`；文件上传为 `multipart/form-data`；Excel 导出响应为二进制流（`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`） |
| 认证方式 | `Authorization: Bearer <access_token>`（JWT 双令牌，见 1.3） |
| 时间格式 | ISO 8601（`2026-09-12T14:30:00.000+08:00`）；纯秒数字段（如 `total_seconds`）为整型 |
| 字段命名 | JSON 字段一律 snake_case，与数据库字段对齐（03 册） |
| ID 字段 | legacy 接口继续保留既有 number 响应以兼容页面；A1 后新增培训接口的 `id` 与 body/path 中 `*_id`（含 B1 课程、B2 视频会话/版本、B3 `question_id/current_version_id/category_id`）统一使用正十进制字符串，避免 BIGINT 经 JavaScript `Number` 丢精度。异步 `task_id` 仍是服务端业务字符串 |
| 幂等性 | GET/PUT 天然幂等；POST 中的关键动作（交卷、开考、会话开始）通过服务端状态校验实现幂等（见 1.5） |

### 1.2 统一响应结构

所有业务接口（除文件下载流）返回统一信封：

```json
{
  "code": 0,
  "message": "success",
  "data": { }
}
```

| 字段 | 说明 |
|---|---|
| code | `0` 表示成功；非 0 为错误码（40xxx 客户端 / 50xxx 服务端，见第 6 章） |
| message | 人类可读提示；失败时直接可用于界面展示 |
| data | 业务数据；失败时可为 `null` 或包含错误上下文的结构（如资格差距信息） |

**分页约定**：列表类接口统一使用 `page`（从 1 起）/ `page_size`（默认 20，最大 100）/ `sort`（排序字段，各接口以白名单声明可选值）/ `order`（`asc` / `desc`，默认 `desc`）查询参数，响应 `data` 统一为：

```json
{
  "list": [ ],
  "total": 128,
  "page": 1,
  "page_size": 20
}
```

所有列表接口强制以主键 `id` 作为最终 tie-breaker（`ORDER BY {sort} {order}, id DESC`）保证分页稳定；`sort` 白名单校验防注入——不在白名单内的取值返回 40001。

**培训分页契约**：A1 后新增的 `Page<T>` 固定为 `{items,total,page,page_size}`，B1 的课程列表与两类 category-options 均使用 `items`。已删除的制度管理列表不属于现行分页接口；旧内容/文件读取为单资源响应。

### 1.3 认证与令牌（与 05 册 2.4.1 节一致）

| 令牌 | 有效期 | 载荷 | 用途 |
|---|---|---|---|
| access token | 2 小时（`JWT_EXPIRES_IN` 可配） | sub（sys_user.id）、username、role、auth_version、sid、client、auth_method、type=access、jti、iat、exp | 每次业务请求的 Bearer 凭据 |
| refresh token | 7 天（`JWT_REFRESH_EXPIRES_DAYS` 可配） | 同上，type=refresh | 经所属客户端的 HttpOnly Cookie 刷新，同时轮换新 refresh |

- `client=pc` 只接受 `auth_method=password`；`client=mobile` 只接受 `sms/debug`。新令牌均绑定持久 sid；仅历史 PC 缺失 client/auth_method/sid 的令牌按 pc/password 兼容。令牌不携带完整手机号、密码哈希或邮箱。
- PC 登录、受保护 access 请求和 refresh 都按数据库当前角色/有效管理权限重新判定管理员；纯学员即刻拒绝，包括历史无 sid 的 PC 令牌。历史令牌形状兼容不保留学员 PC 登录或改密权限；管理员密码入口保持有效。
- PC Cookie 为 `ruleexam_refresh`、Path `/api/v1/auth`；mobile Cookie 为 `ruleexam_mobile_refresh`、Path `/api/v1/mobile/auth`。两者均为 HttpOnly、SameSite=Strict，生产环境 Secure；不在 JSON body 返回 refresh token，刷新接口也不从 body 读取它。
- 刷新策略：PC 调用 `POST /auth/refresh`，mobile 调用 `POST /mobile/auth/refresh`；服务端检查客户端/认证方式/会话身份后一次性消费旧 refresh jti，轮换成功后旧 refresh 不可重放，持久会话到期时间顺延完整 TTL。
- 登出走 **Redis 黑名单与会话吊销**（07 册 2.1.4）：PC `POST /auth/logout` 校验 access 后吊销对应 jti/sid 并清理 PC Cookie；mobile `POST /mobile/auth/logout` 是公开、Cookie 驱动的幂等入口，不要求 access 有效，只撤销自身 mobile Cookie 对应的 jti/sid 并始终清理该 Cookie。两端都只清理本端前端认证状态。
- 改密 / 重置密码 / 停用账号写用户级封禁键 `auth:block:{user_id}`，值为封禁时刻时间戳（秒级），TTL = refresh 剩余有效期；认证守卫（含 refresh 换发路径）判定 `token.iat < block_ts` 即拒绝（40107），封禁时刻之后新签发的令牌天然放行（05 册 2.4.1 取舍说明）。
- 敏感操作（开考、交卷、管理端写操作）执行前实时回查 `sys_user.status = 1`，停用账号的存量令牌即时失效（Redis 故障降级路径，07 册 2.1.4）。
- mobile 登录、刷新和每个受保护请求还须实时确认当前用户启用、`role=employee` 且有效管理权限集合为空；普通业务接口继续检查 auth_version、jti 黑名单、用户封禁及 sid。mobile 凭据不得调用 `/admin/*` 或 PC `/auth/*`；PC 凭据不得调用受保护的 `/mobile/*`。

### 1.4 接口守卫链

全部业务接口统一经过三级守卫（05 册 2.4.2 节）：① JwtAuthGuard 验签 → ② RolesGuard 角色匹配（`super_admin` 天然拥有 `regulation_admin` 全部能力）→ ③ Service 层数据范围收口（employee 强制 `user_id = 本人`；员工读制度内容须叠加发布范围校验）。

本文档各接口的「权限」列标注：`公开`（无需令牌）、`登录`（任一已认证角色）、`管理`（super_admin）、`制度管理`（super_admin / regulation_admin）、`员工`（任一角色，数据范围自动收口为本人）。

### 1.5 幂等与防重设计

| 关键动作 | 幂等机制 |
|---|---|
| 开考 `POST /me/exams/{id}/start` 与旧固定入口 | 用户/assignment/record/新开时paper数据库锁及唯一键裁决；有效active沿原record/题面/deadline恢复，过期active先纯timeout，不能重抽或延时；Redis start锁不参与正确性 |
| 交卷 `POST /exams/records/{id}/submit` | 三层幂等（05 册 6.4.5）：状态前置校验 + Redis 提交锁 + 事务内终态判定；重复调用返回首次评分结果 |
| 移动交卷 `POST /me/exam-records/{id}/submit` | 本人record悲观锁后取accepted_at；严格早于deadline才校验完整稳定ID答案并评分。passed/failed重复请求忽略新答案返回首次结果；timeout返回超时，历史submitted返回待确认；不新增submission_id |
| 会话开始 `POST /learning/sessions/start` | 单活跃会话约束（后开者胜）：同 user + regulation 已有活跃会话时，旧会话被结束落库并返回新会话（05 册 5.4.1） |
| 学习心跳 | 天然幂等：以服务端时钟差结算，重复/乱序心跳不虚增时长（45 秒封顶，05 册 5.4.2） |
| 视频会话开始 `POST /me/video-sessions` | 短事务持 `sys_user` 行锁做范围/活动重查；旧 reading 在释放事务连接后按原算法收口并最多重试 3 次，最终事务关闭旧 video 后再取新锚点；`active_user_id` 可空唯一索引兜底 |
| 视频心跳 | `seq` 严格递增；重复/乱序返回当前进度，服务端时钟 + 45 秒封顶 + 2 秒位置容差决定可确认区间 |

### 1.6 当前 API 与融合计划的边界

| API 范围 | 文档状态 | 规则 |
|---|---|---|
| `/auth`、`/learning`、旧 `/exams`、旧 `/statistics`、`/regulations/{id}/content` 与 `/regulations/{id}/content/file` | 共享兼容契约 | 旧制度阅读资格、旧固定卷自动评分与原统计保持；不恢复制度管理写接口，下发不含答案/解析，refresh 走 HttpOnly Cookie |
| `/admin/training-categories`、`/admin/students`、`/admin/administrators`、`/admin/question-materials`、`/admin/questions`、课程/视频、`/admin/papers` | 当前管理契约 | 字符串 ID 与 `Page.items`；新资料不绑定类别；题目内部保存实际来源；三类客观题版本和发布快照不可变 |
| 个人题单、主动整卷与结果 | 当前Exam Contract v1 | `/me`考试仅mobile employee；在考字符串item/option ID与受限Tiptap，不下发答案/解析；无服务端draft/heartbeat；主动受理才manual/finalized，到期纯timeout |
| 考试记录 | 当前只读管理契约 | `/admin/exam-records`、`/{id}`、`/{id}/result` 均要求 `exam_records:read`；不返回监控、设备、切屏或人工评分字段 |
| 培训统计与权限首页 | 当前增量契约（C6） | `/statistics/training/*` 与 `/admin/dashboard`；实时读取冻结考试事实和 B2 当前版本，不改变旧 `/statistics` |
| 旧固定卷 vs 新培训考试开考 | 两条口径并存 | 旧固定卷继续检查 `learning_record.is_valid`；新培训考试默认关闭学习门槛，但仍检查发布、类别/来源、权限、次数、身份状态和服务端 deadline |

目标链路：发布/候选版本快照→个人题单快照→客户端本地草稿→学员主动整卷提交→锁后截止前受理/评分→只读结果；到期分支直接纯timeout，不评分。旧`/exams`只保留制度固定协议，training记录不能借该入口提交。

---

## 2. 模块与路由总览

全部路由使用同一 `/api/v1` 前缀。下表按现行入口与共享兼容入口分列；精确方法以第 3 章和 controller 为准，不再以总接口数作为验收目标：

| 路由前缀 | 所属模块 | 状态 | 说明 |
|---|---|---|---|
| /auth | 身份与权限 | 现行 | 验证码、登录、刷新、个人信息、改密、登出 |
| /mobile/auth | 学员移动认证 | 现行增量 | 短信发码/登录、mobile 刷新/登出；显式开启时提供 test/development 调试登录 |
| /me/identity-verification | 学员实名 | Gate G自动化与独立代码审查已通过 | 本人三图上传/释放、持久核验会话与权威状态，见3.2.8；真实供应商/真机另验 |
| /media/{assetId}/tickets、/media/tickets/{ticket}/content | 媒体票据 | Gate G已通过；视频增量见Task 12冻结契约 | mobile签发短期票据；内容二次检查精确引用/当前授权，支持单段Range |
| /admin/training-categories | 学习管理 | 现行 | 培训类别分页、详情、增改、启停、引用保护删除 |
| /admin/students | 学习管理 | 现行 | 无部门学员增改查、头像、启停、无密码 xlsx 模板/预检/确认；手机号必填，不提供密码设置/重置或删除 |
| /admin/administrators、/admin/roles 等 | 系统设置 | 现行 | 管理员创建必须提交非空 `role_ids`；另含权限、会话与公共配置治理 |
| /admin/question-materials | 题库资料 | 现行 | 资料创建、列表/详情、版本上传、解析状态和重试；版本 `id` 为字符串 |
| /admin/questions | 题库导入 | 现行 | 7 列Excel/TXT模板、旧9列及两种8列兼容、逐题预览、warnings和直接启用的幂等确认 |
| /ai | AI 与题库 | 现行 | AI配置／旧任务读取、类别选项、三类客观题版本、人工录入与启停 |
| /admin/papers | 试卷发布 | 现行 | 固定/随机卷配置、来源选项、候选、预览、发布、复制；撤回/归档写入口退场 |
| /me | 本人/考试 | Gate H2已自动验证 | 本人资料/首页、考试列表、开考/状态恢复、主动整卷交卷、结果、历史和错题；无考试draft/heartbeat |
| /media | 受控媒体 | 现行 | 头像、课程、视频、题目和品牌媒体；无答题图片 purpose |
| /admin/courses、/me/courses | 课程 | 现行；视频增量见Task 12冻结契约 | 课程/章节/视频版本；启用学员可浏览全部已发布课程，来源/类别不额外阻断视频学习，开播须实名 |
| /me/video-sessions、/me/video-records | 视频学习 | B2协议；Task 12冻结契约 | 当前mobile employee本人；服务端计时、递增序号心跳、主动关闭与历史，见3.10 |
| /admin/exam-records | 考试记录 | 现行 | 列表、详情、结果，统一要求 `exam_records:read` |
| /statistics/training、/admin/dashboard | 培训统计 | 现行 | 场次汇总、排名、同筛选导出与权限裁剪首页 |
| /learning、/exams、/statistics | 共享兼容 | 保留 | 旧制度学习、固定卷自动评分和原统计；原统计菜单隐藏 |
| /regulations/{id}/content、/regulations/{id}/content/file | 旧制度内容 | 保留只读 | 旧发布范围内内容和文件读取；无制度 CRUD |
| /site-config | 公共配置 | 现行 | Logo/轮播白名单与当前品牌图片流 |
| /health | 基础设施 | 现行 | Compose 内部探活，nginx 不对外代理 |

---

## 3. 分模块接口详细设计

### 3.1 认证模块 /auth

| # | 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|---|
| 1 | POST | /auth/captcha | 公开 | 生成管理员登录验证码（120 秒、一次消费）；可用 `previous_captcha_id` 只废弃当前已展示验证码 |
| 2 | POST | /auth/login | 公开 | 仅管理员 username/password 并提交 captcha_id/captcha_code；纯学员使用 H5 手机验证码 |
| 3 | POST | /auth/refresh | 公开（需 refresh token） | 刷新令牌（轮换并废弃前一枚；refresh token 经 HttpOnly Cookie 读取，不走 body） |
| 4 | GET | /auth/profile | 登录 | 当前用户信息（含角色、部门、有效权限） |
| 5 | PUT | /auth/password | 登录 | 修改本人密码（body 固定 old_password/new_password） |
| 6 | POST | /auth/logout | 登录 | 登出（写 jti 黑名单、吊销会话 + 审计日志，客户端清令牌） |

**POST /auth/login**

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| username | body | string | 是 | 用户名 |
| password | body | string | 是 | 密码（明文传输依赖 HTTPS） |
| captcha_id | body | string | 管理员必填 | /auth/captcha 返回的短期标识 |
| captcha_code | body | string | 管理员必填 | 验证码答案；服务端一次消费，不在响应回显 |

**POST /auth/captcha**：body 可选 `previous_captcha_id`（32 位小写十六进制字符串）。刷新成功后只消费该标识对应的旧验证码；不传时保持首次发码兼容，同 IP 的其他验证码不受影响。

规则：凭据校验 → `status = 0` 拒绝 →「用户不存在」与「密码错误」返回同一错误码 40104（不泄露区别，05 册 2.4.1）；每次真实密码成功登录（包括 pending 阶段）递增 `login_count` 并更新 `last_login_at` / `last_login_ip`，refresh 不更新这些统计。`force_password_change = 1` 时签发**受限令牌**（payload 含 `pwd_pending: true`），响应携带 `force_change_password: true`；该状态与登录统计分离。

**PUT /auth/password**：body 含 `old_password`、`new_password`（强度策略见 07 册 2.2）；成功后在同一事务内清除 `force_password_change`、递增 `auth_version`、吊销旧会话并创建新会话，写 `auth:block:{user_id}` 兼容吊销键，并签发完整令牌（payload 无 `pwd_pending`）随响应返回，客户端替换本地双令牌。

### 3.1.1 学员移动认证 /mobile/auth

以下路径均带 `/api/v1` 前缀，成功统一返回 HTTP 200 与 `{code,message,data}` 信封。公开入口不要求 Bearer；刷新与退出只读取 `ruleexam_mobile_refresh`，不读取 PC Cookie。

| 方法 | 路径 | 认证与请求 body | 成功 data |
|---|---|---|---|
| POST | /mobile/auth/sms/send | 公开；`{phone:string}` | `{challenge_id:string,expires_in:number,retry_after:number,masked_phone:string}` |
| POST | /mobile/auth/sms/login | 公开；`{phone:string,challenge_id:string,code:string}` | `MobileSessionResult` |
| POST | /mobile/auth/refresh | mobile refresh Cookie；无 body 凭据 | `MobileSessionResult`，同时轮换 mobile Cookie |
| POST | /mobile/auth/logout | 公开幂等、mobile refresh Cookie 驱动；不要求 access，无 body | `null`，始终清理 mobile Cookie |
| POST | /mobile/auth/debug-login | 公开；`{phone:string}`；仅 test/development 显式开启 | `MobileSessionResult` |

```ts
interface MobileSessionResult {
  access_token: string
  expires_in: number
  user: {
    id: number
    username: string
    real_name: string
    phone_masked: string
    role: 'employee'
    source: 'institution' | 'external' | null
    category_id: number | null
    identity_status: 'unverified' | 'pending' | 'verified' | 'rejected'
  }
}
```

此移动认证响应当前沿用 number 用户/类别 ID；不要据此改变课程、考试等接口的字符串 ID 契约。Gate G 契约将 `identity_status` 与已实名姓名接入 `IdentityService` 权威查询，不能根据普通姓名、头像或手机号推断通过；新建调试/短信学员没有实名事实时仍为 `unverified`。Gate G 验收状态独立于既有认证验收。

手机号先去除空白及连字符，结果必须是匹配 `^1[3-9][0-9]{9}$` 的中国大陆 11 位手机号。`challenge_id` 是 48 位小写十六进制随机串，验证码为 6 位数字。默认挑战有效期 300 秒、重发间隔 60 秒、每挑战最多 5 次验码，手机号/IP 的 86400 秒计数窗口上限分别为 10/100 次；配置项见 07 册 §2.2.5。新发码使该手机号旧挑战失效，验码成功一次性消费挑战；响应和日志均不返回验证码或完整手机号。

短信通过后按规范化手机号关联账号；不存在时在事务内创建 `source=external`、`role=employee`、类别为空的学员，随机用户名与不可知随机密码哈希不作为短信登录凭据。唯一手机号索引处理并发首次登录。已有账号须启用、为 employee 且当前有效管理权限为空；管理账号应使用 PC 密码入口。短信登录不清除 PC 的 `force_password_change`，也不据此签发 PC 令牌。移动成功登录更新 `last_login_at/last_login_ip`，不递增仅统计密码登录的 `login_count`。

mobile access 仅保存在 Pinia 内存；refresh 仅保存在 HttpOnly Cookie。401 刷新采用同一时刻共用一次请求、原业务请求最多重放一次的规则；失败清空 mobile 内存态并进入登录页。退出时，即使 access 已过期也可凭 mobile refresh Cookie 撤销对应会话；缺失、无效或误传 PC Cookie 只作安全空操作并清理 mobile Cookie，不触碰 PC 会话。前端无论退出请求是否成功均清理 mobile 内存态。

`SERVER_DEBUG_LOGIN_ENABLED` 默认 false；只允许 `NODE_ENV=test|development` 显式开启，production 开启必须使启动失败。调试入口仅绕过短信，仍复用手机号规范化、账号关联/创建、普通学员权限检查与同一个会话签发器；新建调试学员仍未实名。H5 页面不提供调试按钮或固定验证码；调试成功不算真实短信验收。

### 3.2 培训身份与系统权限 /admin、/me

现行应用不注册 `/users` 或 `/departments` 管理控制器。培训学员使用 3.2.2 的 `/admin/students`；管理员使用 `POST /admin/administrators`，请求必须包含非空字符串 ID 数组 `role_ids`。学员 DTO 不接受部门字段：新建/导入写 `department_id=NULL`，更新既有学员保留历史值。共享 `sys_user/sys_department` 数据仍供认证、旧学习与旧统计读取。

### 3.2.1 培训类别 /admin/training-categories（A2）

培训类别接口以 `training_categories:read`（GET）和 `training_categories:write`（POST/PUT/DELETE）为当前权限边界。类别只做业务归类，不授予任何角色权限。列表响应使用通用分页结构 `data.items/total/page/page_size`，类别 ID 和 `created_by` 均为字符串 ID。

| # | 方法 | 路径 | 请求 | 成功 data |
|---|---|---|---|---|
| 1 | GET | /admin/training-categories | query：`page`（默认 1）、`page_size`（默认 20，1—100）、`keyword`、`status`（0/1） | `Page<Category>` |
| 2 | GET | /admin/training-categories/{id} | — | `Category` |
| 3 | POST | /admin/training-categories | body：`name`（必填，1—128）、`description`（可选，≤2000） | `Category`，创建时 status=1 |
| 4 | PUT | /admin/training-categories/{id} | body：`name?`、`description?` | `Category` |
| 5 | PUT | /admin/training-categories/{id}/status | body：`status`（0/1） | `Category` |
| 6 | DELETE | /admin/training-categories/{id} | — | `null`；已被学员、课程、制度、question/question_version 或 question_concept 引用时返回 40910，停用不删除历史引用 |

`Category` 字段为 `{ id, name, description, status, created_by, created_at, updated_at }`。查询、分页、状态和 body 中的未知字段及非法数字（包括 NaN）均返回 40001；名称唯一冲突返回 40001。类别状态/删除与引用写入在同一事务中锁定类别行并重查；删除时检查学员、课程、制度、题目/版本与考点引用，使用中的类别返回 40910。所有新增引用写入仍复用 `CategoryService.lockActive`。

### 3.2.2 培训学员 /admin/students（A2）

`/admin/students` 以 `students:read`（GET）和 `students:write`（POST/PUT/批次确认/启停）为权限边界。新学员固定 role=`employee`，`phone`、`category_id` 与 `source` 必填；`source` 只影响后续抽题策略，不等于权限。纯学员使用 H5 手机验证码登录，无密码设置/重置接口。旧 `/users` 管理路由已删除，既有用户的未知来源/类别和历史部门值不回填。

A3 学员管理边界：列表、详情、资料更新和启停仅作用于 `sys_user.role=employee` 且不存在任何 `sys_user_role` 记录的账号。只要存在业务角色链接，即使角色无权限或已停用，也按管理员账号从上述学员接口范围排除；详情与上述写操作统一返回 40401，避免泄露受保护账号。更新、启停在同一事务内先以用户行悲观锁完成最终分类检查，再执行原有保存、认证世代递增和会话吊销；角色赋值仍按角色行后用户行加锁，保证赋值与学员 mutation 串行。本人资料接口不受该管理边界改变。

| # | 方法 | 路径 | 请求与约束 | 成功 data |
|---|---|---|---|---|
| 1 | GET | /admin/students | query：`page`、`page_size`、`keyword`（姓名或手机号）、`category_id`、`source`（institution/external）、`status`（0/1） | `Page<Student>`；ID 均为字符串；列表不展示内部用户名或工号 |
| 2 | GET | /admin/students/{id} | — | `Student`，不含 password_hash |
| 3 | POST | /admin/students | body：`phone`、`real_name`、`category_id`、`source` 必填；可选 `username/employee_no/email/gender/birthday/age`；不接受部门及密码字段 | `Student`，role 固定 employee，`department_id=NULL`，`force_password_change=0` |
| 4 | PUT | /admin/students/{id} | body：`real_name/employee_no/category_id/source/phone/email/gender/birthday/age` 可选；不接受 department/username/password/role | `Student` |
| 5 | PUT | /admin/students/{id}/status | body：`status`（0/1） | `Student`；停用同时吊销既有令牌 |
| 6 | PUT | /admin/students/{id}/avatar | body：`avatar_id`（ready 的 avatar 图片资源 ID）或 null | `Student`；同一用户行锁事务内重查 managed-student 边界并更新引用 |
| 7 | GET | /admin/students/import-template | — | `.xlsx` 二进制，禁止缓存；首表六列为 `姓名/年龄/性别/培训类别/手机号/来源`，另附填写示例与说明（含当前启用类别名称），只导入首表 |
| 8 | POST | /admin/students/import-preview | JSON `rows` 数组，或 multipart `file`；可选 `defaults:{source?,category_id?}` | `ImportPreview`；密码字段/旧密码列整包返回 40001 |
| 9 | GET | /admin/students/import-batches/{id} | —；仅批次 owner 可读 | 未提交批次为 `ImportPreview`，已提交批次为 `ImportResult` |
| 10 | POST | /admin/students/import-batches/{id}/commit | body：`row_numbers` 为非空整数数组；仅批次 owner | `ImportResult` |

`Student` 字段为 `{ id, username, real_name, employee_no, category_id, source, role, phone, email, gender, birthday, age, avatar_id, status, last_login_at, created_at }`，其中 `avatar_id/gender/birthday/age` 可为 null。管理员创建或更新资料可维护 `gender`（male/female/null）、`birthday`（真实 YYYY-MM-DD/null，不晚于服务端 Asia/Shanghai 业务当前日期），复用本人资料校验；`age` 为独立的 0—150 整数或 null，不接受数字字符串，不反推或改写 birthday。管理端数字输入保存 age，旧账号 age 为空时可按生日计算展示；这些字段是普通展示资料，不改变实名事实。新建和导入不接受部门字段并写入 `department_id=NULL`；更新既有学员同样不接受部门字段，但保留数据库中的历史 `department_id`。列表默认 page=1/page_size=20，page_size 范围 1—100；未知 query/body 字段、非整数分页、非法枚举均返回 40001。本人资料接口见 3.2.3，不允许通过学员接口修改 role，亦不开放 age 自维护。

导入预检逐行返回 `ImportPreview = { batch_id, valid_rows, errors:[{row,message}], duplicates }`；模板行号从 2 开始。预检按数据库 `utf8mb4_0900_ai_ci` 规则识别用户名/工号大小写与重音重复，并检查规范化手机号必填且唯一、启用类别与来源。username 仅是内部兼容标识；创建和导入省略时生成随机 `m_` 标识，提供时沿用唯一约束，不作为学员登录凭据。确认只消费服务端规范化行，批次按 owner+id 隔离；首次确认固定合法行集合，同集合重试返回原 `created_ids`，更换集合返回 40911。确认事务按类别 ID 加锁并重新检查类别存在且启用；类别在预检后被停用或删除时返回 40910，不创建悬挂学员。新批次 `normalized_rows` 不保存密码或哈希；确认时为兼容非空存储生成不可知随机值的 bcrypt 哈希，`force_password_change=0`。旧未确认批次如含 password/initial_password/初始密码/password_hash/passwordHash，返回 40911 并要求重新预检，不沿用旧凭据；已确认回执保持幂等。任何响应、错误明细和审计记录不得包含明文口令或哈希。

模板填写规则：姓名、手机号必填；年龄可空或 0—150 整数，性别可空或男/女。培训类别下拉选项使用下载时当前启用的类别名称快照，以工作簿命名区域引用，类别更新后须重新下载；Excel 使用停止型校验拒绝非列表值，服务端导入仍复核类别存在且启用。每行培训类别必填；空值、未知或停用类别均使该行预检失败，不再用 defaults.category_id 补齐，页面不提供默认类别控件。来源填写本机构/外来；留空一律默认本机构（包括旧客户端传入 defaults.source 时），页面不再提供默认来源控件。旧 defaults 请求仅校验格式，不作为补值依据。示例使用合成人名和待替换手机号，仅供参考，不参与导入。兼容旧系统五列（学生姓名/年龄/性别/培训类别/手机号）及既有无密码七列模板；旧五列的来源默认本机构。年龄、性别在预检规范化后随确认落库；未知类别不自动创建，非法值逐行报错，空行跳过。

### 3.2.3 本人资料 /me/profile（A2）

| # | 方法 | 路径 | 请求 | 成功 data |
|---|---|---|---|---|
| 1 | GET | /me/profile | — | 当前用户资料（含 `occupation/gender/birthday/category_id/category_name/source`，旧用户可为 null）；category_name 按现行类别表读取，停用类仍可显示 |
| 2 | POST | /me/profile | 移动端兼容入口；仅允许 `real_name?`、`email?`、`avatar_id?`、`occupation?`、`gender?`、`birthday?` | 更新后的资料 |
| 3 | PATCH | /me/profile | PC/既有兼容；请求与 POST 相同 | 更新后的资料 |

手机号已是认证标识，不能经普通本人资料接口修改；携带 `phone` 返回 40001。手机号关联由短信认证完成，后台新建/导入或受控学员管理入口统一做规范化与唯一性校验；管理入口改号时递增认证世代并吊销旧会话。本期不另提供未经短信校验的自助换绑接口。POST 与 PATCH 共用同一严格 DTO 和服务；POST 用于微信原生 request 不支持 PATCH 的跨端兼容，不得放宽字段白名单。

`occupation` 去首尾空白后为 1—64 字符或 null，且不修改培训类别；`gender` 仅 `male/female/null`；`birthday` 仅真实 `YYYY-MM-DD/null` 且不得晚于服务端 Asia/Shanghai 业务当前日期。普通保存继续禁止 `source/category_id/role/status/identity_status/username` 等权威字段；Gate G 实名契约规定已实名姓名不得由兼容的 `real_name` 字段修改，PC/mobile 共用事务内检查，非法修改返回 40001。

`source/category_id/role/avatarId/username/department_id` 等未知或越权字段均返回 40001，不静默丢弃；`avatar_id` 只接受已经由本人上传且 ready 的头像资源，绑定与旧资源解绑在同一事务内完成。

#### 3.2.3.1 培训工种首次确认（2026-10-23）

PC「培训类别」与移动端「培训工种」共同引用 `sys_user.category_id`，不是普通 `occupation` 文本。个人资料和实名认证保留独立入口；导入/PC 已分配类别者只能查看，未分配者首次明确确认后锁定。

| 方法 | 路径 | 请求 | 成功 data |
|---|---|---|---|
| GET | /me/training-categories | query 仅 `page/page_size`，正整数，默认 1/20，上限 100 | `Page<{id:string,name:string}>`，只列启用类别 |
| PUT | /me/training-category | 严格 body `{category_id:string}`，正十进制字符串 ID | 完整本人资料，含 `category_id/category_name` |

两个端点只接受启用、无任何业务角色链接的 mobile employee，不借此开放后台类别管理。写入在事务内锁定用户、校验启用类别：当前 NULL 允许首次赋值；同值重放幂等返回、不重复记录首次审计；已非空不同值返回 40001 与 `data.reason_code=TRAINING_CATEGORY_LOCKED`。无效/停用新类别使用 40910。普通 POST/PATCH `/me/profile` 的白名单不放宽。

绑定只改本人类别，不改 source/role/实名/姓名。首次绑定和 PC 后续类别调整记录操作者、目标及前后类别；既有题单、进行中考试、历史分数不重算。网络写结果不明时客户端先 GET `/me/profile` 读回，不自动重发写请求。课程仍遵守 3.9/3.10 的全 published 浏览与实名播放规则，不因类别新增门槛。

### 3.2.4 受控媒体 /media（A4）

| 方法 | 路径 | 权限 | 请求与响应 |
|---|---|---|---|
| GET | `/media/limits` | 登录 | 返回 `video_max_bytes`（默认 536870912，服务端/网关硬上限一致）、`image_max_bytes`（默认 10485760）、`image_max_pixels`（默认 25000000）、`probe_timeout_ms`（默认 30000）及允许类型；不返回路径/密钥 |
| POST | `/media/upload` | 登录；非头像用途需 `media:write` | multipart `file` + `purpose`（avatar/course_cover/video/question/branding），可选头像 `owner_id`；`answer` 一律返回 40001。成功 `data={asset_id,status,duration_ms}`，视频实际探测后才为 ready |
| GET | `/media/{id}` | 资源拥有者/已注册 owner authorizer | 查询 `asset_id/purpose/media_kind/mime_type/size_bytes/status/duration_ms`；公开 status 仅为 `processing/ready/failed`，内部 `deleting` 按 40401 不存在处理 |
| GET | `/media/{id}/content` | 资源拥有者/已注册 owner authorizer | 私有流，支持单一 `Range: bytes=start-end`，命中返回 206 与 `Content-Range`；无效或不可满足 Range 返回 41601/HTTP 416；文件流跳过统一信封 |
| DELETE | `/media/{id}` | 资源拥有者 | 有任何 `media_reference` 时返回 40913；无引用后先落内部 `deleting` 再删除物理文件，失败保留行供重试并返回 50004/HTTP 503，成功或文件已不存在才删数据库行 |

`question_version` owner policy 保留上传者与 `questions:read` 的既有读取。具有 `papers:read` 的非上传者只能读取真实 fixed draft、不可变 release，或当前 random draft 经既有候选规则验证后的题干/选项图片；只出现在解析中的图片还必须具备 `papers:export` 或 `questions:export`。单独 `questions:export` 不构成试卷题图读取权。候选桥接精确限定类别、可选资料、题型、难度、enabled + current与question_id容量，不落伪 `paper_question` 或 release。错误类别/来源/难度/状态/current version/题型、无效草稿与无关题库版本均返回 40302；release 历史按其 `snapshot_json` 判断。

管理端头像绑定 `PUT /admin/students/{id}/avatar` 只接受 `avatar_id`，在同一用户行锁事务内重复 `lockManagedStudent` 最终检查并 bind；拥有任何 `sys_user_role` 链接的员工仍不属于学员管理范围。PC 选择新头像时只把上传结果暂存在当前表单，点击“保存”后才调用既有资料更新与独立头像绑定接口；取消不绑定该上传，任一保存请求失败后以详情 GET 对账并保留重试入口，不能把上传成功误当成资料已保存。

尚未绑定的代传头像仅允许实际代传者在当前学员管理权限仍有效时预览 metadata/content；该临时预览不授予短期媒体票据，也不扩展到其他用途。

### 3.2.5 A2 导入错误与恢复语义

| code | HTTP | message（示例） | 触发场景 |
|---|---|---|---|
| 40910 | 409 | 培训类别不存在或已停用 | 新学员/类别引用写入或导入确认时类别行锁重查失败；引用类别硬删除 |
| 40911 | 409 | 导入批次已确认，不能更换行集合 | 已提交批次使用不同合法行集合重试，或批次正被另一确认请求处理 |

导入批次的 `owner_id` 是服务端从当前令牌取得，客户端不能指定；未提交批次保留预检结果供查询/恢复，确认成功后保存 `committed_rows/created_ids`。这套批次事实可由 B4 注册题库适配器复用，但通用服务不依赖 AI。
### 3.2.6 管理权限与在线会话 /admin（A3）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /admin/permissions | roles:read | 服务端注册权限目录 |
| GET | /admin/roles | roles:read | 角色与权限关系 |
| POST / PUT | /admin/roles[/{id}] | roles:write | 新建/修改业务角色；只接受白名单权限 |
| GET | /admin/administrators | administrators:read | 管理员及当前有效权限 |
| POST | /admin/administrators | administrators:write | 创建管理员；body 必须包含非空 `role_ids:string[]` |
| GET | /admin/administrators/candidates | administrators:write | 分页搜索可配置账号；仅返回 `id/username/real_name/status/system_role/requires_initial_password`，排除超级管理员 |
| GET | /admin/administrators/assignable-roles | administrators:write | 仅返回启用的非系统角色 `id/code/name/status/is_system`，不返回权限矩阵 |
| PUT | /admin/administrators/{id}/roles | administrators:write | `role_ids` 多选业务角色；学员取得有效管理权限时必填 `initial_password`，最高管理员保护 |
| GET | /admin/sessions | sessions:read | 分页查看在线/已吊销会话（返回 `created_at`、`last_seen_at`、持久化 `expires_at` 与 `status`；新会话的创建/更新时间与最后活动时间由同一服务端时刻写入） |
| POST | /admin/sessions/{id}/revoke | sessions:write | 强制下线并立即吊销该 sid 的双令牌 |

管理员列表和可配置账号列表返回 `requires_initial_password`，前端据此在提升账号时显示管理员初始密码输入。服务端在角色→用户行锁事务中重新判定：employee 当前无启用角色的有效注册管理权限、且本次授予有效权限时，必须提交符合管理员密码策略的 `initial_password`，写 bcrypt 哈希并置 `force_password_change=1`，同时沿用认证世代递增和会话吊销。纯学员不得仅赋零权限角色；已有有效管理角色的管理员（包括停用账号）改角色不重设密码，携带该字段时拒绝。状态停用不作为需要新密码的依据。密码不进入响应或审计；角色清空不设置新密码。

### 3.2.7 菜单、字典、站点配置与审计（A5）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/menus/navigation` | 登录 | 返回当前账号有效权限过滤后的启用导航树；不下发任意组件或脚本 |
| GET | `/admin/menus` | `system_settings:read` | 完整目录/菜单/按钮树（含停用项） |
| GET | `/admin/menus/permission-options` | `system_settings:write` | 菜单编辑专用已注册权限选项 `{code,name}[]`；不因此授予 `/admin/permissions` 或 `roles:*` |
| GET | `/admin/menus/{id}` | `system_settings:read` | 菜单节点详情 |
| POST | `/admin/menus` | `system_settings:write` | 新建节点 |
| PUT | `/admin/menus/{id}` | `system_settings:write` | 更新节点；父链循环校验与写入同一事务 |
| DELETE | `/admin/menus/{id}` | `system_settings:write` | 删除节点；有子项或其权限仍被角色引用时返回 40920 |
| GET | `/admin/dictionaries` | `system_settings:read` | 按 `page/page_size/type/keyword/status` 分页，返回 `{items,total,page,page_size}` |
| POST | `/admin/dictionaries` | `system_settings:write` | 新建自定义显示字典项 |
| PUT | `/admin/dictionaries/{id}` | `system_settings:write` | 更新自定义字典项；固定业务枚举拒绝 |
| DELETE | `/admin/dictionaries/{id}` | `system_settings:write` | 删除自定义项；`is_system=1` 或固定 type 返回 40920 |
| GET | `/admin/site-settings` | `system_settings:read` | 返回与公开端同形的 Logo/轮播配置 |
| PUT | `/admin/site-settings` | `system_settings:write` | 校验 ready branding image 后原子更新配置与媒体引用 |
| GET | `/admin/audit-logs` | `system_settings:read` | 按 `date_from/date_to/actor/action/page/page_size` 只读查询结构化审计文件；无清空端点 |
| GET | `/site-config` | 公开 | 严格返回 `{logo_asset_id,banners}` 两个键 |
| GET | `/site-config/assets/{id}/content` | 公开 | 仅当 ID 仍在当前 Logo/轮播白名单、有 `site_config` 引用且资源为 ready branding image 时返回原始流；其他 ID 统一 40401，支持单 Range |

菜单写入 DTO 固定为 `parent_id? / name / type / route_path? / permission_code? / icon? / sort / status`。`type=directory` 不得带路由或权限；`type=menu` 的 `route_path` 必须在前端及服务端菜单白名单注册，包含独立 `/admin/questions/import`；`type=button` 不得带路由且必须使用服务端注册权限。新增、修改、删除先锁定初始化保证且业务不可删除的 `site_setting.logo_asset_id` 实存行，再在同一事务重读菜单树关系；因此空树双创建可依次成功，互挂父级、建子与删父、建子与父节点改按钮只会提交合法一侧。互斥行缺失时返回 50004/HTTP 503，不自动修复、不把数据库死锁当业务冲突。默认试题管理导航不在数据库层先限制 `questions:read`，前端注册路由精确以 `questions:read OR questions:write` 判定；试题导入菜单和路由要求 `questions:write`。只缓存试题导入页，试题管理返回时重新加载列表，API 仍按各端点权限裁决。

字典写入 DTO 固定为 `type/code/label/sort/status/remark?`，`(type,code)` 唯一。服务端固定 type 是 `learner_source/difficulty/question_type/regulation_status/paper_status/question_status/exam_status`；这些项只是显示镜像，不能借 CRUD 改变来源映射、题型、状态或考试规则。

站点配置请求与公开响应均是：

```json
{
  "logo_asset_id": "41",
  "banners": [
    { "asset_id": "42", "sort": 10 },
    { "asset_id": "43", "sort": 20 }
  ]
}
```

`logo_asset_id` 可为 null，`banners` 必须为数组、最多 3 项、`asset_id` 不得重复，服务端按 `sort + asset_id` 稳定排序。`GET /site-config` 不会序列化整张设置表，任何 AI 配置、密钥或未白名单 setting 都不得进入响应。

审计查询只打开 `LOG_DIR/audit/audit-YYYY-MM-DD.log` 普通文件，拒绝路径越界与符号链接；忽略损坏旧行而不返回原文。审计目录尚未产生时可返回空页；目录存在但类型非法、不可读、读取中变化或目标日志文件发生 EACCES/其他 I/O 错误时返回 50004/HTTP 503，不用空页或部分页伪装成功。写入、文件失败后的 stderr 降级、查询输出三条路径都对 password/token/authorization/cookie/api_key/credential 等敏感字段递归脱敏；字符串若是 JSON 则解析后递归清洗，非 JSON 的 `key=value`/`key:value` 会清除完整值（含空格），同时保留 action/result/reason 等非敏感诊断信息。

### 3.2.8 学员实名与短期媒体票据（Task 10/11，Gate G 自动化与独立代码审查已通过）

路径均以 `/api/v1` 为前缀。除原始内容流外，须为 mobile Bearer access，实名路由另要求普通 employee 且仅操作本人；沿用严格 DTO 白名单与 `{code,message,data}`。ID 为正十进制字符串（`^[1-9]\d{0,19}$`），session ID 为服务端 UUID。

| 方法 | 完整路径 | 请求 | 成功 data |
|---|---|---|---|
| GET | `/api/v1/me/identity-verification` | — | `IdentityVerificationView` |
| POST | `/api/v1/me/identity-verification/images` | multipart `image_type` + 单个 `file` | `IdentityImageUpload`；HTTP 200 |
| DELETE | `/api/v1/me/identity-verification/images/:assetId` | 无 body | `null`；只释放本人且未进入 session/实名事实的临时材料 |
| POST | `/api/v1/me/identity-verification/sessions` | `IdentitySessionCreate` | `IdentitySessionView`；HTTP 200 |
| GET | `/api/v1/me/identity-verification/sessions/:sessionId` | — | `IdentitySessionView`；检查本人归属 |
| POST | `/api/v1/media/:assetId/tickets` | `{owner_type: string, owner_id: string}` | `MediaTicketView`；HTTP 200 |
| GET | `/api/v1/media/tickets/:ticket/content` | 签名票据；可带单段 Range | 原始内容流 200/206；跳过响应信封，无须 Bearer |

```ts
type IdentityImageType = 'id_card_portrait' | 'id_card_emblem' | 'face'
type IdentityReasonCode = 'ID_CARD_PORTRAIT_PARSE_FAILED' | 'ID_CARD_EMBLEM_PARSE_FAILED'
  | 'ID_CARD_DOCUMENT_INVALID' | 'ID_CARD_EXPIRED' | 'FACE_MISMATCH'
  | 'FACE_QUALITY_FAILED' | 'IDENTITY_ALREADY_BOUND' | 'SESSION_EXPIRED'
interface MediaTicketView { content_url: string; expires_at: string }
interface IdentityVerificationView {
  status: 'unverified' | 'pending' | 'verified' | 'rejected'
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
  processed_preview: MediaTicketView | null
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

图片只允许 JPEG/PNG，原文件 ≤10 MiB、至少 320×320，普通源图 ≤20M 像素、正脸源图 ≤60M 像素。服务端修正 EXIF、重编码去元数据，长边 ≤1600，JPEG Base64 ≤约 2.8M；身份证面先 OCR 裁剪清洗，预览返回处理图票据，face 用本地临时预览。客户端不得传 owner、学员 ID、来源、scan status 或实名通过状态。三资产必须不同、本人所有、ready、未删除且分别匹配 `identity_face/identity_id_portrait/identity_id_emblem` purpose；通用 `/media/upload` 不接受实名三种 purpose。

`POST sessions` 成功只返回 `IdentitySessionView`。同用户相同三资产且未过期时复用原会话（包括 rejected）；不同材料遇到现有非终态返回 40906，客户端查询当前权威状态，不并行创建。已实名返回 **40960/HTTP 409**，错误 `data={status:'verified',reason_code:null,clear_materials:[]}`，客户端随后 GET 本人实名视图，不能假造 session 或仅凭冲突文案显示成功。`provider_pending/provider_unknown/provider_verified` 对外均为 pending；无结果过期映射 rejected + SESSION_EXPIRED，已持久成功结果优先恢复绑定，不受普通 TTL 丢弃。

上传/创建的可恢复业务错误在非零错误信封中固定提供 `data={reason_code: IdentityReasonCode|null, clear_materials: IdentityImageType[]}`。session 材料拒绝属于成功查询到 rejected 终态，不把供应商不可用伪造成 rejected；供应商关闭/超时、存储或安全配置不可用沿用 50004/HTTP 503，未知原因保留材料。前端只按 code/data 分支，不能解析 message。

| reason_code | clear_materials | 处理 |
|---|---|---|
| ID_CARD_PORTRAIT_PARSE_FAILED | `['id_card_portrait']` | 只重拍人像面 |
| ID_CARD_EMBLEM_PARSE_FAILED | `['id_card_emblem']` | 只重拍国徽面 |
| ID_CARD_DOCUMENT_INVALID / ID_CARD_EXPIRED | `['id_card_portrait','id_card_emblem']` | 重拍两面 |
| FACE_MISMATCH / FACE_QUALITY_FAILED | `['face']` | 重新现场拍正脸 |
| IDENTITY_ALREADY_BOUND / SESSION_EXPIRED / null | `[]` | 展示受控原因；不静默合并或自动清材料 |

签票 DTO 仅接受 `owner_type`（最长 64）和 `owner_id`。已冻结 owner 为 `identity_verification_user + user ID`、`user_avatar + user ID`、`training_course_cover + course ID`，Task 12增加 `lesson_version_video + version ID`，视频专属资格见3.10；题图由Task 13/14再冻结。签发前须存在精确 `media_reference(asset_id,owner_type,owner_id)` 并通过对应票据授权；视频使用独立learner-only authorizer，不能直接借用PC管理预览的 `authorizeRead` 旁路。proxy 内容读取验证 HMAC/expiry 后，再按票内 actor/asset/purpose/owner 重查同一引用、当前业务权限及资源 ready/未删除；撤销引用或权限后旧代理票据不得继续读。COS 普通媒体在申请/续签时完成同样的业务检查，已发 COS 链接到期前仍有效；实名材料始终代理。

proxy/local/实名场景的 `content_url` 为站内相对 URL，仅含短期票据；COS 普通媒体可返回准确配置桶域名和正式前缀下的 HTTPS 签名 URL。默认 300 秒，COS 可配置至 3600 秒；两者均不含 access/refresh JWT、真实文件名、磁盘路径或 SecretKey。以下错误码/内容响应约定针对应用代理入口，COS 直接返回供应商状态。票据无效/过期返回 40302/HTTP 403；客户端重新签发，不能把访问令牌放 URL。Range 沿用单段 `bytes=start-end`/后缀范围，成功返回 206、`Content-Range/Accept-Ranges/Content-Length`，无 Range 为 200；非法、多段或不可满足范围为 41601/HTTP 416。内容响应使用 `private, no-store`、`inline` 和 `nosniff`。

自动化仅在 Nest TestingModule override Provider 后走完整三图/会话/轮询/绑定；真实腾讯及真机验收另记，不以本节契约同步宣称已通过。

### 3.3 题库资料 /admin/question-materials

| 方法 | 路径 | 权限 | 请求 / 成功 data |
|---|---|---|---|
| GET | /admin/question-materials | `ai:read` | query `page/page_size/keyword`；返回 `Page<QuestionMaterial>` |
| POST | /admin/question-materials | `ai:write` | `{title,description?}`；创建不绑定培训类别的资料 |
| GET | /admin/question-materials/{id} | `ai:read` | 资料及版本列表 |
| POST | /admin/question-materials/{id}/versions | `ai:write` | multipart `file`（pdf/docx，≤50MB）；返回 `{id,version_no,file_type,parse_status,duplicate_hint}` |
| GET | /admin/question-materials/{id}/versions/{versionId}/status | `ai:read` | 解析状态；资料 ID、版本 ID 全程为字符串 |
| POST | /admin/question-materials/{id}/versions/{versionId}/retry | `ai:write` | 失败版本重试；返回更新后的版本状态 |

新资料不接受 `category_id`。底层继续复用 `regulation/regulation_version`，因此内部题目来源列保持 `regulation_id/regulation_version_id`；外部契约不得暴露为 AI 生成入参。资料来源选项允许该试卷类别下题目的 `question.category_id + regulation_id` 实际关联，或旧资料自身 category 直接匹配；固定卷创建、更新、发布都拒绝跨类别题目或来源。

### 3.4 旧制度内容只读兼容（权限：旧发布范围内本人）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| — | GET | /regulations/{id}/content | 在线阅读内容（docx：content_html；pdf：file 下载地址） |
| — | GET | /regulations/{id}/content/file | 经旧发布范围校验读取当前文件流 |

规则：可见性校验链——制度 `status = published` + 本人属于发布范围（regulation_scope 部门含本部门或 is_all）；返回当前生效版本（current_version_id）的产物；同时返回学习要求（required_minutes / scroll_segments）供前端渲染进度。

### 3.5 AI 出题与版本题库 /ai（细权限分别声明）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | /ai/config | `ai_config:read`；读取脱敏 AI 配置 |
| 2 | PUT | /ai/config | `ai_config:write`；保存 AI 配置 |
| 3 | POST | /ai/config/test | `ai_config:write`；文本连通性测试 |
| 4 | POST | /ai/config/test-vision | `ai_config:write`；视觉输入连通性测试 |
| 5 | POST | /ai/generate-questions | 已退场，404；不再从资料直接写题库 |
| 6 | GET | /ai/generate-status/{taskId} | `ai:read`；任务状态轮询 |
| 7 | GET | /ai/generation-category-options | `ai:write`；启用类别 `Page<{id,name}>` |
| 8 | GET | /ai/question-category-options | `questions:write`；人工录题类别选项 |
| 9 | GET | /ai/question-category-filters | `questions:read`；题库筛选类别选项 |
| 10 | GET | /ai/question-concepts | 已退场，404；历史表保留 |
| 11 | GET | /ai/question-concept-options | 已退场，404 |
| 12 | POST | /ai/question-concepts | 已退场，404 |
| 13 | GET | /ai/questions | `questions:read`；版本兼容视图分页筛选，所有启停筛选均排除已删 |
| 14 | POST | /ai/questions | `questions:write`；人工录入直接启用，首版本兼容approved、审核元数据NULL |
| 15 | PUT | /ai/questions/{id}/enabled | `questions:write`；显式enabled与expected_version_id，启停不增内容版本 |
| 16 | PUT | /ai/questions/{id} | `questions:write`；同时校验expected_version_id和expected_enabled，修订保存并启用；在考核心编辑仍拒绝40908 |
| 17 | POST | /ai/questions/{id}/regenerate | 已退场，404；重生成仅在未确认AI导入批次内提供 |
| 18 | GET | /ai/questions/{id}/history | `questions:read`；revision 历史与真实审核元数据，返回 Page |
| 19 | GET | /ai/questions/{id} | `questions:read`；题目当前兼容视图，已删40401 |
| 20 | GET | /ai/papers | 试卷列表（筛选 regulation_id/status） |
| 21 | POST | /ai/papers | 创建试卷 |
| 22 | GET | /ai/papers/{id} | 试卷详情 |
| 23 | PUT | /ai/papers/{id} | 修改策略字段 |
| 24 | PUT | /ai/papers/{id}/questions | 组卷；发布后锁定 |
| 25 | POST | /ai/papers/{id}/publish | 发布试卷，校验 SUM(score)=100 |
| 26 | POST | /ai/papers/{id}/copy | `papers:write`；按冻结事实复制为新 draft，body 只接受空对象 |
| 27 | POST | /ai/papers/{id}/archive | 已退场，404；历史归档状态只读兼容 |
| 28 | DELETE | /ai/questions/{id} | `questions:write`；版本／启停双基线逻辑删除，保留历史，重复返回原回执 |

**试卷路由归属说明**：试卷的创建/组卷/发布属于「题库启用 → 组卷 → 发布」的出题工作流（05 册 4.4.7 组卷服务隶属 AI 出题模块），故管理侧归 `/ai/papers`；面向员工的考试执行（可考列表、开考、交卷）归 `/exams`（考试评分模块）——同一资源的管理面与执行面分离，与模块边界一致。

**PC 入口范围（2026-10-26）**：上述 `/ai/papers` 为后台旧制度卷兼容接口，PC 的历史固定卷 Tab、列表请求和管理详情已退场。现行 PC 试卷管理只使用 `/admin/papers`；旧 `scope=regulation` 页面链接回当前列表，不能据后台兼容接口恢复旧页面入口。

**退场写入口**：`POST /ai/generate-questions`、`POST /ai/questions/{id}/regenerate`、`PUT /ai/questions/{id}/review` 及考点目录／选项CRUD均不再注册，返回404；不得接到直接启用版本服务绕过预览确认。`GET /ai/generate-status/{taskId}` 继续读取旧任务／结果，不恢复任务写入口。

**GET /ai/config**（`ai_config:read`）：读取 AI 服务配置，`api_key` 掩码回显（如 `sk-****xxxx`，完整键值永不返回，07 册 4.2）。**PUT /ai/config**（`ai_config:write`）：保存 `base_url` / `api_key` / `model`——权威副本为 AES-256-GCM 加密后的配置文件，Redis 仅作缓存（07 册 4.2），并返回同样的脱敏配置结果。**POST /ai/config/test**（`ai_config:write`）：以已保存配置发起一次连通性测试，返回成功 / 失败与脱敏错误摘要（失败 → 50005）。`ai:read/write` 仅代表出题任务/题库工作流，不自动授予配置权限；管理端入口要求 `ai_config:read` 或 `ai_config:write`，但 writer-only 页面不得调用 GET、不得伪造现有配置值，只能提交空白表单并使用 PUT 返回的脱敏结果；`super_admin` 天然拥有全部注册权限。

**人工题 create/edit DTO**：create的`category_id/difficulty/type`必填；普通输入需要`stem/options/answer`，`content_schema_version:2|3 + content_json`可规范化产生兼容投影，analysis可选。edit是部分更新，必须同时显式携带`expected_version_id`与布尔`expected_enabled`。两者严格拒绝score、concept_id、material_id、regulation_id、regulation_version_id与source；新题与新版本不暗填分值或概念。修订保留可信历史资料来源，但新版本concept_id写NULL。专用questions_ai确认允许source=ai且无永久来源，不能借人工DTO伪造。single答案恰一项，multiple至少两项，judgment固定正确／错误；受控图片与schema3白名单按现有媒体owner链路校验。

**版本与启停语义**：人工新建、修订、文件确认和AI选行确认均直接启用；新版本兼容status=approved，但approved_by/approved_at/reviewed_by/reviewed_at/review_reason均NULL，不伪造审核事实。修订在同一事务锁内同时比较identity的current_version_id和is_enabled；版本化题传字符串expected_version_id，真正legacy明确null，启停状态必须显式布尔expected_enabled。任一不符返回40940且零新版本、不恢复启用；停用题明确以expected_enabled=false保存后创建新版本并启用。启停接口只接收enabled和expected_version_id，同目标重试幂等，恢复时在锁内验证结构、类别、启用难度、来源及媒体，失败不恢复。POST／PUT成功额外返回本次实际saved_version_id，普通GET／list不伪造保存回执；列表接受page/page_size/material_id/category_id/enabled/type/difficulty/keyword，不接受concept/status。当前视图返回enabled及question_id/current_version_id/revision，不输出考点、建议分或审核工作流字段。旧题首次修订诚实捕获旧版本，legacy_captured_at仅代表升级捕获，未知历史事实保持null。

**分页与安全显示**：版本history返回`{items,total,page,page_size}`，默认1/20，上限100；考点列表与选项路由退场。题目列表、详情、历史及未保存预览统一安全白名单清洗；遗留脚本、事件、javascript URL和外链图片只在响应边界移除，不回写历史。受控图片经鉴权媒体接口读取。

**逻辑删除（029）**：`DELETE /ai/questions/{id}`严格body为`{expected_version_id:string|null,expected_enabled:boolean}`，版本键必须显式存在，legacy允许null；成功data为`{question_id:string,deleted:true,deleted_at:ISO字符串}`。事务锁定身份后，已删直接返回原时间；否则同时比较current_version_id与is_enabled，不符40940且零写。首次仅写deleted_at与is_enabled=false，不建版本／不删行，首次审计；不存在40401。当前GET详情已删40401，全部列表（含停用／全部）排除已删，history继续可读。恢复、修订、带身份作者提交与新发布锁内拒绝已删；既有草稿引用保留但不可发布，历史release／个人题单／结果和旧无release开考不套用当前删除过滤。客户端不自动重发未知DELETE：先GET当前详情对账，40401移出列表；仍存在则应用服务器状态；读回失败保留该题写锁并提示刷新。开关在独立状态列，操作列仅预览／修改／删除，180px且表头和按钮居中。

**人工 Tiptap 编辑输入（2026-10-26）**：当前新增/修订弹窗直接编辑题干、选项和解析富文本 JSON，保存使用 `content_schema_version:3 + content_json`；正确答案由编辑器选项状态映射为 `answer_option_ids`，选项排序不改变其稳定 ID。兼容 HTML/数字下标字段由 JSON 单向投影，不以旧表单快照覆盖富文本结果。沿用现行新增/修订路径、版本/启停并发锁和成功凭据；“保存并新增”是收到成功凭据后的客户端行为，不新增批量接口。图片继续仅持久化合法 `asset_id`。详见[融合设计](../superpowers/specs/2026-10-26-manual-question-tiptap-design.md)。

**考点历史兼容**：question_concept和既有concept_id只保留历史，不提供新CRUD、不参与新候选或新发布。所有新题和新revision写concept_id=NULL，旧版本与既有快照保持原值。

**历史扫描PDF来源定位**：既有版本保留真实source_page_group/source_page_start/source_page_end和资料版本，不依据模型补造或重写。旧资料直接生成与历史题直接重生成写入口已退场；当前参考题AI仅使用内存参考文件。

**候选服务边界**：兼容命名approvedCandidates只返回question.is_enabled=1、精确current_version_id及category/type/启用difficulty匹配的不可变快照；来源集合和媒体规则继续校验。资料来源选项保留真实历史题目的category_id + regulation_id关联及旧资料类别匹配，不把新资料预绑类别。候选本身不创建发布或个人题单；新候选与新发布按question_id去重。

**PUT /ai/papers/{id}/questions**：legacy制度卷新组卷校验启用题的精确当前版本、内部 `question.regulation_id` 与试卷一致、同卷不重复；该旧执行链仍只消费 single/multiple。training 固定卷经 `/admin/papers` 支持三类客观题，并在创建、更新、选题、发布边界校验题目类别和资料来源，不允许跨类别。

**制度卷升级发布边界**：升级后从 draft 执行 `POST /ai/papers/{id}/publish` 时，在同一事务内捕获通过启用校验的题目真实精确当前revision，并把实际 `paper_question.score`、题目内容与策略写入 `paper_release*`。旧题未知 `category/difficulty/approved_by/approved_at` 分别保持 `null/unknown/null/null`，不得伪造 easy 或历史审核事实。此后 list/detail/publish 在原数字 `id` 和原字段之外仅兼容新增 `release_id:string|null`、`rules_locked:boolean`；有 release 时详情读取冻结题目、实际分值和 RuleSnapshot，策略/题单修改返回 40970。真正升级前已 published 且没有 release 的卷继续返回 `release_id=null/rules_locked=false`，保留旧动态策略语义，不补造历史快照。

**复制契约**：`POST /ai/papers/{id}/copy` 使用 `papers:write`，返回原数字 ID 形状的新 draft，且 `release_id=null/rules_locked=false`。有 release 的源卷复制冻结的题目版本、实际分值、规则及学习门槛；无 release 的旧卷复制当前事实。源 release 不变；若复制后题库 current revision 已推进，重新发布返回 40970 并提示重新选题，不静默替换版本。

#### 3.5.1 培训试卷与不可变发布 /admin/papers（C1）

本节与上述 legacy `/ai/papers` 并存，不改写其 ID 类型、分页形状或学习门槛。下表 ID 均为正十进制字符串：

| # | 方法 | 路径 | 权限与语义 |
|---|---|---|---|
| 1 | GET | /admin/papers/category-options | `papers:read`；启用类别 `Page<{id,name}>` |
| 2 | GET | /admin/papers/regulation-options | `papers:read`；必传 category_id；按该类别题目的实际 `category_id + regulation_id` 关联或旧资料自身 category 匹配返回资料来源选项 |
| 3 | GET | /admin/papers/course-options | `papers:read`；必传 category_id，仅返回该类别已上架课程，供考前学习要求选择 |
| 4 | GET | /admin/papers | `papers:read`；按 keyword/category_id/mode/status 分页，固定按 `sort_order ASC,id DESC` 返回 `Page.items` |
| 5 | POST | /admin/papers | `papers:write`；创建 training 草稿，默认 requires_learning=false |
| 6 | GET | /admin/papers/{id} | `papers:read`；配置、固定题单及 latest_release_id |
| 7 | PUT | /admin/papers/{id} | `papers:write`；只允许 draft，发布后返回 40970 |
| 8 | GET | /admin/papers/{id}/candidates | `papers:write`；启用题精确当前revision，可按type/difficulty筛选 |
| 9 | PUT | /admin/papers/{id}/questions | `papers:write`；全量替换固定题单 |
| 10 | GET | /admin/papers/{id}/preview | `papers:read`；不返回 answer/analysis |
| 11 | GET | /admin/papers/{id}/preview/answers | `papers:read` 且还需 `papers:export` / `questions:read` / `questions:export` 之一；答案版 |
| 12 | POST | /admin/papers/{id}/publish | `papers:publish`；冻结发布版本，返回 `{release_id}` |
| 13 | POST | /admin/papers/{id}/copy | `papers:write`；复制配置/固定题单为新 draft |
| 14 | POST | /admin/papers/{id}/withdraw | 已退场，404；不再产生 withdrawn 状态 |
| 15 | POST | /admin/papers/{id}/archive | 已退场，404；不再产生 archived 状态 |

**现行状态边界（2026-10-26）**：新写入流程仅 `draft → published`，发布后调整沿用复制新草稿。培训和 legacy 试卷的撤回/归档写入口均不再注册；旧状态的列表、详情、快照读取和开考限制仍保留，读取接口可继续按历史状态筛选，PC 日常筛选只提供草稿、已发布。不迁移或重写历史状态。

**创建/修改 DTO**：`title/mode/category_id` 为核心字段；`regulation_ids/course_ids` 是去重字符串 ID 数组，其中 regulation_ids 表示题库资料的内部来源 ID；`requires_learning` 默认 false；`sort_order` 可选且必须为0—2147483647整数，创建默认0、更新未传保持原值；`total_score` 创建默认100、更新未传保持原值，范围0.01～999.99且最多两位小数；及格分数大于0且不超过目标总分；及格分数/限时/次数/漏选比例默认 60/30/3/0.5。随机卷 `rules=[{type,count,score_cents}]` 最多三项且题型唯一，发布时满足 `Σ(count×score_cents)=round(total_score×100)`；固定题单发布时每题score_cents为正整数且合计等于目标总分币。固定草稿题单允许score_cents=0和未配齐，保存仍校验题目完整性及合法引用。固定草稿普通/答案预览同样允许0分和未配齐，返回目标总分及实际题目分值；只有发布执行正分与合计检查，已发布预览仍读冻结快照。来源选项允许“当前类别题目实际关联该 regulation”或“旧资料自身 category 直接匹配”；新资料不预绑类别，跨类别创建、更新或发布返回业务冲突。

**排序字段（2026-10-26 / 031）**：training列表项、创建回包、详情与更新回包均返回`sort_order:number`；复制新草稿继承源卷排序值。该字段仅为管理列表元数据，不进入`paper_release`，不影响题单顺序、学员开考、成绩统计或legacy `/ai/papers`的响应及排序。

**操作信息（2026-10-26 / 032）**：`GET /admin/papers/{id}`以及training创建、配置更新、固定题单更新、复制回包在既有`created_at/updated_at`外返回`created_by_name:string|null`、`updated_by_name:string|null`。姓名按`sys_user.real_name`去空白后优先，否则回退`username`；用户已不存在或历史更新人未知返回NULL。详情对`created_by/updated_by`去重后一次查询至多两人，列表不返回姓名、不产生N+1。配置保存与题单全量替换即使值未变化也推进`updated_at`；首次发布写更新人/时间，重复发布保持幂等。客户端不得提交创建人、更新人或姓名字段。

**考前学习与备注（2026-10-26 / 030）**：增加`required_learning_minutes:number|null`与`remark:string|null`，在列表/详情回显。备注最多1000字符，空白归一NULL，未传更新保留原值；只作管理信息。唯一开关`requires_learning`关闭时，新写入`course_ids=[]`、分钟为NULL；开启时必须选择至少一门同类别published课程，并设置1—2147483647的整数分钟。部分更新先合并原配置再校验，不允许单独清空必填值绕过规则。PC新增/配置/设计器隐藏资料来源输入，开启“考前学习要求”才显示课程与分钟；新增采用既有次数3、漏选比例0.5。

发布前重验学习配置，release冻结开关、课程ID与分钟。`POST /me/exams/{paperId}/start`的首次/补考创建前，以本人在关联课程当前有效视频版本的`credited_ms`合计校验（已删除课时/旧版本/其它课程不计；有效重复播放沿用原累计）。不足返回40901，`data={reason_code:'LEARNING_REQUIRED',required_learning_minutes,credited_seconds,remaining_seconds,course_ids}`，不创建记录、不消耗次数；message说明仍需学习的分钟。已有进行中考试恢复优先，旧release分钟NULL保持历史行为，legacy制度阅读校验独立保留。

**发布硬校验**：候选只取同培训类别、启用题的精确当前revision，题型／启用难度及可选资料来源匹配，媒体授权合法；课程不参与题池过滤。新随机两池按question_id计算容量，不足返回40971与deficits；所有新固定／随机发布也按question_id去重，新release不写concept。发布事务重新锁定身份并复核仍启用且仍指向所选版本，失效整体回滚，不留release或published状态。既有随机release则显式使用historical-concept模式：按冻结concept分组，无concept回退question_id，预览与开考保持原语义；不恢复当前考点功能、不改写历史。

**预览契约**：共通字段为 `paper_id/release_id/mode/sample_kind/note/difficulty/rule/capacities/questions`。`rule` 使用 snake_case：`total_cents/pass_cents/duration_minutes/max_attempts/partial_credit_ratio/rules[].score_cents`。固定卷 `sample_kind=fixed_paper`、`capacities=[]`；随机卷 `sample_kind=random_example`，显示初/高两池各题型 `required/available` 及选定难度的一次样例，`note` 必须明示“样例不代表所有考生同卷”。已发布及历史撤回/归档记录均读不可变 release，不回读题库当前内容；历史状态保留不表示开放写入动作。

schema3题目的普通预览额外返回`content_schema_version:3`与`content_json:{stem,options}`，只含完整富文题面/选项；`content_json`中不含`answer_option_ids/analysis`，外层同样不含`answer/analysis`。答案版`/preview/answers`经原有答案权限校验后返回完整schema3 `content_json`（含标准答案稳定ID和富文解析）及兼容答案/解析字段。PC预览使用这个明确的无答案部分内容类型显示富文，不能为了显示格式把答案带回普通预览。

**C1/C2 边界**：C1 只负责发布；C2 新增独立 `/me/exams*` 个人题单 API。`POST /exams/papers/{id}/start` 仍不接受 `business_scope=training` 或空 regulation_id，返回 40402；旧制度固定卷经快照适配器保持数字 `question_id` 与原响应形状，资格守卫和单/多选限制不变。

### 3.5.2 题库文件导入 /admin/questions（B4，权限 `questions:write`）

| 方法 | 路径 | 输入 | 输出 |
|---|---|---|---|
| GET | `/admin/questions/import-template?format=xlsx\|txt` | 严格格式枚举；可选 `purpose=ai` | 默认中文五列 XLSX / 标签分块 TXT；AI 返回原七列参考模板 |
| POST | `/admin/questions/import-preview` | multipart `file`、`format`、必填 `category_id`，对整批生效 | `ImportPreview` |
| GET | `/admin/questions/import-batches/{id}` | 仅 questions 批次 owner | 未提交返回 `ImportPreview`；已提交返回 `ImportResult` |
| POST | `/admin/questions/import-batches/{id}/commit` | `{row_numbers:number[]}`，只能选预检合法行 | `ImportResult` |

普通模板为中文五列“试题内容、试题类型、选项内容、答案、难度”，兼容旧中文四列；难度只填简单／困难，缺失或空白默认easy。TXT采用[题干]/[类型]/[选项]/[答案]/[难度]分块，选项为`${内容},${内容}`，答案为字母或对／错。Excel首张空白数据表，另设示例、说明表且不参与解析。所选category_id覆盖整批文件类别，不能使用页面默认难度。仍兼容英文七列`category,type,difficulty,stem,options,answer,analysis`；兼容旧九列`category,type,difficulty,concept,stem,options,answer,analysis,score`及仅少concept或仅少score的两种八列，按表头映射。非空旧concept返回行错误“考点组已取消，请清空后重试”；旧score任何值仅忽略，批次warnings提供一次“旧模板分值已忽略，请在组卷时设置”。旧英文TXT仍使用UTF-8 TSV、options/answer为JSON数组；中文TXT及旧TSV均支持BOM/CRLF；5MB、1000行硬上限。业务列公式按行错误拒绝，旧score公式忽略且不执行；超表头的非空数据／公式拒绝。见[填写说明](../templates/question-import-format.md)。

预检复用三题型、富文本、媒体、类别及来源校验。ImportPreview含`batch_id,valid_rows,errors,duplicates,warnings,rows`，rows为有效题逐题预览（row_number及七字段，options/answer为数组）；指纹不含concept或score。确认锁定owner+batch，在同一事务创建启用的import身份／版本与回执`{batch_id,created_ids,committed_rows,enabled:true}`；同集合返回原回执，换集合40911。跨owner/kind为40302；未知响应先GET原批次。旧未提交draft显式去concept/score投影，已提交旧批次原回执不重写。

### 3.5.3 AI 参考题导入 /admin/questions（一次性参考文件）

| 方法 | 路径 | 输入与成功结果 |
|---|---|---|
| POST | `/admin/questions/ai-import-tasks` | `ai:write`；multipart 仅 `file + format=xlsx\|txt`，返回任务状态 |
| GET | `/admin/questions/ai-import-tasks/{id}` | `ai:read`；读取本人任务状态 |
| GET | `/admin/questions/ai-import-batches/{id}` | `ai:read`；读取本人 `questions_ai` 预览批次或已确认回执 |
| PATCH | `/admin/questions/ai-import-batches/{id}/rows/{row}` | `ai:write`；修改生成行的可编辑题面并重新校验，返回完整批次 |
| POST | `/admin/questions/ai-import-batches/{id}/rows/{row}/regenerate` | `ai:write`；按该生成行可信类别、题型与easy/hard难度重新生成，返回完整批次 |
| GET | `/admin/questions/ai-import-batches/{id}/download?format=xlsx\|txt` | `ai:read`；导出生成题的标准七列文件；二进制流，不包业务信封 |
| POST | `/admin/questions/ai-import-batches/{id}/commit` | `questions:write`；`{row_numbers:number[]}` 只接受合法生成行，返回 `ImportResult` |

AI通过模板接口purpose=ai下载七列参考格式；输入保留§3.5.2的旧英文七列及九列／两种八列映射，5MB、最多50参考行；旧concept非空固定报错，旧score仅warnings。每道参考题最多生成一对easy／hard，参考行difficulty不作为生成目标。服务端固定类别、题型与目标难度，不让模型／客户端指定来源、状态、审核人、考点、分值或资料版本。

任务状态固定为 `{task_id,status,total_count,completed_count,generated_count,failed_count,batch_id?,message?,warnings?}`。参考文件与参考正文只存在于任务内存；完成、失败、超时后释放，禁止写入磁盘、MySQL、Redis、资料/媒体表、审计详情或日志。Redis 仅保存无参考正文的任务状态，TTL 24 小时；服务重启后仍未完成的任务读取为 failed，要求重新上传。

批次返回`{batch_id,status,valid_rows,errors,duplicates,warnings,rows,created_ids?,committed_rows?,enabled?}`，rows每项为row_number、七字段及errors，options/answer为数组，无concept／score。批次仅保存生成题和固定转换元数据，不保存参考行；未确认24小时有效，已确认回执不按该期限失效。支持全部／easy／hard筛选、修改、批次内单行重生成与七列下载；已提交禁止修改。

确认前question/question_version零写入。选行确认锁定owner+kind+batch，原子创建启用题、revision 1及回执enabled:true；强制source=ai、无永久来源，兼容status=approved而审核元数据NULL，无第二次审核。相同行集合幂等，不同集合40911；全部失败不创建批次，部分失败仅展示有效生成题。普通questions/students入口不能确认questions_ai。旧未提交批次显式投影去概念／分值，已提交旧回执不重写；未知响应先GET原批次。

### 3.6 学习模块 /learning（权限：员工，数据范围自动收口为本人）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | /learning/regulations | 我的制度列表（待学/已学 + 进度概览） |
| 2 | GET | /learning/records/{regulationId} | 学习进度查询 |
| 3 | POST | /learning/sessions/start | 开始学习会话 |
| 4 | POST | /learning/heartbeat | 学习心跳上报（30 秒/次） |
| 5 | POST | /learning/heartbeat/pause | 失焦暂停（锚点结算） |
| 6 | POST | /learning/heartbeat/resume | 恢复聚焦（锚点重置） |
| 7 | POST | /learning/sessions/{id}/end | 结束会话（落库聚合） |

**GET /learning/records/{regulationId}** 响应 data：`total_seconds`（累计有效时长）、`required_seconds`（阈值 = required_minutes × 60）、`remaining_seconds`（缺口）、`max_scroll_percent`、`scroll_coverage`（10 段位图 JSON）、`is_valid`、`valid_at`——`is_valid = false` 时附带差距信息（剩余时长缺口 / 底部段未覆盖），支撑 FR-LRN-06 验收①。

**POST /learning/sessions/start**：body 含 `regulation_id`；校验制度 published + 范围可见；单活跃会话约束（后开者胜，05 册 5.4.1）——已有活跃会话时先结束落库再返回新 `session_id`；返回 `session_id` 与服务端心跳节拍参数。

**POST /learning/heartbeat**：body 含 `session_id`、`dwell_segments`（整型数组，本心跳周期内停留 ≥ 10 秒的段位集合，取值 0–9，允许空数组，07 册 3.1.1/3.1.3）、`scroll_percent`（最大百分比）；服务端处理：会话存在性校验 → 时间差结算（`credited = min(now − last_beat_at, 45秒)`，05 册 5.4.2）→ Redis HINCRBY 累计 → 对 `dwell_segments` 中每个段位置位（停留 ≥ 10 秒语义，07 册 3.1.3）→ 聚合触发时判定有效学习（会话结束 / 离线收口 / 定期 5 分钟，05 册 5.4.6）。响应返回 `server_time`、`credited_seconds`、`total_seconds`（实时累计）、`progress_hint`（布尔，Redis 侧实时估算，仅用于界面提示「预计已达标，正在结算」——不得据此解锁考试入口）、`is_valid`（**仅在聚合落库事务完成后**为 true，未落库时恒为 false 且 `valid_at` 为 null）、`valid_at`（仅真实落库值，05 册 5.4.5 同口径）。

**POST /learning/heartbeat/pause**：body 含 `session_id`、`dwell_segments`（整型数组，允许空——失焦/关页 flush 携带本地未上报的已确认段位）、`scroll_percent`；服务端结算 `min(now − last_beat_at, 45 秒)` 计入累计、合并位图后置 `state = paused`——失焦期间零累计，普通心跳到达也不计费（只更新滚动位置）。前端在 `visibilitychange → hidden` 与 `pagehide` 时以 `navigator.sendBeacon` 调用本端点，完成未上报段位的 flush（07 册 3.1.1）。**POST /learning/heartbeat/resume**：仅锚点重置（`last_beat_at = now`），不产生任何时长。pause/resume 独立端点的理由：失焦是事件驱动（不定期），与 30 秒周期心跳分离，语义与 05 册 5.4.3 锚点模型一一对应。

### 3.7 legacy 考试模块 /exams（权限：员工，数据范围自动收口为本人）

本节是旧制度固定卷接口契约：资格链继续包含 `learning_record.is_valid`，40901 继续返回时间缺口与底部段覆盖详情。新开考冻结发布快照；升级前 published 且无 release 的固定卷在首次新开考时捕获当时题面并标记 `legacy_start`。旧客户端仍收发真实冻结 source `question_id`，服务端精确映射到本次 `item_id`。training 记录不复用本节 recover/heartbeat/submit/result，返回 40402。

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | /exams/papers | 可考列表（含资格状态与剩余次数） |
| 2 | POST | /exams/papers/{id}/start | 开考（资格校验 + 创建记录 + 乱序下发） |
| 3 | GET | /exams/records/{id} | 恢复考试（断网重进，乱序一致） |
| 4 | POST | /exams/records/{id}/heartbeat | 考试心跳（时间校准 + 作答暂存） |
| 5 | POST | /exams/records/{id}/submit | 交卷评分（幂等） |
| 6 | GET | /exams/records/{id}/result | 成绩与答题明细（含解析） |
| 7 | GET | /exams/records | 我的考试记录列表 |

**GET /exams/papers** 响应项含：试卷信息、关联制度、`is_eligible`（is_valid）、`attempt_used` / `max_attempts`（剩余次数）、`best_score`（已考过的最高分）、`has_passed`（已通过标记——已 passed 不再显示「开始考试」入口）。

**POST /exams/papers/{id}/start**：资格语义仍是制度 published → 试卷 published → `is_valid = 1` → 次数/已通过检查 → 无并发 active。C2 实际原子顺序为 `sys_user` 写锁（并校验启用）→ `exam_assignment` → 本人该卷全部 `exam_record` → 新开时 `exam_paper`；数据库唯一键是权威并发防线，不依赖旧 Redis start 锁。通过后同事务创建 assignment、`exam_record`、`exam_record_question` 与题干/选项媒体引用；返回旧数字字段时把内部 item ID 映射回真实冻结 source question ID，且**不含 answer 与 analysis**。

**POST /exams/records/{id}/heartbeat**：body 含 `answers[]`（source question_id + 呈现位置选择）。有 C2 assignment 的记录先按同一 record 映射为 item_id，再把 partial patch 合并进数据库确认稿；遗漏题目不清空。真正升级前无 assignment 的进行中记录继续使用 Redis 暂存。响应返回 `remaining_seconds`（`deadline − 服务端当前时刻`，前端每 30 秒校准，不信任本地时钟）。

**POST /exams/records/{id}/submit**：旧body仍含数字`answers[]`；有assignment先按冻结source question ID映射本次item，并由legacy adapter转换冻结稳定ID后主动提交；无assignment保留旧主动评分兼容。终态重试返回首次旧形状结果；到期一律纯timeout，不再按Redis暂存评分。旧结果options/answer/selected保留原始域，010/021不改历史selected/score。本节API不提供PC学员页面入口。

**GET /exams/records/{id}/result**：`status` / `score` / 逐题明细（stem / selected（已还原原始下标）/ is_correct / gained_score / answer / analysis）——解析仅在交卷后的成绩回看中下发。

### 3.7.1 本人培训考试 /me（mobile employee，Exam Contract v1）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | /me/exams | 当前类别已发布 training 卷 + 本人已有 assignment 分页列表 |
| 2 | POST | /me/exams/{id}/start | 原子首次开考、补考或有效 active 恢复 |
| 3 | GET | /me/exam-records/{id} | 权威状态；进行中才返回题面，到期先纯timeout |
| 4 | POST | /me/exam-records/{id}/submit | 学员主动确认后的严格整卷稳定ID答案 |
| 5 | GET | /me/exam-records/{id}/result | 主动交卷结果、纯timeout或历史待确认结果 |
| 6 | GET | /me/exam-records | 本人考试历史Page分页，保留timeout记录 |
| 7 | GET | /me/wrong-questions | 本人finalized非满分题Page分页，新纯timeout无条目 |

`POST /me/exams/{id}/start` 的首次新开要求账号启用、试卷 published、启用培训类别、用户 category/source 必填且类别与 release 匹配。random 卷按 `institution → easy`、`external → hard` 抽取；fixed 卷按冻结题单得出单一难度或 `mixed`。首次同事务冻结 `release_id/source/category_id/difficulty/rule_snapshot/snapshot_origin`，补考沿用 assignment，不按用户新资料或题库当前内容重算。升级前旧 `exam_record` 同样计入 `max_attempts`，默认总次数 3 次（含首次）。

全部接口只接受启用中的mobile employee。未实名可浏览列表；新开考、恢复进行中题面、主动交卷要求`learner_identity`权威事实。unverified/rejected返回40302 + `IDENTITY_REQUIRED`，pending为`IDENTITY_PENDING`；Debug Login不产生实名，供应商disabled不否定既有verified事实。终态状态/历史结果不重复要求实名。

恢复先于当前category/source和paper状态检查：active沿用原record/snapshot/deadline，不因改来源/类别、撤卷或改题重抽/延时。状态查询在锁内检查deadline，已到期先纯timeout再返回。新链路不提供`PUT .../draft`和`POST .../heartbeat`，不能从读状态、恢复、清扫、Redis事件触发交卷或评分。

`AttemptRecordViewV2`见§4.7.1：只含status、record_id、paper_id、release_id、deadline_at、server_now和questions。能力2进行中题目仅`item_id/type/score/stem/options[{id,content}]`，能力3额外增加`content_schema_version:2|3`；终态questions=[]。schema2受限Tiptap递归重建白名单只允许doc/paragraph/text/hardBreak/image，图片attrs仅十进制字符串asset_id；最多2000节点、100000文本字符、深度4，拒绝marks/src/HTML/链接/样式/未知字段。schema3按1.0的独立白名单；任何层级均不下发答案、解析、checked/correct、来源/难度或服务端草稿元数据。

提交body严格为`{record_id,answers:[{item_id,option_ids}]}`，ID是字符串，path/body相同；每题恰一次、未答[]，选项须本题存在且唯一，single/judgment最多一项。拒绝缺项/重复/未知/跨题、selected/revision/asset_ids等旧字段或未知嵌套字段，返回40001。处理先认证、查本人记录和加锁；passed/failed直接返回首次结果，历史submitted返回待确认，timeout返回超时；只有active首次提交才严格校验body。锁后唯一accepted_at严格`< deadline_at`才受理，同一时刻写submitted_at并同事务评分到manual/finalized的passed/failed。事务失败全部回滚，并发不同答案/timeout竞争只产生一个终态及一组副作用。

纯timeout原子写status=timeout、score=0、grading_state=not_submitted；submission_method/submitted_at/graded_at及active_assignment_id=NULL，draft_revision=0且其余draft元数据NULL。不调用评分、不创建exam_answer、不生成逐题得分；升级前active草稿行只做同record清理，历史终态不改。结果为passed=false、correct_rate=null、items=[]，展示“超时未交卷”，不开放解析、不进错题或finalized统计分母。

`FinalResultV2`含status、record_id、grading_state、submission_method、legacy、可空submitted_at/graded_at、score、passed、correct_rate及items；题项用稳定selected_option_ids/correct_option_ids与受限analysis。历史submitted单独返回`LegacySubmittedResult`（score/passed/correct_rate=null、items=[]），展示“历史结果待确认”；历史已评分timeout保留既有分数/明细及timeout方式，按历史评分事实投影passed/failed。legacy由schema/快照与历史事实判定，不能用submission_method为空推断。完整DTO见§4.7.1。

本人历史为`Page<ExamHistoryItemV2>`；错题为`Page<WrongItemV2>`，只读finalized非满分（含主动交卷未答和部分分）题。新纯timeout不进错题，旧finalized历史timeout保留事实。题图固定`exam_record_question/item_id`精确引用，签票/读取均重查归属和阶段：在考实名且未截止只开放prompt；passed/failed及历史已评分timeout按冻结结果允许题干/选项/解析图；仅新纯timeout拒绝题图。PC `exam_records:read` Bearer预览独立，不能签learner票据。

### 3.7.2 管理端考试记录（只读）

三个入口统一要求 `exam_records:read`。`ExamRecordsService` 只提供列表与详情投影；结果复用 `ExamHistoryService`，不复制评分逻辑。

| 方法 | 路径 | 权限 | 请求与成功 data |
|---|---|---|---|
| GET | `/admin/exam-records` | `exam_records:read` | query `page/page_size/keyword/paper_id/source/difficulty/status/grading_state`；返回分页记录摘要 |
| GET | `/admin/exam-records/{id}` | `exam_records:read` | 返回与列表同源的单条记录摘要；不返回题目答案或解析 |
| GET | `/admin/exam-records/{id}/result` | `exam_records:read` | 终态返回与本人接口同源的 `FinalResult`；进行中记录按结果 reader 的状态规则拒绝 |

列表/详情摘要字段为 `record_id/paper_id/paper_title/user_id/username/name/source/category_id/difficulty/release_id/attempt_no/started_at/deadline_at/submitted_at/answered_count/total_count/status/grading_state/submission_method/score`。`source/difficulty` 只读该记录冻结值；submission_method为null包含新纯timeout未交卷或旧历史方式未知，不能由null推断legacy。接口不返回或派生 `last_heartbeat_at/connection_state/switch_count/device_summary`。主动评分终态与历史已评分timeout可按冻结结果读取题干/选项/解析图，新纯timeout不能读取题图，但不存在学员答案图片或人工评语。

### 3.8 统计模块 /statistics（权限：制度管理）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | /statistics/regulations | 全部制度统计概览列表 |
| 2 | GET | /statistics/regulations/{id}/overview | 单项制度七项指标 |
| 3 | GET | /statistics/regulations/{id}/departments | 部门维度对比 |
| 4 | GET | /statistics/regulations/{id}/uncompleted | 未完成人员清单 |
| 5 | GET | /statistics/users/{id} | 个人维度（学习记录 + 考试成绩） |
| 6 | GET | /statistics/export | Excel 导出 |

**指标口径**（05 册 7.4.1，逐字一致）：

| 指标 | 口径 |
|---|---|
| 应学人数 | 发布范围内 `sys_user.status = 1` 的员工数 |
| 学习完成率 | `is_valid = 1` 人数 / 应学人数 |
| 参考人数 | 至少一条 `exam_record.status ≠ in_progress` 的去重用户数 |
| 通过率 | 最高分 ≥ pass_score 人数 / 参考人数 |
| 平均分 | 每人最高分的算术平均 |
| 分数分布 | [0,60) [60,70) [70,80) [80,90) [90,100] 五段人数（按每人最高分；左闭右开、`FLOOR(score/10)` 分桶、score ≥ 90 归最高桶——兼容 DECIMAL 小数分值，如 89.50 归入 [80,90)） |
| 未完成人员清单 | 应学但 `is_valid = 0`，含学习进度（total_seconds / max_scroll_percent） |

**GET /statistics/export**：查询参数 `type`（regulation_overview / uncompleted / user_detail）+ `regulation_id`；返回 Excel 二进制流（07 册 4.2 下载鉴权）。

#### 3.8.1 C6 培训场次统计、分榜与权限首页

旧 3.8 六个接口及 Excel 形状保持不变；新增接口如下：

| 方法 | 路径 | 权限 | 请求与成功 data |
|---|---|---|---|
| GET | `/statistics/training/options` | `statistics:read` | 统计专用窄选项 `{papers:[{id,title,category_id,status}],categories:[{id,name}]}`，不要求额外题库/试卷/类别读取权限 |
| GET | `/statistics/training/overview` | `statistics:read` | `keyword/category_id/page/page_size` 可选；返回 `Page<TrainingExamOverviewRow>`，默认 1/20，每页最多 100 |
| GET | `/statistics/training/summary` | `statistics:read` | `paper_id` 必填；`category_id/source/difficulty/page/page_size` 可选；返回 `TrainingExamSummary` |
| GET | `/statistics/training/ranking` | `statistics:read` | 同查询，但 `difficulty` 必须明确；返回 `Page<RankRow>`，缺失难度返回 40001 |
| GET | `/statistics/training/export` | `statistics:export` | 与 ranking 完全相同的筛选和分页；下载当前页 xlsx，并附独立“口径说明”Sheet |
| GET | `/admin/dashboard` | 登录 | 返回 `{as_of,timezone:'Asia/Shanghai',metrics,exam_trend?}`；无权模块的指标键直接省略 |

`TrainingExamOverviewRow={paper_id,title,category_id,category_name,status,release_id,total_score,duration_minutes,pass_score,participant_count,finalized_users,average_score}`。总览只列培训试卷；名称取当前试卷标题，类别和总分/时限/及格线优先使用最新发布版本及其冻结规则。无发布版本时规则与均分为 null、人数为 0，不把草稿规则伪装成正式成绩依据。总览参考人数按最新发布版本成功开考的学员去重；均分只取该版本、相同规则的 finalized 个人最高分，跨难度仅作描述汇总，不生成混合排名。

`TrainingExamSummary` 固定包含：`exam`、`release_id:string|null`、`eligible_count/eligible_started_count/historical_started_count/historical_only_started_count/submitted_attempts/submitted_users/finalized_users`、`participation_rate:number|null`、`score_groups`、`difficulty_composition`、`course_completion`、`uncompleted_reasons`、`as_of`。`exam={paper_id,title,category_id,total_score,duration_minutes,pass_score,excellent_score:null}`；规则字段取发布快照，名称不声称冻结。分数分布按该组冻结总分的0%、60%、70%、80%、90%、100%划分五段，返回实际分数边界，最后一段包含满分；120分卷为[0,72)、[72,84)、[84,96)、[96,108)、[108,120]，历史100分卷保持原分段。`score_groups` 每项为 `{difficulty,finalized_users,average_score,highest_score,lowest_score,passed_users,average_duration_seconds,excellent_users:null,pass_rate,distribution:[{lower,upper,count}]}`。成绩指标统一使用同组个人最高分代表答卷，平均用时使用这些答卷的实际用时；无成绩时平均/最高/最低/平均用时为 null。当前没有优秀分规则，优秀分与人数均为 null，界面显示未设置/—，不将其当作 0。`RankRow={rank,user_id,name,gender,source,difficulty,score,duration_seconds,record_id}`，`gender='male'|'female'|null`，全部 ID 为字符串。

排名与导出新增可选 `sort_by=score|duration`、`sort_order=asc|desc`。先计算标准分数名次，再按指定字段排序，最后分页；用时排序不重编名次，同值保持稳定次序。导出沿用相同排序、筛选和页码，不扩大为全量导出。

人数与成绩采用两个显式口径，页面和导出不得混称：

- 当前应考按查询时点的启用账号、当前类别/来源及当前发布模式的难度映射计算；业务管理权限不改变学习身份。`eligible_started_count` 只取当前应考 ID 与历史成功开考 ID 的交集；`historical_started_count` 保留该 paper 全历史，当前范围外人数由 `historical_only_started_count` 单列，零分母参与率为 null。
- 历史筛选只读 `exam_record` 冻结的 `category_id/source/difficulty`，未知难度保持 `unknown`。成绩组和排名只使用 `release_id` 指向的最新 release、与其 `rule_snapshot` 完全一致、同 difficulty 且 `grading_state=finalized` 的记录，再取个人最高分；不跨 release/规则合榜。
- 同分使用标准竞争排名（1/1/3）。个人同分答卷在两个 `graded_at` 都已知时选较早者；任一历史时间未知时按最小 `record_id` 稳定兜底。用时取 `started_at → submitted_at`，旧已评分timeout按历史交卷方式取started_at→deadline_at；新纯timeout不进入排名。
- 课程完成率只统计当前应学的 institution 学员，按 published 课程必学课时的当前 `lesson_version` 与 B2 `video_learning_record.is_completed` 核算；external 不进入分母，零必学课时返回 null。未完成原因固定为 `learning_incomplete/not_started/not_passed`。

首页指标逐项授权：`students:read` 才返回正常学员数，`questions:read` 才返回题目数，`papers:read` 才返回试卷数，`statistics:read` 才返回近 7 日考试记录趋势。不存在待阅卷指标。趋势以服务端 `started_at` 转换到 Asia/Shanghai 自然日；无权限不返回 0 占位。

### 3.9 B1 课程内容 /admin/courses、/me/courses、/me/home

管理接口使用细权限，不要求类别管理权限。`GET /admin/courses/category-options` 是课程编辑器专用的启用类别窄查询；上传封面/视频仍调用 A4 `/media/upload`，因此操作者还需 `media:write`。

| 方法 | 路径 | 权限 | 请求与成功 data |
|---|---|---|---|
| GET | /admin/courses/category-options | courses:write | query `page/page_size/keyword`；`Page<{id,name}>`，仅启用类别 |
| GET | /admin/courses | courses:read | query `page/page_size/keyword/category_id/status`；`Page<AdminCourse>` |
| POST | /admin/courses | courses:write | `CreateCourse`；创建 draft 的 `AdminCourse` |
| GET | /admin/courses/{id} | courses:read | 课程资料、章节、课时当前版本与缺失必学课时 ID |
| PUT | /admin/courses/{id} | courses:write | `UpdateCourse`；未传字段不变 |
| POST | /admin/courses/{id}/publish | courses:publish | 上架或从 offline 重新上架；重新校验类别与全部必学视频 |
| POST | /admin/courses/{id}/offline | courses:publish | 下架但不删除结构、版本或媒体引用 |
| GET / POST | /admin/courses/{id}/chapters | courses:read / courses:write | 获取章节 / 创建 `{title,sort_order?}` |
| PUT | /admin/courses/{id}/chapters/{chapterId} | courses:write | 修改 `{title?,sort_order?}` |
| GET / POST | /admin/courses/{id}/lessons | courses:read / courses:write | 获取课时 / 创建 `{chapter_id,title,lesson_type:'video',required?,sort_order?,asset_id?}` |
| PUT | /admin/courses/{id}/lessons/{lessonId} | courses:write | 修改 `{title?,lesson_type?:'video',required?,sort_order?}` |
| DELETE | /admin/courses/{id}/lessons/{lessonId} | courses:write | 仅 draft/offline 课时逻辑删除；返回 `{id,deleted:true}`，不提供恢复入口 |
| POST | /admin/courses/{id}/lessons/{lessonId}/versions | courses:write | `{asset_id}`；追加视频版本并返回 `{version_id,asset_id,duration_ms,version_no}` |
| GET | /me/courses | 登录本人 | query `page/page_size`；`Page<CourseSummary>` |
| GET | /me/courses/{id} | 登录本人 | 可见课程目录；不返回管理员推荐/制度关联配置 |
| GET | /me/home | 登录本人 | query `page/page_size`，默认 `1/20`；`{site_config:PublicSiteConfig,courses:Page<CourseSummary>}` |

`CreateCourse = {title,category_id,cover_asset_id?,description?,regulation_ids?,is_recommended?,sort_order?}`；`UpdateCourse` 字段相同且全可选。所有 ID 为正十进制字符串，`cover_asset_id` 与 `regulation_ids` 可为 null，`regulation_ids` 最多 100 项且写入前逐一验证制度存在。`CourseSummary = {id,title,category_id,cover_asset_id,status,required_lesson_count}`。管理详情另含 `description/regulation_ids/is_recommended/sort_order/missing_required_lesson_ids/published_at/created_at/updated_at` 及：

```json
{
  "chapters": [{
    "id": "8", "title": "第一章", "sort_order": 1,
    "lessons": [{
      "id": "21", "title": "视频课时", "lesson_type": "video",
      "required": true, "sort_order": 1, "created_at": "2026-10-20T08:01:02.123Z",
      "current_version": { "version_id": "35", "asset_id": "50", "duration_ms": 120000 }
    }]
  }]
}
```

课程状态为 `draft / published / offline`。只有 draft/offline 可改变章节或课时结构；published 仍允许追加新 `lesson_version`，旧版本与媒体引用不覆盖。上架时锁定并确认类别启用，并要求每个有效必学课时的当前版本属于该课时、时长大于 0，且媒体为 ready 的 video；不满足返回 40930。课程的 `regulation_ids` 只是信息关联，不能进入抽题池或变成学习门槛。

课时 `created_at` 来自持久化的 `CourseLesson.createdAt`，不以视频版本时间或当前时间替代。删除在同一事务中先锁课程、校验未上架，再锁定该课程下的课时；课程不存在、课时不存在、跨课程或已删除均返回 40401，published 返回 40930，无 `courses:write` 返回 40301。成功仅通过 TypeORM `softDelete` 设置 `deleted_at`（并维护更新时间），永久保留课时、版本、媒体引用和学习事实，提交后写审计。目录、必学数、发布校验、当前完成率/统计、媒体读/签票/票据重读、视频开播及后续心跳默认排除删除课时；旧票据不绕过现时授权。`GET /me/video-records` 仍返回本人历史版本学习记录，不由软删除隐藏，也不由历史记录取得播放权限。

课程浏览集合固定为：账号启用且课程 `status=published`；`source`、`category_id` 与实名状态不作为列表/详情筛选条件，跨类别、external 或类别缺失仍可浏览，下架/草稿详情返回 40302。排序为推荐优先、`sort_order ASC,id DESC`。`GET /me/home` 直接并行组合真实 `SystemService.publicConfig()` 与 `CourseService.visibleCourses()`，站点字段仍只有 `logo_asset_id/banners`，课程集合、排序和分页与 `/me/courses` 完全相同。Task 12 Video Contract v1替换旧institution/同类别视频分配：两类来源及缺类别均可学习published课程；浏览仍不等于播放授权，后者须按3.10重查mobile employee、实名、current version与精确媒体引用。

PC 路由 `/admin/courses` 以 `courses:read OR courses:write` 判断入口可见。课程资料与章节/视频课时分别在“修改课程”“章节管理”弹窗维护，不再保留独立详情页；旧 PC 链接 `/admin/courses/{id}` 重定向到列表（不影响同路径的 API）。编辑弹窗仍需先通过 `courses:read` 读取资料，修改另需 `courses:write`，上传另需 `media:write`；服务端每个 API 的 `@Permissions` 仍保持 AND 守卫。write-only 账号可创建课程，但不读取列表或打开编辑弹窗。新建成功后，兼具 read 的账号留在列表并打开章节管理。课程列表不显示排序，但新增/修改表单保留数字排序控件，继续读写 `sort_order`。

### 3.10 B2 视频学习 /me/video-sessions、/me/video-records、/me/courses/{id}/progress

本节按Task 12 `Video Contract v1`记录已通过 Gate H1 自动化与独立代码审查的实现；真实视频解码、断网、全屏、微信开发者工具和真机仍未验。下列 `/me` 接口均只接受 `client=mobile` 且当前仍为employee的access token，PC password会话不能创建或维持学员视频会话。

| 方法 | 路径 | 权限 | 请求与成功 data |
|---|---|---|---|
| POST | /me/video-sessions | mobile employee本人且已实名 | `{lesson_id:Id}`；返回 `VideoSessionView` |
| POST | /me/video-sessions/{id}/heartbeat | mobile employee本人 | `VideoHeartbeat`；返回 `VideoProgress`，服务端复核活动所有权和当前资格 |
| POST | /me/video-sessions/{id}/close | mobile employee本人 | 无 body；只收口、不补记未上报区间，返回 `VideoProgress` |
| GET | /me/video-records | mobile employee本人 | `page` 默认 1、`page_size` 默认 20 且范围 1—100；返回本人历史 `Page<VideoRecordView>`，未知 query 拒绝；不以实名筛掉已有记录 |
| GET | /me/courses/{id}/progress | mobile employee本人 | 只读 `CourseProgress`；未实名仍可查询已有进度 |
| POST | /media/{assetId}/tickets | mobile普通学员本人且已实名 | `{owner_type:'lesson_version_video',owner_id:version_id}`；返回 `MediaTicketView`，签发/读取均走learner-only授权 |

```ts
type VideoHeartbeat = { seq:number; position_ms:number; state:'playing'|'paused'|'buffering'|'background'|'ended' };
type VideoProgress = { confirmed_position_ms:number; credited_ms:number; coverage_ms:number;
  duration_ms:number; completed:boolean; last_seq:number };
type VideoSessionView = { session_id:Id; version_id:Id; heartbeat_interval_ms:30000;
  media:{ asset_id:Id; ticket:MediaTicketView }; progress:VideoProgress };
type MediaTicketView = { content_url:string; expires_at:string };
type VideoRecordView = { record_id:Id; lesson_id:Id; version_id:Id; progress:VideoProgress };
type CourseLessonProgress = VideoProgress & { lesson_id:Id; version_id:Id };
type CourseProgress = { required:number; completed:number; completion_rate:number|null; lessons:CourseLessonProgress[] };
```

所有ID均为十进制字符串，客户端不得用number承载。start每轮先用短事务锁定 `sys_user`，重新检查mobile employee、账号启用、已有 `learner_identity`、课程published、video课时归属及current version正时长、ready/purpose=video资产与精确 `lesson_version_video + version_id` 引用；external/institution采用相同资格，类别缺失或课程类别不同不阻断。不能只相信 `LessonVersionService.current()` 或事务外 `assignedCourseIds()`。若发现活动reading，事务立即释放；随后才在事务外等待原reading mutex并调用唯一的旧阅读flush算法，再重新进入短事务权威校验，最多竞争重试3次。最终事务关闭旧video后重新取服务端时钟，初始锚点为paused、位置为confirmed_position_ms；实际play的第一拍playing仅重置锚点。阅读start同一循环及DB提交后、Redis发布前的所有权复核保持原约束。

start按同一轮权威current version返回 `media.asset_id` 和精确版本票据，禁止从课程详情旧缓存拼播放地址；事务提交后若签票前发生换版/下架/授权变化，须先关闭本次新session再失败，不返回半成品或遗留未知活动会话。票据即将过期可用start返回的asset_id/version_id重签，只换src并恢复当前播放器位置，不重建session或补时。未实名/被拒绝为40302 + `data.reason_code='IDENTITY_REQUIRED'`，核验处理中为40302 + `IDENTITY_PENDING`；只按reason_code引导。已结束/被替换session返回40950；下架、换版、引用失效或课程不可学先关闭活动session再返回40951，客户端停止播放/心跳并刷新权威进度，不自动start。

视频短票签发/续签以及 proxy 的每次内容读取使用独立 learner-only authorizer：重查启用employee、无有效管理权限、已有实名、published/current、ready资产及精确引用。通用Bearer内容读取仍兼容具备 `courses:read` 的PC管理预览；普通学员通用读取仍须实名及published/current，video不允许以上传者 `asset.owner_id===actor_id` 短路。角色/权限变化、停用、下架、换版或引用撤销后，拒绝新签/续签及旧代理票据；已发 COS 链接在到期前仍可读取。

心跳以数据库中的 `last_seq/last_heartbeat_at/anchor_position_ms/anchor_state` 为权威，进程重启后继续。仅前一锚点为 playing 且本拍为 playing/ended 时可确认区间；先以完整的非负服务端实际间隔判断 `forward_ms ≤ server_elapsed_ms + 2000`，再将有效时长取服务端间隔、45 秒和真实位置前进量的最小值。过大前进不增加 `coverage_ms`，只把下一拍锚点移到新位置。paused/buffering/background 不计时；重复观看可增加 `credited_ms`，合并后的覆盖区间不重复增加。`state=ended` 同拍结算合法区间后关闭会话。

完成条件是 `coverage_ms / duration_ms ≥ 0.95`。课程分母按当前published课程的required video lessons当前版本计算，不再以institution/同类别分配筛选；external、无类别、跨类别适用同一口径，零必学课时返回 `required=0,completed=0,completion_rate=null,lessons=[]`。每个进度项携带稳定 `lesson_id/version_id`，移动端按ID映射目录完成态和断点，不按数组下标猜测。视频替换后旧版本记录保留但不计入新版本完成；下架、当前版本替换、账号停用或播放资格失效会关闭后续计时，单独source/category变化不撤销课程资格。`GET /me/video-records`只按本人读取不可变版本历史，不按当前来源、类别、课程状态或current version隐藏记录，不返回媒体URL、不重开会话。该learner进度口径不改写3.8的C6管理统计既有分母。

客户端使用uni-app原生video；play/pause/waiting/ended映射到五态协议，error仅UI反馈，不能上报为后端state。waiting自然恢复后在仍有播放意图且前台未暂停时，以首个位置前进的timeupdate仅重建一次playing锚点，其余timeupdate不逐次请求。onHide暂停、立即报background并停止周期心跳，不close；前台恢复保持暂停，onUnload尽力close。断网沿用原生buffering/loading，最终失败简单重试，无离线缓存、补时队列或历史心跳重放。close与90秒回收只收口。播放器start/close串行，心跳同seq不并发；切课时/切账号/卸载按session/revision/登录epoch丢弃迟到响应，未知start结果不自动并发重发。真实全屏、拖动、微信合法域名/Range及真机仍须另验。

---

## 4. 核心接口 JSON 示例

以下示例展示完整请求/响应信封（`code`/`message`/`data`），字段与 03 册表结构对齐。

### 4.1 登录 POST /api/v1/auth/login

请求：

```json
{
  "username": "zhangsan",
  "password": "Passw0rd!2026"
}
```

响应（成功）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_in": 7200,
    "force_change_password": false,
    "user": {
      "id": 1001,
      "username": "zhangsan",
      "real_name": "张三",
      "employee_no": "E20240001",
      "department_id": 3,
      "department_name": "安全生产部",
      "role": "employee"
    }
  }
}
```

> refresh_token 经 Set-Cookie（HttpOnly + SameSite=Strict）下发，不在响应体出现；`POST /auth/refresh` 的凭据从该 HttpOnly Cookie 读取（07 册 2.1.1）。

### 4.2 上传题库资料版本 POST /api/v1/admin/question-materials/12/versions

请求（multipart/form-data）：`file=@安全培训资料V3.docx`

响应（成功）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "35",
    "version_no": 3,
    "file_type": "docx",
    "parse_status": "pending",
    "duplicate_hint": null
  }
}
```

### 4.3 参考题AI任务与选行确认示例

`POST /api/v1/admin/questions/ai-import-tasks`为multipart，仅提交`file + format=txt|xlsx`，不提交资料版本、考点或分值。返回任务task_id与计数，完成后取得batch_id；GET本人批次预览后再确认：

```json
{"row_numbers":[2,3]}
```

提交到`POST /api/v1/admin/questions/ai-import-batches/{batch_id}/commit`；成功业务data示例：

```json
{"batch_id":"31","created_ids":["201","202"],"committed_rows":[2,3],"enabled":true}
```

同集合重试回原结果，未知响应先GET原batch；生成、修改和单行重生成期间不得写题库。旧`POST /ai/generate-questions`已退场，旧`GET /ai/generate-status/{taskId}`仍保留任务／结果读取。

### 4.4 学习心跳上报 POST /api/v1/learning/heartbeat

请求：

```json
{
  "session_id": 1024,
  "dwell_segments": [6, 7],
  "scroll_percent": 78
}
```

响应（成功，进行中）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "server_time": "2026-09-12T15:04:30.000+08:00",
    "credited_seconds": 30,
    "total_seconds": 1125,
    "required_seconds": 1800,
    "remaining_seconds": 675,
    "scroll_coverage": { "total_segments": 10, "covered_count": 8, "segments": [1,1,1,1,1,1,1,1,0,0] },
    "progress_hint": false,
    "is_valid": false,
    "valid_at": null
  }
}
```

响应（成功，Redis 累计刚跨过阈值、尚未聚合落库）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "server_time": "2026-09-12T15:21:10.000+08:00",
    "credited_seconds": 30,
    "total_seconds": 1805,
    "required_seconds": 1800,
    "remaining_seconds": 0,
    "scroll_coverage": { "total_segments": 10, "covered_count": 10, "segments": [1,1,1,1,1,1,1,1,1,1] },
    "progress_hint": true,
    "is_valid": false,
    "valid_at": null
  }
}
```

> `progress_hint: true` 仅表示 Redis 侧实时估算已跨过阈值，界面提示「预计已达标，正在结算」；`is_valid` / `valid_at` 只能由聚合落库事务（会话结束 / 离线收口 / 5 分钟兜底，05 册 5.4.6）产生——落库完成后的心跳/进度查询才返回 `is_valid: true` 与真实 `valid_at`，此前考试入口以开考校验（40901）为准。

### 4.5 学习进度查询 GET /api/v1/learning/records/12

响应（未达标，含差距信息）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "regulation_id": 12,
    "version_id": 35,
    "total_seconds": 1125,
    "required_seconds": 1800,
    "remaining_seconds": 675,
    "max_scroll_percent": 78,
    "scroll_coverage": { "total_segments": 10, "covered_count": 8, "segments": [1,1,1,1,1,1,1,1,0,0] },
    "is_valid": false,
    "valid_at": null,
    "gap": {
      "time_gap_seconds": 675,
      "bottom_segment_covered": false
    }
  }
}
```

### 4.6 开考 POST /api/v1/exams/papers/8/start

响应（成功，乱序题目下发，不含 answer/analysis）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "exam_record_id": 9001,
    "attempt_no": 1,
    "paper": {
      "id": 8,
      "title": "安全生产管理制度 V3 考试",
      "total_score": 100,
      "pass_score": 60,
      "duration_minutes": 30
    },
    "remaining_seconds": 1800,
    "questions": [
      {
        "question_id": 517,
        "type": "multiple",
        "stem": "以下哪些属于本制度定义的三级动火作业范畴？",
        "options": [
          { "key": "A", "text": "车间固定动火区的检修焊接" },
          { "key": "B", "text": "登高作业" },
          { "key": "C", "text": "临时用电接驳" },
          { "key": "D", "text": "密闭空间内焊接" }
        ],
        "score": 8
      }
    ]
  }
}
```

### 4.7 交卷 POST /api/v1/exams/records/9001/submit

请求（呈现位置选择，服务端还原后判分）：

```json
{
  "answers": [
    { "question_id": 501, "selected": [1] },
    { "question_id": 517, "selected": [0, 3] }
  ]
}
```

响应（成功，评分结果）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "exam_record_id": 9001,
    "status": "passed",
    "score": 88,
    "pass_score": 60,
    "submitted_at": "2026-09-12T16:02:44.000+08:00",
    "best_score": 88,
    "answer_summary": [
      { "question_id": 501, "is_correct": true, "gained_score": 3 },
      { "question_id": 517, "is_correct": true, "gained_score": 8 }
    ]
  }
}
```

### 4.7.1 Exam Contract v1：Attempt、Submit与Result（字符串ID）

以下是信封`data`的DTO；完整受限Tiptap结构见03册§4.0。start与GET record使用同一模型，终态不返回题目：

```ts
interface AttemptQuestionV2 {
  item_id: string
  type: 'single' | 'multiple' | 'judgment'
  score: number
  stem: ReadonlyTiptapDoc
  options: Array<{ id: string; content: ReadonlyTiptapDoc }>
}
type AttemptRecordViewV2 = {
  record_id: string
  paper_id: string
  release_id: string | null
  deadline_at: string
  server_now: string
} & (
  | { status: 'in_progress'; questions: AttemptQuestionV2[] }
  | { status: 'submitted' | 'passed' | 'failed' | 'timeout'; questions: [] }
)
interface SubmitAttemptRequest {
  record_id: string
  answers: Array<{ item_id: string; option_ids: string[] }>
}
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
```

`POST /api/v1/me/exam-records/9001/submit`示例（示意整份题单共两题）：

```json
{"record_id":"9001","answers":[{"item_id":"9101","option_ids":["A"]},{"item_id":"9104","option_ids":[]}]}
```

新纯timeout的结果data固定如下；主动manual/finalized与历史已评分timeout结果可返回已知冻结答案/解析：

```json
{"record_id":"9001","status":"timeout","grading_state":"not_submitted","submission_method":null,"legacy":false,"submitted_at":null,"graded_at":null,"score":0,"passed":false,"correct_rate":null,"items":[]}
```

`ExamHistoryItemV2`含record_id/paper_id/paper_title/attempt_no/status/grading_state/submission_method/legacy/source/difficulty/score/started_at/submitted_at/graded_at；后两时间可空，score为number或null。`WrongItemV2`扩展FinalResultItemV2，另含record_id、非空submitted_at和legacy。两列表都返回`Page.items`。

### 4.8 单项制度统计概览 GET /api/v1/statistics/regulations/12/overview

响应（成功）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "regulation_id": 12,
    "title": "安全生产管理制度",
    "required_minutes": 30,
    "assigned_count": 520,
    "learning": {
      "valid_count": 438,
      "completion_rate": 0.842
    },
    "exam": {
      "participant_count": 402,
      "participation_rate": 0.773,
      "passed_count": 371,
      "pass_rate": 0.923,
      "average_score": 81.6,
      "score_distribution": {
        "[0,60)": 31,
        "[60,70)": 48,
        "[70,80)": 96,
        "[80,90)": 140,
        "[90,100]": 87
      }
    },
    "uncompleted_count": 82
  }
}
```

---

## 5. 统一错误码表

### 5.1 分段规则

| 分段 | 含义 | HTTP 状态码 |
|---|---|---|
| 0 | 成功 | 200 / 201 |
| 40xxx | 客户端错误 | 400 / 401 / 403 / 404 / 409 / 416 / 422 / 429 |
| 50xxx | 服务端错误 | 500 / 502 / 503 |

业务码前 3 位与 HTTP 状态码保持段内一致（如 409xx → HTTP 409、401xx → HTTP 401），例外（如 40105 映射 403）在明细表逐条标注。

### 5.2 错误码明细

| code | HTTP | message（示例） | 触发场景 |
|---|---|---|---|
| 40001 | 400 | 参数错误 | 请求体/查询参数校验失败；未知字段、非法字符串 ID、旧固定客户端 source question_id 不属于本次题单或题型/下标非法 |
| 40101 | 401 | 未认证或令牌无效 | 缺失 Bearer 令牌 / 验签失败 |
| 40102 | 401 | 令牌已过期 | access token 过期（客户端应刷新） |
| 40103 | 401 | 刷新令牌无效 | refresh 缺失/过期/类型不符 |
| 40104 | 401 | 用户名或密码错误 | 登录凭据校验失败（用户不存在与密码错误同一提示） |
| 40105 | 403 | 账号已停用 | 登录时 status=0；或敏感操作前回查 status≠1 |
| 40106 | 429 | 账号临时锁定，请 N 秒后重试 | username 连续失败 5 次锁定 10 分钟（message 含剩余秒数，07 册 2.2.2） |
| 40107 | 401 | 令牌已被吊销 | token.iat 早于 auth:block:{user_id} 封禁时刻（改密/重置密码/停用后旧令牌，07 册 2.1.4） |
| 40301 | 403 | 无权限访问该资源 | 角色不匹配（如 employee 调管理接口） |
| 40302 | 403 | 无权访问该数据 | 数据范围越界（如读取他人学习记录、考试记录或不属于授权 owner 的题目媒体） |
| 40401 | 404 | 资源不存在 | 路径资源（制度/试卷/记录等）不存在 |
| 40402 | 404 | 制度内容不可见 | 阅读内容不可见；training 卷调用旧 `/exams` 开考/记录执行入口也返回此码 |
| 40901 | 409 | 未完成有效学习，暂无考试资格 | legacy 制度固定卷学习资格失败，附时间缺口/底部覆盖差距；培训卷开启考前要求且有效视频分钟不足时返回 LEARNING_REQUIRED 及实际/要求/缺口，默认关闭时不检查 |
| 40902 | 409 | 补考次数已用尽 | 开考校验④失败（attempt_no > max_attempts） |
| 40903 | 409 | 已通过该考试，无需再次作答 | 开考校验④：前次终态 = passed |
| 40904 | 409 | 已有进行中的考试 | active 尚有效时幂等恢复；active 已过 deadline 时提示等待 timeout sweeper，不能绕过计次创建新记录 |
| 40905 | 409 | 交卷失败：考试已结束 | 草稿版本/payload 冲突、deadline 后新写入、在考读取结果等状态冲突；终态 submit 本身直接返回首次结果 |
| 40906 | 409 | 学习会话冲突 | 心跳/暂停到达时会话已被新会话取代或已收口（单活跃约束；已收口语义为「会话已结束，请重新开始学习」，前端应刷新 session_id） |
| 40907 | 409 | 题目组成不可变更 | 修改已发布试卷的 paper_question |
| 40908 | 409 | 题目正在考试中使用，禁止编辑 | 题目被 in_progress 考试记录引用时修改 stem/options/answer/type（仅允许 analysis，05 册 4.4.6） |
| 40909 | 409 | AI 服务未配置或配置不完整 | 未配置 base_url/api_key/model 即发起出题或连通性测试（FR-AIQ-01 验收③） |
| 40910 | 409 | 培训类别不存在或已停用 | 学员/课程/题库/试卷写入引用不存在或已停用类别；删除仍被业务事实引用的类别 |
| 40911 | 409 | 导入批次已确认，不能更换行集合 | 批次确认重试更换合法行集合，或确认事务正在处理 |
| 40912 | 409 | 至少保留一名启用的超级管理员 | 尝试删除/停用/清空最高管理员保护权限 |
| 40913 | 409 | 媒体仍被业务引用，不能删除 | `media_reference` 存在时删除媒体资源 |
| 40920 | 409 | 系统配置仍被引用，不能删除 | 菜单存在子项/对应权限被角色引用，或固定业务字典尝试修改/删除 |
| 40930 | 409 | 课程状态冲突 | 必学视频未就绪、已上架课程直接修改章节/课时结构，或视频资源缺少有效服务端时长 |
| 40940 | 409 | 题目版本或启停状态已变化／当前版本损坏 | 修订的expected_version_id或expected_enabled与同一锁内identity不一致，或启停版本令牌不匹配；删除双基线冲突同码，零新revision、不隐式恢复，客户端保留输入并刷新 |
| 40950 | 409 | 视频学习会话已结束或被替换 | 心跳指向已关闭、已被阅读/视频新会话取代或不属于当前活动所有者的会话 |
| 40951 | 409 | 课程或视频版本当前不可学习 | 课程下架、课时当前版本替换，或会话后续范围检查失败；服务端先关闭活动视频所有权再返回 |
| 40960 | 409 | 当前账号已完成实名认证 | POST 核验会话遇既有实名事实；data 固定含 status=verified、reason_code=null、clear_materials=[]，随后 GET 权威实名视图 |
| 40970 | 409 | 试卷发布状态已变化 | 非 draft 修改/发布，或锁内类别/模式与预读不一致 |
| 40971 | 409 | 候选题池容量不足 | 新随机卷初级或高级任一题型的不重复 question_id 数小于 required；data.deficits 返回 type/required/available。既有 release 的冻结抽样规则只读保留 |
| 40972 | 409 | 试卷规则不合法 | 发布题目分值合计与设定总分不符／零分／及格线越界、固定题存在重复question_id／停用题／非精确当前版本/越类别或制度筛选，或随机题型规则非法 |
| 42201 | 422 | 文件格式不支持 | 上传非 pdf/docx（含魔法数不符） |
| 41601 | 416 | 请求的媒体范围无效 | `Range` 语法非法、多段范围或起止超出文件边界 |
| 42202 | 422 | 文件超过大小上限 | 题库资料超过 50MB，或媒体图片/视频超过当前配置限制；Multer 拦截与业务层统一此码 |
| 42203 | 422 | 发布校验未通过 | 试卷发布题目合计不等于设定总分（旧制度卷仍为100），或题目/来源/类别不满足发布规则 |
| 42901 | 429 | 请求过于频繁 | 普通心跳超过 30 秒节拍窗口的异常高频（限流丢弃不影响时长正确性——credited 封顶 45 秒；pause/resume 不适用节拍丢弃，另见 6.2） |
| 50001 | 500 | 服务器内部错误 | 未分类异常（附 trace_id 供日志追踪） |
| 50002 | 502 | AI 服务调用失败 | 大模型超时/重试后仍失败（任务置 failed，可重新发起） |
| 50003 | 500 | 文件解析失败 | 解析流水线异常（parse_status = failed，可重试） |
| 50004 | 503 | 服务暂不可用 | MySQL/Redis 故障、媒体探测工具缺失/不可执行、媒体物理删除失败等待重试、菜单稳定互斥行缺失，或审计存储真实读取失败；响应不暴露本地路径 |
| 50005 | 502 | AI 连通性测试失败 | POST /ai/config/test 以已保存配置发起测试未通过（message 为脱敏错误摘要） |

---

## 6. 安全与限流约定

### 6.1 接口级权限汇总

| 模块 | 公开 | 员工（本人范围） | 制度管理 | 管理 |
|---|---|---|---|---|
| /auth | login、refresh | profile、password、logout | 同左 | 同左 |
| /mobile/auth | sms/send、sms/login；refresh/logout 由独立 mobile Cookie 驱动；debug-login 仅显式开启的 test/development | 登录/刷新后仅允许启用、无有效管理权限的 employee | 不签发 mobile 会话 | 不签发 mobile 会话 |
| /admin/training-categories | — | — | — | A2 候选实现全部 6 个；A3 映射 training_categories:read/write |
| /admin/students | — | — | — | 现行 10 个接口；A3 映射 students:read/write；学员密码接口已移除 |
| /admin/question-materials | — | — | `ai:read/write` | 资料创建、上传、状态与重试；不绑定类别 |
| /admin/questions | — | — | questions:write | B4 模板、预检、状态和确认均使用同一写权限；owner/kind 由服务端收口 |
| /me | — | GET/PATCH 本人资料；GET `/me/home` 按本人身份返回公开配置与可见课程 | — | 同左 |
| /me/courses | — | 全部已发布课程分页/详情；source/category/实名不限制浏览，视频播放另须mobile本人实名及published/current引用 | — | 保留既有课程浏览；不由此取得learner视频短票 |
| /me/video-sessions、/me/video-records、/me/courses/{id}/progress | — | 仅当前mobile employee本人；历史/进度可只读，start及后续播放按3.10校验 | — | 不接受PC password会话或管理角色旁路 |
| /me/exams、/me/exam-records、/me/wrong-questions | — | 仅当前mobile employee本人；开考/恢复进行中题面/主动交卷须实名，列表及终态读取不额外要求实名 | — | 不接受PC会话；管理端另用exam_records:read |
| /media | — | 本人头像上传/所有权范围读取 | 非头像上传需 `media:write` | 同左 |
| /admin 权限/会话 | — | — | 按 `roles/administrators/sessions:*` | 按各接口注册权限 |
| /admin 系统配置 | — | — | `system_settings:read/write` | 同左；导航树为登录用户自身权限视图 |
| /admin/exam-records/* | — | — | `exam_records:read` | 列表、详情和结果均只读；无阅卷或监控权限 |
| /site-config | 配置两键与当前品牌内容 | 同左 | 同左 | 同左；不提供任意 media id 公开读取 |
| /regulations/{id}/content、/regulations/{id}/content/file | — | 旧范围内本人只读 | 仅共享兼容读取 | 无管理写接口 |
| /admin/courses | — | — | 由业务角色显式授予 courses:read/write/publish | super_admin 天然拥有；类别 options 只需 courses:write |
| /admin/papers | — | — | `papers:read/write/publish/export`；答案版需额外导出或题库读权限 | super_admin 天然拥有；学员来源不参与管理权限判定 |
| /ai | — | — | 按细权限开放 | 使用 `ai:*`、`ai_config:*`、`questions:*`、`papers:*`；三类客观题与资料来源按接口收口 |
| /learning | — | 全部 7 个 | — | — |
| /exams | — | 全部 7 个 | — | — |
| /statistics | — | — | 全部 6 个 | 同左 |

说明：`super_admin`天然拥有 `regulation_admin`全部能力；旧制度学习/固定卷继续按原发布范围兼容（05册2.4.2）。Task 12移动视频接口及learner短票另要求当前mobile employee与独立播放资格，不以管理权限取得旁路；PC `courses:read`受控视频预览仍保留。

### 6.2 限流与幂等约定

| 接口 | 限流/约束 | 机制 |
|---|---|---|
| POST /auth/captcha | source_ip 每分钟最多 10 次；答案 120 秒 TTL 且一次消费；刷新只消费 `previous_captcha_id` | Redis 短期键；生产响应不返回答案 |
| POST /auth/login | username 维度：连续失败 5 次锁定 10 分钟（40106，message 含剩余秒数）；source_ip 维度：10 次/分钟 | 双计数防爆破（07 册 2.2.2）；Redis 故障时降级为仅 IP 维度进程内计数 + 登录接口 sys_user.status 校验兜底 |
| POST /mobile/auth/sms/send | 默认同手机号 60 秒重发间隔；手机号/IP 在 86400 秒计数窗口最多 10/100 次 | HMAC 手机号/IP 键与原子计数；新发码替换旧挑战，不保存验证码或完整手机号 |
| POST /mobile/auth/sms/login | 默认挑战 300 秒有效、最多 5 次尝试；成功后一次消费 | challenge 与手机号 HMAC 绑定，供应商验码通过后原子消费；过期/错误 40001，频率或次数限制 42901，供应商不可用 50004 |
| POST /learning/heartbeat | 节拍窗口限流：30 秒周期内异常高频丢弃（42901） | 丢弃不影响时长正确性（服务端时钟差结算、credited 封顶 45 秒，天然幂等） |
| POST /learning/heartbeat/pause、resume | 同一 session_id 每分钟最多 60 次；重复 pause / 重复 resume 幂等（第二次直接返回当前状态，不重复结算） | 事件驱动端点不适用 30 秒节拍窗口——丢弃 pause/resume 会破坏失焦语义（resume 被丢弃 → 下拍 diff 含整段失焦时间、pause 被丢弃 → 失焦期间照常计费，虚增最多 45 秒/次，故单独限流） |
| POST /me/video-sessions/{id}/heartbeat | 客户端默认 30 秒；序号必须递增，单次最多确认 45 秒 | DB session→record 行锁；重放/乱序返回当前进度，暂停/缓冲/后台零累计，跳播不写覆盖 |
| POST /exams/records/{id}/heartbeat | 30 秒节拍窗口限流 | 作答暂存幂等（覆盖写） |
| POST /exams/records/{id}/submit | 幂等：重复交卷返回首次结果 | 三层幂等（05 册 6.4.5） |
| POST /me/exam-records/{id}/submit | 严格整卷；同record终态幂等 | 锁后accepted_at严格早于deadline才受理；manual/finalized评分与写答案同事务，纯timeout不评分；终态重复返回首次结果 |
| POST /admin/question-materials/{id}/versions | 并发上传同一资料串行化（版本号唯一） | 事务 + uk_regulation_version；响应版本 `id` 为字符串 |
| POST /admin/courses/{id}/publish | 上架与下架后重上架均重新校验类别和必学视频；发布中间态不对学员可见 | 课程行悲观锁 + 同事务 readiness 校验 |
| POST /admin/courses/{id}/lessons/{lessonId}/versions | 同一课时版本号顺序追加，旧行不修改 | 课程/课时行悲观锁 + uk_lesson_version_number |
| DELETE /admin/courses/{id}/lessons/{lessonId} | 仅未上架课程；课时须属于路径课程；仅标记 deleted_at，保留历史事实 | 同事务先锁课程再锁课时，与发布/换版共用锁序 |
| POST /admin/questions/ai-import-tasks | 5MB、50参考行；任务状态与批次owner隔离 | 参考正文仅任务内存；生成后选行确认前零题库写，原批次幂等对账 |
| POST /admin/papers/{id}/publish | 重复发布已 published 卷返回现有 release_id；并发发布只生成一个版次 | 先锁培训类别、再写锁 exam_paper；uk_paper_release_version 兜底 |
| POST /admin/papers/{id}/withdraw/archive | 已退场，404 | 不再注册状态写入路由；历史快照保留 |

### 6.3 传输与敏感信息

- 生产环境经 nginx TLS 终止提供 HTTPS（07 册 4.1）；密码仅在登录/改密报文中出现，存储一律 bcrypt。
- 响应体永不返回 `password_hash`或明文 `api_key`。在考 payload 及普通预览不返回标准 `answer/analysis`；答案版是单独授权的管理接口，不与学员下发契约共用。只有已评分冻结结果（含历史已评分timeout）可向本人下发答案/解析；新纯timeout与历史submitted均无逐题结果。
- `trace_id`：50001 错误响应 `data.trace_id` 供日志排查。
- 题库管理预览可读取答案与解析，但富文本图片只存 media id 并经 Bearer 申请受控预览短票 URL，不暴露私有路径或外链。新培训在考 payload 不返回标准答案或解析；终态题图按 3.7.1 分阶段授权。不存在答题图片资源。

---

## COS 媒体协议增量（033，实施状态另见验收记录）

所有业务端点保留 `/api/v1` 和 `{code,message,data}`，上传成功只返回资源ID，业务保存再事务绑定引用。

| 方法/路径 | 授权与返回 |
|---|---|
| POST /media/upload-sessions | 当前上传权限；幂等client_request_id、用途/拥有者和文件指纹；返回持久会话 |
| GET /media/upload-sessions/:id | 原操作者与当前权限；可信COS分块列表或原完成回执 |
| POST /media/upload-sessions/:id/credentials | 精确临时键和必要动作，短时授权，不返回长期密钥 |
| POST /media/upload-sessions/:id/complete | 服务端核对/合并；进入finalizing，ready由后台实际探测后发布 |
| DELETE /media/upload-sessions/:id | 原子取消；finalizing只回当前状态，不能边发布边删除 |
| POST /media/:assetId/preview-ticket | PC Bearer管理预览，不能作为learner票据 |
| POST /media/tickets/batch | mobile，最多50项，按每个精确owner引用授权；保留重复项位置 |

`GET /media/limits` 保留原限额，增加 upload_mode、multipart_threshold_bytes、part_size_bytes、parallel_limit、upload_session_ttl_seconds；local模式继续proxy。会话状态 uploading/finalizing/completed/failed/aborted/expired，完成回执默认30天，之后保留请求墓碑。

local/实名内容保留 `/media/tickets/:ticket/content`（learner）及 `/media/preview-tickets/:ticket/content`（PC代理）。COS普通ready资源在申请/续签时复核当前权限后返回标准桶域名的准确GET签名URL，返回真实 `expires_at`；默认300秒、可配置上限3600秒，旧URL到期前仍有效。品牌入口 `/site-config/assets/:id/content` 当前白名单检查后307到短链，跳转no-store。URL不含业务JWT/SecretKey，身份和staging不签普通链接。在考不发解析图，纯timeout不发题图；客户端续签不重建学习session。

## 附：与基准文档的一致性对照

| 校验项 | 结果 |
|---|---|
| 当前路由前缀与 README 3.4 模块映射 | 一致；现行新增 `/admin/question-materials`、`/admin/questions`、`/admin/papers`、`/me/exams*` 与 `/admin/exam-records`，旧学习/考试/统计只读兼容 |
| 当前表名/字段名（snake_case）与 03 册 | 一致：40 张业务表 + 1 张迁移元数据表（共 41 张物理表）、三类客观题、客观答案列和无监控采集字段；Gate G 实名/票据自动化与独立代码审查已通过 |
| 枚举值与 README 3.4 | 一致（角色、各 status 枚举逐字对齐） |
| 心跳/失焦/乱序/草稿/超时行为与05册 | 新/me无考试draft/heartbeat，仅本地草稿/主动整卷；到期纯timeout；旧/exams心跳只为legacy协议兼容，不采集监考数据 |
| 统计口径与 05 册 7.4.1 | 一致（七项指标逐字对齐） |
| 错误码分段与 README（40xxx/50xxx） | 一致 |
