# RuleExam 的 Wot UI AI 工具

本目录只管理开发辅助工具。学员端方向是 uni-app + Vue 3 + TypeScript + Wot UI v2，优先 H5 与小程序；这里没有创建学员端工程，也没有安装 UI 运行时或配置 MCP。

## 项目级 CLI

`@wot-ui/cli` 固定为 `1.1.0`，依赖安装在本目录的 `node_modules/`。`wot` npm script 直接执行本地文件，不会回退到全局命令或联网临时下载。

在仓库根恢复依赖：

```bash
npm ci --prefix tools/wot-ui --ignore-scripts
```

按需查询（当前文档/数据基线为 Wot UI `2.3.2`）：

```bash
npm --prefix tools/wot-ui run --silent wot -- list button --version 2.3.2 --format json
npm --prefix tools/wot-ui run --silent wot -- info Button --version 2.3.2 --format json
npm --prefix tools/wot-ui run --silent wot -- demo Button --version 2.3.2 --format json
npm --prefix tools/wot-ui run --silent wot -- demo Button demo-1 --version 2.3.2 --format json
npm --prefix tools/wot-ui run --silent wot -- token Button --version 2.3.2 --format json
npm --prefix tools/wot-ui run --silent wot -- doc Button --version 2.3.2
```

先查 Demo 列表，再使用返回的示例名，不假设示例叫 `basic`。`list --format json` 会附带大量组件详情，交给 Agent 时应传关键词缩小结果；只看完整组件目录可使用默认文本格式。CLI `1.1.0` 内置数据包含 `2.3.2`，但其 `latest`/`v2` 别名当前指向 `2.0.4`，所以显式指定版本。未来学员端安装 `@wot-ui/ui` 后，查询版本应跟随其锁文件；线上文档可能先于本地依赖更新，不能静默混用。

## 项目级 Skills

官方来源：[wot-ui/open-wot](https://github.com/wot-ui/open-wot)，固定提交 `fe3c2210c8da8fca0b88cb4f0eed44bfc79b1214`，安装日期 `2026-10-22`。

安装在仓库 `.agents/skills/`，保留上游原文及参考文件，许可证见 [WOT-UI-LICENSE.md](../../.agents/skills/WOT-UI-LICENSE.md)：

| Skill | 按需用途 |
|---|---|
| `wot-ui-v2` | 组件选型、API 查询、Vue 3 + uni-app 页面开发 |
| `wot-ui-cli` | CLI 命令与查询工具使用 |
| `create-wot-ui-theme` | 品牌主题生成 |
| `wot-ui-unocss-preset-guide` | 以后实际采用 UnoCSS 时的接入说明 |

Codex 支持从项目 `.agents/skills/` 发现技能，见[官方说明](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)。新增技能可在下一轮使用；若未显示，重新打开会话或重启客户端。

根 `AGENTS.md` 中的项目规则覆盖上游通用示例：所有 `wot ...` 示例改用本地 npm script；不做全局安装，不运行 MCP 或 `agent init`，不执行 open-wot 仓库自身的发布/数据生成脚本。安装 UnoCSS/主题 Skill 不会自动引入任何业务依赖或修改设计。

## 文档按需读取

1. 命令用法先查本地 `--help`，组件知识优先查本地 CLI。
2. 需要指南、兼容性或缺失内容时，读取 [llms.txt](https://wot-ui.cn/llms.txt)，再打开相关组件/指南链接。
3. 不默认读取 `llms-full.txt`；保持 Agent 初始上下文简短。
4. UI 外观以 `docs/ui/gemini.pen` 为准，API 以匹配版本的 Wot 文档/元数据为准；通用示例不覆盖本项目的考试、实名和服务端结算规则。

## 更新

CLI 升级时显式指定版本并更新本目录锁文件，复验 `list / info / demo / token`。Skills 升级时对比上游固定提交，复核全局安装、MCP 与版本默认值等差异，再更新这份来源记录；不要直接覆盖根 `AGENTS.md` 的项目约束。

参考：[Wot AI 指南](https://wot-ui.cn/guide/ai.html)、[CLI 文档](https://wot-ui.cn/guide/open-wot.html)、[官方 Skills](https://wot-ui.cn/guide/skills.html)。
