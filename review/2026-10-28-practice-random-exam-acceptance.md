# 独立随机模拟考实施与验收记录

状态：源码、隔离自动化、PC/H5 实际页面与独立审查已完成。实现位于 Codex 管理的独立工作区，本地提交保留；未合入主工作区、未推送。本次未对开发/生产库应用043，也未创建或发布真实业务模拟卷。

设计：[独立随机模拟考](../docs/superpowers/specs/2026-10-28-practice-random-exam-design.md)；计划：[实施计划](../docs/superpowers/plans/2026-10-28-practice-random-exam.md)。

## 交付行为

- PC 可新建独立模拟随机卷，也可从选定正式公共随机卷带入配置；取消模板不写库，保存只建草稿。模拟题量、分值、时限和学习条件独立，支持50/100题，不限次数。
- H5 沿用考试列表、须知、答题、交卷、结果与错题页面。模拟正常出分、保留记录，部分分/空答按既有口径进入错题集；再考只返回须知，由学员明确开始。
- 模拟每次新开冻结最新发布规则，活动恢复和旧记录继续原快照。首次来源/难度仍按 assignment 冻结；新开须知版本过期40970且零写入，恢复请求优先。
- 正式次数、归属、成绩、排名、导出和首页考试汇总与模拟隔离；通用考试记录与错题保留两种用途。
- 043为 exam_paper、paper_release、exam_record 增加 exam_purpose，试卷 max_attempts 允许模拟NULL；旧数据默认formal，历史JSON与checksum保持。

## 编排与固定候选

基线 `1f07cd731661f146d95a7ad1d92b4ed8dd454b8c`。原工作区有迁移恢复、预约/支付草稿等未提交修改，因此使用 `/Users/caogj/.codex/worktrees/428d/emodor-training-platform`，未覆盖原修改。

按 Astra 实际并行启动后端、PC、H5 worker；后端顺序完成T1—T5，前端各自独占其包及类型。root负责接口裁决、文档、runner和E2E，tester独立执行API/浏览器回归；两名独立reviewer分别审查前端和后端，并复审修复。DDD引用与 `.harness/agents/code-reviewer.md` 在本仓库缺失，未虚报加载；审查依仓库AGENTS、设计、计划及固定差异完成。

生产候选 `18f9bab` 包含两项审查修复；`84c9dca` 仅稳定旧媒体测试夹具，不改变生产代码。最终文档/验收脚本提交不改变该生产候选。

## 验证证据

日志目录为本工作区 `.superpowers/practice-exam/logs/`，截图位于 `.superpowers/practice-exam/screenshots/`；均为本机验证证据，不入库。

| 验证 | 实际结果 | 日志 |
|---|---|---|
| 后端完整单测 | 98文件，1670/1670；退出0 | `server-full-fixed.log` |
| Web完整单测 | 74文件，1104/1104；退出0 | `pc-suite-final.log` |
| Mobile修复后完整单测 | 724/724，类型检查无错误；退出0 | `h5-race-unit-all.log` |
| Web与Mobile独立类型检查 | 均退出0 | `pc-types.log`、`h5-race-typecheck.log` |
| 043/042与完整迁移合同、目录检查 | 自有隔离MySQL，58/58；退出0 | `t1-migration-green.log` |
| 真实双连接发布/开考竞态 | 首次、重考2/2；退出0 | `review-start-publish-green.log` |
| 模拟真实API与PC/H5 | 退出0，未mock考试API | `practice-browser-final.log` |
| 原公共随机考试回归 | 退出0，1000题链路通过 | `public-random-final.log` |
| 正式统计与管理首页隔离E2E | 两套均退出0 | `training-statistics-regression.log`、`admin-dashboard-regression.log` |
| Mobile生产组件的fixture页面 | 自有随机端口，7/7；退出0 | `mobile-practice-fixtures-final.log` |
| E2E选择/生命周期与环境注册 | 选择及harness28/28，环境9/9；退出0 | `runner-regression.log`及本轮命令输出 |
| PC/H5组合构建、修复后H5构建、小程序构建 | 均退出0 | `build-web-h5.log`、`build-h5-final.log`、`build-mp-final.log` |

主要命令：

```bash
npm --prefix server test -- --maxWorkers=1 --minWorkers=1
npm --prefix web test -- --maxWorkers=2 --minWorkers=1
npm --prefix mobile run test:unit -- --maxWorkers=2
node --test tests/practice-random-paper-migration.test.mjs tests/public-random-paper-migration.test.mjs tests/migration-contract.test.mjs tests/migration-catalog.test.mjs
node --test tests/practice-start-publish-concurrency.test.mjs
PRACTICE_RANDOM_BROWSER=1 PLAYWRIGHT_CHANNEL=chrome node tests/run-e2e.mjs --ephemeral --suite practice-random-exam
node tests/run-e2e.mjs --ephemeral --suite public-random-exam
node tests/run-e2e.mjs --ephemeral --suite training-statistics
node tests/run-e2e.mjs --ephemeral --suite admin-dashboard
node scripts/build.mjs web h5
node scripts/build.mjs h5
node scripts/build.mjs mp-weixin
```

fixture浏览器通过已有静态服务 helper 启动随机端口，设置 MOBILE_E2E_BASE_URL 后运行 `mobile/e2e/practice-exam.spec.ts --workers=1`，未复用5174或用户会话。API harness记录了本轮自有进程、临时库和精确目录清理完成。

## 关键业务实测

1. 1000道合成题经真实TXT导入，覆盖两类别、easy/hard、三种题型及导入失败回滚。正式100题与模拟50题独立发布，模拟可以改为100题。
2. 模拟v1开始后发布v2：原50题、题序和截止时间保持；交卷后下一次变为100题/15分钟。修改学员当前来源不重算已冻结难度；assignment完整保留。
3. 模拟成绩88/100/0正确，88分场景产生11条部分分/空答错题。旧结果在v2发布后仍为88分/50题。重复交卷返回同一结果。
4. 同时开考恢复同一记录；模拟第4次、第101次可成功，超时不评分且不自动新开；正式第4次仍返回40902。缺失或过期expected_release_id不创建记录。
5. 模拟记录能在PC/H5查询，但正式summary、首页考试指标不变，直接请求模拟正式summary/ranking/export均40401。测试主动修改来源引起的人口分类变化与考试指标分别判断。
6. PC真实页面取消模板零POST，创建50题模拟草稿、重开编辑并发布；H5同步显示。H5旧须知遇40970，刷新后仍需再次确认；刷新恢复本地草稿，0分交卷，再考不自动发start，错题明确显示模拟来源，无页面异常或横向溢出。
7. 截图已人工查看；PC弹窗截图曾捕获淡入动画，测试截屏改为等待不透明并禁用动画后重拍，不以DOM存在代替视觉证据。

## 审查问题与修复

- H5迟到40970覆盖另一份试卷须知：新增两个竞态用例先失败；store检查原summary版本/试卷和页面stillHere后才刷新。修复提交 `766f80e`，前端reviewer复审通过；最终真实浏览器重新验证。
- MySQL REPEATABLE READ在锁paper前实名普通读形成旧快照：真实双独立连接与performance_schema锁等待屏障复现首次和重考均错误接受旧release。将新开路径实名读取移到paper写锁之后；两个用例旧expected均40970且record/item/assignment零新增，新expected读到v2两题/45分钟/120分，原归属不变。修复提交 `18f9bab`，后端reviewer复审通过。

## 测试编排修正与边界

- 超时夹具最初用MySQL本地时区NOW写入，TypeORM按UTC读取导致8小时时差；改为UTC_TIMESTAMP，生产时钟协议未改。
- 原移动考试helper严格字段集合及capability调用断言适配新增用途/expected参数；未知字段、用途枚举和反答案泄漏检查继续保留。
- 全量后端曾遇旧media-probe夹具冷启动抖动。对比40次启动，env node首轮约1003ms、另一次794ms，当前process.execPath约23—39ms；1秒超时可能早于记录文件生成。仅测试launcher改用当前Node，未扩大超时、未跳过测试、未改生产媒体逻辑，最终1670/1670通过。
- 历史题干/解析媒体的精确引用、v1/v2记录归属与跨账号拒绝由服务单测覆盖；未额外执行真实图片媒体专项API/浏览器验收，不把它并入上述纯文本题API结论。
- 构建保留既有Sass legacy API弃用及小程序循环chunk警告；小程序构建通过不等于真机运行。真实手机、真实短信/腾讯实名供应商、真实COS分发与生产部署未验。

## 后续集成与部署

当前保留独立工作区及本地提交，原main与未提交修改保持原样。集成时先核对主分支迁移恢复改动，沿用现有校验协议；应用新增043后才能启用本功能API及页面。停止新模拟可撤回模拟卷，但已进行考试需由兼容API完成；不删历史、不把未识别用途的旧统计服务直接接回新数据。
