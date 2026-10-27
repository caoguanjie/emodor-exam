# COS 真实管理端浏览器验收

日期：2026-10-27。代码基线 `a7d04d5`，本轮未改运行代码。用户已登录 PC/H5，并明确开启 Kimi 扩展文件访问权限。本轮使用现有本地 API、开发数据库、真实 Chrome 与真实 COS；没有替换网络响应或伪造实名。

## 图片直传与课程绑定

在课程管理新建专用草稿 `COS 联调验收（临时 20261026）`（course 2），首页推荐为“否”，未上架。上传 512×256 PNG：1,064 bytes，SHA-256 `ea9a405d15d4fadddf11f77c72738b204ad48e29c6dc24ea500875a8c3fc2647`。

- 浏览器依次完成上传会话、临时授权、COS OPTIONS/PUT 200、完成确认及 ready 查询。
- session `3e58fa36-e811-41a0-ad18-6d3032e5ae7d` 为 simple/completed，receipt 为 ready，asset 17。
- 服务端资产大小及 SHA 与测试原件相同；COS HEAD 200、匿名 HEAD 403。
- 保存后绑定 `training_course_cover:2`；刷新课程页后仍可从 COS 加载封面，图片解码宽度 512。
- 初次请求因旧访问令牌到期返回 401，应用自行 refresh 200 后重试成功；未要求用户再次登录。

## 视频暂停与刷新续传

使用 44,418,893-byte、35 秒 H.264/AAC MP4，分块大小 8,388,608 bytes，共 6 块。仅对测试 PC 标签页临时限制上传为 1 MiB/s，以便观察；上传完成后已恢复不限速。

1. 创建 session `8ea99d45-aecc-49b1-b085-af4c242565e5`，浏览器开始分块 1/2/3 后点击“暂停上传”。页面显示“已暂停”。
2. COS ListParts 独立读回 1/2/3，每块 8,388,608 bytes；40 秒后复查仍只有这三块，未发起后续分块。
3. 实际刷新页面，确认离开未保存课时表单；重新打开同一草稿章节的“新增课时”，重选同一个原文件。
4. 浏览器读取原 session、更新临时授权；没有重新创建上传会话，只发起分块 4/5/6。前后 UploadId 相同，六块 PUT 各执行一次且全部 200，最后一块 2,475,853 bytes。
5. 服务端合并并校验后，页面显示“已就绪 / 0:35”。session completed、receipt ready、asset 18；保存为 lesson 3 / lesson_version 3，引用 `lesson_version_video:3`。
6. 独立完整读取正式 COS 对象：44,418,893 bytes，SHA 同时匹配本地原件和数据库；签名 HEAD 200，匿名 HEAD 403。

暂停会等待已发出的分块结束，再停止调度后续块；本次验证了这一实际行为。刷新续传依赖同一用户重选原文件，本地文件内容没有存入浏览器持久缓存。

保存后重新打开课时预览，浏览器视频源为真实 COS；duration=35、readyState=4、error=null。点击播放后 currentTime 从 0 增长到 6.500348，paused=false。这是管理端预览证据，不能代替 H5 学习会话验收。

## 真实五分钟到期与暂停续播

保持管理端预览弹窗打开，将视频暂停在第 12 秒，按真实时间等待；没有缩短环境 TTL、修改时钟或替换网络响应。

- 初始签名窗 `1793063148;1793063448`，有效 300 秒。
- 到期前 10 秒，应用自动请求 `POST /media/18/preview-ticket`，HTTP 200，取得新签名窗 `1793063438;1793063738`，仍为 300 秒。
- 旧链接到期后实际观察：视频仍为第 12 秒、paused=true、readyState=4、error=null，没有因换源自行播放或丢失位置。
- 随后跳到第 25 秒并播放，2.5 秒后 currentTime=27.44161、paused=false、readyState=4、error=null。新签名下真实 COS Range 请求返回 206。
- 验收后暂停视频并关闭预览，恢复浏览器临时焦点模拟设置。未改变用户媒体域名、权限或 TTL 配置。

证据 `pc-video-natural-renewal.json` 和 `pc-video-renewal-network.json` 只保存时间、状态、签名有效期等脱敏字段。这证明管理端暂停跨过旧链接到期后，自动续签、位置保持与跳转续播可用；不扩大为连续五分钟长视频、H5 学习计时或真机结论。

## Tiptap 题干、选项与解析图片

通过新增试题界面的图片按钮插入测试 PNG，并保存临时题目 56（version 8、revision 1）：

| 位置 | asset | 上传 session |
|---|---|---|
| 题干 | 20 | `3509ca21-a1b9-43da-8c82-2a98c3c689bf` |
| 选项 B | 19 | `ef96eff0-44d5-4957-867f-46d91a738286` |
| 解析 | 21 | `5cfe7a27-4ea1-4f03-ad4d-17e2d13114c0` |

三个会话均为 completed/ready，资产均为 COS/ready，大小及 SHA 匹配原件；三个对象 HEAD 200、匿名 HEAD 403。全部准确绑定 `question_version:8`。

关闭新增表单后打开列表预览，再打开修订表单，三张图片均通过真实 COS 成功加载并解码为 512×256。数据库 `content_json` 的 `stem/options/analysis` 仅持久化媒体资源 ID；独立检查未发现签名 URL、token 或 secret 字段。

测试后已通过正常启停接口将临时题目 56 停用，独立读回 `is_enabled=0`；未删除题目或媒体。临时课程 2 保持 draft，便于复查且不会进入学员课程列表。

## 数据保持与证据

独立 tester 只读复核：新增 asset 17—21 共 5 个，全部 cos/ready、各 1 条引用；原 asset 6、7、9、10、11、12、16 仍全部 cos/ready、各 1 条引用；原课程 1 仍 published。没有修改原课程、重置账号、删本地文件或上传身份材料。

脱敏网络记录、截图和测试素材位于仓库外私有目录：

`/Users/caogj/Documents/emodor/RuleExam-cos-operations/cutover-2026-10-26T11-57-40-950Z/`

其中 `browser-multipart-before-refresh.json`、`browser-multipart-after-refresh.json`、`browser-multipart-final-network.json` 记录分块号、状态和 UploadId 摘要，不包含签名 URL、临时密钥或 Authorization。新增 JSON/截图均收紧为 0600。该目录内原 env/数据库备份仍属私有材料，不提交 Git。

## 待验范围

当前 `learner_identity` 仍为 0 条；H5 开播需要用户本人完成真实实名。此前真实开播返回 40302 的资格门证据仍有效，不能用管理端播放代替学员学习时长、心跳与续期验收。真机、小程序、正式域名/CSP、生产部署和数千人容量也仍待分别验证。

本轮只执行真实交互验收及记录更新，没有运行代码改动，未重复运行已通过的全量单测和构建。
