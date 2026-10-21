# A2/A3 学员—业务管理员边界修复记录

日期：2026-10-21
基线：`8036b213af014cce1906282f650df8d5b86e19af`
分支：`fix/training-student-admin-boundary`

## 结论

已在 `UsersService` 内把培训学员定义收口为：`sys_user.role=employee` 且不存在任何 `sys_user_role` link。业务角色链接存在即退出学员管理范围，不区分角色当前是否有权限或是否停用。列表/详情使用 SQL 范围过滤；更新、启停、重置密码均在原有事务内先锁用户行，再完成 link 最终检查，继续复用原有认证世代递增、会话吊销和状态保护。

未修改 `access.service.ts`、控制器、管理员页面、共享 `training-access.mjs` 或系统角色/来源权限语义。旧 `/users` mutation 仍走原路径；本人资料接口保持独立。

## TDD 与验证

### RED

先新增 `server/test/training-student-admin-boundary.spec.ts`，运行：

```text
npx vitest run test/training-student-admin-boundary.spec.ts
2 failed, 1 passed
```

失败原因分别是：linked employee 仍出现在学生列表/详情，学生更新仍可写入。普通未链接路径基线已通过。

### GREEN

实现后：

```text
npx vitest run test/training-student-admin-boundary.spec.ts
3 passed
npm run build
tsc -p tsconfig.build.json: passed
npm test
8 files, 41 tests passed
node --check tests/training-student-admin-boundary.mjs
passed
```

独立 ephemeral API/DB 套件通过（运行期随机密钥、run-owned MySQL/Redis，未读 `.env`），命令：

```text
node --input-type=module -e "import path from 'node:path'; import { runSuiteInRuntime } from './tests/run-e2e.mjs'; await runSuiteInRuntime(path.resolve('tests/training-student-admin-boundary.mjs'), true);"
4/4 测试完成
```

该 focused suite 尚未加入共享 `tests/run-e2e.mjs` registry；因本任务禁止改共享启动器，已保留独立 `run(ctx)` 文件并用上述隔离入口实际执行。需要聚合 `--suite all` 时由 root 负责登记。

## 覆盖与锁证据

- 空权限业务角色 link、停用业务角色 link：学生列表排除，详情/更新/启停/重置均返回 40401；DB 中 `password_hash/status/auth_version` 均保持不变。
- 普通无 link 学员：资料更新、停用、重置密码均成功；认证世代和强制改密状态按原逻辑变化。
- 角色赋值先取得用户行锁后提交，再并发 reset：观察到至少 2 个 `performance_schema.data_lock_waits` 后放行；角色赋值成功、reset 返回 40401，密码不变，仅角色赋值递增一代。
- 学员 status 先取得用户行锁后提交，再并发角色赋值：观察到至少 2 个真实 lock waits 后放行；status 与角色赋值均成功，认证世代递增两次，link 落库。两种结果均符合用户行锁线性化，不引入角色预占状态。

## 边界与未覆盖

本次只证明服务端单测、构建及隔离 API/数据库场景；未声称 PC 浏览器、H5、真实设备、生产部署或独立 review 已通过。没有运行开发库、浏览器或真实凭据，也未 push。

## 提交

本记录随 scoped commit 提交；最终 SHA 在交付回报中提供。
