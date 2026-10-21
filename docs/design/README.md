# 制度学习及考试系统（EmodorRuleExam）设计方案 · 总览索引

> **一句话定位**：本文档是 EmodorRuleExam（制度学习及考试系统）全套设计方案的入口与一致性基准。当前 legacy 基线、A2—A5、B1/B3 与 C1 不可变发布快照均按实际源码登记；B2、B4、C2—C7 及真实 PC/部署验收继续如实标注，不把源码存在写成已部署。
>
> **权威链接**：融合目标以[已批准设计](../superpowers/specs/2026-10-21-training-admin-integration-design.md)和[实施总计划](../superpowers/plans/2026-10-21-training-admin-integration.md)为准。本文及 01—07 册的“当前”描述是仓库现状基线，“计划”描述是目标方案；两者冲突时先修订本索引并标明证据等级。

---

## 1. 系统背景与目标

### 1.1 系统背景

EmodorRuleExam 当前是一套面向企业内部的制度学习与考核系统，已覆盖「制度上传 → 在线学习 → AI 出题 → 旧固定卷考试 → 统计跟进」闭环；安全培训机构融合按单家机构、PC 管理端与完整后端分阶段增量落地：

制度管理员上传制度文件（PDF/Word），系统解析为在线可阅读内容并按版本管理；对接第三方 AI 大模型（OpenAI 兼容协议，可配置 base_url/api_key/model，兼容智谱 GLM、DeepSeek、通义千问等）解读制度内容并生成单选题/多选题，管理员审核后发布。B3 题库已扩展为 `single/multiple/judgment/image` 四题型的概念与不可变版本管理，但 legacy AI 生成、固定卷组卷与自动评分链路仍只消费单选/多选。旧制度固定卷员工必须先完成「有效学习」才能获得考试资格——累计有效学习时长 ≥ 制度规定阈值，且阅读滚动覆盖到指定位置（底部），两个条件同时满足。学习与考试全程防作弊：学习侧含心跳上报（30 秒/次）、页面失焦暂停计时、服务端时长容差校验（单次心跳最大计入 45 秒）、滚动分段进度（10 段位图，底部段必须覆盖）；考试侧含试题与选项乱序、限时（超时自动交卷）、切屏检测。计划中的新培训考试默认关闭学习门槛，并新增持久草稿、图片阅卷与场次统计；服务端计时、空白答案、答案/解析不下发、令牌与 SSRF/密钥边界不变。统计覆盖单项制度维度（应学人数、学习完成率、参考人数、通过率、平均分、分数分布、未完成人员清单）、部门维度与个人维度，支持 Excel 导出。

系统涉及三类角色：super_admin（超级管理员）、regulation_admin（制度管理员）、employee（普通员工）；组织侧提供部门树、员工 CRUD 与 Excel 批量导入。

### 1.2 设计目标

1. **制度数字化**：文件「上传即可读」，版本可追溯，发布范围可按部门圈定或面向全员。
2. **出题低成本、质量可控**：AI 解读制度自动生成题目，管理员审核通过后才可入卷发布。
3. **学习真实性可保障**：以「时长 + 滚动覆盖」双条件判定有效学习，辅以心跳、失焦暂停、容差校验、分段位图四道防线防止刷时长。
4. **考试公平可量化**：资格校验、试题与选项乱序、限时超时自动交卷、切屏检测与规则化自动评分。
5. **落实情况可运营**：制度 / 部门 / 个人三维统计与 Excel 导出，未完成人员清单直达跟进闭环。

### 1.3 当前基线与批准增量

| 范围 | 当前实现基线 | 已批准目标（计划，非当前部署声明） |
|---|---|---|
| 业务边界 | 制度学习、AI 出题审核、旧固定卷员工考试、原制度/部门/个人统计；A2—A5、B1、B3 已有源码与审查证据的培训管理增量 | 单家机构 PC 管理端与完整后端；不迁移旧站数据，独立 H5 下一期；不建设租户、班级、支付或证书平台 |
| 学习 | 制度阅读双条件；服务端 30 秒心跳、单次最多计入 45 秒、10 段位图；B1 课程/章节/视频课时与不可变内容版本 | B2 视频学习进度：30 秒心跳、45 秒封顶、2 秒位置容差、95% 覆盖完成；新培训考试默认无学习门槛 |
| 学员与题库 | A2 学员类别/来源；B3 四题型、三难度、考点与不可变版本；C1 已冻结发布候选版本 | B4 Excel/TXT 导题；C2 个人题单 |
| 考试与成绩 | 旧固定卷执行链保持；C1 已有培训固定/随机配置、发布快照、预览、复制、撤回/归档 | C2 个人题单/开考；C3—C4 持久草稿、图片答案与受控阅卷 |
| 统计与监控 | 原制度/部门/个人报表 | 按场次/难度、已完成批改个人最高分、当前应考集合交集统计；5 秒轮询，90 秒无心跳仅“连接待确认” |

**实现状态规则**：目标表、字段、DTO、路由由 A1—C7 在相应 migration、entity、controller 存在后补入对应分册。当前源码包含 12 张 legacy 业务表、A2 两张、A3 五张、A4 两张、A5 三张、B1 四张、B3 两张与 C1 两张发布快照表，共 32 张业务表；另有 A1 `schema_migration`，合计 33 张物理表。这不代表已对开发库或生产库执行升级。

### 1.4 A1—C7 模块与验收进度映射

当前进度：A1—A5、B1/B3 的已验边界保持。C1 已落源固定/随机配置、`008_paper_release.sql`、不可变发布快照、`/admin/papers` 及 PC 页面；升级后新发布的制度卷也写真实 release，升级前 published 无 release 不伪造历史。自动回归证据与真实 PC 验收分开登记，本行不声称开发库/生产升级或 PC 已通过。C2 个人题单与新开考未接入，legacy 开考守卫不变。下表列各阶段最终应具备的证据，不代表所有任务已完成。

既有验收留项不因 C1 而改写：A4 伪格式/超限/头像真实 PC 补验仍留到 C7，见[证据及边界](../../review/2026-10-21-training-a4-media-acceptance.md)；B1 课程与 B3 真实 PC 仍由各 final/root 口径收口。

| owner 任务 | 目标模块/链路 | 必须留下的验收证据 |
|---|---|---|
| A1 | 基准、共享契约、迁移安全入口 | 测试库隔离；初始化与升级一致；失败可续跑；文档/代码边界清楚 |
| A2 | 培训类别、学员来源、可恢复导入 | 来源缺失/非法拒绝；批次幂等；类别与权限分离 |
| A3 | 验证码、会话、管理权限 | 撤权/下线立即生效；旧登录兼容；权限 API 与按钮一致 |
| A4 | 受控媒体与上传 | 内容探测、归属校验、引用保护；答案附件不能绕过考试规则 |
| A5 | 菜单、字典、公开配置、审计、PC 公共框架 | 配置白名单；未保存提醒；敏感值不泄露 |
| B1—B2 | 课程/视频课时与可恢复学习 | 版本、下架、重放/乱序/跳播、95% 覆盖、零必学课时口径 |
| B3—B4 | 四题型版本题库与 Excel/TXT 导题 | 难度/题型/考点校验；AI 真实来源版本；预览确认与批次幂等 |
| C1—C2 | 固定/随机发布、抽题、个人题单、旧卷适配 | 本机构初级/外来高级；同考点不重复；发布/开考快照不可变；三次机会含首次 |
| C3 | 持久草稿、图片答案、主动/超时交卷 | 截止前确认稿恢复；单题 9 图；不下发答案解析；主动/超时只结算一次 |
| C4 | 图片人工阅卷、历史结果、错题 | 单题 0..满分；审计与乐观版本；未完成不出最终成绩；最终总分只读 |
| C5 | 考试记录与只读监控 | 服务端进度；5 秒轮询；90 秒“连接待确认”；无强制交卷 |
| C6—C7 | 培训统计、排名、全链回归与交付 | 每场/难度/个人最高分及当前集合交集；旧链路回归；H5/外部 AI 未验收如实列出 |

---

## 2. 文档导航

本目录（`docs/design/`）共 10 份 Markdown 文档：本文档 1 份、01—07 设计分册 7 份、两份 `00-旧系统-*` 需求/证据盘点文档。后两份只作为旧系统参考，不参与当前设计基准。

| # | 文档 | 定位（一句话） | 目标读者 |
|---|---|---|---|
| — | README.md（本文档） | 总览索引与全套文档的一致性基准（技术栈 / 术语 / 表名 / 枚举 / 模块名） | 全体读者 |
| 01 | [01-需求分析.md](01-需求分析.md) | 业务背景、角色用例与功能 / 非功能需求的完整定义，是全部设计的源头 | 管理者、产品、评审者 |
| 02 | [02-系统架构.md](02-系统架构.md) | 总体架构分层、技术栈落地方式与 Docker Compose 部署拓扑 | 开发人员、架构评审者 |
| 03 | [03-数据库设计.md](03-数据库设计.md) | legacy + A2/A3/A4/A5/B1/B3 增量表的字段、类型、索引、约束与表间关系；后续增量仍按同步政策追加 | 后端开发、评审者 |
| 04 | [04-API设计.md](04-API设计.md) | `/api/v1` 全量 REST 接口（含受控媒体、后台系统/公开品牌配置、课程主体与版本题库）、统一响应结构 `{ code, message, data }` 与 40xxx/50xxx 错误码表 | 前后端开发 |
| 05 | [05-模块设计.md](05-模块设计.md) | 六大模块的职责边界、内部组成与关键设计决策 | 开发人员 |
| 06 | [06-关键流程.md](06-关键流程.md) | 端到端关键流程（解析、AI 出题审核、学习判定、考试、评分统计）的时序与状态流转 | 开发人员、评审者 |
| 07 | [07-安全与非功能设计.md](07-安全与非功能设计.md) | 认证授权、防作弊纵深、数据安全，以及性能 / 可用性等非功能指标 | 评审者、运维 |
| 旧证据 | [00-旧系统-培训机构端需求分析.md](00-旧系统-培训机构端需求分析.md)<br>[00-旧系统-学员移动端H5需求分析.md](00-旧系统-学员移动端H5需求分析.md) | 旧系统培训机构端与学员移动端 H5 的需求/证据盘点；作为本期融合和下一期 H5 的参考，不代表本期已实现 | 产品、前端、测试 |

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
| 缓存 | Redis（用于考试计时、学习会话累计、防重复提交） |
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
| 心跳上报 | 学习页面每 30 秒向服务端上报一次的保活信号，携带当前滚动位置；服务端进行时长容差校验，单次心跳最大计入 45 秒，超出部分不计入有效时长；页面失焦时暂停计时。 |
| 滚动覆盖率 | 阅读内容按固定 10 段划分、以 JSON 位图记录的已读到位情况（learning_record.scroll_coverage）；其中底部段必须被覆盖，是「有效学习」的必要条件之一。 |
| 考试资格 | legacy 制度固定卷仍必须完成有效学习。培训卷在 C1 配置中默认 `requires_learning=false`，但 C2 开考尚未接入；不能借此绕过 legacy guard。 |
| 试题 | 题库稳定身份（question）与不可变 question_version。B3 支持四题型、三难度与可选考点；C1 发布冻结真实 current approved version 内容，题库后续修订不改写 release。制度卷选题/评分仍只消费 single/multiple；旧题未知类别、难度及审核事实不伪造。 |
| 试卷 | `exam_paper.business_scope` 区分制度 `regulation` 与新 `training`。培训卷支持 fixed/random、类别、可选制度筛选、课程说明关联和 10000 整数分规则；升级后新发布的制度卷和培训卷都通过 paper_release/paper_release_question 不可变冻结，所有新 fixed 发布按 `concept_id ?? question_id` 禁止重复考点，改动需复制新草稿。真正升级前 published 无 release 的制度卷保持兼容。 |
| 试卷发布版本 | `paper_release` 冻结 RuleSnapshot、类别及关联条件；`paper_release_question` 冻结真实题目版本、考点、实际分值与完整内容。制度旧题可保留 `categoryId=null/difficulty=unknown`。撤回/归档或复制不删除、不改写源快照；题图读取按固定草稿、发布快照或随机草稿完整校验后的当前候选池做精确版本与字段授权，不回读替代版本，也不为预览伪造发布引用。 |
| 考试记录 | 用户对某试卷的一次完整作答过程（exam_record），含第几次作答（attempt_no）、状态（in_progress / submitted / passed / failed / timeout）、得分与切屏次数（switch_count）；超时未交卷由系统自动交卷，状态记为 timeout。 |
| 答题明细 | 考试记录内逐题的作答结果（exam_answer），含所选选项（selected）、是否正确（is_correct）与实际得分（gained_score）；判分规则见「自动评分」。 |
| 自动评分 | 交卷后系统按固定规则评分：单选题答案唯一，答对得该题分值；多选题全对得满分、错选得 0 分、漏选按配置得部分分（默认 50%）。 |
| 试题与选项乱序 | 同一试卷对每位考生呈现时，题目顺序与选项顺序均随机打乱以防抄袭；判分始终以题目原始答案语义为准。 |
| 切屏检测 | 考试过程中检测考生离开考试页面的行为，累计记入 exam_record.switch_count，用于监考与风控。 |
| 补考 | 员工未通过考试后的再次作答机制；次数受试卷 max_attempts 限制（默认 3 次），同一试卷多次作答取最高分作为最终成绩。 |

### 3.3 核心实体清单

当前源码有 32 张业务表，表名及其字段必须与 migration、`database/init.sql`、entities 和 [03-数据库设计.md](03-数据库设计.md) 同步；另有 A1 `schema_migration`，合计 33 张物理表。以下 12 张 legacy 表保持兼容，A2—A5、B1/B3 与 C1 增量按实际源码登记。

**组织权限域（2 张）**

| 表名 | 一句话职责 |
|---|---|
| sys_department | 部门树结构（parent_id 自关联），是员工归属、发布范围与统计维度的组织基础。 |
| sys_user | 员工账号与身份（用户名、密码哈希、姓名、工号、部门、角色、状态等），承载登录认证与 RBAC 角色信息。 |

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

**考试、版本题库与发布域（5 张 legacy + 2 张 B3 + 2 张 C1）**

| 表名 | 一句话职责 |
|---|---|
| question | 试题稳定身份及 legacy 兼容投影：四题型、难度、类别、可选考点、当前版本指针，并保留旧固定卷仍读取的题干/选项/答案/分值等字段。 |
| question_concept | 考点目录：在培训类别与题型范围内名称唯一，可被试题版本选择性关联。 |
| question_version | 不可变试题版本：保存题型、难度、题干、选项、答案、解析、分值、考点、制度/制度版本来源、页组与审核快照；同题修订只追加 revision。 |
| exam_paper | 试卷配置：保留 legacy 制度固定卷；新增 business_scope/mode/category/requires_learning、可选制度筛选、课程说明关联与随机规则。 |
| paper_question | 试卷与试题的关联；保留 question_id/sort/score，training fixed 及升级后制度卷发布/复制额外保留 question_version_id/concept_id。 |
| paper_release | 不可变发布主档：按试卷递增版次，冻结业务范围、类别、模式、规则、学习门槛与条件关联。 |
| paper_release_question | 不可变发布题池：冻结题目/版本/考点、题型/难度、实际整数分与完整内容 JSON。 |
| exam_record | 考试记录：用户第 N 次作答（attempt_no）、状态（in_progress/submitted/passed/failed/timeout）、得分与切屏次数（switch_count）、交卷截止时刻快照（deadline_at）。 |
| exam_answer | 答题明细：考试记录内逐题的所选选项（selected）、判对（is_correct）与得分（gained_score）。 |

**培训身份与导入域（2 张，A2）**

| 表名 | 一句话职责 |
|---|---|
| training_category | 培训类别：名称唯一、启停保留历史引用，供学员资料与后续培训业务归类。 |
| import_batch | 可恢复导入批次：保存脱敏输入指纹、规范化行、预检错误及首次确认结果；不保存明文口令。 |

**可配置权限与会话域（5 张，A3）**

| 表名 | 一句话职责 |
|---|---|
| sys_role | 机构业务角色目录；系统角色受保护。 |
| sys_permission | 服务端注册的权限代码白名单。 |
| sys_role_permission | 业务角色与权限的复合唯一关系。 |
| sys_user_role | 用户与业务角色的复合唯一关系；与 `sys_user.role` 系统身份分离。 |
| auth_session | 可吊销浏览器会话，保存 sid、活动时间、到期时间与吊销状态。 |

**受控媒体域（2 张，A4）**

| 表名 | 一句话职责 |
|---|---|
| media_asset | 私有媒体资源：服务端存储键、实际类型/大小/哈希/时长、处理与内部删除重试状态。 |
| media_reference | 媒体业务引用：按已注册 owner type 关联业务实体并保护在用资源。 |

**课程内容域（4 张，B1）**

| 表名 | 一句话职责 |
|---|---|
| training_course | 课程主档：类别、封面、简介、推荐、排序、状态与可选制度信息关联。 |
| course_chapter | 课程章节及独立顺序。 |
| course_lesson | 视频课时、必学标记、章节/课程归属、顺序与当前内容版本指针。 |
| lesson_version | 不可变视频内容版本：媒体资源、服务端探测时长与版本号。 |

**后台公共配置域（3 张，A5）**

| 表名 | 一句话职责 |
|---|---|
| sys_menu | 后台目录/菜单/按钮树；路由和权限只能从服务端白名单中选择。 |
| sys_dictionary | 显示字典；`is_system=1` 的业务固定枚举只读，不改变业务语义。 |
| site_setting | 站点公开展示白名单，当前仅 `logo_asset_id` 与最多 3 张 `banners`。 |

### 3.4 统一命名规范

**数据库命名**

- 表名与字段名一律使用小写 snake_case。
- 当前表名严格使用 3.3 节清单中的 32 个业务表名称；12 张 legacy 表不改名或删改，A2—A5、B1/B3、C1 增量按版本化 migration 演进。A1 `schema_migration` 不计入业务表。后续新表继续遵循“迁移脚本 → `database/init.sql` → entities → 设计分册 → API/controller”同步政策。

**API 命名**

- REST 风格，统一前缀 `/api/v1`。
- legacy 模块路由：`/auth`、`/users`、`/departments`、`/regulations`、`/learning`、`/exams`、`/statistics`、`/ai`；已实现增量另含 `/admin/training-categories`、`/admin/students`、`/admin/courses`、C1 `/admin/papers`、`/admin` 系统路由、`/me`、`/me/courses`、`/media` 与 `/site-config`。
- 路由与模块的对应关系固定如下：

| 模块（固定名称） | 路由前缀 |
|---|---|
| 1. 组织权限与后台公共模块 | `/auth`、`/users`、`/departments`、`/admin/training-categories`、`/admin/students`、`/admin`、`/me`、`/media`、`/site-config` |
| 2. 制度文件管理模块 | `/regulations` |
| 3. AI 出题模块 | `/ai` |
| 4. 学习行为管控模块 | `/learning`、`/admin/courses`、`/me/courses`、`/me/home` |
| 5. 考试评分模块 | `/exams` |
| 6. 统计报表模块 | `/statistics` |

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
| question.type / question_version.type | single / multiple / judgment / image | 题型：单选题 / 多选题 / 判断题 / 图片题；legacy 固定卷链路仍只消费 single/multiple |
| question.difficulty / question_version.difficulty | easy / medium / hard | 难度：初级 / 中级 / 高级；旧题未确认时可为 NULL |
| question.status | pending / approved / rejected | 审核状态：待审核 / 已通过 / 已驳回 |
| question_version.status | pending / approved / rejected | 不可变版本审核快照：待审核 / 已通过 / 已驳回 |
| question.source / question_version.source | ai / manual / import | 试题来源：AI 生成 / 人工录入 / 导入 |
| training_course.status | draft / published / offline | 课程状态：草稿 / 已上架 / 已下架 |
| course_lesson.lesson_type | video | B1 本期仅视频课时 |
| exam_paper.business_scope | regulation / training | 制度专项 legacy 卷 / 新培训发布卷 |
| exam_paper.mode | fixed / random | 固定题单 / 按规则随机题池 |
| exam_paper.status | draft / published / withdrawn / archived | 试卷状态；legacy 不使用 withdrawn |
| exam_record.status | in_progress / submitted / passed / failed / timeout | 考试状态：进行中 / 已交卷 / 已通过 / 未通过 / 超时自动交卷 |
| media_asset.status | processing / ready / failed / deleting | 媒体状态；`deleting` 仅供物理删除失败重试，公开 API 按不存在处理 |

> 上表登记 legacy 与 A2—A5、B1/B3、C1 已落地枚举。A5 固定字典是显示镜像，不是语义来源。B4 导入、C2 个人题单、C3 草稿及 C4 阅卷状态仍是后续契约。

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
