# COS真实云验收门

**本地切换更新：**在用户明确授权后已应用1条本地PC/H5精确来源CORS，真实OPTIONS预检通过；7个旧媒体已迁入COS，全部读回哈希相等、匿名拒读，2个视频Range206及4个品牌图真实浏览器读取通过。完整G0仍缺登录后的应用上传/续传验收，G1的H5实名学员、真机与容量待验。详情见[本地切换记录](2026-10-26-cos-local-cutover.md)。以下表格/探针记录为切换前快照，不能再据其“未应用”描述判断当前配置。

当前方案沿用gooodwork：授权后签发私有COS GET，默认300秒、可配置1—3600秒；不接入EdgeOne，不要求新域名或新长期密钥。

## G0

| 项目 | 当前状态 | 验证方式 |
|---|---|---|
| 共用桶/地域、ACL、版本、现有CORS/策略 | 真实只读检查完成；桶为 public-read | 地域匹配，无 Bucket Policy，未开启版本，CORS 为 0 条；没有改桶设置 |
| 应用前缀/版本/分页 | 自动化通过，真桶待验 | adapter拒越界；真实SDK本机HTTP/XML两页测试；真桶另验 |
| simple/multipart/STS准确键授权 | 真实探针通过 | 准确临时键 simple PUT、UploadPart/ListParts、合并；越键 simple PUT 和分块均 403 |
| 签名准确版本、到期、200/206/416 | 真桶无版本对象通过；其它版本由本机 SDK 测试覆盖 | 实际 SHA 一致、200/206/416、匿名/过期/换键拒绝；没有为测试打开桶版本 |
| 浏览器CORS / CSP / 小程序域名 | 已生成本地 PC/H5 精确来源提案，未应用 | localhost/127.0.0.1 的 5173/5174；正式来源和微信控制台另验 |
| gooodwork现有规则保留 | 本次未变更 | 不修改桶 ACL、Policy、CORS、版本或共享长期身份权限 |

共享长期凭据仍可能访问gooodwork自身范围，不能把它当成项目隔离失败；独立验证adapter/临时上传授权/签名目标的准确范围。后端凭据配置相同已经本地核对，配置存在不代表云权限可用。

真实写探针仅使用本项目明确批准的随机临时前缀和小随机数据；登记准确键/版本/ownership后清理，未知或不再属于本次的对象保留报告。未开启或暂停版本控制是受支持状态，不为验证修改整个桶设置。任何桶级配置修改须先交具体差异，不能用模板覆盖共享规则。

## 2026-10-26 真实探针记录

根从 worktree `.env` 注入已授权共享配置，调用 `cos-preflight --inspect`，再使用 `ruleexam/dev/staging/probe/<随机 UUID>/` 内三个随机键及每个 64 字节随机内容执行受限探针。全过程未触及已有业务对象，未把凭据或签名 URL 输出至日志。

探针证明：本桶虽然 public-read，但对象显式 `private` 后匿名 GET 返回 403；带该头的 simple PUT 仅需准确键 `PutObject` 临时权限。multipart 初始化也显式 private。正式代码的 simple grant 曾漏签此头，已在 `124e948` 补齐并通过独立复审；签名篡改/移除头的回归已通过。

实际结果 `probe.status=pass`；清理结果 `status=pass, deleted_object_count=2, aborted_upload_count=1, pending_object_count=0`。真实桶没有版本，因此本次不声称真云验证了 Enabled/Suspended 两种状态。探针还没有经过正式业务签票接口、真实浏览器直传或长视频会话。

私有探针 journal 与只读存量盘点在 `/Users/caogj/Documents/emodor/RuleExam-cos-operations/2026-10-26/`，0600，不提交 Git。工具仍输出 `ready=false/g0=not-verified`，桶 public-read 的诊断没有被改成“桶私有”；G0 的浏览器与应用链路待验。

## G1

真实COS上传、浏览器长视频跨到期/拖动、移动设备、小程序、存量样本迁移与回退、500/1000/3000阶梯容量、生产部署仍分别验收。COS已发链接在期限内可用是用户已接受的短链边界，不能重新表述为即时撤权。CLI默认只读和压测脚本默认估算不是外部验收结论。
