# Code Review 报告 — RuleExam 全量新增代码

- **日期**: 2026-09-12
- **审查对象**: 工作区全部未提交新增文件（101 个，约 1.1 万行）：`server/`（NestJS 后端）、`web/`（Vue 3 前端）、`database/`（MySQL 初始化）、`deploy/`（nginx / .env.example）、`docker-compose.yml`、`tests/`（e2e 冒烟）、`README.md`，以及 `.gitignore` 修改。
- **说明**: 本仓库未配置 git remote、不存在 GitHub PR，故按命令流程将结果落盘至本目录（而非 PR 评论）；无 CLAUDE.md、无 git 历史、无历史 PR 可参照，因此 CLAUDE.md 合规与历史上下文两个维度为空。
- **方法**: 两个并行审查子代理（后端+数据库、前端+部署+测试）独立扫描 → 主代理逐条复核源码确认 → 按置信度 0–100 打分 → 过滤 < 80 分的条目（3 条降入附录）。

---

## 结论概览

共确认 **13 个问题**（置信度 ≥ 80）：**3 个致命、5 个高、5 个中**。最严重的是前端单选题答案被整体丢弃（考试实际无法及格）与 compose 部署缺少数据库用户（后端无法连接数据库）。

---

## 致命（P0）

### 1. 单选题答案被静默丢弃，考试实际无法及格（置信度 95）
`web/src/views/employee/ExamRoom.vue:14` 中 `el-radio-group v-model="answers[q.question_id]"` 的 model 被 Element Plus 赋为**标量**（选中项的 `:value`，即 number），而 `answers` 声明为 `Record<string, number[]>`（`ExamRoom.vue:59`）。选中后 `collectAnswers()` 的过滤条件 `(answers[q.question_id]?.length || 0) > 0`（`ExamRoom.vue:83`）对 number 恒为 0，**单选题答案不会进入 heartbeat 暂存与 submit 提交**；`gradeAndPersist` 将缺失作答判 0 分。断线恢复时 `answers[qid] = sel as number[]`（`ExamRoom.vue:128`）恢复成数组，同样无法与 radio 的标量 model 匹配，恢复的单选题显示为未作答；`onSubmit` 的未答统计（`ExamRoom.vue:194`）对已答单选题也恒报未答。按参考卷型（10 单选 × 6 + 5 多选 × 8），实际可达满分仅 40/100，**无人能通过考试**。

### 2. compose 部署缺少数据库用户，API 无法连接 MySQL（置信度 95）
`docker-compose.yml:68-73` 的 mysql 服务仅设置 `MYSQL_ROOT_PASSWORD` 与 `MYSQL_DATABASE`，未设置 `MYSQL_USER/MYSQL_PASSWORD`；`database/init.sql` 中亦无任何 `CREATE USER/GRANT`。而 api 服务以 `DB_USERNAME: ${DB_USERNAME}` 连接（`docker-compose.yml:43`），`deploy/.env.example:12` 默认 `DB_USERNAME=ruleexam`。按 README 快速开始执行 `cp deploy/.env.example .env && docker compose up -d` 后，api 的 TypeORM 连接将 ER_ACCESS_DENIED，`/api/v1/health` 报 `mysql: down`，所有依赖数据库的接口 500，包括种子管理员登录。

### 3. refresh token 可当作全权 access 凭证使用；登出不吊销、首登强制改密可绕过（置信度 95）
`server/src/common/guards/jwt-auth.guard.ts:68` 与 `:79`：jti 黑名单校验与 `pwd_pending` 受限路径检查均仅在 `payload.type === 'access'` 分支内，**守卫从不拒绝 `type: 'refresh'`**，而 refresh 与 access 用同一密钥签发（`auth.service.ts:67-78`）。因此把 refresh token（7 天有效期，携带 sub/role）放进 `Authorization: Bearer` 即可通过全部路由与角色守卫。后果：
- `logout()`（`auth.service.ts:231-242`）仅将所呈报 access token 的 jti 拉黑并清 Cookie（客户端侧），登出后已持有的 refresh token 仍可在 7 天内作为全权凭证调用任意接口；
- refresh 轮换不吊销旧 refresh（`auth.service.ts:184` 注释"旧 refresh 到期自然失效"），放大上述窗口；
- 首登强制改密被绕过：refresh token 不带 `pwd_pending`（`auth.service.ts:146`），首登用户直接拿登录响应中的 refresh token 即可调用全部业务接口。

---

## 高（P1）

### 4. 成绩分布统计分桶错误：90 分以下全部落入 `[80,90)`（置信度 95）
`server/src/modules/statistics/statistics.service.ts:120`：`['[0,60)','[60,70)','[70,80)','[80,90)'][Math.max(0, Math.min(Math.floor(s / 10), 3))]`——索引在 4 元素数组上被钳制到 3。`[0,80)` 区间 `floor(s/10)` 为 0–7，全部钳为 3 → `[80,90)`；仅 `[80,90)` 碰巧正确。与同文件被单测覆盖的 `GradingService.distributionBucket`（`grading.service.ts:84-89`，`server/test/core-algorithms.spec.ts:89-95`）的正确算法相矛盾。结果：`regulationOverview` 接口与 Excel 导出（`statistics.controller.ts:95-97`）中低分段永远是 0。

### 5. `download()` 将 AxiosResponse 当 Blob 传入 `createObjectURL`，所有 Excel 导出抛异常（置信度 95）
`web/src/api/http.ts:47` 对 blob 响应返回的是完整 `AxiosResponse`，而 `download()`（`web/src/api/http.ts:83-91`）执行 `const blob = res as any as Blob; URL.createObjectURL(blob)`，传入的是响应对象而非 `res.data`，运行时抛 `TypeError: Failed to execute 'createObjectURL'`。受影响功能：统计页 3 个导出按钮（`Statistics.vue:146-148`）、用户导入模板下载（`Users.vue:187-189`）。

### 6. 编辑任何有部门的用户必然 40001 失败（置信度 90）
`GET /users` 返回 `department_id` 为 **number**（`users.service.ts:33`），`openEdit` 将整行原样拷入表单后 `PUT /users/:id` 原样回传（`Users.vue:150-165`）；而 `UpdateUserDto.department_id` 声明为 `@IsOptional() @IsString()`（`users.controller.ts:29`），校验管道 `plainToInstance` 未开启隐式类型转换（`dto-validation.pipe.ts:15`），number 必然未通过 `@IsString()` → HTTP 400 / 40001「参数错误」。新增用户不受影响（tree-select 取值为字符串），编辑存量用户永远无法保存。

### 7. `regenerate()` 缺少在考校验，可改写正被进行中考试引用的题目（置信度 85）
模块自身不变量（`question-review.service.ts:78` 注释）："题目被 in_progress 考试引用时禁改 stem/options/answer/type（仅允许 analysis，40908）"，由 `edit()` 经 `assertNotInLiveExam` 执行（`question-review.service.ts:110-114`）。但 `regenerate()`（`question-review.service.ts:178-230`）整体替换 `type/stem/options/answer` 并将状态回 pending，**未调用 `assertNotInLiveExam`，也未校验题目状态**（approved 且已进卷的题目同样可被重生成）。判分在提交时实时读取 `question.answer`，因此在考人员看到的原题会按新答案/新选项语义被判分。

### 8. 出题任务异常逃逸后锁死 24 小时（置信度 85）
`question-generation.service.ts:92-98` 以 `ai:task:active:{regulationId}`（TTL 24h，`question-generation.service.ts:23`）做互斥；`start()` 先写任务状态再以 `void this.runTask(...).catch(...)` 后台执行（`:104-119`）。`runTask` 内部**没有全局 try/catch/finally**，只有"全部块失败"与"成功"两条受控路径会置 failed/completed 并删除 active 键。任何意外异常（如 `existingStems` 查询、落库事务、Redis 故障）被外层 `.catch` 仅记日志吞掉 → 任务停在 `running`、active 键留存 → 该制度后续所有出题请求 429「该制度已有出题任务在执行中」直至 24h TTL 过期，且无取消/恢复端点。违反文档化任务状态机（"AI 调用失败重试后仍失败 → failed，可重新发起"）。

---

## 中（P2）

### 9. 学习时长并发心跳重复计入，N 倍虚增（置信度 85）
`learning-session.service.ts:226-253`（heartbeat）与 `:273-294`（pause）是非原子读-改-写：`readSessionState`（Redis hgetall）→ 计算 `creditedMs = Math.min(diff, 45s)` → `duration_ms += creditedMs` → `writeSessionState`（后写覆盖），无锁/CAS。10 秒节流（`:241`）在读取之后才触发，N 个并发心跳读到同一 `last_beat_at` 全部通过，各自计入整个窗口。例如 30 秒间隔后并发打 10 个心跳 → 实际 30 秒被计入 300 秒。`pause` 的注释声称"重复 pause 幂等：仅首次结算"（`:288`），并发下同样不成立。这击穿本模块存在的核心不变量（"单次最大计入 45 秒"、"时长不可虚增"，设计 05 册 §5.4.2），且直接决定考试准入。

### 10. 时区割裂：应用写入 UTC、数据库默认列写 +08:00 墙钟（置信度 80）
`configuration.ts:54` 配置 mysql2 `timezone: 'Z'`（业务时间戳统一以 UTC 序列化），而 `docker-compose.yml:78` 设 `--default-time-zone=+08:00`。TypeORM 的 `@CreateDateColumn/@UpdateDateColumn`（`exam-record.entity.ts:41,44` 等全部实体）不提供值，依赖 DDL 默认值 `CURRENT_TIMESTAMP(3)`，由 MySQL 会话时区填充 → **`created_at/updated_at` 存的是 +08:00 墙钟，其余时间列（started_at/deadline_at/submitted_at/last_login_at 等）是 UTC**。后果：所有列表接口回显的 `created_at/updated_at` 被当作 UTC 渲染后快 8 小时；`parse-pipeline.service.ts:41-48` `scanStalled` 以 UTC 序列化的 JS Date 参数与 +08:00 墙钟的 `created_at` 比较，pending 行"显年轻"8 小时，事件丢失时兜底解析扫描晚约 8 小时才触发。

### 11. AI 配置页承诺"留空保持不变"，但 API 必填 api_key（置信度 85）
`ai.controller.ts:16-20` `SaveAiConfigDto.api_key: @IsString() @MinLength(1)`，非可选；`AiConfig.vue:13` 占位符承诺"留空保持不变"，且 `onSave` 成功后将 `form.api_key` 置空（`AiConfig.vue:47`）。首次保存后任何一次只改 base_url/model 的保存（key 留空，恰是页面指引）都会 40001「参数错误」。前端承诺的"保留已有 key"路径在前后端均不存在。

### 12. 考试页 30 秒心跳 interval 永不清理（置信度 80）
`ExamRoom.vue:182` `window.setInterval(beat, 30_000)` 的句柄未保存；`stopTimers()`（`:167-172`，交卷成功与组件卸载时调用）只清理 1 秒倒计时 `timer`。交卷离开后 `beat()` 仍每 30 秒对已结束记录 POST（返回 40905 被吞），SPA 存活期内持续；每进入一次考试页再叠加一个泄漏的 interval。其他错误分支的 Promise 拒绝亦未处理。

### 13. 部门路径解析失败被进程级负缓存，纠正后重导入仍失败（置信度 80）
`user-import.service.ts:70-96`：`resolveDeptPath` Map 以实例字段缓存 `{null}` 失败结果，无 TTL、无失效（部门创建/更新不清理）。场景：导入"集团总部/生产中心"报"部门不存在" → 管理员创建该部门后重新导入同一文件 → 命中缓存继续报"部门不存在"，直到 API 进程重启。

---

## 附录：低于 80 分阈值、未列入正式问题清单的观察（供参考，不阻塞）

- **AI 网关 SSRF 面（约 70）**: `ai-gateway.service.ts:32-33` 为唯一服务端 URL 拉取点，`ai-config.service.ts:65` 仅校验 `^https?://` scheme，未按"拒绝 localhost/环回/私有/保留地址"约束校验 host。缓解事实：端点仅 super_admin 可达（`ai.controller.ts:102-108`），且代码注释明确将 base_url 定位为"受信内网端点"，可利用性要求恶意/被攻陷的超管。若按本仓库安全约束从严，建议补 host 校验。
- **自动交卷最迟晚约 30 秒（约 70）**: `ExamRoom.vue:161-165` 注释称"超过截止 5 秒自动交卷"，但条件 `Date.now() - lastBeatAt > 30_000` 使触发点取决于最后一次成功心跳，最迟可在截止后约 30 秒才交卷（服务端超时任务兜底存在，实际影响为页面 00:00 后迟迟不交卷，与注释承诺不符）。
- **`AI_*` / `MAX_UPLOAD_SIZE` 环境变量未注入 api 容器（约 70）**: `deploy/.env.example:27-38` 将其定位为"环境变量为初始兜底"，`configuration.ts` 读取同名变量，但 `docker-compose.yml` api 服务 environment 块（`:37-57`）未列出 → compose 部署下设置这些变量静默无效，兜底路径不可用（界面配置路径不受影响）。

---

## 复核确认无问题的方面（抽样）

- 判分数学（单选/多选/部分得分、`total >= pass_score` 边界、两位舍入）、洗牌确定性与展示→原始下标还原互洽、三层幂等提交（Redis 锁 + 条件 UPDATE + 记录唯一约束）、实体与 `database/init.sql` 列/类型/枚举一致、分页 clamp、登录防爆破键与 TTL。
- 前端路由守卫（admin/superOnly）正确；401→静默刷新→重放一次逻辑与后端契约（含 40102/40107、42901、40905/40906/40908）互洽；其余 API 路径/方法/字段名核对一致。
- nginx `proxy_pass http://api:3000`（无尾随 URI）与 `app.setGlobalPrefix('api/v1')` 匹配；compose `depends_on: service_healthy` 与 Dockerfile HEALTHCHECK 可解；e2e 测试所有断言经 `check()` 且非零退出码可传播，无恒真断言。

## 修复优先级建议

1. **先修 P0-1（ExamRoom 单选标量）**——决定系统核心流程可用性；
2. **P0-2（compose DB 用户）**与 **P0-3（refresh token 当凭证）**——一个阻断部署，一个是认证体系级漏洞；
3. P1 按 4→6→5→7→8 顺序（统计正确性与高频可用性路径优先）；
4. P2 可随后集中修。
