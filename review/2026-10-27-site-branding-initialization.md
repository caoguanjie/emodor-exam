# 新环境 COS 品牌初始化

## 范围与实现

- `database/init.sql` 为新库写入当前 Logo 和三张轮播图的完整 COS 媒体元数据、网站配置、四条 `site_config` 引用。沿用现有轮播顺序：实践、数字化、课堂。
- 仅当 Logo、轮播两项配置均不存在时导入，同一事务完成；已有配置、用户调整的排序、主动清空均保留。媒体 ID 由目标库分配，JSON 使用字符串 ID，不沿用源库编号。
- 只引用现有私有 COS 对象，不上传或复制文件，不保存签名 URL 或凭据。表结构未变，不增加或改写历史迁移；实体不需变更。
- `MediaService` 与 `CosMediaStorage.remove` 共同保护精确的四个共享对象。前者允许本环境回收已无引用的媒体行，后者覆盖迁移回滚/候选清理的直接存储调用。普通对象仍正常删除，公开访问仍检查当前配置和引用。
- 保留用户其他工作区修改，没有改动当前业务库、现有站点配置或 COS 对象，没有重启当前服务。

## 验证

- 先观察新库 Logo 缺失、清理删除共享原件、存储层直接删除共享原件三项失败，再实施修复。
- `npm --prefix server test`：构建通过，90 个文件、1417 项测试通过。
- `node --test tests/site-branding-init.test.mjs`：自有临时 MySQL/Redis，验证初始化、重复执行、保留自定义排序/清空、超过 JavaScript 安全整数范围的媒体 ID、引用归属，以及真实 TypeORM + 业务服务的公开访问授权/签发。先构建 server；不读取业务库连接环境变量。
- `VERIFY_BRANDING_COS=1 node --env-file=.env --test tests/site-branding-init.test.mjs`：显式开启真实云只读验证，仍使用临时数据库；仅将 COS 凭据用于四张默认图的签名 GET。四张图均 HTTP 200，长度与 SHA-256 匹配；测试不打印签名 URL/凭据。
- `node tests/run-e2e.mjs --ephemeral --suite training-system`：通过。
- `node tests/run-e2e.mjs --ephemeral --suite cos-media-schema`：通过；上传会话测试改为核对媒体数量不增，而非假设初始媒体表为空。
- 独立评审发现的迁移清理绕过问题已由存储层兜底修复，并补直接适配器回归。

## 部署条件与边界

新环境需要同一桶/地域的读取权限，且 `COS_KEY_PREFIX` 覆盖现有 `ruleexam/dev/media/` 路径（当前示例为 `ruleexam/dev/`）；`MEDIA_STORAGE_PROVIDER=cos`、`MEDIA_DELIVERY_MODE=cos-signed`。使用其它桶或纯本地存储时，应在网站配置替换默认图片。所有共享环境须更新到带删除保护的服务版本；旧服务仍可能按本环境引用计数删除云端原件。

本次证明新库数据可通过实际业务授权/签发服务读取真实 COS 图片，不代表新环境已经部署，也不代表浏览器或真机完成了新环境验收。
