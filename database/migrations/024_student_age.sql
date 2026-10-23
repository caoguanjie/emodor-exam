-- 024_student_age: optional managed age; do not infer birthdays or backfill old profiles.

-- @step age
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sys_user' AND COLUMN_NAME='age' AND DATA_TYPE='tinyint' AND COLUMN_TYPE='tinyint unsigned' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL) THEN 1 ELSE 0 END AS complete;
ALTER TABLE sys_user ADD COLUMN age TINYINT UNSIGNED NULL COMMENT '管理员维护年龄，0-150；不反推生日' AFTER birthday;
