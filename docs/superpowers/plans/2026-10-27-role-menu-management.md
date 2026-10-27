# 角色与菜单管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** 按旧截图补齐角色和菜单，并与管理员多角色配置形成同一链路。
**Architecture:** 保留注册权限作为服务端授权事实，以sys_menu投影生成角色授权树；公共FitsTable承载两个列表，035增加角色资料，036一次性拆分旧授权。
**Tech Stack:** Vue3/Element Plus/NestJS/TypeORM/MySQL。
**Spec:** `docs/superpowers/specs/2026-10-27-role-menu-management-design.md`

## Global Constraints

- 保留本线程管理员改动与其它脏文件，不提交或推送。
- 角色权限和菜单显示不能替代API鉴权；三个模块按用户确认采用独立按钮权限。
- 不改已应用迁移checksum；035同步init/entity/design。
- 列表操作平铺居中；弹框宽度基于内容区域，不使用vw制造溢出。

## Review Focus

- 新增只填名称备注时生成内部code，修改资料不能清空授权。
- 角色分配与删除串行，有账号引用即拒绝删除。
- 树中同码重复节点同步，未配置权限不丢，父级半选正确。
- 仅角色权限者可配置树但不能读取菜单维护配置。
- 缓存页返回、迟到请求、保存中切页不能误写。

### Task 1: 角色接口与035（backend worker）

文件：access controller/service、SysRole、init、035、角色专项测试。
- [x] TDD覆盖Page兼容、自动code、remark、详情、独立授权、系统/引用删除保护。
- [x] 实现安全树投影与metadata接口，编译及专项测试。

### Task 2: 菜单公共UI（frontend worker）

文件：Menus.vue、专属组件测试、MainLayout菜单刷新监听局部增量。
- [x] 补公共树列表列和统一增改表单、请求/退出保护、导航刷新。
- [x] 专项组件、vue-tsc和浏览器布局验证。

### Task 3: 角色UI和联动（frontend worker，root整合）

文件：Roles.vue、role-permission-tree utility及测试、角色相关shell夹具。
- [x] 先写共享权限、缺失节点权限保留与仅资料写入的失败回归。
- [x] 实现公共列表、metadata与独立授权弹框，核对父子/重复码同步。
- [x] 完成独立按钮守卫、036旧授权一次性转换及回归测试。

### Task 4: 集成与验收（root及独立reviewer）

- [x] 修正旧需求截图补证，同步设计03/04/05/07/README。
- [x] 隔离数据库角色引用/删除并发与最小权限回归，最新类型及构建。
- [x] 本机迁移、浏览器临时角色/菜单联动验收及清理。
- [x] 独立审查收口、更新验收记录。

验收结果见 [2026-10-27角色菜单验收](../../../review/2026-10-27-role-menu-management-acceptance.md)。
