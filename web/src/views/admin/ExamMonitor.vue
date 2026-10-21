<template>
  <section class="page-card">
    <div class="page-head">
      <div><h2>考试监控</h2><p>每 5 秒只读刷新；连接异常仅提示“连接待确认”，不会自动判作弊或扣分。</p></div>
      <el-button :disabled="!paperId" :loading="loading" @click="load(true)">手动刷新</el-button>
    </div>
    <el-form inline class="filters">
      <el-form-item label="考试试卷">
        <el-select v-model="paperId" filterable remote reserve-keyword :remote-method="searchPapers"
          :loading="optionsLoading" placeholder="输入关键字搜索试卷" style="width: 320px" @change="changePaper">
          <el-option v-for="paper in paperOptions" :key="paper.id" :label="`${paper.title}（${paper.id}）`" :value="paper.id" />
        </el-select>
        <el-button v-if="hasMoreOptions" class="load-more" :loading="optionsLoading" @click="loadMoreOptions">加载更多试卷</el-button>
      </el-form-item>
      <el-form-item><span class="poll-note">轮询间隔 5 秒 · 最近服务端时间 {{ lastServerTime }}</span></el-form-item>
    </el-form>
    <el-alert v-if="optionErrorMessage" :title="optionErrorMessage" type="error" show-icon :closable="false"><el-button link @click="retryOptions">重新加载试卷</el-button></el-alert>
    <el-alert v-if="monitorErrorMessage" :title="monitorErrorMessage" type="error" show-icon :closable="false"><el-button link @click="load(true)">重试监控</el-button></el-alert>
    <el-table v-loading="loading" :data="items" empty-text="请选择试卷或暂无考试记录">
      <el-table-column label="学员" min-width="130"><template #default="{ row }"><b>{{ row.name }}</b><div class="muted">ID {{ row.user_id }}</div></template></el-table-column>
      <el-table-column label="来源 / 难度" width="145"><template #default="{ row }">{{ sourceLabel(row.source) }} / {{ difficultyLabel(row.difficulty) }}</template></el-table-column>
      <el-table-column label="开始 / 截止" min-width="190"><template #default="{ row }"><div>{{ formatTime(row.started_at) }}</div><div class="muted">至 {{ formatTime(row.deadline_at) }}</div></template></el-table-column>
      <el-table-column label="剩余" width="95"><template #default="{ row }">{{ formatRemaining(row.remaining_seconds) }}</template></el-table-column>
      <el-table-column label="已答 / 总题" width="105"><template #default="{ row }">{{ row.answered_count }} / {{ row.total_count }}</template></el-table-column>
      <el-table-column label="最后心跳" min-width="175"><template #default="{ row }">{{ formatTime(row.last_heartbeat_at) }}</template></el-table-column>
      <el-table-column label="连接" width="120"><template #default="{ row }"><el-tag :type="connectionType(row.connection_state)">{{ connectionLabel(row.connection_state) }}</el-tag></template></el-table-column>
      <el-table-column prop="switch_count" label="切屏" width="75" />
      <el-table-column label="设备" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ row.device_summary || '未上报' }}</template></el-table-column>
      <el-table-column label="提交 / 批改" min-width="150"><template #default="{ row }"><div>{{ statusLabel(row.status) }}</div><div class="muted">{{ gradingLabel(row.grading_state) }} · {{ submissionLabel(row.submission_method) }}</div></template></el-table-column>
      <el-table-column v-if="canReadRecords" label="操作" fixed="right" width="90"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row.record_id)">详情</el-button></template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" class="pager"
      :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @change="load(true)" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import http from '../../api/http';
import type { ExamMonitorRow, MonitorConnectionState, MonitorPaperOption, Page, SubmissionMethod } from '../../api/training-types';
import { useAuthStore } from '../../stores/auth';
import { createLatestRequestScope } from '../../utils/latest-request-scope';
import { mergePagedOptions } from '../../utils/paged-options';

const router = useRouter();
const auth = useAuthStore();
const items = ref<ExamMonitorRow[]>([]);
const paperOptions = ref<MonitorPaperOption[]>([]);
const paperId = ref('');
const total = ref(0);
const loading = ref(false);
const optionsLoading = ref(false);
const optionErrorMessage = ref('');
const monitorErrorMessage = ref('');
const query = reactive({ page: 1, page_size: 20 });
const optionPageSize = 100;
const optionPage = ref(0);
const optionTotal = ref(0);
const optionKeyword = ref('');
const monitorScope = createLatestRequestScope();
const optionsScope = createLatestRequestScope();
const canReadRecords = computed(() => auth.can('exam_records:read'));
const hasMoreOptions = computed(() => !optionErrorMessage.value && optionPage.value * optionPageSize < optionTotal.value);
let pollTimer: number | null = null;
let destroyed = false;
const sourceLabels: Record<string, string> = { institution: '本机构', external: '外来' };
const difficultyLabels: Record<string, string> = { easy: '初级', medium: '中级', hard: '高级', mixed: '混合', unknown: '历史未知' };
const statusLabels: Record<string, string> = { in_progress: '进行中', submitted: '已交卷', passed: '已通过', failed: '未通过', timeout: '超时交卷' };
const gradingLabels: Record<string, string> = { not_submitted: '未交卷', pending_manual: '待人工批改', finalized: '已完成批改' };
const lastServerTime = computed(() => items.value[0]?.server_now ? formatTime(items.value[0].server_now) : '—');

function sourceLabel(value: string | null) { return value ? sourceLabels[value] || value : '未知'; }
function difficultyLabel(value: string | null) { return value ? difficultyLabels[value] || value : '未知'; }
function statusLabel(value: string) { return statusLabels[value] || value; }
function gradingLabel(value: string) { return gradingLabels[value] || value; }
function submissionLabel(value: SubmissionMethod | null) { return value === 'manual' ? '主动交卷' : value === 'timeout' ? '超时交卷' : '方式未知'; }
function connectionLabel(value: MonitorConnectionState) { return value === 'connected' ? '连接正常' : value === 'uncertain' ? '连接待确认' : '考试已结束'; }
function connectionType(value: MonitorConnectionState) { return value === 'connected' ? 'success' : value === 'uncertain' ? 'warning' : 'info'; }
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
function formatRemaining(seconds: number) { const value = Math.max(0, seconds); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }
function openDetail(recordId: string) { void router.push(`/admin/exam-records/${recordId}`); }
function changePaper() { query.page = 1; void load(true); }
function searchPapers(keyword: string) { optionKeyword.value = String(keyword || '').trim(); void loadOptions(true); }
function loadMoreOptions() { void loadOptions(false); }
async function retryOptions() {
  const loaded = await loadOptions(true);
  if (loaded && paperId.value) await load(true);
}
async function loadOptions(replace: boolean): Promise<boolean> {
  const targetPage = replace ? 1 : optionPage.value + 1;
  const ticket = optionsScope.begin();
  optionsLoading.value = true;
  optionErrorMessage.value = '';
  try {
    const data = await http.get('/admin/exams/monitor-options', {
      params: { page: targetPage, page_size: optionPageSize, keyword: optionKeyword.value || undefined },
      signal: ticket.signal,
    }) as Page<MonitorPaperOption>;
    if (!ticket.isCurrent()) return false;
    paperOptions.value = mergePagedOptions(paperOptions.value, data.items, {
      replace, selectedId: paperId.value,
    });
    optionPage.value = targetPage;
    optionTotal.value = data.total;
    if (!paperId.value && data.items.length) paperId.value = data.items[0].id;
    return true;
  } catch (error) {
    if (ticket.isCurrent()) optionErrorMessage.value = error instanceof Error ? error.message : '试卷选项加载失败';
    return false;
  } finally {
    const current = ticket.isCurrent();
    ticket.finish();
    if (current) optionsLoading.value = false;
  }
}
async function load(showLoading = false, mode: 'replace' | 'if-idle' = 'replace') {
  if (!paperId.value) { items.value = []; total.value = 0; return; }
  const ticket = mode === 'if-idle' ? monitorScope.beginIfIdle() : monitorScope.begin();
  if (!ticket) return;
  if (showLoading || !items.value.length) loading.value = true;
  monitorErrorMessage.value = '';
  try {
    const data = await http.get(`/admin/exams/${encodeURIComponent(paperId.value)}/monitor`, {
      params: query, signal: ticket.signal,
    }) as Page<ExamMonitorRow>;
    if (!ticket.isCurrent()) return;
    items.value = data.items;
    total.value = data.total;
  } catch (error) {
    if (ticket.isCurrent()) monitorErrorMessage.value = error instanceof Error ? error.message : '考试监控加载失败';
  } finally {
    const current = ticket.isCurrent();
    ticket.finish();
    if (current) loading.value = false;
  }
}

onMounted(async () => {
  const loaded = await loadOptions(true);
  if (destroyed) return;
  if (loaded) await load(true);
  if (destroyed) return;
  pollTimer = window.setInterval(() => { void load(false, 'if-idle'); }, 5_000);
});
onBeforeUnmount(() => {
  destroyed = true;
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
  optionsScope.stop();
  monitorScope.stop();
});
</script>

<style scoped>
.pager { margin-top: 16px; justify-content: flex-end; }
.load-more { margin-left: 8px; }
.muted, .poll-note { color: var(--el-text-color-secondary); font-size: 12px; }
.muted { margin-top: 3px; }
</style>
