<template>
  <section class="page-card">
    <div class="page-head">
      <div>
        <h2>考试记录</h2>
        <p>只读查看服务端确认的考试记录、作答进度与最终状态。</p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-form inline class="filters" @submit.prevent="search">
      <el-form-item label="关键字">
        <el-input v-model="query.keyword" clearable placeholder="学员姓名、账号或试卷" @keyup.enter="search" />
      </el-form-item>
      <el-form-item label="试卷 ID">
        <el-input v-model="query.paper_id" clearable placeholder="精确 ID" @keyup.enter="search" />
      </el-form-item>
      <el-form-item label="来源">
        <el-select v-model="query.source" clearable style="width: 130px">
          <el-option label="本机构" value="institution" /><el-option label="外来" value="external" />
        </el-select>
      </el-form-item>
      <el-form-item label="难度">
        <el-select v-model="query.difficulty" clearable style="width: 130px">
          <el-option label="初级" value="easy" /><el-option label="中级" value="medium" />
          <el-option label="高级" value="hard" /><el-option label="混合" value="mixed" />
          <el-option label="历史未知" value="unknown" />
        </el-select>
      </el-form-item>
      <el-form-item label="考试状态">
        <el-select v-model="query.status" clearable style="width: 140px">
          <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="结果状态">
        <el-select v-model="query.grading_state" clearable style="width: 140px">
          <el-option v-for="item in gradingOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-form-item>
      <el-form-item><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></el-form-item>
    </el-form>

    <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon :closable="false">
      <el-button link @click="load">重试</el-button>
    </el-alert>
    <el-table v-loading="loading" :data="items" empty-text="暂无考试记录">
      <el-table-column prop="record_id" label="记录 ID" width="105" />
      <el-table-column label="学员" min-width="150">
        <template #default="{ row }"><b>{{ row.name }}</b><div class="muted">{{ row.username }}</div></template>
      </el-table-column>
      <el-table-column prop="paper_title" label="试卷" min-width="180" show-overflow-tooltip />
      <el-table-column label="来源 / 难度" width="150">
        <template #default="{ row }">{{ sourceLabel(row.source) }} / {{ difficultyLabel(row.difficulty) }}</template>
      </el-table-column>
      <el-table-column label="作答进度" width="110">
        <template #default="{ row }">{{ row.answered_count }} / {{ row.total_count }}</template>
      </el-table-column>
      <el-table-column label="状态" width="125">
        <template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
      </el-table-column>
      <el-table-column label="结果" width="115">
        <template #default="{ row }">{{ gradingLabel(row.grading_state) }}</template>
      </el-table-column>
      <el-table-column label="成绩" width="90">
        <template #default="{ row }">{{ row.score === null ? '—' : `${row.score} 分` }}</template>
      </el-table-column>
      <el-table-column label="开始时间" min-width="175">
        <template #default="{ row }">{{ formatTime(row.started_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" fixed="right" width="90">
        <template #default="{ row }"><el-button link type="primary" @click="openDetail(row.record_id)">详情</el-button></template>
      </el-table-column>
    </el-table>
    <el-pagination v-model:current-page="query.page" v-model:page-size="query.page_size" class="pager"
      :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @change="load" />
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import http from '../../api/http';
import type { ExamRecordSummary, Page } from '../../api/training-types';
import { createLatestRequestScope } from '../../utils/latest-request-scope';

const router = useRouter();
const items = ref<ExamRecordSummary[]>([]);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const query = reactive({ page: 1, page_size: 20, keyword: '', paper_id: '', source: '', difficulty: '', status: '', grading_state: '' });
const requestScope = createLatestRequestScope();
const statusOptions = [
  { value: 'in_progress', label: '进行中' }, { value: 'submitted', label: '已交卷' },
  { value: 'passed', label: '已通过' }, { value: 'failed', label: '未通过' }, { value: 'timeout', label: '超时交卷' },
];
const gradingOptions = [
  { value: 'not_submitted', label: '未交卷' }, { value: 'finalized', label: '已出分' },
];
const sourceLabels: Record<string, string> = { institution: '本机构', external: '外来' };
const difficultyLabels: Record<string, string> = { easy: '初级', medium: '中级', hard: '高级', mixed: '混合', unknown: '历史未知' };
const statusLabels: Record<string, string> = Object.fromEntries(statusOptions.map((item) => [item.value, item.label]));
const gradingLabels: Record<string, string> = Object.fromEntries(gradingOptions.map((item) => [item.value, item.label]));

function compactParams() { return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== '')); }
function sourceLabel(value: string | null) { return value ? sourceLabels[value] || value : '未知'; }
function difficultyLabel(value: string | null) { return value ? difficultyLabels[value] || value : '未知'; }
function statusLabel(value: string) { return statusLabels[value] || value; }
function gradingLabel(value: string) { return gradingLabels[value] || value; }
function statusType(value: string) { return value === 'passed' ? 'success' : value === 'failed' || value === 'timeout' ? 'danger' : value === 'in_progress' ? 'primary' : 'warning'; }
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
function openDetail(recordId: string) { void router.push(`/admin/exam-records/${recordId}`); }
function search() { query.page = 1; void load(); }
function reset() { Object.assign(query, { page: 1, page_size: 20, keyword: '', paper_id: '', source: '', difficulty: '', status: '', grading_state: '' }); void load(); }
async function load() {
  const ticket = requestScope.begin();
  loading.value = true;
  errorMessage.value = '';
  try {
    const data = await http.get('/admin/exam-records', { params: compactParams(), signal: ticket.signal }) as Page<ExamRecordSummary>;
    if (!ticket.isCurrent()) return;
    items.value = data.items;
    total.value = data.total;
  } catch (error) {
    if (ticket.isCurrent()) errorMessage.value = error instanceof Error ? error.message : '考试记录加载失败';
  } finally {
    if (ticket.isCurrent()) loading.value = false;
  }
}

onMounted(load);
onBeforeUnmount(requestScope.stop);
</script>

<style scoped>
.pager { margin-top: 16px; justify-content: flex-end; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 3px; }
</style>
