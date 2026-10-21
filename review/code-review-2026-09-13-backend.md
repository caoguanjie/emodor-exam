# Code Review 报告 — RuleExam 后端全量审查（server/）

> **一句话结论**：对 `server/` 全部后端代码做全量审查（HEAD `5d6e3a0`），发现 **1 项 Critical + 6 项 Warning** 达到确认门限（置信 ≥80），其中最严重的是**考试进行中即可通过成绩接口拉取全卷答案与解析**（判分完整性击穿）；另 15 项 60–79 分档建议修复项；**上一轮 17 项修复逐项核查全部落地、无回归**。
>
> **修复状态（2026-09-13）**：§2 七项确认问题已全部修复并通过验证（构建/vitest 17/17/e2e 92/92），明细见 [fix-log-2026-09-13-backend.md](./fix-log-2026-09-13-backend.md)；§3 建议修复项未动。

---

## 1. 评审元信息

| 项 | 内容 |
|---|---|
| 评审对象 | `server/src` 全部 62 个 TS 源文件 + `database/init.sql` + `database/seed.mjs`（HEAD `5d6e3a0`，工作区干净） |
| 评审依据 | `AGENTS.md` 架构红线、`docs/design/` 01~07 分册（重点 03/04/05/06/07）、`review/` 既有评审与修复记录 |
| 评审方法 | 5 个独立视角子代理并行审查（红线合规 / 公共与账号域 / 制度与 AI 域 / 学习·考试·统计域 / 修复回归与注释符合性）→ 主评审逐条读码核实 → 按置信度 0–100 打分：≥80 收录为确认问题，60–79 收录为建议修复，<60 仅备查或排除 |
| 评审日期 | 2026-09-13 |
| 排除约定 | 上一轮 17 项已知问题（`code-review-2026-09-13.md`）不重复上报；但其修复完整性单独核查（§5） |

---

## 2. 确认问题（置信 ≥80）

### C-1 [Critical] `result()` 不校验考试状态，进行中即可拉取全卷答案与解析（置信 95）

`server/src/modules/exams/exam.service.ts:537-579`：方法注释声称「解析仅在交卷后下发（04 册 3.7）」，但整个方法只做了属主/角色校验（541-543 行），对 `status === 'in_progress'` 的记录照常逐题返回 `answer` 与 `analysis`（574-575 行）。对比同文件 `heartbeat()`（338-342 行）对超时/终态有硬拦截，`recover()` 对在考状态亦有区分，唯独 `result()` 没有状态门。

- **触发**：员工 `POST /exams/papers/{id}/start` 开考后，直接 `GET /api/v1/exams/records/{id}/result`（自己是 owner，全部校验通过），响应含每题正确答案（原始下标）与解析，照抄后交卷即满分。
- **红线出处**：AGENTS「考试下发 payload 不含答案与解析」；04 册「解析仅在交卷后的成绩回看中下发」、05/06 册同口径。
- **修复方向**：`record.status === IN_PROGRESS` 时拒绝（`submitConflict`）或降级为不含 answer/analysis 的受限视图；补 e2e 断言（现 e2e 仅在交卷后调用该接口，未覆盖在考场景）。

### W-1 `submit()` 超时后仍接受请求体新答案并计分（置信 88）

`server/src/modules/exams/exam.service.ts:402-430`：交卷路径对超时只打标（403 行 `isTimeout`），426-428 行仍把请求体答案无条件并入暂存集合并送判分。心跳路径超时是硬拦截并立即自动交卷（338-342 行），两者语义矛盾。

- **触发**：deadline 已过但 30 秒扫描尚未收口时（`status` 仍为 `in_progress`），考生在截止后补完/改好的答案随 `POST /submit` 提交，按超时口径照样计分通过；`examSweepRunning` 重入互斥或扫描阻塞时窗口更长。
- **修复方向**：`isTimeout` 时忽略请求体增量、只用 Redis 暂存判分（与 `autoSubmit` 口径一致）。

### W-2 `trust proxy: true` + nginx XFF 追加 → 登录 IP 限流可完全绕过、审计 source_ip 可伪造（置信 90）

`server/src/main.ts:16` 设置 `trust proxy` 为 `true`（Express 取 X-Forwarded-For 最左项），而 `deploy/nginx/default.conf:34` 用 `$proxy_add_x_forwarded_for`（追加而非覆盖），客户端自带的伪造 XFF 头落在最左侧并被采信。`server/src/modules/auth/auth.service.ts:91-93` 的 `auth:ip:{ip}` 限流键、全仓审计日志的 `source_ip` 均取自 `req.ip`。

- **触发**：攻击者每次请求携带随机 `X-Forwarded-For`，IP 限流键永远落在不同键上，10 次/分钟限流失效，可对全量用户做不限速密码喷洒（并打满 cost=12 的 bcrypt）；审计追溯（07 册 4.5）同时失效。
- **修复方向**：`trust proxy` 配置为具体反代网段/跳数；或 nginx 改为覆盖式 `proxy_set_header X-Forwarded-For $remote_addr`（`X-Real-IP` 已是覆盖式，可改读它）。

### W-3 学习 `start()` 单活跃约束为 check-then-act，竞态可并行多会话 N 倍计费（置信 85）

`server/src/modules/learning/learning-session.service.ts:214-241`：215 行读活跃指针、217 行 flush 旧会话、220 行 INSERT（慢路径）、240 行写回指针，全程无锁（对比考试开考有 `exam:lock:start` SETNX）。并发两次 `start` 都读到空指针 → 各自建会话，后写者覆盖指针，先开会话成为「孤儿活跃会话」：DB `ended_at IS NULL`、Redis 态健在。`doHeartbeat`（257-289 行）只校验存在/归属/未结束，**不校验本会话是否仍是活跃指针指向的会话**；兜底扫描只收口 90 秒无心跳的会话，被持续心跳的孤儿永不收口。

- **触发**：双标签页/脚本并发开考，N 个会话各自按 `min(now − 自身 last_beat, 45s)` 计费，同一段墙钟时间被计 N 次，`learning_record.totalSeconds` 倍速累计，绕过「单活跃会话」防刷约束。
- **红线出处**：AGENTS「单活跃会话」；06 册「同一用户同一制度至多一个会话在累计」「旧会话心跳不再计费」。
- **修复方向**：start 加 `learn:lock:start:{userId}:{regId}` SETNX；`doHeartbeat` 校验活跃指针归属（非指向即按收口处理）。

### W-4 版本上传 `ER_DUP_ENTRY` 兜底先删 tmp 再用，重试必失败（置信 82）

`server/src/modules/regulations/regulation-version.service.ts:114-136`：catch 块第一行（115 行）`rmSync(tmpPath)` 后，`ER_DUP_ENTRY` 分支事务内（134 行）还要 `renameSync(tmpPath, retryAbs)` → 必然 ENOENT，重试事务回滚、请求 500。117 行注释声称的「兜底并发上传：冲突时重读重分配」从未生效过。

- **触发**：两个管理员并发向同一制度上传，`nextVersionNo` 的 MAX+1 竞态使后者撞 `uk_regulation_version_no` 进入重试分支即崩。
- **修复方向**：tmp 清理移到重试事务之后（finally），或重试前重新落盘。

### W-5 题目编辑仅改 `options` 绕过形状校验，答案下标失配污染在用试卷判分（置信 82）

`server/src/modules/ai/question-review.service.ts:115-128`：`validateQuestionShape`（至少 2 个选项、答案下标不越界）仅在 `patch.answer !== undefined` 分支执行；仅改 `options` 完全绕过。`server/src/modules/ai/ai.controller.ts:54-60` `EditQuestionDto.options` 有 `@ValidateNested` 但缺 `@ArrayMinSize(2)`（与 `CreateQuestionDto` 不对称）。`assertNotInLiveExam` 只挡 in_progress 考试，且取卷/判分均实时读 `question` 表（无快照）。

- **触发**：approved 题 `answer=[2,3]`（4 选项），管理员编辑 options 只传 2 项 → 落库后答案越界，后续所有使用该题的已发布试卷判分错乱（考生永远无法选到 [2,3]，全员该题 0 分）。
- **修复方向**：`patch.options !== undefined || patch.answer !== undefined` 任一命中即以「合并后的新 options + 新 answer」整体走 `validateQuestionShape`；DTO 补 `@ArrayMinSize(2)`。

### W-6 `saveScope` 非事务先删后插，insert 失败即已发布制度对全员瞬间不可见（置信 80）

`server/src/modules/regulations/regulation-scope.service.ts:38-42`：`delete` 与 `save` 不在同一事务，且 `department_ids` 不做存在性校验。任一非法 id（如字母串）使 insert 失败 → delete 已提交 → `getScope()` 返回空集 → `isUserInScope` 一律 false → 已 published 制度对全体员工 40402，直到管理员重新保存。并发两次 PUT 交错 delete/insert 还会产生两范围并集（意外扩围）。

- **修复方向**：包进事务；插入前校验部门存在性。

---

## 3. 建议修复（置信 60–79，未达确认门限）

| 编号 | 位置 | 问题 | 置信 |
|---|---|---|---|
| S-1 | `users/user-import.service.ts:146-148` | 批量导入口令仅查长度+字符类，未走 `validatePasswordStrength`（黑名单 41 项、个人信息 3 字符子串均缺失）——上轮 #5 的修复范围为 create/resetPassword，import 层为历史已知取舍，建议统一口径 | 78 |
| S-2 | `regulations.controller.ts:38-43`（ScopeDto） | `is_all` 无 `@IsBoolean`，`"false"`/truthy 字符串经 `!!` 翻转为**全员可见**（越权暴露面） | 76 |
| S-3 | `users/users.service.ts:121-146` | `update()` 变更角色不写 `auth:block`（setStatus/resetPassword 均写），被降权管理员凭存量 access token（2h）继续调管理端接口；RolesGuard 读 token 内 role | 75 |
| S-4 | `users/users.service.ts:121-146` | `update()` 可把 id=1 唯一超管降级为 employee（setStatus 对 id=1 有显式保护，update 无对称防护；seed 幂等不重建），管理面 API 锁死只能改库恢复 | 72 |
| S-5 | `departments/department.service.ts:148-180` | `moveParent` 允许非根部门移到 `parent_id=null` 成为第二个根，破坏 `create()` 的唯一根不变式；导入路径解析根部门用 `parent_id IS NULL + getOne()` 将歧义 | 70 |
| S-6 | `ai/ai-gateway.service.ts:32-50` | `fetch` 未设 `redirect: 'manual'`，默认跟随 302 且不重过 `assertPublicHttpUrl`——被配置端点重定向到内网/环回即绕过白名单（POST 体含制度全文） | 68 |
| S-7 | `ai/question-review.service.ts:178-226` | `regenerate` 的 40908 检查在 AI 调用（最长 120s×重试）之前，TOCTOU 窗口内可开考换题；且不校验当前 status，approved 题也会被替换并打回 pending（FR-AIQ-05 语 义为 rejected→pending） | 62 |
| S-8 | `ai/question-generation.service.ts:92-114, 279/335/373` | 同制度出题任务互斥为 get-then-set 非原子，并发双任务并行；先完成者 `del(active)` 摘掉仍在运行任务的互斥标志 | 62 |
| S-9 | `common/redis.service.ts:126-141` | `incr` 的 INCR+EXPIRE 非原子，EXPIRE 丢失后 `auth:fail:*`/`auth:ip:*` 永不过期 → 永久锁定/永久 429（需人工清键）；应改 SET NX EX 或 Lua | 60 |
| S-10 | `regulations/parse-pipeline.service.ts:12-19` | 注释称「CPU 密集任务与事件循环隔离（02 册 R1）」，实际是进程内 async 队列，mammoth/unpdf 仍在主事件循环执行，大文件解析期间心跳等 API 延迟抖动 | 60 |
| S-11 | `statistics/statistics.service.ts:442-445` | `invalidateRegulationCache` 全仓零调用（注释称「事件失效由交卷/达标事务触发」），统计新鲜度退化为 TTL 300s + 10min 定时全清 | 55 |
| S-12 | `exams/exam.service.ts:601-606` | `checkAndSubmitIfExpired` 死代码；06 册 §4.3 双触发的辅通道（keyspace 过期事件）未实现（主扫描通道已覆盖可靠性，非安全项） | 55 |
| S-13 | `entities/learning-record.entity.ts:18` | 位图 `normalize` 死三元（两分支恒等）；`scroll_segments` 可经管理端改为非 10，旧位图索引被静默重锚定、底部段判定漂移 | 55 |
| S-14 | `exams/exams.controller.ts:7-13` + `exam.service.ts:352,427` | 交卷/心跳 payload 元素零校验，`selected` 非数组（如字符串）抛 TypeError → 50001（应 40001）；无计分伪造面（分值全部服务端读取） | 55 |
| S-15 | `ai/ai-config.service.ts:81-121` | 明文 api_key 写入 Redis 缓存（TTL 600s），抵消文件侧 AES-GCM 静态加密；`mask` 对 ≤7 字符 key 三段拼接等于回显全量 | 58 |
| S-16 | `main.ts:17-19` | 注释「请求体上限与上传上限一致（≤50MB）」与实现 `express.json({limit:'2mb'})` 不符（行为安全，注释失真，自初版即存在） | 55 |
| S-17 | `regulations/regulations.controller.ts:117` | `FileInterceptor` 硬编码 50MB 不读 `MAX_UPLOAD_SIZE` 配置，环境变量调整上传上限时 multer 层不跟随 | 55 |

备查（置信 <55，仅记录不展开）：`health.controller.ts:8` 注释称 Redis「PING」实为事件维护的缓存布尔；`shuffle.service.ts:10` 「不取模」措辞与「拒绝采样后归约」实现不符；出题跨任务去重仅取最近 200 条题干（`question-generation.service.ts:248-256`）；AI 返回题量无上限校验（`question-generation.service.ts:380-418`）。

---

## 4. 已核实通过的架构红线

- **统一信封/错误码/DTO**：`ResponseInterceptor` 全局注册、`{code:0,...}`、二进制流 `@SkipEnvelope` 仅 4 个下载端点；40xxx/50xxx 映射与 `errors.ts` 逐条吻合；全部 `@Body()` 走 `DtoValidationPipe`（`@Query()` 字面偏差见 §3 S-14 相邻说明，服务端有钳制无注入）。
- **无外键 + 三方一致**：`init.sql` 全文无 FK/REFERENCES；12 张表实体与 DDL 逐一比对一致（抽查 `learning_session`/`exam_record`/`exam_answer`/`regulation_scope` 全对上）；`synchronize:false` 以 init.sql 为唯一权威。
- **学习时长服务端结算（除 W-3 外）**：30s 节拍、45s 封顶、<10s 高频 429、乱序丢弃、pause/resume 锚点语义、10 段位图只增不减、收口事务悲观行锁幂等；无任何接口接受客户端上报累计时长。
- **考试（除 C-1/W-1 外）**：取卷路径不含 answer/analysis；seed=HMAC(`EXAM_SHUFFLE_SECRET`, record_id)、生产强制注入；无人工改分端点；在考题目禁改判分字段（40908）与发布后锁题（40907）落实。
- **令牌吊销/refresh Cookie**：改密/重置/停用均即时写 `auth:block` 且 `iat < block_ts` 一律 40107；refresh 仅经 HttpOnly+SameSite=strict Cookie；access/refresh 类型严格分离。
- **SSRF 主体（除 S-6 外）**：保存与调用双点校验，协议/环回/内网 v4+v6 保留段拒绝；WHATWG 归一化下八进制/十六进制/整数 IP、IPv4-mapped IPv6 字面量绕过实测不成立（`new URL()` 先归一化再进黑名单）。
- **敏感值**：`server/src` 与种子脚本无凭据字面量；生产缺关键环境变量拒绝启动；开发兜底进程内随机；AI api_key AES-256-GCM 落盘且接口仅掩码回显（缓存侧问题见 S-15）。

---

## 5. 既有 17 项修复回归核查：17/17 无回归

对 `fix-log-2026-09-13.md` 全部 17 项逐项定位修复落点核查：#1 end() 合并已入互斥锁且幂等/锁序正确、#2 Dockerfile 两阶段均 node:22-alpine、#3 路由级守卫落地、#4 模板示例行合规、#5 create/resetPassword 均接三层策略、#6 三处 DTO 嵌套校验补齐（见 W-5：EditQuestionDto 仍缺 ArrayMinSize，服务层亦绕过）、#7 续登回带 force_change_password、#8 compose 透传 AI_EGRESS_ALLOW_HOSTS、#9 README 技术栈更正、#10 心跳注释与 5s 实现一致、#11 e2e 91 断言落地、#12-13 文档/证据链更正、#14 N+1 已批量化、#15 重复查询收敛、#16 种子正则统一、#17 scope 出入参对称。**结论：无回归**；唯 S-1（import 入口）与 W-5（EditQuestionDto）属同口径修复的未覆盖面，已单列。

---

## 6. 排除项（核实后判定误报/有意设计）

- **refresh 轮换不吊销旧 jti**：代码注释表明「旧 refresh 到期自然失效」为有意设计，07 册未作强制要求。
- **`@Query() query: any` 多处出现**：服务端有 page/page_size 钳制与参数化查询，无注入面，属类型字面偏差。
- **导入批量写入部分失败回填**：TypeORM 0.3.20 对 chunk 共用单事务整体回滚，降级重插计数自洽，非 bug。
- **守卫链/部门环检测/Redis 键前缀/首登强制改密闭环**：排查后确认自洽，无问题。
- **url-guard 字面量绕过类**（八进制/十六进制/整数 IP、mapped IPv6）：WHATWG URL 归一化后均落入黑名单，不成立。

---

## 7. 评审边界说明

- 本轮为代码全量审查，不涉及前端（`web/`）、测试脚本（`tests/`）与部署编排的深审（仅交叉引用核实）。
- 未运行构建/类型检查/e2e（按约定由 CI/常规流程承担）；所有发现均以读码证据为准，主列表 7 项经主评审逐行复核。
- 置信打分口径：95-100=证据直接确凿且高频可触发；80-94=复核确认、实际可触发且影响重要功能；60-79=核实为真但触发条件受限或影响有限；<60=备查或排除。
