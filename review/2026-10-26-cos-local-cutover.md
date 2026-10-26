# COS 本地启用与存量迁移记录

用户明确授权：当前没有项目运行，可以重启并执行既定计划；明确纠正为“重启”，不是重置。本次没有清空数据库、重置账号/口令或删除本地媒体。

## 当前结果

- COS 分支已在本地合入 `main`，保留主线 `1725b80` 的题库、试卷分值、学习要求与排序功能；没有推送远程。
- 主根 `.env` 仍为 0600、Git 忽略，按白名单复用 gooodwork 同一 COS SecretId/SecretKey；现为 `MEDIA_STORAGE_PROVIDER=cos`、`MEDIA_DELIVERY_MODE=cos-signed`，读链/视频链默认 300 秒，允许配置至 3600 秒。
- 后台 API `http://localhost:3000/api/v1/health` 正常，MySQL/Redis 均 up；PC `http://localhost:5173/`，H5 `http://localhost:5174/mobile/` 已启动。
- 数据库已应用 `033_cos_media_storage`，完整目录检查 pending 为空，实际 41 张表。
- 7 个存量资源均为 `cos + ready`：4 张品牌图、1 张课程封面、2 个视频。7 个原本地文件全部保留。

## 合并与兼容修复

工作始于 COS `ae6d288` 和更新后的 main `1725b80`。合并候选 `bff535b` 保留双方能力，前后端独立 reviewer 分别复核 UI 四个交集、迁移/表/测试注册，无实质问题。未部署的 COS 030 顺延为 033；主线已有 029—032 保留。

实际检查发现已应用的 022/029 checksum 与仓库不符。只读历史追溯找到了与数据库记录精确匹配的 Git blob：022 为 `69db03f84dd9079531b2fe71ce915afc55d76e7c`，029 为 `f751202cc2c722d725f38b6687d684c721061d2f`。当前文件各少一个末尾换行，DDL/probe/指令无语义差异。`504a0b6` 恢复原始字节，没有修改 `schema_migration` 中任何旧 checksum；随后完整检查只有 033 待执行。

本机既有开发 MySQL 使用明确空口令。通用迁移 CLI 的非空口令校验不适用于该现存本地配置；本次使用同一模块导出的 `inspectMigrations/applyMigrations`，保留完整 checksum、probe、目标和锁检查，只新增 033。媒体迁移 CLI 则在 `ba05be1` 增加窄兼容：显式空口令且 localhost/127.0.0.1/::1、development 或未设环境才接受；生产、远程、缺键仍拒绝。14 项纯测试及隔离迁移套件通过。

## 云设置与真实验证

操作前备份数据库完整 SQL（1,020,308 bytes）、两份本地 env、7 个媒体行/7 个引用及已有迁移记录。私有材料位于：

`/Users/caogj/Documents/emodor/RuleExam-cos-operations/cutover-2026-10-26T11-57-40-950Z/`

目录 0700，文件 0600，不提交 Git。包含 `database-before.sql`、`media-before.json`、`media-migration.json`、`post-migration-verification.json` 和配置前后记录；其中 env 备份含凭据，不得公开。

真实 CORS 从 0 条追加为 1 条，准确来源仅 localhost/127.0.0.1 的 5173/5174；保留已审允许头（包括签名所需 `x-cos-acl`），没有改桶 ACL、Policy、版本状态或长期身份权限。写后读回完全匹配，浏览器 PUT 预检 OPTIONS 返回 200 且允许请求来源。共桶仍为 public-read，本项目对象逐个显式 private。

先迁移当前 Logo（asset 6），在真实 Chrome 的 localhost 页面请求原 `site-config` 内容入口，经过 307 从 COS 读取图片：HTTP 200，实际正文 SHA 与原件相同，匿名直读 COS 拒绝。样本通过后执行其余批次，最终 summary 为 7 switched、0 failed、0 skipped、0 cleanup pending。

独立读回全部 7 个 COS 对象并重新计算 SHA；7 项均与本地原件、原媒体 SHA/大小一致。除存储定位和更新时间外，原媒体元数据相同，资源 ID 集合和 `media_reference` 集合完整不变。两个视频的前 1024 字节 Range 均为 206，内容与本地相同；全部对象无签名 HEAD 均为 403。旧迁移记录逐项与操作前一致。

真实 Chrome 从应用入口读取 Logo 与三个 Banner，均成功跳转到 COS、HTTP 200，且图片解码成功。这里使用实际页面、实际数据库和真实 COS，没有 route stub。

## 自动化与构建

- 合并后 server：80 文件 1163 测试通过。
- Web：46 文件 661 测试通过，vue-tsc 通过。
- Mobile：50 文件 493 测试通过，type-check 通过。
- 迁移相关 Node 三文件 42 测试、隔离 cos-media-schema 通过。
- 隔离 cos-media-flow、training-paper-learning、main-question-designers（592 断言）、compatibility（35 断言及 timeout helpers）通过。
- main 后端构建、PC+H5 原子组合构建通过；162 个组合产物未发现本地后端凭据值。
- 本次新增空口令兼容 14 测试、隔离 media-storage-migration 通过。

## 登录后的真实浏览器验收

用户已分别登录管理端和独立学员 H5。管理端进入课程页并打开临时验收课程的新建表单，未修改原已上架课程；尚未提交新课程。上传测试在选择本地文件前被 Kimi 扩展的文件访问权限阻断；系统文件窗口连接也不可用，已请用户开启扩展文件访问或自行选取测试文件。没有绕过扩展权限。因此，真实管理页面的新图片上传、44 MB 视频暂停/刷新续传仍未执行。

H5 使用真实登录会话进入现有 course 1 / lesson 1：课程详情和进度接口均为 200，封面 asset 11 签票接口为 200，真实 COS 封面 GET 两次均为 200。点击播放调用 `POST /api/v1/me/video-sessions` 返回 HTTP 403、业务码 `40302`、提示“请先完成实名认证”；页面随后展示实名入口。这是实名资格拦截证据，不能算作视频播放通过，也不能据此认定 COS 播放失败。

独立只读核验确认运行配置为 `IDENTITY_PROVIDER=tencent`，OCR/FaceID 所需开关和密钥键存在；`learner_identity` 与 `identity_verification_session` 均为 0 条。当前已打开实名认证页面，等待用户本人完成真实材料与现场拍照。尚未发起供应商核验，配置齐全不代表供应商调用已通过；未上传身份材料、插入伪造实名或借管理员会话绕过。

脱敏网络证据 `h5-signed-in-gate.json` 与 `h5-identity-entry.png` 存放于上述私有操作目录，均为 0600；不含令牌、签名 URL 或身份材料。真实 H5 开播/续期、真机、正式域名/CSP、数千并发与生产部署仍分别待验。

为后续界面验收已准备私有 PNG/MP4 测试素材（上述目录 `fixtures/`），没有将其写入真实业务表。原7个文件没有删除；未实际执行回退，回退工具的事务与恢复证据仍来自隔离测试。
