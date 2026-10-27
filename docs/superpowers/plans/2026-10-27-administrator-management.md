# 管理员管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用公共列表并补齐旧系统管理员账号维护功能。

**Architecture:** AccessService 持有管理员分类、角色与认证变更事实，复用现有事务/会话吊销。前端使用 FitsTable；普通 deleted_at 标记保留历史关联读取。

**Tech Stack:** Vue 3、TypeScript、Element Plus、NestJS、TypeORM、MySQL。

**Spec:** `docs/superpowers/specs/2026-10-27-administrator-management-design.md`

## Global Constraints

- 行操作平铺、居中；使用公共列表，不恢复旧配色或旧组件。
- 密码策略、首次改密、认证世代及会话吊销保持；凭据不进入日志或审计。
- 不修改真实管理员凭据，不清理无关脏文件，不提交或推送。
- 新迁移034；既有迁移不改写。根负责文档与隔离回归，前后端执行者仅写各自范围。

## Review Focus

- 停用角色、纯学员、已删除账号不能被新端点误编辑或提升。
- 本人和超级管理员不能被禁用/删除；低级管理员不能重置超级管理员。
- 密码重置保留真实统计，并使旧access/refresh在同秒内失效。
- 修改与角色权限变更串行，过期角色仍显示且不静默丢失。
- 查询与详情晚到、重复点击、取消弹框不导致错行保存。

### Task 1: 管理员账号接口与保留历史的删除

**Files:** `server/src/modules/access/{access.controller,access.service,permission-catalog}.ts`、`server/src/entities/sys-user.entity.ts`、`database/{init.sql,migrations/034_administrator_soft_delete.sql,migrations/038_remove_administrator_role_assignment.sql}`、`server/test/administrator-management.spec.ts`、`server/test/button-permissions.spec.ts`。

**Interfaces:** 使用设计中的 Page/GET detail/PUT/reset-password/DELETE；普通角色修改复用角色→用户加锁顺序。新增 status 和可空姓名。请求层严格校验新接口，保持既有创建调用兼容。

- [x] 先写行为测试并确认新增能力失败；覆盖列表、增改、重置、删除、边界保护和角色并发。
- [x] 实现接口、软删除标记、审计及会话吊销，迁移可安全续跑。
- [x] 运行 server build、针对性 vitest，修复本任务引入的问题。

### Task 2: 公共列表与账号弹框

**Files:** `web/src/views/admin/Administrators.vue`、可拆分 `web/src/components/Administrator*.vue`、`web/tests/admin-shell-regression.test.mjs`。

**Interfaces:** 消费 Task 1 接口。移除原系统身份/权限码列及既有账号候选配置角色入口；创建/编辑字段与设计一致，角色均在对应账号表单内维护。

- [x] 更新真实行为回归，先观察密码确认、分页与修改/重置操作缺失导致失败。
- [x] 实现公共列表、增改重置弹框，显示禁用/空值/北京时间及安全保护。
- [x] 运行相关 node:test 回归及 vue-tsc。

### Task 3: 文档、隔离接口回归与浏览器验收

**Files:** `docs/design/{03-数据库设计,04-API设计,05-模块设计,07-安全与非功能设计,README}.md`、`tests/training-access.mjs`、必要验收记录。

- [x] 同步数据/API/流程分册，更新 Page 消费与访问控制回归。
- [x] 在隔离数据库运行 training-access，检查改密/重置/停用/删除旧令牌失效及并发边界。
- [x] 浏览器检查列表、公共布局、弹框与临时账号完整流程；仅清理本任务临时账号。
- [x] 独立审查本任务差异并修复重要问题，再报告实际已验与未验范围。
