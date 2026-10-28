# 考试页双行头部验收记录

## 范围与结果

按用户确认的布局及后续视觉反馈，H5 与 MP-WEIXIN 的答题页采用同一个 `ExamTakeHeader.vue`：第一行为白色普通导航，仅返回箭头和居中“在线考试”；第二行为 44px 的全宽考试操作区，左侧以纯文字显示剩余时间，右侧为蓝色文字“交卷”。倒计时去掉时钟图标和圆底，保留原有最后 180 秒数字变红；交卷保留 64×40px 点击区域，文字与进度条右端对齐。进度条、已答数量与草稿提示随后显示。业务操作行不再使用胶囊的右侧占位。

`LiveExamTake.vue` 与 `StaticExamTake.vue` 复用该组件。返回箭头通过 left 插槽发出 exit 事件，继续由原页面弹出退出确认；不启用 `AppTopBar` 的默认返回跳转。交卷仍走原有锁定、确认和提交逻辑。按钮显式保留 button 角色、名称与 aria-disabled，尺寸通过 Wot 的公开 custom-style 传入，避免小程序组件样式隔离影响宽度。

本次保留工作区原有底部 SVG 图标及其他未提交改动，没有修改后端、API、数据库或通用导航组件。

## 设计证据

Pencil 画布 `docs/ui/pen-gemini.pen` 的 12 个当前答题/弹窗/加载失败状态已同步，历史示意画板保留。新增小程序胶囊预览画板 `y0FTL1`；基础单选画板仍为 `XWexD`。头部节点边界检查没有发现越界，并已查看导出图。

导出预览位于本地忽略目录 `gui-test-screenshots/exam-header-20261028/design/`。截至本记录写入时，画布改动尚未保存到本地 .pen：桌面自动审批拒绝访问编辑器窗口，理由是可能读取其他私有内容；已请求仅定位并保存该设计稿的授权，未绕过拦截。

## 已验证

- `npm --prefix mobile run type-check`：通过。
- `PLAYWRIGHT_CHANNEL=chrome npm --prefix mobile run test:e2e -- static-exam.spec.ts exam-flow.spec.ts answer-card-layout.spec.ts --workers=1`：56 项通过，覆盖真实页面的模拟接口交卷、提交结果不确定、退出确认、草稿恢复、到期锁定及静态状态。
- 后续纯文字样式调整后，`PLAYWRIGHT_CHANNEL=chrome npm --prefix mobile run test:e2e -- static-exam.spec.ts --workers=1` 的 37 项通过；最终修正文字右对齐后，额外复核单选静态场景 1 项通过。最新截图为 `gui-test-screenshots/exam-header-20261028/h5-light.png`。
- `node scripts/build.mjs h5` 与 `node scripts/build.mjs mp-weixin`：最终源码均构建通过。
- 独立源码审查发现的按钮辅助语义遗漏已修复并复核通过；首次交卷用例角色查询失败也已修复，随后上述 56 项完整通过。Wot 按钮默认 column 布局影响右对齐的问题，已通过公开 custom-style 的 flex-direction:row 修正，并查看 H5 与小程序最终截图。
- ARM64 微信开发者工具 2.02.2609240、基础库 3.17.4：Pixel 9 与 iPhone 12/13 (Pro) 静态答题页均显示两行头部，标题居中，胶囊与交卷按钮分行且不重叠。iPhone 最终界面已重新编译确认纯文字倒计时与交卷样式；点击返回箭头先弹退出确认，选择继续答题仍留在原页。
- 目标源码 `git diff --check`：通过。

## 边界

小程序仍缺少 VITE_API_ORIGIN，本次验证的是现有静态场景，不是记录 9 的真实登录态考试；未执行真实交卷。模拟器验证不代表手机真机验收。开发者工具 Errors 为 0，仍有既有答题页 WXSS 选择器与资源预加载警告；构建仍有既有 Sass 及循环分块提示。
