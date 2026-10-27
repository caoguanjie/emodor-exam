-- 管理员逻辑删除。保留账号唯一键、角色链接及全部业务历史；不回填或删除账号。
-- 普通 DATETIME 列；当前管理员管理查询显式过滤，不全局隐藏历史关联。

-- @step add_administrator_deleted_at
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'deleted_at' AND DATA_TYPE = 'datetime' AND COLUMN_TYPE = 'datetime(3)' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL AND EXTRA = '') THEN 1 ELSE 0 END AS complete;
ALTER TABLE `sys_user` ADD COLUMN `deleted_at` DATETIME(3) NULL COMMENT '管理员逻辑删除；保留账号、角色关系与业务历史' AFTER `roles_configured`;
