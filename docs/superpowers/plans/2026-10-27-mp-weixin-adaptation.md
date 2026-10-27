# 微信小程序原生适配实施计划

**目标：** 在既有 uni-app 学员端上补齐 MP-WEIXIN 的请求、会话、媒体和原生交互，保留 H5 行为，交付可导入开发者工具的构建及明确真机验收边界。

**授权与范围：** 用户要求完成小程序适配。Astra 分工；当前目录有多个并行编辑任务，限定文件owner，不回退/覆盖、不自动提交；AppID/服务域名为公开配置，不读取凭据。无数据库变化，不新增微信快捷登录或绕过短信/实名/考试权限。

## 接入决定

1. 通用 API 与上传由一个无浏览器依赖的地址解析器处理。H5 保留同源路径；MP 只接受显式 VITE_API_ORIGIN 的 HTTPS origin，路径仅 /api/v1 内，不接受任意URL、跨源、凭据或路径穿越。错误必须可识别，不能一律包装为断网。
2. DCloud文档明确小程序不自动保持Cookie、withCredentials仅H5可用。MP传输层使用仅内存、精确origin/path/name的认证Cookie容器，只接收 mobile auth 响应的 ruleexam_mobile_refresh，且只发往同origin的refresh/logout；不进入storage/Pinia/日志/URL。服务端仍设置HttpOnly/SameSite/Secure，不改变签发与吊销协议。H5仍由浏览器处理HttpOnly Cookie。小程序冷启动需要重新短信登录，这是本期安全取舍；账号切换、迟到响应、退出必须失效隔离。
3. 头像与实名材料用原生uni.uploadFile代理到既有受控后端（后端可存COS），不复用H5 Blob/fetch直传。COS只消费精确配置签名URL；校验不能依赖小程序未保证支持的URL/URLSearchParams，且保留既有拒绝边界。
4. 保留原生videoContext及页面hide/show学习事件，补齐相机/相册权限失败反馈、图片尺寸与类型校验、临时文件清理。考试退出保留本地草稿，不假设微信支持onBackPress绝对拦截。
5. MP导航安全区/微信胶囊、页面生命周期与原生离开提示按实际源码缺口补齐；已有H5动态页面改动原样保留。
6. 构建脚本继续独立mp-weixin产物，不修改PC/H5 dist。加入公开配置示例/检查及开发者工具导入说明；不生成真实AppID、不关闭生产域名校验、不上传发布。

## 分工与验证

- [x] 网络与会话：统一地址解析、原生内存Cookie、JSON/上传接入、账户隔离；先RED测试，覆盖缺配置、错误origin、cookie作用域、轮转/退出/迟到回包，H5行为不变。
- [x] 媒体：无URL全局COS校验、原生picker/清理/权限、视频边界与测试；只读媒体票据不能透传JWT。
- [x] 原生UI与构建：胶囊安全区、原生离页草稿保存、必要配置与文档；编译后检查MP产物不含业务H5 API调用。
- [x] 集成：mobile全量单测/type-check、MP构建、H5构建和相关浏览器回归；本次没有后端实现变动。
- [x] 独立审查并处理实质问题；证据与外部未验边界记入[验收记录](../../../review/2026-10-27-mp-weixin-adaptation.md)，不以编译替代真实验证。

一手依据：https://uniapp.dcloud.net.cn/api/request/request.html（withCredentials仅H5、小程序不自动保持Cookie）；https://uniapp.dcloud.net.cn/component/video.html 。
