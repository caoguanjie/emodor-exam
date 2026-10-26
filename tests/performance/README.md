# 媒体容量验证

默认只估算，不发出网络请求：

```bash
node tests/performance/media-capacity.mjs --profile media --users 500 --duration-seconds 60 --bitrate-mbps 3
node tests/performance/media-capacity.mjs --profile heartbeat --users 3000 --duration-seconds 60
```

可选 profile 为 media、authz、exam、heartbeat；在线用户数与每秒请求数分别记录。默认媒体每10秒一次请求、签票/心跳每30秒一次；exam 是每个用户执行一次 steps 的集中突发。真实媒体码率与请求间隔必须按测试素材/业务场景设置，默认估算不是容量结论。

显式运行需要仓库外0600场景文件。只允许 `environment: test`，目标为本机或 HTTPS test/staging origin；每个用户独立准备自己的身份和请求步骤，不能把同一个管理员令牌复制为数千学员。场景由测试数据准备阶段生成，包含运行期令牌时不得提交、粘贴到报告或传入命令行。

API 场景结构为 `{environment,baseUrl,users:[{steps:[{path,method,headers,body}]}]}`，其中 baseUrl 仅为 origin，path 必须以 `/api/v1/` 开头；支持 GET/HEAD/POST。考试登录、开考、交卷分别准备独立场景，或者为已预置考试记录的用户准备有序 steps；本工具不代替业务造数和响应字段提取。所有步骤均禁止重定向，CLI 会检查场景文件为0600普通文件。

启用 `cos-signed` 时，可在同一私有场景中增加准确的 `cosMediaOrigin`、`cosMediaPrefix`，并用 `url` 代替 API 步骤的 `path`。下列占位符需在仓库外替换，签名 URL 不得粘贴到报告或命令行：

```json
{
  "environment": "test",
  "baseUrl": "https://api.test.example.com",
  "cosMediaOrigin": "https://<bucket-appid>.cos.<region>.myqcloud.com",
  "cosMediaPrefix": "ruleexam/test/media/",
  "users": [{
    "steps": [{
      "url": "<该测试用户由后端取得的完整 content_url>",
      "method": "GET",
      "headers": { "Range": "bytes=0-1048575" }
    }]
  }]
}
```

COS origin 只接受 HTTPS 标准桶域名，不接受 CDN、自定义域名或带端口、凭据的地址。prefix 只接受 `ruleexam/dev/media/`、`ruleexam/test/media/`、`ruleexam/staging/media/` 或其准确子目录，必须以 `/` 结尾；不能指向桶根、其他项目、实名或暂存上传目录。每条 URL 必须在同一 origin/prefix 下，禁止路径穿越、编码斜线、片段及与 `path` 混用。只允许 GET/HEAD，不允许 body、Authorization、Cookie、API 令牌或对象写入头；可带 Accept、Range 及条件读取头。HEAD 需由对应方法签发的地址，不能假定 GET 签名可改成 HEAD 使用。

工具预检标准 `q-*` 签名参数的形状和有效时间，兼容生产链接的 `response-cache-control`、`versionId`（含字符串 `null`）、其他标准 `response-*` 参数与可选 COS 临时安全令牌。响应参数必须在签名参数列表内。预检不持有签名密钥，不能证明密码学签名正确；真实验签由 COS 执行，拒绝响应会计入错误。所有选中用户、步骤和签名时间窗均在首次 HTTP 请求前校验；签名必须已经生效，且有效期严格晚于整次运行截止时间。

测试学员、权限、培训/考试记录以及正式目录中的视频素材需另行准备。先让每名测试用户取得自己的媒体读取地址，再写入0600场景；本工具不自动登录、提取响应、换票或续期。若当前业务短链有效期不足，应缩短单次运行或另行准备符合现有策略的测试场景，不调整后端短链策略。API 签票/心跳与 COS GET 可以作为有序步骤混合，工具只按预置地址执行，前一步返回值不会动态填入后一步。

```bash
node tests/performance/media-capacity.mjs --profile authz --users 500 --duration-seconds 60 --scenario /private/test-cohort.json --run
```

按500/1000/3000逐级执行并分别保留聚合报告。脚本记录实际活跃用户、峰值在途请求、请求完成率、错误、响应正文带宽、P95/P99及压测机CPU/内存/事件循环延迟；达到测试截止主动取消的请求单独计数，不当作服务端错误。延迟样本上限10万，以 reservoir 采样后计算分位数，报告包含样本量。DB连接池、服务端CPU/网络、边缘缓存命中率须从测试部署另行采集。

响应正文按流累加字节，不把视频整体读入内存；混合场景中的 API 正文也包含在总字节数内。GET 会尽快读取指定对象或 Range，这个吞吐不是播放器按实际码率持续播放的模拟；`bitrate-mbps` 仅用于默认估算，不对请求限速。`activeUsers` 是实际进入流程的用户数，须结合 `peakInFlight` 判断是否达到目标并发，不能直接当作同时播放连接数。报告不含场景路径、URL、令牌、签名或请求正文。

首次测真实媒体分发前须通过 G0。签名直读的字节从 COS 到生成器，API/数据库压力须通过签票、心跳、考试步骤另测，并同步记录服务端 CPU、DB 连接池、网络和 COS 指标。生成器自身的连接池、带宽、CPU、内存或事件循环可能先达到限制；没有达到计划并发或缺少服务器指标的结果不能证明后端上限。自动化测试仅验证工具行为，没有执行真实容量测试，不能宣称实际3000并发通过。
