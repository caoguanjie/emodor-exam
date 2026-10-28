<template>
  <section class="page-card">
    <FitsTable>
      <template #search>
        <FitsListSearch @submit.prevent="search">
          <el-form-item label="关键字">
            <el-input v-model="query.keyword" clearable placeholder="学员姓名、账号或试卷" @keyup.enter="search" />
          </el-form-item>
          <el-form-item label="试卷名称">
            <el-select v-model="query.paper_id" filterable clearable placeholder="全部试卷" :loading="optionsLoading">
              <el-option v-for="paper in paperOptions" :key="paper.id" :label="paper.title" :value="paper.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="培训类别">
            <el-select v-model="query.category_id" filterable clearable placeholder="全部类别" :loading="optionsLoading">
              <el-option v-for="category in categoryOptions" :key="category.id" :label="category.name" :value="category.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="难度">
            <el-select v-model="query.difficulty" clearable placeholder="全部难度">
              <el-option v-for="option in examRecordDifficultyOptions" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="考试状态">
            <el-select v-model="query.result_status" clearable placeholder="全部状态">
              <el-option v-for="option in examRecordResultOptions" :key="option.value" :label="option.label" :value="option.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="考试日期">
            <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" format="YYYY-MM-DD"
              start-placeholder="开始日期" end-placeholder="结束日期" range-separator="至"
              aria-label="考试日期范围" />
          </el-form-item>
          <template #actions><el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button></template>
        </FitsListSearch>
        <p v-if="entryHint" class="entry-hint">{{ entryHint }}</p>
        <el-alert v-if="optionsError" :title="optionsError" type="warning" show-icon :closable="false">
          <el-button link @click="loadOptions">重试选项</el-button>
        </el-alert>
      </template>
      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon :closable="false">
        <el-button link @click="load">重试</el-button>
      </el-alert>
      <el-table v-loading="loading" :data="items">
        <template #empty><el-empty v-if="!loading && !errorMessage" description="暂无考试记录" /></template>
        <el-table-column label="学员" min-width="150">
          <template #default="{ row }"><b>{{ row.name }}</b><div class="muted">{{ row.username }}</div></template>
        </el-table-column>
        <el-table-column label="试卷" min-width="210">
          <template #default="{ row }"><div>{{ row.paper_title }}</div><div class="muted">第 {{ row.attempt_no }} 次</div></template>
        </el-table-column>
        <el-table-column label="培训类别" min-width="130">
          <template #default="{ row }">{{ categoryLabel(row) }}</template>
        </el-table-column>
        <el-table-column label="成绩" min-width="135">
          <template #default="{ row }">{{ examRecordScoreLabel(row) }}</template>
        </el-table-column>
        <el-table-column label="考试状态" min-width="155">
          <template #default="{ row }"><el-tag :type="examRecordResultType(row)">{{ examRecordResultLabel(row) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="开考时间" min-width="190">
          <template #default="{ row }">{{ formatExamRecordTime(row.started_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" fixed="right" width="90">
          <template #default="{ row }"><FitsTableActions><FitsTableAction type="primary" @click="openDetail(row.record_id)">详情</FitsTableAction></FitsTableActions></template>
        </el-table-column>
      </el-table>
      <template #pagination>
        <el-pagination :current-page="query.page" :page-size="query.page_size"
          :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next"
          @current-change="changePage" @size-change="changePageSize" />
      </template>
    </FitsTable>
    <ExamRecordDetail v-if="detailRecordId" :key="detailRecordId" :record-id="detailRecordId" @close="detailRecordId = ''" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch } from 'vue';
import ExamRecordDetail from './ExamRecordDetail.vue';
import { FitsTable, FitsListSearch, FitsTableActions, FitsTableAction } from '../../components/FitsTable';
import { useRoute, useRouter } from 'vue-router';
import http from '../../api/http';
import type { ExamRecordOptions, ExamRecordSummary, Page } from '../../api/training-types';
import { createLatestRequestScope } from '../../utils/latest-request-scope';
import {
  examRecordDifficultyOptions, examRecordResultOptions, examRecordResultLabel, examRecordResultType,
  examRecordScoreLabel, examRecordsFiltersFromRoute, examRecordsParams, examRecordsRouteQuery,
  formatExamRecordTime, type ExamRecordsFilters,
} from '../../utils/exam-records';

const route = useRoute();
const detailRecordId = ref('');
onDeactivated(() => { detailRecordId.value = ''; });
const router = useRouter();
const items = ref<ExamRecordSummary[]>([]);
const total = ref(0);
const loading = ref(false);
const errorMessage = ref('');
const query = reactive(examRecordsFiltersFromRoute(route.query));
const dateRange = computed<[string, string] | null>({
  get: (): [string, string] | null => query.date_from && query.date_to ? [query.date_from, query.date_to] : null,
  set: value => {
    query.date_from = value?.[0] || '';
    query.date_to = value?.[1] || '';
  },
});
const options = ref<ExamRecordOptions>({ papers: [], categories: [] });
const optionsLoading = ref(false);
const optionsError = ref('');
const requestScope = createLatestRequestScope();
const optionsScope = createLatestRequestScope();
const routeText = (value: unknown) => typeof value === 'string' ? value : '';
const paperOptions = computed(() => query.paper_id && !options.value.papers.some(paper => paper.id === query.paper_id)
  ? [{ id: query.paper_id, title: query.paper_id === route.query.paper_id ? routeText(route.query.paper_title) || '所选试卷' : '所选试卷' }, ...options.value.papers]
  : options.value.papers);
const categoryOptions = computed(() => query.category_id && !options.value.categories.some(category => category.id === query.category_id)
  ? [{ id: query.category_id, name: '所选培训类别' }, ...options.value.categories] : options.value.categories);
const entryHint = computed(() => [
  route.query.user_id ? `学员：${routeText(route.query.learner_name) || '所选学员'}` : '',
  route.query.paper_id && routeText(route.query.paper_title) ? `试卷：${routeText(route.query.paper_title)}` : '',
].filter(Boolean).join('；'));

function openDetail(recordId: string) {
  detailRecordId.value = recordId;
}
function categoryLabel(row: ExamRecordSummary) {
  if ('pool_scope' in row && row.pool_scope === 'public') return '公共题库';
  return row.category_name || (row.category_id ? '—' : '未填写');
}
async function applyFilters(filters: ExamRecordsFilters) {
  const paperTitle = options.value.papers.find(paper => paper.id === filters.paper_id)?.title
    || (filters.paper_id === route.query.paper_id ? routeText(route.query.paper_title) : '');
  const next = { path: '/admin/exam-records', query: examRecordsRouteQuery(filters, {
    paper_title: paperTitle, learner_name: filters.user_id === route.query.user_id ? routeText(route.query.learner_name) : '',
  }) };
  if (router.resolve(next).fullPath === route.fullPath) {
    Object.assign(query, examRecordsFiltersFromRoute(route.query));
    await load();
  } else await router.push(next);
}
function search() { void applyFilters({ ...query, keyword: query.keyword.trim(), page: 1 }); }
function reset() { void applyFilters(examRecordsFiltersFromRoute({})); }
function changePage(page: number) { void applyFilters({ ...examRecordsFiltersFromRoute(route.query), page }); }
function changePageSize(page_size: number) { void applyFilters({ ...examRecordsFiltersFromRoute(route.query), page: 1, page_size }); }
async function load() {
  const ticket = requestScope.begin();
  loading.value = true;
  errorMessage.value = '';
  try {
    const data = await http.get('/admin/exam-records', {
      params: examRecordsParams(examRecordsFiltersFromRoute(route.query)), signal: ticket.signal,
    }) as Page<ExamRecordSummary>;
    if (!ticket.isCurrent()) return;
    items.value = data.items;
    total.value = data.total;
  } catch (error) {
    if (ticket.isCurrent()) errorMessage.value = error instanceof Error ? error.message : '考试记录加载失败';
  } finally {
    if (ticket.isCurrent()) loading.value = false;
    ticket.finish();
  }
}
async function loadOptions() {
  const ticket = optionsScope.begin();
  optionsLoading.value = true;
  optionsError.value = '';
  try {
    const data = await http.get('/admin/exam-records/options', { signal: ticket.signal }) as ExamRecordOptions;
    if (ticket.isCurrent()) options.value = data;
  } catch (error) {
    if (ticket.isCurrent()) optionsError.value = error instanceof Error ? error.message : '筛选选项加载失败';
  } finally {
    if (ticket.isCurrent()) optionsLoading.value = false;
    ticket.finish();
  }
}

watch(() => route.fullPath, () => {
  if (route.path !== '/admin/exam-records') return;
  Object.assign(query, examRecordsFiltersFromRoute(route.query));
  void load();
}, { immediate: true });
onMounted(loadOptions);
onBeforeUnmount(() => { requestScope.stop(); optionsScope.stop(); });
</script>

<style scoped>
.muted { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 3px; }
.entry-hint { color: var(--el-text-color-secondary); font-size: 13px; margin: 0 0 12px; }
.entry-hint { margin-top: 4px; }
</style>
