# 管理端运营看板实现设计

日期：2026-10-27

状态：已在当前main分支实现并完成本地验收；按用户补充要求使用 ECharts 按需集成与 Kimi 浏览器插件验收。结果与未验边界见[验收记录](../../../review/2026-10-27-admin-operations-dashboard-acceptance.md)，不代表已部署。

## 1. 目标、已确认范围与边界

为管理员的现有业务首页 `/admin/dashboard` 接入真实运营数据，并让每个入口进入正确的业务页面和筛选范围。功能范围沿用[运营看板功能模块](../../design/05-模块设计.md#admin-operations-dashboard)。规划阶段在本文件中独立完善实现设计；接口、校验和端到端验收完成后，再按[第 9 节](#dashboard-docs-sync)把实际落地结果同步回 `docs/design/` 对应分册。

已确认的页面内容：

- 顶部五张卡：学员总数（同卡显示本机构/外来）、今日参考人数及人次、近 7 日参考人数及人次、题目总数及启用数、试卷总数及发布数。
- 第二行：按本机构/外来堆叠的 7/30 日考试参与趋势，以及新建试卷、试题导入、学员管理、统计分析四个常用操作。
- 第三行：必修学时完成情况与最近考试两个独立模块。学时按累计有效学习时长达标计算，不用考试通过率或必学课时完成率代替。
- 保留页头更新时间与刷新图标；不设首页难度筛选、左右联动、独立页尾说明或重复的页尾统计按钮。

本轮处理数据聚合、接口、入口接收、权限、刷新和验证。沿用现有业务页面、Vue 3/Element Plus、NestJS 统计模块和数据库事实，不新建业务表、独立大屏应用、人工阅卷、结业或证书规则，也不扩大现有管理权限。

接口、入口参数、管理账号排除方式与请求组织按本设计及配套实施计划落地；实现差异和实际验证结果在交付时同步。

<a id="dashboard-design-resource"></a>

### 1.1 设计资源与实现目标

| 项目 | 资源定位 |
|---|---|
| 可编辑设计文件 | [docs/ui/pen-gemini.pen](../../ui/pen-gemini.pen) |
| 本工作区绝对路径 | `/Users/caogj/Documents/emodor/RuleExam/docs/ui/pen-gemini.pen` |
| 主画板 Node ID | **`Y8KAi`** |
| 当前画板名称 | `28 PC 运营驾驶舱 · 已确认方案 1600×1110` |
| 导出预览 | [docs/ui/exports/home-dashboard-2026-10-27/Y8KAi.png](../../ui/exports/home-dashboard-2026-10-27/Y8KAi.png) |

`Y8KAi` 是本次前端实现和视觉验收的指定画板。实施前通过 Pencil 工具读取这个节点，核对当前结构与截图；不从同文件其他候选画板推导新布局，也不把示例数字写死进页面。预览用于快速查看，若预览与实时画板不同，先重新导出核对。本节记录在独立实现设计中，不把资源定位当成系统架构已经完成的证据。

## 2. 总体实现方式与请求组织

```text
Dashboard.vue（权限判断、各区域状态、跳转）
  └─ dashboard API 客户端（类型化读取）
     ├─ GET /admin/dashboard                  五张概览卡
     ├─ GET /admin/dashboard/exam-trend       7/30 日趋势
     ├─ GET /admin/dashboard/learning-options 必修培训候选
     ├─ GET /admin/dashboard/learning-summary 当前选中培训的学时统计
     └─ GET /admin/dashboard/recent-exams     最近考试
        ↓
AdminDashboardController（认证、DTO、接口权限）
  └─ AdminDashboardService（新增，统计模块内的只读编排）
     ├─ 数据库条件聚合与日期分组
     ├─ 共享的学习要求/视频版本读取
     └─ 共享的考试最终成绩兼容计算
```

扩展现有首页入口，完整请求与响应见 [接口规划](#dashboard-api-contract)。使用独立 `AdminDashboardService` 承载新增查询，避免把培训统计服务继续堆成首页、详情和学习资格的混合实现；仍属于原统计模块，不拆成独立应用。复用共享纯函数或查询 helper，不由首页服务直接调用其他 HTTP 接口。

前端继续使用 Vue 3、Element Plus 和现有公共页面框架。柱图与环形图使用 ECharts 按需集成：从 `echarts/core` 引入核心，显式注册实际使用的柱图、饼图、组件与渲染器，不整体导入 `echarts`。图表配数字、图例、键盘入口与可访问的数据提示，管理容器尺寸变化、缓存激活和实例销毁。请求代码与区域展示分开，是否拆分小组件由实施者按现有风格决定，不为每张指标卡建立独立业务状态仓库。

**无数据展示（2026-10-27 补充）**：复用列表现有的 Element Plus `el-empty` 插图与文案。考试趋势当前 7/30 日范围全部为零或没有数据点时显示「暂无考试数据」；最近考试列表为空显示「暂无已发布的考试」；学时无候选显示「暂无必修学时要求」，无应学人员显示「暂无应学人员」。初次加载保留加载态，失败保留错误与重试；有应学人员但无人达标仍展示真实 0% 环图。

**加载与刷新**：首次进入并行请求概览、趋势、最近考试和培训候选；候选成功后再请求默认学时摘要。无统计权限时不发送四类统计模块请求，概览继续返回其他有权字段。初次 `onMounted/onActivated` 去重；后续重新激活首页或点击刷新时重读可见模块。只做这些事件触发的刷新，不加自动轮询、WebSocket 或后台推送。

每个区域独立维护 loading/error/data/as_of；7/30 日切换只请求趋势，切换培训只请求学时摘要，候选搜索只请求选项。使用现有 `createLatestRequestScope` 或等价请求代次保护，旧响应不能覆盖新选择；页面失活使在途结果失效，再激活时重建有效请求范围。手动刷新保留当前趋势范围及有效培训选择，候选失效按接口冲突状态处理，不静默改成另一场培训。

页头更新时间只在一轮全页加载的所有可见数据模块成功后推进，取本轮成功响应中最早的服务端 `as_of`；部分失败保留上一轮时间并显示局部失败，局部切换只更新本区域时间。各请求是独立统计，不承诺数据库全局同时快照；若概览与趋势响应跨过上海午夜而范围不一致，重新读取两者，避免“今日”对应不同日期。日期导航使用响应内的业务日期，而非客户端重新推算。

<a id="dashboard-navigation"></a>

## 3. 入口跳转与目标页接收协议

保留 `/admin/dashboard` 和现有业务路由，不新建看板专属列表页。以下 query 是前端路由协议；实际 API 请求必须按目标 DTO 白名单重新组装，不能把 `entry/create` 或字符串 `all` 透传后端。

| 首页入口 | 目标路由与参数 | 接收行为 | 可点击所需权限 |
|---|---|---|---|
| 学员总数 | `/admin/students?entry=dashboard&status=1` | 清空旧关键字、类别、来源及页码，只看启用学员 | `students:read` |
| 本机构 / 外来人数 | 同上，追加 `source=institution` / `source=external` | 启用状态与来源同时筛选，第一页 | `students:read` |
| 今日 / 近 7 日参考人数 | `/admin/exam-records?date_from=…&date_to=…` | 直接复用记录页现有日期恢复协议，日期取概览响应的 `periods` | `exam_records:read` |
| 趋势某天柱子 | 同上，首尾日期均为柱子的 `date` | 当天完整日期范围；不携带来源或难度隐藏过滤 | `exam_records:read` |
| 趋势「查看考试记录」 | `/admin/exam-records` | 进入记录总列表，不携带旧筛选 | `exam_records:read` |
| 题目总数 | `/admin/questions?entry=dashboard&enabled=all` | 清空旧筛选，`all` 映射为 API 不传 `enabled`，取消页面默认仅启用条件 | `questions:read` |
| 试卷总数 | `/admin/papers?entry=dashboard&status=all` | 清空旧关键字、类别、状态、页码，API 不传状态 | `papers:read` |
| 新建试卷 | `/admin/papers?entry=dashboard&create=1` | 进入试卷页并调用现有新建弹窗流程，不在首页重复维护表单 | `papers:read` 且 `papers:write` |
| 试题导入 | `/admin/questions/import` | 使用现有导入页面及其未保存保护 | `questions:write` |
| 常用操作「学员管理」 | `/admin/students?entry=dashboard` | 进入全部学员列表，包含启用/停用状态 | `students:read` |
| 统计分析 / 全部培训统计 | `/admin/training-statistics?entry=dashboard` | 打开统计总览，不停留在之前缓存的单场分析 | `statistics:read` |
| 最近考试「详情」 | `/admin/training-statistics?entry=dashboard&paper_id=…` | 按该试卷直接加载现有成绩分析；不设置难度参数，不要求该试卷仍在当前已发布选项列表中 | `statistics:read` |

「学员/题目/试卷辅助数字」本期是说明信息，不额外增加第二套入口。未知来源提示也不要求新增学员筛选枚举。考试卡片可以在只有 `statistics:read`、没有 `exam_records:read` 时展示，但点击和记录链接须取消，不能以展示权限代替跳转权限。记录列表显示的是考试记录条数，参考卡主数字是去重人数，二者无需相等；同日期范围的记录条数应与对应开考人次核对。

**目标页面需要补的最小能力**：

- `Users.vue` 接收 `source/status`；`Questions.vue` 接收 `enabled=all|true|false`；`Papers.vue` 接收 `status=all|draft|published|withdrawn|archived` 及一次性 `create=1`；`TrainingStatistics.vue` 接收 `paper_id`。只补首页入口相关字段，不将全部页面筛选和分页统一重做。
- `entry=dashboard` 表示一次显式入口：先经过现有未保存保护，再清空目标页不相关的旧筛选、重置第一页，应用参数。处理后用 `router.replace` 消费 `entry`；`create=1` 在弹窗打开成功后也立即消费，避免刷新、后退或缓存激活时重复弹出。
- 对参数先做单值/枚举/正整数 ID 校验；非法值清除并给出轻提示，不发非法查询。普通菜单进入时维持现有默认行为；用户在页面内改变已纳入 URL 协议的筛选时同步更新/清除对应参数，不能留着一个与当前界面相反的来源或启停值。
- 已有考试记录页直接复用现有 route-query 实现。其他接收页同时覆盖首次挂载、同组件 query 变化和缓存页重新激活，避免只有第一次跳转生效；相同初始化过程只发一次请求。
- 复用现有页签合并与缓存工具，**只对学员、试题、试卷列表、培训统计这四个路径**按业务路径识别同一页签，query 保留为该页签当前筛选。缓存 key 与刷新失效 key 使用同一身份规则，避免每点击一次来源/考试就产生重名页签或残留旧缓存。试卷编辑详情等其他路径不纳入本次合并。
- 页签关闭、刷新、同页 query 切换继续经过既有 `useUnsavedChanges`；query 消费或页签身份归一不得绕过脏表单确认。只读深链和新建意图按独立场景验证。

<a id="dashboard-data-sources"></a>

## 4. 数据来源与统一计算边界

| 数据 | 事实来源 | 计算与复用方式 |
|---|---|---|
| 启用学员总数及来源 | `sys_user`、`sys_user_role` | 与学员管理一致：`role=employee`、`status=1` 且不存在显式业务角色关联；用一次条件聚合返回总数、本机构、外来、未知来源，不把角色当作来源 |
| 题目总数及启用数 | `question` | 复用题库 `deleted_at IS NULL` 范围，再按 `is_enabled` 分类计数；不统计 `question_version` 数量 |
| 试卷总数及发布数 | `exam_paper` | 与试卷列表一致，`business_scope=training`；总数含所有管理状态，已发布数仅取 `status=published` |
| 今日/近 7 日参考人数及人次 | `exam_record`，以及管理端记录可见性所需的关联 | 在同一可见记录集合、同一 UTC 时间区间内分别做 `COUNT(DISTINCT user_id)` 与记录计数；不因为未交卷而排除，不因账号后来停用而排除 |
| 7/30 日来源堆叠 | `exam_record.started_at/user_id/source/id` | 先按上海日期及学员去重并取当日首条记录的冻结来源，再分组；其他历史记录的 source 不回写 |
| 必修培训候选 | `exam_paper`、`paper_release` | 当前已发布培训试卷的最新发布版本；读取冻结课程集合、分钟阈值及 `released_at`，不以当前草稿配置覆盖发布要求 |
| 必修学时达标 | 当前学员范围、发布要求、`training_course`、`course_lesson.current_version_id`、`lesson_version`、`video_learning_record.credited_ms` | 复用开考前学习校验的当前有效视频版本筛选，按用户汇总有效时长后与阈值比较；无学习记录者按 0 时长计入未达标 |
| 最近考试 | 最新 `paper_release`、`exam_paper`、该 release 的 `exam_record` | 先选最近 4 份，再批量聚合；复用 `bestFinalizedRecords` 与冻结规则兼容判定，不重写一套评分或均分规则 |

**应学分母的本轮建议**：沿用学员管理的正常学员边界，选择启用的 employee、无 `sys_user_role` 关联、当前培训类别与发布类别相同且来源为 institution/external 的人员；不按首页不存在的难度筛选。是否实名、是否已有学习记录、是否已经考试或已通过、考试次数是否耗尽，均不用于缩小这份培训责任分母。本机构与外来只要实际适用该学习要求都纳入；管理账号不纳入。

这是新学时卡的明确口径，不直接照搬 C6 `context()`：现有 C6 的应考集合允许保留带业务角色的账号，而学员列表排除该类账号，移动考试也有管理身份限制。本次仅让新看板与学员管理保持一致，不顺带改写既有 C6 历史报表分母。

**学习判定复用**：从 `paper-learning.ts` 提取或复用「发布学习要求解析、有效视频版本集合查询」的只读能力，供开考校验与新聚合共同使用。版本集合去重；关联课程当前应为 published、课时有效且为 video、当前版本时长有效，与现有开考查询一致。数据库按用户汇总 `credited_ms`，与 `required_learning_minutes × 60000` 比较；保持整数精度。不能用覆盖时长、`is_completed` 或相加的前端进度代替。聚合人数/阈值/版本集合在同一次一致性读取内完成，不对业务表加写锁，也不更改学习完成事实。

**时间与聚合性能**：数据库 DATETIME 按现有 UTC 约定读写，上海 00:00 先转换为 UTC 边界，再用 `started_at >= 起点 AND started_at < 截止点` 限定范围；日期分桶可在已限定的集合内做 UTC+8 转换，不在范围过滤中包裹 `DATE(started_at)` 使索引失效。不新增 `userRepo.find()` 全表搬运、逐用户查学习记录或逐试卷 N+1 查询。最近 4 份成绩只批量读取现有兼容计算需要的最小字段，不取答案及题面。

首次实现直接查库，不新增业务表、持久统计快照、后台汇总任务或 Redis 缓存。现有 `exam_record` 缺少以 `started_at` 为首列的时间索引；实现时对 30 日查询和学时聚合执行 `EXPLAIN`，按真实规模评估时间索引等最小增量。若确需新增索引，必须另加未占用编号的迁移，并同步 03 册、`init.sql` 与实体索引定义，不改既有迁移 checksum。

<a id="dashboard-api-contract"></a>

## 5. 接口规划

当前 `/admin/dashboard` 只有学员、题目、试卷三个总量和近 7 日开考记录数；当前记录数不是去重参考人数。现有培训统计可复用成绩计算，但必修学时达标需要独立聚合。

**实现设计状态**：以下为实施契约，实际交付状态和证据见验收记录。沿用 NestJS 统计模块、统一响应信封 `{code,message,data}`、字符串 ID 和 DTO 校验；下文只展开成功响应的 `data`。所有路径均位于全局 `/api/v1` 前缀下。

采用「扩展现有概览 + 四个独立读取接口」，使趋势、学时与最近考试可以分别加载和重试。首页不分页拉取全部学员、试卷或答卷后在浏览器里计算统计。

| 方法 | 路径 | 参数 | 权限与用途 |
|---|---|---|---|
| GET | `/admin/dashboard` | 无 | 保持登录后逐项裁剪；返回五张卡所需总量、来源分项、参考人数/人次及日期范围 |
| GET | `/admin/dashboard/exam-trend` | `days=7\|30`，默认 7 | `statistics:read`；返回每日去重、按来源堆叠的趋势 |
| GET | `/admin/dashboard/learning-options` | `keyword` 可选；`page=1`、`page_size=20`，最多 100 | `statistics:read`；分页查询可统计的必修培训选项，不额外要求学员、课程或试卷读取权限 |
| GET | `/admin/dashboard/learning-summary` | `paper_id`、`release_id` 必填 | `statistics:read`；返回所选发布学习要求的应学/达标统计 |
| GET | `/admin/dashboard/recent-exams` | 无；服务端固定最多 4 条 | `statistics:read`；返回最近发布过的培训试卷及其统计摘要 |

新增接口只接受表内白名单参数。天数不在 7/30、非法 ID、非法页码或超出单页上限均返回 `40001`，不静默放大查询范围。普通管理账号可以只有部分业务权限，不能把整个 `/admin/dashboard` 改成强制 `statistics:read`。

**① 概览：保留旧字段，新增卡片字段**

```ts
type DashboardDateRange = { date_from: string; date_to: string }; // YYYY-MM-DD，上海自然日，含首尾日

interface AdminDashboard {
  as_of: string; // 服务端 ISO 时间
  timezone: 'Asia/Shanghai';
  periods: { today: DashboardDateRange; last_7_days: DashboardDateRange };
  metrics: {
    learner_count?: number;
    learner_institution_count?: number;
    learner_external_count?: number;
    learner_unknown_source_count?: number;
    today_participant_count?: number;
    today_attempt_count?: number;
    last_7_days_participant_count?: number;
    last_7_days_attempt_count?: number;
    question_count?: number;
    enabled_question_count?: number;
    paper_count?: number;
    published_paper_count?: number;
  };
  exam_trend?: Array<{ date: string; count: number }>; // 旧客户端兼容字段，仍为原 7 日记录数口径
}
```

| 权限 | 同组返回的字段 |
|---|---|
| `students:read` | `learner_count` 及三个来源分项 |
| `questions:read` | `question_count`、`enabled_question_count` |
| `papers:read` | `paper_count`、`published_paper_count` |
| `statistics:read` | 今日/近 7 日参考人数与人次；兼容字段 `exam_trend` |

无权字段整组省略，真实零值返回 0；`metrics={}` 是无可见指标，不是查询失败。前端每次整体替换 `metrics`，被省略的字段不能继续沿用旧缓存。`periods` 由后端计算，首页点击日期入口直接使用它，不依赖浏览器所在时区。旧 `exam_trend` 不改字段名或语义，新页面只用独立趋势接口；题目/试卷总量则修正为与管理列表业务范围一致。不得拿旧记录数充当新增的去重参考人数。

**② 考试趋势**

```ts
interface DashboardExamTrend {
  as_of: string;
  timezone: 'Asia/Shanghai';
  days: 7 | 30;
  date_from: string;
  date_to: string;
  points: Array<{
    date: string;
    participant_count: number;
    institution_count: number;
    external_count: number;
    unknown_source_count: number;
  }>;
}
```

`points` 按日期升序且固定含 7/30 天，空日期各数为 0。每天人数满足 `participant_count = institution_count + external_count + unknown_source_count`；未知来源非零时显示中性分段及提示，不假装只有两类。先按「日期 + user_id」取最早 `started_at,id` 的记录，再按该条冻结来源分组；整个 7 日的去重人数必须另算，不能累加 `points`。

概览参考指标与本接口使用相同的管理端可见考试记录集合：进行中、已通过、未通过、纯 timeout 未交卷均计入；沿用管理端记录范围对旧 submitted、旧已评分 timeout 的排除规则。复用的是记录可见性条件，不调用包含答题数子查询的列表投影，也不读取答案内容。账号后续停用不抹掉已有参与事实。

**③ 必修培训选项**

```ts
interface DashboardLearningOptions {
  as_of: string;
  items: Array<{
    paper_id: string;
    title: string;
    release_id: string;
    released_at: string;
    required_learning_minutes: number;
  }>;
  total: number;
  page: number;
  page_size: number;
}
```

候选须满足：培训试卷当前为 `published`，取其最高 `version_no` 的发布版本，该版本已开启学习要求、分钟数为正整数且冻结的 `course_ids` 为非空合法 ID 集合。按 `released_at DESC, release_id DESC` 排序；`keyword` 搜索名称。初次加载选第一页第一项，列表为空时展示「暂无必修学时要求」，不请求 summary。课程后来下架或换版不使发布要求消失，实际有效时长仍按开考校验规则计算。既有 `/statistics/training/options` 继续服务原统计页面，不用增加会改变其返回形状的分页字段。

**④ 必修学时统计**

```ts
interface DashboardLearningSummary {
  as_of: string;
  state: 'ready' | 'no_audience';
  paper_id: string;
  title: string;
  release_id: string;
  released_at: string;
  required_learning_minutes: number;
  eligible_count: number;
  achieved_count: number;
  pending_count: number;
  achievement_rate: number | null; // 0..1，四位小数；界面按百分数展示
}
```

服务端先验证 `release_id` 属于指定试卷，且仍是当前有效学习候选的最新发布版本，再按 [数据来源与计算口径](#dashboard-data-sources)计算。`pending_count = eligible_count - achieved_count`；无应学人员返回 `state='no_audience'`、三个人数均为 0、比例为 null。是否产生考试成绩与本接口无关，不以是否考试通过改变学时数据。

试卷不存在或发布版本不属于该试卷返回 `40401`；已重新发布、撤回或学习要求已失效返回 `40970`（沿用试卷发布状态冲突）。前端清除失效数字并重新读取选项，提示「培训要求已更新，请重新选择」，不自动切到另一场培训；不能把上一版本的阈值和新版本的数据混用。课程当前版本与累计时长按开考前学习校验的相同规则读取，不用 `course_completion.completion_rate` 替代。

**⑤ 最近考试**

```ts
interface DashboardRecentExams {
  as_of: string;
  limit: 4;
  items: Array<TrainingExamOverviewRow & { released_at: string }>;
}
```

每份培训试卷只取最高 `version_no` 的发布版本，按 `released_at DESC, release_id DESC` 取前 4 份；必须有发布记录，允许当前已撤回或归档，不包含尚未发布过的草稿。读取每项当前真实状态，人数、最终出分与均分复用 overview 的同版本/同冻结规则/个人最高分口径；空列表返回 `items=[]`。不加入难度参数、不生成跨试卷总平均分，也不与学时卡联动。

采用专用首页查询是为了保留已确认的历史状态展示范围；现有 `/statistics/training/overview` 已收窄到已发布试卷，本次不撤销该收口。最近考试「详情」以 `paper_id` 直达已有 summary 分析页；归档试卷不在当前下拉选项中不能被当成无权限，最终存在性与授权由 summary 接口核验。

**共同边界**：以上均为只读查询。四个独立接口无权时返回 `40301`，不是返回假零值；前端清除受限模块旧数据并隐藏其入口，不能把权限错误当作可继续展示旧数据的网络故障。未登录沿用 401 处理。时间使用后端 UTC 存储、上海自然日边界，日期范围查询先换算为 UTC 区间，今天截到服务端统计时点。首次实现直接读库，不新增 Redis 统计缓存、定时汇总任务或业务表；请求流程见 [加载与跳转流程](#dashboard-loading-flow)。

<a id="dashboard-loading-flow"></a>

## 6. 加载、刷新与跳转流程

```text
进入 /admin/dashboard
  ├─ 读取当前权限
  ├─ 概览请求 ─────────────→ 按权限返回五卡相关字段与业务日期
  └─ 有 statistics:read 时并行读取
       ├─ 7 日趋势 ────────→ 日去重、来源分组、补齐零值
       ├─ 最近考试 ───────→ 最新发布记录倒序的 4 份试卷
       └─ 必修培训选项
            ├─ 无候选 ────→ 暂无必修学时要求
            └─ 有候选 ────→ 选默认项 → 学时摘要
                                 ├─ 校验 paper_id + release_id
                                 ├─ 当前正常学员与发布类别 → 应学集合
                                 ├─ 发布冻结课程/分钟 + 当前有效视频版本
                                 │    → credited_ms 按用户汇总 → 是否达标
                                 └─ 无应学人员 → 空比例；否则展示达标率
```

1. **局部操作**：切换 7/30 日只重读趋势；切换培训只重读学时卡；最近考试与学时卡不联动。若选中发布版本已变化或失效，返回 40970，清除失效数字并重新读取候选，提示重新选择。
2. **整页刷新**：保留有效的当前选择，按区域并行重读；局部失败只提供本区重试，不把失败结果写为 0。首次挂载与缓存激活不重复触发同一批请求，不自动轮询。
3. **日期下钻**：卡片使用概览响应的 `periods`，日柱使用自身 `date`，跳到现有考试记录页的完整 `date_from/date_to` 范围；统计展示权限和记录访问权限分别检查。
4. **列表下钻**：学员、试题、试卷入口先检查未保存状态，再应用首页指定的来源/启用/全部状态并清空无关旧筛选。一次性入口参数消费后不重复执行；业务页签和缓存身份按约定路径合并。
5. **新建与详情**：新建试卷进入现有试卷页并只打开一次弹窗；最近考试详情通过 `paper_id` 进入原统计分析；无此参数的统计入口回到总览。归档试卷的详情不以当前已发布选项列表作为存在性判断。
6. **请求归属**：失活、卸载或切换查询使旧请求失效；只接受当前请求代次的响应。学习统计在同一次一致性读取中使用同一发布要求和版本集合，不增加学习、考试或评分写入。

## 7. 实施范围与验证安排

| 部分 | 预期改动范围 | 核心验证 |
|---|---|---|
| 统计聚合与契约 | `server/src/modules/statistics/`、服务端/前端 training-contract 类型；必要的共享只读学习 helper | 逐项权限、同人多次与跨天去重、未知来源、上海日期边界、软删除题目、培训试卷状态 |
| 学时统计 | 新首页 service、`paper-learning.ts` 共享查询与统计测试 | 未学习人员仍在分母；阈值前后；重复版本不重复累计；管理账号排除；有要求的外来人员纳入；空分母、课程换版、发布版本变化 |
| 首页展示 | `Dashboard.vue`、类型化 dashboard API 与必要的区域组件 | 五卡顺序、来源同卡、7/30 日独立切换、学习空态、无难度/无联动/无页尾、局部失败与旧响应丢弃 |
| 入口接收 | `Users.vue`、`Questions.vue`、`Papers.vue`、`TrainingStatistics.vue`；有限范围的 tabs/cache 规范化 | 已缓存且留有旧筛选后再次从首页进入；启用/来源/全部状态正确；新建只触发一次；统计深链和归档详情；权限不可绕过；未保存保护仍有效 |
| 最近考试 | 专用首页查询、既有成绩汇总 helper | 最近发布时间排序及同时间稳定顺序；最多 4 条；撤回/归档真实状态；不改变原 overview 的已发布过滤；无成绩显示空值 |

实施完成后做针对性单元/API 测试，服务端 build、Web 类型检查与构建，以及首页到各目标页的浏览器验收；E2E 只使用隔离临时数据库。性能按现有统计查询目标核对 30 日趋势及学时聚合的查询计划和响应，不以空库速度代替验证。当前有未提交的试卷、考试记录、统计页及页签改动，实施前必须重新核对并保留这些基线，不覆盖、重置或把它们当成本次新实现。

<a id="dashboard-delivery-validation"></a>

## 8. 接口、校验与端到端验收的交付顺序

本节是实施的完成条件。浏览器端到端流程按用户要求由 **Kimi 浏览器插件** 操作真实管理页面，不使用 Playwright 作为验收工具；实际执行情况与结果单独记录。交付顺序固定为：

```text
读取设计文件中的 Y8KAi，确认本轮实现范围
  → 完成接口、DTO/权限校验与数据库聚合
  → 完成前端接入、入口跳转及页面状态/提示
  → 通过针对性单元测试、API 集成测试、类型检查与构建
  → 通过 Kimi 插件真实前后端浏览器验收、数据对账及视觉验收
  → 记录验证结果与未验边界
  → 按实际落地结果同步 docs/design 对应分册
  → 检查代码、接口契约、数据库定义和文档一致后交付
```

### 8.1 接口与输入校验

五个读取接口逐项验证成功返回、真实零值、空分母、字段类型、权限裁剪、未知参数及非法参数。覆盖未登录、无权限、过期发布版本等错误；401/403 不可保留旧授权数据，40970 应清除失效学时数据并提示重新选择。

统计测试至少包括：同人多次开考、跨天开考、上海午夜边界、未知来源、软删除题目、不同试卷状态、未学习但应学的人员、学习阈值前后、重复视频版本、课程换版与发布版本变化。接口结果与隔离测试数据独立计算的预期值对照，不只断言 HTTP 200。读取看板不能产生学习、考试或评分写入。

复用现有 `tests/run-e2e.mjs --ephemeral` 隔离服务和数据库启动器；既有 `training-statistics` 套件可用于统计回归。新增看板专用套件时，须先加入启动器注册表再执行，不把尚未注册的命令列为已经通过。不得把 E2E 指向开发库或生产库。

### 8.2 浏览器端到端流程与提示反馈

Kimi 浏览器插件验收使用真实管理页面、应用 API 和隔离 MySQL/Redis，不以静态假数据页面或全部请求拦截替代接入验收。允许预置已知统计场景，但至少有一条测试通过实际业务 API 创建开考/交卷事实，再检查首页刷新、记录入口和详情中的对应结果。

| 场景 | 必须核对的结果 |
|---|---|
| 管理员进入首页 | 五张卡、来源分项、趋势、学时、最近考试与 API/测试数据一致；无权限账号不请求或显示受限数据 |
| 学员总数与来源入口 | 打开正确的学员列表；启用状态和本机构/外来筛选正确；之前缓存的关键字、类别与页码不污染结果 |
| 今日/近 7 日/趋势日柱 | 日期参数和可见筛选正确；记录条数对应人次，去重人数另行对账；返回首页后数据与选择合理保留 |
| 题目/试卷总数入口 | 显示约定的全部状态，题目不因页面默认仅启用而少显示，试卷不沿用上次状态过滤 |
| 常用操作 | 四个入口均可达；新建试卷只打开一次现有弹窗；刷新、后退或重新激活不会重复弹出；未保存保护仍有效 |
| 趋势及培训切换 | 7/30 日只更新趋势，培训切换只更新学时；快速连续操作后显示最后一次选择，旧响应不覆盖新结果 |
| 最近考试详情 | 进入对应 `paper_id` 的分析，含应支持的撤回/归档情况；不改变左侧学时卡 |
| 空数据和失败 | 无必修要求、无应学人员、无人达标分别显示正确状态；局部失败可重试，不变成假零值；其他模块仍可用 |
| 页面消息与反馈 | 加载提示、刷新反馈、无权限反馈、输入错误、请求失败、发布要求已更新等提示与实际结果对应；无静默失败或虚假的成功提示 |

这项看板验收只覆盖页面交互提示和请求反馈，不增加站内信、外部通知或消息推送功能。

### 8.3 视觉核验与证据记录

以 [Y8KAi 设计资源](#dashboard-design-resource)逐区对照实际页面：总人数与来源同卡、五卡顺序、堆叠趋势、常用操作样式、学时环图与最近考试布局；确认无首页难度控件、左右联动或被取消的页尾。使用真实数据检查长标题、空态、错误态及宽度缩小时的换行和溢出。截图只能证明视觉结果，不能替代接口和业务链路校验。

验收记录写入 `review/<实际日期>-admin-operations-dashboard-acceptance.md`，记录工作版本、测试环境与隔离库标识、实际执行命令及结果、API 数据对账、E2E 场景结果、失败修复/复验和剩余边界。浏览器截图按仓库约定保存在被忽略的 `gui-test-screenshots/` 下，并在验收记录中给出定位；不记录令牌或凭据。只报告实际执行的验证，不能把本节计划写成通过记录。

<a id="dashboard-docs-sync"></a>

## 9. 实现验收后同步回正式设计分册

**同步时点**：接口实现、参数/权限/统计校验、前端接入及 Kimi 浏览器验收完成，问题修复并复验后，在最终交付前同步到仓库实际目录 **`docs/design/`**。本轮规划阶段仍只维护这份独立实现设计，不提前批量改写原分册，也不新建拼写为 `docs/desing/` 的目录。

| 同步目标 | 按实际落地回填的内容 |
|---|---|
| `docs/design/04-API设计.md` | 最终接口路径、参数白名单、响应字段与类型、逐项权限、错误码、空值/零值、兼容字段；与 DTO、控制器和前端类型逐项核对 |
| `docs/design/03-数据库设计.md` | 实际新增或调整的表/字段/索引、查询支撑与迁移编号；与 `database/init.sql`、`server/src/entities/`、新增迁移保持一致。没有结构变更时，在验收记录明确「无数据库结构变更」，核对复用关系即可，不虚构迁移或改写无关表 |
| `docs/design/05-模块设计.md` | 真实服务归属、数据来源、人数/人次及学时口径、入口接收与权限、区域状态；把已实现部分与仍未完成的目标分开标记 |
| `docs/design/06-关键流程.md` | 实际加载/刷新/重试顺序、日期下钻、列表筛选恢复、新建一次性入口、学时版本失效与端到端反馈流程 |
| `docs/design/07-安全与非功能设计.md` | 若本次实际涉及权限边界、缓存、性能指标或查询索引策略，只同步受影响条目及对应验证边界 |
| `docs/design/README.md` | 更新本模块实现状态、分册导航与验收记录链接，不把设计完成写成生产部署完成 |

只有实际改变需求范围或系统模块边界时，才同步 `01-需求分析.md` / `02-系统架构.md` 的相关条目，不为登记一个看板而重写全套系统设计。设计资源路径与 Node ID 保留在本独立实现文档中。

如实施中确需数据库变更，迁移、`init.sql` 与实体须在同一实现变更中配套制作并在隔离环境验证；最终再将验证后的事实同步到 03 册。不得用验收后的文档补写掩盖不一致的运行结构，也不得改写既有迁移 checksum。

交付前核对：正式接口文档与实际返回一致，数据库三方定义一致，功能/流程文档与浏览器结果一致，验收记录可追溯，未通过项目明确保留为未验。文档回填是交付步骤，不是替代实现或测试的证据。
