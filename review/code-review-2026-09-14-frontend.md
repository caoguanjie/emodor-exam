# 前端全量代码评审报告（2026-09-14）

评审对象：`web/src/` 全部 24 个源码文件（约 2600 行），已提交状态（HEAD 5d6e3a0）。
评审方式：子代理并发（≤2）多轮独立评审（红线合规 / 浅扫 bug / git 历史回归，其中 git 历史轮因模型错误由主代理核实），逐条读码核实后按 0-100 置信度过滤（≥80 才修）。
关联：红线合规轮结论「无违规」（学习时长服务端结算、考试答案不下发、乱序 HMAC、refresh token HttpOnly、统一信封、无硬编码凭据六条均通过）。

## 发现与处置

| # | 级别 | 文件 | 问题 | 置信度 | 处置 |
|---|------|------|------|--------|------|
| 1 | Critical | `views/employee/Reading.vue` | 滚动覆盖测错滚动容器：`.reading-container`/`.pdf-host` 非滚动宿主（无 height/overflow，随内容增高），真实滚动在 MainLayout `el-main`（overflow:auto）；`html,body,#app{height:100%}` 使 `window.scrollY` 恒 0 → percent 恒 100、段位恒底部段。底部段覆盖门槛（有效学习判定条件②，05 册 5.4.4）被"原地不动 10 秒"自动击穿；覆盖进度 UI 恒 1/10；`max_scroll_percent` 审计字段恒 100 | 95 | 已修 |
| 2 | Warning | `views/employee/ExamRoom.vue` | 倒计时归零后自动交卷失败（典型 40905 服务端超时任务已先行收口）时定时器不停、`zeroSince` 保持 → 每秒无限重交卷 + 错误弹窗轰炸 | 85 | 已修 |
| 3 | Warning | `views/admin/Questions.vue` | `startGenerate` 赋值 `pollTimer` 前未清旧 interval：旧任务成孤儿永久轮询；旧回调完成时 `clearInterval(pollTimer)` 会误杀新任务轮询，对话框卡死"生成中…" | 90 | 已修 |
| 4 | Warning | `views/employee/Reading.vue` | async `onMounted` 多个 await 期间组件卸载：`onBeforeUnmount` 先行后挂起代码继续跑 → 幽灵 start 会话、永不清理的定时器与 5 个全局监听 | 85 | 已修 |
| 5 | Info | `views/admin/RegulationDetail.vue` | 解析轮询 interval 仅由终态自清，无 `onBeforeUnmount` 兜底，离开页面后继续打接口 | 85 | 已修 |
| 6 | Info | `views/employee/ExamRoom.vue` | 手动交卷遇 40905 打开空结果对话框（`result` 为 null，主体 v-if 渲染空白） | 55 | 不修（体验问题，#2 修复中已顺带 stopTimers 收口） |
| 7 | Info | `views/employee/ExamRoom.vue` | blur 监听复用 `onVis` 且内部查 `visibilityState`，窗口失焦未隐藏时不计数，blur 等效死代码；07 册 3.2.2 明确 visibilitychange 与 blur 均触发切屏上报 | 80 | 已修 |
| 8 | Info | `views/admin/`（Regulations/Users/Questions/Papers） | 筛选条件 `@change="load"` 不重置页码，翻页后筛选可能看到空页 | 45 | 不修（非功能 bug，senior 不会称为 bug） |

## 核实过、确认非问题（避免误报）

- **v-html XSS**：渲染服务端已白名单净化的 `content_html`（server `parse-pipeline.service.ts`），前端无用户原样注入点。
- **401 刷新重放**（http.ts）：`_retried` 标记 + 单飞 `refreshing` Promise，无无限重试/并发重复刷新，刷新后正确重放原请求；服务端 40101/40102/40107 统一以 HTTP 401 返回，分支可达。
- **路由守卫**：未登录先 `restore()` 静默续登、pwd_pending 强制改密、admin/superOnly 拦截方向正确。
- **交卷防重**：`submitting` 标志 + 服务端交卷幂等；答题经 30s 心跳覆盖暂存 + 交卷全量提交，无漏提交路径。
- **学习页 pause/resume**：fetch keepalive 配对、`paused` 幂等守卫、beforeunload/pagehide 双触发被 `paused` 短路。
- **心跳 payload**（`session_id, dwell_segments, scroll_percent`）不含前端计算的时长，时长权威在服务端，红线合规。
- **ScoreDetail** 使用 answer/analysis 字段仅为交卷后明细展示，不构成"依赖下发答案做逻辑"。

## 验证

- `npx vue-tsc --noEmit`：修复前后各 7 条错误，逐条与基线一致（Questions 181/190、RegulationDetail 15、ExamRoom 16），**零新增**。
- `npm run build`（vite build）：通过。

修复明细见 `review/fix-log-2026-09-14-frontend.md`。
