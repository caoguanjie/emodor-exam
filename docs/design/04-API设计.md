# 04 · API 设计 —— 制度学习及考试系统（EmodorRuleExam）

> **一句话定位**：本文档定义 EmodorRuleExam 的 `/api/v1` 全量 REST 接口契约——统一响应结构、八大模块路由、接口清单与参数、核心接口 JSON 示例、统一错误码表与限流幂等约定，是前后端并行开发的对接契约。
>
> **口径基准**：本文档所有表名、字段名、枚举值、角色值、模块名与 [README.md](README.md) 逐字一致；接口行为与 [05-模块设计.md](05-模块设计.md) 的模块内部设计逐条对应（章节引用形如「05 册 5.4.3 节」）。

> **状态边界（2026-10-21）**：本册 legacy 接口及 A2—A5、B1—B4、C1/C2 均以实际 controller/entity/migration/service 为准。C2 已新增 `/me/exams`、`/me/exams/{id}/start`、`/me/exam-records/{id}`，冻结个人来源、类别、难度、规则、题单与显示映射；旧 `/exams` 固定客户端经适配器继续完成 start→heartbeat/recover→submit/result，但 training 卷不进入旧可考列表。持久草稿、图片答案与统一 finalizer 仍属 C3。源码登记不代表开发库/生产库已升级，后端证据也不替代独立 H5/PC 业务验收。

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
| C2 开考 `POST /me/exams/{id}/start` 与旧固定入口 | `sys_user → exam_assignment → exam_record → 新开时 exam_paper` 数据库锁及唯一键裁决；Redis start 锁不参与正确性。有效 active 返回同一记录，过期 active 返回 40904 等待事务外 sweeper |
| 交卷 `POST /exams/records/{id}/submit` | 三层幂等（05 册 6.4.5）：状态前置校验 + Redis 提交锁 + 事务内终态判定；重复调用返回首次评分结果 |
| 会话开始 `POST /learning/sessions/start` | 单活跃会话约束（后开者胜）：同 user + regulation 已有活跃会话时，旧会话被结束落库并返回新会话（05 册 5.4.1） |
| 学习心跳 | 天然幂等：以服务端时钟差结算，重复/乱序心跳不虚增时长（45 秒封顶，05 册 5.4.2） |
| 视频会话开始 `POST /me/video-sessions` | 短事务持 `sys_user` 行锁做范围/活动重查；旧 reading 在释放事务连接后按原算法收口并最多重试 3 次，最终事务关闭旧 video 后再取新锚点；`active_user_id` 可空唯一索引兜底 |
| 视频心跳 | `seq` 严格递增；重复/乱序返回当前进度，服务端时钟 + 45 秒封顶 + 2 秒位置容差决定可确认区间 |

### 1.6 当前 API 与融合计划的边界

| API 范围 | 文档状态 | 规则 |
|---|---|---|
| `/auth`、`/users`、`/departments`、`/regulations`、`/ai`、`/learning`、旧 `/exams`、旧 `/statistics` | 当前 legacy 契约 | 旧制度阅读资格、旧固定卷字段与自动客观评分保持兼容；下发不含答案/解析，refresh 走 HttpOnly Cookie，DTO/统一信封不变 |
| `/admin/training-categories`、`/admin/students`、`/admin/questions`、`/me`、`/admin`、`/media`、`/site-config`、B1 课程/视频内容版本、B2 视频会话/进度、B3 四题型题库版本与 C1 `/admin/papers` | 当前增量契约（A2—A5/B1—B4/C1） | 新接口使用字符串 ID 与 `Page.items`；B2 课程完成与制度阅读分开；B4 复用 A2 批次归属/幂等语义与 B3 同事务版本写入；C1 只冻结发布规则/候选版本，不冒充 C2 个人题单 |
| 个人题单与原子开考 | 当前增量契约（C2） | `/me/exams*` 使用字符串 ID、本人所有权与不可变快照；在考不下发 answer/analysis/rubric |
| 持久草稿、图片答案/阅卷、监控、培训统计 | 计划契约（C3—C6） | 只有相应 migration/entity/controller 与 API 集成测试存在后才补精确契约 |
| 旧固定卷 vs 新培训考试开考 | 两条口径并存 | 旧固定卷继续检查 `learning_record.is_valid`；新培训考试默认关闭学习门槛，但仍检查发布、类别/来源、权限、次数、身份状态和服务端 deadline |

目标考试链路固定遵循：发布/候选版本快照 → 个人题单快照 → 确认草稿持久化 → 主动或超时幂等终结 → 客观题自动判分/图片题待阅 → 受控逐题评分 → 服务端汇总 → 最终结果只读。C1/C2 已落发布快照、个人归属、每次题单与显示映射；持久草稿、主动提交、图片答案及统一 finalizer 仍由 C3/C4 接续。旧 `/exams` 只为制度固定客户端保留兼容形状，training 记录不能借该入口提交。

---

## 2. 模块与路由总览

当前 legacy 基线与 A2—A5、B1—B4、C1 增量路由均使用同一 `/api/v1` 前缀。下表的数量按当前 controller HTTP 方法装饰器机械盘点：

| 路由前缀 | 所属模块（固定名称） | 接口数 | 说明 |
|---|---|---|---|
| /auth | 1. 组织权限模块 | 6 | 验证码、登录、刷新、个人信息、改密、登出 |
| /users | 1. 组织权限模块 | 8 | 员工 CRUD、重置密码、批量导入、启停 |
| /admin/training-categories | 1. 组织权限模块（A2） | 6 | 培训类别分页、详情、增改、启停、引用保护删除 |
| /admin/students | 1. 组织权限模块（A2/A4） | 11 | 学员分页、CRUD、头像、启停、重置密码、xlsx 模板/预检/批次确认 |
| /admin/questions | 3. AI 出题模块（B4） | 4 | Excel/TXT 同版模板、预检、批次状态与 owner 幂等确认 |
| /me | 1. 组织权限模块（A2/A4）及 4. 学习行为管控模块（B1） | 3 | 本人资料查询/修改；首页组合公开站点配置与本人可见课程分页 |
| /media | 1. 组织权限模块（A4） | 5 | 受控上传、限制查询、状态/Range 读取、引用保护删除 |
| /admin | 1. 组织权限模块（A3/A5） | 24 | A3 权限/角色/管理员/会话 10 个；A5 菜单/字典/站点配置/审计 14 个 |
| /site-config | 1. 组织权限模块（A5） | 2 | 严格公开 Logo/轮播白名单；仅当前配置的品牌图片内容流 |
| /departments | 1. 组织权限模块 | 6 | 部门树、CRUD、层级调整与启停 |
| /regulations | 2. 制度文件管理模块 | 18 | 制度 CRUD、版本/文件读取、管理端预览、范围与学习要求配置、发布、阅读内容及写权限类别选项 |
| /admin/courses | 4. 学习行为管控模块（B1 内容侧） | 14 | 课程、章节、视频课时、不可变内容版本、上架/下架与类别选项 |
| /me/courses | 4. 学习行为管控模块（B1/B2） | 3 | 本人同类别已上架课程分页、目录与当前必学视频完成汇总；external 分母为零 |
| /me/video-sessions | 4. 学习行为管控模块（B2） | 3 | 视频会话开始、递增序号心跳、主动关闭 |
| /me/video-records | 4. 学习行为管控模块（B2） | 1 | 本人不可变视频版本学习记录分页历史 |
| /admin/papers | 3. AI 出题/试卷发布模块（C1） | 15 | 培训固定/随机卷配置、候选、预览、发布快照、复制、撤回与归档 |
| /ai | 3. AI 出题模块 | 27 | AI 配置/任务、B3 类别与考点窄选项、四题型版本审核、人工录入、试卷管理与组卷/复制 |
| /learning | 4. 学习行为管控模块 | 7 | 学习列表、会话生命周期、心跳、进度 |
| /exams | 5. 考试评分模块 | 8 | 可考列表、开考、心跳、切屏、交卷、成绩 |
| /statistics | 6. 统计报表模块 | 6 | 制度/部门/个人维度统计与导出 |
| /health | 基础设施（非业务模块） | 1 | 容器探活，豁免认证，仅限 Compose 内部网络（nginx 不对外代理该路径）；响应 `data` 为 `{ status, mysql, redis, disk_free_mb }` |

**按当前 controller HTTP 方法装饰器机械盘点，合计 178 个接口（177 个业务接口 + 1 个健康检查）。B2 包含视频会话 3 个、课程进度 1 个与本人视频记录 1 个；B4 `/admin/questions` 包含模板、预检、批次状态与确认 4 个；C1 `/admin/papers` 包含 15 个。模板、私有媒体与公开品牌内容流不包统一信封。**

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

`question_version` owner policy 保留上传者与 `questions:read` 的既有读取。具有 `papers:read` 的非上传者只能读取真实 fixed draft、不可变 release，或当前 random draft 经既有 `randomPool/approvedCandidates` 完整规则验证后候选版本中的题干/选项图片；只出现在解析/rubric 的图片还必须具备 `papers:export` 或 `questions:export`。单独 `questions:export` 不构成试卷题图读取权。random 候选桥接仍精确限定类别、可选制度、题型、easy/hard、current approved 与考点容量，允许候选池内未被本次样例抽中的版本，但不落 `paper_question` 或伪造 release。错误类别/制度/难度/状态/current version/题型、无效草稿与无关题库版本均返回 40302；release 历史按其 `snapshot_json` 判断，不替换为当前题目版本。

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
| 26 | POST | /ai/papers/{id}/copy | `papers:write`；按冻结事实复制为新 draft，body 只接受空对象 |
| 27 | POST | /ai/papers/{id}/archive | 归档试卷 |

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

**版本与审核语义**：POST 人工题创建 revision 1 并记录录入管理员的 `approved_by/approved_at`；PUT 编辑或 regenerate 创建新的 pending revision，不覆盖旧版本。`PUT /questions/{id}`、`PUT /questions/{id}/review`、`POST /questions/{id}/regenerate` 的 body 必须显式携带 `expected_version_id`：已版本化题传用户当前看到的十进制字符串 ID，未版本化 legacy 题明确传 `null`；省略或非法值返回 40001。服务在数据库锁内比较 identity 的实际 current_version_id，长时 regenerate 在发起与提交前各校验一次；不一致返回 40940，且不得创建错误 revision 或误审新版本。`POST /ai/questions` 与 `PUT /ai/questions/{id}` 的成功响应在既有兼容 view 外额外返回十进制字符串 `saved_version_id`，它是该请求实际创建的 revision receipt；写后查询得到的 `current_version_id` 可能已被另一并发修订推进，继续编辑本地提交快照时只能把 `saved_version_id` 作为下一次 `expected_version_id`。普通 GET/list view 不返回虚假的 `saved_version_id`。列表可按 `category_id/difficulty/concept_id/type/status/regulation_id/keyword` 筛选；响应同时保留旧 `id/version_id` 兼容字段并提供字符串 `question_id/current_version_id/regulation_version_id`、revision、审核元数据。旧题首次编辑/审核才捕获 revision 1，`legacy_captured_at` 明示升级快照，未知类别/难度/历史确认人/时间均保持 null，不自动补 easy。

**分页与安全显示**：`GET /ai/question-concepts`、`GET /ai/question-concept-options`、`GET /ai/questions/{id}/history` 都返回 `{items,total,page,page_size}`，默认 1/20，page_size 范围 1—100。题目列表、详情、历史与未保存预览在进入 HTML 渲染前统一执行安全白名单；遗留恶意标签、事件、javascript URL 与外链图片只在响应/预览边界移除，不回写历史。受控图片只保留 `data-media-id`，再经鉴权 `/media/{id}/content` 读取。

**扫描 PDF 来源定位**：视觉批次把程序实际调用的 `source_page_group/source_page_start/source_page_end` 写入 revision。单题重生成只渲染该页组；PDF 只有一个页组时可确定为 group 0，多页组 legacy revision 缺少定位时返回明确参数错误，不回退第一页、不依据模型声明伪造来源。

**候选服务边界**：内部 `approvedCandidates({categoryId,regulationIds?,type,difficulty})` 只返回 current revision 且 approved 的不可变快照。C1 `PaperReleaseService` 已消费该快照并冻结 versionId；该候选方法本身仍不创建发布或 C2 个人题单。

**PUT /ai/papers/{id}/questions**：入卷校验——题目 `status = approved`、`question.regulation_id` 与试卷一致、同卷不重复（uk_paper_question 兜底，05 册 4.4.7）。legacy 固定卷的乱序与自动评分当前只支持 single/multiple，因此选题、发布、开考三个边界都拒绝 judgment/image；题目一旦被任一 `paper_question` 引用，类型变更返回 40908。C1 四题型培训卷只经 `/admin/papers` 新链路，不通过放宽 legacy guard 实现。

**制度卷升级发布边界**：升级后从 draft 执行 `POST /ai/papers/{id}/publish` 时，在同一事务内捕获题目的真实当前 approved revision，并把实际 `paper_question.score`、题目内容与策略写入 `paper_release*`。旧题未知 `category/difficulty/approved_by/approved_at` 分别保持 `null/unknown/null/null`，不得伪造 easy 或历史审核事实。此后 list/detail/publish 在原数字 `id` 和原字段之外仅兼容新增 `release_id:string|null`、`rules_locked:boolean`；有 release 时详情读取冻结题目、实际分值和 RuleSnapshot，策略/题单修改返回 40970。真正升级前已 published 且没有 release 的卷继续返回 `release_id=null/rules_locked=false`，保留旧动态策略语义，不补造历史快照。

**复制契约**：`POST /ai/papers/{id}/copy` 使用 `papers:write`，返回原数字 ID 形状的新 draft，且 `release_id=null/rules_locked=false`。有 release 的源卷复制冻结的题目版本、实际分值、规则及学习门槛；无 release 的旧卷复制当前事实。源 release 不变；若复制后题库 current revision 已推进，重新发布返回 40970 并提示重新选题，不静默替换版本。

#### 3.5.1 培训试卷与不可变发布 /admin/papers（C1）

本节与上述 legacy `/ai/papers` 并存，不改写其 ID 类型、分页形状或学习门槛。下表 ID 均为正十进制字符串：

| # | 方法 | 路径 | 权限与语义 |
|---|---|---|---|
| 1 | GET | /admin/papers/category-options | `papers:read`；启用类别 `Page<{id,name}>` |
| 2 | GET | /admin/papers/regulation-options | `papers:read`；必传 category_id，只返回同类别制度 |
| 3 | GET | /admin/papers/course-options | `papers:read`；必传 category_id，课程仅作说明关联 |
| 4 | GET | /admin/papers | `papers:read`；按 keyword/category_id/mode/status 分页，返回 `Page.items` |
| 5 | POST | /admin/papers | `papers:write`；创建 training 草稿，默认 requires_learning=false |
| 6 | GET | /admin/papers/{id} | `papers:read`；配置、固定题单及 latest_release_id |
| 7 | PUT | /admin/papers/{id} | `papers:write`；只允许 draft，发布后返回 40970 |
| 8 | GET | /admin/papers/{id}/candidates | `papers:write`；当前 approved revision，可按 type/difficulty 筛选 |
| 9 | PUT | /admin/papers/{id}/questions | `papers:write`；全量替换固定题单 |
| 10 | GET | /admin/papers/{id}/preview | `papers:read`；不返回 answer/analysis/rubric |
| 11 | GET | /admin/papers/{id}/preview/answers | `papers:read` 且还需 `papers:export` / `questions:read` / `questions:export` 之一；答案版 |
| 12 | POST | /admin/papers/{id}/publish | `papers:publish`；冻结发布版本，返回 `{release_id}` |
| 13 | POST | /admin/papers/{id}/copy | `papers:write`；复制配置/固定题单为新 draft |
| 14 | POST | /admin/papers/{id}/withdraw | `papers:publish`；published → withdrawn，保留快照 |
| 15 | POST | /admin/papers/{id}/archive | `papers:publish`；published/withdrawn → archived，保留快照 |

**创建/修改 DTO**：`title/mode/category_id` 为核心字段；`regulation_ids/course_ids` 是去重字符串 ID 数组；`requires_learning` 可选且默认 false；`pass_score/duration_minutes/max_attempts/partial_credit_ratio` 默认 60/30/3/0.5。随机卷 `rules=[{type,count,score_cents}]` 最多四项且题型唯一，并满足 `Σ(count×score_cents)=10000`；固定题单 `items=[{question_version_id,score_cents}]` 同样合计 10000，但按“题型 + 实际分值”派生的规则允许超过四项（如同题型五档分值）。未知 body/query 字段一律 40001。

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

模板固定十列 `category/type/difficulty/concept/stem/options/answer/analysis/rubric/score`。TXT 仅接受制表符分列，`options/answer` 是 JSON 数组；支持 BOM/CRLF，不支持逗号等多义手工分隔。文件上限 5MB、数据行上限 1000；Excel 公式单元格不执行并落为行级错误，稀疏行中 K 列及其后任何真实非空值或公式同样按超列拒绝。完整填写说明见 [`docs/templates/question-import-format.md`](../templates/question-import-format.md)。

预检逐行复用 B3 四题型、富文本、受控媒体、类别、考点与来源校验。重复指纹覆盖类别、题型、难度、规范化内容与答案；已存在或本批较晚重复行列入 `duplicates`，默认不进入 `valid_rows`。确认事务锁定 owner+batch，调用 B3 的 caller-transaction 写入接口；排序锁定类别后用当前锁定读再次检查数据库指纹，若其他预检批次已先写入则以 40911 明确要求重新预检，不静默缩减本批确认集合。受控媒体查询沿用该调用方事务 manager，然后创建 `source=import` 的 approved identity/revision，并把本次实际 `versionId` 写入审计明细；API 按跨任务契约只返回 `created_ids`。同一行集合重试返回首次结果，换集合返回 40911；questions 入口访问他人或 students 批次返回 40302 且不暴露批次内容，旧 students 确认入口固定只接受 students 批次，不能按批次 kind 分派到题库适配器。提交只有确定的 4xxxx 业务拒绝才允许直接重试或放弃；502/504、传输失败或无法验证的成功信封都保留原 batch 并先 GET 查询，期间不创建新预览。请求回包还绑定不可变 batch ID 与页面代次，离页或新代次后不得覆盖状态或触发导航。

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

本节是旧制度固定卷接口契约：资格链继续包含 `learning_record.is_valid`，40901 继续返回时间缺口与底部段覆盖详情。C2 后所有新开考都先冻结发布快照；真正升级前 published 且无 release 的固定卷在首次新开考时捕获当时题面并标记 `legacy_start`。旧客户端仍收发真实冻结 source `question_id`，服务端入口精确映射到本次 `item_id`，未知 source ID 返回 40001；显示位置只按已持久化映射还原一次。升级前已存在且没有 assignment 的记录继续走原路径。training 记录不复用本节 recover/heartbeat/switch/submit/result，返回 40402。

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

**POST /exams/papers/{id}/start**：资格语义仍是制度 published → 试卷 published → `is_valid = 1` → 次数/已通过检查 → 无并发 active。C2 实际原子顺序为 `sys_user` 写锁（并校验启用）→ `exam_assignment` → 本人该卷全部 `exam_record` → 新开时 `exam_paper`；数据库唯一键是权威并发防线，不依赖旧 Redis start 锁。通过后同事务创建 assignment、`exam_record`、`exam_record_question` 与题干/选项媒体引用；返回旧数字字段时把内部 item ID 映射回真实冻结 source question ID，且**不含 answer 与 analysis**。

**POST /exams/records/{id}/heartbeat**：body 含 `answers[]`（question_id + 呈现位置选择，Redis 暂存，超时自动交卷的评分输入）；响应返回 `remaining_seconds`（`deadline − 服务端当前时刻`，前端每 30 秒校准，不信任本地时钟，05 册 6.4.3）。

**POST /exams/records/{id}/switch**：切屏事件即时上报（不等心跳周期）；服务端 Redis INCR + 1 秒窗口去抖（05 册 6.4.4）；交卷时一次性写回 `exam_record.switch_count`。

**POST /exams/records/{id}/submit**：body 含 `answers[]`；服务端用同 seed 重算乱序映射，把呈现位置还原为题目原始选项下标后落库 `exam_answer` 并评分（05 册 6.4.2 判分语义）；超时自动交卷（定时任务，非 API）走同一评分路径，`status = timeout`、未答题目不得分。

**GET /exams/records/{id}/result**：`status` / `score` / `switch_count` / 逐题明细（stem / selected（已还原原始下标）/ is_correct / gained_score / answer / analysis）——解析仅在交卷后的成绩回看中下发。

### 3.7.1 C2 本人个人题单 /me（权限：本人，字符串 ID）

| # | 方法 | 路径 | 说明 |
|---|---|---|---|
| 1 | GET | /me/exams | 当前类别已发布 training 卷 + 本人已有 assignment 分页列表 |
| 2 | POST | /me/exams/{id}/start | 原子首次开考、补考或有效 active 恢复 |
| 3 | GET | /me/exam-records/{id} | 本人按 record_id 恢复有效在考题单 |

`POST /me/exams/{id}/start` 的首次新开要求账号启用、试卷 published、启用培训类别、用户 category/source 必填且类别与 release 匹配。random 卷按 `institution → easy`、`external → hard` 抽取；fixed 卷按冻结题单得出单一难度或 `mixed`。首次同事务冻结 `release_id/source/category_id/difficulty/rule_snapshot/snapshot_origin`，补考沿用 assignment，不按用户新资料或题库当前内容重算。升级前旧 `exam_record` 同样计入 `max_attempts`，默认总次数 3 次（含首次）。

恢复顺序刻意早于试卷状态和用户当前 category/source 检查：有效 active 即使试卷已撤回也返回同一 record、deadline、题序和选项序；账号停用仍拒绝。服务端 `deadline_at` 已过时返回 40904，不在持有用户锁的 start 事务内嵌套终结；30 秒 timeout sweeper 在事务外读取冻结规则/题单完成客观收口并清空 `active_assignment_id`。收口后再开按冻结最大次数裁决。

成功响应 `AttemptView` 固定含 `record_id/paper_id/release_id/source/category_id/difficulty/deadline_at/server_now/draft_revision/questions/answers`。`questions[]` 只含 `item_id/type/stem/options/score`，`item_id` 是新答题主键；在考响应任何层级都不得出现 `answer/analysis/rubric`。C2 的 `answers` 仅兼容旧 Redis 暂存且 `draft_revision=0`；持久确认稿、图片附件与主动 training finalizer 属 C3，当前 training 记录调用旧 `/exams/records/*` 执行入口返回 40402。

个人题图使用 `media_reference(owner_type=exam_record_question, owner_id=item_id)`，与题单创建同事务绑定。本人只可读取精确出现在该 item 冻结 `stem/options[].text` 的 `purpose=question` 资源；answer/analysis/rubric 图片不绑定、不授权，也不授予任何题库管理权限。

### 3.7.2 C5 管理端考试记录与只读监控

记录读取和监控使用两个独立权限，均由实际 API 守卫校验：`exam_records:read` 允许记录列表及安全元数据详情，`exam_records:monitor` 允许试卷选择与监控轮询；两者不复用 `papers:review`，也不互相隐式授权。

| 方法 | 路径 | 权限 | 请求与成功 data |
|---|---|---|---|
| GET | `/admin/exam-records` | `exam_records:read` | query `page/page_size/keyword/paper_id/source/difficulty/status/grading_state`；返回分页记录摘要 |
| GET | `/admin/exam-records/{id}` | `exam_records:read` | 返回该记录的安全元数据、服务端确认进度、剩余时间与连接提示；不返回题目答案、解析、rubric 或答题附件 ID |
| GET | `/admin/exams/monitor-options` | `exam_records:monitor` | query `page/page_size/keyword`；返回监控选择所需的窄试卷选项，不要求试卷维护权限 |
| GET | `/admin/exams/{id}/monitor` | `exam_records:monitor` | query `page/page_size`；返回该试卷的 `Page<MonitorRow>` |

`MonitorRow` 精确字段为 `record_id/user_id/name/source/difficulty/started_at/deadline_at/server_now/remaining_seconds/answered_count/total_count/last_heartbeat_at/connection_state/switch_count/device_summary/status/grading_state/submission_method`。`source/difficulty` 只读本条 `exam_record` 冻结值，不回看用户当前资料；未知 `submission_method` 返回 null，不猜测主动或超时。`answered_count` 只统计服务端已确认且持久化的非空草稿答案；`remaining_seconds=max(0,floor((deadline_at-server_now)/1000))`。

进行中记录的 `last_heartbeat_at` 为空或距 `server_now` **超过** 90 秒时 `connection_state=uncertain`，恰好 90 秒仍为 `connected`；终态为 `ended`。连接待确认只作提示，不触发作弊判断、扣分或交卷。PC `/admin/exam-monitor` 每 5 秒轮询；自动 tick 遇到仍在途的上一请求时跳过，换卷/手动刷新才取消旧请求并以请求代次拒绝迟到响应，离页同时清理请求和定时器。试卷选择使用服务端关键字和 1—100 分页，可继续加载后续页并保留当前选择；选项失败与监控数据失败分别重试。强制交卷不在本期，也不放置可点击占位。

`GET /admin/exam-records/{id}/result` 由 C4 统一历史/阅卷 reader 负责，C5 不复制评分或结果投影。普通 `exam_records:read` 不自动取得答题图片；图片仍只允许本人或 C4 的阅卷权限精确读取。

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
| 40001 | 400 | 参数错误 | 请求体/查询参数校验失败；旧固定客户端提交的 source question_id 不属于本人本次冻结题单也返回此码 |
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
| 40402 | 404 | 制度内容不可见 | 阅读内容不可见；training 卷调用旧 `/exams` 开考/记录执行入口也返回此码 |
| 40901 | 409 | 未完成有效学习，暂无考试资格 | **legacy 制度固定卷**开考校验③失败；data 附差距（时间缺口/底部段未覆盖）。新培训考试默认不使用该错误作为学习门槛 |
| 40902 | 409 | 补考次数已用尽 | 开考校验④失败（attempt_no > max_attempts） |
| 40903 | 409 | 已通过该考试，无需再次作答 | 开考校验④：前次终态 = passed |
| 40904 | 409 | 已有进行中的考试 | active 尚有效时幂等恢复；active 已过 deadline 时提示等待 timeout sweeper，不能绕过计次创建新记录 |
| 40905 | 409 | 交卷失败：考试已结束 | 交卷时记录已终态（重复交卷幂等场景直接返回首次结果，此码用于状态冲突） |
| 40906 | 409 | 学习会话冲突 | 心跳/暂停到达时会话已被新会话取代或已收口（单活跃约束；已收口语义为「会话已结束，请重新开始学习」，前端应刷新 session_id） |
| 40907 | 409 | 题目组成不可变更 | 修改已发布试卷的 paper_question |
| 40908 | 409 | 题目正在考试中使用，禁止编辑 | 题目被 in_progress 考试记录引用时修改 stem/options/answer/type（仅允许 analysis，05 册 4.4.6） |
| 40909 | 409 | AI 服务未配置或配置不完整 | 未配置 base_url/api_key/model 即发起出题或连通性测试（FR-AIQ-01 验收③） |
| 40910 | 409 | 培训类别不存在或已停用 | 学员/课程/制度/题库/试卷写入引用不存在或已停用类别；删除仍被 `exam_paper` 或 `paper_release` 等任一事实引用的类别 |
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
| /admin/questions | — | — | questions:write | B4 模板、预检、状态和确认均使用同一写权限；owner/kind 由服务端收口 |
| /me | — | GET/PATCH 本人资料；GET `/me/home` 按本人身份返回公开配置与可见课程 | — | 同左 |
| /me/courses | — | 同类别已上架课程分页/详情；external 默认空 | — | 同左（仍按本人类别收口） |
| /media | — | 本人头像上传/所有权范围读取 | 非头像上传需 `media:write` | 同左 |
| /admin 权限/会话 | — | — | 按 `roles/administrators/sessions:*` | 按各接口注册权限 |
| /admin 系统配置 | — | — | `system_settings:read/write` | 同左；导航树为登录用户自身权限视图 |
| /site-config | 配置两键与当前品牌内容 | 同左 | 同左 | 同左；不提供任意 media id 公开读取 |
| /departments | tree（登录） | — | — | 其余 5 个 |
| /regulations | — | content | 类别选项需 regulations:write；其余管理路由按 regulations:read/write/publish | 同左 |
| /admin/courses | — | — | 由业务角色显式授予 courses:read/write/publish | super_admin 天然拥有；类别 options 只需 courses:write |
| /admin/papers | — | — | `papers:read/write/publish/export`；答案版需额外导出或题库读权限 | super_admin 天然拥有；学员来源不参与管理权限判定 |
| /ai | — | — | 按细权限开放 | 27 个端点逐项使用 `ai:*`、`ai_config:*`、`questions:*`、`papers:*`；人工录题 writer 可通过 `question-category-options` / `question-concept-options` 取类别/考点，不要求 questions:read；不把全局权限守卫改成 OR |
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
| POST /me/video-sessions/{id}/heartbeat | 客户端默认 30 秒；序号必须递增，单次最多确认 45 秒 | DB session→record 行锁；重放/乱序返回当前进度，暂停/缓冲/后台零累计，跳播不写覆盖 |
| POST /exams/records/{id}/heartbeat | 30 秒节拍窗口限流 | 作答暂存幂等（覆盖写） |
| POST /exams/records/{id}/switch | 1 秒去抖窗口 | Redis INCR + 窗口合并（前端 500ms 事件合并后上报，服务端 1 秒二次去抖，05 册 6.4.4） |
| POST /exams/records/{id}/submit | 幂等：重复交卷返回首次结果 | 三层幂等（05 册 6.4.5） |
| POST /regulations/{id}/versions | 并发上传同一制度串行化（版本号唯一） | 事务 + uk_regulation_version |
| POST /admin/courses/{id}/publish | 上架与下架后重上架均重新校验类别和必学视频；发布中间态不对学员可见 | 课程行悲观锁 + 同事务 readiness 校验 |
| POST /admin/courses/{id}/lessons/{lessonId}/versions | 同一课时版本号顺序追加，旧行不修改 | 课程/课时行悲观锁 + uk_lesson_version_number |
| POST /ai/generate-questions | 同制度同时仅一个运行中任务 | Redis SETNX；category/difficulty 固定来自请求，source version 固定为发起时制度生效版本 |
| POST /admin/papers/{id}/publish | 重复发布已 published 卷返回现有 release_id；并发发布只生成一个版次 | 先锁培训类别、再写锁 exam_paper；uk_paper_release_version 兜底 |
| POST /admin/papers/{id}/withdraw/archive | 状态转移串行；只阻新开考且不删 release | exam_paper 行写锁；C2 开考将消费同一行锁 |

### 6.3 传输与敏感信息

- 生产环境经 nginx TLS 终止提供 HTTPS（07 册 4.1）；密码仅在登录/改密报文中出现，存储一律 bcrypt。
- 响应体永不返回 `password_hash`或明文 `api_key`。在考 payload 及 C1 普通预览不返回 `answer/analysis/rubric`；C1 答案版是单独授权的管理接口，不与学员下发契约共用。
- `trace_id`：50001 错误响应 `data.trace_id` 供日志排查。
- B3 题库管理预览可读取答案、解析与 rubric，但富文本图片只存 media id 并经 Bearer 鉴权内容接口换取 Blob URL，不暴露私有存储路径或任意外链图片。未来新培训在考 payload 不返回 `answer`、`analysis` 或 rubric；图片答案/阅卷仍由 C3/C4 落地。

---

## 附：与基准文档的一致性对照

| 校验项 | 结果 |
|---|---|
| 当前路由前缀与 README 3.4 模块映射 | 一致（legacy 八大路由保留）；B2 新增 `/me/video-sessions`、本人 `/me/video-records` 与课程 progress，B4 新增 `/admin/questions`，C1 新增 `/admin/papers`，C2 新增 `/me/exams*`，均不冒充独立 H5 或 C3 主动提交/持久草稿 |
| 当前表名/字段名（snake_case）与 03 册 | 一致（含两张视频学习表、两张版本题库表、C1 `exam_paper/paper_question` 兼容列、`paper_release/paper_release_question` 与 HTTP 层 snake_case 预览规则）；B4 不新增表 |
| 枚举值与 README 3.4 | 一致（角色、各 status 枚举逐字对齐） |
| 心跳/失焦/乱序/超时/切屏行为与 05 册 | 一致（5.4.2/5.4.3/6.4.1~6.4.5 逐条对应） |
| 统计口径与 05 册 7.4.1 | 一致（七项指标逐字对齐） |
| 错误码分段与 README（40xxx/50xxx） | 一致 |
