# 制度学习及考试系统（EmodorRuleExam）设计方案 · 总览索引

> **COS 增量（实施中）**：按[已确认设计](../superpowers/specs/2026-10-26-cos-media-integration-design.md)与[Astra 实施计划](../superpowers/plans/2026-10-26-cos-media-integration.md)接入图片/视频存储、上传续传及存量迁移；PDF/DOCX 原件保留本地。共桶/共享后端密钥、独立数据库、按行双存储和申请/续签时授权的COS短链。实际验证状态见[验收记录](../../review/2026-10-26-cos-media-acceptance.md)，不表示真云或数千并发已通过。

> **人工录题 Tiptap 融合（2026-10-26 最新纠正）**：按[现有新增/修订试题弹窗融合设计](../superpowers/specs/2026-10-26-manual-question-tiptap-design.md)，在当前弹窗中集成 Tiptap 题干、选项、答案设置和解析，提供选项排序、受控图片及保存并新增。下文“保留原表单”只表示保留入口与保存链路，不再表示保留文本框；Tiptap 不再仅用于试卷设计器。分值、考点、资料来源均不进入人工题表单。实现和验收按[实施计划](../superpowers/plans/2026-10-26-manual-question-tiptap.md)登记。

> **一句话定位**：本文档是 EmodorRuleExam（制度学习及考试系统）全套设计方案的入口与一致性基准。2026-10-22 演示版已按批准的瘦身方案收口为三类客观题、自动评分、服务端期限、本地最小草稿、主动整卷交卷及纯timeout和考试记录；图片作答、人工阅卷、实时监控、切屏采集，以及制度/员工/部门管理入口不再属于现行产品。题干、选项和解析中的受控图片仍保留。旧制度阅读、旧固定卷自动评分和原统计依赖的共享表与只读服务继续兼容。

> **题库行内操作增量（2026-10-26）**：按[增量设计](../superpowers/specs/2026-10-26-question-bank-row-actions-design.md)，状态独立为启用／停用开关，操作列180px居中，仅预览／修改／删除。029追加普通`question.deleted_at`，逻辑删除退出当前题库与新候选，不增revision、不物理删历史；草稿旧引用保留且发布阻断，已发布／考试历史继续读取。开发库升级、自动化与PC验收分开记录，不代表生产部署。
>
> **权威链接**：现行范围以[演示版瘦身实施计划](../superpowers/plans/2026-10-22-training-demo-slimming.md)为准；此前的[融合设计](../superpowers/specs/2026-10-21-training-admin-integration-design.md)和[实施总计划](../superpowers/plans/2026-10-21-training-admin-integration.md)仅保留未被瘦身裁决否定的部分。源码、自动验证、PC 操作、真实设备和生产部署仍按不同证据等级登记。
>
> **试题入口增量**：菜单拆分和一次性参考题 AI 生成按[已确认设计](../superpowers/specs/2026-10-22-ai-question-import-design.md)与[实施计划](../superpowers/plans/2026-10-22-ai-question-import.md)执行。文档同步不代表真实商业 AI 或生产部署已验收。

> **试卷设计器增量（2026-10-23）**：按[定向集成设计](../superpowers/specs/2026-10-23-main-question-paper-designer-integration-design.md)迁入完整 PaperDesigner 及共享 Tiptap 内核。人工新增和编辑按上方 2026-10-26 增量在现有弹窗内接入 Tiptap；不新增独立试题设计器或单题编辑路由。服务端增加 schema 3、版本作者原稿、幂等回执、试卷布局与客户端能力协商；当前只启用简单 `easy` / 困难 `hard`，历史 `medium` / unknown 不重分类。源码与自动化、浏览器和真实设备的证据以[本次验收记录](../../review/main-question-designers-acceptance-2026-10-23.md)分别登记。

> **题库生命周期与分值归属（2026-10-26）**：按[已批准题库瘦身设计](../superpowers/specs/2026-10-26-question-bank-slimming-design.md)，人工保存、文件确认、参考题 AI 选行确认和修订均直接启用，题库不再提供考点组或审核队列。025 将旧题库分值列改为可空历史兼容列；026 增加 `question.is_enabled` 并只把历史 approved 映射为启用；027 清理 `questions:review` 及其角色／菜单关联。新题与新版本的概念、分值和审核元数据写 NULL，分值仅属于试卷关联、规则和冻结快照。普通导入与 AI 参考题下载统一使用中文五列模板并由页面选择整批培训类别，兼容旧中文四列及英文七／八／九列；只有 AI 生成结果导出保留英文七列。非空 concept 明确拒绝，旧 score 忽略并返回批次 warnings。既有版本、原稿、发布快照与成绩不重写。

---

## 1. 系统背景与目标

### 1.1 系统背景

EmodorRuleExam 当前是一套面向单家培训机构的课程、题库、考试与记录系统，同时保留旧制度阅读、旧固定卷考试及原统计的兼容链路：

管理端考试管理依次为“试题管理、试卷管理、试题导入、考试记录”。试题管理承载紧凑查询、人工录题、修订、预览和启用／停用，默认看启用题；独立试题导入页提供“文件导入 / AI 生成”两个 Tab。普通中文 Excel／标签 TXT 文件先选择整批类别，空难度默认简单，经预检、有效题逐题预览及确认后直接启用；AI Tab 上传一次性参考题，每题最多生成 easy/hard 两题，生成、修改和批次内单行重生成只更新待确认批次，选行确认后才原子创建启用题。参考文件与参考正文不留存，生成题以 `source=ai` 且无制度版本入库。修订同时校验 `expected_version_id` 和 `expected_enabled`，旧页面不能隐式恢复已被停用的题。

资料管理继续以“资料/资料版本”提供 PDF/Word 上传与解析，底层复用 `regulation/regulation_version` 保存真实来源与旧数据。旧 `POST /ai/generate-questions` 与 `POST /ai/questions/{id}/regenerate` 写入口退场，AI 配置、旧任务／结果只读查询和历史来源保留。旧制度固定卷仍要求「有效学习」双条件；新培训考试默认关闭学习门槛。学习侧继续以心跳、失焦暂停、服务端容差和滚动位图计时；新培训移动考试以权威实名、稳定item/option ID、受限Tiptap题面、不可变题单/期限、本地草稿及幂等主动整卷保障一致性；不提供服务端draft/heartbeat。仅锁后accepted_at严格早于deadline的主动交卷由SubmissionService按冻结快照同事务评分；到期统一纯timeout，不提交、不评分、不生成答案。旧/exams数字及暂存协议只作制度固定卷兼容，到期同样纯timeout；历史已评分timeout保持只读。记录列表、详情和结果保持只读。

系统底层仍识别 super_admin、regulation_admin、employee 三类兼容身份；现行管理端通过 `POST /admin/administrators` 创建管理员并显式提交 `role_ids`，通过学员管理维护无部门学员。部门、员工和制度 CRUD 不再提供菜单或控制器。

### 1.2 设计目标

1. **制度数字化**：文件「上传即可读」，版本可追溯，发布范围可按部门圈定或面向全员。
2. **出题低成本、质量可控**：一次性参考题 AI 先生成预览，管理员选择、修改并确认后直接启用；启用题可供组卷，停用题退出新候选。
3. **学习真实性可保障**：以「时长 + 滚动覆盖」双条件判定有效学习，辅以心跳、失焦暂停、容差校验、分段位图四道防线防止刷时长。
4. **考试公平可量化**：实名/资格、冻结题单与乱序、稳定选项ID、服务端期限、主动整卷及规则化评分；到期只收口未交卷timeout。
5. **落实情况可运营**：制度 / 部门 / 个人三维统计与 Excel 导出，未完成人员清单直达跟进闭环。

### 1.3 当前基线与批准增量

> **管理端运营看板（2026-10-27 已实现，本地验收通过）**：五卡、按来源堆叠趋势、完整常用操作、必修学时与独立最近考试已接入真实只读聚合，入口/缓存/权限已验证。图表使用 ECharts 按需集成，真实浏览器验收使用 Kimi 插件；无数据库结构变更。模块与接口见 [05册7.4.6](05-模块设计.md#admin-operations-dashboard)、[04册3.8.2](04-API设计.md#admin-dashboard-planned-aggregation)，数据复用见03册6.4.1，流程见06册6.2.2；证据与未验部署边界见[验收记录](../../review/2026-10-27-admin-operations-dashboard-acceptance.md)。

| 范围 | 当前实现基线 | 已批准目标（计划，非当前部署声明） |
|---|---|---|
| 业务边界 | 制度学习、题库启停与 AI 预览确认、旧固定卷员工考试、原制度/部门/个人统计；A1—C6 已有源码证据的培训管理增量 | 单家机构 PC 管理端与完整后端；C7 自动验收收口、手动边界单列；不迁移旧站数据，学员H5已实现至Gate I，最终验收分级登记；不建设租户、班级、支付或证书平台 |
| 学习 | 制度阅读双条件；B1 课程/章节/视频课时与不可变内容版本；B2 视频 30 秒心跳、完整服务端 elapsed 跳播校验、45 秒单次确认上限、2 秒位置容差、95% 去重覆盖、DB 断点恢复、本人历史与当前应学汇总 | mobile H5课程/视频已实现并完成Gate H1自动验证；真实手机/微信播放另验，新培训考试默认无学习门槛 |
| 学员与题库 | A2 学员类别与 `institution/external` 来源；三类客观题、当前简单/困难两档、启停身份与不可变版本；中文五列 Excel／标签 TXT 模板（旧格式兼容）、预检与幂等确认；历史 medium 保留原值 | 当前弹窗无损适配 Tiptap/schema 3；完整固定卷设计器与作者原稿；参考题 AI 确认后直接启用，无永久资料来源 |
| 考试与成绩 | legacy数字执行协议兼容；发布/个人快照、稳定ID、本地草稿、主动整卷评分及纯timeout；统一结果、历史与错题 | 最终总分只读，不提供图片答案或人工改分 |
| 统计与记录 | 原统计后端继续兼容但管理菜单隐藏；考试记录列表、详情与结果保留；培训统计不再含待人工评分或切屏指标 | 不提供实时监控、连接状态或切屏采集 |

> **考前学习增量（2026-10-26）**：新增试卷保留一个“考前学习要求”开关，开启后才显示并必填同类别已上架课程与累计分钟；资料来源输入退场，备注选填。030新增试卷阈值/备注与发布阈值，旧数据保持NULL。发布冻结课程集合与分钟；首次及补考创建前按本人关联课程当前有效视频版本的服务端`credited_ms`合计校验，不足返回40901且不消耗次数，进行中恢复优先。默认关闭与旧release阈值NULL保持原语义；本地迁移、API及浏览器证据分别登记。

> **试卷排序增量（2026-10-26）**：031为`exam_paper`增加默认0的`sort_order`。培训试卷基础设置可维护0—2147483647整数，创建默认0、更新未传保持、复制继承；管理列表按`sort_order ASC,id DESC`。该字段不进入发布快照，不改变legacy接口、开考、评分或统计。

> **试卷操作信息增量（2026-10-26）**：032为`exam_paper`增加nullable `updated_by`，历史不回填。training新建／复制记录创建与更新操作者，配置保存、题单替换及首次发布只更新最后操作者并显式推进更新时间；详情和写回返回创建／更新姓名，失联用户为NULL，列表不查姓名。

**管理员维护增量（2026-10-27）**：沿用公共列表查询/分页，补齐手机号、登录次数/IP和创建时间；新增确认密码与正常/禁用状态，姓名选填。修改、重置密码和保留历史的删除由管理员权限治理，旧会话及时吊销。034仅追加普通`sys_user.deleted_at`，保留账号唯一占用和业务引用，不对历史关联启用全局软删除过滤。具体实现与验证按[设计](../superpowers/specs/2026-10-27-administrator-management-design.md)与[验收记录](../../review/2026-10-27-administrator-management-acceptance.md)区分。

**角色与菜单联动（2026-10-27）**：按[确认设计](../superpowers/specs/2026-10-27-role-menu-management-design.md)，管理员选择角色，角色按菜单层级配置真实按钮授权；角色备注/查询/安全删除、菜单公共列表与统一弹框一并补齐。035/036只增量升级本库，038前向清理已退役的既有账号提升管理员权限链路，不搬迁旧站数据；旧站需求已按新用户截图补证按钮层。实际验证与本机边界见[验收记录](../../review/2026-10-27-role-menu-management-acceptance.md)。

**实现状态规则**：未具备源码与验收证据的能力不得写成已验收。当前源码定义41张业务表，另有schema_migration，合计42张物理表；迁移000—038，021增5兼容列，022追加版本作者原稿、试卷布局和一张持久回执表，025迁移题库历史分值，026增加启停字段与候选索引，027清理题目审核权限及菜单关联，028续接一次性密码回填探针且不改账号数据，029追加题目普通逻辑删除标记，030增加试卷考前累计分钟与管理备注及发布阈值，031增加培训试卷管理排序，032增加培训试卷最后更新人，033增加COS媒体定位和持久上传会话，034增加管理员逻辑删除标记，035增加角色备注及名称唯一，036细化管理员/角色/菜单按钮权限，037新增独立字典分类，038清理既有账号提升管理员的权限、菜单和角色授权；`exam_review_event` 已从现行 schema 删除。迁移 `015_demo_slimming.sql` 以保留历史数据的方式收缩字段、枚举、权限和菜单；旧迁移仍作为不可变升级历史保留。版本化迁移用于升级当前 RuleExam 数据，不是旧站数据搬迁。原COS候选030从未部署；主线029—032已应用，因此媒体迁移顺延为033，保留主线迁移内容与checksum。

菜单前向迁移 `017_exam_question_navigation.sql` 按 route_path 复用试题管理、试卷管理、试题导入、考试记录的既有 ID，考试目录按语义定位，不假定为 ID 3；只规范四个标准入口的名称、权限和排序，保留其它自定义菜单及历史 checksum。试题管理路由允许 `questions:read OR questions:write`，试题导入要求 `questions:write`；只缓存导入页，试题管理返回时重新加载，确保新导入题可见。

### 1.4 A1—C7 模块与验收进度映射

当前进度：A1—A5、B1—B4、C1/C2 中未被瘦身裁决取消的共享基础继续保留。考试侧保留发布快照、原子开考、稳定ID个人题单、补考冻结归属、旧固定客户端适配、本地草稿、主动整卷评分、纯timeout、统一结果/历史/错题；管理侧保留 `/admin/exam-records`、`/admin/exam-records/{id}` 与 `/admin/exam-records/{id}/result` 三个只读入口。原统计服务继续作为兼容后端存在，但不在五个根菜单中展示。

自动证据按阶段登记：此前C7/full-flow是当时协议的历史验收，不再用旧服务端草稿或超时评分证明现行行为。Task13/14 / Gate H2已完成稳定ID、本地草稿、主动整卷、纯timeout的自动验证、隔离数据库竞争与独立审查；Task15 / Gate I已完成原子组合构建及独立审查。Task16最终链验收另记；真实后端浏览器全链、真实短信/腾讯、真实弱网、微信开发者工具/真机及Docker/Nginx/生产部署不得由本册同步推定通过。

| owner 任务 | 目标模块/链路 | 必须留下的验收证据 |
|---|---|---|
| A1 | 基准、共享契约、迁移安全入口 | 测试库隔离；初始化与升级一致；失败可续跑；文档/代码边界清楚 |
| A2 | 培训类别、学员来源、可恢复导入 | 来源缺失/非法拒绝；批次幂等；类别与权限分离 |
| A3 | 验证码、会话、管理权限 | 撤权/下线立即生效；旧登录兼容；权限 API 与按钮一致 |
| A4 | 受控媒体与上传 | 内容探测、归属校验、引用保护；保留头像、课程、视频、题干/选项/解析图片 |
| A5 | 菜单、字典、公开配置、审计、PC 公共框架 | 配置白名单；未保存提醒；敏感值不泄露 |
| B1—B2 | 课程/视频课时与可恢复学习 | 版本、下架、重放/乱序/跳播、95% 覆盖、零必学课时口径 |
| B3—B4 | 三类客观题版本题库与 Excel/TXT 导题 | 难度/题型/类别/媒体校验；普通及参考题 AI 确认直接启用，无概念和题库分值；预览确认与批次幂等 |
| C1—C2 | 固定/随机发布、抽题、个人题单、旧卷适配 | 本机构初级/外来高级；按稳定 question_id 去重；发布/开考快照不可变；三次机会含首次 |
| C3 / Task13/14 | 本地草稿、主动整卷与纯timeout | 联网核验同attempt后恢复本地稳定ID答案；截止前主动受理才评分，到期不提交/不评分；终态幂等 |
| C4 | 自动评分、历史结果、错题 | 三类客观题自动结算；最终总分只读；本人和管理员结果口径一致 |
| C5 | 考试记录 | 管理员只读列表、详情和结果；不采集连接、设备或切屏数据 |
| C6 | 培训统计与兼容统计 | 只统计 finalized 记录；移除待人工评分与切屏指标；原统计后端保留但隐藏菜单 |
| C7 | 瘦身后自动验证 | smoke与full-flow按实际执行证据分开登记；手动、真机、外部 AI 和部署边界不虚构 |

---

## 2. 文档导航

本目录（`docs/design/`）共 11 份 Markdown 文档：本文档 1 份、01—08 设计分册 8 份、两份 `00-旧系统-*` 需求/证据盘点文档。08 册是预约领域增量设计提案；在获批并实施前，不改变当前 41 张业务表和迁移 000—041 的现行基线。两份 `00-旧系统-*` 文档只作为旧系统参考，不参与当前设计基准。

| # | 文档 | 定位（一句话） | 目标读者 |
|---|---|---|---|
| — | README.md（本文档） | 总览索引与全套文档的一致性基准（技术栈 / 术语 / 表名 / 枚举 / 模块名） | 全体读者 |
| 01 | [01-需求分析.md](01-需求分析.md) | 业务背景、角色用例与功能 / 非功能需求的完整定义，是全部设计的源头 | 管理者、产品、评审者 |
| 02 | [02-系统架构.md](02-系统架构.md) | 总体架构分层、技术栈落地方式与 Docker Compose 部署拓扑 | 开发人员、架构评审者 |
| 03 | [03-数据库设计.md](03-数据库设计.md) | 当前41张业务表、1张迁移元数据表、完整字段/索引，以及共享兼容层边界 | 后端开发、评审者 |
| 04 | [04-API设计.md](04-API设计.md) | `/api/v1` REST 接口（含课程/视频、三类客观题题库、作答、自动评分、考试记录和培训统计）、统一信封与错误码 | 前后端开发 |
| 05 | [05-模块设计.md](05-模块设计.md) | 六大模块的职责边界、内部组成，以及自动评分、记录与统计链路 | 开发人员 |
| 06 | [06-关键流程.md](06-关键流程.md) | 端到端关键流程（解析、AI 预览确认与题库启停、学习判定、考试、评分统计）的时序与状态流转 | 开发人员、评审者 |
| 07 | [07-安全与非功能设计.md](07-安全与非功能设计.md) | 认证授权、防作弊纵深、数据安全，以及性能 / 可用性等非功能指标 | 评审者、运维 |
| 08 | [08-预约系统设计.md](08-预约系统设计.md) | 个人先支付后选场次、企业/班组 Excel/TXT 批量预约、地点/时间段/容量、支付退款、签到与考试资格衔接 | 产品、前后端、运营、评审者 |
| 旧证据 | [00-旧系统-培训机构端需求分析.md](00-旧系统-培训机构端需求分析.md)<br>[00-旧系统-学员移动端H5需求分析.md](00-旧系统-学员移动端H5需求分析.md) | 旧站取证与新增学员目标分开标记；学员H5现行范围按用户决定/Exam Contract执行，历史观察不冒充验收 | 产品、前端、测试 |

---

## 3. 设计约定速览

本节是全套文档的统一口径基准：**后续所有文档中的表名、字段命名、枚举值、角色值、模块名必须与本章逐字一致**；如需变更，须先修订本 README 再同步各分册。

### 3.1 技术栈定稿

| 分层 | 定稿选型 |
|---|---|
| 前端框架 | Vue 3 + TypeScript + Vite（状态管理 Pinia，路由 Vue Router） |
| UI 组件库 | Element Plus |
| 后端框架 | Node.js + NestJS（TypeScript） |
| 数据库 | MySQL 8.0 |
| 缓存 | Redis（用于考试计时、制度阅读会话累计、防重复提交；B2 视频锚点逐拍持久化 MySQL） |
| AI 接入 | OpenAI 兼容协议（可配置 base_url / api_key / model，兼容智谱 GLM、DeepSeek、通义千问等） |
| 文件解析 | pdf-parse（PDF 文本提取）+ mammoth（Word 转 HTML） |
| 在线阅读器 | pdfjs-dist |
| 认证与权限 | JWT + RBAC |
| 部署 | Docker Compose（nginx + api + mysql + redis） |

### 3.2 核心术语表

以下术语在全套文档中统一口径使用（括号内为对应数据实体 / 字段）：

| 术语 | 精确定义 |
|---|---|
| 制度 | 由制度管理员创建并管理的企业规章条目（regulation），含标题、分类、状态（draft/published/archived）、当前生效版本（current_version_id）、规定有效学习时长阈值（required_minutes）与滚动分段数（scroll_segments），是员工学习与考核的对象。 |
| 制度版本 | 制度文件每次上传生成的不可变版本记录（regulation_version），保存文件本体（file_path / file_type / file_hash）与解析产物（content_html / text_content）及解析状态；同一制度可有多个版本，生效版本由 current_version_id 指定。 |
| 发布范围 | 制度面向的员工集合，由 regulation_scope 按部门（department_id）圈定，或以 is_all 表示面向全员；发布范围决定「应学人数」的统计口径。 |
| 有效学习 | 同时满足两个条件的学习达标状态：① 累计有效学习时长 ≥ 制度规定的 required_minutes；② 滚动覆盖率覆盖到底部段。两条件缺一不可；达标后 learning_record.is_valid 置真并记录 valid_at。 |
| 学习会话 | 用户一次进入制度阅读页到离开的连续阅读记录（learning_session：started_at / ended_at / duration_seconds）；会话时长经容差校验后累加至 learning_record.total_seconds。 |
| 培训课程 | 按一个培训类别组织的学习内容（training_course），状态为 draft / published / offline；课程可推荐、排序、配置封面与可选制度信息关联，但制度关联不构成抽题池或学习门槛。 |
| 课程章节与视频课时 | course_chapter 与 course_lesson 分别排序；本期课时类型仅 video。发布后的媒体替换追加 lesson_version 并更新 current_version_id，旧版本不可原地改写。 |
| 视频学习记录与会话 | video_learning_record 按用户+不可变课时版本保存有效时长、去重覆盖、断点与完成；video_learning_session 保存递增序号及服务端锚点，重启可恢复。 |
| 心跳上报 | 默认每 30 秒上报。制度阅读携带滚动段位并用 Redis 累计；视频携带递增 seq、position_ms 与播放状态并逐拍落库。视频先按完整服务端间隔 +2 秒判断跳播，再把单次确认封顶 45 秒；暂停/后台不计。 |
| 滚动覆盖率 | 阅读内容按固定 10 段划分、以 JSON 位图记录的已读到位情况（learning_record.scroll_coverage）；其中底部段必须被覆盖，是「有效学习」的必要条件之一。 |
| 考试资格 | legacy 制度固定卷仍必须完成有效学习并返回原差距详情。新training移动首次开考校验mobile employee/权威实名、发布、启用类别及首次来源/类别匹配，默认不检查学习门槛；有效 active 恢复优先，撤回/历史归档记录只阻新开，培训卷支持撤回发布，归档及legacy状态写入口继续退场。 |
| 试题 | 题库稳定身份（question）与不可变 question_version。支持 single/multiple/judgment、当前两档启用且历史中级保留、`ai/manual/import` 来源；人工、文件和参考题 AI 确认后直接启用，兼容status=approved但审核元数据NULL、无新考点或题库分值。发布冻结通过启用校验的精确当前版本，后续修订不改写 release；旧题未知类别、难度与审核事实保持未知。 |
| 试卷 | `exam_paper.business_scope` 区分制度 `regulation` 与新 `training`。培训卷底层保留 fixed/random、类别、历史制度筛选、可选考前学习课程/累计分钟、管理备注、管理排序和可配置目标总分（默认100分；发布快照以整数分币冻结）；PC 直接展示培训试卷单列表，按sort_order小值优先、同值id降序，移除历史固定卷 Tab/筛选/管理详情及旧 scope=regulation 页面入口；新建统一固定题单，隐藏组卷模式筛选/选择及随机复制入口，不集成自动选题工具；升级后新发布的制度卷和培训卷都通过 paper_release/paper_release_question 不可变冻结，所有新 fixed 发布按 `question_id` 禁止重复题目身份，培训卷可撤回草稿修改后发布新版本，制度卷改动仍需复制新草稿。真正升级前published无release的制度卷保持兼容。既有随机release明确使用historical-concept模式，按冻结concept分组、无concept回退question_id，预览与开考保持历史语义。 |
| 试卷发布版本 | `paper_release` 冻结 RuleSnapshot、类别及关联条件；`paper_release_question` 冻结通过启用校验的真实精确题目版本、卷内实际分值与完整内容；考点仅旧快照兼容保留。制度旧题可保留 `categoryId=null/difficulty=unknown`。历史撤回/归档及复制不删除、不改写源快照；培训试卷恢复撤回发布，归档及 legacy 状态写入口继续退场；题图读取按固定草稿、发布快照或随机草稿完整校验后的当前候选池做精确版本与字段授权，不回读替代版本，也不为预览伪造发布引用。 |
| 个人考试归属与题单 | `exam_assignment` 冻结首次 release/source/category/difficulty/rule；补考沿用。`exam_record_question` 按每次作答冻结题面、实际分值、显示顺序和显示到原始选项映射；新答题主键是 `item_id`。 |
| 考试记录 | 用户对某试卷的一次完整作答过程（exam_record），保存冻结期限、交卷方式、评分状态与得分；draft_*仅旧兼容列。主动受理才评分，到期进入不评分的纯timeout；`ExamRecordsService` 只投影管理端记录列表和详情。 |
| 答题明细 | exam_answer只在新移动主动受理评分时保存稳定selected_option_ids及逐题得分，新纯timeout不创建答案；selected保留legacy兼容；不保存答题附件、人工评语或评分版本，最终结算后只读。 |
| 自动评分 | training 的 single/multiple/judgment 按冻结规则由 `SubmissionService.gradeSubmissionSnapshot` 在终结事务内评分并保存；旧固定卷继续使用 `GradingService`。仅主动受理成功进入manual/finalized；新纯timeout为not_submitted且方式/提交时间/评分时间均NULL。不存在待人工评分状态。 |
| 统一结果、历史与错题 | `ExamHistoryService` 从冻结题单投影交卷回执、本人/管理员结果与历史；错题仅包含 finalized 记录中的非满分题。 |
| 培训统计与分榜 | C6 实时读取当前应考集合和历史开考事实；成绩只取当前 release、相同冻结规则、指定难度、finalized 的个人最高分，同分并列；排名 Excel 使用同一筛选与当前分页。 |
| 试题与选项乱序 | 同一试卷对每位考生呈现时，题目顺序与选项顺序均随机打乱以防抄袭；新v2按冻结稳定answer_option_ids评分，乱序不改变ID；legacy数字下标仅按旧冻结快照适配。 |
| 补考 | 员工未通过考试后的再次作答机制；次数受试卷 max_attempts 限制（默认 3 次），同一试卷多次作答取最高分作为最终成绩。 |

### 3.3 核心实体清单

当前源码有41张业务表，表名及其字段必须与 migration、`database/init.sql`、entities 和 [03-数据库设计.md](03-数据库设计.md) 同步；另有不计入业务表清单的 `schema_migration` 元数据表，合计42张物理表。旧制度、学习和固定卷依赖的共享表继续保留，瘦身迁移删除 `exam_review_event` 并收缩考试/题库专用字段。

**组织权限域（2 张）**

| 表名 | 一句话职责 |
|---|---|
| sys_department | 部门树结构（parent_id 自关联），是员工归属、发布范围与统计维度的组织基础。 |
| sys_user | 员工账号与身份（用户名、密码哈希、姓名、工号、部门、角色、状态等），承载登录认证与 RBAC 角色信息。 |

**学员实名域（2张，020）**

| 表名 | 一句话职责 |
|---|---|
| learner_identity | 已验证的学员实名事实；姓名/证件加密，证件HMAC查重，不改变来源、类别或历史考试。 |
| identity_verification_session | 三图持久核验会话、claim/lease、受控Provider结果与恢复绑定；不提供运行时mock/test-pass。 |

**制度域（3 张）**

| 表名 | 一句话职责 |
|---|---|
| regulation | 制度主档：保留 legacy `category` 字符串，并可选关联培训 `category_id`；其余含状态、当前生效版本与原制度阅读要求。 |
| regulation_version | 制度版本：每次上传的文件（file_path / file_type / file_hash）及解析产物（content_html / text_content）、解析状态（pending/parsed/failed）、解析完成时刻（parsed_at）与重试计数（retry_count）。 |
| regulation_scope | 发布范围：制度与部门的关联（department_id），支持 is_all 全员标记。 |

**学习域（2 张）**

| 表名 | 一句话职责 |
|---|---|
| learning_session | 学习会话：用户一次连续阅读的起止时间与时长（duration_seconds），是有效学习时长的累计来源。 |
| learning_record | 学习汇总：累计有效时长（total_seconds）、最大滚动百分比（max_scroll_percent）、滚动覆盖位图（scroll_coverage）及「有效学习」判定结果（is_valid / valid_at）。 |

**考试、版本题库、发布与个人题单域（5 张 legacy + 2 张 B3 + 2 张 C1 + 2 张 C2 + 1 张作者回执）**

| 表名 | 一句话职责 |
|---|---|
| question | 试题稳定身份及 legacy 兼容投影：三类客观题、难度、类别、is_enabled、当前版本指针与021的content_schema_version/content_json，并保留旧固定卷兼容投影。 |
| question_concept | 历史考点目录：保留原表及引用，不提供新 CRUD，不参与新题、新组卷与新发布。 |
| question_version | 不可变试题版本：保存题型、难度、题干、选项、答案、解析与来源；旧分值、考点、页组及审核事实兼容保留，新版本不写概念、分值或审核事实；同题修订只追加 revision。 |
| question_authoring_commit | 022 新增作者提交持久回执；owner/request 唯一，保存摘要和精确版本结果，与题目版本同事务提交，无短期 TTL。 |
| exam_paper | 试卷配置：保留 legacy 制度固定卷；新增 business_scope/mode/category/requires_learning、历史制度筛选、考前学习课程/累计分钟、管理备注、管理排序、创建/最后更新操作者与随机规则。 |
| paper_question | 试卷与试题的关联；保存 question_id/question_version_id/sort/score。旧 concept_id 只读兼容保留，新关联与新发布不写考点。 |
| paper_release | 不可变发布主档：按试卷递增版次，冻结业务范围、类别、模式、规则、学习门槛与条件关联。 |
| paper_release_question | 不可变发布题池：冻结通过启用校验的题目精确版本、题型/难度、卷内实际整数分与完整内容 JSON；旧考点只读保留。 |
| exam_assignment | 同一试卷同一学员的冻结归属：首次 release、来源、类别、难度及规则；补考不重算。 |
| exam_record | 考试记录：用户第 N 次作答、冻结归属/规则、唯一活动 assignment、状态、服务端截止、交卷方式、自动结算状态与得分；draft_*只作legacy兼容。 |
| exam_record_question | 本次个人题单：冻结题目版本内容、实际分值、显示位置与选项映射；题干/选项题图按 item 精确授权。 |
| exam_answer | 主动整卷最终答案与评分：v2保存selected_option_ids；legacy selected兼容；新纯timeout不创建行。 |

**培训身份与导入域（2 张，A2）**

| 表名 | 一句话职责 |
|---|---|
| training_category | 培训类别：名称唯一、启停保留历史引用，供学员资料与后续培训业务归类。 |
| import_batch | 可恢复导入批次：`students/questions/questions_ai` 分别隔离学员、普通导题与参考题 AI 生成题；保存规范化生成行/错误及首次确认结果，不保存明文口令或 AI 参考原文件/正文。`questions_ai` 未确认批次 24 小时有效，已确认回执不按此期限失效。 |

**可配置权限与会话域（5 张，A3）**

| 表名 | 一句话职责 |
|---|---|
| sys_role | 机构业务角色目录；系统角色受保护。 |
| sys_permission | 服务端注册的权限代码白名单。 |
| sys_role_permission | 业务角色与权限的复合唯一关系。 |
| sys_user_role | 用户与业务角色的复合唯一关系；与 `sys_user.role` 系统身份分离。 |
| auth_session | 可吊销浏览器会话，保存 sid、活动时间、到期时间与吊销状态。 |

**受控媒体域（3 张，A4 + 033）**

| 表名 | 一句话职责 |
|---|---|
| media_asset | 私有媒体资源：服务端存储键、实际类型/大小/哈希/时长、处理与内部删除重试状态。 |
| media_reference | 媒体业务引用：按已注册 owner type 关联业务实体并保护在用资源。 |
| media_upload_session | 持久直传会话、受限授权截止、claim/lease、候选对象和完成回执；30天后保留请求墓碑。 |

**课程内容域（4 张，B1）**

| 表名 | 一句话职责 |
|---|---|
| training_course | 课程主档：类别、封面、简介、推荐、排序、状态与可选制度信息关联。 |
| course_chapter | 课程章节及独立顺序。 |
| course_lesson | 视频课时、必学标记、章节/课程归属、顺序与当前内容版本指针。 |
| lesson_version | 不可变视频内容版本：媒体资源、服务端探测时长与版本号。 |

**视频学习域（2 张，B2）**

| 表名 | 一句话职责 |
|---|---|
| video_learning_record | 按用户+课时版本保存累计有效时长、去重覆盖区间、确认断点与 95% 完成事实。 |
| video_learning_session | 可恢复视频会话：活动所有者、服务端心跳时刻、递增序号、位置/状态锚点与收口时间。 |

**后台公共配置域（4 张，A5 与 037）**

| 表名 | 一句话职责 |
|---|---|
| sys_menu | 后台目录/菜单/按钮树；路由和权限只能从服务端白名单中选择。 |
| sys_dictionary_type | 一级字典分类的名称、描述及稳定标识；空分类独立保留，内置分类可改展示信息但禁删。 |
| sys_dictionary | 显示字典；引用已有分类，`is_system=1` 的业务固定枚举只读，不改变业务语义。 |
| site_setting | 站点公开展示白名单，当前仅 `logo_asset_id` 与最多 3 张 `banners`。 |

### 3.4 统一命名规范

**数据库命名**

- 表名与字段名一律使用小写 snake_case。
- 当前表名严格使用 3.3 节清单中的 39 个业务表名称；旧迁移不可改写，现行 schema 由 015 后继迁移收缩。`schema_migration` 不计入业务表，精确结构见 03 册 1.10。后续变更继续遵循“迁移脚本 → `database/init.sql` → entities → 设计分册 → API/controller”同步政策，不能由文档另造第二定义。

**API 命名**

- REST 风格，统一前缀 `/api/v1`。
- 现行管理路由含 `/admin/training-categories`、`/admin/students`、`/admin/administrators`、`/admin/questions`、`/admin/question-materials`、`/admin/courses`、`/admin/papers`、`/admin/exam-records`、`/statistics/training`、`/admin/dashboard`；学员路由含 `/me` 下的考试、历史、错题、首页、课程和视频学习。`/learning`、`/exams`、`/statistics` 与只读制度内容接口继续兼容旧链路，但不恢复已删除的管理入口。
- 路由与模块的对应关系固定如下：

| 模块（固定名称） | 路由前缀 |
|---|---|
| 1. 组织权限与后台公共模块 | `/auth`、`/admin/training-categories`、`/admin/students`、`/admin/administrators`、`/admin`、`/me`、`/media`、`/site-config` |
| 2. 资料与旧制度只读兼容模块 | `/admin/question-materials`、`/regulations/{id}/content`、`/regulations/{id}/content/file` |
| 3. AI 出题模块 | `/ai`、`/admin/questions` |
| 4. 学习行为管控模块 | `/learning`、`/admin/courses`、`/me/courses`、`/me/home`、`/me/video-sessions`、`/me/video-records` |
| 5. 考试评分模块 | `/exams`、`/me/exams`、`/me/exam-records`、`/me/wrong-questions`、`/admin/exam-records` |
| 6. 统计报表模块 | `/statistics`、`/statistics/training`、`/admin/dashboard` |

**统一响应与错误码**

- 响应体固定为 `{ code, message, data }`；`code = 0` 表示成功。
- 错误码分段：40xxx 为客户端错误，50xxx 为服务端错误（详见 [04-API设计.md](04-API设计.md)）。

**角色枚举（sys_user.role）**

| 枚举值 | 含义 |
|---|---|
| super_admin | 超级管理员 |
| regulation_admin | 制度管理员 |
| employee | 普通员工 |

**状态枚举总表**

| 所属字段 | 枚举值 | 含义 |
|---|---|---|
| regulation.status | draft / published / archived | 制度状态：草稿 / 已发布 / 已归档 |
| regulation_version.file_type | pdf / docx | 上传文件类型 |
| regulation_version.parse_status | pending / parsed / failed | 解析状态：待解析 / 已解析 / 解析失败 |
| question.type / question_version.type | single / multiple / judgment | 题型：单选题 / 多选题 / 判断题 |
| question.difficulty / question_version.difficulty | easy / medium / hard | 当前简单easy / 困难hard启用；历史中级medium停用但可读，旧题未知可为NULL，不自动改值 |
| question.is_enabled | 1 / 0 | 当前启用／停用权威状态；026将历史approved映射1，其它映射0 |
| question.status / question_version.status | pending / approved / rejected | 历史兼容状态；新版本approved，不再驱动审核流程，真实旧审核事实不重写 |
| question.source / question_version.source | ai / manual / import | 试题来源：AI 生成 / 人工录入 / 导入 |
| training_course.status | draft / published / offline | 课程状态：草稿 / 已上架 / 已下架 |
| course_lesson.lesson_type | video | B1 本期仅视频课时 |
| video_learning_session.anchor_state | playing / paused / buffering / background / ended | B2 视频播放状态锚点 |
| exam_paper.business_scope | regulation / training | 制度专项 legacy 卷 / 新培训发布卷 |
| exam_paper.mode | fixed / random | 固定题单 / 按规则随机题池 |
| exam_paper.status | draft / published；withdrawn / archived 仅历史兼容 | 培训试卷：草稿 → 已发布 → 草稿（撤回）；041将既有training withdrawn转草稿，legacy不开放撤回 |
| exam_paper.sort_order | 0—2147483647 | 仅培训试卷管理排序；小值在前，同值id降序，legacy接口不使用 |
| exam_record.status | in_progress / submitted / passed / failed / timeout | 进行中 / 历史已交卷待确认 / 已通过 / 未通过 / 超时未交卷；旧已评分timeout保留历史事实 |
| exam_record.grading_state | not_submitted / finalized | 未交卷 / 已自动最终结算 |
| exam_record.submission_method | manual / timeout / NULL | 主动交卷 / 历史已评分超时方式 / 新纯timeout未交卷或legacy历史方式未知 |
| media_asset.status | processing / ready / failed / deleting | 媒体状态；`deleting` 仅供物理删除失败重试，公开 API 按不存在处理 |
| media_upload_session.state | uploading / finalizing / completed / failed / aborted / expired | 上传会话状态；不替代业务资产和引用 |

> 上表登记当前 schema 枚举；固定字典只是显示镜像，不是新的语义来源。assignment/record 的 `mixed/unknown` 是历史冻结展示事实，不扩展题库可维护难度。新主动交卷写passed/failed + manual + finalized；新纯timeout写timeout + submission_method=NULL + not_submitted，score=0且submitted_at/graded_at=NULL，不评分、不生成答案、不进finalized成绩/排名分母。NULL不能单独判断legacy。历史submitted待确认，历史已评分timeout只读兼容并保留冻结结果/题图权限；其判据为finalized且score与submitted_at已知。

---

## 4. 阅读指引

| 读者 | 建议阅读顺序 | 阅读目的 |
|---|---|---|
| 管理者 / 决策者 | README → 01-需求分析 → 06-关键流程 → 07-安全与非功能设计 | 快速判断方案范围与风险控制是否满足业务诉求，无需深入技术细节。 |
| 开发人员 | README → 02-系统架构 → 03-数据库设计 → 04-API设计 → 05-模块设计 → 06-关键流程 → 07-安全与非功能设计 | 按「架构 → 数据 → 契约 → 模块 → 流程 → 安全」的依赖顺序建立全貌，再分工深入。 |
| 评审者 | README（对齐基准）→ 01（需求覆盖）→ 03 / 04（数据与契约一致性）→ 05 / 06（模块与流程正确性）→ 07（安全与非功能达标） | 以本 README 为基准逐层核对各分册的口径一致性与设计完整性。 |

---

## 5. 文档边界说明

- 本套文档是 EmodorRuleExam 的**设计与实现一致性基准**，描述需求、架构、数据、API、模块、流程、安全与非功能；具体可执行实现仍以仓库源码、migration、`database/init.sql` 与验收记录为准。
- 文档中的“已实现”只表示已有对应源码和明确的静态/独立验收证据，不等同于已向开发库或生产环境执行迁移，也不替代尚未完成的组合链路、真实 PC 或业务验收。
- 后续设计如需调整，须先更新本 README 的约定基准（技术栈、术语、表名、枚举、模块名），再同步修订受影响的分册文档，保证全套文档口径一致。
