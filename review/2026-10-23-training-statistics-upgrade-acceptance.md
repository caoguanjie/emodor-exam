# 培训统计总览与成绩分析验收记录

日期：2026-10-23。范围：旧系统 FR-STA-01—05 与当前培训统计融合，不恢复监考、人工阅卷或旧制度统计入口。

## 交付

- 默认考试汇总列表，名称/类别筛选、分页、成绩分析入口、返回时保留列表条件。
- 详情展示发布规则（总分、时限分钟、及格分），分难度补最高/最低分、及格人数、平均用时。
- 排名补性别、分数/用时升降序；保持标准分数名次，排序后分页、当前页同参数导出。
- 未配置优秀标准时返回 null，显示未设置/—，不推断 80 分。
- 保留原参与、课程完成、未完成原因、难度统计；没有数据库表变更。
- 已回填 main 工作区，未提交；保留其他任务并行修改。共享类型文件仅合入统计片段。

## 自动化证据

| 环境 | 命令/内容 | 结果 |
|---|---|---|
| 隔离 worktree | server `npm test`（含 pretest build） | 47 文件、581 项通过 |
| 隔离 worktree | `node tests/run-e2e.mjs --ephemeral --suite training-statistics` | 通过，完整执行至 4/4；隔离 MySQL/Redis/API 已清理 |
| main 工作区 | web `node --test tests/*.test.mjs` | 193 项通过 |
| main 工作区 | web `npx vue-tsc --noEmit` | 通过 |
| main 工作区 | web `RULEEXAM_BUILD_OUT_DIR=/tmp/ruleexam-stats-build-wmupfk npm run build` | 通过；仅构建到临时目录，未覆盖网站 dist |
| main 工作区 | server `npx vitest run test/training-statistics.spec.ts test/legacy-statistics.spec.ts` | 25 项通过 |
| 本次文件 | `git diff --check` | 通过 |

先失败后通过的证据包括：新增 overview 旧接口返回 404；当前发布版本异规则开考人数被误排除（4≠5）；真实 Element Plus 分页 total 清零引起第三页回第一页。修复后相关断言保留。数据库样本验证同分、补考、跨难度去重均分 72、初级均分 70/均时 460 秒、历史发布排除、纯 timeout 不评分、gender 三态、权限、排序后分页与 Excel 一致。

隔离 worktree 共享 node_modules 符号链接曾导致 admin-shell SSR `module is not defined`，主目录完整 193 项已通过；未为此修改公共测试。

## 独立审查与浏览器

独立 reviewer 初审发现并关闭：总览分页回退、切卷注入草稿类别、详情重试不恢复失败选项。已补真实 ElPagination/SFC 回归，最终复核无新增实质问题。

Chrome 实际挂载 TrainingStatistics.vue、Element Plus 与公共样式，检查总览、详情、选择初级、用时升序、第二页、返回列表。该视觉夹具使用模拟 API/身份，不冒充真实后端浏览器业务验收。真实数据聚合由上述隔离数据库 E2E 覆盖。夹具位于 web/tests/training-statistics-fixture/，不属于生产入口。

## 主工作区未完成边界

主目录 server `npm test` 在 pretest 构建阶段被并行进行的 V3 题目内容改造阻塞。最后一次 `npm run build -- --pretty false` 仍报 `question-version.service.ts:231,624` 的 `QuestionContentV3 | QuestionContentV2` 类型不兼容。这不是隔离统计改造中的错误，未越界修改该并行工作。

因此未将新后端部署/重启到当前开发服务，也不宣称主目录后端全套通过。需并行工作完成类型修复、构建并重启后端后，才能在原站点使用新增 overview 接口；生产部署与真实站点完整浏览器验收未执行。
