# 培训工种统一与首次确认验收

日期：2026-10-23。需求见 [已批准设计](../docs/superpowers/specs/2026-10-23-learner-training-category.md)，实施记录见 [计划](../docs/superpowers/plans/2026-10-23-learner-training-category.md)。

## 本次交付

- PC「培训类别」和 H5「培训工种」共同使用 `sys_user.category_id`；名称读取当前类别表，不再把 `occupation` 文本当作工种。
- 空类别学员选择真实启用类别，二次确认才提交；确认后只读。导入/PC 已分配类别直接只读，不要求重复选择。后续由有 `students:write` 的 PC 人员修改并审计前后类别。
- 服务端强制 mobile 普通启用学员、无业务角色链接、只能首次赋值；同值重放幂等，不同值拒绝；不改变来源、实名及既有考试记录。
- 保留个人资料与实名认证两个菜单；考试按缺项给强指引，不隐藏既有考试或历史入口。课程可见性/播放门槛不变。
- 请求结果未知先查询本人资料收敛；读回失败锁住自选并允许刷新；切账号丢弃旧请求，页面返回刷新 PC 调整并保留普通未保存草稿。
- 未新增数据库列、表或迁移；未回填旧 occupation，未修改开发库、提交或推送。

## 验证结果

| 层级 | 命令/证据 | 结果 |
|---|---|---|
| 后端定向 | `npm --prefix server test -- learner-training-category training-student-admin-boundary identity-profile` | 3 文件、94/94；含 tsc |
| 后端全量 | `npm --prefix server test` | 59 文件、904/904；含 tsc |
| 真实隔离接口/数据库 | `node tests/run-e2e.mjs --ephemeral --suite learner-training-category` | PASS；真实 HTTP/JWT/MySQL/Redis，短信传输用受控 debug login 替代 |
| 启动器注册 | `node --test --test-name-pattern='registered suites expose' tests/training-harness.test.mjs` | 1/1 |
| 移动类型 | `npm --prefix mobile run type-check` | PASS |
| 移动单元 | `npm --prefix mobile run test:unit` | 40 文件、375/375 |
| 桌面 Chrome 页面（API Mock） | `PLAYWRIGHT_CHANNEL=chrome npm --prefix mobile exec -- playwright test training-category.spec.ts course-profile.spec.ts exam-flow.spec.ts --workers=1` | 36/36，其中新增工种场景 14 项 |
| H5 原子构建 | `node scripts/build.mjs h5` | PASS；原子更新本地 `dist/mobile/` 并保留 PC；有现存 Sass legacy JS API 弃用警告 |
| 差异/脚本检查 | 限定本次路径 `git diff --check`；`node --check tests/learner-training-category.mjs` | PASS |
| 独立代码审查 | reviewer 只读审查本次后端、移动、测试与文档增量 | 未发现遗留实质性问题；不替代运行/真机验收 |

隔离接口覆盖：两条数据库连接同时处理四个列表请求；两个不同首选只有一个成功；相同值重试只有一次首次审计；停用后同值重放；PC 修改、更名及 PC/H5 并发；真实 import-preview/commit 后已有类别只读；严格字段、PC token、角色链接和停用边界。测试启动器已停止自己创建的 API/MySQL/Redis 并删除对应临时目录，没有连接开发数据库。

页面覆盖：选择与取消不写、明确确认只写一次、字符串大 ID 不丢精度、读回锁定、失败就地重试、账号切换、PC 改类后返回刷新且普通草稿保留、不同实名状态提示、静态 scenario 不请求 API。35 项列表实测内层滚动高度 464 / 内容高度 1610，可滚到最后选择；未据此声称微信真机通过。

## 发现并修复

1. 类别列表在事务占连接后调用非事务仓储会再次取连接；单元与真实 2 连接池均先复现失败，再改为身份检查事务结束后调用列表，GREEN。
2. 确认弹层先通知关闭再发确认事件；改为消费一次性确认草稿，取消/刷新/离页/换号清除，实际点击验证通过。
3. 我的页 GET 尚未返回时快速进个人资料，原新增全局 loading 早退让表单无法初始化；浏览器先复现姓名为空，再移除早退，GREEN。
4. 已加载资料后刷新失败缺少就地重试入口；修复并验证保留未保存普通字段。考试卡片始终保留查看须知，不用仅内存中的 attempt 推断恢复资格。

## 范围外失败与未验边界

- 一次扩大组合回归（另含 `static-shell.spec.ts`）为 **67/68**，唯一失败是此前已有并行课程目录用例 `course catalog shows chapter counts, continuous lesson numbers and chapter.lesson codes`：`.chapter-list__section-count` 期待两个元素，实际为 0。该用例和课程目录源码不属于本次改动，未修改；不能声称整个工作区浏览器套件全绿。最终本任务相关三文件 36/36 通过。
- 真实短信、腾讯实名、手机/微信真机、小程序运行、生产部署及生产反向代理未验。没有重启用户的现有开发/生产服务；运行中的旧后端须按其正常启动方式加载新代码。
- 工作区有其他并行修改；审查明确排除年龄/性别/生日、迁移、课程目录、统计、错题与 TabBar 等无关部分。本次只窄改相同文件中的工种增量，保留其余改动。
