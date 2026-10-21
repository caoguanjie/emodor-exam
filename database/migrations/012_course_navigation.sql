-- 012_course_navigation: register the B1 course list in the accepted A5 menu tree.
-- Existing valid course-menu customization is preserved; this migration never rewrites it.

-- @step register_course_menu
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM `sys_menu` WHERE `route_path` = '/admin/courses') = 1 AND (SELECT COUNT(*) FROM `sys_menu` WHERE `route_path` = '/admin/courses' AND `type` = 'menu' AND `permission_code` IS NULL AND `parent_id` IN (SELECT `id` FROM `sys_menu` WHERE `type` = 'directory')) = 1 THEN 1 ELSE 0 END AS complete;
INSERT IGNORE INTO `sys_menu` (`id`, `parent_id`, `name`, `type`, `route_path`, `permission_code`, `icon`, `sort`, `status`) SELECT 19, `id`, '课程管理', 'menu', '/admin/courses', NULL, 'Notebook', 85, 1 FROM `sys_menu` WHERE `id` = 1 AND `type` = 'directory' AND NOT EXISTS (SELECT 1 FROM `sys_menu` WHERE `route_path` = '/admin/courses');
