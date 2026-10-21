import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth';

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
      { path: '', redirect: '/my/regulations' },
      // ---- 员工端 ----
      { path: 'my/regulations', component: () => import('../views/employee/MyRegulations.vue'), meta: { title: '我的制度' } },
      { path: 'my/regulations/:id/read', component: () => import('../views/employee/Reading.vue'), meta: { title: '在线学习' } },
      { path: 'my/exams', component: () => import('../views/employee/Exams.vue'), meta: { title: '我的考试' } },
      { path: 'my/exams/:paperId', component: () => import('../views/employee/ExamRoom.vue'), meta: { title: '考试' } },
      { path: 'my/scores', component: () => import('../views/employee/MyScores.vue'), meta: { title: '我的成绩' } },
      { path: 'my/scores/:recordId', component: () => import('../views/employee/ScoreDetail.vue'), meta: { title: '成绩明细' } },
      // ---- 管理端 ----
      { path: 'admin/departments', component: () => import('../views/admin/Departments.vue'), meta: { title: '部门管理', admin: true, superOnly: true } },
      { path: 'admin/users', component: () => import('../views/admin/Users.vue'), meta: { title: '员工管理', admin: true, superOnly: true } },
      { path: 'admin/students', component: () => import('../views/admin/Users.vue'), meta: { title: '学员管理', admin: true, permission: 'students:read' } },
      { path: 'admin/training-categories', component: () => import('../views/admin/TrainingCategories.vue'), meta: { title: '培训类别', admin: true, permission: 'training_categories:read' } },
      { path: 'admin/regulations', component: () => import('../views/admin/Regulations.vue'), meta: { title: '制度管理', admin: true, permission: 'regulations:read' } },
      { path: 'admin/regulations/:id', component: () => import('../views/admin/RegulationDetail.vue'), meta: { title: '制度详情', admin: true, permission: 'regulations:read' } },
      { path: 'admin/questions', component: () => import('../views/admin/Questions.vue'), meta: { title: '题库与出题', admin: true, permission: 'questions:read' } },
      { path: 'admin/papers', component: () => import('../views/admin/Papers.vue'), meta: { title: '试卷管理', admin: true, permission: 'papers:read' } },
      { path: 'admin/papers/:id', component: () => import('../views/admin/PaperDetail.vue'), meta: { title: '组卷', admin: true, permission: 'papers:read' } },
      { path: 'admin/statistics', component: () => import('../views/admin/Statistics.vue'), meta: { title: '统计报表', admin: true, permission: 'statistics:read' } },
      { path: 'admin/ai-config', component: () => import('../views/admin/AiConfig.vue'), meta: { title: 'AI 服务配置', admin: true, permission: 'ai:read' } },
      { path: 'admin/administrators', component: () => import('../views/admin/Administrators.vue'), meta: { title: '管理员', admin: true, permission: 'administrators:read' } },
      { path: 'admin/roles', component: () => import('../views/admin/Roles.vue'), meta: { title: '角色权限', admin: true, permission: 'roles:read' } },
      { path: 'admin/sessions', component: () => import('../views/admin/OnlineSessions.vue'), meta: { title: '在线会话', admin: true, permission: 'sessions:read' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) {
    if (auth.isLoggedIn && !auth.needChangePassword) return '/my/regulations';
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
  if (to.meta.admin && !auth.isAdmin) return '/my/regulations';
  if (to.meta.superOnly && !auth.isSuperAdmin) return '/my/regulations';
  if (to.meta.permission && !auth.can(String(to.meta.permission))) return '/my/regulations';
  return true;
});
