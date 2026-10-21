<template>
  <el-container style="height:100%">
    <el-aside width="232px" class="aside">
      <div class="logo">
        <img class="logo-badge" :src="brandLogo" alt="EmodorRuleExam Logo" />
        <div class="logo-text">
          <span class="logo-name">EmodorRuleExam</span>
          <span class="logo-sub">安全教育培训与考试平台</span>
        </div>
      </div>
      <el-scrollbar class="nav-scroll">
        <el-menu :default-active="route.path" router class="nav-menu">
          <template v-if="auth.isAdmin">
            <li class="nav-group">管理台</li>
            <el-menu-item index="/admin/regulations"><el-icon><Document /></el-icon>制度管理</el-menu-item>
            <el-menu-item index="/admin/questions"><el-icon><EditPen /></el-icon>题库与出题</el-menu-item>
            <el-menu-item index="/admin/papers"><el-icon><Tickets /></el-icon>试卷管理</el-menu-item>
            <el-menu-item index="/admin/statistics"><el-icon><DataAnalysis /></el-icon>统计报表</el-menu-item>
            <template v-if="auth.isSuperAdmin">
              <el-menu-item index="/admin/departments"><el-icon><OfficeBuilding /></el-icon>部门管理</el-menu-item>
              <el-menu-item index="/admin/users"><el-icon><User /></el-icon>员工管理</el-menu-item>
              <el-menu-item index="/admin/ai-config"><el-icon><Setting /></el-icon>AI 服务配置</el-menu-item>
            </template>
          </template>
          <li class="nav-group">我的学习</li>
          <el-menu-item index="/my/regulations"><el-icon><Reading /></el-icon>我的制度</el-menu-item>
          <el-menu-item index="/my/exams"><el-icon><AlarmClock /></el-icon>我的考试</el-menu-item>
          <el-menu-item index="/my/scores"><el-icon><Medal /></el-icon>我的成绩</el-menu-item>
        </el-menu>
      </el-scrollbar>
      <div class="aside-foot">学习留痕 · 风控考试</div>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-right">
          <div class="user-chip">
            <span class="avatar">{{ avatarChar }}</span>
            <span class="user-meta">
              <b>{{ auth.user?.real_name }}</b>
              <i>{{ roleLabel }}</i>
            </span>
          </div>
          <el-divider direction="vertical" />
          <el-button text class="logout-btn" @click="onLogout">
            <el-icon><SwitchButton /></el-icon>退出登录
          </el-button>
        </div>
      </el-header>
      <el-main class="main" style="overflow:auto">
        <router-view v-slot="{ Component }">
          <div :key="route.path" class="page-enter">
            <component :is="Component" />
          </div>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Document, EditPen, Tickets, DataAnalysis, OfficeBuilding, User, Setting, Reading, AlarmClock, Medal, SwitchButton,
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import brandLogo from '../assets/brand-logo.png';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const roleLabel = computed(
  () => ({ super_admin: '超级管理员', regulation_admin: '制度管理员', employee: '员工' }[auth.user?.role || 'employee'] || '员工'),
);

const avatarChar = computed(() => (auth.user?.real_name || '用').slice(0, 1));

async function onLogout() {
  await auth.logout();
  router.push('/login');
}
</script>

<style scoped>
.aside {
  background: linear-gradient(180deg, var(--re-ink) 0%, #101b36 100%);
  display: flex; flex-direction: column;
}
.logo { display: flex; align-items: center; gap: 10px; padding: 20px 20px 16px; }
.logo-badge { width: 36px; height: 36px; border-radius: 9px; object-fit: cover; flex: none; }
.logo-text { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.logo-name { color: #fff; font-size: 13px; font-weight: 700; letter-spacing: 0; white-space: nowrap; }
.logo-sub { color: rgba(255, 255, 255, 0.45); font-size: 10px; transform-origin: left; transform: scale(0.96); white-space: nowrap; }
.nav-scroll { flex: 1; }
.nav-group {
  list-style: none; margin: 18px 20px 6px; font-size: 11px; color: rgba(255, 255, 255, 0.38);
  letter-spacing: 3px; font-weight: 600;
}
.aside :deep(.el-menu) { border-right: none; background: transparent; padding: 0 10px; }
.aside :deep(.el-menu-item) {
  color: rgba(255, 255, 255, 0.68); border-radius: 8px; margin: 2px 0; height: 42px;
  transition: all 0.18s ease; letter-spacing: 0.5px;
}
.aside :deep(.el-menu-item:hover) { background: rgba(255, 255, 255, 0.07); color: #fff; }
.aside :deep(.el-menu-item.is-active) {
  background: linear-gradient(90deg, rgba(48, 86, 211, 0.55), rgba(48, 86, 211, 0.28));
  color: #fff; font-weight: 600;
  box-shadow: inset 3px 0 0 #7d96ee;
}
.aside-foot {
  padding: 14px 20px; font-size: 11px; color: rgba(255, 255, 255, 0.28); letter-spacing: 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.header {
  display: flex; align-items: center; background: rgba(255, 255, 255, 0.86); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--re-border); height: 56px;
}
.header-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.user-chip { display: flex; align-items: center; gap: 10px; padding: 4px 10px; border-radius: 999px; }
.avatar {
  width: 32px; height: 32px; border-radius: 50%; flex: none;
  background: linear-gradient(135deg, var(--re-primary), var(--re-ink-3)); color: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600;
}
.user-meta { display: flex; flex-direction: column; line-height: 1.2; }
.user-meta b { font-size: 13px; font-weight: 600; color: var(--re-text); }
.user-meta i { font-style: normal; font-size: 11px; color: var(--re-text-3); }
.logout-btn { color: var(--re-text-2); }

.main {
  padding: 24px;
  background: transparent;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.page-enter {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  min-height: 0;
}

.page-enter > :deep(*) {
  flex: 1 0 auto;
  min-height: 0;
}
</style>
