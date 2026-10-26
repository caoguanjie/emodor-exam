# 本地媒体迁往 COS 的运维步骤

本工具只迁移 `media_asset` 中已就绪的本地图片、视频，不创建新业务资源，不改变资源 ID 或 `media_reference`。PDF/DOCX 的 `regulation_version.file_path` 不进入迁移；原本地文件始终保留。实名材料迁往 `<COS_KEY_PREFIX>identity/migration/`，普通媒体迁往 `<COS_KEY_PREFIX>media/migration/`，不能将实名前缀加入公开分发规则。

本文是可审阅操作说明，不代表已经执行开发库/生产库迁移或真实 COS 验收。真实迁移前先完成当前已确认分发方案的真桶、权限和域名核验，再审阅具体清单及批次；不以自动化通过替代真实业务验收。

## 准备

1. 已执行 `033_cos_media_storage.sql`，后端与迁移工具使用同一版本实体；本工具不自动改表。原未部署的 COS 030 在合入主线 029—032 后顺延为 033，既有主线迁移内容不变。
2. 从仓库根运行 `npm --prefix server run build`，工具加载本次 `server/dist/`。
3. 根 `.env` 由使用方维护为 0600 并被 Git 忽略。`DB_HOST/PORT/USERNAME/PASSWORD/DATABASE` 指向经批准的目标，`UPLOAD_DIR` 指向实际本地文件根目录。COS 桶、地域、应用前缀及 `COS_SECRET_ID/COS_SECRET_KEY` 沿用已确认配置，两边使用同一套长期凭据。
4. 清单放在**主仓库和 worktree 之外**的受控目录，例如 `<私有运维目录>/cos-batch.json`。新目录由工具创建为 0700，清单及锁为 0600。不要把清单复制进仓库或公开工单，清单虽不包含姓名、原件正文、签名 URL、凭据，仍包含私有存储定位。

所有命令从仓库根执行，环境只由 Node 加载，不把真实密钥写进 shell 命令、文档或前端变量：

```bash
node --env-file=.env scripts/media/migrate-local-to-cos.mjs --plan --manifest /受控运维目录/cos-batch.json
```

省略动作时默认为 `--plan`。此动作仅查询业务库、读取本地文件并计算实际 SHA-256、写本地清单，不调用 COS 写接口。可在尚未配置 COS 凭据时盘点；实际连接库和 `UPLOAD_DIR` 仍必须明确配置。

## 审阅清单

清单记录资源 ID、用途、媒体种类、状态、引用数量、原定位、实际校验结果和 `updatedAt` 快照。只将 `ready + local + 实际大小及 SHA 匹配` 的图片/视频列为可执行项。

- `STATUS_PROCESSING/FAILED/DELETING`：等待稳定或单独处置，不伪造为 ready。
- `SOURCE_MISSING/SOURCE_SIZE_MISMATCH/SOURCE_HASH_MISMATCH/SOURCE_UNAVAILABLE`：原文件异常，不切换定位。
- `INVALID_METADATA/OUT_OF_SCOPE`：记录异常，不当成可迁移媒体。

重新运行 plan 不覆盖已经存在的候选、版本或回执。修复源数据后如需重新盘点，应使用新的清单路径；旧清单保留原始快照供对账。不要手工改快照后强制执行。

## 执行批准的批次

```bash
node --env-file=.env scripts/media/migrate-local-to-cos.mjs --apply --manifest /受控运维目录/cos-batch.json --asset-id 123 --asset-id 456
```

`--asset-id` 可重复；未指定时执行该清单全部项，因此审批时应明确整个清单或列出的资源 ID。工具输出仅含资源 ID、用途、状态、稳定原因及数量，不输出对象键、可用 URL 或凭据。

每项按以下顺序执行：

```text
持久保存唯一候选键及写入意图
  → 复制同一已核验本地文件，回读正式对象核对 SHA
  → 再检查本地文件
  → 短事务锁媒体行，比对原定位/状态/SHA/大小/updatedAt
  → 只切换存储元数据，保存清单回执
```

数据库行锁不跨 COS I/O。复制期间业务绑定/删除可正常进行；行消失、变为 deleting、定位或快照变化时记录 `ROW_CHANGED`，不覆盖、重建或复活资源。不同清单迁移同一资产会产生各自独立 UUID 候选，仅一个原行快照 CAS 能成功。

无效候选只在清单独占、准确迁移命名空间、已知准确对象版本且没有任何媒体行使用该键时回收；其它情况保留 `cleanupPending`，不扫桶、不删除 gooodwork 前缀或其它对象版本。

## 中断与恢复

每份清单持有独占 `.lock`；该锁只互斥运维工具，不锁正常业务。写回清单使用同目录 0600 临时文件、fsync 和原子替换。

正常退出或异常返回会释放自己的锁。进程被强制终止、机器宕机后可能留下锁。工具默认返回 `MANIFEST_LOCKED`，**不按超时自动抢锁**，也没有 `--recover-lock`：

1. 只读检查该清单旁准确的 `.lock`，核对 `host/pid/token/createdAt`。
2. 确认原主机、原进程及其迁移工作已经退出；PID 仍存在、主机不可确认或有并行操作者时停止，不删除锁。
3. 由操作者移除这一个已确认失效的锁文件，再用原清单和原资源 ID 重跑。不要批量删除锁或清单。

恢复先对账数据库、准确候选键及实际对象字节。已上传对象复用原候选，不另造键或盲目重传；已提交的数据库切换可恢复丢失的清单回执。

`WRITE_STATE_UNKNOWN/PUBLISH_FAILED/SWITCH_STATE_UNKNOWN` 保留定位供复查。若此前已记写入意图而 HEAD 仍无法确认对象，工具不会重新 PUT 或宣称清理成功；后续恢复可以再次对账。若确认写入从未生效，须审阅旧候选和实际状态后用新批次处理，不能直接改掉未知标记。`TARGET_ALREADY_EXISTS/TARGET_NOT_OWNED` 同样保留并报告，不覆盖已有键。

## 回退

```bash
node --env-file=.env scripts/media/migrate-local-to-cos.mjs --rollback --manifest /受控运维目录/cos-batch.json --asset-id 123
```

回退重新验证原本地文件的实际大小及 SHA，再锁行确认当前仍是本清单对应的 COS 对象和状态后切回 local。缺文件、内容变化、当前行已变化或新 COS-only 上传均不允许套用本地回退。

回退不删除本地文件。切回成功后，工具会尝试回收本清单自有、没有媒体行使用的准确 COS 候选版本；回退批次审批应同时列出这些版本。无法安全回收时，`rolled_back + cleanupPending` 表示定位回退已成功、候选仍保留待处置。

## 验收与记录

先小批次抽样，核对资源 ID/用途/历史引用集合不变、实际哈希一致，覆盖视频播放及拖动、题图/历史题图、封面、头像、品牌及实名专用读取，再扩大批次。清单成功不代表分发带宽、真实供应商、真机或数千并发已通过。

自动化入口为 `node tests/run-e2e.mjs --ephemeral --suite media-storage-migration`；仅在工具自有 `ruleexam_test_*` 临时库验证事务、两实例竞争、崩溃与回退，COS 作为外部设备替换。该结果不涉及开发库、生产库或真实 COS 写入。
