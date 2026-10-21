-- 010_answers: persistent confirmed drafts, answer media and one idempotent finalizer.
-- Legacy rows without assignment_id keep record_question_id NULL and retain question_id semantics.

-- @step extend_exam_answer_draft
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer') = 12 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer' AND ((COLUMN_NAME = 'record_question_id' AND COLUMN_TYPE = 'bigint unsigned' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'asset_ids' AND DATA_TYPE = 'json' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'gained_score' AND COLUMN_TYPE = 'decimal(5,2)' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'comment' AND DATA_TYPE = 'text' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'grading_version' AND COLUMN_TYPE = 'int unsigned' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '0') OR (COLUMN_NAME = 'updated_at' AND COLUMN_TYPE = 'datetime(3)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = 'CURRENT_TIMESTAMP(3)' AND EXTRA = 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)'))) = 6 THEN 1 ELSE 0 END AS complete;
ALTER TABLE `exam_answer` ADD COLUMN `record_question_id` BIGINT UNSIGNED NULL COMMENT '个人题单项；legacy 无题单记录为 NULL' AFTER `question_id`, ADD COLUMN `asset_ids` JSON NULL COMMENT '已确认图片答案附件 ID' AFTER `selected`, MODIFY COLUMN `gained_score` DECIMAL(5,2) NULL DEFAULT NULL COMMENT '客观题或人工评分；待批图片为 NULL', ADD COLUMN `comment` TEXT NULL AFTER `gained_score`, ADD COLUMN `grading_version` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `comment`, ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER `created_at`;

-- @step extend_exam_record_submission
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_record') = 30 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_record' AND ((COLUMN_NAME = 'draft_revision' AND COLUMN_TYPE = 'int unsigned' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '0') OR (COLUMN_NAME = 'draft_payload_hash' AND COLUMN_TYPE = 'char(64)' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME IN ('draft_saved_at', 'last_heartbeat_at', 'graded_at') AND COLUMN_TYPE = 'datetime(3)' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'device_summary' AND COLUMN_TYPE = 'varchar(255)' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'submission_method' AND COLUMN_TYPE = 'varchar(16)' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL) OR (COLUMN_NAME = 'grading_state' AND COLUMN_TYPE = 'varchar(32)' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = 'not_submitted') OR (COLUMN_NAME = 'grading_revision' AND COLUMN_TYPE = 'int unsigned' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT = '0'))) = 9 THEN 1 ELSE 0 END AS complete;
ALTER TABLE `exam_record` ADD COLUMN `draft_revision` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `submitted_at`, ADD COLUMN `draft_payload_hash` CHAR(64) NULL AFTER `draft_revision`, ADD COLUMN `draft_saved_at` DATETIME(3) NULL AFTER `draft_payload_hash`, ADD COLUMN `last_heartbeat_at` DATETIME(3) NULL AFTER `draft_saved_at`, ADD COLUMN `device_summary` VARCHAR(255) NULL AFTER `last_heartbeat_at`, ADD COLUMN `submission_method` VARCHAR(16) NULL COMMENT 'manual / timeout；历史未知为 NULL' AFTER `device_summary`, ADD COLUMN `grading_state` VARCHAR(32) NOT NULL DEFAULT 'not_submitted' COMMENT 'not_submitted / pending_manual / finalized' AFTER `submission_method`, ADD COLUMN `grading_revision` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `grading_state`, ADD COLUMN `graded_at` DATETIME(3) NULL AFTER `grading_revision`;

-- C2 temporarily stored the personal item id in question_id. Copy it only for
-- rows whose own record has assignment_id; identical numbers in another record
-- or a legacy record never participate.
-- @step copy_snapshot_item_identity
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM exam_answer WHERE exam_record_id IN (SELECT id FROM exam_record WHERE assignment_id IS NOT NULL) AND (record_question_id IS NULL OR (exam_record_id, record_question_id) NOT IN (SELECT record_id, id FROM exam_record_question))) = 0 THEN 1 ELSE 0 END AS complete;
UPDATE exam_answer SET record_question_id = question_id WHERE record_question_id IS NULL AND exam_record_id IN (SELECT id FROM exam_record WHERE assignment_id IS NOT NULL);

-- Establish the item-domain uniqueness before releasing the old source-domain
-- key. This remains the write-safety constraint throughout source restoration.
-- @step index_exam_answer_item
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer' AND INDEX_NAME = 'uk_record_item') = 2 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer' AND INDEX_NAME = 'uk_record_item' AND NON_UNIQUE = 0 AND ((SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'exam_record_id') OR (SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'record_question_id')) AND INDEX_TYPE = 'BTREE' AND SUB_PART IS NULL) = 2 THEN 1 ELSE 0 END AS complete;
CREATE UNIQUE INDEX `uk_record_item` ON `exam_answer` (`exam_record_id`, `record_question_id`);

-- The legacy source key can block a valid permutation (item 500 -> source 501,
-- item 501 -> source 500). Its probe also accepts the fully restored end state,
-- so a completed migration remains re-checkable after the key is recreated.
-- @step drop_legacy_record_question_index
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer' AND INDEX_NAME = 'uk_record_question') = 0 OR ((SELECT COUNT(*) FROM exam_answer WHERE exam_record_id IN (SELECT id FROM exam_record WHERE assignment_id IS NOT NULL) AND (record_question_id IS NULL OR (record_question_id, exam_record_id, question_id) NOT IN (SELECT id, record_id, question_id FROM exam_record_question))) = 0 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer' AND INDEX_NAME = 'uk_record_question') = 2 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer' AND INDEX_NAME = 'uk_record_question' AND NON_UNIQUE = 0 AND ((SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'exam_record_id') OR (SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'question_id')) AND INDEX_TYPE = 'BTREE' AND SUB_PART IS NULL) = 2) THEN 1 ELSE 0 END AS complete;
ALTER TABLE `exam_answer` DROP INDEX `uk_record_question`;

-- Restore question_id to the source-question domain using the same record.
-- An unmapped/cross-record item leaves the completion probe false and the
-- migration fails instead of guessing by coincident numeric identity.
-- @step restore_snapshot_source_identity
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM exam_answer WHERE record_question_id IS NOT NULL AND exam_record_id IN (SELECT id FROM exam_record WHERE assignment_id IS NOT NULL) AND (SELECT COUNT(*) FROM exam_record_question WHERE id = record_question_id AND record_id = exam_record_id) = 1 AND question_id = (SELECT question_id FROM exam_record_question WHERE id = record_question_id AND record_id = exam_record_id)) = (SELECT COUNT(*) FROM exam_answer WHERE exam_record_id IN (SELECT id FROM exam_record WHERE assignment_id IS NOT NULL)) THEN 1 ELSE 0 END AS complete;
UPDATE exam_answer SET question_id = (SELECT question_id FROM exam_record_question WHERE id = record_question_id AND record_id = exam_record_id) WHERE record_question_id IS NOT NULL AND exam_record_id IN (SELECT id FROM exam_record WHERE assignment_id IS NOT NULL) AND question_id <> (SELECT question_id FROM exam_record_question WHERE id = record_question_id AND record_id = exam_record_id);

-- @step restore_legacy_record_question_index
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer' AND INDEX_NAME = 'uk_record_question') = 2 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_answer' AND INDEX_NAME = 'uk_record_question' AND NON_UNIQUE = 0 AND ((SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'exam_record_id') OR (SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'question_id')) AND INDEX_TYPE = 'BTREE' AND SUB_PART IS NULL) = 2 THEN 1 ELSE 0 END AS complete;
CREATE UNIQUE INDEX `uk_record_question` ON `exam_answer` (`exam_record_id`, `question_id`);

-- Existing passed/failed rows with a persisted score are provably finalized.
-- submission_method and graded_at remain NULL because C2 did not record them.
-- @step mark_proven_legacy_finalized
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM exam_record WHERE status IN ('passed', 'failed') AND score IS NOT NULL AND grading_state <> 'finalized') = 0 THEN 1 ELSE 0 END AS complete;
UPDATE exam_record SET grading_state = 'finalized' WHERE status IN ('passed', 'failed') AND score IS NOT NULL AND grading_state <> 'finalized';
