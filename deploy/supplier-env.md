# 给服务器补齐短信和实名认证配置

代码可以通过 Git 更新，真实账号和密钥单独传到服务器。不要把本地 `.env` 整份覆盖服务器：数据库密码、JWT、加密密钥和媒体票据密钥必须保留服务器原值。

本工具需要 Node.js 22 或以上版本，不发送短信、不调用腾讯。所有命令只报告字段名和检查结果，不打印值。

## 1. 本地导出

在项目根目录执行，把结果放到仓库外的新文件中：

```bash
node scripts/supplier-env.mjs export --from .env --out /安全目录/supplier-transfer.env
```

只导出云信短信的 APP_KEY、APP_SECRET、LOGIN_CODE_TEMPLATE_ID，以及腾讯 OCR、FaceID 的 SECRET_ID、SECRET_KEY 和可选 TOKEN。会同时设置短信和实名的启用开关。必要值缺少时停止，不生成半份配置。导出文件仅当前用户可读写，已有文件不会覆盖。

## 2. 安全传给服务器

通过 SSH/SCP 或已有的安全文件传输方式，将文件放到服务器只有部署用户能访问的目录。不要发到聊天、邮件或提交到 Git。传输前确认服务器地址和身份。

## 3. 服务器合并与检查

在服务器项目根目录执行（替换下面的传入文件路径）：

```bash
node scripts/supplier-env.mjs merge --from /安全目录/supplier-transfer.env --to .env &&
node scripts/supplier-env.mjs check --file .env
```

合并只补齐短信和实名字段，允许把关闭开关改为开启。已有非空账号或密钥与传入值不同，会停止并报告字段名，不擅自替换。数据库、COS、系统加密密钥等其他内容保持原样。目标 `.env` 必须已经存在，工具不会替服务器生成或轮换系统密钥。

重复字段、符号链接或复杂多行写法会被拒绝，请先人工整理；支持普通单行引号。合并使用临时文件替换，避免写到一半留下损坏文件。

检查以正式环境为准，要求真实短信和实名配置完整，并检查系统密钥、业务数据库账号及密码。它检查指定文件；终端同名变量若与文件不同会停止，避免 Compose 实际读取了其他值。含美元符号的值必须用单引号包裹，避免被 Compose 当成变量替换。运行 Compose 时也应使用该文件。管理员初始口令只在首次初始化时填写，不是每次启动都必须填写。

## 4. 让配置生效

```bash
node scripts/supplier-env.mjs check --file .env &&
docker compose --env-file .env up -d --no-deps --force-recreate api
docker compose ps
```

只执行 `restart` 不会读取新配置。更新这些后端配置不需要重建前端。实际试一次短信发送、短信登录和实名认证，确认供应商权限与网络也正常。完成后删除两端临时传输文件，保留服务器 `.env`。

配置检查通过不代表真实业务已验收。若服务器没安装 Node，可在具有 Node 22 的受控环境运行工具；不要把秘密配置传入公共在线校验服务。
