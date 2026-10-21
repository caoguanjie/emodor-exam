-- 003_media: controlled private media assets, references and profile avatars.
-- Every step is independently probeable and safe to resume through database/migrate.mjs.

-- @step add_sys_user_avatar_id
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'avatar_id' AND DATA_TYPE = 'bigint' AND COLUMN_TYPE = 'bigint unsigned' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) THEN 1 ELSE 0 END AS complete;
ALTER TABLE `sys_user` ADD COLUMN `avatar_id` BIGINT UNSIGNED NULL COMMENT '受控媒体头像资源 id' AFTER `email`;

-- @step create_media_asset
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_asset' AND TABLE_TYPE = 'BASE TABLE' AND ENGINE = 'InnoDB' AND TABLE_COLLATION = 'utf8mb4_0900_ai_ci') AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_asset') = 15 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_asset' AND ((COLUMN_NAME = 'id' AND DATA_TYPE = 'bigint' AND COLUMN_TYPE = 'bigint unsigned' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL AND EXTRA = 'auto_increment') OR (COLUMN_NAME IN ('owner_id', 'uploaded_by') AND DATA_TYPE = 'bigint' AND COLUMN_TYPE = 'bigint unsigned' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'purpose' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(32)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'media_kind' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(16)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'original_name' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(255)' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'mime_type' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(128)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'storage_key' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(512)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'size_bytes' AND DATA_TYPE = 'bigint' AND COLUMN_TYPE = 'bigint unsigned' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'sha256' AND DATA_TYPE = 'char' AND COLUMN_TYPE = 'char(64)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'status' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(16)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = 'processing') OR (COLUMN_NAME = 'duration_ms' AND DATA_TYPE = 'bigint' AND COLUMN_TYPE = 'bigint unsigned' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'probe_error' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(512)' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'created_at' AND DATA_TYPE = 'datetime' AND COLUMN_TYPE = 'datetime(3)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = 'CURRENT_TIMESTAMP(3)') OR (COLUMN_NAME = 'updated_at' AND DATA_TYPE = 'datetime' AND COLUMN_TYPE = 'datetime(3)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = 'CURRENT_TIMESTAMP(3)' AND EXTRA = 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)'))) = 15 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_asset') = 5 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_asset' AND ((INDEX_NAME = 'PRIMARY' AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'id' AND INDEX_TYPE = 'BTREE') OR (INDEX_NAME = 'uk_media_asset_storage_key' AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'storage_key' AND INDEX_TYPE = 'BTREE') OR (INDEX_NAME = 'idx_media_asset_owner_purpose' AND NON_UNIQUE = 1 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'owner_id' AND INDEX_TYPE = 'BTREE') OR (INDEX_NAME = 'idx_media_asset_owner_purpose' AND NON_UNIQUE = 1 AND SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'purpose' AND INDEX_TYPE = 'BTREE') OR (INDEX_NAME = 'idx_media_asset_status' AND NON_UNIQUE = 1 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'status' AND INDEX_TYPE = 'BTREE'))) = 5 THEN 1 ELSE 0 END AS complete;
CREATE TABLE IF NOT EXISTS `media_asset` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_id`      BIGINT UNSIGNED NOT NULL,
  `uploaded_by`   BIGINT UNSIGNED NOT NULL,
  `purpose`       VARCHAR(32) NOT NULL COMMENT 'avatar / course_cover / video / question / answer（仅内部）/ branding',
  `media_kind`    VARCHAR(16) NOT NULL,
  `original_name` VARCHAR(255) NULL,
  `mime_type`     VARCHAR(128) NOT NULL,
  `storage_key`   VARCHAR(512) NOT NULL,
  `size_bytes`    BIGINT UNSIGNED NOT NULL,
  `sha256`        CHAR(64) NOT NULL,
  `status`        VARCHAR(16) NOT NULL DEFAULT 'processing' COMMENT 'processing / ready / failed；deleting 为内部删除重试墓碑',
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
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_reference' AND TABLE_TYPE = 'BASE TABLE' AND ENGINE = 'InnoDB' AND TABLE_COLLATION = 'utf8mb4_0900_ai_ci') AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_reference') = 5 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_reference' AND ((COLUMN_NAME = 'id' AND DATA_TYPE = 'bigint' AND COLUMN_TYPE = 'bigint unsigned' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL AND EXTRA = 'auto_increment') OR (COLUMN_NAME IN ('asset_id', 'owner_id') AND DATA_TYPE = 'bigint' AND COLUMN_TYPE = 'bigint unsigned' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'owner_type' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(64)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'created_at' AND DATA_TYPE = 'datetime' AND COLUMN_TYPE = 'datetime(3)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = 'CURRENT_TIMESTAMP(3)'))) = 5 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_reference') = 7 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_reference' AND ((INDEX_NAME = 'PRIMARY' AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'id' AND INDEX_TYPE = 'BTREE') OR (INDEX_NAME = 'uk_media_reference_owner' AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'asset_id' AND INDEX_TYPE = 'BTREE') OR (INDEX_NAME = 'uk_media_reference_owner' AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'owner_type' AND INDEX_TYPE = 'BTREE') OR (INDEX_NAME = 'uk_media_reference_owner' AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 3 AND COLUMN_NAME = 'owner_id' AND INDEX_TYPE = 'BTREE') OR (INDEX_NAME = 'idx_media_reference_asset' AND NON_UNIQUE = 1 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'asset_id' AND INDEX_TYPE = 'BTREE') OR (INDEX_NAME = 'idx_media_reference_owner' AND NON_UNIQUE = 1 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'owner_type' AND INDEX_TYPE = 'BTREE') OR (INDEX_NAME = 'idx_media_reference_owner' AND NON_UNIQUE = 1 AND SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'owner_id' AND INDEX_TYPE = 'BTREE'))) = 7 THEN 1 ELSE 0 END AS complete;
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
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM `sys_permission` WHERE `code` IN ('media:read', 'media:write') AND `name` = CASE `code` WHEN 'media:read' THEN '读取媒体' WHEN 'media:write' THEN '上传媒体' ELSE '' END) = 2 THEN 1 ELSE 0 END AS complete;
INSERT INTO `sys_permission` (`code`, `name`) VALUES ('media:read', '读取媒体'), ('media:write', '上传媒体') ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
