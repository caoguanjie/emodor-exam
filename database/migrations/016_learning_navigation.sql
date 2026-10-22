-- 016_learning_navigation: use the approved learning directory label.
-- Preserve the original directory identities, ordering and all other menu data.

-- @step rename_learning_directory
-- @replaces-check 015_demo_slimming/rename_retained_directories
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM sys_menu WHERE id=1 AND name='学习管理' AND type='directory' AND parent_id IS NULL AND sort=20 OR id=2 AND name='系统设置' AND type='directory' AND parent_id IS NULL AND sort=50) = 2 THEN 1 ELSE 0 END AS complete;
UPDATE sys_menu SET name='学习管理' WHERE id=1 AND name='培训管理' AND type='directory' AND parent_id IS NULL;
