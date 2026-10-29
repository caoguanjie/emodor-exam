# 公共随机考试实施与验收记录

状态：源码实施、隔离自动化、桌面PC/H5与独立代码审查已完成。当前分支main，本地提交；未推送、未升级开发/生产库。真实设备、真实供应商及生产部署仍为未验边界。

设计：`docs/superpowers/specs/2026-10-28-shared-random-exam-design.md`；计划：`docs/superpowers/plans/2026-10-28-shared-random-exam.md`。

## 证据台账

| 项目 | 结果 |
|---|---|
| 1000题套件运行环境配置 | node --test tests/training-exam-runner-env.test.mjs tests/training-video-runner-env.test.mjs：8/8通过 |
| 042迁移/init一致与重复执行 | backend worker报告真实隔离MySQL测试7/7通过 |
| 后端公共题池、抽题、计次 | 最终次数展示修复后root全量95文件1629测试通过；并发发布真实MySQL5/5、定向192/192通过 |
| PC配置、总分校验和二维码 | Web全量73文件1086测试通过（2 workers）；真实二维码库SVG生成/下载，精确URL断言通过 |
| 工种可选及登录实名回跳 | 后端174/174、PC学员13/13；隔离learner-training-category通过；浏览器65项通过，账号refresh补充入口6项通过；最终mobile全量70文件688测试通过、无类型错误 |
| 公共考试统计 | 后端80/80、PC53/53；隔离training-statistics通过；独立reviewer通过 |
| 1000题实际API导入→发布→考试→重考 | API套件退出0；Chrome PC/H5真实API浏览器阶段退出0；并发锁和账号刷新修复后root再次执行完整套件，退出0并清理全部owned临时服务 |
| 构建与跨端类型检查 | root执行PC vue-tsc退出0；web+h5组合构建与mp-weixin构建退出0；原子构建脚本19/19通过 |
| 独立代码审查 | PC/统计模块通过；后端锁顺序和mobile账号刷新问题修复后复审通过；最终唯一P2次数耗尽UI修复后scoped复审通过，无新增必须修复项 |
| 真手机扫码、微信小程序真机、真实短信/实名 | 未执行，不能以测试替身或构建代替 |

## 1000题链路实测

执行：`PUBLIC_RANDOM_BROWSER=1 PLAYWRIGHT_CHANNEL=chrome node tests/run-e2e.mjs --ephemeral --suite public-random-exam`。

- TXT文件经preview→commit四批各250条，总计1000道；两类别各500、easy/hard各500，每种难度单选300/多选100/判断100。重复确认不增题；事务故障回滚不留下半成品。
- 100题卷按60/20/20抽题，两来源分别全easy/hard，题单内不重复；答案/解析/未抽中题不下发。100题卷全对100分、部分90分、全错0分；80题100分卷部分85分，数据库和API结果一致。
- 并发开考/响应重试恢复相同记录、排列和截止时间；交卷重复不二次评分。超时无答案无评分且占次数，第4次拒绝；新开考新记录。缺题、非法分值和失败发布均阻止半成品发布。
- 修改题库、撤回再发布和修改学员来源不改旧归属快照与历史成绩；新学员使用新版本。公共统计按冻结easy/hard分别取最高分。
- Chrome实际PC页面新建随机100题规则，修改为80题100分、重开回显并发布；同一临时库H5列表出现新卷。二维码缺配置提示且不生成loopback码；真实本地SVG生成/下载正例由组件测试覆盖。
- Chrome移动视口实际H5列表/说明不自动开考；点击开始一次请求，刷新保持题单并恢复1题草稿。PC/H5页面异常0，观察到的HTTP错误0。真实短信关闭，实名使用隔离测试provider。
- harness日志确认本次MySQL/Redis/API/浏览器相关进程及两个精确临时目录已清理。测试故意注入的数据库异常日志用于验证事务回滚，不是遗留业务失败。

持久详细日志在本机忽略目录 `.superpowers/sdd/2026-10-28-shared-random-exam/logs/public-random-browser-20261028T090219Z.log`，相邻JSON记录退出码0。本节证明隔离合成数据链路，未证明真实手机扫码、供应商或生产部署。

最终代码复跑日志：`.superpowers/sdd/2026-10-28-shared-random-exam/final-integration.log`（root执行退出0，PC/H5 PASS，服务清理完成），后端全量日志 `server-final.log`（95文件1621测试、退出0）。

次数展示修复后的最终复跑：`quota-final-integration.log`（完整1000题+真实PC/H5、退出0、临时环境已清理），新增真实摘要断言耗尽为3/3/0、超时后继续第二次为2/3/1；`quota-server-full.log`为1629/1629，`quota-mobile-full.log`为688/688且无类型错误，均退出0。H5与小程序使用该修复重新构建。

## 审查问题与修复

- 公共随机卷与固定卷发布锁顺序冲突：真实MySQL复现ER_LOCK_DEADLOCK；改为全部候选收集后按全局questionId锁定、复核。并发与收集后题目停用/删除/换版5项通过，不增加生产测试钩子。
- refresh由账号A变B后列表不重载：新增浏览器用例先失败；考试中心监听账号变化后重新查询，6项入口浏览器测试通过、83项会话/考试定向测试通过。旧账号POST不重放，独立复审通过。
- 服务端限制次数但页面耗尽后仍提供开始：摘要补充attempts_used/max_attempts/attempts_remaining，使用本人记录和首次归属冻结上限。列表/说明展示已用次数，进行中优先继续，耗尽链接本人该卷最近历史结果且不发start；定向后端73、移动79、浏览器7通过，并在1000题实际接口中复验摘要计次。

## 部署与回退

构建警告：uni-app Sass legacy API弃用与小程序循环chunk警告仍存在；小程序未配置VITE_API_ORIGIN时仅证明可编译，不证明真机API联调。

先备份目标数据库并执行新增042迁移，再启动新API；不修改任何既有迁移checksum。设置公开 `VITE_PUBLIC_H5_BASE_URL` 后重建PC静态资源/镜像，二维码仅指向考试Tab。2026-10-28 后续经用户确认已完成本机开发库升级至042，历史摘要兼容、备份与验证见[本机迁移恢复记录](2026-10-28-local-migration-recovery.md)；未升级生产库。

旧应用不认识public题池，不可在公共考试进行中直接回滚旧代码；需停止新的公共开考并处理进行中记录，保留新字段和全部历史。禁止以删除题单或回退迁移checksum作为回滚。

## 实施裁决

- 依用户要求直接在当前main完成，以文件owner隔离并行修改；root统一集成提交。
- 复用assignment冻结来源、难度和规则，每次新record重新抽样；单个二维码不携带paper_id。
- 既有视频runner测试曾把所有新增suite均假定为无覆盖，现改为验证未知路径无覆盖，已注册suite按各自合同独立验证。
- 旧迁移合同清单和菜单保留断言止于较早版本，现明确追加到042，并映射036已批准的menus/read权限变化；继续严格比较其余字段。migration-contract39/39通过，迁移目录测试通过。
- 统计options读取当前paper.poolScope的非阻断一致性建议暂保留：当前更新禁止修改scope，无可触发范围漂移；摘要/记录按发布快照取scope。
