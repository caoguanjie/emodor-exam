# 学员移动端 H5 最终验收记录

日期：2026-10-22

范围：Task 16 / Gate J。当前工作区 `main`，未创建提交。

Gate J 的自动化与桌面 Chrome 验收已通过，全量隔离 E2E 最终为 21/21 PASS。关键 E2E 已使用最终媒体 URL 修复（包括拒绝 `.` / `..` token）重建 H5，并在移除测试服务器 `/mobile/api/v1` 兼容别名后重新通过，覆盖所有 HTTP 方法的无 draft/heartbeat 断言、跨 deadline 后新增状态查询和编辑锁定，以及浏览器真实媒体请求路径。下列结果汇总对应 lane 与主代理的最终验证；真实供应商、真机、Docker/Nginx 与生产部署仍未执行。

## 自动化与桌面 Chrome

| 检查 | 结果 | 证据 |
|---|---|---|
| Task 16 隔离关键链路 | PASS | `node tests/run-e2e.mjs --ephemeral --suite mobile-h5`；最终修复后本次先运行 timeout 1/1（17.4s），再运行主链 1/1（2.0s），最终套件退出码 0 |
| Debug Login | PASS | 测试进程仅在隔离 `NODE_ENV=test` API 中开启，浏览器获得真实 mobile access/session；未使用真实短信 |
| 首页/课程 | PASS | 构建后的 `dist/mobile` 通过同源测试服务器加载，首页、课程详情和课时可访问 |
| 未实名限制 | PASS | 未实名学员播放视频和开始考试均显示实名限制 |
| 三图实名 | PASS | 浏览器经真实 HTTP 上传三张合成图片，测试进程内 `FakeIdentityProvider` 返回 verified；未启用运行时 mock |
| 三类客观题 | PASS | 实际考试 payload 覆盖 `single`、`multiple`、`judgment`；单选、判断各选 1 项，多选实际选 2 项 |
| 图片题票据 | PASS | 测试服务器仅代理 `/api/v1`；监听到的所有媒体 content 请求均为同源 `/api/v1/media/tickets/:ticket/content`，至少一次真实响应为 200 图片且图片字节数 >100，页面图片 `naturalWidth/naturalHeight > 0` |
| 本地草稿 | PASS | 选择答案后刷新页面，按稳定 option ID 恢复同一 record 的本机草稿，刷新前后 `aria-checked` 一致；完整流程按路径监听所有 HTTP 方法，断言无 draft/heartbeat 请求 |
| 主动交卷与冻结结果 | PASS | 只由浏览器点击交卷并确认；本用例每题均作答，submit body 覆盖全题且选中 ID 一致；结果 `selected_option_ids` 与请求一致，终态 attempt 不再下发题目，可查看解析。本关键 E2E 未覆盖未答题空数组 |
| 记录与错题 | PASS | 考试记录和错题本页面可读取，解析可见 |
| deadline | PASS | 先通过 API/页面确认 `in_progress`、剩余时间和可编辑选项并记录状态 GET 基线，再真实跨过 18 秒 deadline；要求新增状态 GET 且全部选项禁用或进入 timeout 终态，监听到 0 个 submit 请求 |
| 迟到交卷 | PASS | 同一超时 record 的迟到 payload 返回 `timeout`、0 分、无 submitted/graded 时间、无逐题结果 |
| H5 构建 | PASS | 套件内部执行 `node scripts/build.mjs h5`，`dist/mobile/index.html` 存在 |
| mobile 类型检查 | PASS | `npm --prefix mobile run type-check` |

## Task 16 计划矩阵（本轮实跑）

| 命令 | 结果 | 证据 |
|---|---|---|
| `npm --prefix mobile run test:unit` | PASS | 34 files / 313 tests（最终媒体 URL 修复后的 full unit 结果，由生产 lane 交付并经主代理确认） |
| `npm --prefix mobile run type-check` | PASS | `vue-tsc --noEmit` |
| `npm --prefix mobile run build:h5` | PASS | H5 产物构建完成 |
| `npm --prefix mobile run build:mp-weixin` | PASS | 微信小程序产物构建完成 |
| `npm --prefix server run build` | PASS | Nest TypeScript 构建完成 |
| `npm --prefix server test` | PASS | 47 files / 574 tests（包含最终导题重复指纹与错误隔离修复） |
| `./node_modules/.bin/vue-tsc --noEmit`（web） | PASS | PC 类型检查完成；首次错误的 `npm --prefix web exec -- vue-tsc --noEmit` 不作为代码失败 |
| `npm --prefix web run build` | PASS | PC Vite 构建完成 |
| `node --test web/tests/*.test.mjs` | PASS | 177 tests / 0 fail |
| `node tests/run-e2e.mjs --ephemeral --suite training-full-flow` | PASS | 独立 API/MySQL/Redis，完整培训闭环通过 |
| `node tests/run-e2e.mjs --ephemeral --suite smoke` | PASS | 85/85 |
| `node scripts/build.mjs web h5` | PASS | 统一 `dist/` 组合构建完成 |
| `node tests/run-e2e.mjs --ephemeral --suite mobile-h5` | PASS | timeout 1/1 + 主链 1/1 |
| `node --test tests/signal-cleanup.test.mjs` | PASS | 本次 5/5；包含 mobile-h5 Playwright child 的 SIGTERM 回收（18.01s），总耗时 39.44s |
| `node tests/run-e2e.mjs --ephemeral --suite all` | PASS | 最终 21/21 注册套件逐个隔离通过，包含 `training-courses`、`training-question-import` 与 `mobile-h5` |

全量回归曾在课程套件和题库导入套件发现阻塞，修复后重新从头执行 `--suite all`，最终 21/21 PASS。`training-question-import` 的根因是 preview 与 v2 入库后的富文本表示导致重复指纹漂移，并非事务回滚泄漏；现统一经受限文档结构规范化后计算指纹，仅逐行隔离存量题的 `BizError 40001` 内容异常，新候选、批次以及数据库或未知错误仍严格失败。最终修复经定向 31/31、server 47 文件 / 574 项及 build、隔离 `training-question-import` 和独立 review 验证通过，并由最终全量再次覆盖。

普通 mobile E2E 配置默认排除 `critical-*.spec.ts`，枚举为 141 项且不含两份 critical 文件；`mobile-h5` 通过显式 `MOBILE_E2E_CRITICAL=1` 逐个启用，避免重复执行真实 API 集成链。

测试运行使用每次独立的 MySQL/Redis、随机运行期密钥和测试上传目录；没有连接开发库，没有读取 `.env` 或真实凭据。套件退出时已回收 API、MySQL、Redis 和临时目录。

## 未执行或不能由自动化替代的验收

- Docker 镜像构建、容器内文件检查和真实 Nginx 响应头：未执行；不能用本地 H5 build 替代。
- 真实短信供应商、真实手机号和验证码：未执行；由用户在部署后的 H5 手工输入。
- 真实腾讯 OCR/FaceID：未执行；本次仅验证隔离测试进程的 Fake Provider 接口与业务绑定。
- iOS Safari、Android Chrome、微信内置浏览器及微信开发者工具/真机：未执行。
- 真实视频解码、全屏、断网恢复、弱网和相机权限：未执行；本次只验证视频票据授权层、课程门禁和题图票据/浏览器图片加载。
- 生产部署、HTTPS、真实 Cookie 域/路径、反向代理跨域策略：未执行。

## 敏感值扫描

仅报告分类，不输出匹配内容：测试新增文件未发现真实手机号、验证码、JWT/refresh token、证件号或供应商密钥字面量；使用的手机号、令牌、密钥和合成图片均为隔离运行时临时值，未写入仓库。

## 结论

Task 16 / Gate J 的自动化与桌面 Chrome 验收通过，全量隔离 E2E 为 21/21 PASS。该结论覆盖本记录列出的 H5 关键链、回归与构建；真实短信和腾讯实名、真机/微信、视频解码/弱网、Docker/Nginx 和生产部署均未执行，须另行验收。
