-- The 002 backfill was a one-time initialization, not a permanent relationship
-- between password state and login history. Preserve later account changes only
-- after the original backfill has recorded completion; unfinished 002 installs
-- must still run their original initialization through the existing runner.

-- @step password_backfill_final_state
-- @replaces-check 002_access/backfill_force_password_change
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'force_password_change' AND COLUMN_TYPE = 'tinyint' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '0') AND NOT EXISTS (SELECT 1 FROM sys_user WHERE force_password_change NOT IN (0, 1)) AND EXISTS (SELECT 1 FROM schema_migration WHERE migration_id = '002_access' AND status IN ('applied', 'applying', 'failed') AND progress LIKE '%"backfill_force_password_change"%') THEN 1 ELSE 0 END AS complete;
-- A false final-state probe must stop migration, never repair account data.
UPDATE sys_user SET force_password_change = force_password_change WHERE 1 = 0;
