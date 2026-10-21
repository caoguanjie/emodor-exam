# Critical Issues (MUST FIX) — 10 项

> **判定标准**：会导致系统无法工作 / 严重安全漏洞 / 数据丢失 / 业务规则明显错误 / 跨文档硬冲突使实现者无从选择。
>
> **修复要求**：进入实现阶段前**全部修复**，并在文档修订后触发一次增量核对。

---

## C-01. `regulation_version.file_path` 生成规则矛盾：hash 前缀「8 位」vs「16 位」，路径层级不一致

**来源视角**：impact（跨文档硬冲突）

**位置**：
- 基准侧：[05-模块设计.md §3.4.2 文件存储组织](/Users/pangongxia/agent_workspace/RuleExam/docs/design/05-模块设计.md)（L374）
- 漂移侧：[07-安全与非功能设计.md §4.3.2 文件存储与访问安全](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)（L400）

**Problem**：同一个落库字段 `regulation_version.file_path` 的生成规则，两册给出**互斥**的定义：

| 出处 | 路径规则 |
|---|---|
| 05 §3.4.2（模块实现规格） | `{UPLOAD_DIR}/regulations/{regulation_id}/{version_no}_{file_hash **前 8 位**}.{file_type}` |
| 07 §4.3.2（安全存储口径） | `{regulation_id}/{version_no}_{file_hash **前 16 位**}.{file_type}` |

矛盾点：① hash 前缀位数 **8 位 vs 16 位**；② 07 缺失 `regulations/` 目录层级。`file_path` 是持久化字段，07 §4.3.2 的下载链路依赖 nginx `X-Accel-Redirect` 按精确路径回读文件——若「写入」按 07（16 位、无 `regulations/`）而「读取/静态映射」按 05（8 位、含 `regulations/`），文件将无法定位，制度在线阅读与下载**直接失效**。

**Fix**：确定唯一权威值（建议以模块实现规格 05 为准），将 07 §4.3.2 L400 改为与 05 §3.4.2 逐字一致：
```
{UPLOAD_DIR}/regulations/{regulation_id}/{version_no}_{file_hash 前 8 位}.{file_type}
```
二者必须同值，并在两处互加「以 X 册为准」的引用锚点。

---

## C-02. 用户级封禁键 `auth:block:{user_id}` 采用纯 EXISTS 判定，改密/重置密码后新签发的令牌同样被拒 → 用户最长 7 天无法登录

**来源视角**：correctness（安全逻辑不闭环）

**位置**：[07-安全与非功能设计.md §2.1.4 登出与令牌吊销（L86）、§2.2.2（L105）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)

**Problem**：07 册 §2.1.4 第 2 点规定「改密成功、管理员重置密码、禁用账号时写入 `auth:block:{user_id}`，TTL = refresh 剩余有效期（最长 7 天）」，且守卫逻辑为「比对 `sub` 命中 `auth:block:{user_id}` 即拒绝」——这是一个**只认 `sub`、不认签发时刻**的判定。

推演改密链路：
1. 用户 `PUT /auth/password` 成功 → 写入 `auth:block:{user_id}`（TTL 7 天）
2. 07 §2.2.2 要求「须用新密码重新登录」→ 登录成功后签发的**新** access token 其 `sub` 仍等于 `user_id`
3. 守卫 `EXISTS auth:block:{user_id}` 命中 → **拒绝**

**结论**：改密（FR-ORG-06）与管理员重置密码（FR-ORG-03）之后，该用户在封禁键自然过期前（最长 7 天）**完全无法使用系统**。07 §2.2.3 第 3 步「修改密码成功后才发放完整令牌」同样被自己的封禁键拦死。文档全篇（含 04 §1.3、05 §2.4.1）均未定义「登录成功后 DEL 封禁键」或「按 `iat` 比较」的解封路径，属规则不闭环。

**Fix**：封禁键的值改为封禁时刻时间戳，守卫判定改为「`token.iat < block_ts` 才拒绝」（新签发令牌天然放行、旧令牌全部失效，正好实现「踢全部设备」的原意）；或在登录成功与改密成功的事务末尾显式 `DEL auth:block:{user_id}`。二选一并在 04 §1.3 与 07 §2.1.4 同步写明，同时给出对应的 40xxx 错误码（当前错误码表无「令牌已被用户级封禁」条目）。

---

## C-03. 首次登录强制改密机制可被平凡绕过：`last_login_at IS NULL` 标记在登录成功当拍即被清除

**来源视角**：correctness（安全逻辑不闭环）

**位置**：
- [07-安全与非功能设计.md §2.2.3 初始密码与首次登录强制改密（L111-L116）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)
- [04-API设计.md §3.1 认证模块（L119）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/04-API设计.md)

**Problem**：07 册以 `last_login_at IS NULL` 作为「当前密码从未成功登录过」的唯一标记，但 04 §3.1 的登录规则明确写「**成功更新 `last_login_at`**」，而 07 §2.2.3 第 3 步又要求此时只签发 `pwd_pending: true` 的受限令牌。两者时序冲突。

绕过路径极其简单：
1. 员工用 Excel 导入的初始密码登录 → 服务端校验通过 → 按 04 册写入 `last_login_at = now`，同时返回受限令牌
2. 员工**不改密码**，直接丢弃受限令牌、**重新登录一次**
3. 此时 `last_login_at` 已非 NULL → 判定条件不成立 → 签发**完整令牌** → 初始密码（模板明文列、批量分发、极可能弱口令）**长期有效**

07 册第 4 点「首次登录完成后正常更新 `last_login_at`」中「完成」指代不明（登录完成 or 改密完成），无法据以排除上述实现。该缺陷直接抵消 07 §2.2.3 的全部设计意图，并与 §2.2.2 的弱密码字典策略形成漏洞组合。

**Fix**：明确「受限令牌阶段**不得**写入 `last_login_at`，仅在 `PUT /auth/password` 成功（即完整令牌签发）的同一事务内写入」；并在 04 §3.1 登录规则中补一句例外说明。若不愿依赖时序约定，可改为以 `pwd_pending` 独立标记（如应用层 Redis 键 `auth:pwd_pending:{user_id}`，TTL 长期 + 改密后 DEL）承载，避免复用审计语义字段。

---

## C-04. `exam_record` 缺交卷截止时刻快照字段，超时扫描实时读取 `exam_paper.duration_minutes` → 管理员调小限时会误判已开考记录超时并强制自动交卷

**来源视角**：correctness（数据模型缺陷 + 业务规则冲突）

**位置**：
- [03-数据库设计.md §3.4.4 exam_record（L513-L531）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/03-数据库设计.md)
- [05-模块设计.md §6.4.3 考试计时服务（L1073）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/05-模块设计.md)
- 关联：[02-系统架构.md §3.5 R1](/Users/pangongxia/agent_workspace/RuleExam/docs/design/02-系统架构.md)

**Problem**：三处口径互斥且缺字段支撑：
1. 02 §3.5 R1 的应对措施原文是「**考试截止时间同步落 `exam_record`**，Redis 故障时定时任务直接扫库判超时」
2. 但 03 `exam_record` 字段表只有 `started_at` / `submitted_at`，**没有任何 deadline / expire_at 字段**，该应对措施无落点
3. 于是 05 §6.4.3 与 07 §3.2.3 的扫描条件写成实时计算 `started_at + duration_minutes × 60 ≤ now`，其中 `duration_minutes` 来自 `exam_paper` **当前值**

而 FR-AIQ-07 验收③ 明确要求「已发布试卷的 `duration_minutes` 修改后**对后续作答生效**」（即对已开考记录不应生效），05 §4.4.7 也写了「已开考记录 deadline 不变」。

推演：某试卷 `duration_minutes = 60`，考生 A 于 10:00 开考（应 11:00 截止）；管理员 10:25 将其改为 20 分钟；10:25:30 定时扫描计算 `10:00 + 20min = 10:20 ≤ 10:25` → 命中 → **按 Redis 暂存内容强制自动交卷，`status = timeout`**，考生损失 35 分钟作答时间。由于 C-05「成绩不可人工修改」，该错误成绩无法纠正，只能靠补考消耗 `max_attempts`。Redis 故障期间（`exam:deadline` 键不可用）扫描是唯一通道，误判概率进一步放大。

**Fix**：`exam_record` 增加 `deadline_at DATETIME(3) NOT NULL`，开考事务内一次性写入 `started_at + exam_paper.duration_minutes × 60`，此后不再变更；扫描条件改为 `status='in_progress' AND deadline_at <= NOW(3)`（`idx_status_started` 相应调整为 `(status, deadline_at)`），`exam:deadline:{record_id}` 的 TTL 与值均由该字段派生；02 §3.5 R1 的表述得到落地。字段增补须按 A-05 流程回填 README §3.3。

---

## C-05. 乱序 seed 由 `JWT_SECRET` 派生且映射不持久化，而 07 册将 `JWT_SECRET` 90 天轮换列为常规运维 → 轮换瞬间在考记录的还原映射错位、判分错误

**来源视角**：correctness（安全与业务耦合缺陷）

**位置**：[07-安全与非功能设计.md §3.2.1 试题与选项乱序（L264、L269）与 §2.1.3 密钥管理（L69）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)

**Problem**：07 §3.2.1 第 1 点定稿 `seed = HMAC-SHA256(JWT_SECRET, exam_record.id)`，第 6 点进一步声称「seed 完全由 `exam_record.id` 派生、**可随时重算**……无需 Redis 键持久化、**无降级路径**」；05 §6.4.2 同口径「映射无需持久化」。

但同册 §2.1.3 规定「密钥轮换建议周期 90 天，或疑似泄露时立即执行；过渡期 `JWT_SECRET` 为**新钥**（签发与验证），`JWT_SECRET_PRIOR` 仅用于验证」。

推演：轮换发生在 14:00，考生 A 于 13:45 开考（`duration_minutes = 30`，14:15 截止），其乱序映射由旧钥派生；14:05 A 断网重进或 14:10 交卷 → 服务端以**新钥**重算 seed → 得到完全不同的 Fisher-Yates 排列 →
1. 恢复作答时题目/选项顺序与开考时不一致，已答内容串位
2. 交卷时「按同一映射反查原始下标」得到错误的 `exam_answer.selected` → **判分错误**

由于选项乱序种子为 `hash(seed, question_id)`，错位是**全卷性**的。而 C-05 禁止改分，事故不可修复。07 册自称「无降级路径」使该风险没有任何兜底。

**Fix**：将乱序密钥与认证密钥**解耦**——新增独立环境变量 `EXAM_SHUFFLE_SECRET`（不参与 90 天轮换，仅在确认泄露且无在考记录时更换），`seed = HMAC-SHA256(EXAM_SHUFFLE_SECRET, exam_record.id)`；并在 07 §6.4 环境变量清单中登记。若不愿增加密钥，则改为开考时将 seed 写入 Redis `exam:shuffle:{record_id}`（TTL = `duration_minutes × 60` + 缓冲）作为权威源、密钥派生仅作 Redis 丢失时的兜底重算，同时删除 §3.2.1 第 6 点「无降级路径」的断言。

---

## C-06. 考试进行中题目仍可编辑（含 `answer` / `options`），而判分读取「交卷时刻的 `question.answer`」并按 `options` 下标重算乱序映射 → 题面与判分依据错位

**来源视角**：correctness（业务规则漏洞）

**位置**：
- [05-模块设计.md §4.4.6 题目编辑](/Users/pangongxia/agent_workspace/RuleExam/docs/design/05-模块设计.md)
- [06-关键流程.md §5.3 题目状态机](/Users/pangongxia/agent_workspace/RuleExam/docs/design/06-关键流程.md)
- 关联：[07-安全与非功能设计.md §3.2.1 第 3/5 点](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)

**Problem**：06 §5.3 状态机含自环 `approved --> approved : 编辑（保持 approved；判分始终以题目当前答案为准）`，05 §4.4.6 亦未限制「已被在考记录引用的题目不可编辑」，FR-AIQ-04 验收③ 更把「判分规则使用编辑后的答案」定为验收项。与 07 §3.2.1 第 3/5 点组合后产生两类硬错误：

1. **判分依据漂移**——考生 10:00 看到的题干/答案是编辑前版本，10:20 交卷时服务端以编辑后的 `question.answer` 比对，考生按原题面作答被判错
2. **乱序映射崩溃**——选项乱序是「对 `[0..n-1]` 下标做 Fisher-Yates，PRNG 种子 = `hash(seed, question_id)`」，若编辑改变了选项**数量**（如四选改五选）或顺序，重算得到的排列长度/内容与开考时下发给考生的 `options` 数组不一致，「反查原始下标」直接**越界或错位**，`exam_answer.selected` 落库为错误下标

两类错误都导致成绩错误，而 C-05 规定成绩不可人工修改，考生只能被迫补考。

**Fix**：在 05 §4.4.6 增加编辑前置校验：题目被任一 `exam_record.status = 'in_progress'` 的试卷引用时，**禁止修改 `stem` / `options` / `answer` / `type`**（仅允许 `analysis`），返回专用错误码；同时把 06 §5.3 的自环标注改为「编辑（无在考引用时；保持 approved）」。更彻底的方案是开考事务内将题面与答案快照固化到 `paper_question`（该表已有 `score` 快照先例），判分只读快照，从结构上消除漂移——此路径需按 A-05 回填 README §3.3。

---

## C-07. 失焦暂停存在两套互斥实现：07 册「停发心跳 + 心跳携带 `resumed` 标记」vs 04/05/06 册「独立 pause/resume 端点 + 会话 `state = paused`」，且 04 册心跳契约中根本没有 `resumed` 字段

**来源视角**：correctness（跨文档硬冲突 + 契约不存在字段）

**位置**：
- [07-安全与非功能设计.md §3.1.1（L159-L160）、§3.1.2 伪码（L185-L186）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)
- [04-API设计.md §3.6 学习模块（L219-L229）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/04-API设计.md)

**Problem**：07 §3.1.1 规定前端「页面失焦 → **停止心跳定时器**（停止上报）；恢复聚焦 → 立即补发一次 `resumed` 心跳（计 0 秒）」，§3.1.2 伪码第一行即「若本心跳带 `resumed` 标记：HSET last_beat_at = now；计入 0 秒；返回」。

而 04 §3.6 的接口清单是 `POST /learning/heartbeat/pause` 与 `POST /learning/heartbeat/resume` 两个**独立端点**，其心跳请求体只有 `session_id` / `dwell_segments` / `scroll_percent` 三个字段，**不含任何 `resumed` 标记**；05 §5.4.3 的锚点模型与 06 §3.2 决策图 V1 也都以服务端 `state = paused` 为前提。

两套机制不等价且不可共存，而 07 册附录又声明「后续分册（04~06）与本册冲突时以本册安全口径为基准」，会把实现者推向错误的一侧。按 07 册实现的后果：
1. 失焦时前端只停发心跳、不调 pause → 服务端 `state` 恒为 `active` → 若失焦 < 45 秒后前端恢复 30 秒节奏，下一拍 `diff ≤ 45` 被**全额计入**，直接违反 FR-LRN-03 验收②「失焦期间不产生有效时长累计」
2. 失焦 > 90 秒触发「离线收口」，会话被结束落库，此后 resume/心跳到达的是一个**已收口会话**，全套文档未定义其行为（40906 只覆盖「被新会话取代」），员工的 `required_minutes` 进度会被静默截断，触碰 NFR-12「进度不丢失」

**Fix**：以 04/05 册的 pause/resume 独立端点为唯一契约，修订 07 §3.1.1 为「失焦 → 立即调用 `POST /learning/heartbeat/pause`（服务端结算 ≤45 秒并置 `state = paused`）；恢复聚焦 → 立即调用 `POST /learning/heartbeat/resume`（仅重置锚点、计 0 秒）」，并删除 §3.1.2 伪码的 `resumed` 分支（改为「若 `state = paused`：不计费、不更新锚点，仅合并 `dwell_segments` 与 `max_scroll_percent`」）。同时补定义两条边界：`paused` 会话是否豁免 90 秒离线收口（建议豁免，改由 6 小时 Redis TTL 与 5 分钟兜底任务收口）；对已收口会话的 pause/resume/心跳返回何码（建议 40906 语义扩展为「会话已结束，请重新开始学习」）。

---

## C-08. 05 册心跳处理步骤 6 无条件执行 `state = active` 并更新锚点，与同表步骤 1、§5.4.3 状态图、06 册 §3.2 决策图 D2 直接矛盾 → `paused` 期间自第二拍起恢复计费

**来源视角**：correctness（业务规则自相矛盾）

**位置**：[05-模块设计.md §5.4.2 心跳处理流程（L812 与 L817）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/05-模块设计.md)

**Problem**：同一张流程表内自相矛盾。步骤 1 写「`state = paused` 下的心跳**忽略计费**、仅更新滚动位置（见 5.4.3）」，步骤 6 却无条件写「锚点更新：`last_beat_at = 服务端当前时刻`、**`state = active`**」。

按该表逐行实现：失焦后前端调用 pause → `state = paused`、锚点已结算；失焦期间若仍有心跳到达（前端未严格停发、网络重试、或攻击者主动补发）→ 步骤 1 跳过计费，但步骤 6 把 `state` 改回 `active` 并把锚点推进到 now；**再下一拍心跳即满足 `state = active`，`credited = min(diff, 45)` 正常入账** → 失焦期间持续计费。

05 §5.4.3 的状态图（`S2 --paused 期间收到普通心跳--> S2` 自环保持 paused）与 06 §3.2 决策图 D2（「不更新锚点」）都否定了步骤 6 的写法，说明步骤 6 是笔误级逻辑错误，但它位于「实现级设计基准」文档的执行步骤表中，会被直接照抄为代码，破坏 NFR-08 防线二与 FR-LRN-03 验收②。

**Fix**：步骤 6 改为条件执行：

```
| 6 锚点更新 | 若 state = active：last_beat_at = 服务端当前时刻；
              若 state = paused：不更新 last_beat_at、不变更 state（仅步骤 5 的滚动合并生效） |
```

并与 §5.4.3 状态图、06 §3.2 D2 三处交叉引用对齐（建议在 §5.4.2 表格下方补一句「paused 分支不推进锚点，见 5.4.3」）。

---

## C-09. 04 册接口清单缺失多个 P0 需求与被 07 册依赖的端点：重置密码、AI 配置读写、连通性测试、人工录入题目

**来源视角**：correctness（契约缺失）

**位置**：
- [04-API设计.md §3.2 员工管理 /users（L125-L133）、§3.5 AI 出题模块 /ai（L188-L201）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/04-API设计.md)
- 依赖方：07 §2.2.3、§4.2.2；05 §2.2、§4.4.x；FR-ORG-03、FR-AIQ-01、FR-AIQ-06

**Problem**：逐项核对确认四处契约缺失，且都有明确的 P0/P1 需求与安全册依赖：

1. `/users` 共 7 个接口（列表/详情/创建/修改/启停/模板/导入），**无重置密码端点**——而 FR-ORG-03（P0）要求「重置密码」且验收③「重置密码后旧密码失效」，07 §2.2.3 第 2 步更把「super_admin 重置密码：将 `last_login_at` 置回 NULL」写成安全机制的一环，05 §2.2 组件图也画了 `UserService … 重置密码`
2. `/ai` 共 12 个接口全部围绕出题任务/题目/试卷，**无 `GET|PUT /ai/config`**——FR-AIQ-01（P0）验收②「`api_key` 存储加密、界面不回显明文」与 07 §4.2.2「super_admin 界面录入 → AES-256-GCM 加密后存 Redis `ai:config`」的唯一写入路径不存在
3. **无连通性测试端点**——FR-AIQ-01 验收①「保存后可发起连通性测试并返回成功/失败」无接口承载
4. **无人工录入题目端点**（`POST /ai/questions`）——FR-AIQ-06（P1）验收①「录入题目落库 `source = manual`」与 06 关键规则 4「人工录入免审核直接入卷」无法实现

此外 FR-AIQ-01 验收③「未配置时发起出题被拦截并提示」在 04 第 6 章错误码表中**没有对应错误码**（40xxx 段无「AI 服务未配置」条目）。按 04 开发将直接漏做 4 个 P0/P1 功能。

**Fix**：补齐端点并同步第 2 章「合计 63 个接口」计数（→ 67）：

```
| 8 | PUT  | /users/{id}/password      | 管理 | 重置密码（写 password_hash、last_login_at = NULL、auth:block:{user_id}） |
| 13| GET  | /ai/config                | 管理 | 读取 AI 配置（api_key 掩码回显 sk-****xxxx） |
| 14| PUT  | /ai/config                | 管理 | 保存 AI 配置（base_url / api_key / model，AES-256-GCM 加密落 ai:config） |
| 15| POST | /ai/config/test           | 管理 | 连通性测试（返回成功/失败与错误摘要，脱敏） |
| 16| POST | /ai/questions             | 制度管理 | 人工录入题目（source = manual，免审核直接 approved） |
```

并在第 6 章错误码表补 `40xxx AI 服务未配置或配置不完整`（映射 HTTP 412 或 409）与 `50xxx AI 连通性测试失败`。

---

## C-10. AI 配置（含 `api_key`）的权威副本载体三册冲突：07 册定稿「Redis 持久键 `ai:config`」vs 05 册「应用数据目录加密配置文件」，且违反 AD-04 与 07 §6.2.2 自述，存在配置永久丢失风险

**来源视角**：correctness（架构决策冲突 + 数据持久性风险）

**位置**：
- [07-安全与非功能设计.md §4.2.2（L368）、§6.2.2（L530）、§4.2.3（L378）](/Users/pangongxia/agent_workspace/RuleExam/docs/design/07-安全与非功能设计.md)
- [05-模块设计.md §4.4.1 AI 配置管理](/Users/pangongxia/agent_workspace/RuleExam/docs/design/05-模块设计.md)

**Problem**：

1. **载体冲突**：05 §4.4.1 定稿为「应用数据目录下的加密配置文件（AES-256-GCM，密钥来自 `APP_ENCRYPTION_KEY`）」，07 §4.2.2 定稿为「加密后存 **Redis 持久键 `ai:config`**（Redis 开启 AOF 持久化）」，两者互斥，实现者无从选择
2. **违反自身架构决策**：AD-04 与 07 §6.2.2 都断言「Redis 中只存**可再生临时态**……任何情况下已落库的学习与考试数据不受影响」，而 `ai:config` 是**唯一权威副本、不可再生**（`api_key` 由外部服务商签发，丢失即无法恢复），把它放进 Redis 直接推翻 AD-04 的前提
3. **备份覆盖缺口**：07 §4.2.3 备份表中 Redis 仅「AOF 持久化文件随卷快照，保留 7 天」，MySQL 全量备份不覆盖 Redis 键；一旦 Redis 卷损坏/容器重建且 AOF 缺失（或故障发现晚于 7 天），`api_key` **永久丢失** → AI 出题全线不可用，RPO ≤ 24 小时的承诺对该对象不成立，季度恢复演练（§4.2.3）也无法验证其可恢复性
4. 叠加 §6.2.2 的 `maxmemory-policy noeviction` + 512MB 上限，一个永不过期的持久键还与「全部业务键均带 TTL 自然过期」的断言冲突

**Fix**：统一为**文件载体**（与 05 一致，天然随 `upload_files`/配置卷参与 §4.2.3 的每日 rsync 备份与 30 天保留）：Redis 仅作为解密后配置的读缓存（`ai:config:cache`，TTL 10 分钟，可再生）；修订 07 §4.2.2 的载体表述、在 §4.2.3 备份表新增「AI 加密配置文件」一行，并在 §6.2.2 把断言改为「除文件载体的配置缓存外，Redis 只存可再生临时态」。若坚持 Redis 为权威源，则必须开启独立的 `ai:config` 导出/导入运维流程并纳入恢复演练清单。

---

## Critical 汇总表

| # | 标题 | 主责文档 | 类型 |
|---|---|---|---|
| C-01 | file_path 生成规则 8 位 vs 16 位矛盾 | 05、07 | 跨文档硬冲突 |
| C-02 | auth:block 键 EXISTS 判定误伤改密后新令牌 | 07、04 | 安全逻辑不闭环 |
| C-03 | 首次登录强制改密可绕过（last_login_at 时序） | 04、07 | 安全逻辑不闭环 |
| C-04 | exam_record 缺 deadline_at 快照 | 03、05、02 | 数据模型缺陷 |
| C-05 | 乱序 seed 与 JWT_SECRET 轮换冲突 | 07、05 | 安全与业务耦合缺陷 |
| C-06 | 考试进行中题目可编辑 → 判分依据漂移 | 05、06 | 业务规则漏洞 |
| C-07 | 失焦暂停两套互斥实现 | 07 vs 04/05/06 | 跨文档硬冲突 |
| C-08 | 05 心跳步骤 6 无条件 state=active | 05 | 业务规则自相矛盾 |
| C-09 | 04 缺 4 个 P0/P1 端点与错误码 | 04 | 契约缺失 |
| C-10 | AI 配置载体 Redis vs 文件冲突 | 05、07 | 架构决策冲突 |
