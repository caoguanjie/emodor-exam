# 培训管理端改造验收

## 范围与当前状态

本期交付 PC 管理端与业务后端。独立 H5、旧站数据搬迁、生产升级和外部发布不在本期范围。保留制度学习、AI 出题审核、人工/文件录题、统一题库、组卷发布及原统计报表，不另起一套业务系统。

截至 2026-10-22，A1—C6 已集成，C7 完整业务链、组合升级与自动回归已收口。用户暂缓的原生文件选择验收仍未完成；以下仅登记已执行的证据，未执行项不视为通过。

## 自动验证证据

| 输入 / 场景 | 已执行结果 | 边界 |
|---|---|---|
| C3 持久作答与旧固定卷 | 原 smoke 97/97、training-submissions 通过 | 本地隔离 API；不等于移动端体验 |
| C4 人工阅卷 | training-grading 通过；服务端 330/330 | 含同题版本冲突、最后两题最终结算、缺引用并发读取、错题首次图片读取 |
| C5 监控 | training-monitor 通过 | 含独立权限、分页、第 101 张试卷搜索、确认作答数与连接状态 |
| C4+C5 合并 | server build + 340/340；web vue-tsc、详情 SFC 2/2 通过 | d93cdcc 合并输入；不替代后续 C6 验证 |
| 组合链路前段 | 真实隔离 API 通过，最终分数 80 / 35 | 21baf6c：尚未接统计端点的版本，不称完整 full-flow 通过 |
| 迁移目录格式 | migration-catalog 1/1 | a9626cb：修复 011 的幂等 INSERT 形式；仅解析，不是数据库升级通过 |
| C6 合并后服务端与 Web | server build、33 文件 352/352；最终 vue-tsc、Vite build 1799 模块、打印/首页/分页聚焦 5/5 | 最终分页窄修后重新执行 Web 类型、构建和聚焦测试 |
| 统计 / 分榜 / 导出组合 | `training-full-flow` 通过，80 / 35 分别 rank=1；pending 不进入排名；导出八列与查询逐格相等 | ce7a99c；同一组真实交卷/阅卷答卷，含重启、监控与五端点未知 query 拒绝 |
| 完整升级 | migration-contract 37/37、catalog 1/1；test-target 8/8 | 000–014 首跑/重复、最新 init 空注册表、旧数据/菜单 20–26 保留、在考拒绝、失败续跑；非生产升级 |
| 汇总套件 | 同一注册表 17/17 分段通过，含 smoke 97/97 | 首次 all 失败后停止；夹具修复后单项复验，其余顺序续跑；不声称一条 all 从头到尾无失败 |

17 个套件为 smoke、training-identity、training-access、training-student-admin-boundary、training-media、training-system、training-courses、training-video-learning、training-question-bank、training-question-import、training-publishing、training-attempts、training-submissions、training-monitor、training-grading、training-statistics、training-full-flow。

汇总阶段修复了三处测试数据/时序问题，未削弱产品规则：A3 补 B3 题库必填字段（2b4b59f）；A5 改用已有合规随机口令生成器并保留诊断（1161cfa，原始失败 HTTP 详情未知，诊断轮未重现）；媒体模拟进程先发 ready 再开始运行超时，同时保留独立启动上限（40c2686）。各失败套件均已独立复验通过。

组合链路前段包含真实 DOCX 解析、Mock AI 生成待审题、人工审核、人工录题与 TXT 导入、视频上传与服务端计时、两类学员同场独立抽题、确认草稿重启恢复、主动/超时交卷和受控图片评分。题目、发布、学员、答卷和成绩通过真实 HTTP 关联；仅截止时间推进使用任务自有数据库夹具，不直接写答案或成绩。

## PC 实测

在独立测试环境、两个独立浏览器来源与账号中执行，不使用开发库或旧站。

| 场景 | 结果 |
|---|---|
| 超级管理员 UI 登录、菜单加载 | 通过；仅使用运行期随机测试口令 |
| 两学员监控 | 本机构/初级 4/4、外来/高级 2/4，与实际确认稿一致 |
| 连接状态 | 上报心跳后显示连接正常；无心跳显示连接待确认，不自动扣分或判作弊 |
| 主动交卷、图片评分 | PC 填写评分和评语后最终 80 分；输入只读；返回队列显示完成与更新成绩 |
| 超时交卷 | 显示超时方式、待批改和未汇总；PC 阅卷后最终 35 分 |
| 记录详情 | 显示冻结题面、实际选项、逐题得分、50% 满分题正确率、最终总分及评语 |
| 只读账号 | 仅考试记录菜单；可查看成绩/评语，不请求答案图片；直接访问阅卷路由被拒 |
| 阅卷页打印 / PDF | 首次裁切失败已修复；实际重新导出 A4 三页，逐页查看，成绩摘要和四道题均完整且无侧栏/页头遮挡 |
| 试卷预览打印 / PDF | 首次包含背景编辑器且裁切；8a3f665 修复后重新导出 A4 两页并逐页查看，只保留预览、初级样例说明和完整四题，无操作按钮或遮罩 |
| 统计页面、分榜与导出 | 初级本机构 80 分、高级外来 35 分分别排名；课程完成 1/1；UI 导出 easy 同条件请求 HTTP 200，Excel 内容另由完整 API 链逐格核验 |
| 首页与旧报表 | 管理员访问根路径自动进入业务首页，显示 2 学员/22 题/1 卷/0 待阅；仅记录读取权限的账号首页无业务指标。旧报表按钮可进入原页面，制度概览/部门/未完成页签仍存在 |

浏览器截图、失败 PDF 与资源所有权记录保存在本次任务临时目录/协调记录，不把测试截图提交进仓库。当前观察不等于独立学员 H5 已实现。

## 明确未覆盖与用户暂缓项

- 用户已暂缓原生选文件的伪装 MP4、超限 MP4，以及头像保存/取消/失败协调操作。API 和组件测试不能替代这些手动验收，不反复要求开启扩展权限。
- 视频正常手选、离线重试、慢上传与上传中清除有前阶段局部证据；不据此推导所有文件选择路径通过。
- AI 接口使用本地 Mock 提供商；未验真实商业提供商质量、费用与外部可用性。
- 不验独立 H5、手机选图、微信内嵌浏览器、锁屏、真机弱网或移动端全屏体验。
- PC 已验范围以上表及前阶段对应记录为准，不据此声称所有菜单的全部失败/取消分支均逐一人工复验。旧固定卷完整学习到考试在本轮由 smoke 自动验证，不冒充一次完整人工操作录像；统计跨页修复由真实 SFC 事件测试验证，未为浏览器另造 21 份成绩。
- 不执行生产数据库升级、部署、远程推送或合入用户主工作树。

## 下一期独立 H5 可复用接口

下面是当前后端入口，不是 H5 页面已交付声明。统一前缀为 `/api/v1`，具体 DTO 与错误码见 [04 API 设计](../design/04-API设计.md)。下一期可独立建设移动端工程和入口，不要求继续与 PC 使用同一个页面入口。

| 能力 | 现有入口 |
|---|---|
| 登录与会话 | `/auth/login`、`/auth/refresh`、`/auth/logout`、`/auth/password`；refresh 使用 HttpOnly Cookie |
| 本人资料 | GET/PATCH `/me/profile`；头像通过已有受控媒体接口绑定 |
| 首页与课程 | `/me/home`、`/me/courses`、`/me/courses/:id`、`/me/courses/:id/progress` |
| 视频学习 | `/me/video-sessions`、`/me/video-sessions/:id/heartbeat`、`/me/video-sessions/:id/close`、`/me/video-records`；进度仍由服务端确认 |
| 考试与恢复 | `/me/exams`、`/me/exams/:id/start`、`/me/exam-records/:id` |
| 确认作答 | `/me/exam-records/:id/draft`、`/answer-images`、`/heartbeat`、`/switch`、`/submit`；后四项同一 record 前缀 |
| 历史与结果 | `/me/exam-records`、`/me/exam-records/:id/result`、`/me/wrong-questions` |

在考响应不得包含标准答案/解析；新作答使用冻结 `item_id` 和显示下标，不能把动态题库 ID 当作答题主键。待阅卷的 `score/passed/correct_rate` 保持 NULL。旧记录未知元数据保持 NULL/legacy，不在 H5 侧补造。

## 复验命令与安全边界

```bash
cd server && npm test
cd web && npx vue-tsc --noEmit && npm run build
node --test tests/migration-catalog.test.mjs
node --test tests/migration-contract.test.mjs tests/test-target.test.mjs
node tests/run-e2e.mjs --ephemeral --suite all
```

上述命令分别在对应目录运行。`--suite all` 为每个套件创建独立实例；禁止将旧重建脚本指向开发库。迁移数据库测试也必须使用其自有临时实例，不注入开发库的凭据。运行结束等待任务登记的进程退出，再清理其精确目录；不按前缀扫描删除其他临时资源。

## 当前 RuleExam 升级操作说明

这不是旧站数据搬迁。现有库只能走 `database/migrate.mjs`，不要重新执行初始化脚本覆盖已有安装。以下是交接操作，本次没有对开发库或生产库执行。

1. 明确数据库实例与名称，停写并停止 API 定时任务，确认没有进行中的考试。备份数据库、上传文件及部署配置；敏感配置独立保管，不进入 Git。
2. 在独立恢复库导入备份，核对关键行数/媒体读取，再经运行期环境变量注入明确目标，执行 `node database/migrate.mjs --check` 与 `--apply`。不要在终端历史里填写真实口令。
3. 升级后再次 `--check` 应无 pending，重复 `--apply` 不重写已有事实。检查 `schema_migration` 的状态、checksum 和逐步进度；保留旧菜单与考试记录。
4. 真实环境须另行批准。若演练失败，保留故障库和错误记录，停止发布；DDL 不承诺自动事务回滚。仅对经过确认的目标从升级前备份恢复，避免将新旧业务写入混合；本次只验证迁移拒绝/续跑协议，未演练生产备份恢复。
