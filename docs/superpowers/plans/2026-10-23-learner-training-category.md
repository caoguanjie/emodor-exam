# Learner Training Category Implementation Plan

> **For agentic workers:** 按 astra-workflow 的独立文件归属并行执行；遵循 test-driven-development，根智能体集成并安排独立审查。用户已批准实施，不重复等待方案授权。

**Goal:** PC 与 H5 使用同一培训类别，学员只允许首次明确确认，后续由有权限的 PC 人员调整。

**Architecture:** 复用 sys_user.category_id 与 CategoryService，不新增表或迁移。专用自助首次绑定端点在事务内强制权限与一次性限制；移动端从本人资料和真实类别列表读取状态，不再将 occupation 当工种。

**Tech Stack:** NestJS、TypeORM/MySQL、Vue 3、uni-app、Pinia、Wot UI 2.3.2、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-23-learner-training-category.md`

## Global Constraints

- 保留现有未提交修改；不提交、推送、读取真实凭据或重建开发数据库。
- category_id 为正十进制字符串；source、权限、实名认证不受首次绑定影响。
- 个人资料与实名认证入口分开；既有考试题单、历史与分数不可改写。
- 不修改课程浏览/播放门槛；不新增 schema，不猜测回填 occupation。
- 仅在用户明确确认时写入，失败不自动重试写操作。

## Review Focus

- 两个标签页或 PC 与学员同时提交，最终只能按权威用户行顺序变更。
- 类别被停用/改名/删除后，已选学员读到当前名称且不能自助换类。
- 成功写入但响应丢失，前端读回并锁定，不用旧 null 状态发第二次写入。
- 切换账号和页面返回时，旧请求不能覆盖新账号资料或发出错误确认。
- 缺类别/实名与真实网络错误区分，已有考试历史不会因提示卡消失。

## Task 1：后端权威绑定（backend worker）

**Files:** 修改 `server/src/modules/users/users.controller.ts`、`users.service.ts`；新建 `server/test/learner-training-category.spec.ts`，必要时补已有资料/学员边界测试。

**Interfaces:** 产出 GET `/me/training-categories` 的 Page<{id:string,name:string}>、PUT `/me/training-category` 的 `{category_id:string}`→完整本人资料；本人资料增加 category_name。消费现有 CategoryService 和 CurrentUser/AuthUser、审计、事务。

- [x] 写失败测试：null→"1" 成功；同 "1" 重放不新增审计；改 "2" 返回 TRAINING_CATEGORY_LOCKED；并发不同值仅一个成功；非法/停用类别失败且保持 null。
- [x] 写权限/严格字段测试：PC、管理员、停用学员、角色链接拒绝；注入 source 或他人 ID 拒绝；普通资料不能改 category_id。
- [x] 实现严格 DTO、移动身份边界、事务首选和 category_name；审计前后值，保持普通资料兼容；审视与 PC 更新/类别删除的锁顺序。
- [x] 测试 PC 授权调整可见且不改 source/实名/既有题单，类别改名可见；执行 `npm --prefix server test -- learner-training-category` 与相关已有单测。
- [x] 返回改动清单与实测结果，不提交。

## Task 2：移动首次确认及指引（mobile worker）

**Files:** 修改 `mobile/src/api/auth.ts`、`stores/learner.ts`、`pages/profile/info.vue`、`pages/profile/index.vue`、`components/exam/LiveExamCenter.vue`；可新增专用组件/纯逻辑与同目录测试，按需要更新静态 fixture。

**Interfaces:** 消费 Task 1 的两端点与 category_name；复用 ConfirmSheet、identity store、会话 epoch 防过期状态机制。普通资料保存不再发送 occupation 作为工种。

- [x] 写失败测试：真类别列表选择草稿不写、取消不写、确认一次写、重复点击不重复发；已设置者不可改。
- [x] 实现 GET 分页选项、二次确认、只读工种说明与 PC 修改后的刷新；资料及实名入口分开。
- [x] 覆盖响应丢失 GET 收敛、读取失败禁止盲写、切账号丢弃旧响应、后端锁定冲突展示权威类别。
- [x] 添加考试缺项指导但保留历史/进行中与正常空状态；待实名/失败区别显示；静态 scenario 不请求 API。
- [x] 执行 `npm --prefix mobile run test:unit`、`npm --prefix mobile run type-check`，返回实际覆盖与未验范围，不提交。

## Task 3：集成、设计同步与交付（root）

**Files:** 窄范围更新 `docs/design/01-需求分析.md`、`03-数据库设计.md`、`04-API设计.md`、`05-模块设计.md`、`06-关键流程.md`、`review/2026-10-22-learner-mobile-contract-freezes.md`；新建本次验收记录。按实际必要新增隔离回归脚本，不修改无关基线。

- [x] 同步新专用端点、category_id 权威和旧 occupation 兼容；明确旧禁止自助类别规则的首选例外与不变的课程门槛。
- [x] 实测接口与移动契约、边界回归；`npm --prefix server run build`（server test 的 pretest）与 `node scripts/build.mjs h5`。
- [x] 独立 reviewer 只审当前文件和本次差异，优先身份边界、竞态、错误恢复与历史保护；修复实质问题并针对性补验。
- [x] 记录自动测试/浏览器/真机/生产验证边界，复核差异保留他人工作；交付本地结果，不提交或推送。

## 执行记录

- 当前工作区包含并行进行的其他改动；本任务只编辑以上归属。Astra 引用的 DDD/公共 review 文件在仓库不存在，使用本仓库 AGENTS、冻结契约与本 spec 作为具体审查依据，不创建用户级配置。
- 后端新测试先红后绿；targeted 94/94，全量 59 文件 904/904，含 tsc。真实隔离 API 首轮 404 RED；补充小连接池后捕获事务嵌套取连接 RED，修正后 `node tests/run-e2e.mjs --ephemeral --suite learner-training-category` GREEN。测试所有临时服务/目录由启动器自动清理，没有访问开发库。
- 列表使用事务完成当前用户权限检查后释放连接，再调用既有类别列表；接口只返回启用类别 id/name。不在持有池连接时等待第二条连接。
- 移动最终类型检查、40 文件 375 单测、相关浏览器 36 项通过，原子 H5 构建通过。独立审查无遗留实质问题。扩大组合 67/68 的唯一范围外课程目录断言失败未动，完整边界见 `review/2026-10-23-learner-training-category-acceptance.md`。
