# 部署图片显示与上传修复

## 根因与线上只读证据

目标：http://caogj.icu:3007/admin/system/site-settings 。实测HTTP 200、nginx/1.27.5，CSP img-src只有self/data/blob，PC缺style-src使内联样式被default-src拒绝。site-config四张公开品牌资产均307重定向到标准COS桶，四个对象直接读取均为200 image/png；因此对象存在，无需重传。未打印或保存到仓库签名查询串。

截图randomUUID错误与gooodwork `.harness/wiki/05-真机排障/Android真机构建故障排查.md:885`相同：HTTP非localhost页面缺原生randomUUID。PC上传hash已有独立SHA256实现，失败发生在生成client_request_id。参考其统一入口策略，新helper原生优先、安全getRandomValues回退，未引入弱随机或新依赖。

## 修改

统一PC运行时UUID入口（上传/设计器五处）；上传未知回执重试和设计器保存重试保留原ID。CSP精确放行COS图片、视频、连接，保留脚本self、object none、frame-ancestors self。构建把公开COS定位同时提供PC/H5和Nginx，校验origin/prefix并阻止混用，凭据不进前端。默认镜像与Compose均从严格模板生成配置，保留nginx原生变量。

H5现有crypto.subtle安全上下文校验未放宽；本次HTTP兼容针对PC上传/设计器，不代替上线HTTPS。

## 验证与交付边界

- UUID/上传/设计器174项回归及web类型检查通过；配置与构建编排48项通过。
- root使用真实生成CSP在Chrome非安全HTTP origin验证：UUID回退可用、指定COS图像/fetch可用、内联样式可用；陌生图像域名和内联脚本仍被阻止。
- PC+H5组合构建通过；独立审查发现Docker漏COPY三个Vite辅助文件，已修复并按Docker COPY清单构造无.env沙箱，组合构建再次通过。最终独立审查无未解决的实质问题。
- 本机无Docker/nginx二进制，未验证真实容器；未修改远程应用服务、桶权限或环境密钥，未上传真实测试文件；仅追加下述精确来源CORS规则。

## 部署

把本次代码同步到服务器，沿用其现有 `.env` 中的COS_BUCKET/COS_REGION/COS_KEY_PREFIX，不需要把密钥写入前端。执行：

```bash
docker compose build nginx
docker compose up -d --no-deps nginx
```

本次只需重建nginx（含PC+H5前端）服务，API不变。旧镜像和旧default.conf挂载不会自动获得修复；compose文件也必须同步。公开VITE配置若显式设置，必须与真实桶和正式media目录一致。

## 线上CORS预检

对已观察到的COS对象执行只读OPTIONS，来源http://caogj.icu:3007、方法PUT、请求头content-type，返回403/AccessForbidden/CORSResponse。说明除代码CSP和UUID修复外，上传还受云端CORS拦截。只读取回现有1条规则，增量提案保存于/tmp/training-caogj-3007-cors-proposal.json（0600），只追加该精确origin，保留原规则；方法GET/HEAD/PUT，请求/暴露头复用仓库cos-preflight的媒体白名单。云端已应用：更新前重新比对原规则快照未变化，保存0600备份/tmp/training-cors-before-update.json，追加后共2条规则；取回核验原规则完整保留。随后对PUT/content-type,x-cos-acl再次预检，返回200并精确允许http://caogj.icu:3007。未改桶ACL/Policy或现有gooodwork规则，未做真实文件PUT。

代码已窄范围同步主目录（19文件逐一一致），保留用户其它文档改动。未提交/推送，未替用户重建远程nginx；当前线上旧CSP和旧前端仍需部署命令替换后才能生效。
