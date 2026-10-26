# OpenPencil 试题预览设计检查问题调查

调查日期：2026-10-26。范围为 `docs/ui/openpencil.fig` 中「试题查看与编辑 · 三版对比 · 10-26」页面的 A/B/C 三版，不涉及题库业务代码。

## 结论

截图中的 26 项错误全部是文字对比度不足，设计节点已成功写入。直接原因是生成时用了过浅的颜色，以及交付前只检查文字边界、没有运行 OpenPencil lint。主要责任是本次执行漏检，不能归因于 MCP 连接或笼统归因于 skill。

本地 OpenPencil skill 确实存在版本过时和交付流程缺口，但它已经介绍了 lint，不能称为“没有检查能力”。

## 直接证据

修复前调用 live `lint`（recommended，限定三个画板）返回：26 errors、0 warnings、43 info。错误节点包括展开图标 6 个、拖动手柄 8 个、删除选项 8 个、修改状态 2 个、右栏提示与状态各 1 个。

| 用途 | 原色值 | 检查结果（约） | 本次调整 |
| --- | --- | --- | --- |
| 提示、展开、拖动手柄 | `#909399` | 白底 3.07:1 | `#606266` |
| 删除选项常态 | `#C0C4CC` | 白底 1.74:1 | `#606266` |
| 删除选项悬停 | `#F56C6C` | 浅灰底 2.89:1 | `#B42318` |

执行现场的生成脚本 `/tmp/ruleexam-question-preview-design/build.js:4` 定义浅灰提示色；第 45、49、62、66、95、98 行将这些颜色用于实际控件与提示。第 45、49、62 行以文字字符代替拖动、删除和展开图标，因此这些节点以 TEXT 参与文字对比度检查。

现场检查脚本 `/tmp/ruleexam-question-preview-design/adjust.js:12-15` 只检查文字是否超出父容器边界，没有运行对比度检查。这解释了“边界检查没有问题，但检查面板仍有错误”。以上临时脚本用于本次调查取证，不是项目运行依赖。

官方规则将普通文字门槛设为 4.5:1，大号文字设为 3:1，并对 TEXT 节点执行检查；截图所示控件与提示不满足当前规则。文字字符代替图标也会使图标被按文字检查。W3C 对作为符号使用的字符另有非文字内容说明，因此不能把此工具检查直接等同于完整的产品无障碍认证。[OpenPencil 检查器源码](https://github.com/open-pencil/open-pencil/blob/master/packages/core/src/lint/rules/color-contrast.ts)、[W3C 对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。

## Skill 核对

- `.agents/skills/open-pencil/SKILL.md:23` 仍固定描述 0.12.x、106 个工具；本机实际 `@open-pencil/mcp` 为 0.16.0。
- `.agents/skills/open-pencil/SKILL.md:115-125` 已介绍 lint 命令。执行时漏用现有检查，不能全部归责于 skill。
- `.agents/skills/open-pencil/SKILL.md:197-204` 的 MCP workflow 从修改、导航直接进入保存/导出，没有明确的检查与修复步骤。
- `.agents/skills/open-pencil/SKILL.md:203` 的 `viewport_zoom_to_fit { id }` 与当前工具实际使用的 `ids` 数组不一致。这影响工具调用可靠性，但不是低对比度的原因。

当前官方 skill 要求通过已安装命令帮助和已连接 MCP schema 确认可用能力，并介绍 `lint` 与 `lint_fix`。官方用户指南说明错误、警告、建议是不同等级，对比度需要有意识地调整颜色，不是自动修复所有问题。[官方 skill](https://github.com/open-pencil/open-pencil/blob/master/skills/open-pencil/SKILL.md)、[Checking Designs](https://openpencil.dev/user-guide/checking-designs)。

建议后续更新本地 skill：以实际版本和 schema 为准；交付前执行限定画板的 lint，修复 errors 并说明剩余 warnings/info，再检查导出图与保存状态；使用正式图标节点，避免以字体字符充当工具图标。此次只调查 skill，没有修改技能文件。

## 已修复与验证边界

已调整三个画板中的低对比度颜色，并统一对应关闭图标颜色。未关闭检查规则。修复后：

| 范围 / 预设 | Errors | Warnings | Info |
| --- | ---: | ---: | ---: |
| A/B/C，recommended | 0 | 0 | 43 |
| A/B/C，accessibility | 0 | 0 | 0 |

OpenPencil 实际页面检查面板同时显示 0 错误、0 警告、43 建议。剩余建议为 18 项未使用自动布局和 25 项圆角不在默认规范内；本次没有把它们隐藏，也没有把“零错误”表述为“全部建议已处理”。这些设计仍需按最终选定方案整理组件、布局和图标。

当前 `.fig` 已通过应用 File → Save 保存，标签上的「未保存的更改」已消失。A/B/C PNG 已重新导出至 `docs/ui/question-preview-variants/`。

此次证据只覆盖设计稿检查和保存，不代表试题预览业务代码已经集成、交互已经实现，或真实产品已经完成无障碍验收。
