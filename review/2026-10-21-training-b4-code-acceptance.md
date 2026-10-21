# B4 Excel/TXT 题库导入代码验收

- 已审候选：`565c7f08f458ace4457655035e31c662953d0481`，来源基线 `1dad012`；合入已接受 B2 的 `78b356d`。
- 范围：统一十列 Excel/TXT 模板、严格预检查、合法行确认、幂等批次、四题型/三级难度、approved 题目版本，以及 PC 导入页面。
- 独立审查：原 I1—I5 与 root 补充 I6 全部由 fix1 修复，review2 的 Spec Compliance / Task Quality 均 Approved，无未关闭 Critical/Important。

## 验证证据

- root 检查八个公共文件冲突的兼容并集；业务代码与已审 B4 候选逐路径零差异，B2 学习协议及 006/schema 保持不变。应用注册无重复，文档路由合计162，32张业务表+1张迁移元数据表。
- 合并态服务端 `npm test`：pretest build 成功，21 files / 234 tests 通过；前端77项通过，`vue-tsc --noEmit` 与 Vite build（1774 modules）通过。
- B2 连接配置/runner 环境纯测试10项通过；暂存差异格式检查通过。
- 独立 tester 在相同合并态串行执行标准 `--ephemeral --suite training-video-learning` 与 `--suite training-question-import`，均 exit0。前者由 runner 精确注入 pool2；后者不继承该 override。两个 owned 临时库及对应进程已按精确记录清理。
- 导入真实 HTTP 覆盖模板一致、合法/错误/重复行、四题型/三难度、同批幂等、跨批并发、归属/kind/动态撤权，以及第二行版本写入失败时题目、版本、媒体引用整批回滚。
- 同 manager 媒体校验另有真实隔离数据库的双连接并发 service 回归；不是完整导入 HTTP 小连接池压力测试。
- 前端8项导入专项测试调用被实际 SFC 使用的生产 workflow，并由独立审查核对接线；它们不是挂载整个导入 SFC 或浏览器原生文件选择的证据。
- B4 不改 schema，未重复运行不变迁移；本次组合验证不是完整 all/C7 验收。

## 关键边界

- students 通用确认入口固定批次 kind，不能绕过 questions 写权限；questions 专用入口保留 owner/kind 校验。
- 同类别批次先排序加锁，再用调用方 manager 当前读复核指纹，避免旧预览并发重复入库；不静默改变用户选定行。
- 媒体 ready/purpose/owner 校验由原 MediaService 统一维护，调用方事务透传 manager，不额外借用连接。
- 页面旧请求不能覆盖新批次或离页后导航；不可确认的响应保留原批次，先查询，不自动重发提交。
- MySQL 事务保存批次、版本及审核事实；既有 JSONL 审计在提交后记录，不宣称文件系统与 MySQL 原子提交，也未新增审计架构。
- 前两次候选 API 运行失败分别为测试读取错误响应字段、prepared execute 不支持 trigger DDL；均保留在实施报告，修复未削弱业务断言。

## 未覆盖与后续

- 用户已推迟原生文件选择；手动选文件、完整 PC 流程和人工页面验收仍待后续，不标记通过。
- 无独立 H5、真实 AI provider、旧站数据迁移或生产部署验收；既有 Vite CJS warning 留 C7。
- 完整实施、独立复审和组合运行记录保存在本计划忽略目录的 `task-B4-report.md`、`task-B4-review1..2.md`、`task-wave4-b2-b4-merge-report.md`、`task-wave4-b2-b4-api-report.md`。原工作目录与开发数据未修改。
