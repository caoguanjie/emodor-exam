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
