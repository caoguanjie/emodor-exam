# 在线会话列表微调实施计划

> 执行方式：用户已批准本轮方案；沿用 Astra 工作流，在当前分支直接实现，不提交、不推送。前后端独立实施，根智能体集成并负责 Kimi 浏览器验收。

**Goal:** 让管理员直接识别账号、设备、登录时间和会话有效性，保留现有单会话强制下线能力。

**Architecture:** 复用 `auth_session` 与 `sys_user`，列表查询补充用户显示字段与服务端筛选。沿用现有权限、会话过期和吊销机制，不新增数据库字段，不把有效会话误称实时在线。

**Tech Stack:** NestJS、TypeORM、MySQL、Vue 3、Element Plus、Vitest；真实浏览器仅使用 Kimi 插件。

**Spec:** 本轮对话中用户已批准的列表微调方案；接口基准为 `docs/design/04-API设计.md` 3.2.6，认证事实由 `SessionService` 管理。

## 已确认范围与接口

- 账号／姓名替代用户 ID；无法关联账号时显示中性缺失信息，保留原始 user_id。
- 设备简写为「电脑 · Chrome / macOS」等，完整 UA 放悬浮提示；未知信息不猜测，不添加 IP 地理服务。
- 登录时间固定 Asia/Shanghai、`YYYY-MM-DD HH:mm:ss`；最近活动使用相对时间并可悬浮查看完整时间。
- 状态显示「有效 / 已过期 / 已下线」，当前请求对应的精确 sid 标为「当前会话」。有效不等同实时在线。
- 查询条件：`keyword`（账号或姓名，去首尾空白，最长 128）、`status=active|expired|revoked|all`（默认 active）、`page`（默认 1，1—1000000）、`page_size`（默认 20，1—100）。非法参数使用统一 40001；不接受未知、重复或数组参数。
- `GET /admin/sessions` 沿用分页信封及已有字段，补充 `username:string|null`、`real_name:string|null`、`client:pc|mobile`、`is_current:boolean`。账号查询参数化并按普通关键词匹配，total 与 items 使用同一筛选口径，排序 created_at DESC、id DESC。
- 保留 `sessions:read/write` 和单行 POST revoke；确认框说明账号与设备，重复点击受保护，当前会话主动下线后收口当前登录状态。
- 查询/重置回到第一页；刷新保留已应用条件；分页复用系统样式，加载/错误/空态分别展示。页面重新激活刷新，旧请求不能覆盖新条件。
- 当前库存在其他并行改动；仅编辑本计划范围，不覆盖其他管理员、权限、菜单或看板改动。

## Task 1：后端列表与校验

Files: `server/src/modules/auth/session.service.ts`、新增会话查询 DTO、`server/src/modules/access/access.controller.ts` 的 sessions 方法、对应 `server/test` 测试。

- [x] 先以定向测试确认筛选、用户投影、当前会话标记、参数拒绝和状态边界的缺口。
- [x] 实现列表字段及严格查询校验，保持 revoke/refresh 认证链路不变。
- [x] 通过会话相关测试及 server build，交付接口契约。

## Task 2：列表展示与交互

Files: `web/src/views/admin/OnlineSessions.vue`、`web/src/utils/online-session-display.ts`、对应前端测试。

- [x] 验证默认有效、查询/重置/分页、时间与 UA 降级、当前会话及权限动作行为。
- [x] 使用 FitsTable/FitsListSearch 实现查询条和右侧轻量刷新图标，替换技术字段直出。
- [x] 通过定向测试、vue-tsc 与 web 原子构建。

## Task 3：集成与交付

- [x] 在隔离 API 环境验证新增查询、权限、当前标记及测试会话下线；不对真实用户会话执行强制下线验收。
- [x] Kimi 浏览器验证显示、筛选、分页、空态和确认框；确认后取消真实会话操作。
- [x] 独立审查本轮固定差异，修复实质问题；同步 API/模块说明和验收记录，明确无 DDL 变化。

## Review Focus

1. 过期与撤销交叉时以撤销优先；有效筛选与返回状态一致，边界使用同一 now。
2. 相同用户多个会话只标当前 sid，不把全用户会话标为当前。
3. 被删除/缺失账号、空 UA、非法时间能够稳定展示，不暴露账号密码或身份材料。
4. 快速查询、翻页及缓存离开后晚返回不覆盖新列表；请求失败不展示成功空态。
5. 只读权限不能下线；下线自己的精确会话清理登录状态，不误下线同账号其他设备。

执行结果：代码、独立审查和隔离 API / Kimi 浏览器验收通过，详见 [验收记录](../../../review/2026-10-27-online-sessions-acceptance.md)。
