# H5 与微信小程序手机照片压缩

## 需求和范围

手机头像选图在原图超过 2000 万像素时提前拒绝，尚未进入缩图。用户要求核对 Wot CLI、uni-app 官方适配说明并修复，随后明确询问实名三图，已一并纳入。保留既有页面、带权限的上传/COS链路、本人现场正脸规则及服务端身份核验，不更改数据库和供应商配置。

## 官方依据

- 已执行项目离线命令 `npm --prefix tools/wot-ui run --silent wot -- doc Upload --version 2.3.2`。Upload 提供 `size-type`、字节限制 `max-size`、`before-upload`/`upload-method` 等扩展；不能据此假设 H5 会自动缩图。
- [uni-app 图片 API](https://uniapp.dcloud.net.cn/api/media/image.html#unicompressimageobject)：`chooseImage.sizeType` 的支持平台不含 H5；`compressImage` 兼容表明确 H5 不支持、微信支持。微信 `compressedWidth/Height` 要求基础库 2.26.0+；`quality` 仅对 JPG 生效。
- [MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)、[Canvas.toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)：浏览器解码及有损编码能力。H5 使用这些原生 API，缺少 bitmap 时使用图片元素兼容路径。

## 最终行为

头像、身份证人像面/国徽面及现场正脸统一接受 JPEG/PNG，选择结果最多 25 MiB、6400 万像素；保持比例，输出最长边不超过 1600、文件不超过 2.1 MiB。超出输入上限提示普通拍照模式。H5 解码前先检查有限 JPEG/PNG 头信息，之后再次校验实际解码尺寸；内存使用仍受设备和浏览器实现影响，不承诺任意高像素均能处理。

小程序先检查原图，再调用原生压缩，复查实际输出格式/宽高/字节，不把回调成功视为已达标。若旧版本忽略缩放参数导致输出超限，明确提示更新微信或使用普通拍照模式。压缩失败只能回退到已验证且自身满足输出约束的小图，不能上传超限原图；同路径覆写失败不回退旧元数据。临时资源遵守原有归属清理。

## 验证

- 52 项针对性单测（26 项行为用例和类型重复执行）、移动端类型检查通过。先复现 48MP 被拒和失败回退问题，再修复。
- 独立 Chrome 合成照片验证，实际加载本地 H5 模块：8000×6000 JPEG → 头像 1600×1200 / 19765 bytes；禁用 createImageBitmap 后 1600×1200 / 21972 bytes；身份证人像面 1600×1200 / 12008 bytes。头像原 blob URL 已释放。合成图字节大小不代表真实手机照片压缩率。
- 微信小程序构建通过（仅编译，公开 API origin 使用示例域名）；生成 `mobile/dist/build/mp-weixin`，确认压缩模块没有 H5 的 createImageBitmap/createElement/toBlob，只保留原生 compressor。未发布、未调用示例域名。
- 独立 reviewer 审查通过；冻结生产文件哈希一致，检查了文件头、解码/压缩失败回退、临时资源归属、同路径覆盖和真实小程序条件编译产物，未发现实质性问题。

没有读取用户真实照片、上传 COS 或调用真实实名服务。H5 手机相册、微信开发者工具/真机和真实供应商由用户验收；浏览器/模拟单测不替代真机结论。
