<template>
  <div class="admin-dashboard" data-testid="admin-dashboard">
    <header class="dashboard-header">
      <div><h1>{{ greeting }}，{{ auth.user?.real_name || '管理员' }}</h1><p>掌握培训与考试进展，让每一次学习都有成效。</p></div>
      <div class="dashboard-updated" aria-live="polite">
        <span v-if="updatedAt">{{ formatTime(updatedAt) }} 更新</span><span v-else>{{ refreshing ? '正在读取运营数据' : '尚未完成更新' }}</span>
        <span v-if="partiallyFailed" class="partial-failure">部分数据加载失败</span>
        <button type="button" class="refresh-button" aria-label="刷新运营看板" :aria-busy="refreshing" :disabled="refreshing" @click="dashboard.refresh()"><el-icon :class="{ spinning: refreshing }"><Refresh /></el-icon></button>
      </div>
    </header>
    <DashboardMetrics :section="overview" :can="can" @open-learners="openLearners" @open-period="openPeriod" @open-questions="openQuestions" @open-papers="openPapers" @retry="dashboard.retry('overview')" />
    <div v-if="can('statistics:read') || shortcuts.length" class="dashboard-middle" :class="{ 'actions-only': !can('statistics:read'), 'trend-only': !shortcuts.length }">
      <DashboardExamTrend v-if="can('statistics:read')" :section="trend" :days="days" :can-view-records="can('exam_records:read')" @change-days="dashboard.setDays" @open-day="openDay" @open-records="openRecords" @retry="dashboard.retry('trend')" />
      <section v-if="shortcuts.length" class="dashboard-actions" data-testid="dashboard-actions" aria-labelledby="dashboard-actions-title">
        <div class="actions-title"><h2 id="dashboard-actions-title">常用操作</h2><el-icon><TopRight /></el-icon></div><p>从内容准备到考试发布，一步直达。</p>
        <div class="action-grid"><button v-for="action in shortcuts" :key="action.key" type="button" :data-testid="`dashboard-action-${action.key}`" @click="action.open()"><el-icon><component :is="action.icon" /></el-icon><span>{{ action.label }}</span></button></div>
      </section>
    </div>
    <div v-if="can('statistics:read')" class="dashboard-bottom">
      <DashboardLearningSummary :section="learningSummary" :options="learningOptions" :selection="selection" @select="dashboard.selectLearning" @search="dashboard.searchLearningOptions" @retry-options="dashboard.retry('learningOptions')" @retry="dashboard.retry('learningSummary')" />
      <DashboardRecentExams :section="recentExams" @open-detail="openDetail" @open-overview="openStatistics" @retry="dashboard.retry('recentExams')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { CopyDocument, Upload, User, TrendCharts, TopRight, Refresh } from '@element-plus/icons-vue';
import type { LearnerSource } from '../../api/training-types';
import { useAuthStore } from '../../stores/auth';
import { useAdminDashboard } from '../../composables/useAdminDashboard';
import DashboardMetrics from './dashboard/DashboardMetrics.vue';
import DashboardExamTrend from './dashboard/DashboardExamTrend.vue';
import DashboardLearningSummary from './dashboard/DashboardLearningSummary.vue';
import DashboardRecentExams from './dashboard/DashboardRecentExams.vue';

const auth = useAuthStore();
const router = useRouter();
const dashboard = useAdminDashboard(permission => auth.can(permission));
const { overview, trend, learningOptions, learningSummary, recentExams, days, selection, updatedAt, statisticsAllowed } = dashboard;
const can = (permission: string) => auth.can(permission) && (permission !== 'statistics:read' || statisticsAllowed.value);
const refreshing = computed(() => [overview, trend, learningOptions, learningSummary, recentExams].some(section => section.value.loading));
const partiallyFailed = computed(() => overview.value.error || (can('statistics:read') && [trend, learningOptions, learningSummary, recentExams].some(section => section.value.error)));
const hour = new Date().getHours();
const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
const shortcuts = computed(() => [
  { key: 'create', label: '新建试卷', icon: CopyDocument, allowed: can('papers:read') && can('papers:write'), open: openCreate },
  { key: 'import', label: '试题导入', icon: Upload, allowed: can('questions:write'), open: openImport },
  { key: 'students', label: '学员管理', icon: User, allowed: can('students:read'), open: () => openLearners(undefined, false) },
  { key: 'statistics', label: '统计分析', icon: TrendCharts, allowed: can('statistics:read'), open: openStatistics },
].filter(action => action.allowed));
function openLearners(source?: LearnerSource, enabledOnly = true) {
  if (can('students:read')) void router.push({ path: '/admin/students', query: { entry: 'dashboard', ...(enabledOnly ? { status: '1' } : {}), ...(source ? { source } : {}) } });
}
function openPeriod(period: 'today' | 'last_7_days') {
  const range = overview.value.data?.periods[period];
  if (range && can('exam_records:read')) void router.push({ path: '/admin/exam-records', query: { ...range } });
}
function openDay(date: string) { if (can('exam_records:read')) void router.push({ path: '/admin/exam-records', query: { date_from: date, date_to: date } }); }
function openRecords() { if (can('exam_records:read')) void router.push('/admin/exam-records'); }
function openQuestions() { if (can('questions:read')) void router.push({ path: '/admin/questions', query: { entry: 'dashboard', enabled: 'all' } }); }
function openPapers() { if (can('papers:read')) void router.push({ path: '/admin/papers', query: { entry: 'dashboard', status: 'all' } }); }
function openCreate() { if (can('papers:read') && can('papers:write')) void router.push({ path: '/admin/papers', query: { entry: 'dashboard', create: '1' } }); }
function openImport() { if (can('questions:write')) void router.push('/admin/questions/import'); }
function openStatistics() { if (can('statistics:read')) void router.push({ path: '/admin/training-statistics', query: { entry: 'dashboard' } }); }
function openDetail(paperId: string) { if (can('statistics:read')) void router.push({ path: '/admin/training-statistics', query: { entry: 'dashboard', paper_id: paperId } }); }
function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(new Date(value));
}
onMounted(() => { void dashboard.activate(); });
onActivated(() => { void dashboard.activate(); });
onDeactivated(dashboard.deactivate);
onUnmounted(dashboard.deactivate);
</script>

<style scoped>
.admin-dashboard{--dashboard-ink:#17233d;--dashboard-muted:#7a8794;--dashboard-blue:#2a78d6;--dashboard-teal:#1baf7a;--dashboard-line:#e6eaee;--dashboard-soft:#f5f7fa;--dashboard-radius:6px;display:grid;gap:16px;padding:8px;min-width:0;color:var(--dashboard-ink)}
.admin-dashboard.page-enter{display:grid;gap:16px}
.admin-dashboard :deep(.dashboard-empty){flex:1;min-height:190px;padding:20px 0}
.admin-dashboard :deep(.dashboard-more){display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.dashboard-header{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:58px}.dashboard-header h1{margin:0;font-size:22px;font-weight:600;line-height:1.5}.dashboard-header p{margin:6px 0 0;font-size:13px;color:var(--dashboard-muted)}.dashboard-updated{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--dashboard-muted)}.partial-failure{color:var(--re-warning)}.refresh-button{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border:0;border-radius:6px;background:transparent;color:var(--dashboard-muted);font-size:18px;cursor:pointer}.refresh-button:hover{background:var(--dashboard-line)}.refresh-button:disabled{cursor:wait}.spinning{animation:dashboard-spin 1s linear infinite}
.dashboard-middle{display:grid;grid-template-columns:minmax(0,1fr) 354px;gap:16px;min-height:340px}.dashboard-middle.actions-only,.dashboard-middle.trend-only{grid-template-columns:minmax(0,1fr)}.dashboard-middle.actions-only .dashboard-actions{max-width:480px}.dashboard-bottom{display:grid;grid-template-columns:minmax(0,.36fr) minmax(0,.64fr);gap:16px;min-height:346px}
.admin-dashboard :deep(.dashboard-panel){box-sizing:border-box;min-width:0;border:1px solid var(--dashboard-line);border-radius:var(--dashboard-radius);background:var(--re-surface,#fff);padding:22px}.admin-dashboard :deep(.dashboard-panel h2){margin:0;font-size:16px;font-weight:600;line-height:1.5}.admin-dashboard :deep(.dashboard-link){padding:0;border:0;background:transparent;color:var(--dashboard-blue);font-size:11px;line-height:1.6;cursor:pointer}.admin-dashboard :deep(.dashboard-link:hover){text-decoration:underline}.admin-dashboard :deep(.dashboard-message){display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:190px;text-align:center;font-size:13px;color:var(--dashboard-muted)}.admin-dashboard :deep(.dashboard-message p){margin:0}.admin-dashboard :deep(button:focus-visible){outline:2px solid var(--dashboard-blue);outline-offset:3px}
.dashboard-actions{box-sizing:border-box;display:flex;flex-direction:column;gap:18px;min-width:0;min-height:340px;padding:22px;border-radius:var(--dashboard-radius);background:var(--dashboard-ink);color:#fff}.actions-title{display:flex;align-items:center;justify-content:space-between}.actions-title h2{margin:0;font-size:16px;font-weight:600}.actions-title>.el-icon{color:#b8c2d9;font-size:18px}.dashboard-actions>p{margin:0;color:#b8c2d9;font-size:11px}.action-grid{display:grid;flex:1;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(96px,1fr);gap:10px}.action-grid>button{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:7px;min-width:0;padding:12px;border:1px solid #ffffff16;border-radius:var(--dashboard-radius);background:#ffffff0a;color:#fff;font-family:inherit;cursor:pointer;text-align:left}.action-grid>button:hover{background:#ffffff14;border-color:#ffffff30}.action-grid .el-icon{color:#a9c4f5;font-size:19px}.action-grid span{font-size:13px;font-weight:500}
@keyframes dashboard-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinning{animation:none}}@media(max-width:1250px){.dashboard-middle{grid-template-columns:minmax(0,1fr) 300px}.dashboard-bottom{grid-template-columns:minmax(330px,.4fr) minmax(0,.6fr)}.admin-dashboard{padding:4px}}@media(max-width:1050px){.dashboard-middle,.dashboard-bottom{grid-template-columns:minmax(0,1fr)}.dashboard-actions{min-height:260px}.action-grid{grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:minmax(110px,1fr)}.dashboard-header{align-items:flex-start}.dashboard-updated{max-width:250px}}@media(max-width:650px){.admin-dashboard{padding:0}.dashboard-header{flex-direction:column;gap:10px}.dashboard-updated{max-width:none;justify-content:flex-start}.action-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
