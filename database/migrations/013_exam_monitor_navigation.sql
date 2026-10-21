-- 013_exam_monitor_navigation: register C5 read/monitor permissions and menus.
-- Existing valid route customization is preserved. A conflicting route is not
-- overwritten: the post-statement completion probe fails the migration.

-- @step register_exam_record_permissions
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM `sys_permission` WHERE `code` = 'exam_records:read' AND `name` = '查看考试记录' OR `code` = 'exam_records:monitor' AND `name` = '查看考试监控') = 2 THEN 1 ELSE 0 END AS complete;
INSERT INTO `sys_permission` (`code`, `name`) VALUES ('exam_records:read', '查看考试记录'), ('exam_records:monitor', '查看考试监控') ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- @step register_exam_records_menu
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM `sys_menu` WHERE `route_path` = '/admin/exam-records') = 1 AND (SELECT COUNT(*) FROM `sys_menu` WHERE `route_path` = '/admin/exam-records' AND `parent_id` = 1 AND `type` = 'menu' AND `permission_code` = 'exam_records:read') = 1 THEN 1 ELSE 0 END AS complete;
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `type`, `route_path`, `permission_code`, `icon`, `sort`, `status`) SELECT 1, '考试记录', 'menu', '/admin/exam-records', 'exam_records:read', 'DocumentChecked', 35, 1 FROM `sys_menu` WHERE `id` = 1 AND `type` = 'directory' AND NOT EXISTS (SELECT 1 FROM `sys_menu` WHERE `route_path` = '/admin/exam-records');

-- @step register_exam_monitor_menu
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM `sys_menu` WHERE `route_path` = '/admin/exam-monitor') = 1 AND (SELECT COUNT(*) FROM `sys_menu` WHERE `route_path` = '/admin/exam-monitor' AND `parent_id` = 1 AND `type` = 'menu' AND `permission_code` = 'exam_records:monitor') = 1 THEN 1 ELSE 0 END AS complete;
INSERT IGNORE INTO `sys_menu` (`parent_id`, `name`, `type`, `route_path`, `permission_code`, `icon`, `sort`, `status`) SELECT 1, '考试监控', 'menu', '/admin/exam-monitor', 'exam_records:monitor', 'Monitor', 36, 1 FROM `sys_menu` WHERE `id` = 1 AND `type` = 'directory' AND NOT EXISTS (SELECT 1 FROM `sys_menu` WHERE `route_path` = '/admin/exam-monitor');
