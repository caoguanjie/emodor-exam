# EmodorRuleExam Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前系统的产品名统一为 `EmodorRuleExam`，并把所有 Node 包元数据统一为 `@emodor/RuleExam`，清除仓库文档、配置、源码注释和测试中的旧品牌标识。

**Architecture:** 这是一次产品名称、包元数据和用户界面品牌收敛，不改变业务接口、数据库表结构、部署标识、Cookie、默认连接值或考试/学习行为。面向用户的文本使用 `EmodorRuleExam`；现有机器标识继续保留以兼容已有部署和会话。

**Tech Stack:** Node.js / npm package metadata, NestJS, Vue 3 + Vite, MySQL, Docker Compose, Markdown documentation.

**Spec:** User request in the current conversation.

## Global Constraints

- 产品展示名必须是 `EmodorRuleExam`。
- 包名必须是 `@emodor/RuleExam`。
- 只改名，不改业务 API、数据表、实体字段、考试评分和学习时长规则。
- 数据库、Compose、Cookie、临时目录、测试边界等机器标识保持现有值，避免无迁移的部署或会话中断。
- 不覆盖或清理工作区已有未提交改动；只修改旧名称命中的目标文件。
- 所有敏感值继续只通过环境变量注入，不把凭据写入仓库。

## Review Focus

- 两个子项目的 `package.json` 与各自 lockfile 根元数据必须完全一致，且均为指定包名。
- Web 标题、登录页、改密页和主布局中的品牌文本必须使用 `EmodorRuleExam`。
- Markdown、`AGENTS.md`、评审记录和设计草案中的产品名与引用路径不能残留旧品牌。
- `ruleexam` 仅作为既有数据库/部署/Cookie/测试兼容标识保留，不作为产品展示名；依赖包自身的第三方名称不属于项目命名范围。
- 改名不得引入业务代码编译错误或前端构建错误。

---

### Task 1: Establish the naming contract and update runtime/package metadata

**Files:**
- Modify: `server/package.json`, `server/package-lock.json`
- Modify: `web/package.json`, `web/package-lock.json`
- Modify: `server/src/main.ts`, `server/src/app.module.ts`, `server/Dockerfile`
- Modify: project comments in `database/init.sql`, `database/seed.mjs`, `deploy/.env.example`, and `docker-compose.yml`

**Interfaces:**
- Consumes: existing environment variable overrides and existing package-lock dependency graph.
- Produces: `EmodorRuleExam` display text and exact package name `@emodor/RuleExam`, with existing technical identifiers preserved.

- [x] **Step 1: Run the naming contract audit before editing**

  Run a JSON/package assertion plus a repository search for the old branding. Expected result: FAIL because old references and old package names are present.

- [x] **Step 2: Update package manifests and lockfile root metadata**

  Set the `name` field in both package manifests and both lockfile roots to the exact value `@emodor/RuleExam`; retain versions, scripts, dependencies, `private`, and engines unchanged.

- [x] **Step 3: Update project-owned display labels and comments without changing runtime identifiers**

  Replace project-owned display labels, log labels, and comments with `EmodorRuleExam`; leave database defaults, Compose project/network/container identifiers, refresh-cookie prefix, PDF temp prefix, and test multipart boundaries unchanged.

- [x] **Step 4: Parse manifests and run the focused naming audit**

  Run the package/lock consistency check and confirm the modified runtime files no longer contain the old identifiers.

### Task 2: Update all human-facing documentation and review records

**Files:**
- Modify: `AGENTS.md`, `README.md`, `web/index.html`, `web/src/views/Login.vue`, `web/src/views/ChangePassword.vue`, `web/src/layouts/MainLayout.vue`, `web/src/style.css`
- Modify: `docs/design/*.md`, `docs/demo/演示说明.md`, `docs/superpowers/specs/*.md`
- Modify: `review/*.md`
- Modify: any other tracked or untracked text document returned by the repository-wide naming search

**Interfaces:**
- Consumes: Task 1 naming contract.
- Produces: documentation and visible web UI that consistently name the system `EmodorRuleExam`, while technical compatibility identifiers remain explicit and unchanged.

- [x] **Step 1: Apply the mechanical text rename only to explicitly matched text files**

  Replace the old display spelling and institution brand with `EmodorRuleExam`; preserve technical database/Compose/Cookie/test identifiers, headings, links, evidence, dates, and unrelated third-party package names.

- [x] **Step 2: Re-scan every document and inspect the changed-file list**

  Confirm no old display name or institution brand remains in Markdown, `AGENTS.md`, YAML, Dockerfiles, examples, review records, or visible web UI; confirm the pre-existing deleted/added design documents remain untouched except for matched text.

### Task 3: Verify the rename without changing behavior

**Files:**
- Test: repository-wide naming audit and package metadata assertion (command-level verification; no production test fixture needed for a configuration-only change)

**Interfaces:**
- Consumes: Tasks 1–2 updated names and unchanged application behavior.
- Produces: fresh evidence for metadata consistency, server build/tests, and web build.

- [x] **Step 1: Run the complete repository naming and JSON checks**

  Expected: no old product/display matches outside the explicitly retained technical compatibility identifiers; package manifests and lockfile roots parse and agree on `@emodor/RuleExam`.

- [x] **Step 2: Run server verification**

  Run `cd server && npm test` and `cd server && npm run build`; expected: existing test suite passes and TypeScript build exits 0.

- [x] **Step 3: Run web verification**

  Run `cd web && npm run build`; expected: Vite build exits 0.

- [x] **Step 4: Review the final diff against the pre-existing dirty scope**

  Confirm only naming-related lines plus this plan are new changes; do not stage, commit, push, or remove the user's unrelated work.
