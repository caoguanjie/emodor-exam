# C7 独立修整子集验收

## 范围与结论

只验收提前处理的三项独立修整，不代表完整 C7 或培训升级全链验收完成。

- 课程列表从缓存页面返回时刷新，保留筛选、分页及创建草稿；旧请求不能覆盖新列表。
- 课时元数据或视频版本确认保存后同步缺视频提示；旧元数据快照不能推翻较新视频已确认的事实，独立草稿仍保留。
- Compose 的 API 服务转发 `DB_POOL_SIZE`，默认 20，支持显式覆盖。

来源范围：`2001db26ba958f1e5ebfecb42b3eaf2a79b67d96` → `6dec79afc66fde5f5cbca246b3bd97487e091659` → `692fdfb74106c0b23833856cdff4c31fa23e687b`。仅五个文件，无后端业务、SQL 或实体变更。已快进集成到 `feature/training-admin-integration`，未合并主分支或发布。

## 独立审查与修复

初审发现一项 Important：较旧 metadata 响应在较新视频保存后到达，会重新显示缺视频提示。修复保留同课时行中已确认的 `current_version`，不丢弃已确认 metadata，不修改后端发布校验。

真实 SFC 延迟交付测试先复现失败（15/16），修复后 16/16。独立复审结论：该项 ADDRESSED；SpecCompliance 通过，TaskQuality Approved；未发现修复引入的新实质问题。

## 验证

- 实施方：SFC 16/16、vue-tsc、Vite build（1774 modules）、diff check 通过。
- 根智能体在候选分支复跑 SFC：16/16 通过。
- 根智能体在集成分支执行 `node --test tests/docker-compose-env.test.mjs web/tests/course-detail-state.test.mjs`：17/17 通过，exit 0。
- 根智能体检查集成范围 `git diff --check`：exit 0。

这是 SFC 生命周期/响应乱序与配置映射证据，不是实际浏览器、数据库、API 或 Compose 部署验收。本批没有启动上述运行环境，没有读取凭据或改动开发数据库。完整 C7、原定手动选文件及全链 PC 验收仍待后续执行。
