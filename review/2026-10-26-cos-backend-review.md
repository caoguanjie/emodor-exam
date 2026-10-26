# COS后端阶段独立审查与修复

固定输入：`44b9d7f..db53ab60f414cb6d5683034cdc27f052698e3172`，独立只读reviewer，审查副本 `.worktrees/cos-media-review-backend`。本阶段只覆盖Task1—5，不冒充全项目验收。

## 两项Important

1. SDK3.0.0版本分页类型声明使用Marker/NextMarker，但实际runtime/COS协议是KeyMarker/NextKeyMarker；同键超过一页时清理失败。修复按真实协议发参，并增加实际SDK+本机HTTP/XML两页测试；旧实现替换回去时已确认红测。
2. STS从服务端签发时计算相对期限，跨秒往返会使真实expiredTime晚于客户端预留截止，原实现误拒503。修复保留会话内预留截止、留发证/时钟余量、最多10秒逻辑等待；8个真实在途限制在供应商Promise结算后才释放，不能把逻辑超时假称底层请求取消。简单PUT使用临时凭据的准确时间签名。返回授权仍不得晚于持久截止；过短或超界受控拒绝。

修复候选：`d804e627dda9585e36894709b2f80fd2250e3e0b`，6文件。29项受影响单测/build及13组真实MySQL/Redis/Nest竞态通过；包含发证在途时取消与清理、实际到期不超过持久截止。日志 `/tmp/ruleexam-cos-review-{focused,build,races}.log`；原失败证据 `/tmp/ruleexam-cos-review-{grant,protocol}-red.log`。

## HTTP全链追加修复

独立tester的 `cos-media-flow` 抓到credentials/complete空DTO被全局class-validator当unknown value拒绝。根在执行者模型容量中断后接手：保留全局pipe，只对没有业务字段的两个操作改为原始body严格空对象检查；未知字段、数组、原型异常仍拒绝。真实Nest HTTP回归8项通过，全链重跑退出0。测试者夹具修正不属于生产行为变化。

## 审查边界

SDK/STS真实云行为、PC/H5/迁移/读取分发的后续增量由最终候选独立审查与验收补齐。设计分册由根统一更新，不能以本阶段源码审查替代文档或真实部署完成。

## 最终后端增量审查与复审

第二次固定候选为 `44b9d7f..3f0cbf7`，范围补充读取、迁移及后端接线。独立 reviewer 报告 1 Important、1 Minor，无 Critical：

- **Important：公读共桶的 simple 暂存对象漏私有 ACL。** 原 grant 仅签 `Content-Type`；修复同时签署并返回 `x-cos-acl: private`，临时策略仍仅准确键 `PutObject`。真实 SDK 重算签名证明改为公读或移除该头均不匹配；CORS 提案同步允许该头。正式发布、迁移和 multipart 初始化原已明确 private。
- **Minor：已切回 local 后的清理没有恢复。** 回滚时 COS 删除暂时失败，或数据库已切回但回执丢失，重跑现在复用准确候选清理并更新 `cleanupPending`。新增两项测试旧实现均失败，修复后迁移 15 项通过；保留原文件、归属/哈希/引用保护未放宽。

修复提交 `124e948`。独立 reviewer 对该固定候选复审：以上两项闭环；并审查 `6a59e60` 引入的预检/探针工具，未发现新增实质问题。检查了默认仅六个只读 SDK 调用、输出脱敏、准确三随机键写入、ownership/正文哈希/版本核对与未知状态保留。

相关证据为 6 文件 30 项后端单测、15 项迁移单测、12 项预检测试和服务端构建通过。真实 COS 探针由根执行，见云验收记录；reviewer 全程只读，没有把根的云测试冒充自己复跑。
