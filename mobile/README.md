# 学员移动端

本工程使用 DCloud 官方 uni-app Vue 3 + TypeScript 模板初始化，后续用于学员 H5，并保持微信小程序编译兼容。

## 官方底座来源

- 模板仓库：<https://github.com/dcloudio/uni-preset-vue/tree/vite-ts>
- 初始化日期：2026-10-22
- 初始化时 `vite-ts` 分支提交：`e5a5f0539416a0f012c919cc77949d140542a367`
- 官方 CLI 文档：<https://uniapp.dcloud.net.cn/quickstart-cli>
- 项目要求：Node.js ≥22，使用 npm 和本目录的 `package-lock.json`。

首次初始化命令：

```bash
git ls-remote https://github.com/dcloudio/uni-preset-vue.git refs/heads/vite-ts
npx degit dcloudio/uni-preset-vue#vite-ts mobile
npm --prefix mobile install
```

后续安装固定依赖：

```bash
npm --prefix mobile ci
```

## 运行与检查

在仓库根目录执行：

```bash
npm --prefix mobile run dev:h5 -- --host 0.0.0.0
npm --prefix mobile run type-check
npm --prefix mobile run build:h5
npm --prefix mobile run build:mp-weixin
```

本次官方空工程验证（2026-10-22，Node.js `v25.9.0`、npm `11.12.1`）：

- `type-check`、`build:h5`、`build:mp-weixin` 均退出 0。
- H5 实际输出目录：`mobile/dist/build/h5/`。
- 微信小程序实际输出目录：`mobile/dist/build/mp-weixin/`。
- 开发验证使用 `npm --prefix mobile run dev:h5 -- --host 0.0.0.0 --port 5174`。
- 在 390×844 浏览器视口打开 `http://localhost:5174/`，官方 logo 与 `Hello` 正常显示；未发现页面错误、未处理的 Promise 拒绝或 `console.error`。

微信小程序构建兼容通过只代表编译成功；真机运行和业务验收属于后续阶段。

当前为官方默认页面底座，尚未安装 Wot UI、Pinia 或接入学员业务。
