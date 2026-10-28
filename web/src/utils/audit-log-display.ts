export type AuditResult = 'success' | 'failure';

export interface AuditLogRow {
  ts: string;
  actor_id: string | number | null;
  actor_name: string;
  action: string;
  object_type: string;
  object_id: string | number | null;
  detail: Record<string, unknown>;
  result: AuditResult;
  source_ip: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  'access.administrator.create': '新增管理员',
  'access.administrator.update': '修改管理员',
  'access.administrator.delete': '删除管理员',
  'access.administrator.reset_password': '重置管理员密码',
  'access.administrator.roles': '调整管理员角色',
  'access.role.create': '新增角色',
  'access.role.update': '修改角色',
  'access.role.delete': '删除角色',
  'system.menu.create': '新增菜单',
  'system.menu.update': '修改菜单',
  'system.menu.delete': '删除菜单',
  'system.dictionary.create': '新增字典项',
  'system.dictionary.update': '修改字典项',
  'system.dictionary.delete': '删除字典项',
  'system.settings.update': '修改网站配置',
  'auth.login': '登录',
  'auth.logout': '退出登录',
  'auth.password.change': '修改密码',
  'auth.session.revoke': '会话吊销',
  'auth.session.force_revoke': '强制下线',
  'auth.mobile.logout': '学员退出登录',
  'identity.verified': '完成实名认证',
  'student.create': '新增学员',
  'student.update': '修改学员',
  'student.avatar': '修改学员头像',
  'student.training_category.confirm': '确认培训类别',
  'student.import.preview': '预检学员导入',
  'student.import.commit': '确认学员导入',
  'user.status': '修改学员状态',
  'training_category.create': '新增培训类别',
  'training_category.update': '修改培训类别',
  'training_category.status': '修改培训类别状态',
  'training_category.delete': '删除培训类别',
  'course.create': '新增课程',
  'course.update': '修改课程',
  'course.publish': '上架课程',
  'course.offline': '下架课程',
  'course.chapter.create': '新增章节',
  'course.chapter.update': '修改章节',
  'course.lesson.create': '新增课时',
  'course.lesson.update': '修改课时',
  'course.lesson.delete': '删除课时',
  'course.lesson.video.replace': '替换课时视频',
  'question_material.create': '上传出题资料',
  'ai.generate': 'AI 生成试题',
  'question.create_manual': '人工新增试题',
  'question.edit': '修订试题',
  'question.set_enabled': '修改试题状态',
  'question.delete': '删除试题',
  'question.import.preview': '预检试题导入',
  'question.import.commit': '确认试题导入',
  'paper.create': '新增试卷',
  'paper.update': '修改试卷',
  'paper.questions.set': '调整试卷题目',
  'paper.publish': '发布试卷',
  'paper.copy': '复制试卷',
  'paper.release.publish': '发布试卷版本',
  'paper.release.withdraw': '撤回试卷发布',
  'training_paper.create': '新增培训试卷',
  'training_paper.update': '修改培训试卷',
  'training_paper.questions.set': '调整培训试卷题目',
  'training_paper.copy': '复制培训试卷',
  'training_paper.delete': '删除培训试卷',
  'exam.start': '开始考试',
  'exam.submit': '提交考试',
  'exam.timeout': '考试超时收口',
  'statistics.export': '导出统计数据',
  'statistics.training.export': '导出培训统计',
  'regulation.version.upload': '上传制度版本',
  'regulation.version.retry': '重试制度解析',
};

const OBJECT_LABELS: Record<string, string> = {
  sys_role: '角色', sys_user: '账号', sys_menu: '菜单', sys_dictionary: '字典项',
  site_setting: '网站配置', auth_session: '在线会话', training_category: '培训类别',
  training_course: '课程', course_chapter: '章节', course_lesson: '课时', lesson_version: '课时版本',
  question_material: '出题资料', question: '试题', import_batch: '导入批次', exam_paper: '试卷',
  paper_release: '试卷版本', exam_record: '考试记录', regulation_version: '制度版本',
  identity_verification_session: '实名核验', statistics: '统计数据', job: '系统任务',
};

const DETAIL_LABELS: Record<string, string> = {
  name: '名称', code: '编码', title: '标题', username: '账号', status: '状态',
  route_path: '页面路由', permission_code: '权限', parent_id: '上级菜单', type: '类型',
  icon: '图标', sort: '排序', role_ids: '角色', category_id: '培训类别',
  before_category_id: '原培训类别', after_category_id: '新培训类别',
  valid_rows: '有效行数', error_rows: '错误行数', duplicate_rows: '重复行数',
  committed_rows: '确认行数', count: '数量', generated: '生成数量', score: '得分',
  timeout: '是否超时', reason: '原因', user_id: '账号 ID', paper_id: '试卷 ID',
};

function moduleFor(action: string): string {
  if (action.startsWith('access.')) return '权限管理';
  if (action.startsWith('system.')) return '系统设置';
  if (action.startsWith('auth.') || action.startsWith('identity.')) return '账号安全';
  if (action.startsWith('student.') || action.startsWith('user.')) return '学员管理';
  if (action.startsWith('training_category.')) return '培训类别';
  if (action.startsWith('course.')) return '课程管理';
  if (action.startsWith('question') || action.startsWith('ai.')) return '试题管理';
  if (action.startsWith('paper.') || action.startsWith('training_paper.')) return '试卷管理';
  if (action.startsWith('exam.')) return '考试记录';
  if (action.startsWith('statistics.')) return '统计分析';
  if (action.startsWith('regulation.')) return '制度资料';
  return '其他';
}

function targetName(detail: Record<string, unknown>): string | null {
  for (const key of ['name', 'title', 'username', 'real_name', 'label']) {
    const value = detail[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function auditActorLabel(row: AuditLogRow): string {
  if (row.actor_name === 'system') return row.actor_id === null ? '系统任务' : `用户 #${row.actor_id}（历史记录）`;
  if (row.actor_id === null) return row.actor_name ? `未认证账号“${row.actor_name}”` : '未知操作人';
  if (row.actor_name.startsWith('learner:')) return `学员 #${row.actor_name.slice('learner:'.length)}`;
  if (row.actor_name.startsWith('user:')) return `用户 #${row.actor_name.slice('user:'.length)}`;
  return row.actor_name || (row.actor_id === null ? '未知' : `用户 #${row.actor_id}`);
}

export function auditPresentation(row: AuditLogRow) {
  const objectLabel = OBJECT_LABELS[row.object_type] || '业务对象';
  const name = targetName(row.detail || {});
  const target = name ? `${objectLabel}“${name}”` : row.object_id === null ? objectLabel : `${objectLabel} #${row.object_id}`;
  return { module: moduleFor(row.action), action: ACTION_LABELS[row.action] || '其他操作', target };
}

function formatDetailValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '无';
  if (key === 'status' && (value === 0 || value === 1)) return value === 1 ? '启用' : '停用';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length ? value.map((item) => String(item)).join('、') : '无';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export interface AuditDetailEntry {
  key: string;
  label: string;
  before?: string;
  after?: string;
  value?: string;
}

export function auditDetailEntries(detail: Record<string, unknown>): AuditDetailEntry[] {
  const changes = detail?.changes;
  if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
    return Object.entries(changes as Record<string, unknown>).flatMap(([key, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const change = value as Record<string, unknown>;
      return [{ key, label: DETAIL_LABELS[key] || key, before: formatDetailValue(key, change.before), after: formatDetailValue(key, change.after) }];
    });
  }
  return Object.entries(detail || {})
    .filter(([key]) => !['name', 'changes'].includes(key))
    .map(([key, value]) => ({ key, label: DETAIL_LABELS[key] || key, value: formatDetailValue(key, value) }));
}

export function formatAuditJson(value: unknown): string {
  return JSON.stringify(value || {}, null, 2);
}
