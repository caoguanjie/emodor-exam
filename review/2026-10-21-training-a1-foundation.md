# 培训融合 A1 基础验收

日期：2026-10-21。范围仅为实施计划 A1，不代表全部培训功能、PC 业务页面或 H5 已完成。代码候选：`2e53d56e58c1d2ba1eeb2fd7f0979a9959da1424`，分支 `feature/training-admin-integration`；未合入主分支、未推送、未部署。

## 已交付

- 对齐已批准设计、旧业务证据与计划中的新增业务，保留原制度/AI/阅读/固定卷/统计边界。
- 前后端共享类型、字符串 Id、新题型/来源/难度与答卷状态契约；不伪称后续业务 API 已实现。
- 显式测试库保护、自有临时 MySQL/Redis、独立密钥/存储、Redis 物理前缀隔离。
- `request/upload/restartApi/queryTestDb` 与 `run(ctx)` 测试上下文；API 重启保持同一数据与密钥。
- `schema_migration`、显式目标库、真实在考拦截、同库锁、逐步探针与 progress、部分 DDL/连接死亡恢复。正式执行仍需授权及停服维护窗口。
- 异步测试子进程、中断退出码、重启与清理协调、先停全部进程再删除目录；失败保留相关目录。

## 验证证据

根集成在最终代码候选上运行：

```bash
node --test --test-concurrency=1 --test-timeout=120000 \
  tests/test-target.test.mjs tests/migration-contract.test.mjs \
  tests/ephemeral-services.test.mjs tests/training-harness.test.mjs \
  tests/signal-cleanup.test.mjs tests/cleanup-safety.test.mjs
```

结果：39/39，通过，exit 0，无失败、跳过或取消。覆盖真实临时库的初始化/升级一致、在考拦截、并发锁、依赖顺序、部分 DDL、持锁连接终止、结构漂移和 SQL 边界；真实 API 重启、启动/运行期信号、活进程故障时目录保留。

对应最终改动的实施者证据：隔离 `node tests/run-e2e.mjs --ephemeral --suite smoke` 94/94；server 构建与 26 项测试；web `npx vue-tsc --noEmit && npm run build`。未变化的生产 TypeScript/前端输入复用其最近通过证据，未为形式重复构建。Vite CJS 与锁文件依赖弃用警告为既有记录，未在本任务升级依赖。

## 独立审查

文档、迁移、测试运行器分别由独立 `gpt-5.6-sol / max` reviewer 审查；实施与定向测试由 `codex-auto-review` 执行。初审发现的六项 Important 及修复新增问题均已核销。迁移最终复审 `97613ef..3d14761`、运行器最终复审 `3159062..2e53d56` 均为无未处理 Critical/Important；不是整项业务的最终合并审查。

## 范围与风险边界

未读取 `.env`、未接入开发库、未执行生产升级；非测试命名的正式升级 CLI 仅在自有临时实例中验证。旧 smoke 使用 Mock AI，不等于真实 AI 供应商验收。A1 不包含新增 PC 页面实操，H5 明确排除。

早期失败测试遗留的 16 个系统临时目录曾按前缀、内容、时间窗与无进程检查清理，删除不可恢复；没有逐目录创建者日志，因此不把该检查表述为独立 owner 证明。确切路径和证据边界保留在本工作区 `.superpowers/sdd/2026-10-21-training-admin-integration/task-A1-report.md`。后续只清理运行器明确持有的进程和目录，不再按前缀扫删。

执行中未找到引用的 DDD/public reviewer 附加文件，使用实际 AGENTS、批准规格及 reviewer 配置；未虚构缺失规范。完整执行裁决与分工保存在同目录 `progress.md`。
