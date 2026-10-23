# 课程弹窗与课时管理验收记录

日期：2026-10-23。范围：课程列表、课程资料/章节管理弹窗、课时视频上传与安全删除、移动端课程目录。本地提交按用户单独授权执行，不推送。

## 已实现

- 新建/修改课程按名称、封面、培训类别、简介、首页推荐、排序排列；封面使用 Element Plus 缩略图上传与放大预览。排序保留在表单，不放入列表。
- 取消独立详情页，课程资料和章节管理分别使用弹窗；底部按钮沿用公共 footer。
- 章节内改为列表：编号、课时名称、要求、真实创建时间、视频状态、时长、操作。行操作只有“修改、删除”。显示编号不写回课程名称或排序。
- 修改课时内直接使用 Element Plus 拖拽上传 MP4；保留现有上传校验、进度、处理轮询和重试。保存才追加视频版本，不选新文件保留旧视频；取消不改变课时绑定。上传中/处理失败未清理时阻止保存和无提示离开。
- 新增课时逻辑删除接口，要求写权限和课程归属匹配；上架课程必须先下架。保留版本、媒体引用与学习事实，拒绝删除课时的新开播、短票和心跳。DELETE 回执不明时查询目录核对，不重复发送删除。
- 移动端复用 Wot Collapse：左侧折叠箭头、右侧节数、连续课时序号、章节.课时编号；保留稳定选择 ID、学习进度与完成状态。

## 验证证据

| 范围 | 命令或方式 | 结果 |
| --- | --- | --- |
| PC 单测 | `npm --prefix web test` | 提交前最新 395/395，通过 26 个文件 |
| 待提交快照隔离验证 | 从 Git 暂存树导出独立目录，不混入并发未暂存代码 | PC 单测 388/388；课程/媒体/公共行按钮 Node 回归 38/38；PC 类型检查与后端编译通过。与当前工作区的测试数量差异来自未纳入提交的并发学员用例 |
| 课程/媒体状态 | `cd web && node --test tests/course-detail-state.test.mjs tests/media-upload-component.test.mjs tests/media-upload-state.test.mjs` | 29/29 |
| 迁移契约 | `node --test tests/course-lesson-migration.test.mjs tests/migration-contract.test.mjs` | 40/40，临时隔离数据库已清理 |
| 课程 API | `node tests/run-e2e.mjs --ephemeral --suite training-courses` | 通过；覆盖真实非空学习历史与活动会话、旧票据失效、删除权限/归属/发布状态；临时服务和数据库已清理 |
| 类型检查 | PC `vue-tsc --noEmit`；移动端 `npm --prefix mobile run type-check` | 通过 |
| 移动端单测 | `npm --prefix mobile run test:unit` | 375/375 |
| 移动端桌面浏览器 | `PLAYWRIGHT_CHANNEL=chrome npm --prefix mobile run test:e2e -- static-shell.spec.ts course-profile.spec.ts --workers=1` | 41/41 |
| 发布构建 | `node scripts/build.mjs web h5`，末次 PC 修复后再执行 `node scripts/build.mjs web` | 原子构建通过 |
| PC 界面 | 独立浏览器标签，真实组件与模拟课程/API，禁止保存 | 确认列表列对齐、修改/删除、直接拖拽上传、公共底部按钮；不是实际业务数据验收 |
| 独立代码评审 | 限定本轮课程、媒体与目录文件 | 上传中关闭与 DELETE 回执丢失问题修复后复核通过 |

辅助截图位于本机临时目录：`/tmp/ruleexam-course-lesson-table-20261023.png`、`/tmp/ruleexam-course-lesson-drag-upload-20261023.png`，不入库。

## 本机缺列事故与授权迁移

- 现象：课程列表 API 返回 50001，页面误显示“暂无课程”；只读确认原有课程“产业工人的测试视频”、1 个章节及 1 个课时仍然存在。直接查询复现 `Unknown column 'lesson.deleted_at' in 'where clause'`。原因是依赖新增实体列的后端先于 023 迁移运行，不是数据被删除。
- 用户明确允许执行新增字段迁移后，先使用 `mysqldump --single-transaction` 备份课程相关表和迁移注册表，备份路径为 `/tmp/ruleexam-course-023-backup.ByZrYW/course-before-023.sql`（权限受限，仓库外，不入库）。
- 全量迁移检查发现独立的既有 022 checksum 冲突。未改写其登记值或源码，未重跑 022；使用迁移器公开 `inspectMigrations/applyMigrations` 接口限定 `005_courses` 与 `023_course_lesson_soft_delete`。005 checksum 和全部原表结构探针通过，唯一待执行项为 023；保留迁移锁、活动考试前置检查、进度和完成探针，执行结果只包含 023。
- 023 已登记 applied。迁移前后 `training_course/course_chapter/course_lesson/lesson_version/media_reference/video_learning_record/video_learning_session` 7 张业务表所有旧字段的记录指纹一致；删除课时数为 0，未删除或改写课程、版本、媒体引用及学习事实。
- 迁移后实际管理端列表和详情接口正常，原课程、章节、课时和当前视频版本均返回；独立浏览器页显示原课程、必学课时 1。当前后端已运行新代码，因此未额外重启服务。
- 交付教训：启用包含 `DeleteDateColumn` 的实体前必须先完成兼容的新增列迁移；隔离测试通过不能替代开发库的部署前置核对。

## 视频上传后 403 与预览补验

- 根因：新上传资产 15 已 ready，但尚未保存为课时版本；当前课时仍绑定资产 12。前端上传成功后额外查询 `/media/15`，触发未绑定视频的既有拒绝策略，并非上传失败或原视频丢失。本轮保留该策略，不改后端权限、数据库或视频绑定。
- ready 视频使用上传回执，不再发送这次无效 metadata 查询。本地 MP4 显示首帧缩略图并可打开带 controls 的播放器；已保存视频点击预览后才通过鉴权 content 接口读取，不以 JWT URL 绕过权限。关闭/卸载会取消请求、暂停播放，替换文件忽略旧响应并回收 URL；预览失败不清除绑定。
- 自动化：`npm --prefix web test` 为 26 文件、401/401；`node --test web/tests/media-upload-component.test.mjs` 为 5/5；PC `vue-tsc --noEmit` 通过。新增用例覆盖 ready 未绑定视频无 metadata 请求、旧视频按需预览且不改 v-model、取消/迟到响应、错误重试和卸载清理。取消用例曾发现条件挂载时不能只依赖弹窗 transition close 事件，已改为同步模型监听及 before-close 清理后通过。独立只读审查未发现重大问题。
- 真实 PC 浏览器：通过现有管理会话读取当前视频 content，约 4.36 MiB，MP4 12.167 秒、1024×576，播放器与缩略图 readyState=4，缩略图定位 0.1 秒，播放推进到片尾；未保存课程。独立标签页后台媒体加载暂停时使用浏览器 focus emulation 完成验证，未切走用户活动页。
- 新选择流程的浏览器验证使用同一 MP4 的内存 File，**只模拟上传 ready 回执**，实际组件生成缩略图并播放，本地播放器时间推进；拦截记录只有模拟 POST，无 `/media/15` GET、无错误提示。未对真实业务服务重新上传，也未点击保存。截图位于 `/tmp/ruleexam-video-preview-local-thumbnail-20261023.png` 和 `/tmp/ruleexam-video-preview-saved-decoded-20261023.png`，不入库。
- 本补验不等于真实网络大文件上传、512 MiB 下载、手机真机或生产部署验收。

## 上架课程编辑入口收口

- PC 已上架行仅按发布权限显示“下架”，隐藏“修改课程、章节管理”；草稿和已下架行按原权限恢复编辑及上架入口。下架沿用 published → offline，不改成 draft，也不改数据库已有状态。
- 列表本地入口检查状态；即使旧列表可点击，编辑器拿到已上架详情后也不展示资料/章节编辑内容，父级保存不可用，本地保存处理直接返回。本次只调整 PC 入口，不改变底层版本追加 API 的兼容契约。
- TDD：新增发布状态、上/下架刷新、过期入口测试先出现 5 项预期失败，再修复通过。课程界面 16/16，完整 PC 单测 26 文件、407/407，课程草稿与并发回执 Node 回归 21/21，PC 类型检查通过。未对真实课程执行上下架或其他写入。

## 未验与部署边界

- 本机已获授权执行 023；其他环境仍须先迁移再启用依赖该列的后端。022 checksum 冲突保持未处理，不能称全量迁移检查通过；未改写旧迁移 checksum。
- 未删除、上传或修改真实业务课程，仅按授权追加表字段与相应迁移元数据；未进行手机真机、真实网络大视频上传或生产部署验收。
- 公共后台旧 Node 回归初次有一项学员编辑失败（`:1401` 预期 `false`、实际 `true`）；提交前复跑为 53/59，并发新增的 `StudentAvatar.vue` 令 6 项学员相关测试因 SSR 挂载上下文缺失失败（`Cannot read properties of undefined (reading 'modules')`）。相关学员代码未纳入本轮课程提交，也未扩大修复范围；不能称当前并发工作区全仓回归均通过。
- 服务端全量单测 929/929 与构建由后端执行者运行并报告；本记录的根执行者另行核对了隔离 API 和迁移契约测试的实际输出。自动化与桌面模拟页面不代表真实供应商或设备验收。
