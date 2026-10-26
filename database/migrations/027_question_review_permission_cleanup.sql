-- Remove only the retired question review capability. Other review permissions are independent.

-- @step remove_question_review_role_links
-- @check SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sys_role_permission WHERE permission_id IN (SELECT id FROM sys_permission WHERE code='questions:review')) THEN 1 ELSE 0 END AS complete;
DELETE FROM sys_role_permission WHERE permission_id IN (SELECT id FROM sys_permission WHERE code='questions:review');

-- @step remove_question_review_buttons
-- @check SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sys_menu WHERE permission_code='questions:review') THEN 1 ELSE 0 END AS complete;
DELETE FROM sys_menu WHERE permission_code='questions:review';

-- @step remove_question_review_permission
-- @check SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sys_permission WHERE code='questions:review') THEN 1 ELSE 0 END AS complete;
DELETE FROM sys_permission WHERE code='questions:review';
