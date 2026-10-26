# COS 媒体集成实施与验收记录

执行方式：用户指定 Astra 并行编排，不经过 SDD。

工作副本：`/Users/caogj/Documents/emodor/RuleExam/.worktrees/cos-media-integration`，分支 `cos-media-integration`，基线 `44b9d7f`。主工作区未提交的题库/UI 改动未复制；其中迁移 029 保留，本分支新增媒体迁移使用 030。图谱项目 `RuleExam_cos` 仅用于定位，未覆盖的媒体实现按路径读取。

## 基线

- 三端 `npm ci --no-audit --no-fund` 成功；Node v25.9.0。
- `npm --prefix server test -- test/media-policy.spec.ts test/media-lifecycle.spec.ts test/media-ticket.spec.ts test/identity-image.spec.ts test/schema-migration.spec.ts`：构建成功，5 文件 32 测试通过。
- `node --test tests/backend-env.test.mjs tests/migration-catalog.test.mjs tests/migration-contract.test.mjs`：46 测试通过，使用运行器自有临时 MySQL/Redis，未连接开发库。

## 工作线与当前证据

按计划由存储、数据、上传、读取、Web、Mobile、迁移工作线分担；共享注册和配置由根整合。具体交付证据在相应阶段完成后追加。阶段审查针对固定候选差异，最终结论不以子代理自报完成替代。

2026-10-26 基础阶段：

- 存储/配置使用实际端口与 SDK stub 验证前缀拒绝、Range 流、准确版本、分块/版本分页、流错误脱敏及断连取消；环境导入10项临时文件测试通过。
- server 当前候选65文件1008项测试通过，含构建；后续核心接口变化后仍需相应回归，不能沿用为最终验收。
- `node tests/run-e2e.mjs --ephemeral --suite cos-media-schema` 根执行退出0；实际 AppModule 启动成功，迁移在自有临时数据库验证首次/重复/两处DDL崩溃恢复、历史ID/引用不变、墓碑唯一键及漂移拒绝，运行器正常清理自有进程和临时目录。
- 根已在本 worktree `.env` 保留 RuleExam 本地原配置，并使用 `import-cos` 从用户指定复用项目的 `server/.env` 白名单导入4项 COS 配置；只报告键名，文件0600且Git忽略。默认仍为 local/proxy，尚未启用真实COS写入/短链分发。`env:check --real` 配置检查通过，不等同供应商调用通过。
- Web原始基线44项相关单测通过；Node脚本13项中 `student-avatar-save.test.mjs` 的2项既有 SSR 上下文错误，已交Web owner定位，最终需明确是否修复。

## 外部验收边界

用户已明确选择gooodwork COS短期链接，替换EdgeOne建议，默认300秒且接受旧链接到期前有效；链接时长可配至3600秒。源码与原有窄测试证实gooodwork Web播放器没有自动续签，原生App才缓存完整文件；本项目补PC/H5续签保位置、一次网络重试与迟到响应保护。独立核验记录见 `review/2026-10-26-goodwork-cos-flow-verification.md`，不把该源码证据当作gooodwork线上结果。

真实 COS/STS、真实迁移、真机、容量和生产部署尚未验收。所有真实云配置变更须先形成具体可审阅差异；本记录不能作为数千并发或生产上线证明。本地原媒体文件不得随迁移工具开发删除。
