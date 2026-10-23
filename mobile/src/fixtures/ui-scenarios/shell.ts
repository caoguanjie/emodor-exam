import { ref } from 'vue'

export interface ShellScenario {
  id: string
  group: 'login' | 'home' | 'course' | 'profile' | 'info' | 'about' | 'terms'
  loginState?: 'idle' | 'sent' | 'error' | 'expired' | 'loading' | 'send-failed' | 'help'
  message?: string
  verified?: boolean
  picker?: 'job' | 'gender' | 'birthday'
  hasVideo?: boolean
  collapsedChapters?: string[]
}

export const institution = '海珠区安全教育培训中心'
export const platformSubtitle = '安全教育培训与考试平台'
export const shellScenarios: Record<string, ShellScenario> = {
  'login-default': { id: 'login-default', group: 'login', loginState: 'idle', message: '短信验证码用于验证你的身份' },
  'login-sent': { id: 'login-sent', group: 'login', loginState: 'sent', message: '验证码已发送，请留意手机短信' },
  'login-error': { id: 'login-error', group: 'login', loginState: 'error', message: '验证码错误或已过期，请重新获取' },
  'login-expired': { id: 'login-expired', group: 'login', loginState: 'expired', message: '验证码错误或已过期，请重新获取' },
  'login-loading': { id: 'login-loading', group: 'login', loginState: 'loading', message: '正在验证身份，请稍候' },
  'login-send-failed': { id: 'login-send-failed', group: 'login', loginState: 'send-failed', message: '验证码发送失败，请检查网络后重试' },
  'login-help': { id: 'login-help', group: 'login', loginState: 'help', message: '短信验证码用于验证你的身份' },
  'home-default': { id: 'home-default', group: 'home' },
  'course-list': { id: 'course-list', group: 'course' },
  'course-video': { id: 'course-video', group: 'course', hasVideo: true, collapsedChapters: [] },
  'course-no-video': { id: 'course-no-video', group: 'course', hasVideo: false, collapsedChapters: [] },
  'course-collapsed': { id: 'course-collapsed', group: 'course', hasVideo: false, collapsedChapters: ['hazards'] },
  'profile-default': { id: 'profile-default', group: 'profile', verified: false },
  'profile-unverified': { id: 'profile-unverified', group: 'profile', verified: false },
  'profile-verified': { id: 'profile-verified', group: 'profile', verified: true },
  'profile-info': { id: 'profile-info', group: 'info' },
  'profile-job': { id: 'profile-job', group: 'info', picker: 'job' },
  'profile-gender': { id: 'profile-gender', group: 'info', picker: 'gender' },
  'profile-birthday': { id: 'profile-birthday', group: 'info', picker: 'birthday' },
  'about-default': { id: 'about-default', group: 'about' },
  'terms-default': { id: 'terms-default', group: 'terms' },
}

export function resolveShellScenario(query: unknown, fallback: string): ShellScenario {
  const defaultScenario = shellScenarios[fallback] || shellScenarios['home-default']
  const selected = typeof query === 'string' ? shellScenarios[query] : undefined
  const resolved = selected?.group === defaultScenario.group ? selected : defaultScenario
  return { ...resolved, collapsedChapters: resolved.collapsedChapters ? [...resolved.collapsedChapters] : undefined }
}

export function useShellScenario(fallback: string) {
  const scenario = ref(resolveShellScenario(undefined, fallback))
  function loadScenario(query?: Record<string, unknown>) {
    scenario.value = resolveShellScenario(query?.scenario, fallback)
  }
  return { scenario, loadScenario }
}

export interface StaticCourse {
  id: string
  title: string
  icon: string
  lessonCount: number
  progress: number
}
export const shellCourses: StaticCourse[] = [
  { id: 'hazards', title: '现场隐患排查与整改实训', icon: 'shield-alert', lessonCount: 6, progress: 0 },
  { id: 'health', title: '个人防护与职业健康基础', icon: 'heart-pulse', lessonCount: 6, progress: 0 },
  { id: 'video', title: '课程文件视频示范课', icon: 'video', lessonCount: 1, progress: 100 },
  { id: 'fire', title: '消防与应急逃生训练课', icon: 'flame', lessonCount: 6, progress: 0 },
  { id: 'worker', title: '产业工人安全基础入门课', icon: 'hard-hat', lessonCount: 6, progress: 0 },
  { id: 'course1', title: '课程1', icon: 'book-open', lessonCount: 2, progress: 0 },
]
export interface StaticChapter {
  id: string
  title: string
  lessons: { id: string; title: string; completed: boolean }[]
}
export const hazardChapters: StaticChapter[] = [
  { id: 'hazards', title: '第一章 隐患排查方法', lessons: [
    { id: '1', title: '1.1 隐患排查清单', completed: false },
    { id: '2', title: '1.2 隐患与风险分级', completed: false },
    { id: '3', title: '1.3 整改措施设计', completed: false },
  ] },
  { id: 'closure', title: '第二章 整改闭环', lessons: [
    { id: '4', title: '2.1 责任人与整改时限', completed: false },
    { id: '5', title: '2.2 复查销项', completed: false },
    { id: '6', title: '2.3 隐患数据分析', completed: false },
  ] },
]
export const videoChapters: StaticChapter[] = [{ id: 'video', title: '第一章 课程视频', lessons: [
  { id: 'video1', title: '1.1 课程视频示范课时', completed: true },
] }]
export const shellProfile = { name: '学员演示账号', phone: '13800000000', job: '产业工人', gender: '男', birthday: '2000-01-01', recordCount: 4, wrongCount: 12 }
export function isProfileFieldReadonly(field: 'name' | 'phone' | 'job' | 'gender' | 'birthday'): boolean {
  return field === 'name' || field === 'phone'
}
export const profileTrainingCategories = ['产业工人', '班组长', '管理人员', '电工', '危化品作业人员', '建筑施工安全', '消防安全管理员'].map((name, index) => ({ id: String(index + 1), name }))
export const smsHelp = [
  { title: '确认手机号填写正确', description: '请核对11位手机号，填错可返回修改。' },
  { title: '等待倒计时结束后重发', description: '短信可能延迟，请稍等片刻再重新获取。' },
  { title: '查看短信拦截记录', description: '检查手机是否开启了短信过滤或拦截。' },
]
export const serviceTerms = [
  { title: '一、服务内容', text: '提供课程学习、在线考试、成绩查询及错题回顾等服务。' },
  { title: '二、用户义务', text: '请提供准确资料、妥善保管账号，并遵守平台使用规范。' },
  { title: '三、知识产权', text: '课程、试题及相关资料的使用，应遵守相应授权范围。' },
  { title: '四、隐私保护', text: '个人信息的收集、使用及保护规则，以正式隐私政策为准。' },
  { title: '五、免责声明', text: '服务中断、维护及其他特殊情形的责任，按正式协议约定处理。' },
  { title: '六、协议修改', text: '平台规则发生变更时，将按正式协议约定进行告知。' },
  { title: '七、法律适用', text: '适用法律及争议处理方式，以正式发布的协议内容为准。' },
]
