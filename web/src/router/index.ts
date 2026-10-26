import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import {
  COURSE_ROUTE_PERMISSIONS, QUESTION_ROUTE_PERMISSIONS, defaultHomePath, postAuthPath, routeAccessAllowed,
  isRetiredAdminPath, isRetiredLegacyPaperLocation, validPostAuthRedirect,
} from './access';

/**
 * 路由守卫承载前端侧访问控制（02 册 3.1 选型理由 3 双层防线）：
 * 登录态校验 + 首登强制改密 + 角色路由拦截；后端守卫负责最终安全。
 */
const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('../views/Login.vue'), meta: { public: true } },
  { path: '/change-password', component: () => import('../views/ChangePassword.vue') },
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    children: [
      // ---- 学习端 ----
      { path: 'my/regulations', component: () => import('../views/employee/MyRegulations.vue'), meta: { title: '我的制度' } },
      { path: 'my/regulations/:id/read', component: () => import('../views/employee/Reading.vue'), meta: { title: '在线学习' } },
      { path: 'my/scores', component: () => import('../views/employee/MyScores.vue'), meta: { title: '我的成绩' } },
      { path: 'my/scores/:recordId', component: () => import('../views/employee/ScoreDetail.vue'), meta: { title: '成绩明细' } },
      // ---- 管理端 ----
      // KeepAlive is opt-in: session/polling pages that rely on unmount cleanup omit cache.
      { path: 'admin/dashboard', component: () => import('../views/admin/Dashboard.vue'), meta: { title: '业务首页', admin: true, cache: true } },
      { path: 'admin/students', component: () => import('../views/admin/Users.vue'), meta: { title: '学员管理', admin: true, permission: 'students:read', cache: true } },
      { path: 'admin/training-categories', component: () => import('../views/admin/TrainingCategories.vue'), meta: { title: '培训类别', admin: true, permission: 'training_categories:read', cache: true } },
      { path: 'admin/courses', component: () => import('../views/admin/Courses.vue'), meta: { title: '课程管理', admin: true, permissionAny: [...COURSE_ROUTE_PERMISSIONS], cache: true } },
      { path: 'admin/courses/:id', redirect: '/admin/courses' },
      { path: 'admin/questions', component: () => import('../views/admin/Questions.vue'), meta: { title: '试题管理', admin: true, permissionAny: [...QUESTION_ROUTE_PERMISSIONS] } },
      { path: 'admin/questions/import', component: () => import('../views/admin/QuestionImport.vue'), meta: { title: '试题导入', admin: true, permission: 'questions:write', cache: true } },
      { path: 'admin/papers', component: () => import('../views/admin/Papers.vue'), meta: { title: '试卷管理', admin: true, permission: 'papers:read', cache: true } },
      { path: 'admin/papers/:id', component: () => import('../views/admin/PaperDetail.vue'), meta: { title: '组卷', admin: true, permission: 'papers:read', cache: true } },
      { path: 'admin/exam-records', component: () => import('../views/admin/ExamRecords.vue'), meta: { title: '考试记录', admin: true, permission: 'exam_records:read' } },
      { path: 'admin/exam-records/:id', component: () => import('../views/admin/ExamRecordDetail.vue'), meta: { title: '考试记录详情', admin: true, permission: 'exam_records:read' } },
      { path: 'admin/training-statistics', component: () => import('../views/admin/TrainingStatistics.vue'), meta: { title: '统计分析', admin: true, permission: 'statistics:read', cache: true } },
      { path: 'admin/ai-config', component: () => import('../views/admin/AiConfig.vue'), meta: { title: 'AI 服务配置', admin: true, permissionAny: ['ai_config:read', 'ai_config:write'], cache: true } },
      { path: 'admin/administrators', component: () => import('../views/admin/Administrators.vue'), meta: { title: '管理员', admin: true, permission: 'administrators:read', cache: true } },
      { path: 'admin/roles', component: () => import('../views/admin/Roles.vue'), meta: { title: '角色权限', admin: true, permission: 'roles:read', cache: true } },
      { path: 'admin/sessions', component: () => import('../views/admin/OnlineSessions.vue'), meta: { title: '在线会话', admin: true, permission: 'sessions:read', cache: true } },
      { path: 'admin/system/menus', component: () => import('../views/admin/Menus.vue'), meta: { title: '菜单配置', admin: true, permission: 'system_settings:read', cache: true } },
      { path: 'admin/system/dictionaries', component: () => import('../views/admin/Dictionaries.vue'), meta: { title: '字典配置', admin: true, permission: 'system_settings:read', cache: true } },
      { path: 'admin/system/site-settings', component: () => import('../views/admin/SiteSettings.vue'), meta: { title: '网站配置', admin: true, permission: 'system_settings:read', cache: true } },
      { path: 'admin/system/audit-logs', component: () => import('../views/admin/AuditLogs.vue'), meta: { title: '审计日志', admin: true, permission: 'system_settings:read', cache: true } },
    ],
  },
  { path: '/:pathMatch(.*)*', component: () => import('../views/NotFound.vue'), meta: { title: '页面未找到' } },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) {
    if (auth.isLoggedIn && auth.needChangePassword) {
      const redirect = validPostAuthRedirect(to.query.redirect);
      return { path: '/change-password', query: redirect ? { redirect } : {} };
    }
    if (auth.isLoggedIn) return postAuthPath(auth.isAdmin, to.query.redirect);
    return true;
  }
  if (!auth.isLoggedIn) {
    // 新标签页/浏览器重启后 access token 不在 sessionStorage：先尝试 refresh Cookie 静默续登
    const restored = await auth.restore();
    if (!restored) return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }
  // sessionStorage can contain a principal from before a role/permission
  // change. Re-read the server-authoritative profile on navigation so menus
  // and write controls do not outlive the current token's permissions.
  if (auth.isLoggedIn && !auth.needChangePassword) {
    try {
      await auth.fetchProfile();
    } catch {
      if (!auth.isLoggedIn) return { path: '/login', query: { redirect: to.fullPath } };
    }
  }
  if (auth.needChangePassword && to.path !== '/change-password') return '/change-password';
  if (isRetiredLegacyPaperLocation(to.path, to.query.scope)) return '/admin/papers';
  if (isRetiredAdminPath(to.path)) return defaultHomePath(auth.isAdmin);
  if (to.path === '/') return defaultHomePath(auth.isAdmin);
  if (to.meta.admin && !auth.isAdmin) return '/my/regulations';
  if (!routeAccessAllowed(to.meta, auth.can, auth.isSuperAdmin)) return defaultHomePath(auth.isAdmin);
  return true;
});
