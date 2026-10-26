# 新增试卷与考前学习要求 Implementation Plan

> **For agentic workers:** 使用 astra-workflow 并行实施已划定的前后端范围，根智能体同步数据库与设计文档并整合验证；不提交或部署。

**Goal:** 新增试卷采用简洁表单，保存备注，并真正执行可选的课程累计有效学习时长开考限制。

**Architecture:** 复用现有培训试卷、课程选项、视频有效计时和发布快照。`requires_learning` 作为唯一开关，新增 `required_learning_minutes`；发布时冻结所选课程与分钟数，开考通过发布版本检查服务端记录。备注只作为试卷管理信息保存。

**Tech Stack:** Vue 3 / Element Plus、NestJS / TypeORM / MySQL、Vitest 和现有隔离 API 测试工具。

**Spec:** 本对话已批准：移除资料来源；仅一个“考前学习要求”开关，开启才显示必填的关联课程、多选及累计分钟；未达标禁止开考；新增选填备注。原先评估的名称、类别、考试时间、及格分数保留，创建时采用现有默认次数3、漏选比例0.5。

## 全局约束与契约

- 在当前工作区保留已有入口精简和并发改动；改动前基线位于 `/var/folders/_b/8g0796l93xbc8__ccj6vg5y40000gn/T/ruleexam-paper-learning-baseline-79j_zhbf`。
- API 新增 `required_learning_minutes: number | null`（正整数，最大2147483647）与 `remark: string | null`（最多1000字符）。空备注归一为null。
- 开启要求 `course_ids` 非空且类别关系有效、分钟为正整数；关闭时新写入规范化为空课程与null分钟。更新未传字段须合并已有草稿再验证。
- `exam_paper` 新增 `required_learning_minutes`、`remark`；`paper_release` 新增 `required_learning_minutes`，均可空且无历史数据回填。新增030迁移，不能改写既有迁移。
- 当前课程有效课时的当前视频版本，每版本只汇总一次 `credited_ms`。沿用服务端有效播放累计语义（重复有效观看可累计），不改为coverage_ms，不接受客户端上报的总分钟。
- 发布时冻结course_ids与分钟数；新开考及补考检查对应发布版本，已有进行中考试恢复不因新增检查被中断。旧发布版本分钟为null保持历史行为，新发布开启却缺配置必须拒绝。
- 备注用于管理员保存/回显/复制，不新增学员公告功能；历史卷、冻结题面、评分规则与旧制度阅读流程保留。
- 试卷详情同步门槛配置及备注，移除资料来源输入，避免下一次保存丢失配置。沿用公共弹窗和现有未保存保护。

## 审查关注

- 开关关闭、再开启、切换类别后，隐藏字段不能误触发验证或带入无效课程。
- 部分PATCH不能绕过门槛，发布前必须复核；非法空课程/分钟和备注长度需服务器拒绝。
- 无记录、不足/恰好达标、跨学员/跨课程、已删除课时及旧版本记录应按明确口径计数。
- 学习不足不能创建考试或消耗次数；补考走原发布配置，进行中恢复保持可用。
- 备注、门槛在创建/读取/编辑/复制/发布链一致；迁移可续跑且不改历史记录。

## 任务

### 1. 后端行为（backend_gate）

**范围：** `server/src/modules/ai/paper.service.ts`、`server/src/modules/exams/{paper.dto,paper-release.service,attempt.service}.ts`，按需新增门槛服务/测试，`database/migrations/030_*.sql` 及测试注册/探针。

- [x] 先补有意义的失败测试：开关验证、备注往返、毫秒边界及开考拒绝无副作用。
- [x] 实施合并验证、存储、复制、发布冻结与开考检查；错误沿用统一信封，返回实际/要求/缺口方便学员理解。
- [x] 新增可续跑迁移及探针，不修改旧checksum；执行后端构建和相关单元/API检查。

### 2. PC表单（frontend_dialog）

**范围：** `web/src/views/admin/{Papers,PaperDetail}.vue`、`web/src/api/training-types.ts`、`web/src/components/question-designers/{PaperProperties.vue,contracts.ts}`、`web/src/composables/paper-designer-host.ts`及相关行为测试。新建直接进入设计器，因此其同名配置也必须保持一致。

- [x] 先验证条件显示、必填、关闭后的创建payload、备注回显和保存行为。
- [x] 新增弹框改为试卷名称、考试时间（分钟）、培训类别、及格分数（分）、考前学习要求、选填备注。开启时展开课程多选和累计学习时长；主按钮“保存并组卷”，并保留共享工作区并发新增的“保存草稿”动作。
- [x] 删除资料来源及其选项请求；详情保留原记录的兼容值，不用隐式空值擦除旧来源。同步详情门槛和备注，保留后续考试次数配置。
- [x] 执行相关Vitest、现有页面回归与vue-tsc。

### 3. 数据契约、集成与验收（root）

**范围：** `server/src/entities/{exam-paper,paper-release}.entity.ts`、`database/init.sql`、`docs/design/{03,04,05,06,README}`、必要测试工具与验收记录。

- [x] 同步实体/init/设计，保留既有并发文档修改。
- [x] 执行针对性测试、编译和隔离API学习门槛场景；浏览器检查弹窗关闭/开启/备注交互。
- [x] 独立reviewer检查本任务相对基线的变化，修复实质问题并补验。
- [x] 明确交付证据与本地数据库迁移/服务状态，不把源码或自动化结果称为真机验收。

## 执行记录

- 后端根复验：63文件/1038项；专属隔离API通过；迁移/catalog 9/9。
- 本机数据库仅新增030并复查pending为空，既有试卷/发布原字段和全部旧迁移登记逐字段保持。022/029各恢复一个末尾LF使其与本机登记SHA256完全匹配，不改旧SQL或登记值。服务已用既有配置重启，健康接口MySQL/Redis up。
- PC初轮556项全量、21项页面状态、vue-tsc通过；审查发现旧非空regulation_ids失去解除入口，补一次明确转换确认后做范围复查。
- 最终PC：全量36文件/572项；最后随机草稿同根因窄修专项7/7；根vue-tsc和原子web构建通过。独立审查P2闭环，未发现新实质问题。PC条件展开/必填/备注/最终双保存入口已检查。完整证据见 `review/2026-10-26-paper-learning-requirement-acceptance.md`。
