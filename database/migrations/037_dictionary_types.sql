-- 独立字典分类；不改写任何 sys_dictionary 字段或既有迁移 checksum。
-- 名称、描述是可编辑元数据；完成探针只保留结构、内置身份和引用完整性。

-- @step create_sys_dictionary_type
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sys_dictionary_type' AND TABLE_TYPE='BASE TABLE' AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_0900_ai_ci') AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sys_dictionary_type')=7 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sys_dictionary_type' AND GENERATION_EXPRESSION='' AND ((COLUMN_NAME='type' AND COLUMN_TYPE='varchar(64)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND CHARACTER_SET_NAME='utf8mb4' AND COLLATION_NAME='utf8mb4_0900_ai_ci') OR (COLUMN_NAME='label' AND COLUMN_TYPE='varchar(128)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND CHARACTER_SET_NAME='utf8mb4' AND COLLATION_NAME='utf8mb4_0900_ai_ci') OR (COLUMN_NAME='description' AND COLUMN_TYPE='varchar(255)' AND IS_NULLABLE='YES' AND COLUMN_DEFAULT IS NULL AND EXTRA='' AND CHARACTER_SET_NAME='utf8mb4' AND COLLATION_NAME='utf8mb4_0900_ai_ci') OR (COLUMN_NAME='sort' AND COLUMN_TYPE='int' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='1000' AND EXTRA='') OR (COLUMN_NAME='is_system' AND COLUMN_TYPE='tinyint' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='0' AND EXTRA='') OR (COLUMN_NAME='created_at' AND COLUMN_TYPE='datetime(3)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='CURRENT_TIMESTAMP(3)' AND EXTRA='DEFAULT_GENERATED') OR (COLUMN_NAME='updated_at' AND COLUMN_TYPE='datetime(3)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='CURRENT_TIMESTAMP(3)' AND EXTRA='DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)')))=7 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sys_dictionary_type')=4 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sys_dictionary_type' AND INDEX_TYPE='BTREE' AND SUB_PART IS NULL AND COLLATION='A' AND IS_VISIBLE='YES' AND ((INDEX_NAME='PRIMARY' AND NON_UNIQUE=0 AND SEQ_IN_INDEX=1 AND COLUMN_NAME='type') OR (INDEX_NAME='uk_sys_dictionary_type_label' AND NON_UNIQUE=0 AND SEQ_IN_INDEX=1 AND COLUMN_NAME='label') OR (INDEX_NAME='idx_sys_dictionary_type_sort' AND NON_UNIQUE=1 AND SEQ_IN_INDEX=1 AND COLUMN_NAME='sort') OR (INDEX_NAME='idx_sys_dictionary_type_sort' AND NON_UNIQUE=1 AND SEQ_IN_INDEX=2 AND COLUMN_NAME='type')))=4 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='sys_dictionary_type')=0 THEN 1 ELSE 0 END AS complete;
CREATE TABLE IF NOT EXISTS `sys_dictionary_type` (
  `type` VARCHAR(64) NOT NULL,
  `label` VARCHAR(128) NOT NULL,
  `description` VARCHAR(255) NULL,
  `sort` INT NOT NULL DEFAULT 1000,
  `is_system` TINYINT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`type`),
  UNIQUE KEY `uk_sys_dictionary_type_label` (`label`),
  KEY `idx_sys_dictionary_type_sort` (`sort`, `type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='字典分类元数据；内置分类仅名称与描述可编辑';

-- @step seed_builtin_dictionary_types
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM sys_dictionary_type WHERE type IN ('question_type','difficulty','learner_source','paper_status','exam_status','question_status','regulation_status') AND is_system=1)=7 THEN 1 ELSE 0 END AS complete;
INSERT INTO `sys_dictionary_type` (`type`, `label`, `sort`, `is_system`) VALUES
  ('question_type', '试题类型', 0, 1),
  ('difficulty', '题目难度', 1, 1),
  ('learner_source', '学员来源', 2, 1),
  ('paper_status', '试卷状态', 3, 1),
  ('exam_status', '考试状态', 4, 1),
  ('question_status', '题目状态', 5, 1),
  ('regulation_status', '制度状态', 6, 1)
ON DUPLICATE KEY UPDATE `type` = `type`;

-- @step backfill_custom_dictionary_types
-- @check SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sys_dictionary WHERE type NOT IN (SELECT type FROM sys_dictionary_type)) THEN 1 ELSE 0 END AS complete;
INSERT INTO `sys_dictionary_type` (`type`, `label`, `sort`, `is_system`)
SELECT DISTINCT `type`, `type`, 1000, 0 FROM `sys_dictionary`
WHERE `type` NOT IN (SELECT `type` FROM `sys_dictionary_type`)
ON DUPLICATE KEY UPDATE `description` = `description`;
