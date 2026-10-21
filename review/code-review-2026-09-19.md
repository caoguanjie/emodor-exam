# 全量代码评审报告（2026-09-19）

> **一句话结论**：两路子代理并发全量复审（后端 / 前端+周边）共报 **16 项发现**（后端 9、前端 7），逐条核实后 **16/16 均属实并全部修复**；无 Critical，6 项 Warning、1 项安全卫生、9 项 Info。核心链路（学习结算、考试判分、乱序、SSRF、令牌吊销、契约面、XSS）未发现功能性或安全受损问题；`database/init.sql` 与 12 个 entities、03 册逐字段一致。

---

## 1. 评审元信息

| 项 | 内容 |
|---|---|
| 评审对象 | 仓库全量代码（server/src 58 文件、web/src 24 文件、tests/、database/、deploy/），基于 4f978c3 |
| 评审方式 | 2 个并发子代理（①后端：server+database+deploy；②前端与周边：web+tests+契约对照），主会话逐条读码核实 |
| 前置基线 | 9-12 设计评审、9-13 后端评审（1C+6W）、9-14 前端评审（6 修 2 不修）均已闭环，本轮不重复上报 |
| 评审日期 | 2026-09-19 |

## 2. 发现清单

| # | 等级 | 位置 | 问题 | 状态 |
|---|---|---|---|---|
| B1 | Warning | regulations.controller.ts:146-154,190-200 | 文件流下载无错误监听：读流错误以 uncaughtException 击穿进程（全局无处理器）；客户端中断不销毁源流泄漏 fd | 已修 |
| B2 | Warning | statistics.service.ts:441 + 全仓 | `invalidateRegulationCache` 为死代码（零调用点）：交卷/达标事件未按 05 册 7.4.4 失效统计缓存，缓存最长陈旧 5 分钟 | 已修（接线） |
| B3 | Warning | exam.service.ts:221-259 | 开考资格校验与 attempt_no 在 SETNX 锁外读取、锁内不回查：并发开考撞 `uk_paper_user_attempt` 未捕获 ER_DUP_ENTRY → 50001（注释宣称兜底实际无兜底） | 已修 |
| B4 | Warning | question-generation.service.ts:92-114 | 出题任务互斥为 check-then-set：并发 start() 双读空后各自覆盖写入并行双跑，重复消耗 AI 配额并重复落题 | 已修（SETNX） |
| B5 | Info | exams.controller.ts:7-13 | 心跳/交卷 answers 数组无嵌套校验：`selected` 传非数组真值时 `(a.selected||[]).map` 抛 TypeError → 50001 | 已修 |
| B6 | Info | content.service.ts:43 | preview 按 versionId 查版本不校验归属（对比 versionDetail 有校验）：A 制度 id 可预览出 B 制度版本内容 | 已修 |
| B7 | Info | regulations.controller.ts:102-113 + scope | `PUT /regulations/:id/scope` 不校验制度存在：先删（0 行）后插成功，detail 抛 404 但孤儿范围行已持久化 | 已修 |
| B8 | Info | ai-config.service.ts:110-121 | api_key 掩码在 key ≤7 位时头尾重叠泄漏全键（违背「完整键值永不返回」） | 已修 |
| B9 | Info | main.ts:28-31 | CORS `origin:true + credentials:true` 反射任意来源，等于全站白名单，与 07 册纵深防御不符 | 已修（白名单） |
| F1 | Warning | PaperDetail.vue:98 | `strategyLocked = status!=='draft'` 把已发布试卷的考试策略整体锁死，与同页提示、后端 updateStrategy（仅拦 archived，NFR-15）矛盾 | 已修 |
| F2 | Warning | Departments.vue:100-112 | 删除被拒后的「改为停用」确认框是死路：无任何 API 调用；后端无 status 端点（05 册 2.4.3 有停用语义但 04 册漏列接口） | 已修（补端点+接线） |
| F3 | Warning | Reading.vue:165-179 | `pauseSettle` 裸 fetch 对 4xx/5xx 不 reject 仍无条件 `pendingSegments.clear()`：投递失败丢弃已确认停留段位 | 已修 |
| F4 | Warning | ExamRoom.vue:51 注释 vs 实现 | 注释称「每题变更即暂存」，实际仅 30 秒节拍上报：节拍间隙答完即崩/直接关页，≤30 秒作答不进暂存，超时判分按未答计 0 分 | 已修 |
| F5 | Warning | tests/gui-test-env/seed-regulation.mjs:115 | 仓库源码含可用管理员口令字面量默认值 `'Browser@2026'`，违反 AGENTS.md 红线（口令一律运行期注入） | 已修 |
| F6 | Info | Statistics.vue:133-145 | loadAll 三接口无请求序号守卫：快速切换制度时慢响应落地覆盖新数据（面板与下拉/导出口径不一致） | 已修 |
| F7 | Info | RegulationDetail.vue:202-213 | `preview(row)` 失败时 rethrow 产生 unhandled rejection，且占位文案覆盖预览内容、对话框不打开，行为混杂 | 已修 |

## 3. 核实与排除说明

- **16/16 全部核实为真**：每项均在主会话读码确认（含后端对照、设计文档口径核对），无子代理误报。
- **核对过、确认不是问题的**：契约面（learning/exams/ai/users/departments/statistics/auth 路径、参数、信封、错误码逐项对上）；XSS（v-html 两处均为 sanitize-html 白名单产物）；e2e 92 项无恒真假绿；乱序还原与回显口径正确；init.sql 与 entities 无漂移。
- **沿用历史「不修」项**：doPause/doResume 无活跃指针校验、无外键固有 TOCTOU、筛选不重置页码、40905 空结果对话框、rename 后 COMMIT 失败孤儿文件——本轮不再重复上报。

## 4. 修复与验证

见 [fix-log-2026-09-19.md](./fix-log-2026-09-19.md)：16 项全修 + 04 册补录部门停用端点 + .env.example 补 `CORS_ORIGINS` + e2e 补 2 项断言（92→94）。验证：server tsc 构建通过、vitest 17/17、vue-tsc 与基线一致（7 条既有错误无新增）、e2e **94/94**（隔离库 `ruleexam_e2e_review`，跑后即删，未触碰开发库）。
