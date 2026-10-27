# H5 考试信息与入口对齐实施计划

> 执行方式：Astra 并行分工，先 Pencil 设计，再后端与 H5 实现，最后独立审查。

**目标：** 学员能在开考前知道冻结分值和时限、找到要求学习的课程，并按本人考试状态继续答题或查看记录。

**设计依据：** 用户已确认的三项差异；`docs/ui/pen-gemini.pen`：`rMONE` 须知、`jYoed` 结果、`JDheF` 考试中心；新增 `icRKz` 学习不足、`lE4vZ` 学习达标、`XpADW` 撤回恢复与归档状态。保留 414×844 和现有蓝白视觉、Wot UI 组件。

**约束：** 不改评分/考试次数/到期规则；不自动交卷；无数据库迁移；不暴露题目答案；历史元数据缺失返回 null，不回填当前试卷配置。当前工作区存在其它并行媒体和品牌改动，逐文件保留，不提交、不覆盖。

## 接口契约

- `GET /me/exams` 保留旧字段，增加 `total_score/pass_score/duration_minutes/question_count`（number|null）、`active_record_id/latest_record_id`（string|null）。元数据优先本人 assignment 冻结规则，未分配读取当前发布快照；列表仅投影当前页，关联数据批量查。
- `GET /me/exams/:id` 按同一可见性返回单卷摘要，并增加 `learning: {required_learning_minutes:number|null,credited_seconds:number|null,remaining_seconds:number|null,courses:{id:string,title:string|null,available:boolean}[]}`。学习查询复用开考判定的有效视频版本和累计口径；只读，不创建assignment或收口记录。
- 结果返回 `total_score/pass_score/duration_minutes`（number|null），仅来自本次冻结规则；未知历史不伪造。
- 新旧客户端兼容：H5 对新增字段缺失按未知处理；旧服务失败仍保留错误重试，不能以缺失学习摘要推断已达标。开考权威继续是既有 POST。
- `active_record_id` 包含尚未服务端收口的超时记录，恢复原入口负责核验；撤回卷恢复优先，不能仅凭试卷状态禁用。
- 列表筛选如保留须在分页之前由服务端过滤；状态为 `all/active/published/ended`，active 为有在答记录，published 为已发布且无在答记录，ended 为非已发布且无在答记录。

## 任务与验证

- [x] 设计：补不足/达标/结束与恢复状态、非100分示例；修正相关自动交卷旧文案；读取布局问题并检查截图。
- [ ] 后端：新增只读摘要/详情及冻结结果元数据，扩展 DTO 与契约；先写失败测试，再实现。覆盖本人可见性、撤回恢复、归档、旧数据null、冻结120分、精确学习阈值、分页筛选。
- [ ] H5：`types/exam.ts`、`api/exams.ts`、`stores/exam.ts`、三个 LiveExam 页面接入摘要和入口；须知直链/返回自动刷新，学习不足显示关联课程和按钮，失败可重试，下架课程不可跳转；结果显示得分/满分与及格线。新增组件/状态与浏览器回归。
- [ ] 同步 `docs/design/04-API设计.md` 与必要设计说明；本次无表结构变化。
- [ ] 验证：server build + 相关单测；mobile type-check + 相关单测及浏览器交互（有环境时）；正式 H5 构建仅在检查完成后按根脚本运行。不得将 Mock/桌面测试写成真机或真实COS验收。
- [ ] 独立审查、修复实质问题，核对修改清单和设计保存，记录验收证据。
