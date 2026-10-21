# MediaUpload 实际接口夹具

启动已有 web Vite 开发服务后访问 `/tests/media-upload-fixture/`。夹具只挂载真实 `MediaUpload` 组件，不提供 fake API，也不写入账号或凭据；请求沿用现有 `http` 实例和浏览器已有登录会话。

建议用例：选择真实 H.264/AAC MP4，观察限制提示、上传进度、处理中轮询、就绪 `asset_id`；再用错误格式、超限文件和断网恢复按钮验证可恢复错误。视频只显示元数据和时长，不下载完整视频 blob。正式 PC 头像/课程页面的验收由根集成任务执行。
