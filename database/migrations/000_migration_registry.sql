-- 000_migration_registry: resumable schema migration metadata.
-- This migration is intentionally idempotent so an old installation can
-- create the registry before any later schema change is attempted.
CREATE TABLE IF NOT EXISTS `schema_migration` (
  `migration_id`  VARCHAR(128) NOT NULL,
  `checksum`      CHAR(64)     NOT NULL,
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'applied' COMMENT 'applying / applied / failed',
  `started_at`    DATETIME(3)  NULL,
  `applied_at`   DATETIME(3)  NULL,
  `attempts`      INT          NOT NULL DEFAULT 0,
  `error_message` TEXT         NULL,
  PRIMARY KEY (`migration_id`),
  KEY `idx_schema_migration_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='受控数据库迁移注册表';
