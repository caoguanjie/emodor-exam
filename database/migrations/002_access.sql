-- 002_access: configurable management permissions and revocable browser sessions.
-- Every step is independently probeable and safe to resume through database/migrate.mjs.

-- @step create_sys_role
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_role' AND TABLE_TYPE = 'BASE TABLE') AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_role') = 7 THEN 1 ELSE 0 END AS complete;
CREATE TABLE IF NOT EXISTS `sys_role` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `is_system` TINYINT NOT NULL DEFAULT 0,
  `status` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_role_code` (`code`),
  KEY `idx_sys_role_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='可配置业务角色';

-- @step create_sys_permission
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_permission' AND TABLE_TYPE = 'BASE TABLE') AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_permission') = 4 THEN 1 ELSE 0 END AS complete;
CREATE TABLE IF NOT EXISTS `sys_permission` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(128) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_permission_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='权限白名单';

-- @step create_sys_role_permission
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_role_permission' AND TABLE_TYPE = 'BASE TABLE') AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_role_permission') = 4 THEN 1 ELSE 0 END AS complete;
CREATE TABLE IF NOT EXISTS `sys_role_permission` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `permission_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_role_permission` (`role_id`, `permission_id`),
  KEY `idx_sys_role_permission_permission` (`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色权限关系';

-- @step create_sys_user_role
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user_role' AND TABLE_TYPE = 'BASE TABLE') AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user_role') = 4 THEN 1 ELSE 0 END AS complete;
CREATE TABLE IF NOT EXISTS `sys_user_role` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_user_role` (`user_id`, `role_id`),
  KEY `idx_sys_user_role_role` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户业务角色关系';

-- @step create_auth_session
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_session' AND TABLE_TYPE = 'BASE TABLE') AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_session') = 9 THEN 1 ELSE 0 END AS complete;
CREATE TABLE IF NOT EXISTS `auth_session` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sid` VARCHAR(64) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `user_agent` VARCHAR(255) NULL,
  `ip_address` VARCHAR(64) NULL,
  `last_seen_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_session_sid` (`sid`),
  KEY `idx_auth_session_user_active` (`user_id`, `revoked_at`),
  KEY `idx_auth_session_last_seen` (`last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='认证会话';

-- Authentication generation/password state/login facts stay in the same
-- A3 migration as the access/session tables so an accepted A1 install has one
-- ordered, resumable upgrade and no second migration ownership boundary.

-- @step add_auth_version
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'auth_version' AND COLUMN_TYPE = 'int unsigned' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '0') THEN 1 ELSE 0 END AS complete;
ALTER TABLE `sys_user` ADD COLUMN `auth_version` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `status`;

-- @step add_force_password_change
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'force_password_change' AND COLUMN_TYPE = 'tinyint' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '0') THEN 1 ELSE 0 END AS complete;
ALTER TABLE `sys_user` ADD COLUMN `force_password_change` TINYINT NOT NULL DEFAULT 0 AFTER `auth_version`;

-- @step add_login_count
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'login_count' AND COLUMN_TYPE = 'int unsigned' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '0') THEN 1 ELSE 0 END AS complete;
ALTER TABLE `sys_user` ADD COLUMN `login_count` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `force_password_change`;

-- @step add_last_login_ip
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'last_login_ip' AND COLUMN_TYPE = 'varchar(64)' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) THEN 1 ELSE 0 END AS complete;
ALTER TABLE `sys_user` ADD COLUMN `last_login_ip` VARCHAR(64) NULL AFTER `last_login_at`;

-- @step add_roles_configured
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'roles_configured' AND COLUMN_TYPE = 'tinyint' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '0') THEN 1 ELSE 0 END AS complete;
ALTER TABLE `sys_user` ADD COLUMN `roles_configured` TINYINT NOT NULL DEFAULT 0 AFTER `last_login_ip`;

-- @step backfill_force_password_change
-- @check SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END AS complete FROM `sys_user` WHERE `force_password_change` <> CASE WHEN `last_login_at` IS NULL THEN 1 ELSE 0 END;
UPDATE `sys_user`
SET `force_password_change` = CASE WHEN `last_login_at` IS NULL THEN 1 ELSE 0 END
WHERE `force_password_change` <> CASE WHEN `last_login_at` IS NULL THEN 1 ELSE 0 END;
