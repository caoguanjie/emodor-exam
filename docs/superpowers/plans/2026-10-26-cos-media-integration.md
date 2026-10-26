# COS 媒体集成 Implementation Plan

> **执行方式：** 按用户明确指定的 [astra-workflow](../../../.codex/skills/astra-workflow/SKILL.md) 执行，由根代理管理依赖队列、委派并行工作、整合和裁决。整个项目不经过 SDD，也不将 `subagent-driven-development` 或 `executing-plans` 作为执行前置流程。下文 checkbox 只记录交付进度，不代表逐任务串行审批。

**Goal:** 复用 gooodwork 的 COS 桶及通用资产设计，完成 RuleExam 图片/视频存储、PC 视频上传续传、受控独立分发和可回退的存量迁移。

**Architecture:** 扩展现有媒体服务，保留资源 ID、精确业务引用和学习/考试权限；以按行 local/COS 驱动兼容存量。直传只写临时对象，服务端实际校验后发布不可变正式对象；读取沿用gooodwork：每次申请/续签先校验当前业务权限，再下发私有COS签名GET；默认300秒、配置上限3600秒，长视频自动续签保位置。上传会话、后台处理和迁移均使用持久状态恢复。

**Tech Stack:** Node.js ≥22、NestJS 10、TypeORM/MySQL 8、Redis、现有 ffprobe/ffmpeg；Vue 3/Element Plus、uni-app/Wot UI 2.3.2；腾讯 COS Node/JS SDK、STS、COS短链；Vitest、现有隔离 E2E 和 Playwright。

**Spec:** [2026-10-26-cos-media-integration-design.md](../specs/2026-10-26-cos-media-integration-design.md)。用户已确认据此编写计划；已在 `.worktrees/cos-media-integration` 执行；进度与证据见 `review/2026-10-26-cos-media-acceptance.md`。用户后续明确用gooodwork短链替换EdgeOne，不能把本地实现当成真云/迁移/容量通过。

## 实施状态（2026-10-26）

实际代码、测试组织与提交合并情况以[验收记录](../../../review/2026-10-26-cos-media-acceptance.md)为准；checkbox 不把尚未执行的外部动作算成完成。

| 任务 | 当前交付状态 |
|---|---|
| 1—6 | 后端、配置、schema、上传/发布/清理、受控短链已实现，自动化及独立审查通过 |
| 7 | 预检/提案/受限真桶探针完成；CORS 配置未应用、正式浏览器业务 G0 未完成 |
| 8—10 | PC/H5 接入、续传和续签恢复已实现；同秒签名回归与独立复审通过；MP 编译通过 |
| 11 | 迁移/恢复/回退工具与真实数据库自动化完成；只读盘点 7 个文件均匹配，实际迁移未执行 |
| 12 | 自动化、真实播放器网络夹具、组合构建和独立审查完成；真云浏览器、实际迁移、真机、容量与生产切换仍待验 |

代码在 `.worktrees/cos-media-integration`，未合并或推送；当前本地仍为 local/proxy，原媒体保留。最终实现候选 `92c945b`。真实 COS 探针已清理，桶 ACL/Policy/CORS/版本均未变更。

## Global Constraints

- 共用 gooodwork COS 桶及同一套 `COS_SECRET_ID/COS_SECRET_KEY`，两个项目各自前缀、数据库独立；不新建 RuleExam 专用长期 COS 密钥。共享长期凭据的云权限可能覆盖两边，项目范围由适配器校验、受限客户端临时授权和签名对象范围约束，不声称长期凭据相互隔离。
- 保留 `media_asset.id` 的 BIGINT/十进制字符串协议及 `media_reference(asset_id, owner_type, owner_id)`，不改课程、题库、冻结快照的 ID。
- 图片、视频、封面、头像、Logo/轮播、实名材料纳入；PDF/DOCX 原件不迁移、不删除；Excel/TXT 等临时导入不归档。
- 私有对象；签发/续签执行当前授权，纯timeout不发题图、在考不发解析图；已发COS短链到期前仍有效是用户接受的新边界。实名图继续专用代理，不签普通COS链接。
- 默认：上传会话 24 小时、完成回执 30 天、孤儿宽限 24 小时、分块阈值 16 MiB、分块 8 MiB、每文件并发 3、处理每实例并发 2。
- 视频默认上限 512 MiB、图片默认上限 10 MiB；MP4/H.264、音轨 AAC；现有图片类型/像素和真实解码约束保留。
- 视频学习仍为 30 秒心跳、45 秒封顶、2 秒容差和 95% 去重覆盖；续票不能重建学习会话或补时。
- 本地 COS/媒体后端配置保存在根目录 `.env`（0600、Git 忽略），沿用 `env:init/env:check/start:local` 及 Node `--env-file=.env`；本地迁移/检查工具共用该文件。只按白名单从明确指定的 gooodwork 环境文件导入共享 COS 凭据，不复制其他系统密钥或项目配置；不把真实值、签名 URL 或实名材料放入示例、日志、前端包或仓库。
- 数据库无外键；新迁移带可续跑探针，同步 init/entities/设计；不改既有 checksum。初稿基线到 028，当前并行工作区已出现 `029_question_soft_delete.sql`，执行时重新选定下一可用号。
- 生产 COS 配置缺失即失败，不静默回落本地；混合数据按每条资源的驱动读取。
- PC 视频续传为本期验收端；H5 图片简单直传；小程序保留受控代理上传；实名沿用专用处理入口。
- 本地源文件保留回退副本；删除须另行批准。云端变更先形成具体 diff，再授权最后一步；本计划不代签授权。

## Review Focus

1. 上传 90% 时凭证过期、刷新页面或换账号：同一主体能恢复同一任务，其他主体和迟到响应不能接管；Task 4/8/10 钉住此行为。
2. complete 成功但回包丢失、处理 lease 过期、取消同时到达：只发布一个资源，失效处理者不能覆盖正式对象；Task 4/5 的真实事务用例覆盖。
3. 停用、换版、下架或考试到期后拒绝新签/续签；已发链接有界到期。PC/H5临期自动换链接保留播放位置/状态，失败和迟到响应不复活播放器；Task 6/9/10/12 覆盖。
4. 兼容未开启、已开启和暂停版本控制；临时对象被重写或取消后迟到写入时，正文校验与发布使用同一字节，清理只触及自己的准确键/版本。真实共用桶已核验为未开启版本；Task 1/5 的其它版本场景由自动化覆盖，不调整共享桶版本设置。
5. 迁移上传成功后进程崩溃，期间资源被删除或本地文件变化：可对账恢复，不切换错对象、不复活删除行、不影响历史引用；Task 11 覆盖。

---

## 文件归属与执行顺序

本计划是一个媒体能力的连续交付；各任务围绕既有媒体域组织，不拆出独立招聘服务或文件中心。当前媒体直接注册在 `server/src/app.module.ts`，没有 `media.module.ts`；本次沿用注册方式。

| 范围 | 职责 | owner 任务 |
|---|---|---|
| `server/src/modules/media/storage/` | 本地/COS 字节、版本、Range、multipart；不决定业务权限 | 1 |
| `server/src/entities/`、`database/` | 持久定位、上传会话、迁移探针 | 2 |
| `server/src/modules/media/` 现有服务 | 媒体校验、引用、兼容上传与读取 | 3、5、6，顺序集成 |
| `server/src/modules/media/uploads/` | 会话、临时授权、恢复、发布任务和临时清理 | 4、5 |
| `server/src/modules/media/delivery/`、`deploy/cos/` | PC预览、批量精确签票、COS短链和配置预检 | 6、7 |
| `web/src/services/media-*`、现有媒体组件 | 上传状态与浏览器续传、URL 展示 | 8、9 |
| `mobile/src/api/media.ts`、`platform/`、相关 store | H5 简单直传与安全媒体 URL；保持小程序/实名兼容 | 10 |
| `server/src/modules/media/migration/`、`scripts/media/` | 只读清单、可续跑上传切换、回退 | 11 |
| `tests/`、`review/`、设计分册 | 隔离集成、真桶/浏览器/容量证据 | 各任务局部同步；12 总收口 |

### Astra 并行调度

用户明确要求“不经过 SDD”，覆盖 `.codex/skills/writing-plans/SKILL.md` 计划模板中的原句 `Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.`。保留该技能的计划结构，不继承其执行流程。采用稳定工作线复用 worker，不要求每个 Task 都新建执行者、再固定经过两轮逐任务审查。

先冻结共享类型、API 字段和文件 owner，再按“可开工”和“可完成验收”两种条件调度。接口已经冻结时，消费方可用合约 fixture 提前开发自己的独占文件，但后端未就绪前不能声称联调完成。

```text
Task 1 公共类型/配置字段先冻结
       ├─ Task 1 适配器与 env 配置 ─┐
       └─ Task 2 实体与 schema ────┴─> Task 3 双存储兼容
                                           |
                 +-------------------------+--------------------+
                 |                         |                    |
            Task 4 -> Task 5          Task 6 -> Task 7       Task 11 工具
            上传会话/发布清理          读取授权/COS预检        清单可先做
                 |                         |                apply 竞争验证等 5
                 +----------+--------------+
                            |
                +-----------+--------------+
                |                          |
           Task 8 -> Task 9            Task 10 移动端
           PC 上传再接读取               H5/小程序适配
                +-----------+--------------+
                            |
                 Task 12 全链验收和交付（同时汇入 Task 11）
```

硬依赖及并行边界：

- Task 2 不必等待 Task 1 全部 COS 实现，但必须先拿到 Task 1 冻结且可编译的公共类型；Task 3 等待 1、2 都完成。Task 1 的类型交付是其内部检查点，不新增独立业务任务或空壳服务。
- Task 3 之后，Task 4、Task 6、Task 11 清单/工具开发可以并行；共享 `MediaService` 的接线修改交根顺序整合。
- Task 5 等 4；Task 7 的签名/CORS预检等 6，可与 5 并行；G0 最终验证还须使用 5 发布出的正式对象，早期云端只读检查不受此限制。
- Task 8 的真实联调等 4、5；Task 9 等 8、6，两个 PC 任务由同一个 Web owner 顺序完成，禁止同时编辑共同文件。Task 10 的真实联调等 4、5、6；前端合约测试可先于真云 G0 完成。
- Task 11 的清单和 manifest 逻辑可在 2、3 后完成；apply/回退的并发验收还需与 Task 5 最终清理行为一起验证。真实迁移另受 G0 和实际批次授权约束。
- Task 12 的容量脚本、测试数据与验收结构可以提前准备；最终交付仍等待全部实现和相应真实验收证据。

当前会话上限为 4 个活跃代理，包含根；执行时重新核对实际容量。以下按根加最多 3 个子代理安排，批次只是初始排程，依赖先满足者先推进，不等待整批一起结束：

| 阶段 | 执行槽 A | 执行槽 B | 执行槽 C | 根的整合点 |
|---|---|---|---|---|
| 契约启动 | Task 1 先交公共类型，再继续适配器 | 类型冻结后开始 Task 2 | 按需只读核对云端配置条件，不操作真实桶 | 固定输入、接口、迁移号和写入归属 |
| 基础接入 | Task 3 | 预备 Task 6 合约 fixture | 预备 Task 11 manifest 测试 | 1/2 注册整合、双存储兼容结果 |
| 三线展开 | Task 4 → Task 5 | Task 6 → Task 7 | Task 11 清单/工具，5 就绪后补竞争验收 | 上传/读取公共入口、E2E 注册和 G0 条件 |
| 客户端并行 | Web owner：Task 8 → Task 9 | Mobile owner：Task 10 | 已就绪的 G0/迁移验证，或独立安全审查 | API 合约读回、CSP/域名和前端接线 |
| 收口 | 按失败归属修复 | tester 执行独立验收/容量记录 | reviewer 审查固定候选差异 | Task 12 证据归并、发布/迁移批次与回退 |

某工作线因云授权、域名或供应商条件等待时，先报告准确阻碍和已完成部分，释放执行槽，让其它已就绪任务继续；不把未通过 G0 写成完成。角色按当时生效的 `.codex/agents/*.toml` 和工具能力选择，不照抄旧 Skill 示例模型、不修改用户模型配置。

### 文件唯一写入者与整合约定

下文 Task 的 Files 是“最终影响文件”，并不授权同一批的所有执行者同时修改这些文件。分配时采用以下唯一写入者；跨 owner 变更由需要方给出最小修改说明/补丁，根安排顺序合入，不并行覆盖。

| 文件范围 | 唯一写入者/顺序 | 其它工作线交付方式 |
|---|---|---|
| `storage/**`、`scripts/backend-env.mjs`、server 依赖锁 | 存储 owner（Task 1） | 消费冻结端口，不复制存储实现 |
| 媒体 entity、init、新 SQL、schema 测试 | 数据 owner（Task 2） | 新字段或状态变更由根裁决后交 owner |
| `uploads/**`、对应测试 | 上传 owner（Task 4 → 5）；Task 2 建立的 contract 冻结后只经根同意修改 | 消费方使用接口 fixture |
| `delivery/**`、`deploy/cos/**`、对应测试 | 读取 owner（Task 6 → 7） | 提交独占文件及共享接线补丁 |
| `app.module.ts`、`media.service.ts`、`tasks.service.ts`、`tests/run-e2e.mjs` | 根维护集成工作副本；Task 3 核心改动先整体合入，4/5/6/11 增量排队 | 子代理完成主体实现并给出精确接线改动；根不代写整条业务线 |
| `configuration.ts`、`deploy/.env.example`、`deploy/nginx/default.conf` | 根在 Task 1/6/7/12 检查点合入 | 各 owner 提交新增键/验证规则，避免互改配置格式 |
| `web/src/api/media.ts`、`MediaUpload.vue`、auth store、其它 PC 消费者 | 同一个 Web owner 顺序执行 Task 8 → 9 | 不因 Task 编号不同而换人同时写同一文件 |
| `mobile/**` 本任务文件 | Mobile owner（Task 10） | 只消费后端已冻结协议 |
| `migration/**`、迁移 CLI、专用测试/runbook | 迁移 owner（Task 11） | E2E 公共注册交根 |
| `docs/design/**`、`AGENTS.md`、共享冻结契约 | 根在契约冻结/最终收口合并 | 各 owner 返回需更新条款，保持并行题库改动 |
| 真 `.env`、实际云配置、迁移批次 | 根在已有授权范围内统一操作 | 子代理开发工具/模板，默认不读取真实凭据、不自行操作云资源 |

每条线交付：任务/候选提交、精确文件、提供/消费的接口、已跑命令与结果、未验证边界。根检查后发布为下游可用输入。公共注册合入后才跑依赖应用装配的 E2E，不能用孤立类测试冒充集成完成。

测试继续按任务风险执行，但不设置每任务人工确认门。后端发布/清理与访问授权形成可运行候选（Task 5/6）后安排一次独立审查，可与前端独占文件开发并行；最终 Task 12 再审查整合候选和实际证据。reviewer 必须审固定差异，不能复用该改动的实现者；其占用计入并发预算。无需每个小 Task 固定派 reviewer 或反复更换 worker。

两个上线门：**G0** 为 Task 7 的应用前缀约束、客户端临时授权/GET签名范围、签名范围/到期与 Range，**G1** 为 Task 12 的迁移和实际业务验收。G0 不要求共用的长期密钥无法读取 gooodwork 范围。G0 未满足时可做独立代码和自动化，但不启用真实COS分发、不把代理读取称为带宽分流成功。

### 本地配置入口

| 位置 | 约定 |
|---|---|
| 根 `.env` | 两边相同的 `COS_SECRET_ID/COS_SECRET_KEY`、桶/地域，以及 RuleExam 自己的 `COS_KEY_PREFIX`、`MEDIA_STORAGE_PROVIDER`、短链有效期和上传参数；真实文件不提交 |
| `deploy/.env.example` | 同步所有新增键名、空占位和说明，不包含真实密钥 |
| `scripts/backend-env.mjs` | 保留原有 init/check；新增 `import-cos --from-env <明确源路径>`，原子合并白名单并保持已有 `.env` 其他配置 |
| 后端本地启动 | 沿用 `npm --prefix server run start:local`，应用仍只读 `process.env` |
| 本地检查/迁移 | 从仓库根使用 `node --env-file=.env scripts/media/cos-preflight.mjs --inspect` 和 `node --env-file=.env scripts/media/migrate-local-to-cos.mjs --plan ...` |
| 前端 | 只使用公开的精确COS域名/正式前缀配置；`COS_SECRET_*` 不进入 `VITE_*` 或构建产物 |

导入白名单固定为 `COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION`，明确的源文件必须同时具备 SecretId/SecretKey，缺少一项即整次失败，不做半写；桶/地域在源文件中存在才合并，否则保留目标已有值并交 `env:check` 检查完整性。不得复制 gooodwork 的 `COS_KEY_PREFIX`、DB/JWT/加密配置或整份环境文件；RuleExam 前缀单独维护。导入只复制已有值，不生成或轮换 COS 密钥；重复导入相同值无变更。当前已存在 `.env` 时也必须支持该合并步骤，不能只依赖遇到已有文件就退出的 `env:init`。显式进程环境优先级沿用 Node 行为，检查报告只显示键名/状态/被覆盖情况，不显示值。

执行前用隔离 worktree 固定输入。主工作区目前存在并行题库/UI/设计改动，不能直接拷贝全部脏文件进执行分支；需要的未提交依赖先由根确认候选范围。所有提交仅显式路径、仅本地，不自动 push。

## 跨任务接口冻结

下列契约在 Task 1/2/4 创建；后续任务使用同名接口，不重新设计。ID 均为字符串，时间在 API 中用 ISO 字符串、数据库用 DATETIME(3)。

```ts
// server/src/modules/media/storage/media-storage.port.ts
import type { Readable } from 'node:stream';
type StorageLocator = { provider: 'local' | 'cos'; key: string;
  bucket: string | null; region: string | null; versionId: string | null };
type StoredObject = { locator: StorageLocator; sizeBytes: number; mimeType: string;
  etag: string | null; crc64: string | null };
type UploadedPart = { partNumber: number; etag: string; sizeBytes: number };
interface MediaStoragePort {
  stat(locator: StorageLocator): Promise<StoredObject>;
  open(locator: StorageLocator, range?: { start: number; end: number }): Promise<Readable>;
  putFile(locator: StorageLocator, filePath: string, mimeType: string): Promise<StoredObject>;
  remove(locator: StorageLocator): Promise<void>; // 指定版本；确实不存在视为成功
}
// server/src/modules/media/storage/cos-upload.port.ts（仅 COS 适配器）
interface CosUploadPort {
  begin(locator: StorageLocator, mimeType: string): Promise<{ uploadId: string }>;
  parts(locator: StorageLocator, uploadId: string): Promise<UploadedPart[]>;
  complete(locator: StorageLocator, uploadId: string, parts: UploadedPart[]): Promise<StoredObject>;
  abort(locator: StorageLocator, uploadId: string): Promise<void>;
  removeStagingVersions(locator: StorageLocator): Promise<void>; // 仅会话登记的准确临时键
}
```

```ts
// server/src/modules/media/uploads/media-upload.contract.ts
type UploadState = 'uploading' | 'finalizing' | 'completed' | 'failed' | 'aborted' | 'expired';
type UploadInit = { client_request_id: string; purpose: MediaUploadPurpose; owner_id?: string;
  filename: string; mime_type: string; size_bytes: number; fingerprint_sha256: string };
type UploadResult = { asset_id: string; status: 'ready'; duration_ms: number | null };
type UploadSessionView = { session_id: string; state: UploadState; mode: 'simple' | 'multipart';
  expires_at: string; part_size: number; parallel_limit: number; parts: UploadedPart[];
  result: UploadResult | null; reason_code: string | null };
type UploadGrant =
  | { mode: 'simple'; method: 'PUT'; url: string; headers: Record<string,string>; expires_at: string }
  | { mode: 'multipart'; bucket: string; region: string; key: string; upload_id: string;
      credentials: { tmp_secret_id: string; tmp_secret_key: string; token: string };
      start_time: number; expired_time: number };
// 以上临时授权只返回给当前上传主体；不入客户端持久缓存或日志。
```

小文件复用 gooodwork 的 HTTP 指令方式；大文件才使用 STS + SDK multipart 原语。客户端不合并分块，不接收全桶/正式对象写权限。新增错误沿用现有 HTTP/业务码分类，在 `data.reason_code` 中区分上传过期、冲突、校验失败；不随意占用已有错误码。

## Task 1: 存储端口、运行配置与 COS 适配器

**Files:** Create `server/src/modules/media/storage/media-storage.port.ts`、`server/src/modules/media/storage/cos-upload.port.ts`、`server/src/modules/media/storage/local-media-storage.ts`、`server/src/modules/media/storage/cos-media-storage.ts`、`server/src/modules/media/storage/media-storage.router.ts`、`server/src/modules/media/storage/cos-media.config.ts`；Modify `server/src/config/configuration.ts`、`server/src/app.module.ts`、`server/package.json`、`server/package-lock.json`、`scripts/backend-env.mjs`、`deploy/.env.example`；Test `server/test/media-storage.spec.ts`、`server/test/media-cos-config.spec.ts`，extend `tests/backend-env.test.mjs`。实施时修改根 `.env` 的本地值，但该文件始终不暂存、不提交。

**Interfaces:** Produces 上述两个端口、`MediaStorageRouter.forLocator(locator:StorageLocator):MediaStoragePort`、`readCosMediaConfig(env:NodeJS.ProcessEnv):CosMediaConfig`；`CosMediaConfig` 在 `cos-media.config.ts` 导出，字段为 `provider:'local'|'cos'`、`bucket/region/keyPrefix/secretId/secretKey:string|null`、`sessionToken:string|null`，cos 分支要求前五项非空。COS 实现必须分页处理 parts/versions，只能访问配置前缀；本地实现保留现有安全相对路径检查。

`scripts/backend-env.mjs` 新增 `importLocalCosEnv(root:string,sourceEnvPath:string):Promise<{changed:boolean;keys:string[]}>`，返回键名而不是值；扩展现有 `inspectBackendEnv` 检查 COS 模式必填项、前缀及来源覆盖情况。CLI 为 `node scripts/backend-env.mjs import-cos --from-env <明确源路径>`；源文件不得与目标相同，不追随未声明的其它配置文件，使用同目录临时文件、0600 与原子替换，保持非目标键和原值。

- [x] **Step 1 — 固定基线和失败用例。** 记录当前媒体测试结果，不把已有失败算成本任务新增；创建 `cos_requires_complete_config`：`expect(() => readCosMediaConfig({ MEDIA_STORAGE_PROVIDER:'cos' })).toThrow()`；`local_still_reads_legacy_key` 验证旧键按字节读取；`version_is_used_for_stat_open_delete` 验证三个操作均携带相同 versionId；`rejects_foreign_prefix` 验证适配器未发出 SDK 请求，而不是假设共享密钥本身没有跨项目前缀权限。环境工具增加 `cos_import_merges_existing_env`、`cos_import_missing_pair_is_atomic`、`cos_import_does_not_copy_other_secrets_or_prefix`、`cos_import_is_idempotent_and_private`，断言只合并四个白名单键、保留原配置、重复执行无变化、0600、输出无值；测试只使用临时目录和不可用于真实服务的测试数据。
- [x] **Step 2 — 确认新用例失败。** `npm --prefix server test -- test/media-storage.spec.ts test/media-cos-config.spec.ts` 和 `node --test tests/backend-env.test.mjs`；失败须来自尚未实现的新端口/配置合并，而非环境或旧基线。
- [x] **Step 3 — 实现端口和配置。** 安装精确版本 `npm install --prefix server --save-exact cos-nodejs-sdk-v5@3.0.0 qcloud-cos-sts@3.1.3`（2026-10-26 从 npm 元数据核实）；所有供应商调用封装于 adapter。配置键固定为 `MEDIA_STORAGE_PROVIDER`、`COS_BUCKET/REGION/KEY_PREFIX/SECRET_ID/SECRET_KEY/SESSION_TOKEN`；`COS_SECRET_ID/COS_SECRET_KEY` 复用 gooodwork 原值，通过上述白名单导入根 `.env`，不生成新的长期身份或密钥。将新增媒体参数接入 `deploy/.env.example`、已有本地 env 初始化/检查和 `start:local`；有配置的现存 `.env` 采用合并，不覆盖 JWT/DB/实名参数。local 为默认，cos 缺必填项即拒绝；无论默认驱动是什么，router 始终能读 local 历史行。`open` 流式且支持精确单段 Range，禁止整视频 Buffer；COS-only SDK 不在前端使用。
- [x] **Step 4 — 验证。** 重跑 Step 2，要求通过；另跑 `npm --prefix server run build`，要求退出 0。单测只用 SDK stub，不连接真实桶。
- [x] **Step 5 — 本地提交。** 仅暂存本任务代码、模板和测试，明确排除真实 `.env`，确认 `git check-ignore .env` 命中；提交 `feat(media): 添加本地与 COS 存储适配`。

## Task 2: 媒体定位字段、上传会话与可续跑迁移

**Files:** Modify `server/src/entities/media-asset.entity.ts`、`database/init.sql`、`server/src/app.module.ts`、`docs/design/03-数据库设计.md`、`docs/design/README.md`、`AGENTS.md`、`tests/run-e2e.mjs`；Create `server/src/entities/media-upload-session.entity.ts`、`server/src/modules/media/uploads/media-upload.contract.ts`、`database/migrations/030_cos_media_storage.sql`、`tests/cos-media-migration.test.mjs`、`tests/cos-media-schema.mjs`；extend `tests/migration-catalog.test.mjs`。

**Interfaces:** Produces `MediaUploadSession` entity；原 `MediaAsset` 增量字段 `storageProvider`、`cosBucket`、`cosRegion`、`cosVersionId`、`etag`、`crc64`。执行时已核验并选定 030；主工作区并行 029 保留，不复制到本分支。迁移运行器允许编号空缺。

- [x] **Step 1 — 写 schema 失败用例并绑定编号。** 新字段使用 provider VARCHAR(16) NOT NULL DEFAULT 'local'，bucket VARCHAR(255)、region VARCHAR(64)、version VARCHAR(255)、etag VARCHAR(255)、crc64 VARCHAR(64) 均 nullable。会话含 UUID PK、owner/uploaded_by BIGINT、request UUID、request_digest CHAR(64)、用途/原名/声明类型/大小/指纹、staging locator、uploadId、state、expiresAt、lastCredentialExpiresAt、claimId/leaseUntil、候选对象 JSON、assetId/receipt JSON、错误和时间戳。唯一键 `(uploaded_by, client_request_id)`；队列/清理索引覆盖 state+lease/expiry。断言旧行仍为 local、原 ID/引用不变、重复 request 冲突、无外键、漂移探针拒绝缺列或错误索引。
- [x] **Step 2 — 验证失败。** `node --test tests/cos-media-migration.test.mjs tests/migration-catalog.test.mjs`；新 DDL/探针断言失败。
- [x] **Step 3 — 实现增量 DDL/entity。** 复用 `database/migrate.mjs` 的 `@step/@check` 协议，禁止改旧 SQL；上传正文 SHA 仍在真正创建媒体时填入，不使用全零占位。完成回执 30 天后清除大字段，但保留最小 request tombstone，旧请求返回过期而不是再创建。新增一张业务表后同步当前表数与注册清单。
- [x] **Step 4 — 验证。** 重跑 Step 2，`npm --prefix server test -- test/schema-migration.spec.ts`；把新增脚本注册为 `cos-media-schema`，运行 `node tests/run-e2e.mjs --ephemeral --suite cos-media-schema`，在临时 MySQL 中验证首次应用、部分完成续跑及重复应用；生产数据库不在本步骤内。
- [x] **Step 5 — 本地提交。** 显式列出已确定 N 的迁移和本任务文件，提交 `feat(media): 增加 COS 定位与上传会话存储`。

## Task 3: 将现有媒体服务接到双存储，保持兼容入口

**Files:** Modify `server/src/modules/media/media.service.ts`、`server/src/modules/media/media.controller.ts`、`server/src/modules/media/media-ticket.controller.ts`、`server/src/modules/system/system.controller.ts`、`server/src/app.module.ts`；Create `server/src/modules/media/media-content.response.ts`、`server/src/modules/media/media-publisher.service.ts`；Test `server/test/media-storage-integration.spec.ts`，extend `server/test/media-lifecycle.spec.ts`、`server/test/identity-image.spec.ts`。

**Interfaces:** Consumes Task 1/2。`media-publisher.service.ts` 导出 `PublishMediaFileInput={filePath:string;locator:StorageLocator;expectedSha256:string;mimeType:string}` 和 `MediaPublisher.publishVerifiedFile(input:PublishMediaFileInput):Promise<StoredObject>`。`media.service.ts` 导出 `ReadyMediaInput={ownerId:string;uploadedBy:string;purpose:MediaPurpose;mediaKind:'image'|'video';originalName:string|null;object:StoredObject;sha256:string;durationMs:number|null}`，提供 `createReadyAsset(manager:EntityManager,input:ReadyMediaInput):Promise<MediaAsset>`；`MediaContentDescriptor={asset:MediaAsset;size:number;range:ByteRange|null;stream:Readable}`。`sendMediaContent(res:Response,descriptor:MediaContentDescriptor):void` 在共享响应文件导出。新增 `MediaService.assertUploadAllowed(actor:AuthUser,purpose:MediaUploadPurpose,ownerId?:string):Promise<{ownerId:string}>` 供原入口与 Task 4 共用；Purpose/ByteRange 直接引用现有 `media-policy.ts`。

- [x] **Step 1 — 写失败用例。** `cos_upload_preserves_owner_and_probe`：正文探测失败 `expect(readyAssets).toHaveLength(0)`；`mixed_drivers_read_by_row`：全局 cos 下 local 历史文件仍可读；`identity_uses_private_bounded_read`：实名大于 10 MiB 拒绝；`range_and_disconnect_release_stream`：206/416 及客户端断开关闭流。
- [x] **Step 2 — 验证失败。** `npm --prefix server test -- test/media-storage-integration.spec.ts test/media-lifecycle.spec.ts test/identity-image.spec.ts`。
- [x] **Step 3 — 实现兼容路径。** 原 Multer/实名预处理继续使用本地临时文件，校验后按配置写正式对象；读取/删除按资源行 router 分发。实际内容探测复用 `MediaProbeService`，正式写入从同一已校验文件取字节，回读 SHA 相等后才 ready。替换所有 descriptor.path/sendFile 消费点为共享流响应，保持原 Cache-Control、Content-Type、Range、授权与错误语义。头像代传、media:write 检查共用 `assertUploadAllowed`，不能让新路径更宽松。
- [x] **Step 4 — 验证。** 重跑 Step 2；`node tests/run-e2e.mjs --ephemeral --suite training-media`、`node tests/run-e2e.mjs --ephemeral --suite mobile-identity` 均通过。
- [x] **Step 5 — 本地提交。** 仅本任务文件，`refactor(media): 复用受控媒体链路支持双存储`。

## Task 4: 上传会话 API、临时授权和断点对账

**Files:** Create `server/src/modules/media/uploads/media-upload-session.service.ts`、`server/src/modules/media/uploads/media-upload-session.controller.ts`、`server/src/modules/media/uploads/media-upload-grant.service.ts`、`server/src/modules/media/uploads/media-upload.dto.ts`；Modify `server/src/app.module.ts`、`server/src/modules/media/media.service.ts`（limits 增量能力）、`docs/design/04-API设计.md`；Test `server/test/media-upload-session.spec.ts`、`server/test/media-upload-grant.spec.ts`。

**Interfaces:** `MediaUploadSessionService.begin(actor:AuthUser,input:UploadInit):Promise<UploadSessionView>`；`status/complete/cancel(actor:AuthUser,id:string):Promise<UploadSessionView>`；`MediaUploadGrantService.issue(actor:AuthUser,id:string):Promise<UploadGrant>`。固定采用设计 §5.2 的五个端点。`/media/limits` 增加 `upload_mode:'proxy'|'direct'`、`multipart_threshold_bytes`、`part_size_bytes`、`parallel_limit`、`upload_session_ttl_seconds`，旧字段保留；local 模式前端继续旧代理上传。

- [x] **Step 1 — 写失败用例。** `begin_replay_is_one_session`：同请求返回同 ID、换文件返回冲突；`wrong_actor_cannot_restore`：403；`grant_is_exact_staging_object`：资源策略只含当前键，multipart 仅 UploadPart/ListParts，simple 仅 PUT 指令；`expired_grant_keeps_upload_id`：重取凭证仍同 UploadId；`complete_unknown_is_reconciled_by_get`：不新建会话；`parts_are_read_from_cos`：忽略客户端虚报已上传片。
- [x] **Step 2 — 验证失败。** `npm --prefix server test -- test/media-upload-session.spec.ts test/media-upload-grant.spec.ts`。
- [x] **Step 3 — 实现服务/API。** 创建行后由服务端初始化 multipart 并记录 UploadId，过程有幂等 claim；初始化结果不明先按准确临时键对账，额外任务登记后清理，不能把未知结果当作已成功。GET 完整分页查询 parts；complete 由服务端按连续序号、期望大小及 COS 结果合并，并在状态锁下进入 finalizing。simple complete HEAD 只检查传输形状，内容校验交 Task 5。状态/大小/当前权限/主体每次检查；临时授权默认 1800 秒且不超会话到期，供应商不接受剩余短时长时拒绝签发并返回会话过期原因，持久记录最后已签授权截止时间。控制器静态路径先于 `:id` 路由注册，不改变普通媒体路由匹配。
- [x] **Step 4 — 验证。** 重跑 Step 2、`npm --prefix server run build`；以真实临时数据库验证唯一键竞态，云端用 stub；全程不输出 Grant 中凭据。
- [x] **Step 5 — 本地提交。** 显式本任务文件，`feat(media): 添加可恢复上传会话与临时授权`。

## Task 5: 异步正文校验、唯一发布与生命周期清理

**Files:** Create `server/src/modules/media/uploads/media-upload-finalizer.service.ts`、`server/src/modules/media/uploads/media-upload-cleanup.service.ts`；Modify `server/src/modules/media/uploads/media-upload-session.service.ts`、`server/src/tasks.service.ts`、`server/src/app.module.ts`、`server/src/modules/media/media.service.ts`；Test `server/test/media-upload-finalizer.spec.ts`、`server/test/media-upload-cleanup.spec.ts`；Create `tests/media-upload-races.mjs` 并注册到 `tests/run-e2e.mjs`。

**Interfaces:** `MediaUploadFinalizerService.runOnce(limit=2):Promise<{completed:number;failed:number}>`；`MediaUploadCleanupService.runOnce(now:Date):Promise<{cleaned:number;deferred:number}>`。消费 Task 1/3/4；产出 completed.result 或稳定失败原因。DB claim 初始 lease 120 秒、每 30 秒续租；丢失 claim 即不得提交，重试最多 5 次，内容不合法立即终态失败。

- [x] **Step 1 — 写失败用例。** `staging_rewrite_cannot_change_published_bytes`：正式 SHA 等于实际探测文件；`stale_claim_cannot_publish`：旧 claim 影响行数为 0；`lost_complete_reply_returns_same_asset`：唯一资产；`finalizing_rejects_cancel`：返回当前 finalizing，不删候选；`late_put_after_cancel_is_collected`：最后凭证过期前 deferred；`referenced_version_is_not_deleted`：删除请求 0；`expired_receipt_does_not_recreate`：旧 request tombstone 拒绝创建。
- [x] **Step 2 — 验证失败。** `npm --prefix server test -- test/media-upload-finalizer.spec.ts test/media-upload-cleanup.spec.ts`。
- [x] **Step 3 — 实现。** claim 获取后先提交事务，再进行有上限的 COS 下载/探测/正式写入/回读；不要持 DB 锁等云 I/O。每个 claim 使用独立候选键并在候选 JSON 中登记，最终事务核对 claim 和状态，创建一个媒体资源并写回执。崩溃后先核对候选，不覆盖已发布键。清理保护活跃 lease、正式引用和实名事实；取消/过期的最后清理晚于 `lastCredentialExpiresAt` 并再扫迟到版本。只有准确临时键可清除所有版本；正式对象只删登记版本。现有 deleting 失败重试继续有效。
- [x] **Step 4 — 验证。** 重跑 Step 2；`node tests/run-e2e.mjs --ephemeral --suite media-upload-races` 验证两个独立服务实例共享真实仓储的 complete/取消/过期 claim 竞争；只替代 COS 和探测外设，不 mock 事务锁。
- [x] **Step 5 — 本地提交。** 本任务文件，`feat(media): 实现上传校验发布与回收恢复`。

## Task 6: 与 gooodwork 一致的受控 COS 短链

**Files:** Create `server/src/modules/media/delivery/media-delivery.contract.ts`、`media-delivery.service.ts`、`media-delivery.controller.ts`、`pc-media-ticket.service.ts`、`cos-download-url.adapter.ts`；Modify `server/src/modules/media/media-ticket.service.ts`、`media-ticket.controller.ts`、`server/src/modules/system/system.service.ts`、`system.controller.ts`、`server/src/app.module.ts`、`server/src/config/configuration.ts`、`deploy/.env.example`；Test `server/test/media-delivery.spec.ts`、`media-download-url.spec.ts`、`pc-media-ticket.spec.ts` 及既有票据测试。

**Interfaces:** `MediaTicketView={content_url:string;expires_at:string}`；批量请求 `MediaTicketRequest={asset_id:string;owner_type:string;owner_id:string}`，结果保留 `index`、原三元组、`ticket|null` 与受控 `error|null`。`MediaDeliveryService.issuePreview(actor,assetId)`、`issueLearnerBatch(actor,items)`；`AppConfig.mediaDelivery={mode:'proxy'|'cos-signed',readUrlTtlSeconds,videoUrlTtlSeconds}`，两个TTL默认300，范围1—3600。CosDownloadUrlAdapter只在后端调用SDK本地签名，不调用EdgeOne或额外STS。

- [x] **Step 1 — 失败用例。** 同asset不同item逐项授权；PC与learner票据域隔离；纯timeout/在考解析/撤销引用拒绝新签；品牌移除拒绝跳转；identity不得取得COS直链。真实SDK本地签名包含精确VersionId、固定HTTPS桶域名、受限TTL和Cache-Control，URL无SecretKey/JWT。
- [x] **Step 2 — 跑失败用例。** 新单测在旧实现失败，不能以mock返回URL代替真实SDK签名检查。
- [x] **Step 3 — 实现。** `POST /media/:assetId/preview-ticket`（PC Bearer）、`POST /media/tickets/batch`（mobile，最多50项）；既有learner签票复用相同owner policy。PC proxy内容路径 `/media/preview-tickets/:ticket/content`，重读核对当前账号/authVersion/jti/sid/权限。COS签发先授权但不下载对象正文，准确版本通过SDK实际Query签入URL。品牌沿用 `/site-config/assets/:id/content`，每次白名单检查后307至短链，跳转no-store。local/identity仍原受控代理。Cos-signed模式已发URL到期前有效，禁止再宣称每个COS请求实时重查业务状态。
- [x] **Step 4 — 验证。** 相关单测/build与隔离 `mobile-media-ticket`；静态路径优先注册，严格DTO检查原始body防全局pipe提前剥字段。完整签名URL不入日志/业务数据库/作者JSON。
- [x] **Step 5 — 本地提交。** 提交本任务代码及根统一的契约文档；不宣称真实COS或长视频验收。

## Task 7: COS 共桶预检、配置提案与 G0

**Files:** Create `scripts/media/cos-preflight.mjs`、`deploy/cos/policy.template.json`、`deploy/cos/cors.template.json`、`deploy/cos/README.md`、`tests/cos-preflight.test.mjs`、`review/2026-10-26-cos-cloud-gates.md`；按确定的桶域名更新部署CSP提案。无EdgeOne函数、内部远程鉴权API或新媒体域名。

**Interfaces:** CLI 默认 `--inspect` 只读；`--render-proposal` 输出受控配置建议，绝不自动apply。真实写探针需显式 `--probe` 且限本项目专用临时前缀，不修改桶策略。入口统一 `node --env-file=.env scripts/media/cos-preflight.mjs ...`；输出不得含密钥、临时凭据、完整签名或实名字节。

- [x] **Step 1 — 失败用例。** 默认仅只读SDK调用；现有CORS/策略保留、不用模板覆盖；目标前缀/域名校验；错误脱敏；探针只作用登记的临时对象和准确版本。
- [x] **Step 2 — 跑失败用例并实现预检。** 查询实际桶/地域/ACL/版本/CORS/策略可读性，STS与真实签名能力未运行时明确待验。仅按真实RuleExam页面来源追加必要CORS建议，精确允许内容头/Range/分块ETag，不把全桶公开读当作方案。不新建长期密钥或更改gooodwork既有身份权限。
- [x] **Step 3 — 形成具体配置差异。** 列出COS标准域名、页面origin、CSP img/media/connect与小程序合法域名；保留原桶规则。真实配置变更先交可审阅差异，在已有授权范围内执行必要验证。
- [ ] **Step 4 — G0。** 真桶验证simple/multipart、实际版本定位、浏览器临时授权拒绝其它键、准确GET签名到期/Range200/206/416及CORS；去除签名直接读私有对象拒绝。读取只在申请/续签授权，旧链接有效窗口如实登记。保留gooodwork规则。
- [x] **Step 5 — 本地提交。** 提交工具/模板/脱敏证据，真实配置不足项标待验，不用单测冒充真云，不提交探针清单或签名。

## Task 8: PC 统一上传、进度、暂停和恢复

**Files:** Create `web/src/services/media-upload.ts`、`web/src/services/media-upload-resume.ts`、`web/src/workers/media-fingerprint.worker.ts`；Modify `web/src/api/media.ts`、`web/src/components/MediaUpload.vue`、`web/src/components/media-upload-state.ts`、`web/src/stores/auth.ts`、`web/package.json`、`web/package-lock.json`；Test `web/src/services/__tests__/media-upload.spec.ts`、`web/src/services/__tests__/media-upload-resume.spec.ts`，extend `web/tests/media-upload-component.test.mjs`、`web/tests/media-upload-state.test.mjs`。

**Interfaces:** 保留现有 `uploadMedia(file:File,purpose:MediaPurpose,options?:MediaUploadOptions):Promise<MediaUploadResponse>`；新增 `createMediaUploadTask(file:File,purpose:MediaPurpose,options?:MediaUploadOptions):MediaUploadTask`。`media-upload.ts` 导出 task 的 `result:Promise<MediaUploadResponse>`、`pause():void`、`resume():Promise<void>`、`cancel():Promise<void>`、`subscribe(listener:(value:UploadTaskSnapshot)=>void):()=>void`；snapshot 为 `{state:'hashing'|'uploading'|'paused'|'finalizing'|'ready'|'error'|'cancelled';progress:number}`。Worker 暴露 `fingerprintFile(file:File,signal?:AbortSignal):Promise<string>`。`media-upload-resume.ts` 定义 `ResumeRecord={userId:string;sessionId:string;requestId:string;fingerprint:string;sizeBytes:number;expiresAt:string}` 和 `ResumeStore.get(userId:string,fingerprint:string):Promise<ResumeRecord|null>`、`put(record:ResumeRecord):Promise<void>`、`remove(userId:string,sessionId:string):Promise<void>`；epoch 只作当前页面并发保护，不作为刷新后恢复的持久匹配键。

- [x] **Step 1 — 写失败用例。** `refresh_reselect_same_file_resumes_missing_parts`：不重传已校验分块；`same_name_different_bytes_does_not_resume`；`credentials_expire_keep_session_and_parts`；`logout_late_response_cannot_bind`；`cancel_does_not_clear_saved_course_asset`；`progress_100_waits_for_ready`：上传完但 finalizing 时禁止保存；`unknown_complete_queries_before_retry`。
- [x] **Step 2 — 验证失败。** `npm --prefix web test -- src/services/__tests__/media-upload.spec.ts src/services/__tests__/media-upload-resume.spec.ts`。
- [x] **Step 3 — 实现。** 精确依赖 `npm install --prefix web --save-exact cos-js-sdk-v5@1.10.1 @noble/hashes@2.4.0`（已查询 npm 元数据）；SDK 只调用 UploadPart/ListParts 等已授权原语，后端负责 init/complete。简单模式按 HTTP 指令 PUT。续传缓存用 IndexedDB，凭据/签名/文件正文不持久化；用内容指纹匹配原会话、GET 作为 parts 真相。对 auth store 增加媒体任务 epoch（账号切换/登出增加，普通刷新不增加），清理旧任务和迟到结果。MediaUpload 显示暂停/继续/重试/取消/校验中；未 ready 不触发成功绑定；local 模式保持原代理逻辑。
- [x] **Step 4 — 验证。** 重跑 Step 2；`node --test web/tests/media-upload-component.test.mjs web/tests/media-upload-state.test.mjs`；从仓库根执行 `cd web && npx vue-tsc --noEmit`，均须退出 0，不新增第二份类型配置。
- [x] **Step 5 — 本地提交。** 本任务文件，`feat(web): 支持 COS 大视频上传与断点恢复`。

## Task 9: PC 图片、Tiptap 与已保存视频改用受控分发地址

**Files:** Create `web/src/services/media-content.ts`、`web/src/services/__tests__/media-content.spec.ts`；Modify `web/src/api/media.ts`、`web/src/components/MediaUpload.vue`、`web/src/components/CourseCover.vue`、`web/src/components/StudentAvatar.vue`、`web/src/components/QuestionPreview.vue`、`web/src/components/Tiptap/extensions/MediaImage.ts`、`web/src/layouts/MainLayout.vue`、`web/src/views/admin/SiteSettings.vue`；extend `web/src/components/Tiptap/__tests__/media-image.spec.ts`、`web/src/components/__tests__/course-cover.spec.ts`、`web/src/components/__tests__/manual-question-editor.spec.ts`。

**Interfaces:** `resolvePcMedia(assetId:string,signal?:AbortSignal):Promise<MediaTicketView>`、`resolvePublicBranding(assetId:string):string`；现有 Tiptap mediaResolver 返回展示 URL，持久内容仍只含 asset_id。URL 管理按当前账号 epoch、asset、用途隔离，临期/失败重新申请，不保存到作者 JSON。

- [x] **Step 1 — 写失败用例。** `tiptap_serialization_never_contains_signed_url`：JSON 只有 asset_id；`saved_video_preview_does_not_fetch_blob`：无 API 视频字节下载；`late_image_url_after_account_switch_is_ignored`；`removed_branding_is_not_kept_as_authorized_asset`；`image_retry_keeps_editor_selection`。
- [x] **Step 2 — 验证失败。** `npm --prefix web test -- src/services/__tests__/media-content.spec.ts src/components/Tiptap/__tests__/media-image.spec.ts src/components/__tests__/course-cover.spec.ts src/components/__tests__/manual-question-editor.spec.ts`。
- [x] **Step 3 — 实现。** PC 视频使用受控短票 URL 和原生 video，关闭/切换时停止播放；只有用户刚选的本地文件使用 Blob URL。题图/头像/封面改走地址 resolver；旧导出等确实需要 Blob 的调用保留兼容 helper，但不要让展示路径继续下载经 API 代理的字节。品牌 URL 使用配置媒体域名固定路径，proxy 模式保持现有公开接口；不扩大任意外链白名单。
- [x] **Step 4 — 验证。** 重跑 Step 2 和 `node --test web/tests/student-avatar-save.test.mjs web/tests/site-settings-state.test.mjs`，确认上传不等于业务保存、取消不更换已有资源。
- [x] **Step 5 — 本地提交。** 显式上述文件，`feat(web): 使用受控媒体地址展示图片与视频`。

## Task 10: H5 图片直传、移动端安全 URL 与批量题图

**Files:** Create `mobile/src/platform/media-upload.h5.ts`、`mobile/test/media-direct-upload.spec.ts`；Modify `mobile/src/api/media.ts`、`mobile/src/platform/media-url.ts`、`mobile/src/components/common/ProtectedImage.vue`、`mobile/src/stores/video.ts`、`mobile/src/stores/exam.ts`、`mobile/src/env.d.ts`；extend `mobile/test/media-api.spec.ts`、`mobile/test/media-url.spec.ts`、`mobile/test/video-session.spec.ts`、`mobile/test/rich-content.spec.ts`。

**Interfaces:** 保留 `uploadAvatar(file:PickedMedia)`、`getMediaTicket(assetId:string,ownerType:string,ownerId:string):Promise<MediaTicketView>`；新增 `uploadImageDirect(file:PickedMedia,purpose:'avatar'):Promise<UploadResult>`、`getMediaTickets(items:MediaTicketRequest[]):Promise<MediaBatchResult[]>`。前端契约在各自 `api/media.ts` 声明且用合约测试与 Task 4/6 对齐，不从服务端源目录跨项目 import。`safeMediaUrl/resolveMediaUrl` 支持原同源票据或精确 `VITE_COS_MEDIA_ORIGIN` HTTPS origin + `VITE_COS_MEDIA_PREFIX` 正式对象路径 + COS签名query白名单；品牌保留原同源站点配置路径，经后端白名单检查后跳转，不接受任意 query/host。

- [x] **Step 1 — 写失败用例。** `https_allowlisted_origin_only`：相似域名、userinfo、编码路径绕过均抛错；`h5_avatar_simple_put_has_no_bearer`：COS 请求不带业务 Authorization；`mp_and_identity_keep_existing_upload`；`batch_same_asset_wrong_item_is_denied`；`renewal_keeps_video_session_and_position`；`late_upload_after_epoch_change_is_discarded`。
- [x] **Step 2 — 验证失败。** `npm --prefix mobile run test:unit -- test/media-direct-upload.spec.ts test/media-api.spec.ts test/media-url.spec.ts test/video-session.spec.ts test/rich-content.spec.ts`。
- [x] **Step 3 — 实现。** H5 只从本次 picker 的临时文件读取 Blob，计算小图摘要并申请 simple HTTP 指令；业务 JSON 延续一次 401 刷新/epoch 规则，COS 失败不触发业务 refresh 循环。条件编译隔离 H5 上传，小程序/实名继续原 uni.uploadFile。考试按精确 item 批量签票，不跨题偷用许可；续票、切课时、切号保护沿用现有 store。后端返回的公网地址必须先过安全 URL 校验。
- [x] **Step 4 — 验证。** 重跑 Step 2，`npm --prefix mobile run type-check`；`node scripts/build.mjs mp-weixin` 验证 H5 专有代码未泄漏，不宣称真机通过。
- [x] **Step 5 — 本地提交。** 本任务文件，`feat(mobile): 接入受控 COS 图片上传与媒体分发`。

## Task 11: 存量媒体迁移清单、执行和逐条回退

**Files:** Create `server/src/modules/media/migration/media-storage-migration.service.ts`、`server/src/modules/media/migration/migration-manifest.ts`、`scripts/media/migrate-local-to-cos.mjs`、`server/test/media-storage-migration.spec.ts`、`tests/media-storage-migration.mjs`、`deploy/cos/migration-runbook.md`；Modify `tests/run-e2e.mjs`。

**Interfaces:** `migration-manifest.ts` 定义 `MigrationItem={assetId:string;purpose:string;source:StorageLocator;sha256:string;sizeBytes:number;updatedAt:string}`、`MigrationState='planned'|'uploaded'|'verified'|'switched'|'rolled_back'|'skipped'|'failed'`、`MigrationCheckpoint={item:MigrationItem;target:StorageLocator|null;state:MigrationState;verifiedSha256:string|null;reason:string|null}`。`MigrationManifest.get(assetId:string):Promise<MigrationCheckpoint|null>`、`save(value:MigrationCheckpoint):Promise<void>`；`MediaStorageMigrationService.plan():AsyncIterable<MigrationItem>`、`apply(item:MigrationItem,manifest:MigrationManifest):Promise<MigrationCheckpoint>`、`rollback(item:MigrationItem,manifest:MigrationManifest):Promise<MigrationCheckpoint>`。manifest 不含姓名、原件字节、签名或凭据。CLI 默认 `--plan`，显式 `--apply`/`--rollback` 与受控 `--manifest` 路径；无 delete-local 命令。

本地命令统一从仓库根用 `node --env-file=.env scripts/media/migrate-local-to-cos.mjs --plan --manifest <受控清单路径>`；apply/rollback 使用同一加载方式，仅切换动作参数。脚本只读取已加载的配置，不再要求把 COS 密钥写入 shell 配置，也不把 `.env` 或密钥复制到清单中。

- [x] **Step 1 — 写失败用例。** `missing_or_changed_source_is_reported_not_switched`；`crash_after_put_resumes_same_candidate`；`delete_race_does_not_resurrect_row`；`referenced_history_id_and_links_stay_equal`：前后引用集合全等；`rollback_requires_matching_local_sha`；`pdf_docx_rows_are_never_selected`；`new_cos_only_asset_cannot_claim_local_rollback`。
- [x] **Step 2 — 验证失败。** `npm --prefix server test -- test/media-storage-migration.spec.ts`。
- [x] **Step 3 — 实现。** plan 仅读取媒体表与文件元数据，ready 本地媒体逐条核验，processing 等待、failed/deleting/缺文件列异常。apply 先按 manifest 登记随机候选、上传和回读 SHA，再短事务锁行比对原 locator/sha/status 后切换。最终切换与后台删除复用资源行锁；复制期间允许正常业务删除，切换发现行消失/变更即跳过并回收候选，绝不复活资源，不新增长期迁移锁。manifest 原子写、权限 0600，根目录设为仓库外受控目录；恢复先对账 DB/COS/manifest，不盲目重复写；不删除本地副本。
- [x] **Step 4 — 验证。** 重跑 Step 2；`node tests/run-e2e.mjs --ephemeral --suite media-storage-migration` 测真实仓储竞争、崩溃恢复和回退。G0 前不执行真实迁移；之后先交只读清单和具体批次，再在用户授权范围内 apply。
- [x] **Step 5 — 本地提交。** 提交工具、测试和 runbook，不提交真实 manifest；`feat(media): 添加可核验可回退的存量迁移工具`。

## Task 12: 全链验收、容量基线与交付收口

**Files:** Create `tests/cos-media-flow.mjs`、`tests/cos-media-browser.spec.mjs`、`tests/performance/media-capacity.mjs`、`review/2026-10-26-cos-media-acceptance.md`；Modify `tests/run-e2e.mjs`、`tests/mobile-h5.mjs`（浏览器场景注册）、`docs/design/02-系统架构.md`、`docs/design/03-数据库设计.md`、`docs/design/04-API设计.md`、`docs/design/05-模块设计.md`、`docs/design/06-关键流程.md`、`docs/design/07-安全与非功能设计.md`、`docs/design/README.md`、`review/2026-10-22-learner-mobile-contract-freezes.md`、`AGENTS.md`、`deploy/nginx/default.conf`。

**Interfaces:** `cos-media-flow` 注册为隔离 E2E suite；浏览器用现有 mobile Playwright 依赖由根 harness 导入，不给仓库根新建 package.json。容量 CLI `--profile media|authz|exam|heartbeat --users 500|1000|3000 --duration-seconds N`，先只输出预计请求量/媒体字节量，显式 `--run` 才发压测请求；仅允许指定测试环境，不能默认生产。

- [x] **Step 1 — 写验收断言。** `import_upload_bind_play_roundtrip` 覆盖所有用途；`all_media_bytes_bypass_business_api_in_cos_signed_mode` 记录网络 host/字节来源；`resume_after_reload_keeps_one_asset`；`revocation_blocks_renewal_and_old_url_is_bounded`；`migration_then_history_and_identity_read_work`。包含旧 local 数据与新 COS 数据混合运行、小程序图片兼容和 PDF/DOCX 原件路径未变。
- [x] **Step 2 — 跑失败用例。** `node tests/run-e2e.mjs --ephemeral --suite cos-media-flow`、`node tests/run-e2e.mjs --ephemeral --suite mobile-h5`；按新断言修复集成差异，不能改变既有业务授权以消除失败。
- [ ] **Step 3 — 完成配置和文档同步。** CSP 仅追加确定的媒体域名/COS 上传连接来源，配置新域名的微信合法域名说明；更新 AD-06、表数/迁移目录、API/状态/数据流及验收边界。旧文档中“不引入对象存储”按批准设计更新，PDF/DOCX 本地例外写明；不覆盖并行题库改动。
- [x] **Step 4 — 必要自动验证。** server build+相关媒体/身份/课程/题图单测；web 相关组件/API单测及 `cd web` 后 `npx vue-tsc --noEmit`；mobile 类型与相关单测；`node scripts/build.mjs web h5` 原子组合构建。隔离 E2E 运行 `training-media`、`mobile-media-ticket`、`mobile-identity`、`training-courses`、`training-video-learning`、`training-publishing`、`training-question-import`、`cos-media-flow`、两个新增竞争/迁移套件。相关输入未变且此前任务证据完整的可复用；不无条件反复跑全库。
- [ ] **Step 5 — G1 实测。** G0 通过后，测试环境验证 PC/H5 真桶上传/刷新续传/长视频续票/Range/批量题图/拒绝路径；抽取迁移样本做全量哈希对账和业务回退。容量分别跑 500/1000/3000 在线阶梯，媒体码率/题图量取实测素材，记录平均和峰值带宽、P95/P99、错误率、DB池和鉴权负载；同时记录压测机 CPU/网络和实际达到的并发，生成器不足的结果不能归因于服务端。集中登录/开考/交卷作为独立突发场景，不伪造“在线人数=每秒提交数”。任何环境/配额/真机未具备项明确待验，不能宣称数千并发通过。
- [x] **Step 6 — 独立整体验证与本地提交。** 检查本分支差异、关键并发/授权/迁移证据；真实生产切换另交可审阅发布配置、迁移批次和回退方案取得授权。最终记录自动化、PC/H5、真桶/签名、真机、容量、生产部署各自状态。提交本任务文件，`test(media): 完成 COS 全链验收与交付记录`；无用户授权不 push、不删除旧文件。

## 自审映射与交接

| 设计要求 | 任务 |
|---|---|
| 业务范围、表设计复用和同桶前缀 | 1/2/7/12 |
| 实际字节校验、唯一正式发布、保留 ID/引用 | 3/4/5 |
| 断点恢复、过期授权、刷新/换号 | 4/5/8/10 |
| 动态授权、PC/H5/品牌/实名差异和签发/续签当前授权 | 6/7/9/10 |
| 取消、迟到写入、版本删除、历史引用保护 | 1/5/11 |
| 存量迁移、回退及 PDF/DOCX 排除 | 11/12 |
| 真云配置授权、分级验收和容量未知 | 7/12 |

本计划自审由根完成：核对设计覆盖、可验步骤、接口命名、Review Focus 和篇幅。执行方式已由用户选定为 Astra 并行编排，不再询问 SDD/其它执行方式，也不自动进入 SDD。正式实施启动后，根按依赖就绪情况直接调度，保持工作线 owner、按风险组织验证和独立审查，不把逐任务审查当成固定串行流水线。当前已进入实施；实际完成与未验项以验收记录为准。用户最新短链裁决覆盖原EdgeOne提案，不因此放宽上传隔离、实名、引用或学习结算。
