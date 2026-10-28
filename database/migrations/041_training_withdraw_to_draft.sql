-- 培训试卷撤回发布回到可编辑草稿；保留已发布快照和所有考试引用。
-- 不改写历史发布版本、分配、题单、答案、成绩或操作人/时间。

-- @step restore_training_withdrawn_drafts
-- @check SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM exam_paper WHERE business_scope='training' AND status='withdrawn') THEN 1 ELSE 0 END AS complete;
UPDATE exam_paper SET status='draft',updated_at=updated_at WHERE business_scope='training' AND status='withdrawn';

-- @step describe_withdraw_to_draft_status
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='exam_paper' AND COLUMN_NAME='status' AND COLUMN_TYPE='varchar(16)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='draft' AND COLUMN_COMMENT='draft / published；withdrawn / archived 仅历史兼容') THEN 1 ELSE 0 END AS complete;
ALTER TABLE exam_paper MODIFY COLUMN status VARCHAR(16) NOT NULL DEFAULT 'draft' COMMENT 'draft / published；withdrawn / archived 仅历史兼容';
