<template>
  <div class="page-card">
    <FitsTable>
      <template #search>
        <FitsListSearch @submit.prevent="searchOverview">
          <el-form-item label="考试名称">
            <el-input v-model="overviewFilters.keyword" clearable placeholder="请输入考试名称" @keyup.enter="searchOverview" />
          </el-form-item>
          <el-form-item label="考试类别">
            <el-select v-model="overviewFilters.category_id" clearable placeholder="全部类别">
              <el-option v-for="category in options.categories" :key="category.id" :label="category.name" :value="category.id" />
            </el-select>
          </el-form-item>
          <template #actions>
            <el-button type="primary" @click="searchOverview">查询</el-button>
            <el-button @click="resetOverview">重置</el-button>
          </template>
        </FitsListSearch>
      </template>
      <el-alert v-if="overviewError || optionsError" :title="overviewError || optionsError" type="error" show-icon :closable="false" class="scope-note">
        <el-button link @click="initialize">重试</el-button>
      </el-alert>
      <el-table v-loading="overviewLoading" :data="overview.items">
        <template #empty><el-empty v-if="!overviewLoading && !overviewError && !optionsError" description="暂无考试统计" /></template>
        <el-table-column header-align="left" align="left" prop="title" label="考试名称" min-width="220" show-overflow-tooltip>
          <template #header><span class="overview-name-heading">考试名称<el-tooltip content="仅展示已发布试卷，总分取当前发布版本。参考人数按成功开考人数去重；平均分取该版本、相同评分规则下每人已评分最高分的平均值，无已评分成绩显示 —，不用于跨难度排名。" placement="top" :show-after="200"><span class="overview-help" tabindex="0">（统计口径<el-icon><QuestionFilled /></el-icon>）</span></el-tooltip></span></template>
        </el-table-column>
        <el-table-column header-align="center" align="center" label="培训类别" min-width="140"><template #default="{ row }">{{ row.category_name || '未分类' }}</template></el-table-column>
        <el-table-column header-align="center" align="center" label="试卷总分" width="100"><template #default="{ row }">{{ row.total_score ?? '—' }}</template></el-table-column>
        <el-table-column header-align="center" align="center" prop="participant_count" label="参考人数" width="110" />
        <el-table-column header-align="center" align="center" label="平均分" width="110"><template #default="{ row }">{{ row.average_score ?? '—' }}</template></el-table-column>
        <el-table-column header-align="center" align="center" label="操作" width="100" fixed="right">
          <template #default="{ row }"><FitsTableActions style="justify-content: center"><FitsTableAction @click="openAnalysis(row)">成绩分析</FitsTableAction></FitsTableActions></template>
        </el-table-column>
      </el-table>
      <template #pagination>
        <el-pagination v-model:current-page="overviewFilters.page" v-model:page-size="overviewFilters.page_size"
          :total="overview.total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next"
          @current-change="loadOverview" @size-change="onOverviewSizeChange" />
      </template>
    </FitsTable>

    <el-dialog :model-value="analysisVisible" :title="summary ? `成绩分析 · ${summary.exam.title}` : '成绩分析'"
      width="min(1200px, calc(100vw - 32px))" align-center :append-to="contentDialogTarget || 'body'"
      class="re-form-dialog training-score-analysis-dialog" @close="onAnalysisClosed">
      <el-alert v-if="detailError" :title="detailError" type="error" show-icon :closable="false" class="scope-note">
        <el-button link @click="reload">重试</el-button>
      </el-alert>
      <el-skeleton v-if="loading && !summary" :rows="8" animated />
      <template v-else-if="summary">
        <el-descriptions :column="4" border label-width="104px" class="score-descriptions">
          <el-descriptions-item label="考试名称" :span="2">{{ summary.exam.title }}</el-descriptions-item>
          <el-descriptions-item label="培训类别" :span="2">{{ summaryCategoryName }}</el-descriptions-item>
          <el-descriptions-item label="试卷总分">{{ scoreMetric(summary.exam.total_score) }}</el-descriptions-item>
          <el-descriptions-item label="考试时长">{{ minuteMetric(summary.exam.duration_minutes) }}</el-descriptions-item>
          <el-descriptions-item label="及格分">{{ scoreMetric(summary.exam.pass_score) }}</el-descriptions-item>
          <el-descriptions-item label="优秀分">{{ summary.exam.excellent_score === null ? '未设置' : scoreMetric(summary.exam.excellent_score) }}</el-descriptions-item>
          <el-descriptions-item label="当前应考">{{ summary.eligible_count }} 人</el-descriptions-item>
          <el-descriptions-item label="参考人数">{{ summary.historical_started_count }} 人</el-descriptions-item>
          <el-descriptions-item label="已交卷人数">{{ summary.submitted_users }} 人</el-descriptions-item>
          <el-descriptions-item label="参考率">{{ rate(summary.participation_rate) }}</el-descriptions-item>
          <el-descriptions-item label="平均分">{{ scoreMetric(selectedScoreGroup?.average_score) }}</el-descriptions-item>
          <el-descriptions-item label="最高分">{{ scoreMetric(selectedScoreGroup?.highest_score) }}</el-descriptions-item>
          <el-descriptions-item label="最低分">{{ scoreMetric(selectedScoreGroup?.lowest_score) }}</el-descriptions-item>
          <el-descriptions-item label="平均用时">{{ duration(selectedScoreGroup?.average_duration_seconds ?? null) }}</el-descriptions-item>
          <el-descriptions-item label="及格人数">{{ countMetric(selectedScoreGroup?.passed_users) }}</el-descriptions-item>
          <el-descriptions-item label="及格率">{{ rate(selectedScoreGroup?.pass_rate ?? null) }}</el-descriptions-item>
          <el-descriptions-item label="优秀人数" :span="2">{{ selectedScoreGroup?.excellent_users ?? '—' }}</el-descriptions-item>
        </el-descriptions>

        <el-alert type="info" :closable="false" show-icon class="scope-note analysis-scope-note" :title="analysisScopeNote" />

        <section class="ranking-section">
          <div class="ranking-heading">
            <div><h3>成绩排名</h3><p>每位学员取当前发布版本、相同冻结评分规则下的最高最终成绩。</p></div>
            <div class="ranking-filters">
              <el-select v-model="filters.source" placeholder="全部来源" clearable style="width:140px" @change="onSourceChange">
                <el-option label="本机构" value="institution" /><el-option label="外来" value="external" />
              </el-select>
              <el-select v-if="summary.exam.mode === 'random'" v-model="filters.difficulty" placeholder="选择卷面难度"
                style="width:160px" @change="onDifficultyChange">
                <el-option v-for="item in availableDifficultyOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
              <el-button v-if="auth.can('statistics:export')" :disabled="!canLoadRanking || loading || rankingLoading || !ranking.items.length" @click="exportRanking">
                导出当前排名
              </el-button>
            </div>
          </div>
          <el-alert v-if="rankingError" :title="rankingError" type="error" show-icon :closable="false" class="scope-note">
            <el-button link @click="onRankingPageChange">重试</el-button>
          </el-alert>
          <FitsTable v-if="canLoadRanking">
            <el-table v-loading="rankingLoading" :data="ranking.items"
              :default-sort="filters.sort_by ? { prop: filters.sort_by === 'duration' ? 'duration_seconds' : 'score', order: filters.sort_order === 'asc' ? 'ascending' : 'descending' } : undefined"
              @sort-change="onRankingSortChange">
              <template #empty><el-empty v-if="!rankingLoading && !rankingError" description="暂无最终成绩" /></template>
              <el-table-column prop="rank" label="排名" width="72" />
              <el-table-column prop="name" label="姓名" min-width="140" />
              <el-table-column label="性别" width="90"><template #default="{ row }">{{ genderLabel(row.gender) }}</template></el-table-column>
              <el-table-column label="来源" width="100"><template #default="{ row }">{{ sourceLabel(row.source) }}</template></el-table-column>
              <el-table-column prop="score" label="成绩" sortable="custom" width="110"><template #default="{ row }">{{ scoreMetric(row.score) }}</template></el-table-column>
              <el-table-column prop="duration_seconds" label="用时" sortable="custom" width="120"><template #default="{ row }">{{ duration(row.duration_seconds) }}</template></el-table-column>
              <el-table-column v-if="canReadExamRecords" label="操作" fixed="right" width="100"><template #default="{ row }"><FitsTableActions><FitsTableAction type="primary" @click="openRecord(row.record_id)">查看答卷</FitsTableAction></FitsTableActions></template></el-table-column>
            </el-table>
            <template v-if="ranking.total" #pagination>
              <el-pagination v-model:current-page="filters.page" v-model:page-size="filters.page_size"
                :total="ranking.total" layout="total, prev, pager, next" @current-change="onRankingPageChange" />
            </template>
          </FitsTable>
          <el-empty v-else :image-size="54" description="暂无可排名的最终成绩" />
        </section>
      </template>
      <el-empty v-else-if="!loading && !detailError" description="该场次暂无统计数据" />
      <template #footer>
        <span v-if="summary" class="dialog-as-of">统计时间：{{ formatTime(summary.as_of) }}</span>
        <el-button type="primary" @click="backToOverview">关闭</el-button>
      </template>
    </el-dialog>
    <ExamRecordDetail v-if="viewActive && detailRecordId" :key="detailRecordId" :record-id="detailRecordId" @close="detailRecordId = ''" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onActivated, onBeforeUnmount, onDeactivated, reactive, ref, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useDashboardListNavigation } from '../../utils/admin-dashboard-navigation';
import { FitsListSearch, FitsTable, FitsTableAction, FitsTableActions } from '../../components/FitsTable';
import http, { download } from '../../api/http';
import type {
  ExamDifficulty, LearnerSource, Page, RankRow, ScoreGroup, TrainingExamOverviewRow, TrainingExamSummary, TrainingStatisticsOptions,
} from '../../api/training-types';
import { QuestionFilled } from '@element-plus/icons-vue';
import { useAuthStore } from '../../stores/auth';
import ExamRecordDetail from './ExamRecordDetail.vue';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const contentDialogTarget = inject<Ref<HTMLElement | undefined>>('contentDialogTarget', ref());
const viewActive = ref(true);
const detailRecordId = ref('');
const loading = ref(false);
const rankingLoading = ref(false);
const overviewLoading = ref(false);
const detailError = ref('');
const rankingError = ref('');
const overviewError = ref('');
const optionsError = ref('');
const options = reactive<TrainingStatisticsOptions>({ papers: [], categories: [] });
const overviewFilters = reactive({ keyword: '', category_id: '', page: 1, page_size: 20 });
const overview = reactive<Page<TrainingExamOverviewRow>>({ items: [], total: 0, page: 1, page_size: 20 });
const summary = ref<TrainingExamSummary | null>(null);
const ranking = reactive<Page<RankRow>>({ items: [], total: 0, page: 1, page_size: 20 });
const filters = reactive({
  paper_id: '', category_id: '', source: '' as LearnerSource | '',
  difficulty: '' as ExamDifficulty | '', page: 1, page_size: 20,
  sort_by: '' as 'score' | 'duration' | '', sort_order: '' as 'asc' | 'desc' | '',
});
const difficultyOptions: Array<{ value: ExamDifficulty; label: string }> = [
  { value: 'easy', label: '简单' }, { value: 'medium', label: '中级' }, { value: 'hard', label: '困难' },
  { value: 'mixed', label: '固定混档' }, { value: 'unknown', label: '遗留未知' },
];
const availableDifficultyOptions = computed(() => {
  const values = new Set([
    ...(summary.value?.score_groups.map((item) => item.difficulty) || []),
    ...(summary.value?.difficulty_composition.map((item) => item.difficulty) || []),
  ]);
  return difficultyOptions.filter((item) => values.has(item.value));
});
function combineScoreGroups(groups: ScoreGroup[]): ScoreGroup | null {
  if (!groups.length) return null;
  const finalized = groups.reduce((sum, item) => sum + item.finalized_users, 0);
  const passed = groups.reduce((sum, item) => sum + item.passed_users, 0);
  const weighted = (key: 'average_score' | 'average_duration_seconds') => finalized
    ? groups.reduce((sum, item) => sum + Number(item[key] || 0) * item.finalized_users, 0) / finalized
    : null;
  const scores = groups.flatMap((item) => [item.highest_score, item.lowest_score]).filter((value): value is number => value !== null);
  return {
    difficulty: groups[0].difficulty,
    finalized_users: finalized,
    average_score: weighted('average_score'),
    highest_score: scores.length ? Math.max(...scores) : null,
    lowest_score: scores.length ? Math.min(...scores) : null,
    passed_users: passed,
    average_duration_seconds: weighted('average_duration_seconds'),
    excellent_users: null,
    pass_rate: finalized ? passed / finalized : null,
    distribution: [],
  };
}
const selectedScoreGroup = computed(() => {
  const data = summary.value;
  if (!data) return null;
  if (data.exam.mode === 'random') return data.score_groups.find((item) => item.difficulty === filters.difficulty) || null;
  return combineScoreGroups(data.score_groups);
});
const summaryCategoryName = computed(() => {
  const id = summary.value?.exam.category_id;
  if (!id) return '未分类';
  return options.categories.find((item) => item.id === id)?.name || '—';
});
const analysisVisible = computed(() => viewActive.value && Boolean(filters.paper_id));
const canReadExamRecords = computed(() => auth.can('exam_records:read'));
const canLoadRanking = computed(() => Boolean(summary.value && (summary.value.exam.mode === 'fixed' || filters.difficulty)));
const analysisScopeNote = computed(() => summary.value?.exam.mode === 'random'
  ? '该历史随机卷按所选卷面难度比较当前发布版本、相同冻结评分规则下每位学员的最高最终成绩。'
  : '固定卷比较当前发布版本、相同冻结评分规则下每位学员的最高最终成绩；参与人数保留该考试历史范围。');

let requestEpoch = 0;
let rankingEpoch = 0;
let overviewEpoch = 0;
let optionsEpoch = 0;
function params() {
  return {
    paper_id: filters.paper_id,
    category_id: filters.category_id || undefined,
    source: filters.source || undefined,
    difficulty: filters.difficulty || undefined,
    page: filters.page,
    page_size: filters.page_size,
    sort_by: filters.sort_by || undefined,
    sort_order: filters.sort_order || undefined,
  };
}
function summaryParams() {
  return {
    paper_id: filters.paper_id,
    category_id: filters.category_id || undefined,
    source: filters.source || undefined,
    page: 1,
    page_size: filters.page_size,
  };
}
function rate(value: number | null) { return value === null ? '—' : `${(value * 100).toFixed(1)}%`; }
function difficultyLabel(value: ExamDifficulty) { return difficultyOptions.find((item) => item.value === value)?.label || value; }
function sourceLabel(value: LearnerSource | null) { return value === 'institution' ? '本机构' : value === 'external' ? '外来' : '未知'; }
function genderLabel(value: RankRow['gender']) { return value === 'male' ? '男' : value === 'female' ? '女' : '未填写'; }
function scoreMetric(value: number | null | undefined) { return value === null || value === undefined ? '—' : `${value} 分`; }
function minuteMetric(value: number | null | undefined) { return value === null || value === undefined ? '—' : `${value} 分钟`; }
function countMetric(value: number | null | undefined) { return value === null || value === undefined ? '—' : `${value} 人`; }
function duration(seconds: number | null) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}分${rounded % 60}秒`;
}
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Shanghai' }).format(new Date(value)); }

function clearRanking() {
  Object.assign(ranking, { items: [], total: 0, page: filters.page, page_size: filters.page_size });
}
async function loadRanking(parentEpoch = requestEpoch, query = params()) {
  const epoch = ++rankingEpoch;
  clearRanking();
  rankingError.value = '';
  if (!query.paper_id || !canLoadRanking.value) {
    rankingLoading.value = false;
    return;
  }
  rankingLoading.value = true;
  try {
    const data = await http.get('/statistics/training/ranking', { params: query }) as Page<RankRow>;
    if (epoch !== rankingEpoch || parentEpoch !== requestEpoch) return;
    if (!data || !Array.isArray(data.items)) throw new Error('排名响应格式异常，请重试');
    Object.assign(ranking, data);
  } catch (error) {
    if (epoch === rankingEpoch && parentEpoch === requestEpoch) rankingError.value = error instanceof Error ? error.message : '排名加载失败';
  } finally {
    if (epoch === rankingEpoch && parentEpoch === requestEpoch) rankingLoading.value = false;
  }
}
async function onRankingPageChange() {
  await loadRanking();
}
async function onRankingSortChange({ prop, order }: { prop?: string; order?: string | null }) {
  filters.sort_by = order && prop === 'score' ? 'score' : order && prop === 'duration_seconds' ? 'duration' : '';
  filters.sort_order = filters.sort_by ? (order === 'ascending' ? 'asc' : 'desc') : '';
  filters.page = 1;
  await loadRanking();
}
async function onDifficultyChange() {
  filters.page = 1;
  await loadRanking();
}
async function onSourceChange() {
  filters.difficulty = '';
  await reload();
}
async function reload() {
  if (!filters.paper_id || !viewActive.value) return;
  await navigation.syncQuery({ paper_id: filters.paper_id });
  if (!filters.paper_id || !viewActive.value) return;
  const epoch = ++requestEpoch;
  rankingEpoch += 1;
  filters.page = 1;
  const query = summaryParams();
  summary.value = null;
  clearRanking();
  detailError.value = '';
  rankingError.value = '';
  rankingLoading.value = false;
  loading.value = true;
  try {
    const data = await http.get('/statistics/training/summary', { params: query }) as TrainingExamSummary;
    if (epoch !== requestEpoch) return;
    if (!data || data.exam?.paper_id !== query.paper_id) throw new Error('统计响应与当前场次不一致，请重试');
    summary.value = data;
    if (data.exam.mode === 'fixed') filters.difficulty = '';
    else {
      const scored = new Set(data.score_groups.map((item) => item.difficulty));
      const available = new Set([...scored, ...data.difficulty_composition.map((item) => item.difficulty)]);
      if (scored.size && (!filters.difficulty || !scored.has(filters.difficulty))) filters.difficulty = data.score_groups[0]?.difficulty || '';
      else if (!filters.difficulty || !available.has(filters.difficulty)) filters.difficulty = availableDifficultyOptions.value[0]?.value || '';
    }
    await loadRanking(epoch, params());
  } catch (error) {
    if (epoch === requestEpoch) detailError.value = error instanceof Error ? error.message : '成绩分析加载失败';
  } finally {
    if (epoch === requestEpoch) loading.value = false;
  }
}
async function exportRanking() {
  if (!auth.can('statistics:export') || !filters.paper_id || !canLoadRanking.value || loading.value || rankingLoading.value || !ranking.items.length) return;
  const epoch = requestEpoch;
  try {
    await download('/statistics/training/export', '培训考试成绩排名.xlsx', params());
  } catch (error) {
    if (epoch === requestEpoch) rankingError.value = error instanceof Error ? error.message : '排名导出失败';
  }
}

async function loadOverview() {
  const epoch = ++overviewEpoch;
  const query = {
    keyword: overviewFilters.keyword.trim() || undefined,
    category_id: overviewFilters.category_id || undefined,
    page: overviewFilters.page,
    page_size: overviewFilters.page_size,
  };
  overviewLoading.value = true;
  overviewError.value = '';
  // Keep the last total while loading: ElPagination otherwise clamps later pages to 1.
  Object.assign(overview, { items: [], page: query.page, page_size: query.page_size });
  try {
    const data = await http.get('/statistics/training/overview', { params: query }) as Page<TrainingExamOverviewRow>;
    if (epoch !== overviewEpoch) return;
    if (!data || !Array.isArray(data.items)) throw new Error('考试总览响应格式异常，请重试');
    Object.assign(overview, data);
  } catch (error) {
    if (epoch === overviewEpoch) overviewError.value = error instanceof Error ? error.message : '考试总览加载失败';
  } finally {
    if (epoch === overviewEpoch) overviewLoading.value = false;
  }
}
function searchOverview() { overviewFilters.page = 1; void loadOverview(); }
function resetOverview() { Object.assign(overviewFilters, { keyword: '', category_id: '', page: 1 }); void loadOverview(); }
function onOverviewSizeChange() { overviewFilters.page = 1; void loadOverview(); }
async function openAnalysis(row: TrainingExamOverviewRow) {
  overviewEpoch += 1;
  overviewLoading.value = false;
  detailRecordId.value = '';
  Object.assign(filters, {
    paper_id: row.paper_id, category_id: row.category_id || '', source: '', difficulty: '',
    page: 1, sort_by: '', sort_order: '',
  });
  await reload();
}
async function backToOverview() {
  if (!filters.paper_id) return;
  requestEpoch += 1;
  rankingEpoch += 1;
  detailRecordId.value = '';
  filters.paper_id = '';
  summary.value = null;
  clearRanking();
  detailError.value = '';
  rankingError.value = '';
  loading.value = false;
  rankingLoading.value = false;
  await navigation.syncQuery({ paper_id: undefined });
}
function onAnalysisClosed() { if (viewActive.value) void backToOverview(); }
function openRecord(recordId: string) {
  if (viewActive.value && canReadExamRecords.value) detailRecordId.value = String(recordId);
}
async function loadOptions() {
  const epoch = ++optionsEpoch;
  optionsError.value = '';
  try {
    const data = await http.get('/statistics/training/options') as TrainingStatisticsOptions;
    if (epoch === optionsEpoch) Object.assign(options, data);
  } catch (error) {
    if (epoch === optionsEpoch) optionsError.value = error instanceof Error ? error.message : '统计筛选项加载失败';
  }
}
async function initialize() {
  if (!route.query.paper_id && filters.paper_id) {
    requestEpoch += 1;
    rankingEpoch += 1;
    detailRecordId.value = '';
    filters.paper_id = '';
    summary.value = null;
    clearRanking();
    detailError.value = '';
    rankingError.value = '';
    loading.value = false;
    rankingLoading.value = false;
  }
  await Promise.all([loadOptions(), loadOverview(), filters.paper_id ? reload() : Promise.resolve()]);
}

const navigation = useDashboardListNavigation(route, router, {
  path: '/admin/training-statistics',
  apply(entry, explicit) {
    if (entry.kind !== 'statistics') return;
    if (!explicit && (entry.paperId || '') === filters.paper_id) return;
    requestEpoch += 1;
    rankingEpoch += 1;
    overviewEpoch += 1;
    detailRecordId.value = '';
    summary.value = null;
    Object.assign(filters, { paper_id: entry.paperId || '', category_id: '', source: '', difficulty: '', page: 1, sort_by: '', sort_order: '' });
    clearRanking();
    detailError.value = '';
    rankingError.value = '';
    loading.value = false;
    rankingLoading.value = false;
    overviewLoading.value = false;
    if (explicit) Object.assign(overviewFilters, { keyword: '', category_id: '', page: 1 });
  },
  load: initialize,
  onInvalid: () => { ElMessage.warning('已清除无效的统计入口参数'); },
});
function activateView() { viewActive.value = true; }
function deactivateView() {
  viewActive.value = false;
  detailRecordId.value = '';
  requestEpoch += 1;
  rankingEpoch += 1;
  overviewEpoch += 1;
  optionsEpoch += 1;
  loading.value = false;
  rankingLoading.value = false;
  overviewLoading.value = false;
}
onActivated(activateView);
onDeactivated(deactivateView);
onBeforeUnmount(deactivateView);
</script>

<style scoped>
.overview-name-heading { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.overview-help { display: inline-flex; align-items: center; gap: 5px; cursor: help; }
.scope-note { margin-bottom: 16px; }
.score-descriptions :deep(.el-descriptions__table) { table-layout: fixed; }
.score-descriptions :deep(.el-descriptions__content) { overflow-wrap: anywhere; }
.score-descriptions :deep(.el-descriptions__label) { white-space: nowrap; }
.analysis-scope-note { margin: 16px 0 0; }
.ranking-section { margin-top: 20px; }
.ranking-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
.ranking-heading h3 { margin: 0; font-size: 16px; }
.ranking-heading p { margin: 5px 0 0; color: var(--el-text-color-secondary); font-size: 12px; }
.ranking-filters { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 10px; }
.dialog-as-of { margin-right: auto; color: var(--el-text-color-secondary); font-size: 12px; }
@media (max-width: 900px) {
  .ranking-heading { display: block; }
  .ranking-filters { justify-content: flex-start; margin-top: 12px; }
}
</style>
