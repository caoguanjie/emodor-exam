# COS 媒体集成实施与验收记录

**本地切换更新：**用户已明确授权重启，现已本地合入 main、应用 COS 033、开启 cos/cos-signed、追加准确本地 CORS 并迁移全部7个存量文件，原件保留。真实读回哈希、引用集合、视频206和品牌图浏览器读取均通过。登录后的新上传/续传、H5真实实名开播及容量仍待验。最新结果以[本地切换记录](2026-10-26-cos-local-cutover.md)为准；下文保留实施阶段证据和当时的待办快照。

执行方式：用户指定 Astra 并行编排，不经过 SDD。

工作副本：`/Users/caogj/Documents/emodor/RuleExam/.worktrees/cos-media-integration`，分支 `cos-media-integration`，基线 `44b9d7f`。初次实施时主工作区未提交的题库/UI 改动未复制，COS候选迁移使用030；该编号从未部署。本次整合主线已应用的029—032后改为 `033_cos_media_storage.sql`，不改写主线迁移内容或checksum。下列原候选commit与测试结果保留为历史证据，不能代替重编号后的复验。图谱项目 `RuleExam_cos` 仅用于定位，未覆盖的媒体实现按路径读取。

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

真实 COS/STS 的受限探针已通过；正式应用的真云浏览器上传/长视频、真实迁移、真机、容量和生产部署尚未验收。所有真实云配置变更须先形成具体可审阅差异；本记录不能作为数千并发或生产上线证明。本地原媒体文件不得随迁移工具开发删除。

## 集成验证证据

| 层级 | 实际结果 | 证明范围 |
|---|---|---|
| 服务端集成单测 | 最终 76 文件 1099 项通过，含构建 | 包含配置校验、私有 ACL 与回滚恢复增量；日志 `/tmp/ruleexam-cos-server-final.log` |
| 后端审查修复 | 30 项受影响单测、15 项迁移单测、4 项配置测试、12 项预检测试通过 | `124e948` 的 ACL/恢复修复由独立 reviewer 确认闭环 |
| Node 环境、容量工具及注册 | 环境 11 项、最终容量工具 66 项、套件注册 22 项通过 | 配置、真实本机流、准确 COS 目标/签名窗与默认不发流量；不是容量结论 |
| PC 前端 | 首轮 38 文件 513 项，最终增量 3 文件 53 项，vue-tsc 通过 | 失败会话重选、短 TTL 和确定性重复签名恢复 |
| H5/小程序共享逻辑 | 首轮 48 文件 440 项，最终增量报告 131 项（含类型统计），type-check 通过 | 单一学习会话恢复与迟到响应保护；不代表小程序真机 |
| 隔离全链 | 26 个 HTTP/数据库断言与最终真实浏览器用例通过 | 真 MySQL/Redis/API、真实 HTMLVideoElement；包括旧尾 Range 403 和相同签名恢复，COS 网络为替身 |
| 既有业务回归 | training-media、mobile-identity、mobile-media-ticket、training-courses、training-video-learning、training-publishing、training-question-import 通过 | 各自自有临时数据库，未对开发库执行破坏性测试 |
| 新持久化/竞争套件 | cos-media-schema、media-upload-races、media-storage-migration 通过 | 真数据库迁移续跑、竞争、回执丢失和回退；COS 为替身 |
| 学员 H5 业务链 | `mobile-h5` 隔离套件及其中真实浏览器用例通过 | 真 API 的实名门、最小草稿恢复、主动交卷、结果/回顾/历史/错题、纯 timeout；不是真实腾讯实名或 COS |
| 构建 | PC+H5 原子组合构建与 MP-WEIXIN 构建通过 | 仍有原有 Sass legacy API 和移动端循环 chunk 提示 |
| 真实供应商 | simple/multipart/STS/准确键拒绝/签名 GET/200/206/416/匿名拒绝/过期拒绝/哈希通过 | 仅随机自有探针；2 对象已删、1 未完成上传已 abort、0 待清理 |
| 构建密钥检查 | 497 个产物文件未发现本地后端凭据值 | 只输出计数，不输出凭据内容 |

最终代码候选为 `92c945b`。后端/预检/容量与前端均经过独立只读审查，实质发现已修复并分别复审闭环，见后端及前端 review 记录。根在最终候选重跑 `cos-media-flow`、`node scripts/build.mjs web h5`、`node scripts/build.mjs mp-weixin`，均退出 0；对应日志为 `/tmp/ruleexam-cos-flow-final2-reviewed.log`、`/tmp/ruleexam-cos-final2-web-h5-build.log`、`/tmp/ruleexam-cos-final2-mp-build.log`。没有 push 或合并主工作区。

## 主线整合与迁移重编号复验

整合主线 `1725b80` 的029—032后，未部署的COS候选030顺延为033；这里只修改文件名、首行编号及引用，DDL与完成探针不变。逐字节对比确认029—032与主线原文件一致；`init.sql`仍为40张业务表加1张迁移元数据表，共41张物理表。

- `node --test tests/migration-catalog.test.mjs tests/cos-media-migration.test.mjs tests/migration-contract.test.mjs`：42/42通过；包含000—033完整升级、重复应用、COS两处DDL崩溃恢复、旧资产/引用不变及结构漂移拒绝。
- `node tests/run-e2e.mjs --ephemeral --suite cos-media-schema`：退出0，5类schema场景通过；自有MySQL/Redis/API进程和临时目录清理成功。以上未读取真实环境文件，未对开发库或云执行变更。

## 本地存量与切换准备

初次只读查询现有开发库及本地文件：共有 7 个 ready 资源，4 张品牌图、1 张课程封面和 2 个视频，7 个实际文件均存在、大小与 SHA 匹配。该库已到 `029_question_soft_delete`，尚无 COS 定位列和上传会话表。当时未执行COS候选030、未切换任何现有媒体行、未删除任何原文件。本次整合前，根智能体已只读确认主线029—032已应用、COS候选030从未应用，仍有7个ready资源；当前待应用的COS迁移为033。worktree `.env` 的 `UPLOAD_DIR` 已指向这些现存本地文件，避免相对目录误指空的 worktree/uploads。

配置保持 `MEDIA_STORAGE_PROVIDER=local`、`MEDIA_DELIVERY_MODE=proxy`。同一套共享 COS 密钥已在忽略的 0600 根 `.env` 中配置，前端仅注入公开 origin/prefix。切换前须部署本分支后端、应用迁移 033，再通过浏览器配置/正式媒体 G0，审阅实际批次后执行迁移；不能把尚在旧主分支运行的服务直接指向 COS 行。

只读盘点和具体本地 CORS 提案存于仓库外私有运维目录：`/Users/caogj/Documents/emodor/RuleExam-cos-operations/2026-10-26/`。当前供审阅的提案文件为 `cos-local-cors-proposal-v2.json`（包含 `x-cos-acl`），旧版保留仅作历史，不应应用。提案尚未应用；未修改共桶 ACL/Policy/CORS/版本和 gooodwork 身份权限。

## 可执行的人工验收路径（待真实环境切换）

先按上节准备新版服务、迁移 033、精确 CORS/CSP 配置及 `cos/cos-signed` 环境；不能在仍运行旧主分支服务时只切数据库或存储参数。随后在 worktree 分别运行 `npm --prefix web run dev`、`npm --prefix mobile run dev:h5`，页面来源使用提案中的 localhost 或 127.0.0.1。

1. PC 打开 `http://localhost:5173/admin/courses`，进入草稿课程，上传一段大于 16 MiB 的合法 MP4；检查分块直达 COS、暂停后恢复、刷新后重选原文件续传，且等待服务端 ready 后才能保存。换成同名不同内容必须新建任务；确认终态失败后重新选原文件可发起新任务。
2. PC 打开 `http://localhost:5173/admin/questions`，在 Tiptap 插入图片并保存，重开题目、预览和出卷后仍能显示。业务 JSON 只保存 asset ID；已签名 URL 不进入题干或冻结快照。打开 `/admin/system/site-settings` 检查 Logo/轮播沿当前白名单展示。
3. H5 打开 `http://localhost:5174`，用已启用、已实名的普通学员进入上述已发布课程；跨链接到期播放、拖动未缓冲片段、前后台切换和暂停后续播，检查位置/播放意图保持，续签不重新创建学习 session，不补计断网时间。切账号、课程下架或撤销引用后不能取得新票；旧 COS 链接到期前仍可访问是已接受边界。
4. 用同一学员检查个人头像上传和考试题图；在考不出现解析图，纯 timeout 不返回题图；身份三图仍走专用处理/代理，不得到普通 COS 链接。小程序使用合法域名配置后另做真机验证。
5. 真实迁移先选择这 7 项清单内的小批次样本：比较 ID/引用/实际哈希，查看原历史题图或课程，执行逐项回退并确认本地文件仍保留。只有样本业务验收通过后才扩大批次。

以上是待执行的人工作业路径，不是本次已通过记录。已有自动化与受限云探针只能证明上表标出的范围。
