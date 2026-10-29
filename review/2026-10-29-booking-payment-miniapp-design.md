# 预约支付小程序设计与交互交付记录

日期：2026-10-29。

## 交付内容

- 目标画布：`docs/ui/预约支付.pen`，通过 `pencil-orca` 绑定明确路径操作；原PC共享壳与组件保留。
- 小程序：57个主页面、22个关键状态，共79个可编辑画板；节点对应表为 `docs/ui/预约支付/screen-map.json`。
- 四个底部入口：首页、课程、考试、我的。沿用“海珠区安全教育培训中心”品牌内容。
- 主题：橙红主色、暖白背景、电商式套餐与价格展示。主按钮 `#C9401D` 配白字对比度4.96:1；不新增购物车、优惠券、拼团或会员。
- 设计数据与预览：`docs/ui/预约支付/screens.json`、`preview.html`、`preview.css`、`renderer.js`。
- 浏览器交互入口：<http://127.0.0.1:8766/preview.html>；重启方法见该目录 `README.md` 和 `start-preview.sh`。

## 已执行验证

1. Pencil节点核对：79个页面ID与映射全部对应；通过 `Get` 的布局检查读取全部画板及组件实例，未发现 partially/fully clipped。
2. Pencil截图已检查首页、套餐/下单、预约改期、登录、支付成功、签到、课程、答题、个人中心、退款和确认弹窗等各组代表页面。
3. Kimi真实浏览器点击：98元服务 → 登录与资料 → 实名演示 → 98元订单及微信付款演示 → 11月4日考试预约 → 主动签到 → 定位与照片演示 → 考试须知 → 单选/多选/判断作答 → 主动交卷 → 100分结果，已走通。
4. 原型worker回归：79屏在390px及375px视口无水平溢出、无JS错误；支付异常、改期、新轮次、跨天、正式/模拟隔离、退款暂停等已验证。
5. 独立审查发现的弹窗递归、支付取消、旧轮次污染、跨天旧签到、历史预约改期、正式/模拟串态、动态列表及未付款退款问题已交worker修复并复核。
6. 根复核 `node --check renderer.js`、`sh -n start-preview.sh`、`git diff --check` 通过；79屏全部 `to/back/cancel` 目标有效。
7. 本轮未提交Git、未修改产品业务代码、数据库或真实供应商配置。

## 能力边界与待收口项

- 当前Pencil schema没有原生点击跳转、弹层或路由原型API；`.pen`交付可编辑视觉和状态，真实点击演示通过配套浏览器原型完成。不能把节点context或metadata视为已支持原生交互。
- 微信付款、短信、实名、定位、相机、培训确认和人工退款均为本地演示，没有真实调用。
- 演示考试用3道题覆盖单选、多选、判断；画板里的20题、次数与日期是设计示例，正式运行须读取已发布配置和订单承诺。
- 课程播放与进度是原型状态，不代表真实视频播放或服务端学习时长验收。
- 原生图片Export接口报 `No handler found for method get-file-uri-for-path`，未生成所尝试的导出图；画布内截图与浏览器预览已使用其他有效路径核对。
- 最后一次整理预览入口时，Pencil返回 `Canvas has unsaved changes; save or reload it before MCP editing`。用户要求由Computer Use代为保存。已实际定位Orca的预约支付画布并打开Pencil命令面板；随后键盘／坐标操作及重新获取窗口连续返回 `noWindowsAvailable`、`cgWindowNotFound`，命令搜索框还出现失效元素错误。未重载或关闭画布，未确认保存成功；仍需恢复Computer Use窗口连接后完成保存及最后核对。
- 浏览器页面保留在Kimi“预约支付交互验收”组，用户可继续查看；不自动关闭用户标签。

## 最终交互原型版本

- 独立reviewer最后复核历史记录绑定和已完成预约筛选，无未处理P1/P2阻断。
- `renderer.js` SHA256：`21b0aae2a0508dfeee41fa875b337602f425ced98a0d18e6188f4a36749c10df`。
- `preview.css` SHA256：`3bbfd1aad1a2153d354e1a53ebb3385bef99cad021c5486dd13a5e8c0dc1ccfa`。
- Hero已与Pencil统一为深橙底、白色标题、暖白副文案。
