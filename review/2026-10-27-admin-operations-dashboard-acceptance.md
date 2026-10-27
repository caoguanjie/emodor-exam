# 管理端运营看板验收记录

日期：2026-10-27。状态：本地实现、接口和 Kimi 浏览器验收通过，正式设计已回填；未部署生产。

## 范围与版本

- 当前 `main` 分支直接实施；起始 HEAD `ade75352ae4cfd7c3d7cd7a92463345d773e66af`，本轮未提交、未推送。
- 实现设计：[运营看板设计](../docs/superpowers/specs/2026-10-27-admin-operations-dashboard-design.md)；任务拆分：[实施计划](../docs/superpowers/plans/2026-10-27-admin-operations-dashboard.md)。
- 可编辑设计：`docs/ui/pen-gemini.pen`，Node ID `Y8KAi`；常用操作沿用原 `SplYL` 的完整样式，当前画板内为 `AmDRw`。预览：`docs/ui/exports/home-dashboard-2026-10-27/Y8KAi.png`。
- 用户补充要求已落实为 ECharts 6.1.0 按需接入和 Kimi 浏览器插件验收。本轮曾新增的 PC Playwright 配置、依赖和用例已移除，不作为最终验收依据。
- 初始旧 OpenPencil 资源删除保留。期间出现的 `QuestionPreview`、`ExamRecordDetail`、`answer-feedback` 及相关测试/文档、`.pen` 外部修改，以及管理员管理、034 迁移及其 init/entity/权限相关修改，不属于本看板范围，保留且不混入验收。

## 接口与统计验证

运行环境：Node.js v25.9.0、MySQL 8.0.46；每个套件使用 `--ephemeral` 新建专属 MySQL、Redis、API，凭据运行期随机，不落文档。以下命令已实际通过：

```bash
node tests/run-e2e.mjs --ephemeral --suite admin-dashboard
node tests/run-e2e.mjs --ephemeral --suite training-statistics
node tests/run-e2e.mjs --ephemeral --suite training-paper-learning
node tests/run-e2e.mjs --ephemeral --suite training-records
DASHBOARD_PERF=1 node tests/run-e2e.mjs --ephemeral --suite admin-dashboard
```

专用套件核对五接口字段/零值/空值、逐项权限、401/403/400/404/40970、同人重考及跨日去重、冻结来源、历史记录可见范围、逻辑删除题目、学时阈值前后/无学习记录/课程换版/版本失效、最近考试个人最高分与归档状态。通过实际开考及整卷提交 API 产生新记录，再对账概览、记录列表与最近考试；读前后业务事实快照保持一致。

实库首轮捕获 raw SQL 使用保留字 `release` 作别名导致 500；改为 `publication`，补回归并复验通过。原统计回归的旧 dashboard 精确形状及过期固定日期断言按实际契约更新：统计账号只有四个参与字段，旧趋势逐日与原始记录 SQL 对账；其他 C6 历史报表断言保持。

后端定向 8 文件、110 项通过，`npm --prefix server run build` 通过。日志：`/tmp/ruleexam-dashboard-backend-api-green.log`、`/tmp/ruleexam-dashboard-training-statistics-final.log`、`/tmp/ruleexam-dashboard-performance.log`。

## 查询与性能样本

隔离性能库 `ruleexam_test_fddc9685fd54` 新增 10,000 账号、100,000 考试记录；7,500 人有学习记录，2,500 人没有记录。连同基础夹具应学 10,004 人，达标 5,002 人、未达标 5,002 人。每接口 5 次预热后 50 次采样：

| 接口 | P95 |
|---|---:|
| 30 日参与趋势 | 294.0 ms |
| 必修学时摘要 | 15.4 ms |
| 最近考试 | 654.4 ms |

均低于现有统计报表 P95 ≤3秒目标。捕获实际生产 SELECT 与参数执行 EXPLAIN：趋势/最近成绩扫描约 100,009 行，学时使用 `idx_video_learning_record_version`；无答案表查询。此样本未显示必须增加索引，**无数据库结构变更**，未新增迁移，也未改变 init/entity 定义及旧 checksum。这是本机样本，不代表生产容量。

查询计划：`/var/folders/_b/8g0796l93xbc8__ccj6vg5y40000gn/T/ruleexam-dashboard-query-plans-normal-ruleexam_test_71e96ce2bfbe.json`、`/var/folders/_b/8g0796l93xbc8__ccj6vg5y40000gn/T/ruleexam-dashboard-query-plans-perf-ruleexam_test_fddc9685fd54.json`。上述 API 套件自有进程/临时库均已清理。

## 前端与独立审查

ECharts 改动前全量 Vitest 56 文件、798 项通过。最终相关代码验证为 **7文件、97项通过**，覆盖页面、状态、真实ECharts引擎、图表生命周期、HTTP取消、入口解析和学员迟到响应；`vue-tsc --noEmit` 与 `node scripts/build.mjs web` 最终均退出0。套件注册/隔离启动器测试23项通过。日志分别为 `/tmp/ruleexam-dashboard-web-final-tests.log`、`/tmp/ruleexam-dashboard-types-final.log`、`/tmp/ruleexam-dashboard-web-final-build.log`、`/tmp/ruleexam-dashboard-suite-selection.log`。

对应最终前端命令：

```bash
npm --prefix web test -- src/components/__tests__/admin-dashboard.spec.ts src/composables/__tests__/useAdminDashboard.spec.ts src/utils/__tests__/dashboard-charts.spec.ts src/utils/__tests__/dashboard-charts.integration.spec.ts src/api/__tests__/http-cancellation.spec.ts src/components/__tests__/student-quick-switches.spec.ts src/utils/__tests__/admin-dashboard-navigation.spec.ts
# 在 web/ 下：
npx vue-tsc --noEmit
# 仓库根：
node scripts/build.mjs web
node --test tests/suite-selection.test.mjs
```

早期Node基线中的 admin-shell 13项与受控媒体等待超时不作为看板新增缺陷扩大修复；本次新增入口/缓存、统计筛选保持、学员场景均完成对应定向复验。上述97项不等于宣称仓库所有Node脚本全绿。

独立 reviewer 对固定候选快照审查并复验关闭三项P2：学员列表迟到响应覆盖新筛选、首次候选失败重试未恢复摘要、首次候选未返回时切趋势跳过学时初始化。ECharts 按需注册、实例销毁/重建、旧回调隔离、空数据、锁文件一致性、开发预构建及布局补丁均完成窄复审，无未解决实质问题。外部并行修改明确排除。

## Kimi 浏览器验收

使用 `node tests/admin-dashboard-kimi.mjs --ephemeral` 保持独立 API/Vite 与测试夹具，通过 Kimi 浏览器插件操作任务标签组「运营看板验收」。不向浏览器注入登录令牌，使用实际登录表单；测试口令只由运行进程通过 Kimi 填入，未输出或落盘。

验收隔离库 `ruleexam_test_f948f223d55d`，真实浏览器UA为 Chrome/156.0.0.0（macOS）。公开页面端口52053、API端口51938仅属于本次测试，已结束并清理自有 MySQL/Redis/API/Vite。Kimi标签组按工具约定保留，未关闭用户页面；网络阻断、尺寸覆盖、焦点模拟均已撤销，后续页面的临时错误采集启动脚本已移除。

首轮发现 ECharts `Invalid data provider`：Vite实际响应把 `SourceImpl` 以带版本参数和无参数URL各加载一次，导致 `instanceof` 失配。用真实响应下载执行稳定复现；显式预构建四个按需入口后，同一option真实引擎渲染成功，补非mock集成测试。Kimi复验两张Canvas图正常，控制台无异常。另修复父级 `.page-enter` 覆盖首页grid造成行距消失，实际计算样式为 `display:grid; row-gap:16px`。

| Kimi实际操作场景 | 结果与对账 |
|---|---|
| 管理员登录、五卡与图形 | 学员5=本机构2+外来2+未知1；题目2/启用1、试卷6/发布3；两张真实Canvas图，布局对应Y8KAi |
| 真实开考/整卷提交 | 新记录9，经真实API提交；今日从3人/4人次变4人/5人次，近7日为5人/7人次；今日列表5条、近7日7条，详情显示0/100、未通过及主动交卷 |
| 趋势与图表事件 | 切30日实际只新增趋势请求；鼠标移动显示ECharts数据提示，实际Canvas柱点击进入同一天首尾日期记录列表；来源堆叠与数据一致 |
| 学员/题目/试卷入口 | 先留旧关键字，再点外来/本机构，关键字清空且各2名启用人员；题目全状态2条、试卷全状态6条；常用学员管理含停用共6条，无重复业务页签 |
| 四个常用操作与新建 | 新建只开一次，消费create后激活/刷新不重开；实际取消离开保留标题，确认放弃一次关闭；导入、学员和统计入口可达 |
| 最近考试与学时独立 | 归档试卷直达 `paper_id=4` 分析；返回首页学时仍为原培训，不发生联动 |
| 学时三类空值/零值 | 2分钟要求下4人应学、2人达标=50%；切空应学培训显示无应学人员；清零学习事实显示真实0%；移除所有候选并重进显示无必修要求 |
| 版本失效 | 实际撤回当前培训后40970，旧数字/选择清空、提示重新选择，不自动换成其他培训 |
| 故障与重试 | 仅阻断最近考试请求，其他卡仍显示真实数据，解除阻断重试恢复；首次候选请求失败后解除阻断并点击重试，自动恢复默认摘要 |
| 权限边界与撤回 | 仅统计账号无学员/题目卡、无记录链接，参考按钮禁用；权限变更吊销会话后跳登录且无旧受限数据，重新登录后仅学员指标与相应入口 |
| 尺寸、缓存、控制台 | 1600×1110及1280宽度无横向溢出；尺寸变化、离页返回后均两张有效图；最后无未捕获异常，页头/三行无独立页尾 |

Kimi后台标签会节流离场动画，曾造成确认框在AX树中暂留；启用插件的focus-emulation后重验取消/放弃均正常，没有据此改公共guard。最终已关闭该焦点模拟。

最终图片已实际打开逐区检查，均位于被忽略的 `gui-test-screenshots/admin-dashboard/`：`kimi-final-1600.png`、`kimi-final-1280-top.png`、`kimi-final-1280-bottom.png`；补充证据为 `kimi-echarts-tooltip.png`、`kimi-release-conflict.png`、`kimi-no-requirement.png`、`kimi-statistics-only.png`、`kimi-permission-revoked.png`。首轮带错误的诊断图不作为通过证据。

## 正式文档回填与交付边界

Kimi全链通过后已同步 `docs/design/03-数据库设计.md` 的只读复用/索引证据、04册五接口契约、05册实际服务与入口、06册加载/下钻/异常流程、07册权限/性能边界和README实现状态；01/02未改写。数据库无结构变更，init/entity/迁移未改。未执行生产部署、真实供应商或移动真机验收，没有提交或推送。


## 空状态补充验收（2026-10-27）

按用户截图要求，三个区域统一复用列表的 Element Plus `el-empty`：趋势空数组或所选范围全部为零时显示「暂无考试数据」；学时无候选显示「暂无必修学时要求」，无应学人员显示「暂无应学人员」；最近考试空列表显示「暂无已发布的考试」。真实加载、错误重试和有应学人员但达标率为 0% 的环图继续区分。

- 定向运行 `admin-dashboard.spec.ts`、`dashboard-charts.spec.ts`、`dashboard-charts.integration.spec.ts`，3 文件 / 38 项通过；`vue-tsc --noEmit`、`node scripts/build.mjs web`、`git diff --check` 通过。日志：`/tmp/ruleexam-dashboard-empty-tests.log`、`/tmp/ruleexam-dashboard-empty-types.log`、`/tmp/ruleexam-dashboard-empty-build.log`。
- Kimi 浏览器插件在当前开发页验证真实数据：趋势全零与无学习要求均显示空态，三个区域 loading 均已结束，最近考试实际有 1 条记录，正常显示表格。截图：`gui-test-screenshots/admin-dashboard/kimi-empty-real-data.png`。
- 最近考试空列表使用仅限验收标签页的临时响应夹具验证，截图：`gui-test-screenshots/admin-dashboard/kimi-empty-recent-fixture.png`。未改业务数据库；夹具已移除并刷新，确认恢复真实 1 条记录。视口模拟已清除。
- 独立窄范围审查未发现实质问题；空态移除图表容器时会销毁 ECharts 实例，恢复数据后重新创建。仅同步 05 册与独立实施设计中的空态规则，接口及数据库契约未变。
