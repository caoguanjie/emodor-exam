<template>
  <section class="dashboard-panel exam-trend" data-testid="dashboard-trend" :aria-busy="section.loading" aria-labelledby="dashboard-trend-title">
    <div class="trend-heading">
      <div><h2 id="dashboard-trend-title">考试参与趋势</h2><p>按学员来源统计每日去重参考人数</p></div>
      <div class="trend-controls"><div class="trend-legend"><span><i class="institution" />本机构</span><span><i class="external" />外来</span><span v-if="hasUnknown"><i class="unknown" data-source="unknown" />来源未记录</span></div><div class="day-switch" role="group" aria-label="趋势日期范围"><button v-for="value in [7,30] as const" :key="value" type="button" :aria-label="`查看近 ${value} 日考试趋势`" :aria-pressed="days === value" @click="emit('changeDays', value)">近 {{ value }} 日</button></div></div>
    </div>
    <div v-if="section.error" class="dashboard-message" role="alert"><p>{{ section.error }}</p><button type="button" class="dashboard-link" @click="emit('retry')">重试考试趋势</button></div>
    <div v-else-if="!section.data && section.loading" class="dashboard-message" role="status">正在加载考试趋势…</div>
    <el-empty v-else-if="!hasParticipants" class="dashboard-empty" description="暂无考试数据" />
    <div v-else-if="section.data" class="trend-chart" :class="{ 'is-refreshing': section.loading }">
      <div ref="chartElement" class="trend-echarts" aria-hidden="true" />
      <div class="chart-keyboard-grid" role="group" aria-label="每日参考人数数据" :style="{ gridTemplateColumns: `repeat(${Math.max(1,section.data.points.length)},minmax(0,1fr))` }">
        <button v-for="(point,index) in section.data.points" :key="point.date" type="button" :data-day="point.date" :aria-disabled="!canViewRecords" :aria-label="pointLabel(point)" @focus="focusPoint(point.date,index)" @blur="blurPoint" @click="open(point.date)" @keydown.enter.prevent="open(point.date)" @keydown.space.prevent="open(point.date)">{{ point.date.slice(5).replace('-', '/') }}</button>
      </div>
    </div>
    <div class="trend-caption"><span data-testid="dashboard-trend-hint" aria-live="polite">{{ highlightedPoint ? pointLabel(highlightedPoint) : '每日去重，跨日可重复' }}</span><button v-if="canViewRecords" type="button" class="dashboard-link dashboard-more" data-testid="dashboard-records-link" @click="emit('openRecords')">查看考试记录<el-icon aria-hidden="true"><ArrowRight /></el-icon></button></div>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { ArrowRight } from '@element-plus/icons-vue';
import type { DashboardExamTrend } from '../../../api/training-types';
import type { DashboardSection } from '../../../composables/useAdminDashboard';
import { buildDashboardTrendOption, createDashboardChart, dashboardTrendPointLabel, type DashboardChartClick } from '../../../utils/dashboard-charts';
const props = defineProps<{ section: DashboardSection<DashboardExamTrend>; days: 7 | 30; canViewRecords: boolean }>();
const emit = defineEmits<{ changeDays: [days: 7 | 30]; openDay: [date: string]; openRecords: []; retry: [] }>();
const chartElement = ref<HTMLElement | null>(null);
const highlightedDate = ref<string | null>(null);
const highlightedPoint = computed(() => props.section.data?.points.find(point => point.date === highlightedDate.value));
const hasParticipants = computed(() => props.section.data?.points.some(point => point.participant_count > 0));
const chart = createDashboardChart((event: DashboardChartClick) => {
  if (event.componentType !== 'series' || event.seriesType !== 'bar' || typeof event.dataIndex !== 'number') return;
  const point = props.section.data?.points[event.dataIndex];
  if (point && (!event.name || event.name === point.date)) open(point.date);
});
watch([chartElement, () => props.section.data], ([element, data]) => {
  chart.setElement(element);
  if (data) chart.setOption(buildDashboardTrendOption(data));
}, { flush: 'post' });
const hasUnknown = computed(() => props.section.data?.points.some(point => point.unknown_source_count > 0));
const pointLabel = dashboardTrendPointLabel;
function focusPoint(date: string, index: number) { highlightedDate.value = date; chart.showTip(index); }
function blurPoint() { highlightedDate.value = null; chart.hideTip(); }
function open(date: string) { if (props.canViewRecords) emit('openDay', date); }
onMounted(chart.activate);
onActivated(chart.activate);
onDeactivated(() => { highlightedDate.value = null; chart.deactivate(); });
onUnmounted(chart.dispose);
</script>

<style scoped>
.exam-trend{display:flex;flex-direction:column;min-height:340px;gap:12px}.trend-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:44px}.trend-heading p{margin:4px 0 0;font-size:11px;color:var(--dashboard-muted)}.trend-controls{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:14px}.trend-legend{display:flex;align-items:center;gap:12px;white-space:nowrap;font-size:11px;color:var(--re-text-2)}.trend-legend span{display:inline-flex;align-items:center;gap:6px}.trend-legend i{width:8px;height:8px;border-radius:2px}.institution{fill:var(--dashboard-blue);background:var(--dashboard-blue)}.external{fill:var(--dashboard-teal);background:var(--dashboard-teal)}.unknown{fill:var(--dashboard-muted);background:var(--dashboard-muted)}.day-switch{display:flex;gap:2px;padding:3px;background:var(--dashboard-soft);border-radius:4px}.day-switch button{padding:5px 9px;border:0;border-radius:3px;background:transparent;color:var(--dashboard-muted);font-family:inherit;font-size:10px;white-space:nowrap;cursor:pointer}.day-switch button[aria-pressed=true]{background:#fff;color:var(--dashboard-blue)}.trend-chart{position:relative;flex:1;min-height:208px}.trend-echarts{width:100%;height:208px}.chart-keyboard-grid{position:absolute;left:30px;right:8px;bottom:0;height:26px;display:grid;pointer-events:none}.chart-keyboard-grid button{min-width:0;padding:0;border:0;background:transparent;color:transparent;font-family:var(--re-mono);font-size:10px;white-space:nowrap;pointer-events:auto;cursor:pointer}.chart-keyboard-grid button[aria-disabled=true]{cursor:default}.chart-keyboard-grid button:focus-visible{background:#ffffffeb;color:var(--dashboard-blue);outline:2px solid var(--dashboard-blue);outline-offset:-2px}.trend-caption{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:auto;font-size:11px;color:var(--dashboard-muted)}.is-refreshing{opacity:.6}@media(max-width:1250px){.trend-heading{align-items:flex-start}.trend-controls{gap:8px}.trend-legend{gap:8px;font-size:10px}.day-switch button{padding:5px 6px}}@media(max-width:650px){.trend-heading{flex-direction:column}.trend-controls{justify-content:flex-start}.trend-caption{font-size:10px}}
</style>
