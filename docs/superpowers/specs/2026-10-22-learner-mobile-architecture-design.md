# 学员移动端 H5 / 微信小程序架构设计

> 日期：2026-10-22
>
> 状态：完整设计基线，待用户审阅；不代表已开始实施或已经验收
>
> 需求基线：[00-旧系统-学员移动端H5需求分析.md](../../design/00-旧系统-学员移动端H5需求分析.md)
>
> 视觉基线：`docs/ui/gemini.pen` 及用户确认的答题页设计稿
>
> 决策来源：[学员端架构讨论决策记录](2026-10-22-learner-mobile-architecture-decisions.md)

## 1. 结论

新建独立的 `mobile/` 工程，采用传统 **uni-app + Vue 3 + TypeScript + Wot UI v2 + Pinia**。

首期交付 H5，部署到 `/mobile/`；代码结构同时保持微信小程序可编译，真正发布小程序时只替换平台适配，不重写页面和业务。当前不建设 App。

PC 管理端继续使用现有 `web/`、Vue 3 和 Element Plus。PC 负责管理，学员只在移动端学习、实名和考试。两端共用 NestJS 后端及业务数据，但登录入口、刷新 Cookie、前端缓存和会话客户端标识相互隔离。

```text
                         ┌─────────────────────────────┐
                         │       NestJS /api/v1        │
                         │ 用户、课程、媒体、考试、统计 │
                         └──────────────┬──────────────┘
                                        │
                   ┌────────────────────┴────────────────────┐
                   │                                         │
          ┌────────▼────────┐                       ┌────────▼────────┐
          │ web/ PC 管理端   │                       │ mobile/ 学员端   │
          │ Vue3 + Element  │                       │ uni-app + Wot UI│
          │ 账号密码登录     │                       │ 手机验证码登录   │
          └────────┬────────┘                       └────────┬────────┘
                   │                                         │
          dist/ 根目录入口                           dist/mobile/ H5
                                                             │
                                                   后续编译 MP-WEIXIN
```

## 2. 目标、非目标与设计原则

### 2.1 目标

1. 完成学员手机验证码登录、首页、课程、视频学习、三图实名、考试、记录和错题闭环。
2. H5 首发，微信小程序复用页面、状态、API 和领域逻辑。
3. PC 与移动端共用服务端安全和业务规则，不复制一套后端。
4. 考试只支持单选、多选、判断；服务端负责截止时间、最终状态和评分。
5. 构建后得到一个可部署目录：PC 在 `/`，H5 在 `/mobile/`。
6. 保持首版简单：不做跨设备草稿、离线题库、实时服务端草稿、实时监考或复杂弱网队列。

### 2.2 非目标

- 不建设 App 打包与应用商店发布。
- 不在首期实现微信一键登录、手机号快速验证或小程序专属授权链路。
- 不把 PC 管理端改造成 uni-app，也不让 PC 承担学员答题。
- 不建设主观题、图片作答、人工阅卷、切屏监控、离线视频或离线整卷考试。
- 不引入 pnpm workspace；保留各工程 npm 锁文件。
- 不把 Wot MCP 纳入项目；AI 辅助仅使用项目级 Skills、CLI 和 `llms.txt` 索引。

### 2.3 原则

- **服务端权威**：身份、实名、来源、学习时长、考试截止、终态和成绩均以服务端为准。
- **页面共用，平台隔离**：H5 与微信小程序差异集中在 `platform/`，不把大量 `#ifdef` 散落在页面。
- **稳定 ID 贯穿**：题目项和选项使用稳定 ID；移动端选择什么 ID，就提交什么 ID。
- **失败不伪装成功**：短信、草稿、交卷、实名和媒体访问只有服务端或本地写入真正成功后才更新成功状态。
- **最小持久化**：access token 和敏感材料不进本地持久化；考试仅保存最小答案草稿。

## 3. 工程结构

```text
RuleExam/
├── server/                  # 现有 NestJS 后端
├── web/                     # 现有 PC 管理端
├── mobile/                  # 新增学员端 uni-app 工程
│   ├── package.json
│   ├── package-lock.json
│   └── src/
│       ├── api/
│       │   ├── client.ts
│       │   ├── auth.ts
│       │   ├── courses.ts
│       │   ├── exams.ts
│       │   ├── identity.ts
│       │   └── media.ts
│       ├── components/
│       │   ├── rich-content/
│       │   ├── question/
│       │   ├── answer-card/
│       │   └── course/
│       ├── pages/
│       │   ├── auth/
│       │   ├── home/
│       │   ├── course/
│       │   ├── exam/
│       │   ├── identity/
│       │   └── profile/
│       ├── platform/
│       │   ├── session.ts
│       │   ├── media-picker.ts
│       │   ├── media-player.ts
│       │   └── navigation.ts
│       ├── stores/
│       │   ├── session.ts
│       │   ├── learner.ts
│       │   ├── course.ts
│       │   └── exam.ts
│       ├── types/
│       ├── utils/
│       ├── App.vue
│       ├── main.ts
│       ├── pages.json
│       └── manifest.json
├── scripts/
│   └── build.mjs            # web / h5 / 组合构建与安全组装
└── dist/
    ├── index.html            # PC
    ├── assets/
    └── mobile/
        ├── index.html        # H5
        └── assets/
```

页面只调用 `api/`、`stores/` 和抽象后的 `platform/`。平台实现可以使用条件编译，但条件编译不得进入业务页面、考试规则或学习计时逻辑。

## 4. 页面与导航

首期页面按需求收敛为：

```text
登录
  ↓
首页 ── 课程 ── 考试 ── 我的       四个底部 Tab
         │        │       │
         │        │       ├─ 实名认证
         │        │       ├─ 个人资料
         │        │       ├─ 考试记录
         │        │       ├─ 错题本
         │        │       ├─ 关于我们
         │        │       └─ 服务条款
         │        ├─ 答题页
         │        ├─ 结果页
         │        └─ 答案解析
         ├─ 课程详情
         └─ 视频学习
```

答题、结果、解析、课程详情、视频和实名等子页面不显示四底栏。答题页返回、浏览器返回和小程序返回都进入防误退出确认；不能承诺拦截系统强制关闭。

H5 使用 Hash 路由，基础路径固定为 `/mobile/`。微信小程序使用 `pages.json` 的原生页面路由，业务层不感知 URL 差异。

## 5. API 与状态分层

### 5.1 统一请求客户端

`mobile/src/api/client.ts` 是唯一普通接口入口：

1. 通过 `uni.request` 调用同域 `/api/v1`。
2. 统一拆解 `{code,message,data}` 响应信封。
3. 自动附加内存中的 access token。
4. 并发 401 只触发一次 refresh；等待中的请求共享结果。
5. 原请求最多重放一次，防止刷新失败后的循环请求。
6. refresh 失败只清理 mobile 会话，不影响 PC Cookie，也不立即删除归属明确的考试草稿。

业务 API 模块不直接操作 Pinia 或路由；Store 负责流程状态，页面只负责交互。

### 5.2 Store 持久化边界

| Store | 内存 | 本地持久化 |
|---|---|---|
| session | access token、当前登录态 | 不保存 access/refresh token |
| learner | 学员摘要、实名、来源、类别 | 可缓存非敏感展示摘要，启动后以服务端覆盖 |
| course | 当前课程、目录、播放状态 | 可保存非权威的最近页面位置 |
| exam | 题目内存、答案、当前题号、截止时间 | 只保存 D29/D31 定义的最小草稿 |

PC 和移动端存储分别使用 `ruleexam:pc:*`、`ruleexam:mobile:*` 前缀。移动端用户数据继续按 `userId` 隔离；考试草稿再按 `attemptId` 隔离。

## 6. 登录、注册与会话

### 6.1 登录链路

```text
输入手机号
   │
   ├─ POST /api/v1/mobile/auth/sms/send
   │      └─ 返回 challenge_id、重发剩余时间
   │
输入 6 位验证码
   │
   └─ POST /api/v1/mobile/auth/sms/login
          ├─ 校验并一次性消费 challenge
          ├─ 按规范化手机号查用户
          │    ├─ 已有普通学员：沿用原 ID
          │    ├─ 不存在：注册 external 学员
          │    ├─ 停用：拒绝
          │    └─ 重号：拒绝并联系管理员
          ├─ 拒绝管理员、非 employee、拥有管理权限的账号
          ├─ 创建 client=mobile 的 auth_session
          ├─ 返回 access JWT
          └─ 写 mobile HttpOnly refresh Cookie
```

首期手机号限定中国大陆手机号码，服务端统一规范化；前端校验只用于体验，服务端再次校验。自动注册必须依赖数据库手机号唯一约束解决并发，不使用“先查再插”代替唯一约束。

### 6.2 短信参数

- 6 位数字验证码。
- 有效期 300 秒。
- 60 秒后可重发。
- 单 challenge 最多校验 5 次。
- 单手机号每日最多发送 10 次。
- 单 IP 每日最多发送 100 次。
- 参数均由环境变量配置。
- 供应商沿用网易云信；凭据仅从环境变量读取。
- challenge 存 Redis，验证码只存安全摘要，一次性原子消费。
- 日志不得出现验证码、密钥、完整手机号或 Token。

### 6.3 共用会话核心

PC 密码和 H5 短信只在“凭证验证”阶段不同，之后共用一个会话签发核心：

```text
PC 密码 + 图片验证码 ─┐
                      ├─ issueSession(user, client, authMethod)
H5 手机 + 短信验证码 ─┘       ├─ 创建 auth_session
                              ├─ 签 access JWT
                              ├─ 签 refresh JWT
                              └─ 审计成功登录
```

`auth_session` 增加 `client` 和 `auth_method` 字段。access JWT 至少携带 `type=access`、`sid`、`auth_version`、`client=mobile`、`auth_method=sms`；这些声明只用于限制，用户角色和权限仍以数据库为准。

### 6.4 PC 与移动端隔离

| 项目 | PC | H5 |
|---|---|---|
| 登录凭证 | 用户名、密码、管理员图片验证码 | 手机号、短信验证码 |
| refresh Cookie | 现有 `ruleexam_refresh` | 新 `ruleexam_mobile_refresh` |
| Cookie Path | `/api/v1/auth` | `/api/v1/mobile/auth` |
| access token | PC 现有策略 | Pinia 内存 |
| 本地缓存 | `ruleexam:pc:*` | `ruleexam:mobile:*` |

移动端短信登录只允许数据库当前角色为 `employee` 且没有有效管理权限的用户。每次 mobile 请求都要按数据库复核这一条件；账号后续被提升权限时，旧 mobile 会话立即失去访问能力，并通过现有 `auth_version`/封禁机制吊销。

导入学员的 `force_password_change` 不阻止其短信进入学员端；这只对 `client=mobile + auth_method=sms + learner-only route` 生效，不能放宽 PC 强制改密。自动注册用户生成不可预测的内部 username 和不可用的随机密码摘要，不向用户发放默认密码。

### 6.5 会话恢复与并发

- H5 启动时用 mobile refresh Cookie 静默换取 access token。
- refresh 继续轮换旧 refresh JTI，并检查用户状态、auth_version、会话吊销和用户级封禁。
- 同一学员允许多个 mobile 会话；新设备登录不挤下旧设备。
- 不做跨设备在线状态同步和跨设备草稿同步。
- 退出只吊销当前 mobile 会话并清理 mobile 状态，不操作 PC 会话。
- 微信小程序未来在 `platform/session.ts` 更换 Token 传输方式，登录业务和页面不改；本设计不提前冻结小程序 refresh 的持久化方案。

## 7. 学员账号、来源与实名

### 7.1 账号关联

- 已导入或已经注册的手机号沿用原 `sys_user.id`，不得重复建号。
- 无账号时自动注册 `role=employee`、`source=external`。
- 后台导入名单为 `source=institution`；再次短信登录不能把内部学员重置为 external。
- 外部改内部只能由后台管理员操作并审计。
- 停用账号不能通过短信重新注册绕过。
- `sys_user.phone` 增加规范化后的唯一索引；迁移前必须检查重复号码，不能静默合并历史账号。

### 7.2 三图实名

实名按需求既定链路实现：身份证正面、身份证反面、现场正脸照，后端对接腾讯 OCR + FaceID。

```text
我的 → 实名认证
  ├─ 选择/拍摄身份证正面
  ├─ 选择/拍摄身份证反面
  ├─ 现场采集正脸照
  ├─ 私有上传并提交核验
  ├─ pending 时查询状态
  └─ 成功后重新读取服务端权威实名视图
```

H5 和微信小程序只在 `platform/media-picker.ts` 中区分相机、相册、权限和临时文件。证件明文、正脸照片和临时预览不得进入 Pinia 持久化或普通日志。

未实名可以登录、浏览首页、课程列表、课程详情和考试列表；开始视频学习或正式开考时，前后端同时检查实名。实名状态读取失败或仍在处理中均不放行学习/开考，但不清历史数据。

## 8. 课程和视频学习

### 8.1 页面流程

```text
首页推荐 / 课程列表
          ↓
       课程详情                未实名可浏览
          ↓ 点击开始学习
    后端校验本人实名和课程资格
          ↓
       视频播放页
```

课程、章节、课时、当前视频版本、服务端断点和学习状态均从后端读取。页面不根据本地百分比自行宣称完成。

### 8.2 学习计时协议

直接复用 `docs/design/05-模块设计.md` §5.4.8：

- 默认每 30 秒上报一次心跳。
- 上报递增 `seq`、`position_ms` 和播放器状态。
- 只有合法连续 `playing` 区间计时。
- `paused`、`buffering`、后台状态不计时。
- 单段服务端确认最多 45 秒。
- `credited_ms = min(server_elapsed, 45000, forward_position)`。
- 前进量超过 `server_elapsed + 2 秒` 时，该段不计时且不推进断点。
- 去重覆盖达到 95% 才完成，重复播放不重复累计。

前端只报告播放器事件和位置，不补算有效时长。

### 8.3 断网

视频断网沿用组件原生缓冲和 loading。缓冲期间不上报 playing，不增加离线缓存、复杂重试队列或弱网状态机。最终失败时提供简单重试；已由服务端确认的进度不回退。

## 9. 受控媒体访问

当前 `/api/v1/media/:id/content` 依赖 Bearer Token，而 `<image>`、`<video>` 无法在 H5 和微信小程序中统一携带该请求头。移动端统一采用短期媒体票据：

```text
Tiptap / 课程数据只保存 asset_id
              │
              ▼
mobile 用 Bearer Token 请求媒体访问票据
              │
              ▼
后端校验当前用户、业务对象和 asset 归属
              │
              ▼
返回短期签名 content_url
              │
              ▼
原生 <image> / <video> 访问，服务端支持 Range
```

签名 URL 使用单独 HMAC 密钥，包含资产 ID、用户 ID、用途和过期时间，不包含 JWT、真实文件路径或可修改的业务权限。TTL 由环境配置；过期后客户端重新换取。题目图片只能为当前 attempt 的题目资产，视频票据只在通过实名和课程资格检查后签发。

这是一项设计调用，用于完成已确认的受控媒体和双平台目标；具体路由名与 TTL 属于实施细节。

## 10. 考试领域设计

### 10.1 生命周期

```text
未开始
   │ 学员主动开考，服务端校验资格并冻结个人题单
   ▼
in_progress ───────────────┐
   │                       │
   │ 主动确认交卷           │ 到达 deadline 且未成功提交
   ▼                       ▼
服务端受理、评分、冻结结果   timeout / 失败终态
   │                       │
   ├─ passed              └─ 不接收迟到答案，不自动交卷
   └─ failed
```

倒计时只展示 `deadline_at - server_now` 校准后的剩余时间。切后台、断网或退出页面不暂停、不延长。

### 10.2 开考与恢复

开考成功返回当前 attempt 的不可变题目快照：

```ts
interface AttemptView {
  record_id: string
  paper_id: string
  deadline_at: string
  server_now: string
  questions: AttemptQuestion[]
}
```

服务端在创建 attempt 时完成题目和选项乱序并保存映射。相同 `record_id` 恢复时返回相同题序、选项顺序和稳定 ID，不重新抽题。

重进时先查询服务端状态：

- `in_progress` 且未截止：返回原题目快照，然后合并当前设备本地草稿。
- 已交卷：进入冻结结果。
- 已超时：进入超时结果，不恢复草稿。
- 本地草稿缺失或损坏：提示原答案无法找回，以空答案继续同一 attempt，不延长期限。

### 10.3 题目 JSON

只支持 `single`、`multiple`、`judgment`：

```ts
interface AttemptQuestion {
  item_id: string
  type: 'single' | 'multiple' | 'judgment'
  score: number
  stem: ReadonlyTiptapDoc
  options: Array<{
    id: string
    content: ReadonlyTiptapDoc
  }>
}
```

受限 Tiptap JSON 首期白名单为：`doc`、`paragraph`、`text`、`hardBreak`、受控 `image`。图片节点只保存 `asset_id` 和必要的无障碍说明，不接受任意 `src`、HTML、事件属性或脚本。

PC 编辑器生成完整题目 JSON，发布时验证并冻结。学员端使用自己的只读渲染器，不嵌入 PC Tiptap 编辑器。`checked`、`correct`、正确答案、解析、评分规则和管理元数据绝不进入在考 payload。

选项 `id` 在题目版本内唯一且不可因展示乱序改变。A/B/C/D 是移动端根据当前展示顺序生成的标签，不是答案身份。

### 10.4 本地答案与草稿

运行时答案模型：

```ts
type ExamAnswers = Record<string, string[]> // item_id -> option_id[]
```

- 单选、判断最多一个 ID。
- 多选允许多个不同 ID。
- 每次选择、取消或修改后，先更新 Pinia，再用 `uni.setStorage` 保存整份答案快照。
- 页面隐藏、进入后台或卸载时再尽力补存一次。
- “草稿已保存”只在本地写入成功后更新。
- 不做定时保存、IndexedDB、服务端持续草稿或跨设备同步。

本地持久化内容仅为：

```ts
interface LocalExamDraftV1 {
  answers: ExamAnswers
  currentIndex: number
  savedAt: string
}
```

完整题目只保存在页面内存。页面保持打开时断网可以继续答题；刷新或关闭后必须联网重新取得原 attempt 快照，再合并本地答案。离线重进只提示等待网络恢复。

### 10.5 防误退出

- 答题页不显示普通底部导航。
- 页面“退出”、浏览器返回、小程序返回尽可能进入强确认，默认继续答题。
- 学员明确确认后可以离开，不能伪称页面绝对锁死。
- 离开后原 deadline 继续推进；重新进入只恢复原 attempt。
- 系统强制关闭、进程回收等不可拦截情况由本地草稿兜底。

### 10.6 交卷契约

只有学员点击“交卷”并二次确认才发送：

```ts
interface SubmitAttemptRequest {
  record_id: string
  answers: Array<{
    item_id: string
    option_ids: string[]
  }>
}
```

请求必须包含整张试卷的全部题目；未答题也传 `option_ids: []`。缺失题目、重复/未知 `item_id`、不属于题目的选项 ID、单选/判断多选等均拒绝。移动端不把 ID 转换成展示下标。

后端事务流程：

1. 锁定本人 `record_id`。
2. 确认状态仍为 `in_progress` 且服务端当前时间早于 deadline。
3. 读取冻结题目快照，完整校验整卷答案。
4. 按稳定选项 ID 评分。
5. 一次性写入答案、分数和 passed/failed 终态。
6. 返回冻结结果。

### 10.7 幂等与结果不明

不增加 `submission_id`。`record_id + 服务端终态` 是幂等边界：

- 首次成功提交完成评分和冻结。
- 已交卷的重复请求忽略后来答案，返回第一次冻结结果。
- 请求发出后网络中断，客户端先查状态；已交卷就展示结果，仍进行且未截止才可重试相同整卷 payload。
- 到期后不再重试或补交。

### 10.8 超时不自动交卷

到达 deadline 后，服务端把仍为 `in_progress` 的记录原子转为 `timeout`。该转换可以由定时任务和读/写入口的惰性检查共同保证，但不得使用客户端本地答案或服务端草稿自动交卷。

超时记录记为失败，分数为 0，不创建伪造的学员提交答案；`submitted_at` 只用于主动成功交卷。移动端倒计时归零时锁定编辑、查询终态，不发送自动提交请求。

### 10.9 答题页面

答题页遵循已确认设计：

- 顶部：受保护的退出、居中倒计时、主动交卷。
- 倒计时临近截止变红，但不自动提交。
- 进度条、已答数量和本地草稿保存时间。
- 题号/总数、题型、分值、题干、文字或图片选项。
- 普通选项使用卡片；图片选项使用两列网格。
- 底部固定上一题、答题卡、下一题。
- 答题卡按未答/已答/当前题展示，不出现正确/错误状态。

## 11. 结果、历史与错题

- 结果只读取后端冻结数据，不根据前端答案自行算分。
- 已交卷结果显示总分、状态、正确率、答对/错题数和用时。
- timeout 明确显示“超时未交卷”，不能显示为主动交卷成功。
- 答案解析和错题本只在终态后返回正确答案、学员答案和解析。
- 历史、结果、解析、错题读取同一个冻结结果版本，避免页面口径不一致。
- PC 端只管理和查看记录，不参与学员答案提交。

## 12. 构建与部署

### 12.1 命令

保留 npm，由根 Node.js 脚本统一调度：

```bash
node scripts/build.mjs web
node scripts/build.mjs h5
node scripts/build.mjs web h5
```

未来小程序单独编译，不进入网站部署目录：

```bash
node scripts/build.mjs mp-weixin
```

### 12.2 安全组装

```text
web build ──→ 临时目录/web ──┐
                              ├─ 校验成功 ─→ staging ─→ 原子替换 dist/
h5 build  ──→ 临时目录/h5 ──┘
```

- 单独构建 web 时保留已有 `dist/mobile/`。
- 单独构建 h5 时保留已有 PC 产物。
- 组合构建必须两端全部成功才组装。
- 构建失败时不修改现有 `dist/`。
- 临时目录和最终目录必须在同一文件系统，以便使用 rename 完成近似原子切换。
- 脚本在切换前校验 PC、H5 的 `index.html` 和资源清单；切换失败时恢复旧目录。
- 不允许任一子工程直接清空共享根 `dist/`。

### 12.3 Vite 与服务器

- PC 最终 base 为 `/`。
- H5 Vite base 为 `/mobile/`。
- H5 使用 Hash 路由，避免服务器为每个前端路由做 fallback。
- Nginx 同一个静态根部署 `dist/`，`/api/v1/` 反向代理 NestJS。
- `index.html` 不做长期缓存；带 hash 的静态资源可长期缓存。
- Docker 构建改为从仓库根执行组合构建，并复制根 `dist/`。

## 13. H5 与微信小程序适配边界

| 能力 | 共用 | 平台适配 |
|---|---|---|
| 页面、Wot UI、Pinia、API、业务规则 | 是 | 否 |
| 手机验证码业务 | 是 | session 传输以后可替换 |
| 图片/相机选择 | 业务流程共用 | `platform/media-picker` |
| 视频事件标准化 | 学习协议共用 | `platform/media-player` |
| 返回与退出拦截 | 规则共用 | `platform/navigation` |
| 本地草稿 | 数据结构共用 | `uni.setStorage` 统一封装 |
| 路由地址 | 页面语义共用 | H5 hash / 小程序 pages |

首期 H5 完成后，微信小程序验收重点是登录会话传输、合法域名、相机权限、视频全屏/切后台事件和返回拦截，不重新设计业务页面。

## 14. 安全设计

1. 考试 payload 不含答案、解析、correct/checked 或评分规则。
2. 提交按本人、record、题目集合、稳定选项 ID、状态和 deadline 全量校验。
3. 短信挑战一次消费并限流；验证码和供应商密钥不记录日志。
4. refresh 只存在 HttpOnly Cookie；access 只在 Pinia 内存。
5. mobile 会话带 client/auth_method 限制，管理员不能借短信绕过 PC 登录。
6. 实名材料和受控媒体均为私有资产，访问前按业务归属授权。
7. Tiptap JSON 只渲染白名单节点，拒绝任意 HTML 和外链脚本。
8. 本地不持久化身份证、正脸照片、refresh/access token 或完整题目。
9. 所有服务端关键写入记录审计，但日志脱敏手机号、Token、证件和媒体内容。
10. 数据库变更必须同步迁移、`database/init.sql`、entities 和对应设计分册。

## 15. 当前实现差距

| 现状 | 设计要求 | 实施影响 |
|---|---|---|
| 尚无 `mobile/` | 新建独立 uni-app 工程 | 新工程与 H5 构建配置 |
| 尚无 `scripts/build.mjs` | 单端/组合安全构建 | 新增根构建脚本，修正 web 直接清空 dist |
| 只有密码登录和 PC 图片验证码 | H5 手机短信登录 | 新增短信 challenge、自动注册、mobile auth controller |
| PC 仅有 `ruleexam_refresh` | PC/mobile refresh 隔离 | 新 Cookie、path、client/auth_method 会话字段 |
| `JwtAuthGuard` 全局强制改密 | mobile learner SMS 不受导入初始密码阻塞 | 增加 client-aware learner route 限制，PC 不放宽 |
| `sys_user.phone` 无唯一约束 | 手机号并发关联唯一 | 数据清理前检、迁移、实体和 init 同步 |
| 当前题干/选项主要为字符串 | 受限 Tiptap JSON + 受控图片 | 发布校验、快照、只读 renderer 适配 |
| 当前答案 DTO 使用 `selected:number[]` | 稳定 `option_ids:string[]` | DTO、校验、评分映射和测试调整 |
| 当前 AttemptView 包含服务端 draft 字段 | mobile 首版仅本地草稿 | mobile 契约不依赖 draft_revision/服务端 answers |
| 当前存在自动交卷路径和文案 | 超时只进入 timeout，不提交答案 | 移除/改造 autoSubmit 及恢复提示 |
| 当前媒体内容接口依赖 Bearer | 原生 image/video 统一访问 | 新增短期媒体票据与 Range 支持 |

这些是实现任务，不是当前已经具备或已经验收的能力。

## 16. 验证与验收

### 16.1 自动化检查

- `mobile` TypeScript 检查、H5 构建、MP-WEIXIN 编译检查。
- 受限 Tiptap renderer 的节点白名单、未知节点拒绝、图片资产解析测试。
- session 单次 refresh、并发 401 合并、最多一次重放测试。
- 草稿按用户/attempt 隔离、每次答案变更保存、损坏/过期处理测试。
- 短信发送/校验限流、一次消费、并发自动注册、停用/高权限拒绝测试。
- PC/mobile Cookie 隔离、mobile 权限提升后失效、PC 强制改密不回归测试。
- 题目 payload 防答案泄漏测试。
- 三题型稳定 ID 校验、整卷完整性、未答空数组、重复交卷幂等测试。
- deadline 前后竞态、超时不自动交卷、不允许迟到答案测试。
- 视频心跳、缓冲不计时、45 秒封顶、位置跳跃拒绝和 95% 完成测试。
- 单端/组合构建失败保护及最终 `dist/mobile/` 结构测试。

### 16.2 首期 H5 浏览器与真机验收

- H5：iOS Safari、Android Chrome、微信内置浏览器。
- 320–430 CSS px 宽度布局，重点检查答题卡、图片选项和底部固定操作区。
- 真实断网/恢复、刷新、强制关闭、重复交卷和临界 deadline。
- 真实网易云信短信、腾讯 OCR/FaceID 和私有媒体链路。

### 16.3 后续微信小程序验收

首期只要求 MP-WEIXIN 编译兼容检查，不把微信小程序登录或真机业务闭环作为 H5 交付门槛。真正进入微信小程序交付阶段后，再验收会话传输、合法域名、相机权限、视频全屏/切后台事件、返回拦截和媒体票据。

构建、API 自动化、浏览器模拟、真实设备、真实短信/实名分别是不同证据等级；任何一种不能替代其他验收。

## 17. 实施顺序边界

后续计划可按以下依赖顺序拆分，但本设计本身不授权开始实现：

```text
1. 数据与 API 契约
      ↓
2. mobile 工程骨架、请求层、平台适配
      ↓
3. 短信登录、会话、账号关联
      ↓
4. 首页、课程、实名、受控媒体
      ↓
5. 视频学习协议
      ↓
6. 考试、草稿、交卷、结果闭环
      ↓
7. 根构建脚本、Docker/Nginx 组装
      ↓
8. 自动化、浏览器、真机和真实供应商验收
```

正式实施前，应把本设计涉及的数据库/API/安全条款同步到 `docs/design/` 对应分册，并按项目规则编写实施计划。未经用户批准本设计，不创建 `mobile/`、不安装业务依赖、不修改数据库和业务代码。
