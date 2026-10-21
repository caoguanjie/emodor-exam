# Code Review 报告 — RuleExam 最近三次推送

- **日期**：2026-09-13
- **审查对象**：`HEAD~3..HEAD`（最近三次提交）
  - `ea54c7e` feat: 制度学习及考试系统全量实现（后端/前端/部署/测试）
  - `5134998` fix: GUI 全流程测试 15 项问题修复（SSRF 白名单/id 类型/PDF 解析/会话收口/范围回显等）
  - `d361c7f` docs: 新增 AGENTS.md 工作区指引并忽略 Vite 缓存目录
- **方法**：三视角并行独立评审（completeness / correctness / impact）→ 主代理逐条复核 diff 与源码 → 合并去重，同问题跨视角命中时保留证据最丰富的版本并注明来源。
- **依据**：`docs/design/`（8 册实现基准）、`AGENTS.md` 架构红线、`review/code-review-2026-09-12.md` 与 `review/fix-log-2026-09-12.md`（已修复问题不重复计入）、`review/gui-test-report-2026-09-13.md`。

---

## 结论概览

共确认 **17 项发现**：**2 项 Critical**、**8 项 Warning**、**7 项 Suggestion**。

- `ea54c7e` 全量实现自身声明的 13 项评审问题 + 3 项附录观察在本次抽查中**均在位**，vitest 17/17、`tsc` 0 错误、e2e `check()` 计 86 处、`init.sql` 12 表——**声明兑现**。
- `5134998` 15 项 GUI 修复中 F1/F2/F3/F5/F6/F7/F8/F9/F10/F12/F13/F14/F15 **均已落地**（含用 `unpdf@1.8.1` 对合成 PDF 与真实 PDF 实跑解析成功），**F4「跳转前等待收口」与 F11「三层统一 ≥8 位」为半兑现**（见 Warning #3、#4），并新引入 **Node 22 隐式依赖**、**end 合并锁外竞态**、**新标签页续登丢失 pwd_pending**、**compose 未透传 AI_EGRESS_ALLOW_HOSTS** 四项副作用（Critical #2、Critical #1、Warning #7、Warning #8）。
- `d361c7f` AGENTS.md 与 `.gitignore` 变更自身安全（未误伤已跟踪文件），但**目录地图未收录紧邻上一提交刚沉淀、并声明「供 GUI 回归复用」的 `tests/gui-test-env/`**（Suggestion #12），使复用资产在唯一工作区指引中不可发现。

**建议修复顺序**：Critical #1 → Critical #2 → Warning #3/#4/#7 → Warning #5/#6 → Warning #8/#9/#10 → Suggestions。

---

## Critical Issues（必须修复）

### 1. 学习会话 `end()` 的段位/滚动预合并在互斥锁外执行，与并发心跳存在数据丢失竞态

**位置**：[learning-session.service.ts#L375-L395](../server/src/modules/learning/learning-session.service.ts)

**Problem**：`end()` 在 L379-L384 依次执行 `readSessionState → mergeScroll → writeSessionState` 三步，全部在 `withSessionMutex` **之外**。而 `doHeartbeat` 会持有同一把互斥锁并在锁内写回 `duration_ms += creditedMs`。当 end 与心跳并发时：

```
t0  end()       readSessionState() → S(duration=1000)
t1  heartbeat() 获锁，写 S'(duration=31000)，释锁
t2  end()       mergeScroll(S,…)   ← 本地 S 仍是 1000
t3  end()       writeSessionState(S) → 31000 被覆盖回 1000（数据丢失）
t4  flushSession(state=S) → DB 也只得 1 秒
```

这是本次 commit 新增 `dwellSegments/scrollPercent` 参数引入的新路径，破坏了 AGENTS.md 架构红线「学习时长全部服务端结算」。

**Fix**：把合并下沉到 `doFlushSession`，由 `end()` 透传参数，合并动作在锁内紧跟 `readSessionState`：

```typescript
async end(sessionId: string, userId: number, dwellSegments: number[] = [], scrollPercent?: number) {
  const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
  if (!session) throw Errors.notFound('学习会话不存在');
  if (Number(session.userId) !== userId) throw Errors.dataForbidden();
  const closeTime = new Date();
  const result = await this.flushSession(sessionId, closeTime, null, dwellSegments, scrollPercent);
  const regulation = await this.regRepo.findOne({ where: { id: session.regulationId } });
  const progress = regulation ? await this.progressView(regulation, userId, true) : null;
  return { session_id: Number(sessionId), duration_seconds: result.durationSeconds, progress };
}

private async doFlushSession(sessionId, closeTime, state?, dwellSegments: number[] = [], scrollPercent?: number) {
  // ... 取锁 ...
  if (!state) state = await this.readSessionState(sessionId);
  if (state && (dwellSegments.length || typeof scrollPercent === 'number')) {
    this.mergeScroll(state, dwellSegments, scrollPercent, totalSegments);
    await this.writeSessionState(sessionId, state);
  }
  // ... 原事务 ...
}
```

---

### 2. `unpdf` 要求 Node ≥22，但生产镜像 `server/Dockerfile` 钉死 node:20-alpine

**位置**：[Dockerfile#L1-L11](../server/Dockerfile) · 相关：[parse-pipeline.service.ts#L80-L92](../server/src/modules/regulations/parse-pipeline.service.ts)

**Problem**：`5134998` 将 `pdf-parse` 替换为 `unpdf@1.8.1`，但 `node_modules/unpdf/package.json` 声明 `"engines": {"node": ">=22"}`。服务端镜像的构建与运行阶段都是 `FROM node:20-alpine`：

- `npm install` 只会打印 `EBADENGINE` 警告不阻断构建；
- 生产容器运行期加载内置的 pdfjs-dist 6.x 存在解析崩溃风险——而 PDF 解析是「制度上传」核心链路。

开发本机 Node v22.22.3、e2e/GUI 复测均在 Node 22 通过，容器化生产路径**未在依赖声明下限之上有过任何验证**。这是本次依赖替换新引入的、未记录的隐式运行时依赖，对下游部署可见。

**Fix**：将服务端镜像基线提升到 Node 22，并在 `server/package.json` 与 AGENTS.md 显式声明 Node 版本口径：

```dockerfile
# server/Dockerfile
FROM node:22-alpine AS build
...
FROM node:22-alpine
```

```json
// server/package.json
"engines": { "node": ">=22" }
```

---

## Warnings（应修复）

### 3. F4「跳转前等待收口」只覆盖两个页内按钮，侧边栏 / 浏览器返回 / 登出仍是 fire-and-forget

**位置**：[Reading.vue#L296-L304](../web/src/views/employee/Reading.vue) · 相关：[MainLayout.vue#L16-L17,L25,L50](../web/src/layouts/MainLayout.vue)

**Problem**（completeness F4 + correctness Suggestion 合并）：commit 声明「消除限流竞态悬挂与离页计时」，但 diff 只把 `leaveReading()` 与 `goExam()` 改为 await。侧边栏常驻「我的制度/我的考试」、退出登录、浏览器返回等主路径依旧只走 `onBeforeUnmount` 中**未 await** 的 `endSession()`。SPA 内跳转不触发 `pagehide/visibilitychange`，`pauseSettle()` 不会执行，Redis 会话保持 `active`，只能等 `sweepStalledSessions()`（[learning-session.service.ts#L512-L535](../server/src/modules/learning/learning-session.service.ts)）在 `last_beat_at + 90s` 后离线收口并按 **+45 秒封顶**计入时长——「离页计时」原样存在，声明的反作弊口径被破坏。

**Fix**：用路由级守卫替代按钮级 await，一次覆盖全部离开路径：

```ts
import { onBeforeRouteLeave } from 'vue-router';
onBeforeRouteLeave(async () => { await endSession(); });
```

`onBeforeUnmount` 中的 `endSession()` 保留为兜底即可（`sessionId` 已置空会自动短路）。

---

### 4. 导入模板示例行仍提示「初始密码至少6位」，与本次三层统一的 ≥8 位+字母数字口径矛盾

**位置**：[user-import.service.ts#L46](../server/src/modules/users/user-import.service.ts)

**Problem**（completeness F11 + impact #5 合并）：本次将 create/reset/Excel 导入三层统一为「≥8 位 + 字母 + 数字」，DTO / service / 预检 / 前端文案均已跟进，但 `buildTemplate()` 生成的 xlsx 示例行仍是：

```ts
ws.addRow(['zhangsan', '张三', 'E2026001', '集团总部/生产中心', 'employee', '初始密码至少6位']);
```

问题双重：
- 文案宣传旧口径，正是 F11 要消除的「口径混乱」在导入层的残留；
- 该示例值恰好 8 字符但**不含任何 `[A-Za-z]`**，按 L145 的新预检 `!/[A-Za-z]/.test(r.password)` 必然命中「初始密码须 ≥8 位且同时包含字母与数字」→ 管理员照官方模板原样导入即整行失败。

**Fix**：

```ts
ws.addRow(['zhangsan', '张三', 'E2026001', '集团总部/生产中心', 'employee', 'Zhang@2026']);
// 可选：在表头下方追加一行说明「初始密码须 ≥8 位且同时包含字母与数字，首次登录强制修改」
```

---

### 5. `create()` / `resetPassword()` 未调用 `validatePasswordStrength`，弱口令与个人信息子串可绕过

**位置**：[users.service.ts#L80-L82](../server/src/modules/users/users.service.ts) · [users.service.ts#L166-L168](../server/src/modules/users/users.service.ts)

**Problem**：两处只做 `length ≥ 8 + 含字母 + 含数字` 三项检查，未复用 `AuthService.validatePasswordStrength`：

- `WEAK_PASSWORDS` 黑名单口令（`admin123`、`passw0rd`）可直接作为初始/重置密码；
- 包含用户名/工号/姓名连续 3 位字符的口令（如 `zhangsan` 用户的 `zhangsan1`）也能通过。

Controller 注释声称「初始/重置口令与首次改密策略对齐」，实际对齐不完整，形成口径裂缝。

**Fix**：将 `validatePasswordStrength` 提取为共享工具或注入 `AuthService`，在两处调用：

```typescript
this.validatePasswordStrength(input.password, {
  username: input.username,
  employeeNo: input.employee_no,
  realName: input.real_name,
});
```

---

### 6. `CreateQuestionDto.options` 与 `SetPaperQuestionsDto.items` 缺少嵌套校验，恶意载荷可穿透 DTO 层

**位置**：[ai.controller.ts#L41](../server/src/modules/ai/ai.controller.ts) · [ai.controller.ts#L78](../server/src/modules/ai/ai.controller.ts)

**Problem**：`class-validator` 的 `@IsArray()` 只校验外层类型，不会递归校验元素。`OptionDto.text` 上的 `@IsString()` 在缺失 `@ValidateNested() + @Type(() => OptionDto)` 时完全不生效。攻击者可提交：

```json
{ "options": [{ "text": 12345 }, null, {}], "answer": [0] }
{ "items": [{ "question_id": null, "score": "abc" }] }
```

绕过 DTO 校验后 `String(null)="null"` 作为题目 ID 查库，`Number("abc")=NaN` 写入 `paper_question.score`，造成脏数据或运行时异常。

**Fix**：

```typescript
import { ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CreateQuestionDto {
  @IsArray() @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => OptionDto)
  options!: OptionDto[];
  // ...
}

class SetPaperQuestionsDto {
  @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaperQuestionItemDto)
  items!: PaperQuestionItemDto[];
}
```

---

### 7. 新标签页静默续登丢失 `force_change_password` 状态，强制改密用户被弹回登录页

**位置**：[auth.ts#L52-L63](../web/src/stores/auth.ts) · [http.ts#L17-L24](../web/src/api/http.ts) · [router/index.ts#L45-L48](../web/src/router/index.ts)

**Problem**：`5134998` 在路由守卫新增未登录时 `await auth.restore()`，但 `tryRefresh` 只取 `d.access_token`，**丢弃了后端 `/auth/refresh` 返回的 `force_change_password`**（[auth.service.ts#L193](../server/src/modules/auth/auth.service.ts)）。对处于首登强制改密态的用户（`last_login_at IS NULL`），refresh 签发的是带 `pwd_pending` 的受限令牌，`fetchProfile()` 会被 [jwt-auth.guard.ts#L80-L85](../server/src/common/guards/jwt-auth.guard.ts) 第 ⑤ 步拒绝 → `restore()` 返回 false → 守卫重定向到 `/login` 并弹「首次登录请先修改密码」错误 toast。**强制改密用户在新标签页无法进入 `/change-password`，反而被打回登录页**，这是新续登路径引入的 UX 契约回归（后端仍安全兜底，非越权）。

**Fix**：`tryRefresh` 保留并落地 `force_change_password`，据此设置 `needChangePassword` 并放行到改密页：

```ts
// http.ts tryRefresh
if (d?.access_token) {
  const s = useAuthStoreRaw();
  s.setAccessToken(d.access_token);
  s.setPwdPending(!!d.force_change_password); // 写 sessionStorage re_pwd_pending
  return true;
}
// auth.ts restore：profile 失败但令牌为受限态时，也应视为已恢复，交由守卫跳 /change-password
```

---

### 8. `docker-compose.yml` 未透传 `AI_EGRESS_ALLOW_HOSTS`，编排部署下文档契约失效

**位置**：[docker-compose.yml#L56-L62](../docker-compose.yml)

**Problem**：本次新增的 `AI_EGRESS_ALLOW_HOSTS` 在 `deploy/.env.example`、`AGENTS.md`、`tests/run-e2e.mjs`、`configuration.ts` 四处已一致引用，但 `docker-compose.yml` 的 `api.environment` 只透传了 `AI_BASE_URL/AI_API_KEY/AI_MODEL`。用户按 `.env.example` 设置该变量后，compose 部署的 API 容器读不到（`egressAllowHosts` 恒为 `[]`），本地/内网 Mock AI 通路在容器化场景**静默失效**——文档契约与实际编排不一致。默认值语义本身是安全的（未设→空数组→拒绝所有内网），问题仅在于该变量在 compose 下根本无法被设置生效。

**Fix**：

```yaml
AI_MODEL: ${AI_MODEL:-}
AI_EGRESS_ALLOW_HOSTS: ${AI_EGRESS_ALLOW_HOSTS:-}   # 默认空=拒绝内网；仅本地开发注入
```

---

### 9. `README.md` 技术栈仍标注 `pdf-parse`，与已切换到 `unpdf` 的实现漂移

**位置**：[README.md#L14](../README.md)

**Problem**：`package.json`/`package-lock.json` 已一致移除 `pdf-parse` 引入 `unpdf`，但 README 技术栈表第 14 行仍写「`pdf-parse（PDF→text）`」。这是本次依赖变更遗漏的下游可见文档漂移，会误导后续维护者按旧依赖排查解析问题。

**Fix**：

```markdown
| 文件解析 | unpdf（PDF→text，内置现代 pdf.js）+ mammoth（DOCX→HTML+text，双产物一次成型） | ... |
```

---

### 10. 考试心跳限流注释与实现不符（注释写 30 秒，代码为 5 秒）

**位置**：[exam.service.ts#L328-L331](../server/src/modules/exams/exam.service.ts)

**Problem**：

```ts
// 30 秒节拍窗口限流（04 册 6.2）：异常高频丢弃
const lastBeat = await this.redis.get(`exam:beat:${recordId}`);
if (lastBeat && now - Number(lastBeat) < 5_000) {   // ← 实际是 5 秒
```

若设计规格确为 30 秒，则实现比规格宽松 6 倍；若 5 秒是有意为之，注释误导后续维护者。

**Fix**：确认「04 册 6.2」后二选一——阈值改为 `30_000`，或将注释修正为「5 秒去抖窗口（防事件风暴，非节拍限流）」。

---

## Suggestions（可考虑）

### 11. e2e 断言对 F4 / F5 / F8 / F11 零覆盖，修复无自动化回归保护

**位置**：[e2e-smoke.mjs#L551-L553](../tests/e2e-smoke.mjs)

**Problem**：commit 以「vitest 17/17、e2e 86/86」作为 15 项修复的复测证据，两个数字都可核实（已实测 17 通过、`check(` 计 86 处），但 e2e **未新增任何针对本次修复的断言**：

- L551 的 `/end` 仍不带 body，F4 的 `dwell_segments` 搭载合并路径无覆盖；
- L426-427 只断言 `PUT /scope` 的 `status === 200`，未断言详情出参的 `scope.is_all / department_ids`（F5 snake_case 契约）；
- 全文件无 `has_published_paper` 断言（F8）；
- 无初始密码 <8 位或纯数字的负例断言（F11）。

这四项目前仅靠人工浏览器复测（其证据未入库，见 Suggestion #13）。

**Fix**：在第 3、5、7 段各补 3~4 个 `check()`：

- `/end` 携带 `dwell_segments:[9]` 后断言 `covered_count` 递增；
- `GET /regulations/:id` 断言 `data.scope.is_all === false && Array.isArray(data.scope.department_ids)`；
- 发布试卷前后断言 `/learning/regulations` 的 `has_published_paper` false→true；
- `POST /users` 用 `'abc123'` 断言 `code === 40001`。

---

### 12. AGENTS.md 目录地图 / 常用命令未收录上一提交刚沉淀的 `tests/gui-test-env/`

**位置**：[AGENTS.md#L13](../AGENTS.md)

**Problem**：`5134998` 的 commit message 明确写「沉淀 Mock AI 与制度预置脚本**供 GUI 回归复用**」，但紧邻的 `d361c7f` 中 AGENTS.md L13 `tests/` 条目只列 `run-e2e.mjs` 与 `e2e-smoke.mjs`，未提及 `tests/gui-test-env/mock-ai.mjs` 与 `seed-regulation.mjs`；L16-24「常用命令」也没有启动 Mock AI / 预置制度的命令。GUI 复测的关键前置「API 需带 `AI_EGRESS_ALLOW_HOSTS=127.0.0.1` 启动方可使用本地 Mock AI」只写在 `review/gui-test-report-2026-09-13.md#L117`，未进入 AGENTS.md 命令区（红线段 L36 只提到变量本身）。复用资产在唯一的工作区指引中不可发现。

**Fix**：L13 追加 `` `tests/gui-test-env/` GUI 回归环境（mock-ai.mjs / seed-regulation.mjs） ``，并在常用命令块补：

```bash
node tests/gui-test-env/mock-ai.mjs                                  # Mock AI :9101
AI_EGRESS_ALLOW_HOSTS=127.0.0.1 <其余密钥> node server/dist/main.js  # 本地联调 AI 必需
ADMIN_PASSWORD=<admin 口令> node tests/gui-test-env/seed-regulation.mjs
```

---

### 13. 报告把 `gui-test-screenshots/` 列为复测证据，同一提交却将该目录 gitignore，仓库内证据链断裂

**位置**：[.gitignore#L23-L24](../.gitignore) · [gui-test-report-2026-09-13.md#L9,L104-L111](./gui-test-report-2026-09-13.md)

**Problem**：`5134998` 新增的 `review/gui-test-report-2026-09-13.md#L9` 声明「截图证据：`gui-test-screenshots/`（t*=首轮测试，r*=修复后复测）」，L104-L111「复测证据（关键节点）」逐条指向 r 系列截图；而同一提交把 `gui-test-screenshots/` 写入 `.gitignore`。结果是：commit message 用「浏览器闭环复测通过」支撑 15 项修复，但仓库内既无截图也无替代可复现脚本入口，后续 reviewer 无法验证该声明。

**Fix**：二选一——

- ① 报告 L9 改为「截图为本地一次性证据，不入库；复现步骤见 AGENTS.md `tests/gui-test-env/` 命令」并补齐复现步骤；
- ② 或将 r 系列 3~5 张关键截图移入 `review/assets/` 并移除该 ignore 规则。

---

### 14. `listAvailablePapers` 存在 N+1 查询，制度/试卷数量增长后性能退化明显

**位置**：[exam.service.ts#L75-L110](../server/src/modules/exams/exam.service.ts)

**Problem**：对每条 `regulation` 调用 `scopeService.isUserInScope`（潜在 DB 查询），再对每张 `paper` 分别调用 `recordRepo.find` 和 `learningRepo.findOne`，总查询数为 O(regulations + papers × 2)。

**Fix**：批量预取——用 `In(regIds)` 一次查出所有 `learning_record`，用 `In(paperIds) + userId` 一次查出所有 `exam_record`，再在内存中 Map 关联，将查询数压到常数级。

---

### 15. `end()` 内 `regRepo.findOne` 对同一 `regulationId` 重复调用两次

**位置**：[learning-session.service.ts#L382,L388](../server/src/modules/learning/learning-session.service.ts)

**Problem**：L382 为 `mergeScroll` 查一次 `regulation`，L388 为 `progressView` 再查一次，同一事务路径内对同一 `regulationId` 发起两次相同 DB 查询。

**Fix**：将 L382 的结果保存到局部变量，L388 复用（若采纳 Critical #1 的重构，可自然合并）：

```typescript
const regulation = await this.regRepo.findOne({ where: { id: session.regulationId } });
if (state && (dwellSegments.length || typeof scrollPercent === 'number')) {
  this.mergeScroll(state, dwellSegments, scrollPercent, regulation?.scrollSegments ?? 10);
  await this.writeSessionState(sessionId, state);
}
const closeTime = new Date();
const result = await this.flushSession(sessionId, closeTime, state);
const progress = regulation ? await this.progressView(regulation, userId, true) : null;
```

---

### 16. 种子层口令校验仅查长度，未与本次统一的「字母+数字」策略对齐

**位置**：[server/src/seed.ts#L26](../server/src/seed.ts) · [database/seed.mjs#L24](../database/seed.mjs)

**Problem**：本次将创建/重置/改密口令统一为「≥8 位 + 字母 + 数字」，但两处 admin 种子仍只校验 `length < 8`。虽然登录仅做哈希比对、不会因此断裂（首登仍强制改密兜底），但策略口径出现「种子弱于业务层」的裂缝；`tests/run-e2e.mjs` 用 `randomBytes(18).toString('base64')` 生成口令，理论上可能不含数字。

**Fix**：种子校验复用同一正则 `^(?=.*[A-Za-z])(?=.*\d).{8,}$`，保持「三层统一」表述名副其实。

---

### 17. scope 出参 GET/PUT 类型不对称（GET 恒字符串，PUT 容忍 `number|string`）

**位置**：[regulation.service.ts#L59-L63](../server/src/modules/regulations/regulation.service.ts)

**Problem**：本次将制度详情 `scope.department_ids` 统一为 `String`（snake_case），前端 `RegulationDetail.vue` 已跟进，e2e 仅消费 PUT 未受影响，无遗漏消费点。但 PUT 侧 DTO 仍声明 `(number | string)[]` 且 e2e 传 `Number(...)`，与 GET 恒返回字符串形成读写不对称。当前可容忍（服务端 `.map(String)` 归一）。

**Fix**：后续将 PUT DTO 也收紧为 `string[]`，避免未来新增消费方按 number 假设回传。

---

## 变更总结（Summary of Changes）

- **ea54c7e（feat）**：交付了 NestJS + Vue 3 + MySQL + Redis 全套「制度上传→学习→AI 出题→考试→统计」实现，13 项评审问题 + 3 项附录观察已在其自身 diff 内修复；本次抽查（`setSingle`、jwt-auth 拒 refresh、GradingService 复用、`withSessionMutex`、UTC 时区、`resolveDeptPath.clear()` 等）均在位，vitest 17/17、`tsc` 0 错误、e2e `check()` 计 86 处、`init.sql` 12 表——**声明兑现**。
- **5134998（fix）**：15 项 GUI 问题修复中 F1/F2/F3/F5/F6/F7/F8/F9/F10/F12/F13/F14/F15 均已落地（含用 `unpdf@1.8.1` 对合成 PDF 与真实 PDF 实跑解析成功），**F4「跳转前等待收口」只覆盖两个页内按钮**（Warning #3），**F11「三层统一 ≥8 位」漏改导入模板示例行**（Warning #4），并新引入 **Node 22 隐式依赖**（Critical #2）、**end 合并锁外竞态**（Critical #1）、**新标签页续登丢失 pwd_pending**（Warning #7）、**compose 未透传 AI_EGRESS_ALLOW_HOSTS**（Warning #8）四项新副作用。
- **d361c7f（docs）**：AGENTS.md 与 `.gitignore` 变更自身安全（未误伤已跟踪文件），但**目录地图未收录紧邻上一提交刚沉淀、并声明「供 GUI 回归复用」的 `tests/gui-test-env/`**（Suggestion #12），使复用资产在唯一工作区指引中不可发现。
- **文档/契约漂移**：README 仍标注 `pdf-parse`（Warning #9）；gui-test 报告将已 gitignore 的截图目录列为复测证据（Suggestion #13）；e2e 未新增针对本次修复的断言（Suggestion #11）——三处共同削弱了本次修复的可验证性。
- **修复优先级**：Critical #1（数据丢失竞态，触及架构红线）→ Critical #2（生产镜像 Node 版本）→ Warning #3/#4/#7（用户可感知的功能断裂/回归）→ Warning #5/#6（安全口径裂缝）→ Warning #8/#9/#10（配置与文档漂移）→ Suggestions。

---

## 评审边界说明

- 本次评审仅针对 `HEAD~3..HEAD` 的 diff 与 diff 直接影响到的相邻代码/配置；`review/code-review-2026-09-12.md` 中已确认并在 `review/fix-log-2026-09-12.md` 中记录修复的 13 项问题不重复计入。
- 三视角采用**并行独立评审 + 主代理合并去重**流程，跨视角命中的同一问题合并为一条 finding，保留证据最丰富的版本并注明来源（见 Warning #3、#4）。
- 若下游代码修订后需二次评审，建议仅针对本次 findings 涉及文件与调用链做增量核对，无需全量重跑。
