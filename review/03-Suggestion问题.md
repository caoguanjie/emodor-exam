# Suggestions (CONSIDER) — 15 项

> **判定标准**：可优化点、最佳实践建议、可读性增强、可观测性提升、开发规范统一。
>
> **修复要求**：不阻断开发，建议在实现阶段随代码评审逐步采纳；部分项（如 S-01 术语取舍说明）可直接通过文档补一段说明完成。

---

## S-01. AI 结构化输出未含 `score`（分值）字段，与 Requirement 2 字面表述略有出入，建议显式说明取舍

**来源视角**：completeness

**位置**：
- [05-模块设计.md §4.4.3 提示词策略](/Users/pangongxia/agent_workspace/RuleExam/docs/design/05-模块设计.md)
- [05-模块设计.md §4.4.5 100 分分值分配规则](/Users/pangongxia/agent_workspace/RuleExam/docs/design/05-模块设计.md)

**Problem**：Requirement 2 Scenario 列出结构化输出应包含"题干/选项/答案/解析/**分值**"五项。05 §4.4.3 提示词模板的 JSON Schema 仅约束 `type / stem / options / answer / analysis` 四项，**`score` 不由 AI 输出**，而是在 §4.4.5 落库时按模板（single 3 分 / multiple 8 分）写入 `question.score`。此设计在工程上更稳健（分值是业务配置而非语义内容，避免 AI 输出分值与模板冲突），但与 Requirement 字面表述存在偏差，文档未显式说明此取舍，评审者可能误判为遗漏。

**Fix**：在 05 §4.4.3 提示词模板下方或 §4.4.5 分值分配规则表前补一段"设计取舍说明"：明确「`score` 不纳入 AI 结构化输出，由发起出题时的分值模板（`singleScore` / `multipleScore`）在落库事务中统一写入 `question.score`，理由：① 分值是试卷级业务配置，同一题可被多张试卷以不同分值引用；② 避免 AI 输出分值与模板合计 ≠ 100 的冲突；③ Requirement 2 的"分值"语义由模板参数 + `paper_question.score` 共同承载」。

---

## S-02. ER 图中 `learning_record` 与 `sys_user` / `regulation` 的基数标注应为 1:1，且缺 `learning_record.version_id → regulation_version` 关系

**来源视角**：correctness

**位置**：[03-数据库设计.md §2.2 关系清单（L133-L137）与 §2.1 ER 图](/Users/pangongxia/agent_workspace/RuleExam/docs/design/03-数据库设计.md)

**Problem**：关系清单把 `learning_record ↔ sys_user / regulation` 标为 **1:N**，但该表的 `uk_user_regulation(user_id, regulation_id)` 唯一约束与文档自述「每人每制度一条汇总记录」表明实为 **1:1**（`learning_session` 才是 1:N）。基数标注错误会误导实现者按 1:N 建仓储方法（返回数组而非单对象）。另外 ER 图未画 `learning_record.version_id`（或 `learning_session.version_id`）到 `regulation_version` 的关系，而 05 §5.4.1 步骤 3 明确写入 `version_id = current_version_id`，04 进度响应也返回 `version_id` —— ER 关系不闭环。

**Fix**：关系清单该行基数改为 `1 : 1`（注明由 `uk_user_regulation` 保证），ER 图补 `regulation_version ||--o{ learning_session : "version_id"` 与 `learning_record` 的对应边。

---

## S-03. 列表接口未定义排序参数与默认排序键

**来源视角**：correctness

**位置**：[04-API设计.md §1.2 统一响应结构 · 分页约定（L41-L50）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/04-API设计.md)

**Problem**：分页约定只规范了 `page` / `page_size` 与响应结构，全部 8 组列表接口（`/users`、`/regulations`、`/ai/questions`、`/statistics` 等）均未定义排序参数与默认排序键。缺失默认排序键会导致 `LIMIT/OFFSET` 分页在无 `ORDER BY` 时结果不确定（MySQL 不保证稳定顺序），翻页出现重复/遗漏行；题库、制度列表尤其明显。

**Fix**：在 §1.2 补一条通用约定：`sort`（白名单字段，如 `created_at` / `score` / `sort`）+ `order`（`asc` / `desc`，默认 `desc`），且**所有列表接口强制以主键 `id` 作为最终 tie-breaker**（`ORDER BY {sort} {order}, id DESC`）以保证分页稳定；白名单校验防止 SQL 注入（配合 §4.4.1 参数化查询）。

---

## S-04. `GET /users/import-template` 与 `GET /users/{id}` 存在路由匹配顺序风险

**来源视角**：correctness

**位置**：[04-API设计.md §3.2 员工管理 /users（L127-L132）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/04-API设计.md)

**Problem**：两条路由同级，`/users/{id}` 是通配占位符。NestJS（Express 路由）按注册顺序匹配，若 `@Get(':id')` 先于 `@Get('import-template')` 注册，则模板下载请求会被 `:id` 捕获并以 `id = "import-template"` 进入员工详情查询 → 参数校验失败（40xxx）或 BIGINT 隐式转换问题，模板永远下载不到。

**Fix**：把静态路由改为不与占位符同级的形式，如 `GET /users/import/template` 或 `GET /user-import-template`；若保留原路径，则在 04 注明「Controller 中静态路由必须先于参数路由声明」并纳入代码评审检查项。

---

## S-05. 用 `PUT` 表达非幂等的业务动作（归档 / 解析重试 / 启停），与 04 册自述的 REST 语义不符

**来源视角**：correctness

**位置**：[04-API设计.md §1.1 基础约定（L16）、§3.3（L146）、§3.4.1（L163、L166）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/04-API设计.md)

**Problem**：§1.1 声明「PUT 修改」，但 `PUT /regulations/{id}/archive`、`PUT /regulations/{id}/versions/{versionId}/retry`、`PUT /users/{id}/status`、`PUT /departments/{id}/parent` 都是**动作型端点**而非资源全量替换。其中 `retry` 语义上非幂等（每次调用都新建一次解析任务），用 PUT 会误导客户端做自动重试（PUT 幂等 → 重试安全），可能造成同一版本被多次投递解析（与 W-12 的并发双解析叠加）。§1.1 又写「POST 创建与动作」，自相矛盾。

**Fix**：动作型端点统一改为 POST：`POST /regulations/{id}/archive`、`POST /regulations/{id}/versions/{versionId}/retry`、`POST /users/{id}/disable` 与 `/enable`；或保留 PUT 但在 §1.1 明确「PUT 用于状态字段的部分修改（非全量替换），其中 `retry` 类非幂等动作一律用 POST」。

---

## S-06. 07 册依赖的 `GET /api/v1/health` 未收录于 04 册接口清单，鉴权豁免也未在契约册声明

**来源视角**：correctness

**位置**：
- [07-安全与非功能设计.md §6.1 健康检查（L508）、§2.3.2（L126）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)
- [04-API设计.md §2 模块与路由总览（L85-L96）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/04-API设计.md)

**Problem**：07 §6.1 的 api 容器健康检查依赖 `GET /api/v1/health`（探活 MySQL 连接池 + Redis PING + 磁盘余量），§2.3.2 也写了「全部接口（除登录 / **健康检查**外）经三级守卫」；但 04 八大前缀共 63 个接口中**没有 health**，§1.4 守卫链章节也只豁免了「公开」标记的登录接口。契约缺失会导致：健康检查端点被全局守卫拦截（容器永远 unhealthy → `restart: unless-stopped` 无限重启），或实现者自行添加而响应结构不符合 `{code, message, data}` 约定。此外该端点会暴露内部依赖状态（MySQL/Redis/磁盘），若真豁免鉴权则需限定只允许容器网络访问。

**Fix**：04 §2 新增一行「`/health` | 基础设施（非业务模块） | 1 | 容器探活，豁免认证，仅限 Compose 内部网络访问（nginx 不对外代理该路径）」，接口总数 63 → 64；并定义其响应结构（`{status: "ok", mysql: "up", redis: "up", disk_free_mb: 12345}` 是否套用统一信封需明确）。

---

## S-07. 心跳时长计算 `delta_s` 向下取整造成系统性少计，600 秒阈值下约需多等 10~20 秒

**来源视角**：correctness

**位置**：[07-安全与非功能设计.md §3.1.2 容差校验算法伪码（L187-L190）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)

**Problem**：伪码 `delta_s = (now - last_beat_at) / 1000  # 向下取整`，每拍最多丢失 0.999 秒。默认 `required_minutes = 10`（600 秒）、30 秒/拍 → 约 20 拍，累计损失期望 ≈ 10 秒、最坏 ≈ 20 秒。表现为用户进度条显示 590/600 却迟迟不达标（`total_seconds` 是整型秒累加），需额外等待 1 拍，体验上像是 bug；对 `required_minutes` 较大的制度损失按比例放大（60 分钟制度损失约 60~120 秒）。

**Fix**：Redis 累计改为毫秒（`HINCRBY duration_ms <毫秒差值>`，封顶 45000），判定与响应时再 `FLOOR(duration_ms / 1000)` 换算为 `total_seconds`；落库 `learning_session.duration_seconds` 时统一取整口径。这样单会话最多损失 1 秒而非每拍 1 秒。

---

## S-08. Excel 批量导入未纳入 §4.3.1 的四步上传校验链（缺魔数与大小上限）

**来源视角**：correctness

**位置**：[07-安全与非功能设计.md §4.3.1 上传校验链（L387-L392）、§7.3（L606）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)

**Problem**：§4.3.1 的四步校验（扩展名白名单 / Content-Type / 魔法数 / 大小上限）只覆盖 `.pdf` / `.docx`，而 `POST /users/import` 同样接受文件上传（`.xlsx`），07 仅在 §7.3 一句「非 Excel 文件整体拒绝」带过，未定义魔数校验与大小上限。`.xlsx` 本质是 ZIP（`PK\x03\x04` + `[Content_Types].xml`），与 docx 同族但需区分 `xl/workbook.xml`；xlsx 解析库（如 exceljs/xlsx）对超大文件或 zip bomb（高压缩比）敏感——1000 行上限是**业务级**校验，发生在解析**之后**，无法阻止解析阶段的资源耗尽（T5 威胁在导入路径上未闭合）。

**Fix**：§4.3.1 表格增加「制度文件（pdf/docx）」与「员工导入（xlsx）」两列，xlsx 一列明确：扩展名 `.xlsx`、Content-Type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`、魔数 `PK\x03\x04` 且含 `xl/workbook.xml`、大小上限（建议 5MB）、解压后总大小上限（防 zip bomb，建议 50MB）；并说明业务级 1000 行上限在文件级校验**之后**执行。

---

## S-09. NFR-03"1 万员工规模"与 03 册 §6.1"2,000 人"的口径已由 07 册 §5.1 调和，建议回填上游两册

**来源视角**：correctness

**位置**：
- [01-需求分析.md §6 非功能需求 NFR-03](/Users/pangongxia/agent_workspace/RuleExam/docs/design/01-需求分析.md)
- [07-安全与非功能设计.md §5.1 容量目标（L446）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)

**Problem**：01 NFR-03 写「统计查询 P95 ≤ 3 秒（**1 万员工**规模）」，03 §6.1 规模假设写 2,000 人、A-04 写「数千员工级」，三处口径不同。07 §5.1 用「在职员工 2,000 人（**统计性能按 1 万员工规模校验**）」做了调和，是正确处理方式，但上游两册未同步，读者从 01 或 03 入手仍会误判性能基准（索引设计与 `exam_answer` 300 万行估算都建立在 2,000 人之上）。

**Fix**：在 01 NFR-03 括注「（1 万员工为性能校验规模，常态规模为 2,000 人，见 07 §5.1）」，03 §6.1 补同一句交叉引用，使三册一致。

---

## S-10. 净化白名单保留 `a[href^="http"]` 但未要求 `rel="noopener noreferrer"`，且外链在企业内网场景的可用性存疑

**来源视角**：correctness

**位置**：[07-安全与非功能设计.md §4.3.2 解析产物 XSS 净化（L403）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)

**Problem**：白名单允许 `a[href^="http"]`，但净化规则未要求补 `rel="noopener noreferrer"`——`target="_blank"`（mammoth 可能保留）的链接在新窗口打开时，目标页可通过 `window.opener` 反向操作阅读页（`opener.location` 跳转），在内网系统上构成钓鱼跳板；同时 CSP 未限制 `connect-src` / 未声明外链策略，而系统部署于内网（A-04），`http(s)://` 外链多半不可达，点击后表现为长时间挂起。

**Fix**：净化规则补「所有保留的 `<a>` 强制注入 `rel="noopener noreferrer"`，移除 `target` 属性（或统一为 `_blank` + 上述 rel）」；并在 §4.4.2 或 §7.3 声明外链策略（如「内网部署下正文外链仅展示为纯文本，不可点击」），避免员工点击后误判系统故障。

---

## S-11. "短时失焦（<45 秒）在未触发 pause 时被全额计入"的信任边界未在 07 §3.3 显式声明

**来源视角**：correctness

**位置**：
- [05-模块设计.md §5.4.3 方案取舍（L857）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/05-模块设计.md)
- [07-安全与非功能设计.md §3.3 防作弊能力边界声明](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)

**Problem**：05 §5.4.3 诚实指出「短时失焦（如 10 秒，断流封顶会因 `diff ≤ 45 秒` 而全额计入）」是显式 pause/resume 方案要解决的问题，但 07 §3.3 的边界声明表只列物理作弊（拍照、代考、线下协作、发呆），**未收录「前端未按约定调用 pause 时的时长误差上界」**。这是设计上已知且可量化的残余风险（每次 ≤45 秒，理论上反复触发可累积），应作为诚实边界的一部分写入安全册，否则验收时会被当作缺陷提出，且缺少「累计误差监控」的设计输入。

**Fix**：07 §3.3 表格增加一行「失焦事件漏报（前端未调用 pause / 事件被浏览器节流）| 单次最多计入 45 秒 | 浏览器事件不可强制送达，服务端只能按心跳间隔推断」；并在 §6.3 监控项补「单会话 `pause` 次数为 0 但会话时长 > 20 分钟的比例」作为漏报观测指标。

---

## S-12. 选项乱序的 PRNG 派生函数 `hash(seed, question_id)` 未指定算法与截断长度，跨语言/跨版本重算一致性无保障

**来源视角**：correctness

**位置**：[07-安全与非功能设计.md §3.2.1 第 3 点（L266）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)

**Problem**：题目乱序明确了「Fisher-Yates + seed 驱动的确定性 PRNG」，但选项乱序只写「PRNG 种子 = `hash(seed, question_id)`」，未指定：hash 算法（SHA-256? Blake2?）、输出如何截断为 PRNG 种子（取前 8 字节? 全 32 字节?）、PRNG 具体实现（`seedrandom`? 自研 xorshift?）、Fisher-Yates 的随机数取模方式（`% n` 会引入模偏差）。这些细节决定「同一记录任意时刻重算结果一致」能否成立——若实现者在恢复作答路径与交卷还原路径使用了不同 PRNG 库（或库升级改变算法），映射立即错位，后果同 C-05/C-06。

**Fix**：在 07 §3.2.1 补一段规范化定义：`option_seed = SHA-256(seed || ":" || question_id)` 取前 8 字节为 64 位整数 → 使用固定的 splitmix64/xorshift128+ 实现 → Fisher-Yates 采用「拒绝采样」而非取模以避免偏差；并声明「PRNG 实现与参数属判分关键路径，变更需与 `EXAM_SHUFFLE_SECRET` 同等对待（不得在有 `in_progress` 记录时变更）」。

---

## S-13. 交卷幂等的 Redis 锁 TTL 10 秒与判分事务耗时上限（NFR-02 交卷评分 ≤ 3 秒）之间缺少锁续期与失败释放约定

**来源视角**：correctness

**位置**：
- [05-模块设计.md §6.4.5 交卷幂等三重保障](/Users/pangongxia/agent_workspace/RuleExam/docs/design/05-模块设计.md)
- [07-安全与非功能设计.md §3.2.4（L313-L315）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)

**Problem**：三重保障为 `SET exam:lock:submit:{record_id} NX EX 10` + 状态机单向 + `UPDATE ... WHERE status='in_progress'` 乐观锁。设计正确，但两处边界未写明：
1. 判分事务若在 10 秒内未完成（25 题批量 INSERT + MySQL 抖动 + 100 人并发交卷峰值），锁自动过期而事务仍在进行，第二个请求可获得锁 → 此时依赖第二、三层拦截（`status` 已非 `in_progress` 或 UPDATE 影响行数 0），逻辑上安全，但**若第一个事务最终回滚**，`status` 仍为 `in_progress` 而考生已收到「交卷成功」以外的错误响应，重试路径未定义（Redis 暂存答案是否已被 DEL？）
2. 锁在事务失败时是否主动释放未说明（不释放则考生需等 10 秒才能重试，考试限时照扣）

**Fix**：明确三条：锁 TTL 设为「判分 P99 耗时 × 3」（建议 30 秒）；事务失败（回滚）时在同一异常处理中 `DEL exam:lock:submit:{record_id}` 且**不删除** `exam:answer:{record_id}`，返回 50xxx 并允许考生立即重试；事务成功提交后再 DEL 暂存答案键（顺序：提交 → DEL 答案 → DEL 锁），避免「已删暂存但事务回滚」导致答案不可恢复。

---

## S-14. 业务码前缀"409"却映射 HTTP 403（40901/40902），与同段 40903–40907 的 409 语义不齐

**来源视角**：impact

**位置**：[04-API设计.md §5.2 错误码明细（L610-611）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/04-API设计.md)

**Problem**：40901「无考试资格」、40902「补考次数用尽」的业务码前缀为 `409`，但 HTTP 列映射为 **403**；而同为 `409xx` 段的 40903–40907 均映射 **409**。README §3.4 只约定 40xxx=客户端错误（已满足，非分段违规），但 04 内部「409 前缀→403」的编码约定不统一，易让前端按前缀推断 HTTP 语义时误判。

**Fix**：统一约定——要么将 40901/40902 的业务码改到 403xx 段（如无权限/前置不满足），要么将其 HTTP 映射改为 409；并在 §5.1 分段规则补一句「业务码前 3 位与 HTTP 状态码的对应约定」以消除歧义。

---

## S-15. 报表列名"已完成学习人数"与 README 术语"有效学习"轻微偏离

**来源视角**：impact

**位置**：
- [README.md §3.2 核心术语表「有效学习」](/Users/pangongxia/agent_workspace/RuleExam/docs/design/README.md)（L72）
- [05-模块设计.md §7.4 统计报表列定义](/Users/pangongxia/agent_workspace/RuleExam/docs/design/05-模块设计.md)（L1174、L1285-1286）

**Problem**：README 基准术语为「有效学习」（`is_valid = 1`），01 FR-STT-01 亦用「学习完成率 = `is_valid` 人数 / 应学人数」。但 05 报表列名用「**已完成学习人数**」，属同义非基准表述。语义虽可推断为 `is_valid` 计数，但与基准术语存在轻微漂移，报表口径评审时可能引发「完成学习 vs 有效学习」的歧义。

**Fix**：将 05 §7.4 报表列名「已完成学习人数」统一为「有效学习人数」（或在列定义处显式标注「= `learning_record.is_valid = 1` 计数」），与 README §3.2 术语及 01 FR-STT-01 口径对齐。

---

## Suggestion 汇总表

| # | 标题 | 主责文档 | 类型 |
|---|---|---|---|
| S-01 | AI 结构化输出 score 字段取舍说明 | 05 | 文档说明 |
| S-02 | ER 图 learning_record 基数与 version_id 关系 | 03 | 图示纠正 |
| S-03 | 列表接口排序参数与默认键 | 04 | 契约规范 |
| S-04 | /users/import-template 路由匹配顺序 | 04 | 实现提示 |
| S-05 | PUT 表达非幂等动作 | 04 | REST 语义 |
| S-06 | /health 未收录于 04 接口清单 | 04、07 | 契约补齐 |
| S-07 | 心跳 delta_s 向下取整少计 | 07 | 性能细节 |
| S-08 | Excel 导入未纳入四步上传校验链 | 07 | 安全边界 |
| S-09 | NFR-03 员工规模口径回填 | 01、03、07 | 文档口径 |
| S-10 | a[href] 未要求 rel="noopener noreferrer" | 07 | 安全最佳实践 |
| S-11 | 短时失焦全额计入的信任边界声明 | 05、07 | 边界文档化 |
| S-12 | 选项乱序 PRNG 派生函数未指定算法 | 07 | 实现规范 |
| S-13 | 交卷锁 TTL 与失败释放约定 | 05、07 | 边界条件 |
| S-14 | 业务码 409 前缀却映射 HTTP 403 | 04 | 编码约定 |
| S-15 | 报表列名"已完成学习人数"术语偏离 | 05 | 术语对齐 |
