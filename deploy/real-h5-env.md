# H5 真实联调配置

本机统一使用仓库根目录 `.env`。文件已被 Git 忽略，仅在本机保存；`deploy/.env.example` 是可以提交的空值模板。供应商配置只传给后端，不写入 `mobile/` 或前端构建变量。

## 第一次准备

在项目根目录运行（Node.js ≥22）：

```bash
npm --prefix server run env:init
```

初始化工具会：

- 在根目录 `.env` 不存在时创建文件，权限为 `600`；存在时原样保留，不覆盖或轮换密钥。
- 带入已有 `server/.env` 配置；同名终端环境变量优先。初始化工具不自动删除原文件；核对所有变量已迁移后应删除旧 `server/.env`，只维护根目录 `.env`。`start:local` 只加载根目录文件。
- 为缺失的 JWT、考试乱序、AI 配置加密、实名加密、实名查重、媒体票据生成六把独立密钥。已有值继续保留。
- 准备真实短信和腾讯实名开关，关闭调试登录。供应商凭据留空，手工填写。
- 本地数据库默认 `127.0.0.1:3306 / ruleexam / root`，口令为空，Redis 默认 `127.0.0.1:6379`；这与当前本机开发配置一致。其他机器应改成其实际账号，不会自动创建数据库账号。

`.env` 中三组配置分别填写：

| 用途 | 必须填写的变量 | 来源 |
|---|---|---|
| 网易云信验证码 | `YUNXIN_SMS_APP_KEY`、`YUNXIN_SMS_APP_SECRET`、`YUNXIN_SMS_LOGIN_CODE_TEMPLATE_ID` | 云信应用和验证码模板配置 |
| 腾讯身份证 OCR | `TENCENT_ID_CARD_OCR_SECRET_ID`、`TENCENT_ID_CARD_OCR_SECRET_KEY` | 已开通并授权 OCR 的腾讯凭据 |
| 腾讯 FaceID | `TENCENT_FACEID_SECRET_ID`、`TENCENT_FACEID_SECRET_KEY` | 已开通并授权 FaceID 的腾讯凭据 |

保持 `SMS_PROVIDER=yunxin`、`IDENTITY_PROVIDER=tencent`、两个腾讯 `ENABLED=true`、`SERVER_DEBUG_LOGIN_ENABLED=false`。如果初始化带入了旧的 disabled 配置，需要手工改为上述值。

使用长期腾讯凭据时，两个 `TOKEN` 可以不填；使用临时凭据时，需同时配置对应的 `TOKEN` 并管理过期。端点和超时可使用模板中的默认值。

系统密钥已经生成，无需再填。应固定保存，不能每次启动重新生成；带历史加密数据时必须沿用对应密钥。如果所选 `DATA_DIR` 已有加密 AI 配置且未提供原密钥，初始化会停止，避免生成不兼容的 `APP_ENCRYPTION_KEY`。

## 检查和启动

```bash
# 只显示变量名和状态，不显示值；缺项时退出码为 1
npm --prefix server run env:check

# 停止占用 3000 端口的旧后端后运行：检查 → 编译 → 加载根 .env 启动
npm --prefix server run start:local
```

`env:check` 要求真实短信与实名配置齐全。检查只核对必填项、开关及密钥格式，不发送短信、不调用腾讯、不连接数据库，不代表供应商权限或业务验收通过。运行前已在终端 export 的同名变量会覆盖 `.env`，检查与 Node 启动遵循相同优先级。

新命令从仓库根目录启动 API。本地默认 `DATA_DIR=./data`、`UPLOAD_DIR=./data/uploads`、`LOG_DIR=./data/logs`，相对于仓库根目录；如果旧服务使用其他目录，请在 `.env` 中显式保持原路径。

另开终端启动 H5 和 PC：

```bash
npm --prefix mobile run dev:h5
npm --prefix web run dev
```

H5 地址：`http://localhost:5174/mobile/`；PC 地址：`http://localhost:5173/`。各自在独立终端运行。验收顺序为：真实短信登录 → 三图实名 → 视频学习 → 考试提交 → 成绩/记录/错题；先在 PC 准备可用课程、视频、试题与已发布考试。

## 与 Compose 共用变量名

服务器也从 `deploy/.env.example` 创建自己的根目录 `.env`，不要用本地的空口令/root 默认配置部署容器。供应商变量名保持一致，数据库账号使用模板的业务账号并设置非空口令；首次部署还需填写管理员初始口令。

现有 `docker-compose.yml` 已把短信、实名和系统密钥映射到 `api.environment`。Compose 固定 API 使用 `NODE_ENV=production`、`DB_HOST=mysql`、`REDIS_HOST=redis`，本地 `.env` 中相应的开发值不会改变这些固定映射。

```bash
# 创建/更新容器
docker compose --env-file .env up -d --build

# 后续只更改 API 环境变量时，使新值生效
docker compose --env-file .env up -d --no-deps --force-recreate api
```

只改后端环境变量无需重建 H5。`docker compose restart api` 不会重新读取新的容器环境变量。本文件仅说明配置与注入；HTTPS 和数据库部署升级不在本次调整范围。
