# 字典分类维护

依据：用户提供的一级字典树、新增分类和编辑分类截图，要求分类增删改查、使用 Element Plus el-tree，并去掉左侧英文编码。延续当前左右布局和字典项业务值。

## 页面

- 左侧搜索框旁新增按钮；el-tree 单层分类（可有“业务字典”分组），节点仅显示分类名称和必要操作，不显示英文 type；保留“全部字典”。节点“…”提供编辑、删除。
- 新增/编辑弹窗仅分类名称（必填，128 字符）、分类描述（选填，255 字符）；类型标识服务端自动生成且不可变。
- 内置分类可以编辑显示名称和描述；内置分类不可删除。自定义分类存在字典项时拒绝删除，空分类可删除；空分类刷新后仍存在。以上保护为本次实现选择，业务枚举原有只读约束保持。
- 右侧字典项表单从已有自定义分类选择，不再通过手输类型隐式创建分类；选中自定义分类时自动带入。保留数据字段、查询、分页、只读保护、未保存提示、缓存刷新和防旧响应覆盖。

## 存储与接口

- 新增 sys_dictionary_type：type VARCHAR(64) 主键；label VARCHAR(128) 唯一；description VARCHAR(255) 可空；sort INT DEFAULT 1000；is_system TINYINT DEFAULT 0；created_at/updated_at DATETIME(3)。无外键。
- 固定七类按既有顺序初始化 sort=0..6、is_system=1；已有自定义 type 回填 label=type、sort=1000，不改任何字典项。新增分类生成 custom_ 前缀不透明标识，label 去首尾空白后必填且唯一。
- GET /admin/dictionaries/types 保留 {items,total}；items={type,label,description,sort,is_system,count}，含空分类和停用字典项数量，按 sort/type 排序。
- POST /admin/dictionaries/types 与 PUT /admin/dictionaries/types/:type 接收 {label,description?}，返回上述单个分类对象；DELETE 同路径删除空的自定义分类。读取 system_settings:read，写入 system_settings:write，严格 DTO/未知字段校验、统一信封及审计。
- 字典项 create/update 必须引用已存在分类；固定 type 仍只读，缺失分类返回明确参数错误。分类与字典项的变更都在事务中先锁定不可删除的 question_type 分类行，避免删除与并发新增/改类产生孤立数据；锁行缺失则失败，不自动修补。
- 迁移 037_dictionary_types.sql 遵守现有逐步可续跑探针协议，DDL/init/entity/设计册一致；不得修改既有迁移 checksum。回填探针不能把可编辑名称/描述当作永久不变量。

## 验收

空分类新增、重载、改名/描述、删除；同名及越权写入拒绝；内置显示名修改不改 type/code/label 等字典项值；非空及内置分类删除拒绝；创建字典项与分类删除并发不会留下孤立记录；迁移保留所有原字典项；el-tree 菜单/弹窗实际浏览器可用且左侧无英文编码。
