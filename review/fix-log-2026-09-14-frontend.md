# 前端评审修复记录（2026-09-14）

对应评审：`review/code-review-2026-09-14-frontend.md`（6 修 2 不修）。

## 已修（6 项）

### 1.（Critical）Reading.vue 滚动覆盖测错滚动容器
- **改法**：新增 `getScroller()`，以阅读容器的滚动祖先 `host.closest('.el-main')` 为测量宿主（兜底 `document.scrollingElement`）；`currentScrollInfo` 与 `sampleScroll` 改用 `scroller.scrollTop/clientHeight/scrollHeight` 计算。
- **效果**：docx/PDF 两路径的覆盖百分比、段位判定恢复真实值；底部段覆盖防线（有效学习条件②）不再被原地不动击穿；覆盖进度 UI 与 `max_scroll_percent` 审计字段恢复真实。
- **依据**：05 册 459 行「自有容器内滚动可观测，是滚动覆盖采集的硬前提」。

### 2.（Warning）ExamRoom.vue 归零后无限重交卷
- **改法**：新增 `autoSubmitRetries` 计数，`submit('auto')` 失败累计，达 3 次即 `stopTimers()` 收口 + 提示返回列表；成功提交时重置计数；手动交卷遇 40905 同样 `stopTimers()`。
- **效果**：消除每秒一次的 POST /submit 与错误弹窗轰炸。

### 3.（Warning）Questions.vue 出题轮询 interval 泄漏/误杀
- **改法**：`startGenerate` 先清旧 `pollTimer` 再启动；轮询句柄改为闭包自持 `timerId`，终态时仅当 `pollTimer === timerId` 才自清；状态查询失败保留轮询（try/catch）。
- **效果**：旧 interval 不再永久泄漏，不再误杀新任务轮询。

### 4.（Warning）Reading.vue async onMounted 卸载后幽灵会话
- **改法**：`onMounted` 每个 await 后检查 `destroyed`，为真即 return；start 落在卸载之后时立即 `endSession()` 收口刚开的会话。
- **效果**：快速进出阅读页不再残留活跃会话、永不清理的定时器与全局监听。

### 5.（Info）RegulationDetail.vue 解析轮询缺卸载清理
- **改法**：新增 `onBeforeUnmount` 兜底 `clearInterval(pollTimer)`。

### 7.（Info）ExamRoom.vue blur 切屏监听等效死代码
- **改法**：blur 改用独立 `onBlurSwitch()`（直接 `queueSwitch()`，不查 `visibilityState`），挂载/解绑同步更新。
- **依据**：07 册 3.2.2「visibilitychange 与 window blur 均触发切屏上报」，既有 500ms 防抖负责过滤噪声。

## 不修（2 项）

- #6 手动交卷 40905 空对话框：体验问题（非功能 bug），#2 修复已顺带 stopTimers 收口。
- #8 筛选不重置页码：非功能 bug（置信度 45 < 80 门槛）。

## 验证

- `npx vue-tsc --noEmit`：7 条错误与基线逐条一致，零新增。
- `npm run build`：通过。
