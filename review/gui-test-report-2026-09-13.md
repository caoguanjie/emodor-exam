# GUI 全流程测试报告与修复记录（2026-09-13）

## 概述

使用内置浏览器对 RuleExam 做纯 GUI 黑盒全流程测试（管理员端 → 员工端 → 统计闭环），共确认 **15 项问题并全部修复**；修复后：

- 单元测试 17/17 通过；e2e 冒烟 **86/86 通过**（修复前因 SSRF 修复引入回归仅 79 项可达）。
- 浏览器复测走通完整业务闭环：登录/强制改密 → 部门/员工 → AI 配置 → 人工录题 + AI 出题 → 审核 15 题 → 组卷（10 单选×6 + 5 多选×8 = 100）→ 发布试卷 → 学习要求/发布范围/发布制度 → 员工学习达标 → 开考作答 → 交卷评分（100 分/切屏 0）→ 成绩明细 → 统计（应学 1 / 学习 100% / 参考 1 / 通过 100% / 平均 100）。
- 截图证据：`gui-test-screenshots/` 为本地一次性证据，**不入库**（该目录已 gitignore，仓库内不含截图）；复现步骤见 `AGENTS.md`「常用命令」的 `tests/gui-test-env/` 三条命令（Mock AI / 预置制度 / `AI_EGRESS_ALLOW_HOSTS` 启动项）。

## 环境准备（与测试动作的边界）

- 重建本机 `ruleexam` 库（init.sql 12 表）；API :3000（运行期注入密钥）、Vite :5173、Mock AI :9101（`tests/gui-test-env/mock-ai.mjs`，从 e2e 抽取）。
- 制度「安全生产管理制度 V1」及 docx/pdf 版本经 API 预置（**IAB 不支持原生文件选择器，GUI 上传按钮无法端到端测试**，解析/版本管理界面均已验证）。
- 学习要求/发布范围/发布、录题、组卷、考试等业务动作全部经 GUI 执行。

## 问题与修复明细

### P0/P1（阻断或数据正确性）

| # | 问题 | 根因 | 修复 | 复测 |
|---|---|---|---|---|
| F1 | GUI 保存 AI 配置被拒「base_url 不允许指向环回」；e2e AI 段 7 项级联失败（此前 e2e 86/86 是修复前口径） | 2026-09-12 SSRF 修复（url-guard）一刀切拒绝内网，本地 Mock AI/开发工作流被误伤 | `AI_EGRESS_ALLOW_HOSTS`（host 或 host:port，逗号分隔）显式白名单，仅开发/测试注入；保存与外呼两处校验都放行白名单；e2e 启动器与 `.env.example` 同步 | GUI 保存+连通性测试通过；192.168.x/localhost 仍被拒（安全基线不变） |
| F2 | GUI 人工录题、AI 出题、创建试卷全部报「参数错误」→ 考试链路整体阻断 | 前端下拉绑定数字 id，DTO `@IsString()`（bigint 序列化口径）；e2e 传 String 故 API 测试未暴露 | Questions.vue（2 处）、Papers.vue（1 处）提交前 `String(id)` | 人工题入库、AI 任务受理并产出 15 题、试卷创建成功 |
| F3 | 合成最小 PDF 解析确定性失败（bad XRef entry，pdf-parse 全部 4 个内置 pdf.js 版本同败；文件手工校验合法） | pdf-parse 捆绑的 2015 版 pdf.js 解析缺陷（e2e 历史通过原因不明，25 次隔离复现均失败） | 弃用 pdf-parse，改用 **unpdf**（现代 pdf.js），删除旧依赖；解析管道顺带去重（parseOnce） | 合成 PDF 与 cupsfilter 真实 PDF 均解析成功；e2e PDF 步骤确定性通过 |
| F4 | 离开阅读页时 flush 心跳撞 10 秒限流窗（429）→ 同 try 块里 `/end` 被跳过 → 会话悬挂：列表最长 1 分钟显示 0 秒/未达标；离页后仍计入最多 45 秒（反作弊口径被破坏） | endSession 把 flush 与 end 串在同一 try；页面卸载 fire-and-forget | ① `/learning/sessions/:id/end` 接受 `dwell_segments/scroll_percent`（收口前合并）；② 前端 endSession 只发 end；③ 返回列表/去考试先 `await endSession()` 再跳转 | 返回列表立即显示最新时长（97→112 秒即时刷新）；会话即时落库（settled=1） |
| F5 | 发布范围保存后重进显示为空（误保存即清空的数据陷阱） | 详情接口返回 `{isAll, departmentIds}`（驼峰），前端读 `is_all/department_ids`；出入参大小写漂移 | 详情响应显式映射为 snake_case（04 册信封口径） | 保存集团总部+子部门 → 重进勾选正确回显 |

### P2

| # | 问题 | 修复 | 复测 |
|---|---|---|---|
| F6 | 保存学习要求后表单仍显示旧值（DB 已更新），误导二次保存回退 | el-input-number 程序化更新场景显示不回同步：保存前先失焦 + `:key` 随 load 递增强制重挂载 | 存 2 显示 2、存 1 显示 1 |
| F7 | 员工「最后登录」、制度「上传时间/发布时间」、成绩「交卷时间」显示原始 ISO UTC 串 | 新增 `web/src/utils/format.ts`，4 列统一 `formatDateTime` 本地化 | 各列表显示 `YYYY-MM-DD HH:mm` |
| F8 | 学习列表 `has_published_paper` 恒为 true（硬编码） | 注入 ExamPaper 仓库，按 `status='published'` 真实查询 | 无试卷时 false、发布后 true |
| F9 | 学习中滚动覆盖恒显 0/10、达标无引导 | progressView 合并进行中会话的 Redis 段位（仅展示口径，is_valid 仍以落库为准）；时长达标后显示「离开本页完成登记」提示 | 学习中显示 1/10 段；60/60 后提示 tag 出现 |
| F10 | 统计页制度选择器显示 ID「1」而非标题 | v-model 为字符串、option value 为数字，匹配失败回显裸值 → `:value="String(r.id)"` | 显示「安全生产管理制度 V1」 |

### P3

| # | 问题 | 修复 |
|---|---|---|
| F11 | 初始密码口径混乱：新增员工提示「≥6 位」vs 改密页「≥8 位+复杂度」，存在「初始口令可登录却永远过不了强制改密」裂缝 | create/reset/Excel 导入三层统一为 ≥8 位+字母数字（DTO `@Matches` + service 校验 + 导入预检 + 提示文案） |
| F12 | 改密页「确认新密码」label 折行溢出孤立「码」字 | label-width 80→90px |
| F13 | 新标签页不自动续登（access token 在 sessionStorage 标签页隔离，守卫从不尝试 Cookie 静默刷新） | http.ts 导出 `tryRefresh`；auth store 增 `restore()`；路由守卫异步先续登再放行 |
| F14 | 打开制度详情若无生效版本立即弹红色错误 toast | preview() 捕获后显示占位文案，仅显式预览时才抛错 |
| F15 | 组卷页分值改动未失焦时 `dirty` 不置位 →「保存题目组成」按钮不出现，无法保存、发布必被 42203 拒 | 新增 `persistedSum`：本地合计 ≠ 持久化合计即显示保存按钮；发布按钮同步加约束（复测中发现并修复） |

## 复测证据（关键节点）

> 以下为本地 GUI 观察到的关键节点（截图为一次性本地证据，不入库）；可按 `AGENTS.md`「常用命令」中的 `tests/gui-test-env/` 命令搭建环境后复现。
- AI 配置保存 + 连通性测试双 toast：r 系列/AI 配置截图
- 16 题全部已通过（1 人工 + 15 AI）
- 试卷发布：已发布徽标 + 分值合计 100/100
- 员工考试结果：「恭喜，考试通过！得分 100 / 及格线 60 · 切屏 0 次 · 历次最高 100」
- 成绩明细：逐题对错 + 我的选择/正确答案 + 解析
- 最终统计：应学 1 / 学习完成率 100% / 参考 1 / 通过率 100% / 平均 100 / 未完成 0

## 遗留说明（非缺陷）

1. IAB 运行时不支持文件选择器，制度上传按钮的 GUI 端到端未覆盖（上传链路经 API 全覆盖，解析/版本/生效切换界面已验证）。
2. 组卷页「保存策略」与未保存的题目组成并存时，策略保存会重载丢弃题目改动——已通过 F15 的保存按钮常驻可见缓解；更优交互（保存策略前提示）留作后续打磨。
3. 本机当前 `ruleexam` 库为测试数据；admin 口令 `Browser@2026`（首次已改），emp001 `Zhang@2026x`。API 需带 `AI_EGRESS_ALLOW_HOSTS=127.0.0.1` 启动方可使用本地 Mock AI。
4. Mock AI 与白名单脚本沉淀在 `tests/gui-test-env/`（mock-ai.mjs / seed-regulation.mjs），可复用于后续 GUI 回归。
