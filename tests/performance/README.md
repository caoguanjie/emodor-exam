# 媒体容量验证

默认只估算，不发出网络请求：

```bash
node tests/performance/media-capacity.mjs --profile media --users 500 --duration-seconds 60 --bitrate-mbps 3
node tests/performance/media-capacity.mjs --profile heartbeat --users 3000 --duration-seconds 60
```

可选 profile 为 media、authz、exam、heartbeat；在线用户数与每秒请求数分别记录。默认媒体每10秒一次请求、签票/心跳每30秒一次；exam 是每个用户执行一次 steps 的集中突发。真实媒体码率与请求间隔必须按测试素材/业务场景设置，默认估算不是容量结论。

显式运行需要仓库外0600场景文件。只允许 `environment: test`，目标为本机或 HTTPS test/staging origin；每个用户独立准备自己的身份和请求步骤，不能把同一个管理员令牌复制为数千学员。场景由测试数据准备阶段生成，包含运行期令牌时不得提交、粘贴到报告或传入命令行。

场景结构为 `{environment,baseUrl,users:[{steps:[{path,method,headers,body}]}]}`，其中 baseUrl 仅为 origin，path 必须以 `/api/v1/` 开头；GET/HEAD/POST 请求支持，禁止跨域跳转。考试登录、开考、交卷分别准备独立场景，或者为已预置考试记录的用户准备有序 steps；本工具不代替业务造数和响应字段提取。

```bash
node tests/performance/media-capacity.mjs --profile authz --users 500 --duration-seconds 60 --scenario /private/test-cohort.json --run
```

按500/1000/3000逐级执行并分别保留聚合报告。脚本记录实际活跃用户、峰值在途请求、请求完成率、错误、响应正文带宽、P95/P99及压测机CPU/内存/事件循环延迟；达到测试截止主动取消的请求单独计数，不当作服务端错误。延迟样本上限10万，以 reservoir 采样后计算分位数，报告包含样本量。DB连接池、服务端CPU/网络、边缘缓存命中率须从测试部署另行采集。

首次测真实媒体分发前须通过 G0。生成器本机瓶颈、没有达到计划并发或缺少服务器指标的结果不能证明后端上限；自动化测试仅验证工具行为，不能宣称实际数千并发通过。
