-- 017_exam_question_navigation: split question management and import navigation.
-- Resolve the exam directory by identity, reuse registered route IDs, and leave
-- all unrelated custom menus and existing icon choices untouched.

-- @step register_question_import_menu
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM sys_menu WHERE route_path='/admin/questions/import') = 1 THEN 1 ELSE 0 END AS complete;
INSERT IGNORE INTO sys_menu (parent_id,name,type,route_path,permission_code,icon,sort,status) SELECT id,'试题导入','menu','/admin/questions/import','questions:write','Upload',30,1 FROM sys_menu WHERE name='考试管理' AND type='directory' AND parent_id IS NULL AND NOT EXISTS (SELECT 1 FROM sys_menu WHERE route_path='/admin/questions/import');

-- @step register_question_pages
-- @replaces-check 015_demo_slimming/group_exam_pages
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM sys_menu WHERE parent_id IN (SELECT id FROM sys_menu WHERE name='考试管理' AND type='directory' AND parent_id IS NULL) AND type='menu' AND status=1 AND ((route_path='/admin/questions' AND name='试题管理' AND permission_code IS NULL AND sort=10) OR (route_path='/admin/papers' AND name='试卷管理' AND permission_code='papers:read' AND sort=20) OR (route_path='/admin/questions/import' AND name='试题导入' AND permission_code='questions:write' AND sort=30) OR (route_path='/admin/exam-records' AND name='考试记录' AND permission_code='exam_records:read' AND sort=40))) = 4 THEN 1 ELSE 0 END AS complete;
UPDATE sys_menu SET parent_id=(SELECT id FROM (SELECT id FROM sys_menu WHERE name='考试管理' AND type='directory' AND parent_id IS NULL LIMIT 1) AS selected_group), name=CASE route_path WHEN '/admin/questions' THEN '试题管理' WHEN '/admin/papers' THEN '试卷管理' WHEN '/admin/questions/import' THEN '试题导入' ELSE '考试记录' END, type='menu', permission_code=CASE route_path WHEN '/admin/questions' THEN NULL WHEN '/admin/papers' THEN 'papers:read' WHEN '/admin/questions/import' THEN 'questions:write' ELSE 'exam_records:read' END, sort=CASE route_path WHEN '/admin/questions' THEN 10 WHEN '/admin/papers' THEN 20 WHEN '/admin/questions/import' THEN 30 ELSE 40 END, status=1 WHERE route_path IN ('/admin/questions','/admin/papers','/admin/questions/import','/admin/exam-records');
