/**
 * 统一错误码表（04 册 §5.2 逐字实现）。
 * code = 0 成功；40xxx 客户端错误；50xxx 服务端错误。
 * 业务码前 3 位与 HTTP 状态码保持段内一致。
 */
export class BizError extends Error {
  constructor(
    public readonly code: number,
    public readonly httpStatus: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'BizError';
  }
}

export const Errors = {
  param: (msg = '参数错误', data?: unknown) => new BizError(40001, 400, msg, data),
  unauthenticated: (msg = '未认证或令牌无效') => new BizError(40101, 401, msg),
  tokenExpired: () => new BizError(40102, 401, '令牌已过期'),
  refreshTokenInvalid: (msg = '刷新令牌无效') => new BizError(40103, 401, msg),
  badCredentials: () => new BizError(40104, 401, '用户名或密码错误'),
  accountDisabled: () => new BizError(40105, 403, '账号已停用'),
  accountLocked: (retryAfterSeconds: number) =>
    new BizError(40106, 429, `账号临时锁定，请 ${retryAfterSeconds} 秒后重试`, { retry_after_seconds: retryAfterSeconds }),
  tokenRevoked: (msg = '令牌已被吊销') => new BizError(40107, 401, msg),
  forbidden: (msg = '无权限访问该资源') => new BizError(40301, 403, msg),
  dataForbidden: (msg = '无权访问该数据') => new BizError(40302, 403, msg),
  notFound: (msg = '资源不存在') => new BizError(40401, 404, msg),
  contentInvisible: (msg = '制度内容不可见') => new BizError(40402, 404, msg),
  notEligible: (msg = '未完成有效学习，暂无考试资格', data?: unknown) => new BizError(40901, 409, msg, data),
  attemptsExhausted: () => new BizError(40902, 409, '补考次数已用尽'),
  alreadyPassed: () => new BizError(40903, 409, '已通过该考试，无需再次作答'),
  examInProgress: (msg = '已有进行中的考试') => new BizError(40904, 409, msg),
  submitConflict: (msg = '交卷冲突，考试已结束') => new BizError(40905, 409, msg),
  sessionConflict: (msg = '学习会话冲突') => new BizError(40906, 409, msg),
  lastSuperAdmin: () => new BizError(40912, 409, '至少保留一名启用的超级管理员'),
  paperQuestionsLocked: () => new BizError(40907, 409, '题目组成不可变更'),
  questionInUse: (msg = '题目正在考试中使用，禁止编辑') => new BizError(40908, 409, msg),
  aiNotConfigured: () => new BizError(40909, 409, 'AI 服务未配置或配置不完整'),
  categoryInactive: (msg = '培训类别不存在或已停用') => new BizError(40910, 409, msg),
  importBatchConflict: (msg = '导入批次已确认，不能更换行集合') => new BizError(40911, 409, msg),
  mediaReferenced: (msg = '媒体仍被业务引用，不能删除') => new BizError(40913, 409, msg),
  systemReferenced: (msg = '系统配置仍被引用，不能删除') => new BizError(40920, 409, msg),
  courseConflict: (msg = '课程状态冲突') => new BizError(40930, 409, msg),
  questionVersionConflict: (msg = '题目版本已变化，请刷新后重试') => new BizError(40940, 409, msg),
  videoSessionConflict: (msg = '视频学习会话已结束或被替换') => new BizError(40950, 409, msg),
  videoUnavailable: (msg = '课程或视频版本当前不可学习') => new BizError(40951, 409, msg),
  mediaRangeInvalid: (msg = '媒体 Range 无效') => new BizError(41601, 416, msg),
  fileFormat: (msg = '文件格式不支持') => new BizError(42201, 422, msg),
  fileTooLarge: (msg = '文件超过大小上限') => new BizError(42202, 422, msg),
  publishCheckFailed: (msg = '发布校验未通过') => new BizError(42203, 422, msg),
  tooManyRequests: (msg = '请求过于频繁') => new BizError(42901, 429, msg),
  internal: (msg = '服务器内部错误', data?: unknown) => new BizError(50001, 500, msg, data),
  aiCallFailed: (msg = 'AI 服务调用失败') => new BizError(50002, 502, msg),
  parseFailed: (msg = '文件解析失败') => new BizError(50003, 500, msg),
  serviceUnavailable: (msg = '服务暂不可用') => new BizError(50004, 503, msg),
  aiTestFailed: (msg = 'AI 连通性测试失败') => new BizError(50005, 502, msg),
};

/** 通用枚举常量（README 3.4 唯一定义源） */
export const RoleEnum = {
  SUPER_ADMIN: 'super_admin',
  REGULATION_ADMIN: 'regulation_admin',
  EMPLOYEE: 'employee',
} as const;
export type Role = (typeof RoleEnum)[keyof typeof RoleEnum];

export const RegulationStatus = { DRAFT: 'draft', PUBLISHED: 'published', ARCHIVED: 'archived' } as const;
export const ParseStatus = { PENDING: 'pending', PARSED: 'parsed', FAILED: 'failed' } as const;
export const FileType = { PDF: 'pdf', DOCX: 'docx' } as const;
export const QuestionType = { SINGLE: 'single', MULTIPLE: 'multiple', JUDGMENT: 'judgment', IMAGE: 'image' } as const;
export const QuestionStatus = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' } as const;
export const QuestionSource = { AI: 'ai', MANUAL: 'manual', IMPORT: 'import' } as const;
export const PaperStatus = { DRAFT: 'draft', PUBLISHED: 'published', ARCHIVED: 'archived' } as const;
export const ExamStatus = {
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  PASSED: 'passed',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
} as const;
