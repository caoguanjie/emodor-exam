> 2026-10-28 用户更正：本旧方案的withdrawn终态规则已由 `2026-10-28-paper-withdraw-to-draft.md` 覆盖；以下保留为历史执行记录。

# 试卷撤回发布 Implementation Plan

**Goal:** 按用户确认补回PC已发布培训试卷的“撤回发布”，禁止新开考，保留进行中考试、冻结快照与历史成绩。

**Architecture:** 复用现有 withdrawn 状态与 papers:publish 权限。新增 POST /admin/papers/:id/withdraw，以试卷行排他锁与开考串行化；不增加表、列或权限。040仅补充已撤回显示字典与列注释，init/entities/设计说明同步，不修改现有试卷状态。已撤回请求幂等成功，草稿/归档拒绝，不提供撤回后原卷编辑或重新发布。legacy /ai 撤回/归档路由继续退场。

**Spec:** 本对话已批准“撤回后禁止新开考、已开始可继续、历史成绩/快照保留、修改复制新草稿”。

## 契约

- POST /admin/papers/:id/withdraw，权限 papers:publish，成功data={paper_id:string,status:'withdrawn'}。
- 仅training scope；不存在/错误scope为404，draft/archived为409；published→withdrawn，重复withdrawn保持幂等，不重复修改时间/审计。
- 事务内锁paper，与start同一行锁；只更新status和既有修改人/时间元数据，不改release/questions/assignment/record/answers。
- 进行中考试start恢复/读取/交卷继续；撤回后新用户和已完成用户的新尝试都不能新开。
- PC已发布行且有发布权限显示按钮；确认文案说明禁止新开考但不影响进行中/历史；取消无写入，忙状态防重复，失败不自动重试，成功刷新当前列表。
- 旧状态筛选/只读展示保留；不恢复归档或legacy写入口。

## 任务

- [x] 后端：先失败测试，再补控制器/事务状态转换/审计，验证状态与权限。
- [x] 前端：按钮/确认/忙状态/刷新，覆盖权限、状态、取消、失败、重复点击。
- [x] 整合：临时库API+并发/进行中考试回归、设计文档同步、独立审查与必要修复、浏览器查看入口。

保持已有dirty文件；不操作用户现有试卷，不提交、不部署。
