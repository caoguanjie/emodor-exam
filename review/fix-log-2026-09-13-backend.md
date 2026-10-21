# 修复记录 — code-review-2026-09-13-backend

> 对应评审报告：[code-review-2026-09-13-backend.md](./code-review-2026-09-13-backend.md) §2 确认问题（1 Critical + 6 Warning）。修复方式：两个子代理并行（考试+学习域 / 公共+制度AI 域），主会话统一验证。本轮只修 §2 七项；§3 建议修复（60–79 分档）17 项未动。

## Critical

### C-1 result() 在考泄答案 → 在考门禁
`server/src/modules/exams/exam.service.ts:547-550`：属主/角色校验后新增 `status === IN_PROGRESS` 拦截，抛既有 `submitConflict`（40905）；恢复在考走 start 幂等路径（grep 确认前端 ExamRoom 不依赖 result，唯一调用点 ScoreDetail 为交卷后回看）。e2e 补负例断言（`tests/e2e-smoke.mjs:603-605`，91→92 条）。

## Warning

### W-1 超时交卷收请求体新答案 → 超时只用暂存
`exam.service.ts:426-431`：`isTimeout` 时跳过请求体增量合并，仅以截止时刻的 Redis 暂存判分（与 autoSubmit 口径一致，注释引 07 册 3.2.4）。

### W-2 trust proxy + XFF 伪造 → 恰一跳可信 + 覆盖式重写
`server/src/main.ts:16-18`：`trust proxy` 由 `true` 改 `1`（恰一跳可信反代，注释更正）；`deploy/nginx/default.conf:34-35`：XFF 由追加式 `$proxy_add_x_forwarded_for` 改覆盖式 `$remote_addr`。两处配套，缺一不可。grep 复查：`req.ip` 全部 31 处均为透传入参，无自行解析 XFF 的调用点。

### W-3 学习 start() 竞态 → SETNX 互斥 + 心跳指针校验
`server/src/modules/learning/learning-session.service.ts`：
- `start()`（215-260 行）对「读活跃指针→flush 旧会话→INSERT→写回指针→ensureRecord」加 `learn:lock:start:{userId}:{regulationId}` SETNX（TTL 10s，参照 `exam:lock:start`），未抢到 429，finally 释放；
- `doHeartbeat`（271-277 行）统一前置活跃指针校验：指针 ≠ 当前 sessionId 抛 `sessionConflict`（旧会话心跳不再计费，06 册口径）；匹配则刷新指针 TTL（长会话不早于会话过期）。pause/end 走 `doPause`/`doFlushSession` 不受影响。

### W-4 版本上传兜底自毁 → tmp 保留至重试
`server/src/modules/regulations/regulation-version.service.ts:114-146`：catch 重构——非 `ER_DUP_ENTRY` 清理 tmp 原样抛；`ER_DUP_ENTRY` 保留 tmp 进入重试事务，重试失败统一清理再抛。「冲突时重读重分配」兜底真正生效。

### W-5 edit 仅改 options 绕过校验 → 整体形状校验
`server/src/modules/ai/ai.controller.ts:56`：`EditQuestionDto.options` 补 `@ArrayMinSize(2)`（与 Create 同款）；`question-review.service.ts:119-125`：校验条件改为 options 或 answer 任一命中，以「合并后 options +（传入 answer ?? 现值）」整体走 `validateQuestionShape`，归一化 answer 写回；审计 fields 快照在归一化前取，不计入未请求字段。

### W-6 saveScope 非事务先删后插 → 事务 + 存在性校验
`server/src/modules/regulations/regulation-scope.service.ts:32-53`：is_all 与圈定两分支均包进 `dataSource.transaction`（delete+insert 原子）；圈定分支插入前以 `In(ids)` 校验部门存在，缺失抛 `param('部门不存在：…')`。新增注入 `DataSource` 与 `SysDepartment` Repository（app.module 全局 forFeature 已含，无需改 module）。

## 验证记录

- `cd server && npm run build`（tsc）通过；
- `cd server && npm test`：vitest **17/17** 通过；
- `DB_PASSWORD=… node tests/run-e2e.mjs`：**92/92** 通过（新增 C-1 负例，AGENTS.md 断言计数已同步 91→92）。

## 备注（过程发现，未计入本次修复）

1. `web/src/views/employee/MyScores.vue:23` 对 in_progress 行仍渲染「明细」按钮，点击将收到 40905 提示（语义正确，属 UI 体验项）。
2. `doPause`/`doResume` 无活跃指针校验：孤儿会话仍可 pause/resume，但心跳已拒不计费、90 秒后被兜底收口，风险可控。
3. 版本上传重试事务内 rename 后若 COMMIT 失败会留孤儿正式文件（主路径既有形态，顺序不一致超出本项范围）。
4. 无外键固有 TOCTOU：scope 插入前的部门存在性校验与插入之间，部门并发删除拦不住（架构层取舍，靠巡检兜底）。
