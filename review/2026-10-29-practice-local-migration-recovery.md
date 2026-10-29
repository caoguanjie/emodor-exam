# 模拟考合并后的本机后台恢复

2026-10-29，用户反馈后台进入后连续出现“服务器内部错误”。已在本机修复并通过现有登录会话复验；未操作远程或生产数据库。

## 根因

当前后端已包含模拟考功能，但本机 `127.0.0.1:3306/ruleexam` 只应用到042。三张表的 `exam_purpose` 尚不存在，`exam_paper.max_attempts` 仍不可空；正式首页查询引用新增用途字段后触发 `ER_BAD_FIELD_ERROR`。

现有浏览器登录会话有效。修复前以下四个GET请求均为HTTP 500、业务码50001：

- `/api/v1/admin/dashboard`
- `/api/v1/admin/dashboard/exam-trend?days=7`
- `/api/v1/admin/dashboard/recent-exams`
- `/api/v1/admin/dashboard/learning-options?page=1&page_size=20`

健康检查原本返回200，只能证明MySQL/Redis连接可用，不能证明业务schema与代码匹配。

## 恢复操作

1. 实时检查仅043待执行，进行中考试0；确认3000端口进程来自本工作区且使用 `.env` 启动当前dist。
2. 仅停止该API进程，保留PC/H5服务；完成0600权限的一致性gzip备份并通过gzip完整性检查。
3. 通过mysql2运行期连接调用既有正式 `applyMigrations` API，只应用 `043_practice_random_exam`；保留迁移锁、前置检查、历史摘要兼容、结构探针及续跑协议。未绕过检查、改写历史checksum或更改业务数据。
4. 对全部42张表比较迁移前后内容摘要，排除三张表新增的用途默认列及新增043登记；既有业务内容与历史迁移记录完全一致。
5. 待执行列表为空，再次执行无新增迁移。恢复原方式启动本机API，健康检查200、MySQL/Redis为up。

备份：`/Users/caogj/Documents/emodor/emodor-training-platform/deploy/backups/2026-10-29/ruleexam-before-practice-043-2026-10-29T01-20-59.414Z.sql.gz`（276083字节）。

SHA256：`02b4e7c71ba67a559d703be3434bbe1c8fc6ebe4de937b20e786341ce147d506`。

备份含业务数据，仅留在本机，不纳入Git。运行证据（内容摘要、迁移结果、后端日志、恢复截图）位于忽略目录 `.superpowers/practice-exam/runtime-recovery-20261029/`，不记录凭据。

## 实际复验

使用kimi-webbridge借用用户现有后台标签页，四个原失败接口均恢复HTTP 200、业务码0；刷新页面后，运营概览、考试趋势、必修学时及最近考试正常显示，未再出现服务器内部错误。新后端日志错误匹配数为0。

本次证明当前本机登录会话可正常使用后台，未执行退出/重新输入账号密码的登录回归；没有重置账号、改密码、创建/发布模拟卷或部署生产。本轮没有修改业务源码，原有未提交修改和并发新增文档保持。
