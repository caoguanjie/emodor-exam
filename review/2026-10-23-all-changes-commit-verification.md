# 工作区全部改动提交验证

日期：2026-10-23。用户要求提交所有代码，并使用中文 Conventional Commits。
仅本地提交，不推送，不启动或重启业务服务，不操作真实业务数据。

## 固定输入与范围

- 比较基线：`ecf14a23631d5f073ee1d84aaf89f38429dd071b`。
- 源码候选树：`1471e0d64c44333e73fb5da634ec2b1e42689707`，107 个变更文件。
- 候选导出到 `/tmp/ruleexam-commit-all-20261023.HBphVi`，复用各端现有依赖验证；未带入真实 `.env`、数据库或运行数据。
- 源码、测试、配置、文档、设计稿、技能配置及既有删除记录按主题提交；本记录在源码验证后追加，不改变被验证的源码。
- `.codebase-memory/` 生成缓存和 `outputs/` 题库导出保留本地，不入库。候选文件的私钥、常见云密钥和 JWT 字面量扫描无命中；未读取真实环境凭据。

## 本轮验证

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 固定快照后端 | `npm --prefix server test` | pretest TypeScript 构建通过，62 文件、952/952 |
| 固定快照 PC | `npm --prefix web test` | 26 文件、407/407 |
| 固定快照 PC 类型 | `cd web && ./node_modules/.bin/vue-tsc --noEmit` | 通过 |
| 固定快照学员端类型 | `npm --prefix mobile run type-check` | 通过 |
| 固定快照学员端单测 | `npm --prefix mobile run test:unit` | 40 文件、375/375，类型无错误 |
| 固定快照环境脚本 | `node --test tests/backend-env.test.mjs` | 6/6；测试只使用临时环境文件 |
| 固定快照组合构建 | `node scripts/build.mjs web h5` | 通过，仅更新临时副本的 dist，不覆盖当前网站 |
| 主仓旧 Node 回归 | `node --test web/tests/*.test.mjs` | 220 项中 212 通过、8 失败；运行前 PC 工作区与候选暂存内容一致 |

旧 Node 回归的失败包括：学员管理介绍/操作区、学员公共弹窗、查询与操作区分离、空列表、学员编辑丢弃恢复、无部门字段、创建期间禁用表单、编辑保存期间禁用头像。
失败集中在 `admin-shell-regression.test.mjs` 与 `student-avatar-save.test.mjs`，报错为 `StudentAvatar.vue` 经 SSR 加载时缺少上下文的 `modules`。
本次不修改业务组件或旧测试装载器来消除此类报错，不宣称全仓回归全部通过。

## 提交与验收边界

- 中文提交信息按课程、学员、统计、后台样式、本地联调、设计稿、文档和仓库工具分组。
- 公共 API 和模板字段变化按约定标注 `BREAKING CHANGE`，注明配套升级和重新下载模板；本轮没有新增数据库结构迁移。
- 现有删除只是记录用户工作区中已发生的删除，历史文件仍可从 Git 恢复；未额外删除工作区文件。
- 本轮自动验证不是数据库 E2E、真实供应商、真机、小程序或生产部署验收。
