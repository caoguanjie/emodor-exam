# 培训机构基础与后台治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付安全测试基础、学员类别与来源管理、细粒度权限、受控媒体和后台公共功能。

**Architecture:** 扩展现有 users/auth/guards，保留原角色与员工登录兼容入口。统一上传、权限和导入批次供课程及考试复用；不另建身份系统。

**Tech Stack:** 现有 NestJS / TypeORM / MySQL / Redis、Vue 3 / Element Plus、ExcelJS、Node 测试、Vitest；视频元数据调用 ffprobe。

**Spec:** [已批准设计](../specs/2026-10-21-training-admin-integration-design.md) §4—5、§10；共同接口与依赖见[总计划](2026-10-21-training-admin-integration.md)。

## Global Constraints

- 总计划 Global Constraints 全部适用；只改单家机构 PC 与后端，不做 H5 或旧站迁移。
- 学员来源 `institution/external` 与权限角色独立；旧用户未知值保留 null。
- 原 JWT/HttpOnly Cookie/密码策略/吊销和统一信封继续生效，权限按钮与 API 使用同一 code。
- 敏感值不写入文档、日志、测试夹具；测试库名必须符合 `^ruleexam_test_[a-z0-9_]+$`。
- 每项建表同时同步设计、init.sql、增量升级和实体；共同文件由根集成。

## Review Focus

1. 启动器默认库、初始化 SQL 的 CREATE/USE 与应用连接不一致：操作前整体拒绝（A1）。
2. 重复确认导入、部分行错误和来源缺失：批次幂等，非法行绝不默认初级（A2）。
3. 管理员换入口绕过验证码、撤权后旧 token 继续访问：服务端识别角色并即时拒绝（A3）。
4. 假扩展名、任意路径、跨用户附件及被引用资源删除：验证真实内容、授权和引用（A4）。
5. 菜单成环、配置注入、公开配置泄密、未保存表单关页：明确拦截且保留用户输入（A5）。

---

### Task A1: 对齐基准、契约与安全测试入口

**Files:** Modify `AGENTS.md`、`README.md`、`docs/design/README.md`、`docs/design/01-需求分析.md`、`02-系统架构.md`、`03-数据库设计.md`、`04-API设计.md`、`05-模块设计.md`、`06-关键流程.md`、`07-安全与非功能设计.md`（后三组均在 `docs/design/`）；`tests/run-e2e.mjs`、`server/src/common/redis.service.ts`、`server/src/config/configuration.ts`、`deploy/.env.example`。Create `database/migrate.mjs`、`database/migrations/000_migration_registry.sql`、`tests/support/test-target.mjs`、`tests/support/training-harness.mjs`、`tests/test-target.test.mjs`、`tests/migration-contract.test.mjs`、`server/src/common/training-contracts.ts`、`web/src/api/training-types.ts`。Test 后两份 `.test.mjs`；Modify `database/init.sql` 同步 registry。

**Interfaces:** Consumes 已批准设计与现有 SQL。Produces `validateTestTarget({database,sql}): {database,sql}`、`renderSchemaForDatabase(sql,database): string`、总计划 §2.1 类型与 §3 测试上下文；`migrate.mjs --check|--apply`、`run-e2e.mjs --suite smoke|all|<registered-name>`。新增 `REDIS_KEY_PREFIX`，默认空以兼容现状，测试用每次运行独立前缀。

- [x] **Step 1: 写隔离及升级契约测试。** `test-target.test.mjs` 使用 Node `assert`，有效 SQL 为真实 init.sql；`migration-contract` 建旧结构样例并检查保留数据、进行中记录阻断、失败续跑、校验和冲突以及初始化/升级后 INFORMATION_SCHEMA 一致。
  ```js
  assert.throws(() => validateTestTarget({ database: 'ruleexam', sql }));
  const target = validateTestTarget({ database: 'ruleexam_test_training', sql });
  assert.match(target.sql, /USE `ruleexam_test_training`/);
  assert.doesNotMatch(target.sql, /USE `ruleexam`/);
  assert.throws(() => validateTestTarget({ database: 'ruleexam_test_training', sql: sql + '\nUSE `other_db`;' }));
  ```
- [x] **Step 2: 红灯。** `node --test tests/test-target.test.mjs`，预期缺少保护模块/断言失败；此步不得启动旧的删库脚本。
- [x] **Step 3: 先修文档并定义共同类型。** 去除固定 12 表限制；明确受控图片阅卷不等于改最终总分、新培训考试不强制阅读、双端仍延期。将总计划字段/状态/API 命名纳入 03—06 册，旧业务盘点文档保持证据性质；不扩展设计默认业务范围。
- [x] **Step 4: 实现保护器、升级器与测试上下文。** 只改 SQL 中已识别的 CREATE DATABASE/USE，发现额外库切换即拒绝；种子和 API 共用验证后的目标。测试存储/日志/AI 配置用 `mkdtemp` 独立目录，Redis 前缀隔离（含 Lua/扫描）；禁止 FLUSHDB。支持 API 重启且保留同一测试数据、密钥与上传目录。suite 名称白名单映射独立文件，不能拼任意命令。schema 升级元数据检查与可续跑规则按总计划 §2.2。
- [x] **Step 5: 绿灯。** `node --test tests/test-target.test.mjs`；隔离确认后 `DB_DATABASE=ruleexam_test_training node --test tests/migration-contract.test.mjs` 和 `DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite smoke`。预期全部通过，开发库及其存储未被访问/修改；另运行 `cd server && npm run build && npm test`。应用 API 基线已有失败则记录并解决本任务造成的失败，不吞掉失败继续。
- [x] **Step 6: 本地提交。** 审核 A1 明确文件/改动块后 `git commit -m "test: isolate training integration database and define contracts"`。

**A1 验收记录（2026-10-21）：** 最终代码候选 `2e53d56` 的基础组合测试 39/39 通过，旧 smoke 94/94、server 26 项与构建、web 类型检查与构建通过；独立审查遗留项均关闭。未提供外部 DB_PASSWORD，实际数据库测试使用运行期随机口令的 `--ephemeral` 自有 MySQL/Redis，不读取 `.env` 或连接开发库。范围及证据见 [A1 基础验收](../../../review/2026-10-21-training-a1-foundation.md)。A2 以后仍待实施。

### Task A2: 类别、学员来源与可恢复导入

**Files:** Modify `server/src/entities/sys-user.entity.ts`、`server/src/modules/users/users.service.ts`、`users.controller.ts`（同目录）、`web/src/views/admin/Users.vue`。Reuse `server/src/modules/users/user-import.service.ts` unchanged for legacy six-column partial-success import; new preview/confirm uses the new batch service. Create `server/src/modules/training/category.service.ts`、`category.controller.ts`（同目录）、`server/src/modules/imports/import-batch.service.ts`、`web/src/views/admin/TrainingCategories.vue`、`web/src/components/ImportPreview.vue`；`001_training_identity.sql` 与总计划对应实体。Test `server/test/training-identity.spec.ts`、`tests/training-identity.mjs`。

**Interfaces:** Consumes A1 `Id/LearnerSource/ImportPreview/ImportResult`。Produces `CategoryService.assertActive(id:Id):Promise<void>`、`UsersService.trainingProfile(userId:Id):Promise<{categoryId:Id|null;source:LearnerSource|null;active:boolean}>`；`ImportBatchService.preview(ownerId:Id,kind:'students'|'questions',rows:unknown[]):Promise<ImportPreview>`、`commit(ownerId:Id,batchId:Id,rowNumbers:number[]):Promise<ImportResult>`，解析/行校验由所属业务注入，不让通用服务依赖 AI。

- [ ] **Step 1: 写类别/来源/导入测试。** suite 注册名 `training-identity`。夹具在本文件创建旧用户、两类新用户、有效/非法/重名行，调用 API 收集下列结果。
  ```js
  assert.equal(legacy.data.source, null);
  assert.equal(missingSource.status, 400);
  assert.deepEqual(preview.data.valid_rows, [2, 4]);
  assert.equal(preview.data.errors[0].row, 3);
  assert.deepEqual(retry.data.created_ids, first.data.created_ids);
  assert.equal(deleteReferencedCategory.status, 409);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/training-identity.spec.ts`；预期 trainingProfile/批次契约不存在或来源校验失败。
- [ ] **Step 3: 实现身份 CRUD 和批次事务。** `/admin/training-categories` 与 `/admin/students` 查询/新增/更新/停用/重置密码；原 `/admin/users` 保留。新增学员 category/source 必填；模板列与预检查一致；表单支持来源、类别筛选及整批默认值。批次以 owner+id 校验，确认时固定所选合法行，重试同批返回原结果，换行集合冲突返回 409；题库导入 B4 复用此事实。保留密码校验/停用吊销，不回显口令；类别被引用不能硬删除。
- [ ] **Step 4: 接通 PC 和本人资料契约。** Users 页面支持学员 CRUD、模板下载、预览确认/失败行重导；增加 `/me/profile` GET/PATCH，只允许姓名、联系方式、A4 之后的头像 ID；提交 source/category/role 返回 400，不静默接受。头像待 A4 接入，不阻断本任务非媒体 CRUD。分页空态、失败恢复与表单校验均落地。
- [ ] **Step 5: 绿灯。** 同单测命令及 `DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-identity`；`cd web && npx vue-tsc --noEmit && npm run build`。PC 验收：新建两类学员、来源筛选、错误行预览、重复确认、禁用后旧 token 被拒。记录结果。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: manage training categories and learner provenance"`，仅暂存 A2 明确文件/共享集成块。

### Task A3: 验证码、会话与可配置管理权限

**Files:** Modify `server/src/modules/auth/auth.service.ts`、`auth.controller.ts`、`server/src/common/guards/jwt-auth.guard.ts`、`roles.guard.ts`、`server/src/common/redis.service.ts`、`server/src/entities/sys-user.entity.ts`、`server/src/seed.ts`、`database/seed.mjs`、`web/src/views/Login.vue`、`web/src/stores/auth.ts`。Create `server/src/modules/auth/captcha.service.ts`、`session.service.ts`、`server/src/modules/access/access.service.ts`、`access.controller.ts`、`permission-catalog.ts`、`server/src/common/guards/permissions.guard.ts`、`server/src/common/decorators/permissions.decorator.ts`、`web/src/views/admin/Administrators.vue`、`Roles.vue`、`OnlineSessions.vue`（同页面目录）；`002_access.sql` 及实体。Test `server/test/access.spec.ts`、`tests/training-access.mjs`。

**Interfaces:** Consumes A1、现有 AuthUser/Redis 吊销。Produces `AccessService.assertAllowed(userId:Id,code:string):Promise<void>`、`permissions(userId:Id):Promise<string[]>`、`SessionService.revoke(sessionId:Id,actorId:Id):Promise<void>`；新增 `/auth/captcha`，沿用 `/auth/login|refresh|profile|password|logout`；`/admin/roles`、`/admin/administrators`、`/admin/sessions`。权限目录是服务端注册的 `<resource>:read|write|publish|review|export` 白名单，不允许配置任意代码授予新能力。

- [ ] **Step 1: 写越权/吊销测试。** suite `training-access`；用临时管理员、学员和受限管理员，测试正常与伪造入口、同秒吊销、refresh 轮换与重复使用。
  ```js
  assert.equal(adminWithoutCaptcha.status, 400);
  assert.equal(employeeLegacyLogin.status, 200);
  assert.equal(oldTokenAfterRoleRemoval.status, 403);
  assert.equal(oldTokenAfterKick.status, 401);
  assert.equal(employeeWithInstitutionSource.status, 403);
  assert.equal(removeLastSuperAdmin.status, 409);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/access.spec.ts`，预期权限服务缺失/撤权未被检查。
- [ ] **Step 3: 实现权限与登录兼容。** 登录由服务端识别管理员账号，所有入口均校验其验证码，不信客户端 platform；员工旧登录不额外强制验证码。验证码一次消费、120 秒过期、刷新废弃前个，登录与发码限流；测试可从隔离 Redis 读取夹具答案，生产绝不提供绕过端点。业务角色多选、系统角色身份保留；权限 guard 与旧 RolesGuard 协调，不因旧枚举拦住已授权新管理员，也不放宽员工访问。权限变更立即失效缓存；最高管理员不可删除/停用/清空其保护权限。
- [ ] **Step 4: 实现会话与 PC 权限页。** JWT 增加 sid，access/refresh 绑定同会话；强制下线与停用对该会话/用户立即生效，同秒令牌也不能漏过。旧无 sid 令牌继续原到期/封禁规则，用户级吊销必须覆盖它。PC 登录密码遮蔽、验证码刷新，管理员/角色权限树/在线会话页面联动真实 API；登录次数/IP、最后登录成功时间写入，不记失败为成功。公开资料不返 hash、验证码或密钥。
- [ ] **Step 5: 绿灯。** 同单测；`DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-access`；前端类型/构建。PC 用两个独立登录会话验证受限菜单/按钮、直调 API 拒绝、撤权立即生效、强制下线、取消操作不写入。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: add configurable admin permissions and session controls"`。

### Task A4: 统一受控媒体与上传组件

**Dependencies:** A2 与 A3 的接口已集成并验证后进入 A4；A2/A4 共用的 `users.controller.ts`、`Users.vue` 由根统一集成，不由两个 worker 同时编辑。所有任务的集成构建、DB e2e 与 GUI 默认进入总计划规定的串行验证队列，不把本文相同测试库命令直接并发执行。

**Files:** Create `server/src/modules/media/media.service.ts`、`media.controller.ts`、`media-probe.service.ts`、`media-policy.ts`、`web/src/components/MediaUpload.vue`；`003_media.sql` 与实体；Test `server/test/media-policy.spec.ts`、`tests/training-media.mjs`。Modify `server/src/config/configuration.ts`、`deploy/.env.example`、`deploy/nginx/default.conf`、`server/src/modules/users/users.controller.ts`、`web/src/views/admin/Users.vue`。

**Interfaces:** Consumes A3 权限、A2 本人资料。Produces `MediaService.upload(actorId:Id,purpose:'avatar'|'course_cover'|'video'|'question'|'answer'|'branding',file:Express.Multer.File,ownerId?:Id):Promise<{assetId:Id;status:'processing'|'ready'|'failed';durationMs:number|null}>`、`assertUsable(actorId:Id,assetId:Id,purpose:string,ownerId?:Id):Promise<void>`、`bind(tx:EntityManager,assetId:Id,ownerType:string,ownerId:Id):Promise<void>`；`GET /media/:id/content` 受控流式读取/Range，`GET /media/limits` 返回非敏感限制；答案上传特定路由由 C3 包装，不开放通用 purpose=answer 绕过截止检查。HTTP 返回将 assetId/durationMs 转为 asset_id/duration_ms；未就绪媒体由 `GET /media/:id` 查状态。

- [ ] **Step 1: 写媒体边界测试。** 测试文件生成最小合法 MP4、PNG 夹具，并创建其他用户附件及被引用视频。
  ```js
  assert.equal(fakeMp4.status, 400);
  assert.equal(otherUsersAnswer.status, 403);
  assert.equal(deleteReferenced.status, 409);
  assert.equal(videoRange.status, 206);
  assert.equal(video.data.duration_ms > 0, true);
  assert.equal(await countAnswerReferences(uploadedOnly.data.asset_id), 0);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/media-policy.spec.ts`，预期缺少媒体策略/授权实现。
- [ ] **Step 3: 实现媒体状态、保护读取和元数据。** 本地服务端生成 storage key，不接受客户端路径；图片 JPEG/PNG/WebP 按内容验证且不接收 SVG；视频 ffprobe 无 shell 调用并设置超时，只接 MP4 H.264/AAC。状态就绪前不可被发布引用；媒体层按 owner_type 注册授权检查器，未注册的业务类型默认拒绝学员读取，B1 接课程可见性、C3/C4 接答案归属/阅卷权限，避免媒体层反向导入所有业务服务。品牌展示仅公开白名单资源。未知资源和越权都不能泄露文件路径；孤儿文件按延迟清理任务处理，已引用文件不得回收。
- [ ] **Step 4: 配置与 PC 上传接入。** 新增 `MEDIA_VIDEO_MAX_BYTES`、`MEDIA_IMAGE_MAX_BYTES`、`FFPROBE_PATH`、`MEDIA_PROBE_TIMEOUT_MS`，精确默认值在部署说明和 limits 响应同步；视频默认 512 MiB、图片默认 10 MiB、探测超时 30 秒。nginx 请求上限含 multipart 余量 1 MiB；修改限额时三端同改并有启动/部署检查。MediaUpload 展示大小/类型限制、上传进度、处理中、错误重试；接通本人/学员头像，禁用用户不能上传。
- [ ] **Step 5: 绿灯。** 单测及 `DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-media`；前端类型/构建。PC 验证真实视频探测、假格式、超限、断网重试、头像修改。无 ffprobe 时明确部署缺失，不记视频处理通过。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: add protected media storage and validated uploads"`。

### Task A5: 菜单字典、网站配置、审计与后台公共框架

**Files:** Create `server/src/modules/system/system.service.ts`、`system.controller.ts`、`audit-query.service.ts`、`web/src/views/admin/Menus.vue`、`Dictionaries.vue`、`SiteSettings.vue`、`AuditLogs.vue`（同页面目录）、`web/src/stores/tabs.ts`、`web/src/composables/useUnsavedChanges.ts`、`web/src/views/NotFound.vue`；`004_system.sql` 与实体；Test `server/test/system-config.spec.ts`、`tests/training-system.mjs`。Modify `server/src/common/audit.service.ts`、`web/src/layouts/MainLayout.vue`、`web/src/router/index.ts`、`web/src/api/http.ts`。

**Interfaces:** Consumes A3 权限目录和 A4 媒体。Produces `/admin/menus|dictionaries|site-settings|audit-logs`、`GET /site-config -> {logo_asset_id:Id|null,banners:{asset_id:Id;sort:number}[]}`；`SystemService.publicConfig()` 只返回此白名单；`useUnsavedChanges(dirty:Ref<boolean>)` 为路由离开/标签关闭共用确认。

- [ ] **Step 1: 写配置/菜单安全测试。** suite `training-system` 定义目录/菜单/按钮树及配置夹具；非法更新后重新 GET 核对原值未变。
  ```js
  assert.equal(menuCycle.status, 400);
  assert.equal(arbitraryScriptRoute.status, 400);
  assert.equal(referencedDictionaryDelete.status, 409);
  assert.deepEqual(Object.keys(publicConfig.data).sort(), ['banners', 'logo_asset_id']);
  assert.equal(JSON.stringify(auditLog.data).includes(testPassword), false);
  ```
- [ ] **Step 2: 红灯。** `cd server && npm test -- test/system-config.spec.ts`，预期服务或公开配置白名单不存在。
- [ ] **Step 3: 实现配置与审计查询。** 菜单配置只映射前端已注册路由/权限，不执行动态脚本/任意组件；校验父链、子项/角色引用保护。字典 type/code 唯一，业务固定枚举只读，不能借字典改变来源映射/题型/状态。Logo/轮播复用 A4，轮播最多 3 张。查询现有审计文件按日期、操作人、动作分页，限定日志目录并过滤敏感值；不增加“一键清空审计”入口。登录、改密、权限、删除、发布/撤回、下线、导入/导出均留痕，失败与降级可诊断。
- [ ] **Step 4: 实现 PC 壳和配置页。** 按权限渲染导航；业务标签切换保留查询、关闭/刷新确认未保存内容；未知路由 404/返回首页。列表分页/空态/重试、风险操作确认统一接入 A2—A5 页面；本人资料、退出/改密沿用已有流程。首页指标组件等待 C6 数据，不用虚假数字占位冒充完成。
- [ ] **Step 5: 绿灯。** 单测及 `DB_DATABASE=ruleexam_test_training node tests/run-e2e.mjs --suite training-system`；前端类型/构建。PC 验收菜单保存刷新、字典引用拒删、Logo/轮播公开展示、审计筛选、未保存取消离页/确认离页两路径，记载真实结果。
- [ ] **Step 6: 本地提交。** `git commit -m "feat: add admin shell and institution system settings"`。
