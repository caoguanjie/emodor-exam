# Course Management Dialogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按用户 2026-10-23 的截图要求补齐课程列表，并以课程资料、章节管理两个弹窗替代独立详情页。

**Architecture:** 复用现有课程编辑状态与 API，将 CourseDetail 改为按 courseId 和 mode 驱动的 CourseEditor 弹窗内容组件。Courses 承载新建、修改、章节入口及列表刷新；封面仍经鉴权接口读取。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Vitest、现有 Node 组件回归。

**Spec:** 本轮用户截图与指令；`docs/design/04-API设计.md` 3.9、`docs/design/05-模块设计.md` 5.4.7。

## Global Constraints

- 表单：课程名称、课程封面、培训类别、课程简介、首页推荐、排序；保留原数字步进排序控件，仅列表不显示排序。
- 课程封面使用 Element Plus picture-card 并支持放大；按用户最后澄清，课时视频在修改弹窗内使用 Element Plus drag 上传，取消独立替换视频弹窗。保留现有格式/大小校验、进度、ready 绑定和失败重试。
- 列表：课程名称、封面、培训类别、必学课时、首页推荐、状态、创建时间、操作。
- 修改课程、章节管理分开弹窗；取消独立课程详情页，旧链接回到列表。
- 不改变发布校验、权限、视频上传、版本和学习规则；不读凭据，不操作真实业务数据。
- 保留工作区并发改动；本轮不自动提交。

## Review Focus

- 只有 write 权限的账号创建后不能读取课程详情。
- 保存失败或保存期间继续输入时不能清掉新草稿。
- 关闭编辑器必须保护嵌套章节、课时、视频未保存内容。
- 封面切换、加载失败、组件销毁不能串图或泄漏对象 URL。
- 旧详情链接不得再打开独立页面，创建后不得路由跳转。

### Task 1: 列表与资料表单

**Files:** `web/src/views/admin/Courses.vue`、`web/src/components/CourseCover.vue`、`web/src/components/__tests__/course-presentation.spec.ts`

**Interfaces:** CourseCover 接收 `assetId?: string|null`、`alt?: string`；使用 `getMediaImageContent(assetId): Promise<Blob>`。

- [x] 写并运行列表、表单顺序测试，已观察原实现 3 项预期失败。
- [x] 补齐列表字段、鉴权封面预览、是/否推荐；按用户后续澄清保留表单排序、仅移除列表排序。
- [x] 运行组件回归，验证空封面、失败、换图和销毁。

### Task 2: 替换详情页

**Files:** `web/src/views/admin/CourseDetail.vue` → `CourseEditor.vue`、`Courses.vue`、`web/src/router/index.ts`、`web/tests/course-detail-state.test.mjs`

**Interfaces:** CourseEditor 接收 `{courseId:string,mode:'info'|'chapters'}`；发出 `saved/changed`；暴露 `confirmClose():Promise<boolean>`、`saveCourse():Promise<void>`、`saving/ready`，由父弹窗的公共 footer 承载按钮。

- [x] 写并运行两个独立弹窗、创建后留在列表的失败测试。
- [x] 复用各区段持久化基线和请求上下文保护；资料保存不覆盖章节，章节刷新不重置草稿。
- [x] 父弹窗关闭前确认子组件未保存状态；成功写入刷新列表。
- [x] 旧详情路由改为列表重定向，更新受影响的现有回归断言。

### Task 3: 一致性与验收

**Files:** `docs/design/04-API设计.md`、`docs/design/05-模块设计.md`

- [x] 同步 PC 页面结构说明；此初始 UI 阶段未改 API、实体和数据库，后续真实删除需求按 Task 4 追加契约与结构。
- [x] 运行 `npm --prefix web test`、课程与媒体 Node 回归、`vue-tsc --noEmit`，原子构建 PC。
- [x] 独立审查本轮明确文件，保留并报告未验边界。

## Execution Notes

- 用户已明确要求直接改造，不再为执行方式或截图已说明的选择重复提问。
- 当前目录有其他任务的按钮统一改动；沿用 FitsTableActions，不覆盖它们。
- 后续澄清：用户指出排序缺失，并要求封面和视频采用饿了么图片卡片。增加 `MediaUpload.listType='picture-card'` 可选外观，其他入口保持默认外观。
- 后续澄清：新建、修改、章节管理统一公共 footer；章节改为平铺分区和课时卡片，融入现有必学、顺序、视频状态、时长、版本和操作字段。不照搬无接口支持的独立课件、课时创建时间或删除入口。
- 独立审查发现并修复：失败刷新重试保留新输入、无 dirty 时 pending 写入仍阻断离开、KeepAlive 失活销毁嵌套弹窗、课时资料部分成功也刷新列表。新增回归先观察失败，再验证修复。
- 用户后续要求覆盖此前卡片布局：章节内采用按列列表，行操作仅“修改、删除”；修改课时直接拖拽上传 MP4。视频在保存时追加不可变版本，未选择新文件时保留旧视频。上传中或失败未清理时禁止保存；取消不改变已绑定版本。
- 最终审查补充：保存视频 A 的回执不得关闭正在上传 B 的弹窗；DELETE 回执不明时只 GET 核对目录，不盲目重复删除。两项均有回归与独立复核。

### Task 4: 课时列表与安全删除（用户 17:45 截图补充）

**Files:** `web/src/views/admin/CourseEditor.vue`、`web/src/api/training-types.ts`、课程组件/状态回归；`server/src/modules/courses/{course.controller,course.service,lesson-version.service}.ts`、`server/src/entities/course-lesson.entity.ts`、新迁移 `023_course_lesson_soft_delete.sql`、`database/init.sql`、课程/迁移测试；设计 01/03/04/05/06 分册。

**Interfaces:** `DELETE /admin/courses/:id/lessons/:lessonId` 需要 `courses:write`，返回 `{id,deleted:true}`；事务锁定课程与课时，只对未上架课程逻辑删除。`course_lesson.deleted_at` 为空表示有效；版本、媒体引用及学习事实不删除。详情课时新增真实 `created_at`。

- [x] 先写列表行为测试：列为编号、课时名称、要求、创建时间、视频状态、时长、操作；每行仅“修改、删除”，视频上传/替换合并到修改弹窗。
- [x] 先写删除拒绝/成功测试：取消不发请求、失败后核对目录、确认成功刷新目录及父列表；已上架/跨课程/无权限拒绝；历史版本和记录不变。
- [x] 实现课时逻辑删除、默认查询过滤、创建时间契约；同步迁移/init/entity/设计，不改既有迁移 checksum。
- [x] 实现 PC 按列列表；编号按章节/课时当前有序位置生成 `1.1`，不写入标题，不改 sort_order。

### Task 5: 学员目录对应与最终验证

**Files:** `mobile/src/components/course/ChapterList.vue`、必要的移动目录测试；`docs/design/05-模块设计.md`。

**Interfaces:** 继续消费同一 API 的有序章节/课时；Wot UI 2.3.2 Collapse；章节可展开/收起，显示节数，课时显示连续序号及 `章节.课时` 编号，保留进度与完成态。

- [x] 先写编号、节数、折叠和选择事件回归，确认原实现缺失这些显示。
- [x] 复用 Wot 折叠组件，调整箭头/节数与编号；不改服务端学习计时、播放或实名门槛。
- [x] 运行 PC/服务端/移动端相关测试、类型检查和构建；独立审查删除链路。浏览器只用隔离模拟数据检查界面，不删除真实业务数据；数据库迁移执行情况单独报告。

**Conflict resolution:** 用户明确要求真实“删除”，覆盖 05 册此前“不虚构删除入口”的 UI 约束；沿用 06 册“不硬删除”的历史保护原则，以逻辑删除实现。本轮继续直接执行，不自动提交或推送。

## Verification and Delivery Boundary

- PC Vitest 提交前最新 395/395；课程与媒体 Node 回归 29/29；迁移契约 40/40。PC/移动端类型检查、PC/H5 原子构建通过。
- 隔离 API `training-courses` 通过；覆盖删除权限与状态限制、历史版本/记录保留，以及旧媒体票据、开播和心跳拒绝。
- 移动端单测 375/375；Chrome 桌面浏览器回归 41/41，覆盖目录编号、折叠、选择和进度显示。不是手机真机验收。
- 独立评审已收口。PC 浏览器界面仅使用隔离模拟数据，未上传/删除真实课程资料。
- 公共后台旧 Node 回归初次有 1 项并发学员编辑失败，提交前再次运行时并发新增 `StudentAvatar` 导致 6 项学员相关用例在组件挂载时失败（测试上下文缺失）；不属于本轮课程改动，未替其他任务修改该行为。
- 用户发现课程列表 500 后，只读确认原有课程/章节/课时仍在，根因为 `deleted_at` 缺列。经用户明确批准，先备份课程相关表，再使用原迁移器限定 005 依赖与 023 执行；005 checksum 与全部原结构探针通过，023 登记 applied。迁移前后 7 张业务表记录指纹一致，课程列表/详情 API 及浏览器显示恢复。当前后端已加载新实体，无需额外重启。
- 全量迁移检查另发现既有 022 登记 checksum 与当前源码不一致；未改写旧记录、未重跑 022，也不把本次限定迁移表述为全链检查通过。备份留在仓库外本机临时目录，执行与未验边界详见验收记录。
- 为避免并发工作区干扰，从暂存树导出独立快照再次验证：PC 单测 388/388，课程/媒体/公共行按钮 Node 回归 38/38，PC 类型检查与后端编译通过。课程页面依赖的公共行操作组件一并纳入提交，其他页面适配及学员、统计改动不混入。
