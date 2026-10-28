-- 恢复培训试卷撤回发布：仅同步显示字典与列注释，不改任何试卷状态或考试数据。

-- @step seed_paper_withdrawn_dictionary
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM sys_dictionary WHERE type='paper_status' AND code='withdrawn' AND label='已撤回' AND sort=25 AND status=1 AND is_system=1) THEN 1 ELSE 0 END AS complete;
INSERT INTO sys_dictionary (type,code,label,sort,status,is_system,remark)
VALUES ('paper_status','withdrawn','已撤回',25,1,1,'业务固定枚举')
ON DUPLICATE KEY UPDATE label=VALUES(label),sort=VALUES(sort),status=1,is_system=1,remark=VALUES(remark);

-- @step describe_paper_withdrawn_status
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='exam_paper' AND COLUMN_NAME='status' AND COLUMN_TYPE='varchar(16)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='draft' AND COLUMN_COMMENT='draft / published / withdrawn；archived 仅历史兼容') THEN 1 ELSE 0 END AS complete;
ALTER TABLE exam_paper MODIFY COLUMN status VARCHAR(16) NOT NULL DEFAULT 'draft' COMMENT 'draft / published / withdrawn；archived 仅历史兼容';
