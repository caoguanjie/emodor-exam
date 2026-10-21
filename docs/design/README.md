# 制度学习及考试系统（RuleExam）设计方案 · 总览索引

> **一句话定位**：本文档是 RuleExam（制度学习及考试系统）全套设计方案的入口与一致性基准——汇总系统背景、9 份文档导航、技术栈定稿、核心术语、数据实体清单与统一命名约定，其余 8 份设计分册均以本文档为口径对齐基准编写。

---

## 1. 系统背景与目标

### 1.1 系统背景

RuleExam 是一套面向企业内部的制度学习与考核系统，覆盖「制度上传 → 在线学习 → AI 出题 → 考试评分 → 统计跟进」的完整闭环：

制度管理员上传制度文件（PDF/Word），系统解析为在线可阅读内容并按版本管理；对接第三方 AI 大模型（OpenAI 兼容协议，可配置 base_url/api_key/model，兼容智谱 GLM、DeepSeek、通义千问等）解读制度内容并生成考试题目（单选题/多选题，100 分制），管理员审核后发布。员工必须先完成「有效学习」才能获得考试资格——累计有效学习时长 ≥ 制度规定阈值，且阅读滚动覆盖到指定位置（底部），两个条件同时满足。学习与考试全程防作弊：学习侧含心跳上报（30 秒/次）、页面失焦暂停计时、服务端时长容差校验（单次心跳最大计入 45 秒）、滚动分段进度（10 段位图，底部段必须覆盖）；考试侧含试题与选项乱序、限时（超时自动交卷）、切屏检测。评分全自动：单选唯一答案；多选全对满分、错选 0 分、漏选按配置得部分分（默认 50%）；及格线默认 60 分、可配置，补考次数可配置（默认 3 次）、取最高分。统计覆盖单项制度维度（应学人数、学习完成率、参考人数、通过率、平均分、分数分布、未完成人员清单）、部门维度与个人维度，支持 Excel 导出。

系统涉及三类角色：super_admin（超级管理员）、regulation_admin（制度管理员）、employee（普通员工）；组织侧提供部门树、员工 CRUD 与 Excel 批量导入。

### 1.2 设计目标

1. **制度数字化**：文件「上传即可读」，版本可追溯，发布范围可按部门圈定或面向全员。
2. **出题低成本、质量可控**：AI 解读制度自动生成题目，管理员审核通过后才可入卷发布。
3. **学习真实性可保障**：以「时长 + 滚动覆盖」双条件判定有效学习，辅以心跳、失焦暂停、容差校验、分段位图四道防线防止刷时长。
4. **考试公平可量化**：资格校验、试题与选项乱序、限时超时自动交卷、切屏检测与规则化自动评分。
5. **落实情况可运营**：制度 / 部门 / 个人三维统计与 Excel 导出，未完成人员清单直达跟进闭环。

---

## 2. 文档导航

本目录（`docs/design/`）共 9 份文档，组织如下（01–08 为设计分册，与本文档共同构成完整设计方案）：

| # | 文档 | 定位（一句话） | 目标读者 |
|---|---|---|---|
| — | README.md（本文档） | 总览索引与全套文档的一致性基准（技术栈 / 术语 / 表名 / 枚举 / 模块名） | 全体读者 |
| 01 | [01-需求分析.md](01-需求分析.md) | 业务背景、角色用例与功能 / 非功能需求的完整定义，是全部设计的源头 | 管理者、产品、评审者 |
| 02 | [02-系统架构.md](02-系统架构.md) | 总体架构分层、技术栈落地方式与 Docker Compose 部署拓扑 | 开发人员、架构评审者 |
| 03 | [03-数据库设计.md](03-数据库设计.md) | 12 张数据表的完整字段、类型、索引、约束与表间关系 | 后端开发、评审者 |
| 04 | [04-API设计.md](04-API设计.md) | `/api/v1` 全量 REST 接口契约、统一响应结构 `{ code, message, data }` 与 40xxx/50xxx 错误码表 | 前后端开发 |
| 05 | [05-模块设计.md](05-模块设计.md) | 六大模块的职责边界、内部组成与关键设计决策 | 开发人员 |
| 06 | [06-关键流程.md](06-关键流程.md) | 端到端关键流程（解析、AI 出题审核、学习判定、考试、评分统计）的时序与状态流转 | 开发人员、评审者 |
| 07 | [07-安全与非功能设计.md](07-安全与非功能设计.md) | 认证授权、防作弊纵深、数据安全，以及性能 / 可用性等非功能指标 | 评审者、运维 |
| 08 | [08-学员移动端H5需求分析.md](08-学员移动端H5需求分析.md) | 学员移动端 H5 的页面、学习、考试、复习、个人中心与移动端验收需求 | 产品、前端、测试 |

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
| 心跳上报 | 学习页面每 30 秒向服务端上报一次的保活信号，携带当前滚动位置；服务端进行时长容差校验，单次心跳最大计入 45 秒，超出部分不计入有效时长；页面失焦时暂停计时。 |
| 滚动覆盖率 | 阅读内容按固定 10 段划分、以 JSON 位图记录的已读到位情况（learning_record.scroll_coverage）；其中底部段必须被覆盖，是「有效学习」的必要条件之一。 |
| 考试资格 | 员工参加某制度考试的前置条件：该员工在该制度上的学习已达「有效学习」标准；资格校验发生在发起考试时。 |
| 试题 | 题库中的最小考核单元（question），题型为单选（single，唯一答案）或多选（multiple，多答案）；来源分 AI 生成（ai）与人工录入（manual），AI 生成的试题须管理员审核（approved）后方可入卷。 |
| 试卷 | 针对某制度发布的考试载体（exam_paper），固定 100 分制，含及格线（pass_score，默认 60 分、可配置）、限时（duration_minutes，超时自动交卷）、最大补考次数（max_attempts，默认 3 次）、多选漏选部分分比例（partial_credit_ratio，默认 0.50，可配置）；通过 paper_question 组卷。 |
| 考试记录 | 用户对某试卷的一次完整作答过程（exam_record），含第几次作答（attempt_no）、状态（in_progress / submitted / passed / failed / timeout）、得分与切屏次数（switch_count）；超时未交卷由系统自动交卷，状态记为 timeout。 |
| 答题明细 | 考试记录内逐题的作答结果（exam_answer），含所选选项（selected）、是否正确（is_correct）与实际得分（gained_score）；判分规则见「自动评分」。 |
| 自动评分 | 交卷后系统按固定规则评分：单选题答案唯一，答对得该题分值；多选题全对得满分、错选得 0 分、漏选按配置得部分分（默认 50%）。 |
| 试题与选项乱序 | 同一试卷对每位考生呈现时，题目顺序与选项顺序均随机打乱以防抄袭；判分始终以题目原始答案语义为准。 |
| 切屏检测 | 考试过程中检测考生离开考试页面的行为，累计记入 exam_record.switch_count，用于监考与风控。 |
| 补考 | 员工未通过考试后的再次作答机制；次数受试卷 max_attempts 限制（默认 3 次），同一试卷多次作答取最高分作为最终成绩。 |

### 3.3 核心实体清单

全部数据表共 12 张，表名**逐字固定**（完整字段定义见 [03-数据库设计.md](03-数据库设计.md)，须与本清单及 3.4 枚举保持一致）：

**组织权限域（2 张）**

| 表名 | 一句话职责 |
|---|---|
| sys_department | 部门树结构（parent_id 自关联），是员工归属、发布范围与统计维度的组织基础。 |
| sys_user | 员工账号与身份（用户名、密码哈希、姓名、工号、部门、角色、状态等），承载登录认证与 RBAC 角色信息。 |

**制度域（3 张）**

| 表名 | 一句话职责 |
|---|---|
| regulation | 制度主档：标题、分类、状态（draft/published/archived）、当前生效版本、规定有效学习时长（required_minutes）、滚动分段数（scroll_segments）等。 |
| regulation_version | 制度版本：每次上传的文件（file_path / file_type / file_hash）及解析产物（content_html / text_content）、解析状态（pending/parsed/failed）、解析完成时刻（parsed_at）与重试计数（retry_count）。 |
| regulation_scope | 发布范围：制度与部门的关联（department_id），支持 is_all 全员标记。 |

**学习域（2 张）**

| 表名 | 一句话职责 |
|---|---|
| learning_session | 学习会话：用户一次连续阅读的起止时间与时长（duration_seconds），是有效学习时长的累计来源。 |
| learning_record | 学习汇总：累计有效时长（total_seconds）、最大滚动百分比（max_scroll_percent）、滚动覆盖位图（scroll_coverage）及「有效学习」判定结果（is_valid / valid_at）。 |

**考试域（5 张）**

| 表名 | 一句话职责 |
|---|---|
| question | 试题库：题型（single/multiple）、题干、选项、答案、解析、分值、审核状态（pending/approved/rejected）与来源（ai/manual）。 |
| exam_paper | 试卷：针对某制度的考试配置——总分（100 分制）、及格线（默认 60）、限时、最大补考次数（默认 3）、多选漏选部分分比例（partial_credit_ratio，默认 0.50）、状态（draft/published/archived）。 |
| paper_question | 试卷与试题的关联：组卷顺序（sort）与每题分值（score）。 |
| exam_record | 考试记录：用户第 N 次作答（attempt_no）、状态（in_progress/submitted/passed/failed/timeout）、得分与切屏次数（switch_count）、交卷截止时刻快照（deadline_at）。 |
| exam_answer | 答题明细：考试记录内逐题的所选选项（selected）、判对（is_correct）与得分（gained_score）。 |

### 3.4 统一命名规范

**数据库命名**

- 表名与字段名一律使用小写 snake_case。
- 表名严格使用 3.3 节清单中的 12 个名称，不得增删改；新增表须先修订本 README。

**API 命名**

- REST 风格，统一前缀 `/api/v1`。
- 模块路由：`/auth`、`/users`、`/departments`、`/regulations`、`/learning`、`/exams`、`/statistics`、`/ai`。
- 路由与模块的对应关系固定如下：

| 模块（固定名称） | 路由前缀 |
|---|---|
| 1. 组织权限模块 | `/auth`、`/users`、`/departments` |
| 2. 制度文件管理模块 | `/regulations` |
| 3. AI 出题模块 | `/ai` |
| 4. 学习行为管控模块 | `/learning` |
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
| question.type | single / multiple | 题型：单选题 / 多选题 |
| question.status | pending / approved / rejected | 审核状态：待审核 / 已通过 / 已驳回 |
| question.source | ai / manual | 试题来源：AI 生成 / 人工录入 |
| exam_paper.status | draft / published / archived | 试卷状态：草稿 / 已发布 / 已归档 |
| exam_record.status | in_progress / submitted / passed / failed / timeout | 考试状态：进行中 / 已交卷 / 已通过 / 未通过 / 超时自动交卷 |

---

## 4. 阅读指引

| 读者 | 建议阅读顺序 | 阅读目的 |
|---|---|---|
| 管理者 / 决策者 | README → 01-需求分析 → 06-关键流程 → 07-安全与非功能设计 | 快速判断方案范围与风险控制是否满足业务诉求，无需深入技术细节。 |
| 开发人员 | README → 02-系统架构 → 03-数据库设计 → 04-API设计 → 05-模块设计 → 06-关键流程 → 07-安全与非功能设计 | 按「架构 → 数据 → 契约 → 模块 → 流程 → 安全」的依赖顺序建立全貌，再分工深入。 |
| 评审者 | README（对齐基准）→ 01（需求覆盖）→ 03 / 04（数据与契约一致性）→ 05 / 06（模块与流程正确性）→ 07（安全与非功能达标） | 以本 README 为基准逐层核对各分册的口径一致性与设计完整性。 |

---

## 5. 文档边界说明

- 本套文档为 RuleExam 的**设计方案**，仅包含设计层面的内容（需求、架构、数据、API、模块、流程、安全与非功能），**不含任何系统代码实现**。
- 系统实现（前端工程、后端工程、数据库初始化脚本、部署配置等）将作为**后续独立变更**另行开展，不属于本套文档的范围。
- 后续设计如需调整，须先更新本 README 的约定基准（技术栈、术语、表名、枚举、模块名），再同步修订受影响的分册文档，保证全套文档口径一致。
