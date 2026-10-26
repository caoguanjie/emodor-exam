# 历史固定卷管理入口清理 Implementation Plan

> **For agentic workers:** 使用 subagent-driven-development；前端实施与文档核对分开，根智能体整合验证。

**Goal:** 试卷管理直接显示当前培训试卷列表，移除历史固定卷 Tab 及旧 PC 管理分支。

**Architecture:** 删除 Papers 的双 Tab、legacy 列表请求和筛选，保留当前查询/重置及固定试卷编辑链路。清理 PaperDetail 的 legacy 管理界面与动作，旧 scope=regulation 页面地址返回列表；后台兼容接口、历史记录和共享数据表本轮不删除。

**Tech Stack:** Vue 3、Vue Router、Element Plus、Vitest。

**Spec:** 用户已批准移除历史固定卷 Tab、仅剩一个列表时一起移除培训考试 Tab、清理列表请求/筛选/页面入口；后台兼容另行核对，不顺带删除共享表。

## 边界

- 不增加自动选题、不改培训卷的创建/编辑/复制/发布、查询/重置和考试记录。
- 历史管理页面不再通过旧书签进入；query 变化和首登重定向均须经过实际路由守卫，不能只隐藏 Tab。
- 后端 API、学员考试/历史详情、数据库不变，不做数据清理或提交。
- 并发变更按文件/作用域保留。

## 任务

- [x] 前端清理 Tabs、列表 legacy 状态/方法、旧详情管理分支；处理旧地址；更新相关回归。
- [x] 同步设计文档中 PC 入口边界，保留后台 legacy 能力说明。
- [x] 测试/类型检查、真实页面及旧地址回退验证、独立审查。

## 验证结果

- Web 全量：34 个文件、539 项 Vitest 通过；定向 paper-host 23/23、paper-management-state 21/21、router-access 6/6，vue-tsc 通过。
- 真实浏览器：旧 `/admin/papers/2?scope=regulation` 回到 `/admin/papers`，查询串清空；无 `/ai/papers` 网络请求，无业务 Tab 或历史固定卷文本，仍有查询按钮和当前 1 条草稿。
- 独立源码审查未发现实质性问题；正常培训编辑、发布、复制及草稿/异步保护保留。
- 后台、共享数据表和用户业务数据均未修改；未提交或部署。
