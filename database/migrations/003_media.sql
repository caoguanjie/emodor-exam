-- 003_media: controlled private media assets, references and profile avatars.
-- Every step is independently probeable and safe to resume through database/migrate.mjs.

-- @step add_sys_user_avatar_id
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'avatar_id' AND COLUMN_TYPE = 'bigint unsigned' AND IS_NULLABLE = 'YES') THEN 1 ELSE 0 END AS complete;
ALTER TABLE `sys_user` ADD COLUMN `avatar_id` BIGINT UNSIGNED NULL COMMENT '受控媒体头像资源 id' AFTER `email`;

-- @step create_media_asset
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_asset' AND TABLE_TYPE = 'BASE TABLE') AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_asset') = 15 THEN 1 ELSE 0 END AS complete;
CREATE TABLE IF NOT EXISTS `media_asset` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_id`      BIGINT UNSIGNED NOT NULL,
  `uploaded_by`   BIGINT UNSIGNED NOT NULL,
  `purpose`       VARCHAR(32) NOT NULL,
  `media_kind`    VARCHAR(16) NOT NULL,
  `original_name` VARCHAR(255) NULL,
  `mime_type`     VARCHAR(128) NOT NULL,
  `storage_key`   VARCHAR(512) NOT NULL,
  `size_bytes`    BIGINT UNSIGNED NOT NULL,
  `sha256`        CHAR(64) NOT NULL,
  `status`        VARCHAR(16) NOT NULL DEFAULT 'processing',
  `duration_ms`   BIGINT UNSIGNED NULL,
  `probe_error`   VARCHAR(512) NULL,
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_asset_storage_key` (`storage_key`),
  KEY `idx_media_asset_owner_purpose` (`owner_id`, `purpose`),
  KEY `idx_media_asset_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='受控媒体资源';

-- @step create_media_reference
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_reference' AND TABLE_TYPE = 'BASE TABLE') AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_reference') = 5 THEN 1 ELSE 0 END AS complete;
CREATE TABLE IF NOT EXISTS `media_reference` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `asset_id`   BIGINT UNSIGNED NOT NULL,
  `owner_type` VARCHAR(64) NOT NULL,
  `owner_id`   BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_reference_owner` (`asset_id`, `owner_type`, `owner_id`),
  KEY `idx_media_reference_asset` (`asset_id`),
  KEY `idx_media_reference_owner` (`owner_type`, `owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='媒体业务引用';

-- @step register_media_permissions
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM `sys_permission` WHERE `code` IN ('media:read', 'media:write')) = 2 THEN 1 ELSE 0 END AS complete;
INSERT INTO `sys_permission` (`code`, `name`) VALUES ('media:read', '读取媒体'), ('media:write', '上传媒体') ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
