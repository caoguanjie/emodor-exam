<template>
  <section class="dashboard-panel learning-panel" data-testid="dashboard-learning" :aria-busy="section.loading || options.loading" aria-labelledby="dashboard-learning-title">
    <div class="learning-heading">
      <div class="learning-title"><h2 id="dashboard-learning-title">必修学时完成情况</h2><p :title="selectedTitle">{{ selectedTitle }}</p></div>
      <el-popover v-model:visible="choosing" placement="bottom-end" :width="340" trigger="click">
        <template #reference><button type="button" class="dashboard-link choose-training" aria-label="切换必修培训">切换培训 <el-icon><Sort /></el-icon></button></template>
        <div class="learning-picker">
          <form class="learning-search" @submit.prevent="emit('search', keyword, 1)"><el-input v-model="keyword" aria-label="搜索必修培训" placeholder="输入培训名称" clearable /><el-button native-type="submit" :loading="options.loading">搜索</el-button></form>
          <div v-if="options.error" class="picker-message" role="alert">{{ options.error }} <button type="button" @click="emit('retryOptions')">重试培训列表</button></div>
          <p v-else-if="options.loading" class="picker-message" role="status">正在加载培训…</p>
          <div v-else-if="options.data?.items.length" class="learning-option-list"><button v-for="item in options.data.items" :key="`${item.paper_id}:${item.release_id}`" type="button" :aria-pressed="item.paper_id === selection?.paper_id && item.release_id === selection.release_id" :title="item.title" @click="choose(item)"><span>{{ item.title }}</span><small>{{ duration(item.required_learning_minutes) }}</small></button></div>
          <p v-else class="picker-message">{{ keyword ? '没有匹配的培训' : '暂无必修学时要求' }}</p>
          <div v-if="options.data" class="learning-pagination"><button type="button" :disabled="options.loading || options.data.page <= 1" @click="emit('search', keyword, options.data.page - 1)">上一页</button><span>第 {{ options.data.page }} 页 · 共 {{ options.data.total }} 项</span><button type="button" :disabled="options.loading || options.data.page * options.data.page_size >= options.data.total" @click="emit('search', keyword, options.data.page + 1)">下一页</button></div>
        </div>
      </el-popover>
    </div>
    <div v-if="section.error" class="dashboard-message" role="alert"><p>{{ section.error }}</p><button type="button" class="dashboard-link" @click="emit('retry')">{{ selection ? '重试学时统计' : '重新读取培训' }}</button></div>
    <div v-else-if="!selection && options.error" class="dashboard-message" role="alert"><p>{{ options.error }}</p><button type="button" class="dashboard-link" @click="emit('retryOptions')">重试培训列表</button></div>
    <div v-else-if="!section.data && (section.loading || options.loading || selection)" class="dashboard-message" role="status">正在加载必修学时…</div>
    <el-empty v-else-if="!section.data" class="dashboard-empty" description="暂无必修学时要求" />
    <template v-else>
      <div class="required-duration"><el-icon><Clock /></el-icon>要求学习 {{ duration(section.data.required_learning_minutes) }}</div>
      <el-empty v-if="section.data.state === 'no_audience'" class="dashboard-empty" description="暂无应学人员" />
      <div v-else class="learning-summary" :class="{ 'is-refreshing': section.loading }">
        <div class="learning-ring" role="img" :aria-label="`学时达标率 ${percentage}，应学 ${section.data.eligible_count} 人，已达标 ${section.data.achieved_count} 人，未达标 ${section.data.pending_count} 人`"><div ref="chartElement" class="learning-echarts" aria-hidden="true" /><div class="ring-center" aria-hidden="true"><strong>{{ percentage }}</strong><span>学时达标率</span></div></div>
        <dl class="learning-counts"><div><dt>应学人数</dt><dd data-testid="learning-eligible">{{ number(section.data.eligible_count) }} 人</dd></div><div class="achieved"><dt>已达标</dt><dd data-testid="learning-achieved">{{ number(section.data.achieved_count) }} 人</dd></div><div class="pending"><dt>未达标</dt><dd data-testid="learning-pending">{{ number(section.data.pending_count) }} 人</dd></div></dl>
      </div>
      <p v-if="section.data.state === 'ready'" class="learning-caption">{{ number(section.data.achieved_count) }} / {{ number(section.data.eligible_count) }} · 仅统计有必修学时要求的学员</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { Clock, Sort } from '@element-plus/icons-vue';
import type { DashboardLearningOptions, DashboardLearningSummary } from '../../../api/training-types';
import type { DashboardLearningSelection, DashboardSection } from '../../../composables/useAdminDashboard';
import { buildDashboardLearningOption, createDashboardChart } from '../../../utils/dashboard-charts';
const props = defineProps<{ section: DashboardSection<DashboardLearningSummary>; options: DashboardSection<DashboardLearningOptions>; selection: DashboardLearningSelection | null }>();
const emit = defineEmits<{ select: [selection: DashboardLearningSelection]; search: [keyword: string, page: number]; retryOptions: []; retry: [] }>();
const keyword = ref('');
const choosing = ref(false);
const chartElement = ref<HTMLElement | null>(null);
const chart = createDashboardChart();
watch([chartElement, () => props.section.data], ([element, data]) => {
  chart.setElement(element);
  if (data) chart.setOption(buildDashboardLearningOption(data));
}, { flush: 'post' });
onMounted(chart.activate);
onActivated(chart.activate);
onDeactivated(chart.deactivate);
onUnmounted(chart.dispose);
const selectedTitle = computed(() => props.section.data?.title ?? props.options.data?.items.find(item => item.paper_id === props.selection?.paper_id && item.release_id === props.selection.release_id)?.title ?? (props.selection ? '正在加载所选培训' : '选择需要统计的必修培训'));
const percentage = computed(() => `${((props.section.data?.achievement_rate ?? 0) * 100).toFixed(1)}%`);
const number = (value: number) => value.toLocaleString('zh-CN');
function duration(minutes: number) { const hours = Math.floor(minutes / 60); const rest = minutes % 60; return `${hours ? `${hours} 小时` : ''}${hours && rest ? ' ' : ''}${rest ? `${rest} 分钟` : ''}`; }
function choose(item: DashboardLearningOptions['items'][number]) { choosing.value = false; emit('select', { paper_id: item.paper_id, release_id: item.release_id }); }
</script>

<style scoped>
.learning-panel{display:flex;flex-direction:column;gap:12px;min-height:346px;padding:18px!important}.learning-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:45px}.learning-title{min-width:0}.learning-title p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:4px 0 0;color:var(--dashboard-muted);font-size:11px}.choose-training{display:inline-flex;align-items:center;gap:4px;flex:none;white-space:nowrap}.choose-training .el-icon{font-size:12px}.required-duration{align-self:flex-start;display:flex;align-items:center;gap:6px;min-height:32px;box-sizing:border-box;padding:0 11px;border-radius:5px;background:#eaf2fc;color:var(--dashboard-blue);font-size:11px}.required-duration .el-icon{font-size:15px}.learning-summary{display:flex;align-items:center;gap:24px;min-height:150px}.learning-ring{position:relative;width:150px;height:150px;flex:none}.learning-echarts{width:100%;height:100%}.ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;pointer-events:none}.ring-center strong{color:var(--dashboard-ink);font-family:var(--re-mono);font-size:26px;font-weight:500;letter-spacing:-1px}.ring-center span{color:var(--dashboard-muted);font-size:10px}.learning-counts{flex:1;display:grid;gap:16px;margin:0;min-width:0}.learning-counts>div{display:flex;align-items:center;justify-content:space-between;gap:8px}.learning-counts dt{display:flex;align-items:center;gap:7px;color:var(--dashboard-muted);font-size:11px;white-space:nowrap}.learning-counts dt:before{content:'';width:6px;height:6px;border-radius:50%;background:var(--dashboard-ink);flex:none}.learning-counts dd{margin:0;font-family:var(--re-mono);font-size:13px;white-space:nowrap}.learning-counts .achieved dt:before{background:var(--dashboard-teal)}.learning-counts .achieved dd{color:var(--dashboard-teal)}.learning-counts .pending dt:before{background:var(--dashboard-muted)}.learning-counts .pending dd{color:var(--dashboard-muted)}.learning-caption{border-top:1px solid var(--dashboard-line);padding-top:12px;margin:0;color:var(--dashboard-muted);font-size:10px;line-height:1.7}.is-refreshing{opacity:.6}.learning-picker{display:grid;gap:12px}.learning-search{display:flex;gap:8px}.learning-search .el-input{min-width:0}.learning-option-list{display:grid;max-height:240px;overflow:auto;gap:4px}.learning-option-list button{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 8px;border:0;border-radius:4px;background:transparent;color:var(--re-text);text-align:left;font-family:inherit;cursor:pointer}.learning-option-list button:hover,.learning-option-list button[aria-pressed=true]{background:var(--el-color-primary-light-9)}.learning-option-list span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.learning-option-list small{color:var(--re-text-3);font-size:10px;white-space:nowrap}.learning-pagination{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--re-text-3)}.learning-pagination button,.picker-message button{border:0;background:transparent;font-family:inherit;color:var(--re-primary);font-size:11px;cursor:pointer}.learning-pagination button:disabled{color:var(--re-text-3);cursor:default}.picker-message{margin:10px 0;text-align:center;font-size:12px;color:var(--re-text-3)}@media(max-width:1250px){.learning-summary{gap:12px}.learning-ring{width:132px;height:132px}.learning-counts dd{font-size:12px}}@media(max-width:1050px){.learning-ring{width:150px;height:150px}.learning-counts{max-width:300px}}@media(max-width:400px){.learning-heading{align-items:flex-start}.learning-summary{gap:10px}.learning-ring{width:120px;height:120px}}
</style>
