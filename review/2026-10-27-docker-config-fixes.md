# Docker 部署配置窄修复

本次范围是用户确认的两项问题：API 容器缺少 COS 配置透传、后端 Dockerfile 构建步骤自复制文件。使用 Astra 分工，两名 worker 独立实施，根智能体整合，独立 reviewer 审查。保留现有品牌初始化及其他工作区改动，不提交、不部署、不修改业务库或云端配置。

## 修改

- Compose 为 API 显式透传现有媒体存储、COS 定位/凭据、上传会话/分片/清理和读取短链配置。默认仍为 `local` / `proxy`；COS 密钥只用于后端运行期，不进入前端镜像构建。
- 后端 Dockerfile 删除 `cp package.json dist/../` 自复制，使用锁文件 `npm ci`，直接从构建阶段复制依赖目录，去掉无用中转。继续保留完整依赖，不把注释误写为仅生产依赖；Node 22 Alpine、PDF/视频工具、健康检查与启动路径保持不变。
- 根 Dockerfile 仍执行 `node scripts/build.mjs web h5`，PC 与学员 H5 继续一起构建。

## 验证边界

已执行：

- 无凭据临时目录复现旧复制命令：源和目标 realpath 相同，`cp` 退出码 1。临时目录已清理。
- `npm --prefix server run build` 通过，`dist/main.js` 和 `dist/seed.js` 均生成；本地 Node 为 v25.9.0。
- `node --test tests/docker-compose-env.test.mjs`：先观察到缺少 `MEDIA_STORAGE_PROVIDER` 的预期失败，修复后 3/3 通过；覆盖 21 项映射的默认/空值/覆盖和前端凭据隔离。这是文件配置回归，不代替 Docker Compose 实际解析。
- `node --test tests/build-orchestrator.test.mjs`：19/19 通过，包含 PC/H5 联合构建编排回归。
- 独立 reviewer 核对四文件最终差异，复跑配置回归 3/3，无实质性发现；限定文件 `git diff --check` 通过。仓库缺少 `.harness/agents/code-reviewer.md`，审查采用 `.codex/skills/requesting-code-review/code-reviewer.md` 作为替代规范。

本机没有可用的 `docker` 命令。本次不能证明 Alpine 镜像构建、Compose 配置的真实解析、容器启动、网络通信或浏览器部署验收成功；不得将本地编译/配置回归扩大为这些结论。

## 尚需完成的 COS 浏览器部署配置

本次两项修复不自动完成 `cos-signed` 的前端部署链路：

- PC/H5 读取直链需要编译期 `VITE_COS_MEDIA_ORIGIN` 与 `VITE_COS_MEDIA_PREFIX`；当前根 Dockerfile 尚未透传这两个公开构建参数。
- `deploy/nginx/default.conf` 的 CSP 尚未把精确 COS origin 加入 `img-src` / `media-src` / `connect-src`。
- 这些前置条件按 `deploy/cos/README.md` 的规则核验，不能使用通配域名，也不能将 COS 密钥放入 `VITE_*`。

本次未自动修改 CSP、桶 CORS、上传权限或生产配置；完整 Docker 部署验收仍待具备 Docker 的环境执行。
