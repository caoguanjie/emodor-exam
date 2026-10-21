-- 000_migration_registry: resumable schema migration metadata.
-- Each boundary has one single-statement completion probe. The runner owns
-- ordering, named-lock serialization, and progress persistence.

-- @step create_registry
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migration' AND TABLE_TYPE = 'BASE TABLE') THEN 1 ELSE 0 END AS complete;
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
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migration' AND COLUMN_NAME = 'progress' AND DATA_TYPE = 'json') THEN 1 ELSE 0 END AS complete;
ALTER TABLE `schema_migration` ADD COLUMN `progress` JSON NULL COMMENT '已验证完成的稳定 step id 数组' AFTER `error_message`;
