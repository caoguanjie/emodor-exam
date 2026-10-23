# 学员移动端供应商参考映射

更新日期：2026-10-22。本文只记录参考源码、RuleExam 目标实现、复用行为和验证，不记录任何真实 Key、验证码、手机号或配置值。

## 短信登录与 Debug Login

参考根目录：`/Users/caogj/Documents/emodor/gooodwork`。本轮只读源码与测试，未读取其 `.env`。

| gooodwork 参考 | RuleExam 目标 | 复用行为与差异 | 验证 |
|---|---|---|---|
| `server/domains/users/application/sms/sms_verification.py` | `server/src/modules/auth/sms-challenge.service.ts` | 复用 6 位码、300 秒有效期、60 秒重发、每 challenge 5 次、手机号日 10 次/IP 日 100 次和一次消费；RuleExam 使用 NestJS/RedisService 重写 | `server/test/mobile-auth.spec.ts` |
| `server/domains/users/infrastructure/cache/sms/redis_sms_challenge_store.py` | `sms-challenge.service.ts`、`server/src/common/redis.service.ts` | 复用 NX 重发预约、次数与消费原子边界；RuleExam Redis 使用独立 `ruleexam:sms_auth` 前缀，challenge 只存 HMAC 关联，不保存验证码或完整手机号 | 单元测试；真实 Redis 由 `tests/mobile-auth.mjs` |
| `server/domains/users/infrastructure/integrations/yunxin/config.py` | `server/src/config/configuration.ts`、`deploy/.env.example` | 沿用 `YUNXIN_SMS_*` 配置名；`SMS_PROVIDER=yunxin` 缺 AppKey/AppSecret/模板 ID 时 fail-fast | 隔离配置检查通过 |
| `server/domains/users/infrastructure/integrations/yunxin/yunxin_sms_gateway.py` | `server/src/modules/auth/sms-provider.ts` | 复用 `sendcode/verifycode`、`SHA1(appSecret + nonce + curTime)`；413 映射参数错误、416 映射限流，403/网络/异常响应映射服务不可用；不返回供应商原文 | `server/test/mobile-auth.spec.ts`；真实云信未验 |
| `server/interfaces/http/modules/users/sms/routes.py` | `mobile-auth.controller.ts`、`mobile-auth.service.ts`、`session-issuer.service.ts` | 按手机号关联/并发创建普通学员并走统一 session issuer；RuleExam 使用独立 mobile Cookie、JWT 与 durable session | 单元测试；`tests/mobile-auth.mjs` 待 Gate E |
| `server/interfaces/http/modules/users/debug_login/routes.py` | `debug-mobile-auth.controller.ts`、`mobile-auth.service.ts` | 默认关闭，仅 test/development；production 开启启动失败；复用真实学员关联和 issuer，不伪造 Token，不写实名状态 | `server/test/mobile-auth.spec.ts`；`tests/mobile-auth.mjs` 待 Gate E |
| `server/tests/integration/test_debug_login_routes.py` | `server/test/mobile-auth.spec.ts`、`tests/mobile-auth.mjs` | 覆盖开关、普通 employee、停用/管理员拒绝、并发新建、真实 mobile 会话；新增 RuleExam 权限复核和 PC/mobile Cookie 隔离 | 单元 21 项通过；真实 HTTP 待 root 注册后执行 |

## RuleExam 明确不复用

- 不复制 gooodwork 的 Python 会话体系、用户表结构、mock 模式或任何配置值。
- 不增加 `SMS_MOCK_CODE`、运行时测试验证码接口或 H5 Debug Login 按钮。
- 自动化 Provider 替身只存在于 Nest 测试进程；真实云信短信成功登录由用户后续手工验收。
- Debug Login 只绕过短信，不能绕过账号停用、角色、有效管理权限、实名、视频或考试守卫；新建学员保持 `identity_status=unverified`。

## 实名认证与三图私有媒体

以下是 Task 10 实施前的只读参考映射；“目标”不表示已经接入或验收。

| gooodwork 参考 | RuleExam 目标 | 复用行为与差异 | 验证 |
|---|---|---|---|
| `server/domains/users/application/identity/media/{dto,service}.py`、`infrastructure/documents/identity_image/processor.py` | `identity.controller.ts`、`identity-provider.ts`、`media-policy.ts` | 复用三图 slot、JPEG/PNG、10 MiB、320×320、像素/长边/编码大小、EXIF 修正、重编码和元数据清理；RuleExam 拆成三个 purpose，证件面只保存 OCR 裁剪清洗图 | Task 10 单元与 `mobile-identity` |
| `interfaces/http/modules/media_asset/assets/identity_image_routes.py` | `POST /api/v1/me/identity-verification/images` | 复用本人上传、限量读取、私有存储和错误归一；不复用通用管理端上传，处理预览由短期票据返回而非 Base64 | Task 10/Gate G |
| `applications/identity_verification/sessions/{service,registry}.py` | `identity.service.ts`、`identity-verification-session.entity.ts` | 复用同用户/同三资产/未过期会话及 10 分钟 TTL；来源项目 registry/锁是进程内，RuleExam 必须持久化并用数据库锁收敛多实例并发 | 并发、重启恢复测试 |
| `domains/users/infrastructure/integrations/tencent/real_name_verification_adapter.py` | `identity-provider.ts` Tencent adapter | 复用双面 OCR → 字段/风险/有效期 → FaceID 编排、稳定失败码和相似度 70；RuleExam 先持久化 Provider 结果再绑定 | Provider 单元、绑定恢复测试；真实腾讯未验 |
| `tencent_id_card_ocr.py`、`tencent_faceid.py`、`faceid_protocol.py` | Tencent OCR/FaceID HTTP adapters | 复用 TC3 调用、固定 API、错误脱敏与不自动重试；超时后结果/计费未知，不在 Adapter 内重发 | 单元注入 HTTP stub；实网未验 |
| `identity_verification_transaction_store.py`、`identity_verification_terminal_event_store.py` | `identity.service.ts` 事务与唯一索引 | 复用实名、三图引用、资料投影、审计和 Provider 事件幂等；来源真实 Provider 结果仍在内存，RuleExam 增加加密持久结果以保证绑定失败后不二次调用 | 事务失败恢复、事件重放测试 |
| `crypto/identity_fingerprint.py`、`identity_verification_views.py` | `learner_identity`、Identity crypto/view | 复用 HMAC 指纹查重和证件脱敏视图；不复制来源明文实名表，RuleExam 姓名/证件号用独立认证加密密钥 | 唯一性、加解密、日志测试 |

参考配置名只记录名称：`TENCENT_ID_CARD_OCR_ENABLED/SECRET_ID/SECRET_KEY/TOKEN/ENDPOINT/HTTP_TIMEOUT_SECONDS`、`TENCENT_FACEID_ENABLED/SECRET_ID/SECRET_KEY/TOKEN/ENDPOINT/HTTP_TIMEOUT_SECONDS`。来源项目另有 `REAL_NAME_PROVIDER_MODE`、`IDENTITY_FINGERPRINT_KEY_BASE64/KEY_VERSION/PREVIOUS_KEY_*` 和 `IDENTITY_IMAGE_RETENTION_DAYS`；RuleExam 采用冻结契约中的独立 `IDENTITY_PROVIDER`、数据加密、指纹和媒体票据配置，不复制来源值。

日志只保留本地 request id、脱敏 Provider request id、稳定结果分类、HTTP 状态、耗时和供应商错误码；不得记录姓名、证件号、地址、图片/Base64、签名、Secret/Token 或供应商原始错误消息。自动化只用合成材料与测试模块 Fake Provider；真实腾讯仍未验。

gooodwork 当前 `faceid_protocol.py` 已明确使用 `ImageRecognitionV2`（API version `2018-03-01`），请求只含 `IdCard/Name/ImageBase64`。腾讯旧 `ImageRecognition` 文档虽提示新客户改用 V2，但不代表当前参考源码仍在使用旧 action；RuleExam 必须按 V2 落地，真实供应商权限和实网结果仍单独验收。
