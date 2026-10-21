# 附录 B · 一致性漂移矩阵

> **来源视角**：impact
>
> **基准**：`README.md`（自我定位为「全套文档的一致性基准」——技术栈定稿 / 术语表 / 核心实体清单 / 统一命名规范）。
>
> **核对方式**：通读 8 份文档，逐字核对表名、字段名、枚举、模块名/路由、技术栈、数值默认值、响应结构与术语。

---

## B.1 漂移状态矩阵

**图例**：✅ 一致 / ⚠️ 存在漂移或跨文档矛盾 / ❌ 严重冲突

| 检查项类别 | 01 需求分析 | 02 系统架构 | 03 数据库设计 | 04 API设计 | 05 模块设计 | 06 关键流程 | 07 安全与非功能 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 表名（12 张逐字） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 字段名 | ✅ | ✅ | ⚠️ W-03 | ⚠️ W-03、W-21 | ⚠️ C-01、W-03 | ⚠️ W-03 | ⚠️ C-01、W-03 |
| 枚举值 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 模块名 / 路由前缀 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 技术栈定稿 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 数值默认值 | ✅ | ✅ | ✅ | ⚠️ W-13 | ⚠️ C-01、W-10 | ✅ | ⚠️ C-01、W-13 |
| 响应结构 / 错误码分段 | ✅ | ✅ | ✅ | ⚠️ S-14 | ✅ | ✅ | ✅ |
| 术语 | ✅ | ✅ | ✅ | ✅ | ⚠️ S-15 | ✅ | ✅ |

---

## B.2 核对结论（未发现漂移的项）

以下项在 01~07 中**逐字一致**，无需修订：

### B.2.1 表名（12 张）
基准（README §3.3）与下游全部命中：
- 组织权限域：`sys_department`、`sys_user`
- 制度域：`regulation`、`regulation_version`、`regulation_scope`
- 学习域：`learning_session`、`learning_record`
- 考试域：`question`、`exam_paper`、`paper_question`、`exam_record`、`exam_answer`

03 ER 图、04 API 响应字段、05 模块设计、06 时序图参与者命名均与基准一致，**未出现基准清单外的表名**。

### B.2.2 枚举值
基准（README §3.4 状态枚举总表）全部命中：
- `regulation.status`: draft / published / archived
- `regulation_version.file_type`: pdf / docx
- `regulation_version.parse_status`: pending / parsed / failed
- `question.type`: single / multiple
- `question.status`: pending / approved / rejected
- `question.source`: ai / manual
- `exam_paper.status`: draft / published / archived
- `exam_record.status`: in_progress / submitted / passed / failed / timeout
- `sys_user.role`: super_admin / regulation_admin / employee

**未出现枚举外值**（如 `completed`、`judge`、中文枚举）；**未出现大小写不一致**（如 `Draft`、`DRAFT`）。

### B.2.3 模块名与路由前缀
基准（README §3.4）六大模块与路由前缀在 04 API 设计、05 模块设计章节标题、06 时序图参与者中**逐字一致**：
1. 组织权限模块 → `/auth`、`/users`、`/departments`
2. 制度文件管理模块 → `/regulations`
3. AI 出题模块 → `/ai`
4. 学习行为管控模块 → `/learning`
5. 考试评分模块 → `/exams`
6. 统计报表模块 → `/statistics`

### B.2.4 技术栈定稿
基准（README §3.1）10 层定稿在 02 部署拓扑、05 技术引用、07 安全设计中**未出现漂移**：
- Vue 3 + TS + Vite + Pinia + Vue Router
- Element Plus
- NestJS
- MySQL 8.0
- Redis
- OpenAI 兼容协议
- pdf-parse + mammoth
- pdfjs-dist
- JWT + RBAC
- Docker Compose

**说明**：02 册出现的 React / Ant Design Vue / PostgreSQL / Tika / LibreOffice 均在「候选方案对比」语境，非定稿选型，**不构成技术栈漂移**。

### B.2.5 核心数值默认值
基准（README §1.1、§3.2）在 01~07 中**逐字一致**：
- 心跳间隔：30 秒/次
- 单次心跳最大计入：45 秒
- 滚动分段数：10 段
- 及格线默认：60 分
- 补考次数默认：3 次
- 多选漏选得分：50%
- 试卷总分：100 分制
- AI 分块：4000 字符 + 200 重叠

**说明**：05/06 出现的「心跳 60 秒」为作弊场景推演，非规格值，不构成漂移。

### B.2.6 统一响应结构与错误码分段
基准（README §3.4）：响应体 `{ code, message, data }`、`code = 0` 成功、40xxx 客户端错误、50xxx 服务端错误。

04 册全部响应示例**遵守此结构**；业务码**全部落在 40xxx/50xxx 段**，**无 200/400/500 型 HTTP-status-like 业务码**。

### B.2.7 README 文档导航链接
README §2 文档导航 01~07 链接与磁盘文件名**逐字一致**（8/8 命中）：
- `01-需求分析.md` ✅
- `02-系统架构.md` ✅
- `03-数据库设计.md` ✅
- `04-API设计.md` ✅
- `05-模块设计.md` ✅
- `06-关键流程.md` ✅
- `07-安全与非功能设计.md` ✅

---

## B.3 发现的漂移项（按检查类别归类）

### B.3.1 字段名漂移

| 漂移项 | 基准位置 | 漂移位置 | 严重度 | 关联 finding |
|---|---|---|:---:|---|
| `regulation_version.file_path` 生成规则 hash 前缀位数（8 vs 16）与路径层级 | 05 §3.4.2 | 07 §4.3.2 | Critical | **C-01** |
| `exam_paper.partial_credit_ratio` 未回填 README §3.3 基准清单 | 03 §3.4（新增字段） | README §3.3 | Warning | **W-03** |
| `learning_session.id` 类型（BIGINT vs 字符串示例 `"lrn-8f2c-01af"`） | 03 §1.4、§3.3.1 | 04 §4.4 示例 | Warning | **W-21** |
| `exam_record.deadline_at` 字段缺失（02 §3.5 R1 应对措施无落点） | 02 §3.5 R1 | 03 §3.4.4 | Critical | **C-04** |

### B.3.2 数值默认值漂移

| 漂移项 | 基准位置 | 漂移位置 | 严重度 | 关联 finding |
|---|---|---|:---:|---|
| 登录失败锁定时长（5 分钟 vs 10 分钟） | 07 §2.2.2（10 分钟） | 04 §5 限流表（5 分钟） | Warning | **W-13** |
| 切屏阈值级数（单级 vs 两级）与去抖窗口（500ms vs 1s） | 07 §3.2.2（两级 + 500ms） | 05 §6.4.4（单级 + 1s）、06 §4.1 时序图 alt 分支 | Warning | **W-10** |

### B.3.3 响应结构 / 错误码分段漂移

| 漂移项 | 基准位置 | 漂移位置 | 严重度 | 关联 finding |
|---|---|---|:---:|---|
| 业务码前缀"409"却映射 HTTP 403（40901/40902），与同段 40903–40907 的 409 语义不齐 | README §3.4（分段约定） | 04 §5.2 错误码明细 | Suggestion | **S-14** |

### B.3.4 术语漂移

| 漂移项 | 基准位置 | 漂移位置 | 严重度 | 关联 finding |
|---|---|---|:---:|---|
| 报表列名"已完成学习人数" vs 基准术语"有效学习" | README §3.2 术语表 | 05 §7.4 报表列定义 | Suggestion | **S-15** |

---

## B.4 跨文档隐式矛盾（非基准漂移，但影响实现）

以下项不属"下游相对 README 基准的漂移"，但属"跨文档隐式矛盾"，实现者无从选择，一并列出：

| 矛盾项 | 冲突双方 | 严重度 | 关联 finding |
|---|---|:---:|---|
| 失焦暂停机制（停发心跳 + `resumed` 标记 vs 独立 pause/resume 端点） | 07 §3.1.1 vs 04 §3.6、05 §5.4.3、06 §3.2 | Critical | **C-07** |
| AI 配置权威副本载体（Redis 持久键 vs 加密配置文件） | 07 §4.2.2 vs 05 §4.4.1 | Critical | **C-10** |
| 心跳处理步骤 6 无条件 `state=active` vs 步骤 1、§5.4.3 状态图、06 §3.2 D2 | 05 §5.4.2 表内自相矛盾 | Critical | **C-08** |
| 05 心跳响应"达标即时提示 is_valid" vs "判定仅在聚合落库事务内执行" | 04 §3.6 vs 05 §5.4.5/§5.4.6 | Warning | **W-05** |
| `scroll_segments` 可配置性 vs "位图长度恒为 10" | 04 §3.4.1 vs 05 §5.4.4 | Warning | **W-09** |
| Redis 故障降级"位图应用内存合并" vs 07 §5.6 阶段 1 "api 多实例横向扩展" | 07 §5.2 vs 07 §5.6 | Warning | **W-18** |

---

## B.5 总体判定

- **核心口径一致性**：**极高**。12 张表名、全部枚举值、六大模块名与路由前缀、技术栈定稿、心跳/滚动/及格/补考/漏选/总分等核心数值在 01~07 中**逐字一致**。
- **README 基准执行度**：**良好**。8 份文档导航链接 8/8 命中；响应结构与错误码分段全部遵守；仅 `exam_paper.partial_credit_ratio` 一处未回填。
- **发现的漂移**：集中在两类——
  1. **跨文档隐式矛盾**（C-01、C-07、C-08、C-10、W-05、W-09、W-10、W-13、W-18）：需通过"确定唯一权威值 + 修订另一方"解决
  2. **README 基准回填滞后**（W-03）：需按 README §5 变更协议「先更新基准、再同步分册」处理
- **阻断级漂移**：**1 项**（C-01 `file_path` 生成规则矛盾，会导致文件无法定位、制度在线阅读与下载直接失效）。
- **建议**：修订完成后触发一次增量核对（仅针对本附录 B.3、B.4 涉及章节），无需全量重跑三视角评审。
