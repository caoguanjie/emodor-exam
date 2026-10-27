<template>
  <section class="dashboard-panel recent-panel" data-testid="dashboard-recent" :aria-busy="section.loading" aria-labelledby="dashboard-recent-title">
    <div class="recent-heading"><h2 id="dashboard-recent-title">最近考试</h2><button type="button" class="dashboard-link dashboard-more" data-testid="dashboard-statistics-link" @click="emit('openOverview')">全部培训统计<el-icon aria-hidden="true"><ArrowRight /></el-icon></button></div>
    <div v-if="section.error" class="dashboard-message" role="alert"><p>{{ section.error }}</p><button type="button" class="dashboard-link" data-testid="dashboard-recent-retry" @click="emit('retry')">重试最近考试</button></div>
    <div v-else-if="!section.data && section.loading" class="dashboard-message" role="status">正在加载最近考试…</div>
    <el-empty v-else-if="!section.data?.items.length" class="dashboard-empty" description="暂无已发布的考试" />
    <template v-else>
      <div class="recent-table-wrap" :class="{ 'is-refreshing': section.loading }">
        <table class="recent-table"><caption class="sr-only">最近发布的培训试卷及其参考与出分人数</caption><colgroup><col class="name-column" /><col class="participation-column" /><col class="average-column" /><col class="status-column" /><col class="action-column" /></colgroup>
          <thead><tr><th scope="col">考试名称</th><th scope="col">参考 / 出分</th><th scope="col">平均分</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
          <tbody><tr v-for="item in section.data.items.slice(0,4)" :key="item.paper_id"><th scope="row"><span :title="item.title">{{ item.title }}</span></th><td class="numeric">{{ number(item.participant_count) }} / {{ number(item.finalized_users) }}</td><td class="numeric average" :data-testid="`recent-average-${item.paper_id}`">{{ item.average_score === null ? '—' : item.average_score.toFixed(1) }}</td><td><span class="exam-status" :class="`status-${item.status}`">{{ statusLabel(item.status) }}</span></td><td><button type="button" class="dashboard-link" :data-testid="`dashboard-recent-detail-${item.paper_id}`" :aria-label="`查看${item.title}详情`" @click="emit('openDetail', item.paper_id)">详情</button></td></tr></tbody>
        </table>
      </div>
      <p class="recent-caption">参考 / 出分：开考人数 / 最终出分人数</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ArrowRight } from '@element-plus/icons-vue';
import type { DashboardRecentExams } from '../../../api/training-types';
import type { DashboardSection } from '../../../composables/useAdminDashboard';
defineProps<{ section: DashboardSection<DashboardRecentExams> }>();
const emit = defineEmits<{ openDetail: [paperId: string]; openOverview: []; retry: [] }>();
const number = (value: number) => value.toLocaleString('zh-CN');
function statusLabel(status: string) { return ({ published: '已发布', withdrawn: '已撤回', archived: '已归档', draft: '草稿' } as Record<string, string>)[status] ?? status; }
</script>

<style scoped>
.recent-panel{display:flex;flex-direction:column;gap:12px;min-height:346px;padding:24px!important}.recent-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:26px}.recent-heading .dashboard-link{white-space:nowrap}.recent-table-wrap{min-width:0;overflow:auto}.recent-table{width:100%;table-layout:fixed;border-collapse:collapse;text-align:left}.name-column{width:53%}.participation-column{width:14%}.average-column{width:11%}.status-column{width:10%}.action-column{width:12%}.recent-table thead{background:var(--dashboard-soft);color:var(--dashboard-muted)}.recent-table thead th{padding:9px 10px;font-size:11px;font-weight:400;white-space:nowrap}.recent-table tbody tr{border-bottom:1px solid var(--dashboard-line)}.recent-table tbody th,.recent-table td{padding:12px 10px;font-size:12px;white-space:nowrap}.recent-table tbody th{font-weight:500;color:var(--re-text);text-align:left}.recent-table tbody th>span{display:block;overflow:hidden;text-overflow:ellipsis}.recent-table .numeric{font-family:var(--re-mono);color:var(--re-text-2);font-size:11px}.recent-table .average{color:var(--re-text);font-size:13px;font-weight:500}.exam-status{display:inline-block;padding:3px 7px;border-radius:3px;background:var(--dashboard-soft);color:var(--dashboard-muted);font-size:11px}.status-published{background:#eaf6f4;color:#16877e}.status-withdrawn{background:#fff5e4;color:#b87420}.recent-caption{margin:0;color:var(--dashboard-muted);font-size:11px;line-height:1.6}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.is-refreshing{opacity:.6}@media(max-width:1250px){.recent-panel{padding:18px!important}.name-column{width:41%}.participation-column{width:20%}.average-column{width:14%}.status-column{width:14%}.action-column{width:11%}.recent-table thead th,.recent-table tbody th,.recent-table td{padding-left:5px;padding-right:5px}.recent-table thead th{font-size:10px}.exam-status{padding:3px 5px;font-size:10px}}@media(max-width:650px){.recent-table{min-width:480px}.recent-heading{align-items:flex-start}}
</style>
