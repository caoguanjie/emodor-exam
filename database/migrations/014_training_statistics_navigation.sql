-- 014_training_statistics_navigation: register the permission-aware dashboard
-- and the C6 training statistics entry without reserving auto-increment ids.

-- @step register_admin_dashboard_menu
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM `sys_menu` WHERE `route_path` = '/admin/dashboard') = 1 AND (SELECT COUNT(*) FROM `sys_menu` WHERE `route_path` = '/admin/dashboard' AND `parent_id` = 1 AND `type` = 'menu' AND `permission_code` IS NULL) = 1 THEN 1 ELSE 0 END AS complete;
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `type`, `route_path`, `permission_code`, `icon`, `sort`, `status`) SELECT 1, '业务首页', 'menu', '/admin/dashboard', NULL, 'Grid', 5, 1 WHERE EXISTS (SELECT 1 FROM `sys_menu` WHERE `id` = 1 AND `type` = 'directory') AND NOT EXISTS (SELECT 1 FROM `sys_menu` WHERE `route_path` = '/admin/dashboard');

-- @step register_training_statistics_menu
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM `sys_menu` WHERE `route_path` = '/admin/training-statistics') = 1 AND (SELECT COUNT(*) FROM `sys_menu` WHERE `route_path` = '/admin/training-statistics' AND `parent_id` = 1 AND `type` = 'menu' AND `permission_code` = 'statistics:read') = 1 THEN 1 ELSE 0 END AS complete;
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `type`, `route_path`, `permission_code`, `icon`, `sort`, `status`) SELECT 1, '培训统计', 'menu', '/admin/training-statistics', 'statistics:read', 'DataAnalysis', 41, 1 WHERE EXISTS (SELECT 1 FROM `sys_menu` WHERE `id` = 1 AND `type` = 'directory') AND NOT EXISTS (SELECT 1 FROM `sys_menu` WHERE `route_path` = '/admin/training-statistics');
