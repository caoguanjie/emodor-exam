# 04 · API 设计 —— 制度学习及考试系统（EmodorRuleExam）

> **一句话定位**：本文档定义 EmodorRuleExam 的 `/api/v1` 全量 REST 接口契约——统一响应结构、八大模块路由、接口清单与参数、核心接口 JSON 示例、统一错误码表与限流幂等约定，是前后端并行开发的对接契约。
>
> **口径基准**：本文档所有表名、字段名、枚举值、角色值、模块名与 [README.md](README.md) 逐字一致；接口行为与 [05-模块设计.md](05-模块设计.md) 的模块内部设计逐条对应（章节引用形如「05 册 5.4.3 节」）。

> **状态边界（2026-10-21）**：本册 legacy 制度/AI/阅读/旧固定卷接口、A2 培训类别/学员/本人资料、A3 权限/会话、A4 受控媒体、A5 后台公共配置、B1 课程主体与 B3 四题型版本题库接口均以实际 controller/entity/migration 为准。A5 系统配置页已完成独立审查与有界 PC 验证，但不代表开发库/生产库已升级；B1 final 已接入真实 `/me/home`、课程菜单/路由和 Courses/CourseDetail 分区未保存保护，真实课程 PC 验收仍由 root 统一执行；B3 编辑器接线和真实 PC 由其 final owner 收口。B2 视频进度、B4 题库导入、C1 发布/个人题单及后续草稿、阅卷、监控和统计仍未实现。所有接口继续使用 `/api/v1`、`{code,message,data}`、严格 DTO/未知字段拒绝、所有权校验和 HttpOnly refresh Cookie；私有媒体与公开品牌内容流例外跳过信封。

---

## 1. API 总体规范

### 1.1 基础约定

| 项 | 约定 |
|---|---|
| 基础 URL | `/api/v1`（由 nginx 反向代理至 NestJS 应用） |
| 协议风格 | REST：资源名词复数、动作用 HTTP 方法表达（GET 查询 / POST 创建与动作 / PUT 修改 / DELETE 删除）。PUT 用于资源状态字段的部分修改（非全量替换）；非幂等动作（retry、archive 等）一律使用 POST |
| 请求格式 | `application/json`；文件上传为 `multipart/form-data`；Excel 导出响应为二进制流（`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`） |
| 认证方式 | `Authorization: Bearer <access_token>`（JWT 双令牌，见 1.3） |
| 时间格式 | ISO 8601（`2026-09-12T14:30:00.000+08:00`）；纯秒数字段（如 `total_seconds`）为整型 |
| 字段命名 | JSON 字段一律 snake_case，与数据库字段对齐（03 册） |
| ID 字段 | legacy 接口继续保留既有 number 响应以兼容页面；A1 后新增培训接口的 `id` 与 body/path 中 `*_id`（含 B1 课程 ID、B3 `question_id/current_version_id/category_id`）统一使用正十进制字符串，避免 BIGINT 经 JavaScript `Number` 丢精度。异步 `task_id` 仍是服务端业务字符串 |
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

**培训分页例外**：A1 后新增的 `Page<T>` 固定为 `{items,total,page,page_size}`。B1 的课程列表与两类 category-options 均使用 `items`；不改写 legacy `/regulations` 等接口的 `list` 字段。

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
| 开考 `POST /exams/papers/{id}/start` | 资格校验链第⑤步：库查 + Redis `SETNX exam:lock:start:{user_id}:{paper_id}` 开考锁；已有 in_progress 记录直接返回该记录（断网重进场景，05 册 6.4.1） |
| 交卷 `POST /exams/records/{id}/submit` | 三层幂等（05 册 6.4.5）：状态前置校验 + Redis 提交锁 + 事务内终态判定；重复调用返回首次评分结果 |
| 会话开始 `POST /learning/sessions/start` | 单活跃会话约束（后开者胜）：同 user + regulation 已有活跃会话时，旧会话被结束落库并返回新会话（05 册 5.4.1） |
| 学习心跳 | 天然幂等：以服务端时钟差结算，重复/乱序心跳不虚增时长（45 秒封顶，05 册 5.4.2） |

### 1.6 当前 API 与融合计划的边界

| API 范围 | 文档状态 | 规则 |
|---|---|---|
| `/auth`、`/users`、`/departments`、`/regulations`、`/ai`、`/learning`、旧 `/exams`、旧 `/statistics` | 当前 legacy 契约 | 旧制度阅读资格、旧固定卷字段与自动客观评分保持兼容；下发不含答案/解析，refresh 走 HttpOnly Cookie，DTO/统一信封不变 |
| `/admin/training-categories`、`/admin/students`、`/me`、`/admin` 权限/会话/系统配置、`/media`、`/site-config`、B1 课程/视频内容版本、B3 四题型题库版本 | 当前增量契约（A2—A5/B1/B3） | A5 DTO、权限与公开白名单按实际 controller/service；B1/B3 使用字符串 ID 与 `Page.items`，课程不提前承载 B2 视频进度，题目 revision 不冒充发布或个人题单快照 |
| 视频进度、题库导入、发布快照、个人题单、持久草稿、图片答案/阅卷、监控、培训统计 | 计划契约（B2/B4/C1—C6） | 只有相应 migration/entity/controller 与 API 集成测试存在后才补精确契约，不由 B1/B3 提前制造学习、发布或考试快照 |
| 旧固定卷 vs 新培训考试开考 | 两条口径并存 | 旧固定卷继续检查 `learning_record.is_valid`；新培训考试默认关闭学习门槛，但仍检查发布、类别/来源、权限、次数、身份状态和服务端 deadline |

目标考试链路固定遵循：发布/候选版本快照 → 个人题单快照 → 确认草稿持久化 → 主动或超时幂等终结 → 客观题自动判分/图片题待阅 → 受控逐题评分 → 服务端汇总 → 最终结果只读。具体字段由 C1—C4 落地后补入，不能让旧 `/exams` 响应提前承载两套不兼容语义。

---

## 2. 模块与路由总览

当前 legacy 基线与 A2—A5、B1、B3 增量路由均使用同一 `/api/v1` 前缀。下表的数量按当前 controller HTTP 方法装饰器机械盘点：

| 路由前缀 | 所属模块（固定名称） | 接口数 | 说明 |
|---|---|---|---|
| /auth | 1. 组织权限模块 | 6 | 验证码、登录、刷新、个人信息、改密、登出 |
| /users | 1. 组织权限模块 | 8 | 员工 CRUD、重置密码、批量导入、启停 |
| /admin/training-categories | 1. 组织权限模块（A2） | 6 | 培训类别分页、详情、增改、启停、引用保护删除 |
| /admin/students | 1. 组织权限模块（A2/A4） | 11 | 学员分页、CRUD、头像、启停、重置密码、xlsx 模板/预检/批次确认 |
| /me | 1. 组织权限模块（A2/A4）及 4. 学习行为管控模块（B1） | 3 | 本人资料查询/修改；首页组合公开站点配置与本人可见课程分页 |
| /media | 1. 组织权限模块（A4） | 5 | 受控上传、限制查询、状态/Range 读取、引用保护删除 |
| /admin | 1. 组织权限模块（A3/A5） | 24 | A3 权限/角色/管理员/会话 10 个；A5 菜单/字典/站点配置/审计 14 个 |
| /site-config | 1. 组织权限模块（A5） | 2 | 严格公开 Logo/轮播白名单；仅当前配置的品牌图片内容流 |
| /departments | 1. 组织权限模块 | 6 | 部门树、CRUD、层级调整与启停 |
| /regulations | 2. 制度文件管理模块 | 18 | 制度 CRUD、版本/文件读取、管理端预览、范围与学习要求配置、发布、阅读内容及写权限类别选项 |
| /admin/courses | 4. 学习行为管控模块（B1 内容侧） | 14 | 课程、章节、视频课时、不可变内容版本、上架/下架与类别选项 |
| /me/courses | 4. 学习行为管控模块（B1 内容侧） | 2 | 本人同类别已上架课程分页与目录；external 默认空 |
| /ai | 3. AI 出题模块 | 26 | AI 配置/任务、B3 类别与考点窄选项、四题型版本审核、人工录入、试卷管理与组卷 |
| /learning | 4. 学习行为管控模块 | 7 | 学习列表、会话生命周期、心跳、进度 |
| /exams | 5. 考试评分模块 | 8 | 可考列表、开考、心跳、切屏、交卷、成绩 |
| /statistics | 6. 统计报表模块 | 6 | 制度/部门/个人维度统计与导出 |
| /health | 基础设施（非业务模块） | 1 | 容器探活，豁免认证，仅限 Compose 内部网络（nginx 不对外代理该路径）；响应 `data` 为 `{ status, mysql, redis, disk_free_mb }` |

**按当前 controller HTTP 方法装饰器机械盘点，合计 153 个接口（152 个业务接口 + 1 个健康检查），其中 `/regulations` 18 个、`/ai` 26 个、B1 课程/首页 17 个、A5 `/admin` 14 个与 `/site-config` 2 个；私有媒体与公开品牌内容流不包统一信封。**

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

### 3.2 员工管理 /users（权限：管理）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | /users | 分页列表（筛选：keyword/department_id/role/status） |
| 2 | GET | /users/{id} | 员工详情（不含 password_hash） |
| 3 | POST | /users | 创建员工（初始密码策略见 07 册 2.2） |
| 4 | PUT | /users/{id} | 修改员工（real_name/employee_no/department_id/role/phone/email） |
| 5 | PUT | /users/{id}/status | 启用（1）/ 停用（0） |
| 6 | GET | /users/import-template | 下载导入模板（Excel） |
| 7 | POST | /users/import | Excel 批量导入（multipart，file 字段） |
| 8 | PUT | /users/{id}/password | 重置密码（写 password_hash、force_password_change = 1、递增 auth_version、auth:block:{user_id}，见 1.3；保留真实登录统计，重置后下次登录回到强制改密流程） |

**POST /users/import**：模板 6 列（username / real_name / employee_no / department / role / password，05 册 2.4.4）；两阶段校验（格式层 + 业务层）后批量写入；采用「预校验 + 批量写 + 唯一冲突降级」的部分成功策略——响应 data 返回 `success_count / fail_count / failures[]`（行号 + 原因），全部失败时事务回滚。

**员工不提供物理删除**——员工关联 learning_record / exam_record 等历史数据，物理删除将破坏统计口径与审计链路，退出语义由停用（PUT /users/{id}/status, status=0）承载（01 册 FR-ORG-03）。

> **路由声明顺序**：Controller 中静态路由（`import-template` / `import`）必须先于参数路由（`:id`）声明，否则 `GET /users/import-template` 会被 `/users/:id` 匹配吞掉（NestJS 按声明顺序匹配）——纳入代码评审检查项。

### 3.2.1 培训类别 /admin/training-categories（A2）

当前候选实现以 `super_admin` 作为管理边界；A3 集成时映射为 `training_categories:read`（GET）和 `training_categories:write`（POST/PUT/DELETE）。类别只做业务归类，不授予任何角色权限。列表响应使用通用分页结构 `data.items/total/page/page_size`，类别 ID 和 `created_by` 均为字符串 ID。

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

当前候选实现以 `super_admin` 作为管理边界；A3 集成时映射为 `students:read`（GET）和 `students:write`（POST/PUT/批次确认/启停/重置）。新学员固定 role=`employee`，`category_id` 与 `source` 必填；`source` 只影响后续抽题策略，不等于权限。旧 `/users` 不补默认来源/类别，原返回结构不变。

A3 学员管理边界：列表、详情、资料更新、启停和重置密码仅作用于 `sys_user.role=employee` 且不存在任何 `sys_user_role` 记录的账号。只要存在业务角色链接，即使角色无权限或已停用，也按管理员账号从上述学员接口范围排除；详情与上述写操作统一返回 40401，避免泄露受保护账号。更新、启停、重置在同一事务内先以用户行悲观锁完成最终分类检查，再执行原有保存、认证世代递增和会话吊销；角色赋值仍按角色行后用户行加锁，保证赋值与学员 mutation 串行。本人资料接口不受该管理边界改变。

| # | 方法 | 路径 | 请求与约束 | 成功 data |
|---|---|---|---|---|
| 1 | GET | /admin/students | query：`page`、`page_size`、`keyword`、`category_id`、`source`（institution/external）、`status`（0/1） | `Page<Student>`；ID 均为字符串 |
| 2 | GET | /admin/students/{id} | — | `Student`，不含 password_hash |
| 3 | POST | /admin/students | body：`username`、`password`、`real_name`、`category_id`、`source` 必填；可选 `employee_no/department_id/phone/email` | `Student`，role 固定 employee |
| 4 | PUT | /admin/students/{id} | body：`real_name/employee_no/department_id/category_id/source/phone/email` 可选；不接受 username/password/role | `Student` |
| 5 | PUT | /admin/students/{id}/status | body：`status`（0/1） | `Student`；停用同时吊销既有令牌 |
| 6 | PUT | /admin/students/{id}/avatar | body：`avatar_id`（ready 的 avatar 图片资源 ID）或 null | `Student`；同一用户行锁事务内重查 managed-student 边界并更新引用 |
| 7 | PUT | /admin/students/{id}/password | body：`password`（≥8 位，含字母与数字） | `null`；旧令牌吊销并回到首登改密 |
| 8 | GET | /admin/students/import-template | — | `.xlsx` 二进制；表头为 `用户名/姓名/工号/手机号/邮箱/来源/培训类别ID/初始密码` |
| 9 | POST | /admin/students/import-preview | JSON `rows` 数组，或 multipart `file`；可选 `defaults:{source?,category_id?}` | `ImportPreview` |
| 10 | GET | /admin/students/import-batches/{id} | —；仅批次 owner 可读 | 未提交批次为 `ImportPreview`，已提交批次为 `ImportResult` |
| 11 | POST | /admin/students/import-batches/{id}/commit | body：`row_numbers` 为非空整数数组；仅批次 owner | `ImportResult` |

`Student` 字段为 `{ id, username, real_name, employee_no, department_id, category_id, source, role, phone, email, avatar_id, status, last_login_at, created_at }`，其中 `avatar_id` 可为 null。列表默认 page=1/page_size=20，page_size 范围 1—100；未知 query/body 字段、非整数分页、非法枚举均返回 40001。本人资料接口见 3.2.3，不允许通过学员接口修改 role。

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
| POST | `/media/upload` | 登录；非头像用途需 `media:write` | multipart `file` + `purpose`（avatar/course_cover/video/question/branding），可选头像 `owner_id`；公开 DTO 不接受 `answer`，返回 40001。内部 `MediaService` 保留 image-only `answer` 能力，只有未来 C3 专用路由可在校验题单归属和截止时间后调用。成功 `data={asset_id,status,duration_ms}`（A1 新接口 ID 均为字符串），视频实际探测后才为 ready |
| GET | `/media/{id}` | 资源拥有者/已注册 owner authorizer | 查询 `asset_id/purpose/media_kind/mime_type/size_bytes/status/duration_ms`；公开 status 仅为 `processing/ready/failed`，内部 `deleting` 按 40401 不存在处理 |
| GET | `/media/{id}/content` | 资源拥有者/已注册 owner authorizer | 私有流，支持单一 `Range: bytes=start-end`，命中返回 206 与 `Content-Range`；无效或不可满足 Range 返回 41601/HTTP 416；文件流跳过统一信封 |
| DELETE | `/media/{id}` | 资源拥有者 | 有任何 `media_reference` 时返回 40913；无引用后先落内部 `deleting` 再删除物理文件，失败保留行供重试并返回 50004/HTTP 503，成功或文件已不存在才删数据库行 |

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

菜单写入 DTO 固定为 `parent_id? / name / type / route_path? / permission_code? / icon? / sort / status`。`type=directory` 不得带路由或权限；`type=menu` 的 `route_path` 必须在前端注册管理路由集中；`type=button` 不得带路由且必须使用服务端注册权限。新增、修改、删除先锁定初始化保证且业务不可删除的 `site_setting.logo_asset_id` 实存行，再在同一事务重读菜单树关系；因此空树双创建可依次成功，互挂父级、建子与删父、建子与父节点改按钮只会提交合法一侧。互斥行缺失时返回 50004/HTTP 503，不自动修复、不把数据库死锁当业务冲突。默认 Questions 导航不在数据库层先限制 `questions:read`，前端注册路由精确以 `questions:read OR questions:write` 判定；这不改变各 API 守卫的单接口权限。

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

### 3.3 部门管理 /departments（权限：管理）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | /departments/tree | 全量部门树（登录即可读；parent_id 自关联构建，05 册 2.4.3） |
| 2 | POST | /departments | 创建部门（parent_id / name / sort） |
| 3 | PUT | /departments/{id} | 修改部门（name / sort） |
| 4 | PUT | /departments/{id}/parent | 层级调整（含循环引用检测，事务执行） |
| 5 | DELETE | /departments/{id} | 删除部门（存在子部门或在职员工时拒绝） |
| 6 | PUT | /departments/{id}/status | 停用/启用部门（status=0/1；仍被引用的部门以停用替代删除，保留为历史统计维度，05 册 2.4.3） |

`GET /departments/tree` 是员工与学员管理页面复用的登录后查找接口，保留普通员工及委派管理员可读；创建、修改、移动、停用、删除等写操作仍只允许 `super_admin`，不能由树查询例外扩大权限。

### 3.4 制度管理 /regulations

#### 3.4.1 管理侧（权限：制度管理）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 0 | GET | /regulations/category-options | `regulations:write`；query `page/page_size/keyword`，强制只查启用培训类别，返回 `Page<{id,name}>` |
| 1 | GET | /regulations | 分页列表（筛选：keyword/category/status）；item 增加 `category_id:string|null`，legacy `category` 保持不变 |
| 2 | GET | /regulations/{id} | 制度详情（含当前版本、学习要求与 `category_id`） |
| 3 | POST | /regulations | 创建制度（title / legacy category / 可选 category_id / description） |
| 4 | PUT | /regulations/{id} | 修改制度基础信息；`category_id` 支持省略/字符串 ID/null 三态 |
| 5 | PUT | /regulations/{id}/learning-config | 学习要求配置（required_minutes / scroll_segments） |
| 6 | PUT | /regulations/{id}/scope | 发布范围配置（is_all / department_ids[]） |
| 7 | POST | /regulations/{id}/versions | 上传制度文件（multipart） |
| 8 | GET | /regulations/{id}/versions | 版本列表（含 parse_status） |
| 9 | GET | /regulations/{id}/versions/{versionId} | 版本详情（version_no / file_type / file_hash / parse_status / content_html 或 PDF 下载地址——管理端历史版本回看） |
| 10 | POST | /regulations/{id}/versions/{versionId}/retry | 解析失败重试（parse_status: failed → pending；非幂等动作，见 1.1） |
| 11 | PUT | /regulations/{id}/current-version | 切换生效版本（current_version_id） |
| 12 | POST | /regulations/{id}/publish | 发布（前置校验：生效版本 parsed、已配学习要求与范围） |
| 13 | POST | /regulations/{id}/archive | 归档/下架（动作端点，非幂等，见 1.1） |
| 14 | GET | /regulations/{id}/preview?versionId= | 管理端预览（跳过 status = published 校验、仅角色校验；versionId 缺省为当前生效版本） |

`GET /regulations/category-options` 必须在 `/:id` 路由之前声明。它只要求 `regulations:write`，不会顺带授予或要求 `training_categories:read`，响应 item 严格只有字符串 `id` 与 `name`。`POST` 的非空 `category_id` 必须在事务内锁定并校验类别启用；`PUT` 省略表示不改，显式 `null` 表示清空，正十进制字符串表示设置。PUT 传入与当前相同 ID 时不得因该类别后来停用而阻断标题等元数据编辑；只有改成新的非空 ID 才再次 `lockActive`。所有读响应继续回显旧 `category` 字符串。

**POST /regulations/{id}/versions**（multipart/form-data）：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| file | file | 是 | pdf / docx；上限 50MB（42202）；扩展名 + 魔法数双重校验（07 册 4.2） |

规则：`file_hash`（SHA-256）查重——重复时提示不阻断（05 册 3.4.1）；创建 `regulation_version`（version_no 递增，parse_status = pending）→ 投递异步解析（pdf-parse / mammoth，05 册 3.4.3）。

**GET /regulations/{id}/versions/{versionId}**：返回单个版本详情与解析产物（docx → `content_html`；pdf → 文件下载地址），供管理端历史版本回看（FR-REG-04 验收②）；`parse_status ≠ parsed` 时无解析产物。

**GET /regulations/{id}/preview?versionId=**：管理端预览——与员工侧 `/content` 的唯一差别是跳过 `status = published` 校验（仅角色校验），供发布前核对解析产物；`versionId` 缺省为当前生效版本（current_version_id）。

**发布范围变更语义**：`published` 状态下可调整范围，新增部门员工获得应学义务（学习记录按需创建），移除部门员工的已有 `learning_record` 保留、仅失去可见性（05 册 3.4.5 影响矩阵）。

#### 3.4.2 员工侧（权限：员工，限发布范围内的本人）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| — | GET | /regulations/{id}/content | 在线阅读内容（docx：content_html；pdf：file 下载地址，前端 pdfjs-dist 渲染） |

规则：可见性校验链——制度 `status = published` + 本人属于发布范围（regulation_scope 部门含本部门或 is_all）；返回当前生效版本（current_version_id）的产物；同时返回学习要求（required_minutes / scroll_segments）供前端渲染进度。

### 3.5 AI 出题与版本题库 /ai（细权限分别声明）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | /ai/config | `ai_config:read`；读取脱敏 AI 配置 |
| 2 | PUT | /ai/config | `ai_config:write`；保存 AI 配置 |
| 3 | POST | /ai/config/test | `ai_config:write`；文本连通性测试 |
| 4 | POST | /ai/config/test-vision | `ai_config:write`；视觉输入连通性测试 |
| 5 | POST | /ai/generate-questions | `ai:write`；按制度、类别、难度异步生成 single/multiple |
| 6 | GET | /ai/generate-status/{taskId} | `ai:read`；任务状态轮询 |
| 7 | GET | /ai/generation-category-options | `ai:write`；启用类别 `Page<{id,name}>` |
| 8 | GET | /ai/question-category-options | `questions:write`；人工录题类别选项 |
| 9 | GET | /ai/question-category-filters | `questions:read`；题库筛选类别选项 |
| 10 | GET | /ai/question-concepts | `questions:read`；按 category_id/type/keyword 查考点，返回 `Page<{id,category_id,type,name}>` |
| 11 | GET | /ai/question-concept-options | `questions:write`；必传 category_id/type，只返回启用类别内 `Page<{id,name}>`，不依赖 `questions:read` |
| 12 | POST | /ai/question-concepts | `questions:write`；创建同类别同题型考点 |
| 13 | GET | /ai/questions | `questions:read`；版本兼容视图分页筛选 |
| 14 | POST | /ai/questions | `questions:write`；人工录入四题型，首版本由录入管理员确认 approved |
| 15 | PUT | /ai/questions/{id}/review | `questions:review`；审核当前版本及驳回意见 |
| 16 | PUT | /ai/questions/{id} | `questions:write`；修订生成 pending revision；在考核心编辑仍拒绝 40908 |
| 17 | POST | /ai/questions/{id}/regenerate | `questions:write`；single/multiple 单题重生成新 revision |
| 18 | GET | /ai/questions/{id}/history | `questions:read`；revision 历史与真实审核元数据，返回 Page |
| 19 | GET | /ai/questions/{id} | `questions:read`；题目当前兼容视图 |
| 20 | GET | /ai/papers | 试卷列表（筛选 regulation_id/status） |
| 21 | POST | /ai/papers | 创建试卷 |
| 22 | GET | /ai/papers/{id} | 试卷详情 |
| 23 | PUT | /ai/papers/{id} | 修改策略字段 |
| 24 | PUT | /ai/papers/{id}/questions | 组卷；发布后锁定 |
| 25 | POST | /ai/papers/{id}/publish | 发布试卷，校验 SUM(score)=100 |
| 26 | POST | /ai/papers/{id}/archive | 归档试卷 |

**试卷路由归属说明**：试卷的创建/组卷/发布属于「题目审核 → 组卷 → 发布」的出题工作流（05 册 4.4.7 组卷服务隶属 AI 出题模块），故管理侧归 `/ai/papers`；面向员工的考试执行（可考列表、开考、交卷）归 `/exams`（考试评分模块）——同一资源的管理面与执行面分离，与模块边界一致。

**POST /ai/generate-questions**：

| 参数 | 位置 | 类型 | 必填 | 说明 |
|---|---|---|---|---|
| regulation_id | body | int | 是 | 目标制度 |
| category_id | body | string decimal ID | 是 | 启用培训类别；固定写入整批版本，不读取模型标签 |
| difficulty | body | string | 是 | easy / medium / hard；固定写入整批版本 |
| question_count_single | body | int | 否 | 单选题量，取值 1–40，默认 20 |
| question_count_multiple | body | int | 否 | 多选题量，取值 0–20，默认 5 |
| score_single | body | decimal | 否 | 单选每题分值，> 0，默认 3.00 |
| score_multiple | body | decimal | 否 | 多选每题分值，> 0，默认 8.00 |

校验规则：① 类别存在且启用、难度合法；② 制度存在且有 parsed 生效版本，文本不足的 PDF 可走视觉输入；③分值合计 100.00；④ AI 配置完整（否则 40909）。服务端把实际 `regulation_version_id`、请求 `category_id/difficulty` 写入每个 pending revision，拒绝模型覆盖。命题提示同样携带权威难度：easy 只考直接明确的一条规则，medium 在单一情境中直接应用规则，hard 综合应用多条规则；三档均须严格有据且结论无歧义。文本批次、视觉批次与单题重生成复用同一完整 JSON 合同：数组项含 `type/stem/options[恰好4项]/answer/analysis`，single 一个答案下标，multiple 为 2—3 个不重复下标。任务仍使用 Redis queued/running/completed/failed、长文本分块、块级重试和全失败零写入；响应与状态均回显 category_id/difficulty。

**GET /ai/config**（`ai_config:read`）：读取 AI 服务配置，`api_key` 掩码回显（如 `sk-****xxxx`，完整键值永不返回，07 册 4.2）。**PUT /ai/config**（`ai_config:write`）：保存 `base_url` / `api_key` / `model`——权威副本为 AES-256-GCM 加密后的配置文件，Redis 仅作缓存（07 册 4.2），并返回同样的脱敏配置结果。**POST /ai/config/test**（`ai_config:write`）：以已保存配置发起一次连通性测试，返回成功 / 失败与脱敏错误摘要（失败 → 50005）。`ai:read/write` 仅代表出题任务/题库工作流，不自动授予配置权限；管理端入口要求 `ai_config:read` 或 `ai_config:write`，但 writer-only 页面不得调用 GET、不得伪造现有配置值，只能提交空白表单并使用 PUT 返回的脱敏结果；`super_admin` 天然拥有全部注册权限。

**题目写入 DTO**：`category_id/difficulty/type/stem/options/answer/score` 必填；`concept_id/regulation_id/regulation_version_id/analysis/rubric` 可选。人工题可无制度来源；若传 regulation_version_id 必须同时传匹配的 regulation_id。single 恰一答案，multiple 至少两答案，judgment 固定正确/错误，image 的 options/answer 为空且 rubric 必填。富文本仅允许白名单标签与 `<img data-media-id="数字">`；拒绝脚本、事件、javascript URL 与外链图片，媒体绑定不可变 question_version 后通过 `/media/{id}/content` 鉴权读取。

**版本与审核语义**：POST 人工题创建 revision 1 并记录录入管理员的 `approved_by/approved_at`；PUT 编辑或 regenerate 创建新的 pending revision，不覆盖旧版本。`PUT /questions/{id}`、`PUT /questions/{id}/review`、`POST /questions/{id}/regenerate` 的 body 必须显式携带 `expected_version_id`：已版本化题传用户当前看到的十进制字符串 ID，未版本化 legacy 题明确传 `null`；省略或非法值返回 40001。服务在数据库锁内比较 identity 的实际 current_version_id，长时 regenerate 在发起与提交前各校验一次；不一致返回 40940，且不得创建错误 revision 或误审新版本。列表可按 `category_id/difficulty/concept_id/type/status/regulation_id/keyword` 筛选；响应同时保留旧 `id/version_id` 兼容字段并提供字符串 `question_id/current_version_id/regulation_version_id`、revision、审核元数据。旧题首次编辑/审核才捕获 revision 1，`legacy_captured_at` 明示升级快照，未知类别/难度/历史确认人/时间均保持 null，不自动补 easy。

**分页与安全显示**：`GET /ai/question-concepts`、`GET /ai/question-concept-options`、`GET /ai/questions/{id}/history` 都返回 `{items,total,page,page_size}`，默认 1/20，page_size 范围 1—100。题目列表、详情、历史与未保存预览在进入 HTML 渲染前统一执行安全白名单；遗留恶意标签、事件、javascript URL 与外链图片只在响应/预览边界移除，不回写历史。受控图片只保留 `data-media-id`，再经鉴权 `/media/{id}/content` 读取。

**扫描 PDF 来源定位**：视觉批次把程序实际调用的 `source_page_group/source_page_start/source_page_end` 写入 revision。单题重生成只渲染该页组；PDF 只有一个页组时可确定为 group 0，多页组 legacy revision 缺少定位时返回明确参数错误，不回退第一页、不依据模型声明伪造来源。

**候选服务边界**：内部 `approvedCandidates({categoryId,regulationIds?,type,difficulty})` 只返回 current revision 且 approved 的不可变快照。本接口不创建发布快照或个人考试题单；C1/C2 必须冻结 versionId 后再发布/开考。

**PUT /ai/papers/{id}/questions**：入卷校验——题目 `status = approved`、`question.regulation_id` 与试卷一致、同卷不重复（uk_paper_question 兜底，05 册 4.4.7）。legacy 固定卷的乱序与自动评分当前只支持 single/multiple，因此选题、发布、开考三个边界都拒绝 judgment/image；题目一旦被任一 `paper_question` 引用，类型变更返回 40908。此限制不代表 C1/C2 新发布链已实现。

**发布后策略可调边界**（05 册 4.4.7 生效边界表）：`paper_question`（题目组成与分值）发布后锁定；`pass_score` / `partial_credit_ratio` 判分时实时读取；`duration_minutes` / `max_attempts` 对后续发起生效。

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

本节是旧制度固定卷接口契约：资格链包含 `learning_record.is_valid`，题目/选项按旧 `paper_question` 读取，交卷后自动客观评分。新培训考试不复用本节字段硬塞类别、来源、难度、发布/个人快照、草稿或阅卷状态；相关新接口由 C1—C4 在实际 controller/entity 后补入，默认无学习门槛但不放宽服务端期限与防泄漏规则。

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | /exams/papers | 可考列表（含资格状态与剩余次数） |
| 2 | POST | /exams/papers/{id}/start | 开考（资格校验 + 创建记录 + 乱序下发） |
| 3 | GET | /exams/records/{id} | 恢复考试（断网重进，乱序一致） |
| 4 | POST | /exams/records/{id}/heartbeat | 考试心跳（时间校准 + 作答暂存） |
| 5 | POST | /exams/records/{id}/switch | 切屏上报（事件驱动，1 秒去抖） |
| 6 | POST | /exams/records/{id}/submit | 交卷评分（幂等） |
| 7 | GET | /exams/records/{id}/result | 成绩与答题明细（含解析） |
| 8 | GET | /exams/records | 我的考试记录列表 |

**GET /exams/papers** 响应项含：试卷信息、关联制度、`is_eligible`（is_valid）、`attempt_used` / `max_attempts`（剩余次数）、`best_score`（已考过的最高分）、`has_passed`（已通过标记——已 passed 不再显示「开始考试」入口）。

**POST /exams/papers/{id}/start**：资格校验链五步（05 册 6.4.1）：制度 published → 试卷 published → `is_valid = 1` → `attempt_no ≤ max_attempts` 且前次终态 ≠ passed → 无并发 in_progress（SETNX 开考锁）。在创建记录前还须重新读取固定卷题目，缺题或含 judgment/image 时明确拒绝，不能留下错误的 in_progress 记录。通过后创建 `exam_record`（in_progress、attempt_no 分配、regulation_id 冗余快照、**deadline_at 快照 = started_at + duration_minutes × 60 此后不变**，03 册 3.4.4）+ 写 Redis deadline（值与 TTL 由 deadline_at 派生），返回乱序题目数组——**不含 answer 与 analysis**（防偷答案）；seed = HMAC-SHA256(EXAM_SHUFFLE_SECRET, exam_record.id) 确定性乱序（EXAM_SHUFFLE_SECRET 为独立环境变量、不参与 JWT_SECRET 90 天轮换，断网重进顺序一致，05 册 6.4.2）。

**POST /exams/records/{id}/heartbeat**：body 含 `answers[]`（question_id + 呈现位置选择，Redis 暂存，超时自动交卷的评分输入）；响应返回 `remaining_seconds`（`deadline − 服务端当前时刻`，前端每 30 秒校准，不信任本地时钟，05 册 6.4.3）。

**POST /exams/records/{id}/switch**：切屏事件即时上报（不等心跳周期）；服务端 Redis INCR + 1 秒窗口去抖（05 册 6.4.4）；交卷时一次性写回 `exam_record.switch_count`。

**POST /exams/records/{id}/submit**：body 含 `answers[]`；服务端用同 seed 重算乱序映射，把呈现位置还原为题目原始选项下标后落库 `exam_answer` 并评分（05 册 6.4.2 判分语义）；超时自动交卷（定时任务，非 API）走同一评分路径，`status = timeout`、未答题目不得分。

**GET /exams/records/{id}/result**：`status` / `score` / `switch_count` / 逐题明细（stem / selected（已还原原始下标）/ is_correct / gained_score / answer / analysis）——解析仅在交卷后的成绩回看中下发。

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

### 4.2 上传制度文件 POST /api/v1/regulations/12/versions

请求（multipart/form-data）：`file=@安全生产管理制度V3.docx`

响应（成功）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "version_id": 35,
    "version_no": 3,
    "file_type": "docx",
    "file_hash": "a3f5...e91b",
    "parse_status": "pending",
    "duplicate_hint": null
  }
}
```

### 4.3 发起 AI 出题 POST /api/v1/ai/generate-questions

请求：

```json
{
  "regulation_id": "12",
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
        "regulation_version_id": "35",
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
    "switch_count": 1,
    "submitted_at": "2026-09-12T16:02:44.000+08:00",
    "best_score": 88,
    "answer_summary": [
      { "question_id": 501, "is_correct": true, "gained_score": 3 },
      { "question_id": 517, "is_correct": true, "gained_score": 8 }
    ]
  }
}
```

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
| 40001 | 400 | 参数错误 | 请求体/查询参数校验失败（附字段级原因；AI 出题分值合计 ≠ 100 亦返回此码） |
| 40101 | 401 | 未认证或令牌无效 | 缺失 Bearer 令牌 / 验签失败 |
| 40102 | 401 | 令牌已过期 | access token 过期（客户端应刷新） |
| 40103 | 401 | 刷新令牌无效 | refresh 缺失/过期/类型不符 |
| 40104 | 401 | 用户名或密码错误 | 登录凭据校验失败（用户不存在与密码错误同一提示） |
| 40105 | 403 | 账号已停用 | 登录时 status=0；或敏感操作前回查 status≠1 |
| 40106 | 429 | 账号临时锁定，请 N 秒后重试 | username 连续失败 5 次锁定 10 分钟（message 含剩余秒数，07 册 2.2.2） |
| 40107 | 401 | 令牌已被吊销 | token.iat 早于 auth:block:{user_id} 封禁时刻（改密/重置密码/停用后旧令牌，07 册 2.1.4） |
| 40301 | 403 | 无权限访问该资源 | 角色不匹配（如 employee 调管理接口） |
| 40302 | 403 | 无权访问该数据 | 数据范围越界（如读取他人学习记录） |
| 40401 | 404 | 资源不存在 | 路径资源（制度/试卷/记录等）不存在 |
| 40402 | 404 | 制度内容不可见 | 阅读内容接口：不在发布范围或未发布 |
| 40901 | 409 | 未完成有效学习，暂无考试资格 | **legacy 制度固定卷**开考校验③失败；data 附差距（时间缺口/底部段未覆盖）。新培训考试默认不使用该错误作为学习门槛 |
| 40902 | 409 | 补考次数已用尽 | 开考校验④失败（attempt_no > max_attempts） |
| 40903 | 409 | 已通过该考试，无需再次作答 | 开考校验④：前次终态 = passed |
| 40904 | 409 | 已有进行中的考试 | 开考校验⑤：并发 in_progress（幂等返回现有记录的场景之外） |
| 40905 | 409 | 交卷失败：考试已结束 | 交卷时记录已终态（重复交卷幂等场景直接返回首次结果，此码用于状态冲突） |
| 40906 | 409 | 学习会话冲突 | 心跳/暂停到达时会话已被新会话取代或已收口（单活跃约束；已收口语义为「会话已结束，请重新开始学习」，前端应刷新 session_id） |
| 40907 | 409 | 题目组成不可变更 | 修改已发布试卷的 paper_question |
| 40908 | 409 | 题目正在考试中使用，禁止编辑 | 题目被 in_progress 考试记录引用时修改 stem/options/answer/type（仅允许 analysis，05 册 4.4.6） |
| 40909 | 409 | AI 服务未配置或配置不完整 | 未配置 base_url/api_key/model 即发起出题或连通性测试（FR-AIQ-01 验收③） |
| 40910 | 409 | 培训类别不存在或已停用 | 学员/导入/课程/制度/题目/考点写入引用不存在或已停用类别；删除仍被学员、课程、制度、题目/版本或考点引用的类别 |
| 40911 | 409 | 导入批次已确认，不能更换行集合 | 批次确认重试更换合法行集合，或确认事务正在处理 |
| 40912 | 409 | 至少保留一名启用的超级管理员 | 尝试删除/停用/清空最高管理员保护权限 |
| 40913 | 409 | 媒体仍被业务引用，不能删除 | `media_reference` 存在时删除媒体资源 |
| 40920 | 409 | 系统配置仍被引用，不能删除 | 菜单存在子项/对应权限被角色引用，或固定业务字典尝试修改/删除 |
| 40930 | 409 | 课程状态冲突 | 必学视频未就绪、已上架课程直接修改章节/课时结构，或视频资源缺少有效服务端时长 |
| 40940 | 409 | 题目当前版本已变化或不存在 | 编辑/审核/重生成的显式 expected_version_id 与锁内 current_version_id 不一致，或 identity/current_version 指针损坏；不写新 revision，客户端刷新后重试 |
| 42201 | 422 | 文件格式不支持 | 上传非 pdf/docx（含魔法数不符） |
| 41601 | 416 | 请求的媒体范围无效 | `Range` 语法非法、多段范围或起止超出文件边界 |
| 42202 | 422 | 文件超过大小上限 | 制度文件超过 50MB，或媒体图片/视频超过当前配置限制；Multer 拦截与业务层统一此码 |
| 42203 | 422 | 发布校验未通过 | 制度发布缺前置（无生效版本/未配要求或范围）；试卷发布总分 ≠ 100 |
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
| /users | — | — | — | 全部 8 个 |
| /admin/training-categories | — | — | — | A2 候选实现全部 6 个；A3 映射 training_categories:read/write |
| /admin/students | — | — | — | A2/A4 实现全部 11 个；A3 映射 students:read/write |
| /me | — | GET/PATCH 本人资料；GET `/me/home` 按本人身份返回公开配置与可见课程 | — | 同左 |
| /me/courses | — | 同类别已上架课程分页/详情；external 默认空 | — | 同左（仍按本人类别收口） |
| /media | — | 本人头像上传/所有权范围读取 | 非头像上传需 `media:write` | 同左 |
| /admin 权限/会话 | — | — | 按 `roles/administrators/sessions:*` | 按各接口注册权限 |
| /admin 系统配置 | — | — | `system_settings:read/write` | 同左；导航树为登录用户自身权限视图 |
| /site-config | 配置两键与当前品牌内容 | 同左 | 同左 | 同左；不提供任意 media id 公开读取 |
| /departments | tree（登录） | — | — | 其余 5 个 |
| /regulations | — | content | 类别选项需 regulations:write；其余管理路由按 regulations:read/write/publish | 同左 |
| /admin/courses | — | — | 由业务角色显式授予 courses:read/write/publish | super_admin 天然拥有；类别 options 只需 courses:write |
| /ai | — | — | 按细权限开放 | 26 个端点逐项使用 `ai:*`、`ai_config:*`、`questions:*`、`papers:*`；人工录题 writer 可通过 `question-category-options` / `question-concept-options` 取类别/考点，不要求 questions:read；不把全局权限守卫改成 OR |
| /learning | — | 全部 7 个 | — | — |
| /exams | — | 全部 8 个 | — | — |
| /statistics | — | — | 全部 6 个 | 同左 |

说明：`super_admin` 天然拥有 `regulation_admin` 全部能力；学习/考试面向发布范围内的用户开放、不按角色排除（管理员被纳入范围时同样应学应考，05 册 2.4.2）。

### 6.2 限流与幂等约定

| 接口 | 限流/约束 | 机制 |
|---|---|---|
| POST /auth/captcha | source_ip 每分钟最多 10 次；答案 120 秒 TTL 且一次消费；刷新只消费 `previous_captcha_id` | Redis 短期键；生产响应不返回答案 |
| POST /auth/login | username 维度：连续失败 5 次锁定 10 分钟（40106，message 含剩余秒数）；source_ip 维度：10 次/分钟 | 双计数防爆破（07 册 2.2.2）；Redis 故障时降级为仅 IP 维度进程内计数 + 登录接口 sys_user.status 校验兜底 |
| POST /learning/heartbeat | 节拍窗口限流：30 秒周期内异常高频丢弃（42901） | 丢弃不影响时长正确性（服务端时钟差结算、credited 封顶 45 秒，天然幂等） |
| POST /learning/heartbeat/pause、resume | 同一 session_id 每分钟最多 60 次；重复 pause / 重复 resume 幂等（第二次直接返回当前状态，不重复结算） | 事件驱动端点不适用 30 秒节拍窗口——丢弃 pause/resume 会破坏失焦语义（resume 被丢弃 → 下拍 diff 含整段失焦时间、pause 被丢弃 → 失焦期间照常计费，虚增最多 45 秒/次，故单独限流） |
| POST /exams/records/{id}/heartbeat | 30 秒节拍窗口限流 | 作答暂存幂等（覆盖写） |
| POST /exams/records/{id}/switch | 1 秒去抖窗口 | Redis INCR + 窗口合并（前端 500ms 事件合并后上报，服务端 1 秒二次去抖，05 册 6.4.4） |
| POST /exams/records/{id}/submit | 幂等：重复交卷返回首次结果 | 三层幂等（05 册 6.4.5） |
| POST /regulations/{id}/versions | 并发上传同一制度串行化（版本号唯一） | 事务 + uk_regulation_version |
| POST /admin/courses/{id}/publish | 上架与下架后重上架均重新校验类别和必学视频；发布中间态不对学员可见 | 课程行悲观锁 + 同事务 readiness 校验 |
| POST /admin/courses/{id}/lessons/{lessonId}/versions | 同一课时版本号顺序追加，旧行不修改 | 课程/课时行悲观锁 + uk_lesson_version_number |
| POST /ai/generate-questions | 同制度同时仅一个运行中任务 | Redis SETNX；category/difficulty 固定来自请求，source version 固定为发起时制度生效版本 |

### 6.3 传输与敏感信息

- 生产环境经 nginx TLS 终止提供 HTTPS（07 册 4.1）；密码仅在登录/改密报文中出现，存储一律 bcrypt。
- 响应体永不返回 `password_hash`、`answer`、`analysis`（成绩回看除外）、`api_key`（掩码回显，07 册 4.2）。
- `trace_id`：50001 错误响应 `data.trace_id` 供日志排查。
- B3 题库管理预览可读取答案、解析与 rubric，但富文本图片只存 media id 并经 Bearer 鉴权内容接口换取 Blob URL，不暴露私有存储路径或任意外链图片。未来新培训在考 payload 不返回 `answer`、`analysis` 或 rubric；图片答案/阅卷仍由 C3/C4 落地。

---

## 附：与基准文档的一致性对照

| 校验项 | 结果 |
|---|---|
| 当前路由前缀与 README 3.4 模块映射 | 一致（legacy 八大路由保留）；A2—A5、B1 与 B3 增量 `/admin/training-categories`、`/admin/students`、`/admin`、`/me`（含 `/me/home`）、`/media`、`/site-config`、`/admin/courses`、`/me/courses` 及 `/ai` 版本题库端点已由 entity/controller 同步落地；B1 课程菜单/路由与分区未保存接线已完成，B3 final 边界另行验收 |
| 当前表名/字段名（snake_case）与 03 册 | 一致（含 A5 三张公共配置表、`regulation.category_id`、四张课程内容表、`question_concept`、`question_version` 与 question 兼容列）；新增字段以迁移/entity/API 同步为准 |
| 枚举值与 README 3.4 | 一致（角色、各 status 枚举逐字对齐） |
| 心跳/失焦/乱序/超时/切屏行为与 05 册 | 一致（5.4.2/5.4.3/6.4.1~6.4.5 逐条对应） |
| 统计口径与 05 册 7.4.1 | 一致（七项指标逐字对齐） |
| 错误码分段与 README（40xxx/50xxx） | 一致 |
