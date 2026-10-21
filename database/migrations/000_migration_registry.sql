-- 000_migration_registry: resumable schema migration metadata.
-- Each boundary has one single-statement completion probe. The runner owns
-- ordering, named-lock serialization, and progress persistence.

-- @step create_registry
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migration' AND TABLE_TYPE = 'BASE TABLE') AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migration' AND ((COLUMN_NAME = 'migration_id' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(128)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'checksum' AND DATA_TYPE = 'char' AND COLUMN_TYPE = 'char(64)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'status' AND DATA_TYPE = 'varchar' AND COLUMN_TYPE = 'varchar(16)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = 'applied') OR (COLUMN_NAME IN ('started_at', 'applied_at') AND DATA_TYPE = 'datetime' AND COLUMN_TYPE = 'datetime(3)' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'attempts' AND DATA_TYPE = 'int' AND COLUMN_TYPE = 'int' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '0') OR (COLUMN_NAME = 'error_message' AND DATA_TYPE = 'text' AND COLUMN_TYPE = 'text' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL))) = 7 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migration' AND INDEX_NAME = 'PRIMARY' AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'migration_id' AND INDEX_TYPE = 'BTREE') = 1 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migration' AND INDEX_NAME = 'idx_schema_migration_status' AND NON_UNIQUE = 1 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'status' AND INDEX_TYPE = 'BTREE') = 1 AND ((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migration' AND COLUMN_NAME = 'progress') = 0 OR (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migration' AND COLUMN_NAME = 'progress' AND DATA_TYPE = 'json' AND COLUMN_TYPE = 'json' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) = 1) THEN 1 ELSE 0 END AS complete;
CREATE TABLE IF NOT EXISTS `schema_migration` (
  `migration_id`  VARCHAR(128) NOT NULL,
  `checksum`      CHAR(64)     NOT NULL,
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'applied' COMMENT 'applying / applied / failed',
  `started_at`    DATETIME(3)  NULL,
  `applied_at`   DATETIME(3)  NULL,
  `attempts`      INT          NOT NULL DEFAULT 0,
  `error_message` TEXT         NULL,
  `progress`      JSON         NULL COMMENT '已验证完成的稳定 step id 数组',
  PRIMARY KEY (`migration_id`),
  KEY `idx_schema_migration_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='受控数据库迁移注册表';

-- @step add_progress
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migration' AND COLUMN_NAME = 'progress' AND DATA_TYPE = 'json' AND COLUMN_TYPE = 'json' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) THEN 1 ELSE 0 END AS complete;
ALTER TABLE `schema_migration` ADD COLUMN `progress` JSON NULL COMMENT '已验证完成的稳定 step id 数组' AFTER `error_message`;
