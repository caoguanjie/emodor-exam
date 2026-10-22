# 04 · API 设计 —— 制度学习及考试系统（EmodorRuleExam）

> **一句话定位**：本文档定义 EmodorRuleExam 的 `/api/v1` 全量 REST 接口契约——统一响应结构、八大模块路由、接口清单与参数、核心接口 JSON 示例、统一错误码表与限流幂等约定，是前后端并行开发的对接契约。
>
> **口径基准**：本文档所有表名、字段名、枚举值、角色值、模块名与 [README.md](README.md) 逐字一致；接口行为与 [05-模块设计.md](05-模块设计.md) 的模块内部设计逐条对应（章节引用形如「05 册 5.4.3 节」）。

> **状态边界（2026-10-22）**：现行接口只支持 single/multiple/judgment、持久草稿、主动/超时统一终结、自动评分、本人历史/错题和管理端考试记录。图片答案、人工阅卷、实时监控、切屏上报，以及 `/users`、`/departments`、制度管理写接口已删除。题库资料使用 `/admin/question-materials`，外部 AI 生成参数为 `material_id + material_version_id`；底层来源字段仍为 `regulation_id/regulation_version_id`。旧 `/learning`、旧 `/exams`、旧 `/statistics` 与制度内容/文件只读路由继续兼容。

> **试题入口增量（2026-10-22）**：PC 考试管理依次为试题管理、试卷管理、试题导入、考试记录。`/admin/questions` 保留列表、人工录题、修改、审核、预览及单题重新生成；`/admin/questions/import` 独立承载文件导入与 AI 生成两个 Tab。资料管理和整批资料 AI 生成接口继续兼容，但列表页不再提供这些入口。AI 参考题导入见 §3.5.3，是 `source=ai` 不绑定永久制度版本的明确例外。

---

## 1. API 总体规范

### 1.1 基础约定

| 项 | 约定 |
|---|---|
| 基础 URL | `/api/v1`（由 nginx 反向代理至 NestJS 应用） |
| 协议风格 | REST：资源名词复数、动作用 HTTP 方法表达（GET 查询 / POST 创建与动作 / PUT 修改 / DELETE 删除）。多数 legacy PUT 为字段修改；C3 `PUT .../draft` 明确定义为带 revision 的全量替换。非幂等动作（retry、archive 等）一律使用 POST |
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
| access token | 2 小时（`JWT_EXPIRES_IN` 可配） | sub（sys_user.id）、username、role、type=access、jti、iat、exp | 每次业务请求的 Bearer 凭据 |
| refresh token | 7 天 | sub、type=refresh、jti、iat、exp | 调用 `POST /auth/refresh` 换新 access，同时轮换新 refresh |

- 刷新策略：access 过期前以 refresh 换发，旧 refresh 到期自然失效。
- 登出走 **Redis 黑名单吊销**（07 册 2.1.4 定稿）：`POST /auth/logout` 将 access token 的 `jti` 写入 `auth:blacklist:{jti}`（TTL = access 剩余有效期，到期自动清理）并记录审计日志，客户端同时清除双令牌；认证守卫命中黑名单即拒绝。
- 改密 / 重置密码 / 停用账号写用户级封禁键 `auth:block:{user_id}`，值为封禁时刻时间戳（秒级），TTL = refresh 剩余有效期；认证守卫（含 refresh 换发路径）判定 `token.iat < block_ts` 即拒绝（40107），封禁时刻之后新签发的令牌天然放行（05 册 2.4.1 取舍说明）。
- 敏感操作（开考、交卷、管理端写操作）执行前实时回查 `sys_user.status = 1`，停用账号的存量令牌即时失效（Redis 故障降级路径，07 册 2.1.4）。

### 1.4 接口守卫链

全部业务接口统一经过三级守卫（05 册 2.4.2 节）：① JwtAuthGuard 验签 → ② RolesGuard 角色匹配（`super_admin` 天然拥有 `regulation_admin` 全部能力）→ ③ Service 层数据范围收口（employee 强制 `user_id = 本人`；员工读制度内容须叠加发布范围校验）。

本文档各接口的「权限」列标注：`公开`（无需令牌）、`登录`（任一已认证角色）、`管理`（super_admin）、`制度管理`（super_admin / regulation_admin）、`员工`（任一角色，数据范围自动收口为本人）。

### 1.5 幂等与防重设计

| 关键动作 | 幂等机制 |
|---|---|
| C2 开考 `POST /me/exams/{id}/start` 与旧固定入口 | `sys_user → exam_assignment → exam_record → 新开时 exam_paper` 数据库锁及唯一键裁决；Redis start 锁不参与正确性。有效 active 返回同一记录，过期 active 返回 40904 等待事务外 sweeper |
| 交卷 `POST /exams/records/{id}/submit` | 三层幂等（05 册 6.4.5）：状态前置校验 + Redis 提交锁 + 事务内终态判定；重复调用返回首次评分结果 |
| C3 草稿 `PUT /me/exam-records/{id}/draft` | 只接受 `current+1`；当前 revision+同一规范化 payload 返回原 ACK（含截止后重放），当前 revision 异 payload或其他版本返回 40905 |
| C3 交卷 `POST /me/exam-records/{id}/submit` | `sys_user → exam_record` 行锁；可选最后一版草稿与 finalizer 同事务，超时忽略新 body；主动/定时并发后到者返回首次 `FinalResult`，不重复缓存失效与审计 |
| 会话开始 `POST /learning/sessions/start` | 单活跃会话约束（后开者胜）：同 user + regulation 已有活跃会话时，旧会话被结束落库并返回新会话（05 册 5.4.1） |
| 学习心跳 | 天然幂等：以服务端时钟差结算，重复/乱序心跳不虚增时长（45 秒封顶，05 册 5.4.2） |
| 视频会话开始 `POST /me/video-sessions` | 短事务持 `sys_user` 行锁做范围/活动重查；旧 reading 在释放事务连接后按原算法收口并最多重试 3 次，最终事务关闭旧 video 后再取新锚点；`active_user_id` 可空唯一索引兜底 |
| 视频心跳 | `seq` 严格递增；重复/乱序返回当前进度，服务端时钟 + 45 秒封顶 + 2 秒位置容差决定可确认区间 |

### 1.6 当前 API 与融合计划的边界

| API 范围 | 文档状态 | 规则 |
|---|---|---|
| `/auth`、`/learning`、旧 `/exams`、旧 `/statistics`、`/regulations/{id}/content` 与 `/regulations/{id}/content/file` | 共享兼容契约 | 旧制度阅读资格、旧固定卷自动评分与原统计保持；不恢复制度管理写接口，下发不含答案/解析，refresh 走 HttpOnly Cookie |
| `/admin/training-categories`、`/admin/students`、`/admin/administrators`、`/admin/question-materials`、`/admin/questions`、课程/视频、`/admin/papers` | 当前管理契约 | 字符串 ID 与 `Page.items`；新资料不绑定类别；题目内部保存实际来源；三类客观题版本和发布快照不可变 |
| 个人题单、持久答案、统一终结与结果 | 当前考试契约 | `/me/exams*` 使用字符串 ID、本人所有权与不可变快照；在考不下发 answer/analysis；草稿只含 `item_id + selected`，交卷后自动 finalized |
| 考试记录 | 当前只读管理契约 | `/admin/exam-records`、`/{id}`、`/{id}/result` 均要求 `exam_records:read`；不返回监控、设备、切屏或人工评分字段 |
| 培训统计与权限首页 | 当前增量契约（C6） | `/statistics/training/*` 与 `/admin/dashboard`；实时读取冻结考试事实和 B2 当前版本，不改变旧 `/statistics` |
| 旧固定卷 vs 新培训考试开考 | 两条口径并存 | 旧固定卷继续检查 `learning_record.is_valid`；新培训考试默认关闭学习门槛，但仍检查发布、类别/来源、权限、次数、身份状态和服务端 deadline |

目标考试链路固定遵循：发布/候选版本快照 → 个人题单快照 → 确认草稿持久化 → 主动或超时幂等终结 → 三类客观题自动判分 → 最终结果只读。旧 `/exams` 只为制度固定客户端保留兼容形状，training 记录不能借该入口提交。

---

## 2. 模块与路由总览

全部路由使用同一 `/api/v1` 前缀。下表按现行入口与共享兼容入口分列；精确方法以第 3 章和 controller 为准，不再以总接口数作为验收目标：

| 路由前缀 | 所属模块 | 状态 | 说明 |
|---|---|---|---|
| /auth | 身份与权限 | 现行 | 验证码、登录、刷新、个人信息、改密、登出 |
| /admin/training-categories | 学习管理 | 现行 | 培训类别分页、详情、增改、启停、引用保护删除 |
| /admin/students | 学习管理 | 现行 | 无部门学员增改查、头像、启停、重置密码、xlsx 模板/预检/确认；不提供删除 |
| /admin/administrators、/admin/roles 等 | 系统设置 | 现行 | 管理员创建必须提交非空 `role_ids`；另含权限、会话与公共配置治理 |
| /admin/question-materials | 题库资料 | 现行 | 资料创建、列表/详情、版本上传、解析状态和重试；版本 `id` 为字符串 |
| /admin/questions | 题库导入 | 现行 | 9 列 Excel/TXT 模板、预检、批次状态与幂等确认 |
| /ai | AI 与题库 | 现行 | AI 配置/任务、类别与考点选项、三类客观题版本审核、人工录入 |
| /admin/papers | 试卷发布 | 现行 | 固定/随机卷配置、来源选项、候选、预览、发布、复制、撤回、归档 |
| /me | 本人/考试 | 现行 | 本人资料/首页、考试列表、开考、恢复、草稿、心跳、交卷、结果、历史、错题 |
| /media | 受控媒体 | 现行 | 头像、课程、视频、题目和品牌媒体；无答题图片 purpose |
| /admin/courses、/me/courses | 课程 | 现行 | 课程/章节/视频版本与本人同类别课程 |
| /me/video-sessions、/me/video-records | 视频学习 | 现行 | 服务端计时、递增序号心跳、主动关闭与历史 |
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
| 2 | POST | /auth/login | 公开 | 员工兼容 username/password；管理员额外提交 captcha_id/captcha_code，签发带 sid 的双令牌 |
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

`/admin/students` 以 `students:read`（GET）和 `students:write`（POST/PUT/批次确认/启停/重置）为权限边界。新学员固定 role=`employee`，`category_id` 与 `source` 必填；`source` 只影响后续抽题策略，不等于权限。旧 `/users` 管理路由已删除，既有用户的未知来源/类别和历史部门值不回填。

A3 学员管理边界：列表、详情、资料更新、启停和重置密码仅作用于 `sys_user.role=employee` 且不存在任何 `sys_user_role` 记录的账号。只要存在业务角色链接，即使角色无权限或已停用，也按管理员账号从上述学员接口范围排除；详情与上述写操作统一返回 40401，避免泄露受保护账号。更新、启停、重置在同一事务内先以用户行悲观锁完成最终分类检查，再执行原有保存、认证世代递增和会话吊销；角色赋值仍按角色行后用户行加锁，保证赋值与学员 mutation 串行。本人资料接口不受该管理边界改变。

| # | 方法 | 路径 | 请求与约束 | 成功 data |
|---|---|---|---|---|
| 1 | GET | /admin/students | query：`page`、`page_size`、`keyword`、`category_id`、`source`（institution/external）、`status`（0/1） | `Page<Student>`；ID 均为字符串 |
| 2 | GET | /admin/students/{id} | — | `Student`，不含 password_hash |
| 3 | POST | /admin/students | body：`username`、`password`、`real_name`、`category_id`、`source` 必填；可选 `employee_no/phone/email`；不接受部门字段 | `Student`，role 固定 employee，`department_id=NULL` |
| 4 | PUT | /admin/students/{id} | body：`real_name/employee_no/category_id/source/phone/email` 可选；不接受 department/username/password/role | `Student` |
| 5 | PUT | /admin/students/{id}/status | body：`status`（0/1） | `Student`；停用同时吊销既有令牌 |
| 6 | PUT | /admin/students/{id}/avatar | body：`avatar_id`（ready 的 avatar 图片资源 ID）或 null | `Student`；同一用户行锁事务内重查 managed-student 边界并更新引用 |
| 7 | PUT | /admin/students/{id}/password | body：`password`（≥8 位，含字母与数字） | `null`；旧令牌吊销并回到首登改密 |
| 8 | GET | /admin/students/import-template | — | `.xlsx` 二进制；表头为 `用户名/姓名/工号/手机号/邮箱/来源/培训类别ID/初始密码` |
| 9 | POST | /admin/students/import-preview | JSON `rows` 数组，或 multipart `file`；可选 `defaults:{source?,category_id?}` | `ImportPreview` |
| 10 | GET | /admin/students/import-batches/{id} | —；仅批次 owner 可读 | 未提交批次为 `ImportPreview`，已提交批次为 `ImportResult` |
| 11 | POST | /admin/students/import-batches/{id}/commit | body：`row_numbers` 为非空整数数组；仅批次 owner | `ImportResult` |

`Student` 字段为 `{ id, username, real_name, employee_no, category_id, source, role, phone, email, avatar_id, status, last_login_at, created_at }`，其中 `avatar_id` 可为 null。新建和导入不接受部门字段并写入 `department_id=NULL`；更新既有学员同样不接受部门字段，但保留数据库中的历史 `department_id`。列表默认 page=1/page_size=20，page_size 范围 1—100；未知 query/body 字段、非整数分页、非法枚举均返回 40001。本人资料接口见 3.2.3，不允许通过学员接口修改 role。

导入预检逐行返回 `ImportPreview = { batch_id, valid_rows, errors:[{row,message}], duplicates }`；模板行号从 2 开始。预检会按数据库 `utf8mb4_0900_ai_ci` 规则识别大小写/重音重复，并检查现存 username/employee_no、启用类别、来源和口令策略。确认只消费服务端规范化行，批次按 owner+id 隔离；首次确认固定合法行集合，同集合重试返回原 `created_ids`，更换集合返回 40911。确认事务按类别 ID 加锁并重新检查类别存在且启用；类别在预检后被停用或删除时返回 40910，不创建悬挂学员。任何响应、错误明细和审计记录不得包含导入明文口令或 `password_hash`；`import_batch.normalized_rows` 只保存不可逆的 `password_hash`，不保存明文口令。

### 3.2.3 本人资料 /me/profile（A2）

| # | 方法 | 路径 | 请求 | 成功 data |
|---|---|---|---|---|
| 1 | GET | /me/profile | — | 当前用户资料（含 `category_id/source`，旧用户可为 null） |
| 2 | PATCH | /me/profile | 仅允许 `real_name?`、`phone?`、`email?`、`avatar_id?` | 更新后的资料 |

`source/category_id/role/avatarId/username/department_id` 等未知或越权字段均返回 40001，不静默丢弃；`avatar_id` 只接受已经由本人上传且 ready 的头像资源，绑定与旧资源解绑在同一事务内完成。

### 3.2.4 受控媒体 /media（A4）

| 方法 | 路径 | 权限 | 请求与响应 |
|---|---|---|---|
| GET | `/media/limits` | 登录 | 返回 `video_max_bytes`（默认 536870912，服务端/网关硬上限一致）、`image_max_bytes`（默认 10485760）、`image_max_pixels`（默认 25000000）、`probe_timeout_ms`（默认 30000）及允许类型；不返回路径/密钥 |
| POST | `/media/upload` | 登录；非头像用途需 `media:write` | multipart `file` + `purpose`（avatar/course_cover/video/question/branding），可选头像 `owner_id`；`answer` 一律返回 40001。成功 `data={asset_id,status,duration_ms}`，视频实际探测后才为 ready |
| GET | `/media/{id}` | 资源拥有者/已注册 owner authorizer | 查询 `asset_id/purpose/media_kind/mime_type/size_bytes/status/duration_ms`；公开 status 仅为 `processing/ready/failed`，内部 `deleting` 按 40401 不存在处理 |
| GET | `/media/{id}/content` | 资源拥有者/已注册 owner authorizer | 私有流，支持单一 `Range: bytes=start-end`，命中返回 206 与 `Content-Range`；无效或不可满足 Range 返回 41601/HTTP 416；文件流跳过统一信封 |
| DELETE | `/media/{id}` | 资源拥有者 | 有任何 `media_reference` 时返回 40913；无引用后先落内部 `deleting` 再删除物理文件，失败保留行供重试并返回 50004/HTTP 503，成功或文件已不存在才删数据库行 |

`question_version` owner policy 保留上传者与 `questions:read` 的既有读取。具有 `papers:read` 的非上传者只能读取真实 fixed draft、不可变 release，或当前 random draft 经既有候选规则验证后的题干/选项图片；只出现在解析中的图片还必须具备 `papers:export` 或 `questions:export`。单独 `questions:export` 不构成试卷题图读取权。候选桥接精确限定类别、可选资料、题型、难度、current approved 与考点容量，不落伪 `paper_question` 或 release。错误类别/来源/难度/状态/current version/题型、无效草稿与无关题库版本均返回 40302；release 历史按其 `snapshot_json` 判断。

管理端头像绑定 `PUT /admin/students/{id}/avatar` 只接受 `avatar_id`，在同一用户行锁事务内重复 `lockManagedStudent` 最终检查并 bind；拥有任何 `sys_user_role` 链接的员工仍不属于学员管理范围。PC 选择新头像时只把上传结果暂存在当前表单，点击“保存”后才调用既有资料更新与独立头像绑定接口；取消不绑定该上传，任一保存请求失败后以详情 GET 对账并保留重试入口，不能把上传成功误当成资料已保存。

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
| GET | /admin/administrators/candidates | administrators:write | 分页搜索可配置账号；仅返回 `id/username/real_name/status/system_role`，排除超级管理员 |
| GET | /admin/administrators/assignable-roles | administrators:write | 仅返回启用的非系统角色 `id/code/name/status/is_system`，不返回权限矩阵 |
| PUT | /admin/administrators/{id}/roles | administrators:write | 多选业务角色；最高管理员保护 |
| GET | /admin/sessions | sessions:read | 分页查看在线/已吊销会话（返回 `created_at`、`last_seen_at`、持久化 `expires_at` 与 `status`；新会话的创建/更新时间与最后活动时间由同一服务端时刻写入） |
| POST | /admin/sessions/{id}/revoke | sessions:write | 强制下线并立即吊销该 sid 的双令牌 |

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
| 5 | POST | /ai/generate-questions | `ai:write`；按 `material_id + material_version_id`、类别、难度异步生成 single/multiple |
| 6 | GET | /ai/generate-status/{taskId} | `ai:read`；任务状态轮询 |
| 7 | GET | /ai/generation-category-options | `ai:write`；启用类别 `Page<{id,name}>` |
| 8 | GET | /ai/question-category-options | `questions:write`；人工录题类别选项 |
| 9 | GET | /ai/question-category-filters | `questions:read`；题库筛选类别选项 |
| 10 | GET | /ai/question-concepts | `questions:read`；按 category_id/type/keyword 查考点，返回 `Page<{id,category_id,type,name}>` |
| 11 | GET | /ai/question-concept-options | `questions:write`；必传 category_id/type，只返回启用类别内 `Page<{id,name}>`，不依赖 `questions:read` |
| 12 | POST | /ai/question-concepts | `questions:write`；创建同类别同题型考点 |
| 13 | GET | /ai/questions | `questions:read`；版本兼容视图分页筛选 |
| 14 | POST | /ai/questions | `questions:write`；人工录入三类客观题，首版本由录入管理员确认 approved |
| 15 | PUT | /ai/questions/{id}/review | `questions:review`；审核当前版本及驳回意见 |
| 16 | PUT | /ai/questions/{id} | `questions:write`；修订生成 pending revision；在考核心编辑仍拒绝 40908 |
| 17 | POST | /ai/questions/{id}/regenerate | `questions:write`；有真实资料/版本的 AI single/multiple 单题重生成新 revision；无永久来源的参考题 AI 不展示此入口 |
| 18 | GET | /ai/questions/{id}/history | `questions:read`；revision 历史与真实审核元数据，返回 Page |
| 19 | GET | /ai/questions/{id} | `questions:read`；题目当前兼容视图 |
| 20 | GET | /ai/papers | 试卷列表（筛选 regulation_id/status） |
| 21 | POST | /ai/papers | 创建试卷 |
| 22 | GET | /ai/papers/{id} | 试卷详情 |
| 23 | PUT | /ai/papers/{id} | 修改策略字段 |
| 24 | PUT | /ai/papers/{id}/questions | 组卷；发布后锁定 |
| 25 | POST | /ai/papers/{id}/publish | 发布试卷，校验 SUM(score)=100 |
| 26 | POST | /ai/papers/{id}/copy | `papers:write`；按冻结事实复制为新 draft，body 只接受空对象 |
| 27 | POST | /ai/papers/{id}/archive | 归档试卷 |

**试卷路由归属说明**：试卷的创建/组卷/发布属于「题目审核 → 组卷 → 发布」的出题工作流（05 册 4.4.7 组卷服务隶属 AI 出题模块），故管理侧归 `/ai/papers`；面向员工的考试执行（可考列表、开考、交卷）归 `/exams`（考试评分模块）——同一资源的管理面与执行面分离，与模块边界一致。

**POST /ai/generate-questions**：

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| material_id | body | string decimal ID | 是 | 题库资料 ID；新资料不绑定类别 |
| material_version_id | body | string decimal ID | 是 | 资料版本 ID，必须属于 material_id 且已解析 |
| category_id | body | string decimal ID | 是 | 启用培训类别；固定写入整批版本，不读取模型标签 |
| difficulty | body | string | 是 | easy / medium / hard；固定写入整批版本 |
| question_count_single | body | int | 否 | 单选题量，取值 1–40，默认 20 |
| question_count_multiple | body | int | 否 | 多选题量，取值 0–20，默认 5 |
| score_single | body | decimal | 否 | 单选每题分值，> 0，默认 3.00 |
| score_multiple | body | decimal | 否 | 多选每题分值，> 0，默认 8.00 |

校验规则：① 类别存在且启用、难度合法；② material 与 version 均为字符串 ID、归属匹配且版本 parsed，文本不足的 PDF 可走视觉输入；③ 分值合计 100.00；④ AI 配置完整（否则 40909）。服务端把资料映射得到的实际内部 `regulation_id/regulation_version_id`、请求 `category_id/difficulty` 写入每个 pending revision，拒绝模型覆盖。命题提示同样携带权威难度；文本批次、视觉批次与单题重生成复用 `type/stem/options/answer/analysis` 合同。外部 DTO 不接受 `regulation_id/regulation_version_id`。

**GET /ai/config**（`ai_config:read`）：读取 AI 服务配置，`api_key` 掩码回显（如 `sk-****xxxx`，完整键值永不返回，07 册 4.2）。**PUT /ai/config**（`ai_config:write`）：保存 `base_url` / `api_key` / `model`——权威副本为 AES-256-GCM 加密后的配置文件，Redis 仅作缓存（07 册 4.2），并返回同样的脱敏配置结果。**POST /ai/config/test**（`ai_config:write`）：以已保存配置发起一次连通性测试，返回成功 / 失败与脱敏错误摘要（失败 → 50005）。`ai:read/write` 仅代表出题任务/题库工作流，不自动授予配置权限；管理端入口要求 `ai_config:read` 或 `ai_config:write`，但 writer-only 页面不得调用 GET、不得伪造现有配置值，只能提交空白表单并使用 PUT 返回的脱敏结果；`super_admin` 天然拥有全部注册权限。

**人工题 create/edit DTO**：create 的 `category_id/difficulty/type/stem/options/answer/score` 必填，`concept_id/analysis` 可选；edit 为部分更新并必须携带 `expected_version_id`。两者都严格拒绝 `material_id`、`regulation_id`、`regulation_version_id` 和 source，防止客户端伪造 AI/资料来源。资料 AI 生成服务在校验 `material_id + material_version_id` 后把可信来源映射为内部 `regulation_id/regulation_version_id`；§3.5.3 的专用 `questions_ai` 导入确认允许 `source=ai` 且两项来源均为空，不能借人工 DTO 伪造该例外。实体字段不全局改名。single 恰一答案，multiple 至少两答案，judgment 固定正确/错误。富文本仅允许白名单标签与 `<img data-media-id="数字">`；题干、选项和解析图片经 `/media/{id}/content` 鉴权读取。

**版本与审核语义**：POST 人工题创建 revision 1 并记录录入管理员的 `approved_by/approved_at`；PUT 编辑或 regenerate 创建新的 pending revision，不覆盖旧版本。`PUT /questions/{id}`、`PUT /questions/{id}/review`、`POST /questions/{id}/regenerate` 的 body 必须显式携带 `expected_version_id`：已版本化题传用户当前看到的十进制字符串 ID，未版本化 legacy 题明确传 `null`；省略或非法值返回 40001。服务在数据库锁内比较 identity 的实际 current_version_id，长时 regenerate 在发起与提交前各校验一次；不一致返回 40940，且不得创建错误 revision 或误审新版本。`POST /ai/questions` 与 `PUT /ai/questions/{id}` 的成功响应在既有兼容 view 外额外返回十进制字符串 `saved_version_id`，它是该请求实际创建的 revision receipt；写后查询得到的 `current_version_id` 可能已被另一并发修订推进，继续编辑本地提交快照时只能把 `saved_version_id` 作为下一次 `expected_version_id`。普通 GET/list view 不返回虚假的 `saved_version_id`。列表可按 `category_id/difficulty/concept_id/type/status/regulation_id/keyword` 筛选；响应同时保留旧 `id/version_id` 兼容字段并提供字符串 `question_id/current_version_id/regulation_version_id`、revision、审核元数据。旧题首次编辑/审核才捕获 revision 1，`legacy_captured_at` 明示升级快照，未知类别/难度/历史确认人/时间均保持 null，不自动补 easy。

**分页与安全显示**：`GET /ai/question-concepts`、`GET /ai/question-concept-options`、`GET /ai/questions/{id}/history` 都返回 `{items,total,page,page_size}`，默认 1/20，page_size 范围 1—100。题目列表、详情、历史与未保存预览在进入 HTML 渲染前统一执行安全白名单；遗留恶意标签、事件、javascript URL 与外链图片只在响应/预览边界移除，不回写历史。受控图片只保留 `data-media-id`，再经鉴权 `/media/{id}/content` 读取。

**扫描 PDF 来源定位**：视觉批次把程序实际调用的 `source_page_group/source_page_start/source_page_end` 写入 revision。单题重生成只渲染该页组；PDF 只有一个页组时可确定为 group 0，多页组 legacy revision 缺少定位时返回明确参数错误，不回退第一页、不依据模型声明伪造来源。

**候选服务边界**：内部 `approvedCandidates({categoryId,regulationIds?,type,difficulty})` 只返回 current revision 且 approved 的不可变快照。资料来源选项允许同类别题目的 `category_id + regulation_id` 实际关联，或旧资料自身 category 直接匹配；新资料自身不绑定类别。发布服务冻结 versionId，候选方法本身不创建发布或个人题单。

**PUT /ai/papers/{id}/questions**：legacy 制度卷继续校验题目 approved、内部 `question.regulation_id` 与试卷一致、同卷不重复；该旧执行链仍只消费 single/multiple。training 固定卷经 `/admin/papers` 支持三类客观题，并在创建、更新、选题、发布边界校验题目类别和资料来源，不允许跨类别。

**制度卷升级发布边界**：升级后从 draft 执行 `POST /ai/papers/{id}/publish` 时，在同一事务内捕获题目的真实当前 approved revision，并把实际 `paper_question.score`、题目内容与策略写入 `paper_release*`。旧题未知 `category/difficulty/approved_by/approved_at` 分别保持 `null/unknown/null/null`，不得伪造 easy 或历史审核事实。此后 list/detail/publish 在原数字 `id` 和原字段之外仅兼容新增 `release_id:string|null`、`rules_locked:boolean`；有 release 时详情读取冻结题目、实际分值和 RuleSnapshot，策略/题单修改返回 40970。真正升级前已 published 且没有 release 的卷继续返回 `release_id=null/rules_locked=false`，保留旧动态策略语义，不补造历史快照。

**复制契约**：`POST /ai/papers/{id}/copy` 使用 `papers:write`，返回原数字 ID 形状的新 draft，且 `release_id=null/rules_locked=false`。有 release 的源卷复制冻结的题目版本、实际分值、规则及学习门槛；无 release 的旧卷复制当前事实。源 release 不变；若复制后题库 current revision 已推进，重新发布返回 40970 并提示重新选题，不静默替换版本。

#### 3.5.1 培训试卷与不可变发布 /admin/papers（C1）

本节与上述 legacy `/ai/papers` 并存，不改写其 ID 类型、分页形状或学习门槛。下表 ID 均为正十进制字符串：

| # | 方法 | 路径 | 权限与语义 |
|---|---|---|---|
| 1 | GET | /admin/papers/category-options | `papers:read`；启用类别 `Page<{id,name}>` |
| 2 | GET | /admin/papers/regulation-options | `papers:read`；必传 category_id；按该类别题目的实际 `category_id + regulation_id` 关联或旧资料自身 category 匹配返回资料来源选项 |
| 3 | GET | /admin/papers/course-options | `papers:read`；必传 category_id，课程仅作说明关联 |
| 4 | GET | /admin/papers | `papers:read`；按 keyword/category_id/mode/status 分页，返回 `Page.items` |
| 5 | POST | /admin/papers | `papers:write`；创建 training 草稿，默认 requires_learning=false |
| 6 | GET | /admin/papers/{id} | `papers:read`；配置、固定题单及 latest_release_id |
| 7 | PUT | /admin/papers/{id} | `papers:write`；只允许 draft，发布后返回 40970 |
| 8 | GET | /admin/papers/{id}/candidates | `papers:write`；当前 approved revision，可按 type/difficulty 筛选 |
| 9 | PUT | /admin/papers/{id}/questions | `papers:write`；全量替换固定题单 |
| 10 | GET | /admin/papers/{id}/preview | `papers:read`；不返回 answer/analysis |
| 11 | GET | /admin/papers/{id}/preview/answers | `papers:read` 且还需 `papers:export` / `questions:read` / `questions:export` 之一；答案版 |
| 12 | POST | /admin/papers/{id}/publish | `papers:publish`；冻结发布版本，返回 `{release_id}` |
| 13 | POST | /admin/papers/{id}/copy | `papers:write`；复制配置/固定题单为新 draft |
| 14 | POST | /admin/papers/{id}/withdraw | `papers:publish`；published → withdrawn，保留快照 |
| 15 | POST | /admin/papers/{id}/archive | `papers:publish`；published/withdrawn → archived，保留快照 |

**创建/修改 DTO**：`title/mode/category_id` 为核心字段；`regulation_ids/course_ids` 是去重字符串 ID 数组，其中 regulation_ids 表示题库资料的内部来源 ID；`requires_learning` 默认 false；分数/限时/次数/漏选比例默认 60/30/3/0.5。随机卷 `rules=[{type,count,score_cents}]` 最多三项且题型唯一，并满足 `Σ(count×score_cents)=10000`；固定题单同样合计 10000。来源选项允许“当前类别题目实际关联该 regulation”或“旧资料自身 category 直接匹配”；新资料不预绑类别，跨类别创建、更新或发布返回业务冲突。

**发布硬校验**：候选只取同培训类别、当前 approved revision、题型/难度精确匹配，制度集合可选；未选制度时无制度来源的人工/导入题可入池。课程 ID 不参与题池过滤。随机卷初级与高级两池都按 `concept_id ?? question_id` 计数，任一题型容量不足返回 40971 与 deficits；所有新发布固定卷（training 与 regulation）也按同一组键禁止重复考点，无 concept 的不同 question_id 仍各自独立。失败事务不得留下 release、published 状态或旧题版本捕获。

**预览契约**：共通字段为 `paper_id/release_id/mode/sample_kind/note/difficulty/rule/capacities/questions`。`rule` 使用 snake_case：`total_cents/pass_cents/duration_minutes/max_attempts/partial_credit_ratio/rules[].score_cents`。固定卷 `sample_kind=fixed_paper`、`capacities=[]`；随机卷 `sample_kind=random_example`，显示初/高两池各题型 `required/available` 及选定难度的一次样例，`note` 必须明示“样例不代表所有考生同卷”。已发布/撤回/归档均读不可变 release，不回读题库当前内容。

**C1/C2 边界**：C1 只负责发布；C2 新增独立 `/me/exams*` 个人题单 API。`POST /exams/papers/{id}/start` 仍不接受 `business_scope=training` 或空 regulation_id，返回 40402；旧制度固定卷经快照适配器保持数字 `question_id` 与原响应形状，资格守卫和单/多选限制不变。

### 3.5.2 题库文件导入 /admin/questions（B4，权限 `questions:write`）

| 方法 | 路径 | 输入 | 输出 |
|---|---|---|---|
| GET | `/admin/questions/import-template?format=xlsx\|txt` | 严格格式枚举 | 与实际解析器同列的二进制模板；TXT 为 UTF-8 TSV |
| POST | `/admin/questions/import-preview` | multipart `file`、`format`；可选 `category_id/difficulty` 默认值 | `ImportPreview` |
| GET | `/admin/questions/import-batches/{id}` | 仅 questions 批次 owner | 未提交返回 `ImportPreview`；已提交返回 `ImportResult` |
| POST | `/admin/questions/import-batches/{id}/commit` | `{row_numbers:number[]}`，只能选预检合法行 | `ImportResult` |

模板固定九列 `category/type/difficulty/concept/stem/options/answer/analysis/score`。TXT 仅接受制表符分列，`options/answer` 是 JSON 数组；支持 BOM/CRLF，不支持逗号等多义手工分隔。文件上限 5MB、数据行上限 1000；Excel 公式单元格不执行并落为行级错误，超出 I 列的真实非空值或公式按超列拒绝。完整填写说明见 [`docs/templates/question-import-format.md`](../templates/question-import-format.md)。

预检逐行复用三类客观题、富文本、受控媒体、类别、考点与来源校验。重复指纹覆盖类别、题型、难度、规范化内容与答案；已存在或本批较晚重复行列入 `duplicates`，默认不进入 `valid_rows`。确认事务锁定 owner+batch 并创建 `source=import` 的 approved identity/revision；同一行集合重试返回首次结果，换集合返回 40911。questions 入口访问他人或 students 批次返回 40302 且不暴露批次内容；不确定响应先 GET 原批次对账，不创建新预览。

### 3.5.3 AI 参考题导入 /admin/questions（一次性参考文件）

| 方法 | 路径 | 输入与成功结果 |
|---|---|---|
| POST | `/admin/questions/ai-import-tasks` | `ai:write`；multipart 仅 `file + format=xlsx\|txt`，返回任务状态 |
| GET | `/admin/questions/ai-import-tasks/{id}` | `ai:read`；读取本人任务状态 |
| GET | `/admin/questions/ai-import-batches/{id}` | `ai:read`；读取本人 `questions_ai` 预览批次或已确认回执 |
| PATCH | `/admin/questions/ai-import-batches/{id}/rows/{row}` | `ai:write`；修改生成行的可编辑题面并重新校验，返回完整批次 |
| POST | `/admin/questions/ai-import-batches/{id}/rows/{row}/regenerate` | `ai:write`；按该生成行可信类别、题型、考点、建议分与 easy/hard 难度重新生成，返回完整批次 |
| GET | `/admin/questions/ai-import-batches/{id}/download?format=xlsx\|txt` | `ai:read`；导出生成题的标准九列文件；二进制流，不包业务信封 |
| POST | `/admin/questions/ai-import-batches/{id}/commit` | `questions:write`；`{row_numbers:number[]}` 只接受合法生成行，返回 `ImportResult` |

输入仍严格使用九列 `category,type,difficulty,concept,stem,options,answer,analysis,score`，文件上限 5MB、参考数据最多 50 行。每道参考题最多生成一对 easy/hard；参考行的 difficulty 不作为生成结果难度。服务端从已校验参考行固定类别、题型、考点与建议分，再按目标难度覆盖模型返回值；来源、状态、审核人和制度版本不得来自模型或客户端。

任务状态固定为 `{task_id,status,total_count,completed_count,generated_count,failed_count,batch_id?,message?}`。参考文件与参考正文只存在于任务内存；完成、失败、超时后释放，禁止写入磁盘、MySQL、Redis、资料/媒体表、审计详情或日志。Redis 仅保存无参考正文的任务状态，TTL 24 小时；服务重启后仍未完成的任务读取为 failed，要求重新上传。

批次返回 `{batch_id,status,valid_rows,errors,duplicates,rows,created_ids?,committed_rows?}`，`rows` 为生成题数组，每项含 `row_number`、同名九字段及 `errors:[]`，其中 options/answer 为数组。批次只保存生成题，不保存参考行；未确认批次自 createdAt 起 24 小时有效，已确认回执不按此期限失效。有效行默认选中，异常行排除；支持全部/easy/hard 筛选、题面修改、单行重新生成与下载。

确认前 `question/question_version` 零写入。确认在批次锁事务中原子创建选中题目、revision 1 和回执，强制 `source=ai,status=pending,regulation_id=NULL,version_id=NULL`，不记录伪造的审核人/时间；人工审核后才可入卷。相同行集合重复确认返回首次结果，不同集合拒绝。全部失败不创建预览批次；部分失败只保留生成结果并报告失败数量。所有任务和批次操作必须校验 owner，批次还必须固定 `kind=questions_ai`；不得通过普通 `questions` 或 `students` 路径确认并自动审核。请求结果未知时查询原批次对账，不重发新的确认。

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

**POST /exams/records/{id}/submit**：旧 body 仍含 `answers[]`。有 assignment 的记录把 source question_id 映射为本次 item_id，合并持久确认稿并调用 C3 finalizer；终态重试先返回旧形状结果，不受重试 body 影响。旧无 assignment 记录保持原 Redis/评分路径。旧结果中的 `options/answer/selected` 均为原始选项域，010 不改既有 selected/score。

**GET /exams/records/{id}/result**：`status` / `score` / 逐题明细（stem / selected（已还原原始下标）/ is_correct / gained_score / answer / analysis）——解析仅在交卷后的成绩回看中下发。

### 3.7.1 本人培训考试 /me（权限：本人，字符串 ID）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | /me/exams | 当前类别已发布 training 卷 + 本人已有 assignment 分页列表 |
| 2 | POST | /me/exams/{id}/start | 原子首次开考、补考或有效 active 恢复 |
| 3 | GET | /me/exam-records/{id} | 本人按 record_id 恢复有效在考题单 |
| 4 | PUT | /me/exam-records/{id}/draft | 全量替换并确认一版持久草稿 |
| 5 | POST | /me/exam-records/{id}/heartbeat | 返回服务端时间、剩余秒数、截止时间与草稿 revision；body 必须为空对象 |
| 6 | POST | /me/exam-records/{id}/submit | 可选保存最后草稿并统一幂等终结 |
| 7 | GET | /me/exam-records/{id}/result | 本人读取自动结算结果与交卷后解析 |
| 8 | GET | /me/exam-records | 本人考试历史分页 |
| 9 | GET | /me/wrong-questions | 本人 finalized 非满分题分页 |

`POST /me/exams/{id}/start` 的首次新开要求账号启用、试卷 published、启用培训类别、用户 category/source 必填且类别与 release 匹配。random 卷按 `institution → easy`、`external → hard` 抽取；fixed 卷按冻结题单得出单一难度或 `mixed`。首次同事务冻结 `release_id/source/category_id/difficulty/rule_snapshot/snapshot_origin`，补考沿用 assignment，不按用户新资料或题库当前内容重算。升级前旧 `exam_record` 同样计入 `max_attempts`，默认总次数 3 次（含首次）。

恢复顺序刻意早于试卷状态和用户当前 category/source 检查：有效 active 即使试卷已撤回也返回同一 record、deadline、题序和选项序；账号停用仍拒绝。服务端 `deadline_at` 已过时返回 40904，不在持有用户锁的 start 事务内嵌套终结；30 秒 timeout sweeper 在事务外读取冻结规则/题单完成客观收口并清空 `active_assignment_id`。收口后再开按冻结最大次数裁决。

成功响应 `AttemptView` 固定含 `record_id/paper_id/release_id/source/category_id/difficulty/deadline_at/server_now/draft_revision/questions/answers`。`questions[]` 只含 `item_id/type/stem/options/score`，`item_id` 是新答题主键；在考响应任何层级都不得出现标准 `answer/analysis`。record、items、确认答案在同一 `REPEATABLE READ` 事务快照中读取。`answers[].selected` 是显示域；数据库 `exam_answer.selected` 是原始域，保存只映射一次、恢复时逆映射一次。

个人题图使用 `media_reference(owner_type=exam_record_question, owner_id=item_id)`。题干/选项图片在开考时绑定；本人或具有 `exam_records:read` 的管理员只可读取精确属于该 record/item 的资源。解析图片仅在 record 终态时由统一结果投影授权；在考本人、未授权用户及猜测 asset_id 均不可读。

`DraftInput` 为 `{revision, answers[]}`；每个答案只能是 `{item_id, selected?}`。`answers` 是完整替换集，单选/判断最多一个显示下标，多选下标去重且不越界。成功返回 `DraftAck={revision,saved_at,answered_count}`。只接受 `current+1`；同 revision、同规范化 payload 重试返回首次 ACK 且不刷新 `saved_at`。当前 revision 的不同 payload、旧/跳号 revision、截止后的新写入均返回 40905。

`POST .../heartbeat` body 必须是空对象，响应 `{server_time,remaining_seconds,deadline_at,draft_revision}`。它只校准服务端时间并在到期时触发统一终结，不采集设备、连接或切屏信息。

`POST .../submit` body 可省略，或完整复用 `DraftInput`。未过期时最后草稿与 finalizer 同事务；已过期时忽略新 body，只按此前确认稿以 timeout 终结。主动、心跳发现超时和定时 sweeper 都锁同一 record、复用同一 finalizer；终态重试只返回首次结果。

`FinalResult` 固定含 `record_id/grading_state/submission_method/legacy/submitted_at/graded_at/score/passed/correct_rate/items`。`items[]` 含安全题面、本人 `answer`、显示域 `correct_answer`、`analysis/gained_score`。三类客观题即时 finalized；`correct_rate` 按 `gained_score == 冻结满分` 计算。新结果 `submission_method=manual|timeout、legacy=false`；无历史快照的 legacy 结果不回查当前题库，保留已知分数、`items=[]/correct_rate=NULL/submission_method=NULL/graded_at=NULL/legacy=true`。

`GET /me/exam-records?page&page_size` 返回 `Page<ExamHistoryItem>`；每项包含 record/paper、次数、状态、`grading_state`、来源/难度、提交/评分时间和最终分数。`GET /me/wrong-questions` 只统计 `grading_state=finalized` 且 `gained_score < 冻结 score` 的题，包含未答和多选部分分题。新结果中的题面、本人答案与正确答案统一使用显示域；旧 `/exams` 结果继续使用原始域。

### 3.7.2 管理端考试记录（只读）

三个入口统一要求 `exam_records:read`。`ExamRecordsService` 只提供列表与详情投影；结果复用 `ExamHistoryService`，不复制评分逻辑。

| 方法 | 路径 | 权限 | 请求与成功 data |
|---|---|---|---|
| GET | `/admin/exam-records` | `exam_records:read` | query `page/page_size/keyword/paper_id/source/difficulty/status/grading_state`；返回分页记录摘要 |
| GET | `/admin/exam-records/{id}` | `exam_records:read` | 返回与列表同源的单条记录摘要；不返回题目答案或解析 |
| GET | `/admin/exam-records/{id}/result` | `exam_records:read` | 终态返回与本人接口同源的 `FinalResult`；进行中记录按结果 reader 的状态规则拒绝 |

列表/详情摘要字段为 `record_id/paper_id/paper_title/user_id/username/name/source/category_id/difficulty/release_id/attempt_no/started_at/deadline_at/submitted_at/answered_count/total_count/status/grading_state/submission_method/score`。`source/difficulty` 只读该记录冻结值；未知 submission_method 返回 null。接口不返回或派生 `last_heartbeat_at/connection_state/switch_count/device_summary`。终态 result 可读取题干、选项和解析中的受控题图，但不存在学员答案图片或人工评语。

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
| GET | `/statistics/training/summary` | `statistics:read` | `paper_id` 必填；`category_id/source/difficulty/page/page_size` 可选；返回 `TrainingExamSummary` |
| GET | `/statistics/training/ranking` | `statistics:read` | 同查询，但 `difficulty` 必须明确；返回 `Page<RankRow>`，缺失难度返回 40001 |
| GET | `/statistics/training/export` | `statistics:export` | 与 ranking 完全相同的筛选和分页；下载当前页 xlsx，并附独立“口径说明”Sheet |
| GET | `/admin/dashboard` | 登录 | 返回 `{as_of,timezone:'Asia/Shanghai',metrics,exam_trend?}`；无权模块的指标键直接省略 |

`TrainingExamSummary` 固定包含：`release_id:string|null`、`eligible_count/eligible_started_count/historical_started_count/historical_only_started_count/submitted_attempts/submitted_users/finalized_users`、`participation_rate:number|null`、`score_groups`、`difficulty_composition`、`course_completion`、`uncompleted_reasons`、`as_of`。`score_groups` 每项为 `{difficulty,finalized_users,average_score,pass_rate,distribution:[{lower,upper,count}]}`；空成绩的平均分/通过率为 null。`RankRow={rank,user_id,name,source,difficulty,score,duration_seconds,record_id}`，全部 ID 为字符串。

人数与成绩采用两个显式口径，页面和导出不得混称：

- 当前应考按查询时点的启用账号、当前类别/来源及当前发布模式的难度映射计算；业务管理权限不改变学习身份。`eligible_started_count` 只取当前应考 ID 与历史成功开考 ID 的交集；`historical_started_count` 保留该 paper 全历史，当前范围外人数由 `historical_only_started_count` 单列，零分母参与率为 null。
- 历史筛选只读 `exam_record` 冻结的 `category_id/source/difficulty`，未知难度保持 `unknown`。成绩组和排名只使用 `release_id` 指向的最新 release、与其 `rule_snapshot` 完全一致、同 difficulty 且 `grading_state=finalized` 的记录，再取个人最高分；不跨 release/规则合榜。
- 同分使用标准竞争排名（1/1/3）。个人同分答卷在两个 `graded_at` 都已知时选较早者；任一历史时间未知时按最小 `record_id` 稳定兜底。用时取 `started_at → submitted_at`，timeout 取 `started_at → deadline_at`。
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
      "required": true, "sort_order": 1,
      "current_version": { "version_id": "35", "asset_id": "50", "duration_ms": 120000 }
    }]
  }]
}
```

课程状态为 `draft / published / offline`。只有 draft/offline 可改变章节或课时结构；published 仍允许追加新 `lesson_version`，旧版本与媒体引用不覆盖。上架时锁定并确认类别启用，并要求每个必学课时的当前版本属于该课时、时长大于 0，且媒体为 ready 的 video；不满足返回 40930。课程的 `regulation_ids` 只是信息关联，不能进入抽题池或变成学习门槛。

学员可见集合固定为：账号启用、`source=institution`、有类别、课程 `status=published` 且类别相同；排序为推荐优先、`sort_order ASC,id DESC`。external 或缺来源/类别返回空页，跨类别/下架详情返回 40302。`GET /me/home` 直接并行组合真实 `SystemService.publicConfig()` 与 `CourseService.visibleCourses()`，所以站点字段仍只有 `logo_asset_id/banners`，课程集合、排序、分页及 external 空页语义与 `/me/courses` 完全相同；不另造推荐可见性、完成度或学习门槛。

PC 路由 `/admin/courses` 以 `courses:read OR courses:write` 判断入口可见，`/admin/courses/{id}` 仍要求 `courses:read`。这只是前端注册路由的 `permissionAny` 语义；服务端每个 API 的 `@Permissions` 仍保持 AND 守卫，不改变全局授权模型。write-only 账号可创建课程，但不会读取列表或跳转到无权详情。

### 3.10 B2 视频学习 /me/video-sessions、/me/video-records、/me/courses/{id}/progress

| 方法 | 路径 | 权限 | 请求与成功 data |
|---|---|---|---|
| POST | /me/video-sessions | 登录本人 | `{lesson_id:Id}`；返回 `VideoSessionView` |
| POST | /me/video-sessions/{id}/heartbeat | 登录本人 | `VideoHeartbeat`；返回 `VideoProgress` |
| POST | /me/video-sessions/{id}/close | 登录本人 | 无 body；只收口、不补记未上报区间，返回 `VideoProgress` |
| GET | /me/video-records | 登录本人 | `page` 默认 1、`page_size` 默认 20 且范围 1—100；返回本人历史 `Page<VideoRecordView>`，未知 query 拒绝 |
| GET | /me/courses/{id}/progress | 登录本人 | 返回当前应学集合 `CourseProgress` |

```ts
type VideoHeartbeat = { seq:number; position_ms:number; state:'playing'|'paused'|'buffering'|'background'|'ended' };
type VideoProgress = { confirmed_position_ms:number; credited_ms:number; coverage_ms:number;
  duration_ms:number; completed:boolean; last_seq:number };
type VideoSessionView = { session_id:Id; version_id:Id; heartbeat_interval_ms:30000; progress:VideoProgress };
type VideoRecordView = { record_id:Id; lesson_id:Id; version_id:Id; progress:VideoProgress };
type CourseProgress = { required:number; completed:number; completion_rate:number|null; lessons:VideoProgress[] };
```

start 每轮先用短事务锁定 `sys_user`，重新检查账号启用、`source=institution`、类别、课程 published、课时归属及 `current_version_id`，不能只相信 `LessonVersionService.current()` 或事务外 `assignedCourseIds()`。若发现活动 reading，事务立即释放；随后才在事务外等待原 reading mutex 并调用唯一的旧阅读 flush 算法，再重新进入短事务权威校验，最多竞争重试 3 次，仍被抢占返回会话冲突。最终无活动 reading 的事务用同一 manager 关闭旧 video，完成后重新取服务端时钟作为新会话锚点。阅读 start 使用同一循环并在锁内复核账号状态。其 DB 会话提交后发布 Redis 前再次锁用户并检查 DB `ended_at` 与当前活动所有权，避免已被视频替换的迟到 Redis 指针复活旧阅读计时；若 phase2 在真正替换前完成并返回 200，后续 start 仍会收口它，最终所有权以 DB 为准。

心跳以数据库中的 `last_seq/last_heartbeat_at/anchor_position_ms/anchor_state` 为权威，进程重启后继续。仅前一锚点为 playing 且本拍为 playing/ended 时可确认区间；先以完整的非负服务端实际间隔判断 `forward_ms ≤ server_elapsed_ms + 2000`，再将有效时长取服务端间隔、45 秒和真实位置前进量的最小值。过大前进不增加 `coverage_ms`，只把下一拍锚点移到新位置。paused/buffering/background 不计时；重复观看可增加 `credited_ms`，合并后的覆盖区间不重复增加。`state=ended` 同拍结算合法区间后关闭会话。

完成条件是 `coverage_ms / duration_ms ≥ 0.95`。课程分母只包含当前账号类别下已上架课程的必学课时当前版本；external、停用、无类别或零必学课程返回 `required=0,completed=0,completion_rate=null`，不会自动完成。视频替换后旧版本记录保留，但不计入新版本完成；课程下架、当前版本替换或学员来源/类别变化会关闭后续视频计时。`GET /me/video-records` 只按令牌本人查询历史记录，不按当前课程/来源/类别重新过滤，不返回媒体 URL，也不重开会话；账号停用仍由全局认证守卫拒绝。该 API 证明服务端协议与恢复能力，不证明真实注意力、移动端全屏/锁屏/微信或弱网体验。

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

### 4.3 发起 AI 出题 POST /api/v1/ai/generate-questions

请求：

```json
{
  "material_id": "12",
  "material_version_id": "35",
  "category_id": "3",
  "difficulty": "hard",
  "question_count_single": 20,
  "question_count_multiple": 5,
  "score_single": 3,
  "score_multiple": 8
}
```

响应（成功，异步任务受理）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "gen-20260912-0007",
    "status": "running",
    "estimated_seconds": 120,
    "category_id": "3",
    "difficulty": "hard"
  }
}
```

任务完成后 `GET /ai/generate-status/gen-20260912-0007` 返回生成的题目（均为 `status = pending` 待审核）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "gen-20260912-0007",
    "status": "completed",
    "questions": [
      {
        "id": 501,
        "question_id": "501",
        "current_version_id": "8801",
        "revision": 1,
        "category_id": "3",
        "difficulty": "hard",
        "material_id": "12",
        "material_version_id": "35",
        "type": "single",
        "stem": "根据本制度，动火作业审批的有效期最长不超过多少小时？",
        "options": [
          { "key": "A", "text": "8 小时" },
          { "key": "B", "text": "24 小时" },
          { "key": "C", "text": "48 小时" },
          { "key": "D", "text": "72 小时" }
        ],
        "answer": [1],
        "analysis": "制度第四章第十二条：动火作业审批有效期最长不超过 24 小时。",
        "score": 3,
        "status": "pending",
        "source": "ai"
      }
    ]
  }
}
```

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

### 4.7.1 C3 确认草稿与结果（字符串 ID）

`PUT /api/v1/me/exam-records/9001/draft` 请求：

```json
{
  "revision": 3,
  "answers": [
    { "item_id": "9101", "selected": [0] },
    { "item_id": "9104", "selected": [0, 2] }
  ]
}
```

确认响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "revision": 3,
    "saved_at": "2026-10-22T01:30:15.123Z",
    "answered_count": 2
  }
}
```

`POST /api/v1/me/exam-records/9001/submit` 可不带 body，或携带同一 `DraftInput` 作为最后确认稿。客观题即时结果示例（`items` 仅节选一题，真实响应包含冻结题单全部项）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "record_id": "9001",
    "grading_state": "finalized",
    "submission_method": "manual",
    "legacy": false,
    "submitted_at": "2026-10-22T01:31:00.000Z",
    "graded_at": "2026-10-22T01:31:00.000Z",
    "score": 62.5,
    "passed": true,
    "correct_rate": 0.5,
    "items": [
      {
        "item_id": "9101",
        "type": "single",
        "stem": "示例题干",
        "options": [{ "key": "B", "text": "乙" }, { "key": "A", "text": "甲" }],
        "score": 25,
        "answer": { "item_id": "9101", "selected": [0] },
        "correct_answer": [0],
        "analysis": "示例解析",
        "gained_score": 25
      }
    ]
  }
}
```

三类客观题提交后均由服务端自动进入 `grading_state="finalized"`。C2 历史结果的 `submission_method/graded_at` 可为 NULL，并以 `legacy=true` 明示元数据遗留。

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
| 40901 | 409 | 未完成有效学习，暂无考试资格 | **legacy 制度固定卷**开考校验③失败；data 附差距（时间缺口/底部段未覆盖）。新培训考试默认不使用该错误作为学习门槛 |
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
| 40940 | 409 | 题目当前版本已变化或不存在 | 编辑/审核/重生成的显式 expected_version_id 与锁内 current_version_id 不一致，或 identity/current_version 指针损坏；不写新 revision，客户端刷新后重试 |
| 40950 | 409 | 视频学习会话已结束或被替换 | 心跳指向已关闭、已被阅读/视频新会话取代或不属于当前活动所有者的会话 |
| 40951 | 409 | 课程或视频版本当前不可学习 | 课程下架、课时当前版本替换，或会话后续范围检查失败；服务端先关闭活动视频所有权再返回 |
| 40970 | 409 | 试卷发布状态已变化 | 非 draft 修改/发布、非 published 撤回，或锁内类别/模式与预读不一致 |
| 40971 | 409 | 候选题池容量不足 | 随机卷初级或高级任一题型的不重复考点数小于 required；data.deficits 返回 type/required/available |
| 40972 | 409 | 试卷规则不合法 | 总分非 10000、固定题存在重复考点/非当前审核版本/越类别或制度筛选，或随机题型规则非法 |
| 42201 | 422 | 文件格式不支持 | 上传非 pdf/docx（含魔法数不符） |
| 41601 | 416 | 请求的媒体范围无效 | `Range` 语法非法、多段范围或起止超出文件边界 |
| 42202 | 422 | 文件超过大小上限 | 题库资料超过 50MB，或媒体图片/视频超过当前配置限制；Multer 拦截与业务层统一此码 |
| 42203 | 422 | 发布校验未通过 | 试卷发布总分不等于 100，或题目/来源/类别不满足发布规则 |
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
| /admin/training-categories | — | — | — | A2 候选实现全部 6 个；A3 映射 training_categories:read/write |
| /admin/students | — | — | — | A2/A4 实现全部 11 个；A3 映射 students:read/write |
| /admin/question-materials | — | — | `ai:read/write` | 资料创建、上传、状态与重试；不绑定类别 |
| /admin/questions | — | — | questions:write | B4 模板、预检、状态和确认均使用同一写权限；owner/kind 由服务端收口 |
| /me | — | GET/PATCH 本人资料；GET `/me/home` 按本人身份返回公开配置与可见课程 | — | 同左 |
| /me/courses | — | 同类别已上架课程分页/详情；external 默认空 | — | 同左（仍按本人类别收口） |
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

说明：`super_admin` 天然拥有 `regulation_admin` 全部能力；学习/考试面向发布范围内的用户开放、不按角色排除（管理员被纳入范围时同样应学应考，05 册 2.4.2）。

### 6.2 限流与幂等约定

| 接口 | 限流/约束 | 机制 |
|---|---|---|
| POST /auth/captcha | source_ip 每分钟最多 10 次；答案 120 秒 TTL 且一次消费；刷新只消费 `previous_captcha_id` | Redis 短期键；生产响应不返回答案 |
| POST /auth/login | username 维度：连续失败 5 次锁定 10 分钟（40106，message 含剩余秒数）；source_ip 维度：10 次/分钟 | 双计数防爆破（07 册 2.2.2）；Redis 故障时降级为仅 IP 维度进程内计数 + 登录接口 sys_user.status 校验兜底 |
| POST /learning/heartbeat | 节拍窗口限流：30 秒周期内异常高频丢弃（42901） | 丢弃不影响时长正确性（服务端时钟差结算、credited 封顶 45 秒，天然幂等） |
| POST /learning/heartbeat/pause、resume | 同一 session_id 每分钟最多 60 次；重复 pause / 重复 resume 幂等（第二次直接返回当前状态，不重复结算） | 事件驱动端点不适用 30 秒节拍窗口——丢弃 pause/resume 会破坏失焦语义（resume 被丢弃 → 下拍 diff 含整段失焦时间、pause 被丢弃 → 失焦期间照常计费，虚增最多 45 秒/次，故单独限流） |
| POST /me/video-sessions/{id}/heartbeat | 客户端默认 30 秒；序号必须递增，单次最多确认 45 秒 | DB session→record 行锁；重放/乱序返回当前进度，暂停/缓冲/后台零累计，跳播不写覆盖 |
| POST /exams/records/{id}/heartbeat | 30 秒节拍窗口限流 | 作答暂存幂等（覆盖写） |
| POST /exams/records/{id}/submit | 幂等：重复交卷返回首次结果 | 三层幂等（05 册 6.4.5） |
| PUT /me/exam-records/{id}/draft | revision 单调且 payload 哈希一致 | current+1 写入；当前 revision 同 payload 回放原 ACK，异 payload/旧版/跳号拒绝 |
| POST /me/exam-records/{id}/submit | 主动/超时/并发统一幂等 | user→record 或 timeout-only record 行锁；同事务可选保存+终结，终态返回首次 FinalResult |
| POST /admin/question-materials/{id}/versions | 并发上传同一资料串行化（版本号唯一） | 事务 + uk_regulation_version；响应版本 `id` 为字符串 |
| POST /admin/courses/{id}/publish | 上架与下架后重上架均重新校验类别和必学视频；发布中间态不对学员可见 | 课程行悲观锁 + 同事务 readiness 校验 |
| POST /admin/courses/{id}/lessons/{lessonId}/versions | 同一课时版本号顺序追加，旧行不修改 | 课程/课时行悲观锁 + uk_lesson_version_number |
| POST /ai/generate-questions | 同资料同时仅一个运行中任务 | Redis SETNX；category/difficulty 固定来自请求，内部 source version 固定为显式 material_version_id |
| POST /admin/papers/{id}/publish | 重复发布已 published 卷返回现有 release_id；并发发布只生成一个版次 | 先锁培训类别、再写锁 exam_paper；uk_paper_release_version 兜底 |
| POST /admin/papers/{id}/withdraw/archive | 状态转移串行；只阻新开考且不删 release | exam_paper 行写锁；C2 开考将消费同一行锁 |

### 6.3 传输与敏感信息

- 生产环境经 nginx TLS 终止提供 HTTPS（07 册 4.1）；密码仅在登录/改密报文中出现，存储一律 bcrypt。
- 响应体永不返回 `password_hash`或明文 `api_key`。在考 payload 及普通预览不返回标准 `answer/analysis`；答案版是单独授权的管理接口，不与学员下发契约共用。只有终态结果可向本人下发冻结标准答案与解析。
- `trace_id`：50001 错误响应 `data.trace_id` 供日志排查。
- 题库管理预览可读取答案与解析，但富文本图片只存 media id 并经 Bearer 鉴权内容接口换取 Blob URL，不暴露私有路径或外链。新培训在考 payload 不返回标准答案或解析；终态题图按 3.7.1 分阶段授权。不存在答题图片资源。

---

## 附：与基准文档的一致性对照

| 校验项 | 结果 |
|---|---|
| 当前路由前缀与 README 3.4 模块映射 | 一致；现行新增 `/admin/question-materials`、`/admin/questions`、`/admin/papers`、`/me/exams*` 与 `/admin/exam-records`，旧学习/考试/统计只读兼容 |
| 当前表名/字段名（snake_case）与 03 册 | 一致：36 张业务表、三类客观题、客观答案列和无监控采集字段 |
| 枚举值与 README 3.4 | 一致（角色、各 status 枚举逐字对齐） |
| 心跳/失焦/乱序/草稿/超时行为与 05 册 | 一致；考试心跳只校时，不采集监考数据 |
| 统计口径与 05 册 7.4.1 | 一致（七项指标逐字对齐） |
| 错误码分段与 README（40xxx/50xxx） | 一致 |
