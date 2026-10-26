/**
 * 服务端唯一权限白名单。权限配置只能选择此处注册的 code，不能通过数据库内容
 * 拼出新权限；resource/action 采用统一的 <resource>:<action> 形式。
 */
export const PERMISSION_CATALOG = [
  'training_categories:read', 'training_categories:write',
  'students:read', 'students:write',
  'ai:read', 'ai:write', 'ai_config:read', 'ai_config:write', 'ai:publish', 'ai:review',
  'questions:read', 'questions:write', 'questions:publish', 'questions:export',
  'papers:read', 'papers:write', 'papers:publish', 'papers:review', 'papers:export',
  'exam_records:read',
  'statistics:read', 'statistics:export',
  'roles:read', 'roles:write',
  'administrators:read', 'administrators:write',
  'sessions:read', 'sessions:write',
  'media:read', 'media:write',
  'courses:read', 'courses:write', 'courses:publish',
  'system_settings:read', 'system_settings:write',
] as const;

export type PermissionCode = (typeof PERMISSION_CATALOG)[number];
export const PERMISSION_SET = new Set<string>(PERMISSION_CATALOG);

export const PERMISSION_NAMES: Record<PermissionCode, string> = {
  'training_categories:read': '查看培训类别',
  'training_categories:write': '维护培训类别',
  'students:read': '查看学员',
  'students:write': '维护学员',
  'ai:read': '查看 AI 任务',
  'ai:write': '发起 AI 出题任务',
  'ai_config:read': '查看 AI 服务配置',
  'ai_config:write': '维护 AI 服务配置',
  'ai:publish': '发布 AI 题目',
  'ai:review': '审核 AI 题目',
  'questions:read': '查看题库',
  'questions:write': '维护题库',
  'questions:publish': '发布题库',
  'questions:export': '导出题库',
  'papers:read': '查看试卷',
  'papers:write': '维护试卷',
  'papers:publish': '发布试卷',
  'papers:review': '审核试卷',
  'papers:export': '导出试卷',
  'exam_records:read': '查看考试记录',
  'statistics:read': '查看统计',
  'statistics:export': '导出统计',
  'roles:read': '查看角色',
  'roles:write': '维护角色',
  'administrators:read': '查看管理员',
  'administrators:write': '维护管理员角色',
  'sessions:read': '查看在线会话',
  'sessions:write': '强制下线会话',
  'media:read': '读取媒体',
  'media:write': '上传媒体',
  'courses:read': '查看课程',
  'courses:write': '维护课程',
  'courses:publish': '发布课程',
  'system_settings:read': '查看系统配置',
  'system_settings:write': '维护系统配置',
};

export function isRegisteredPermission(code: string): code is PermissionCode {
  return PERMISSION_SET.has(code);
}

export const LEGACY_REGULATION_ADMIN_PERMISSIONS: PermissionCode[] = [
  'ai:read', 'ai:write', 'ai:review',
  'questions:read', 'questions:write',
  'papers:read', 'papers:write', 'papers:publish',
  'statistics:read', 'statistics:export',
];
