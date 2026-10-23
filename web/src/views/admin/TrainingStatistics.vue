<template>
  <div class="page-card">
    <FitsTable v-if="!filters.paper_id">
      <template #search>
        <FitsListSearch @submit.prevent="searchOverview">
          <el-form-item label="考试名称">
            <el-input v-model="overviewFilters.keyword" clearable placeholder="请输入考试名称" @keyup.enter="searchOverview" />
          </el-form-item>
          <el-form-item label="考试类别">
            <el-select v-model="overviewFilters.category_id" clearable placeholder="全部类别" style="width:180px">
              <el-option v-for="category in options.categories" :key="category.id" :label="category.name" :value="category.id" />
            </el-select>
          </el-form-item>
          <template #actions>
            <el-button type="primary" @click="searchOverview">查询</el-button>
            <el-button @click="resetOverview">重置</el-button>
          </template>
        </FitsListSearch>
      </template>
      <p class="overview-note">参考人数为当前发布版本成功开考去重人数；均分为当前发布版本、相同冻结规则下跨难度每人最高分（每人只计一次）的描述性汇总，不用于跨难度排名。</p>
      <el-alert v-if="overviewError || optionsError" :title="overviewError || optionsError" type="error" show-icon :closable="false" class="scope-note">
        <el-button link @click="initialize">重试</el-button>
      </el-alert>
      <el-table v-loading="overviewLoading" :data="overview.items">
        <template #empty><el-empty v-if="!overviewLoading && !overviewError && !optionsError" description="暂无考试统计" /></template>
        <el-table-column prop="title" label="考试名称" min-width="220" show-overflow-tooltip />
        <el-table-column label="类别" min-width="140"><template #default="{ row }">{{ row.category_name || '未分类' }}</template></el-table-column>
        <el-table-column prop="participant_count" label="参考人数" width="110" />
        <el-table-column label="平均分" width="110"><template #default="{ row }">{{ row.average_score ?? '—' }}</template></el-table-column>
        <el-table-column label="总分" width="100"><template #default="{ row }">{{ row.total_score ?? '—' }}</template></el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }"><FitsTableActions><FitsTableAction @click="openAnalysis(row)">成绩分析</FitsTableAction></FitsTableActions></template>
        </el-table-column>
      </el-table>
      <template #pagination>
        <el-pagination v-model:current-page="overviewFilters.page" v-model:page-size="overviewFilters.page_size"
          :total="overview.total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next"
          @current-change="loadOverview" @size-change="onOverviewSizeChange" />
      </template>
    </FitsTable>

    <template v-else>
    <div class="analysis-navigation"><el-button @click="backToOverview">返回考试列表</el-button></div>
    <div v-if="summary" class="exam-facts">
      <strong>{{ summary.exam.title }}</strong>
      <span>总分：{{ summary.exam.total_score ?? '—' }}</span>
      <span>考试时长：{{ summary.exam.duration_minutes ?? '—' }} 分钟</span>
      <span>及格分：{{ summary.exam.pass_score ?? '—' }}</span>
      <span>优秀分：{{ summary.exam.excellent_score ?? '未设置' }}</span>
    </div>
    <el-alert v-if="summary" type="info" :closable="false" show-icon class="scope-note">
      <template #title>
        成绩与排名只比较当前发布版本（{{ summary?.release_id || '未发布' }}）、相同冻结评分规则和所选难度；参与与提交人数属于该试卷历史范围。
      </template>
    </el-alert>

    <div class="toolbar filters">
      <el-select v-model="filters.paper_id" placeholder="选择考试场次" filterable style="width:260px" @change="onPaperChange">
        <el-option v-for="paper in options.papers" :key="paper.id" :label="paper.title" :value="paper.id" />
      </el-select>
      <el-select v-model="filters.category_id" placeholder="全部类别" clearable style="width:170px" @change="reload">
        <el-option v-for="category in options.categories" :key="category.id" :label="category.name" :value="category.id" />
      </el-select>
      <el-select v-model="filters.source" placeholder="全部来源" clearable style="width:150px" @change="reload">
        <el-option label="本机构" value="institution" /><el-option label="外来" value="external" />
      </el-select>
      <el-select v-model="filters.difficulty" placeholder="选择难度查看排名" clearable style="width:190px" @change="reload">
        <el-option v-for="item in difficultyOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <div style="flex:1" />
      <el-button v-if="auth.can('statistics:export')" :disabled="!filters.difficulty || loading || rankingLoading || !ranking.items.length" @click="exportRanking">
        导出当前页排名
      </el-button>
    </div>

    <el-alert v-if="detailError || optionsError" :title="detailError || optionsError" type="error" show-icon :closable="false" class="scope-note">
      <el-button link @click="initialize">重试</el-button>
    </el-alert>
    <div v-loading="loading">
      <template v-if="summary">
        <div class="kpi-grid">
          <div class="kpi"><span>当前应考</span><strong class="re-mono">{{ summary.eligible_count }}</strong><small>当前启用学员</small></div>
          <div class="kpi"><span>当前范围已开考</span><strong class="re-mono">{{ summary.eligible_started_count }}</strong><small>与历史成功开考取交集</small></div>
          <div class="kpi"><span>参考率</span><strong class="re-mono">{{ rate(summary.participation_rate) }}</strong><small>零分母显示空值</small></div>
          <div class="kpi"><span>历史已开考</span><strong class="re-mono">{{ summary.historical_started_count }}</strong><small>其中当前范围外 {{ summary.historical_only_started_count }}</small></div>
          <div class="kpi"><span>已交卷</span><strong class="re-mono">{{ summary.submitted_attempts }}</strong><small>{{ summary.submitted_users }} 人</small></div>
        </div>

        <el-collapse class="supplementary-statistics">
          <el-collapse-item title="课程完成与未完成原因" name="course">
        <el-row :gutter="14" class="detail-row">
          <el-col :span="10">
            <div class="panel">
              <div class="panel-title">课程完成 <span>当前必学视频版本 · 仅本机构</span></div>
              <div class="course-value">{{ rate(summary.course_completion.completion_rate) }}</div>
              <p>{{ summary.course_completion.completed_users }}/{{ summary.course_completion.eligible_users }} 人 · {{ summary.course_completion.required_lessons }} 个必学课时</p>
              <el-progress v-if="summary.course_completion.completion_rate !== null" :percentage="Math.round(summary.course_completion.completion_rate * 100)" />
              <el-empty v-else :image-size="44" description="无本机构应学分母或零必学课时" />
            </div>
          </el-col>
          <el-col :span="14">
            <div class="panel">
              <div class="panel-title">未完成原因 <span>各原因独立统计</span></div>
              <div class="reason-grid">
                <div v-for="item in summary.uncompleted_reasons" :key="item.reason">
                  <span>{{ reasonLabel(item.reason) }}</span><b class="re-mono">{{ item.users }}</b>
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
          </el-collapse-item>
        </el-collapse>

        <div class="panel score-panel">
          <div class="panel-title">按难度成绩分析 <span>每人已出分记录的最高分</span></div>
          <div class="composition" aria-label="历史开考难度构成">
            <span class="composition-label">历史开考难度构成</span>
            <el-tag v-for="item in summary.difficulty_composition" :key="item.difficulty" effect="plain">
              {{ difficultyLabel(item.difficulty) }} {{ item.users }} 人
            </el-tag>
            <span v-if="!summary.difficulty_composition.length" class="composition-empty">暂无开考记录</span>
          </div>
          <el-table :data="summary.score_groups">
            <template #empty><el-empty v-if="!loading" description="暂无最终成绩" /></template>
            <el-table-column label="难度" width="90"><template #default="{ row }">{{ difficultyLabel(row.difficulty) }}</template></el-table-column>
            <el-table-column prop="finalized_users" label="最终人数" width="90" />
            <el-table-column label="平均分" width="90"><template #default="{ row }">{{ row.average_score ?? '—' }}</template></el-table-column>
            <el-table-column label="最高分" width="90"><template #default="{ row }">{{ row.highest_score ?? '—' }}</template></el-table-column>
            <el-table-column label="最低分" width="90"><template #default="{ row }">{{ row.lowest_score ?? '—' }}</template></el-table-column>
            <el-table-column prop="passed_users" label="及格人数" width="100" />
            <el-table-column label="及格率" width="90"><template #default="{ row }">{{ rate(row.pass_rate) }}</template></el-table-column>
            <el-table-column label="平均用时" width="120"><template #default="{ row }">{{ duration(row.average_duration_seconds) }}</template></el-table-column>
            <el-table-column label="优秀人数" width="100"><template #default="{ row }">{{ row.excellent_users ?? '--' }}</template></el-table-column>
            <el-table-column label="分布" min-width="320">
              <template #default="{ row }">
                <span v-for="bucket in row.distribution" :key="bucket.lower" class="bucket re-mono">[{{ bucket.lower }},{{ bucket.upper }}{{ bucket.upper === 100 ? ']' : ')' }} {{ bucket.count }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="panel ranking-panel">
          <div class="panel-title">难度排名 <span>同分并列 1/1/3；切换展示排序不改变分数名次</span></div>
          <el-alert v-if="rankingError" :title="rankingError" type="error" show-icon :closable="false" class="scope-note">
            <el-button link @click="onRankingPageChange">重试</el-button>
          </el-alert>
          <el-empty v-if="!filters.difficulty" :image-size="54" description="请先明确选择一个难度" />
          <FitsTable v-else>
            <el-table v-loading="rankingLoading" :data="ranking.items"
              :default-sort="filters.sort_by ? { prop: filters.sort_by === 'duration' ? 'duration_seconds' : 'score', order: filters.sort_order === 'asc' ? 'ascending' : 'descending' } : undefined"
              @sort-change="onRankingSortChange">
              <template #empty><el-empty v-if="!rankingLoading && !rankingError" description="该难度暂无最终成绩" /></template>
              <el-table-column prop="rank" label="名次" width="72" />
              <el-table-column prop="name" label="姓名" min-width="120" />
              <el-table-column label="性别" width="90"><template #default="{ row }">{{ genderLabel(row.gender) }}</template></el-table-column>
              <el-table-column label="来源" width="100"><template #default="{ row }">{{ sourceLabel(row.source) }}</template></el-table-column>
              <el-table-column label="难度" width="90"><template #default="{ row }">{{ difficultyLabel(row.difficulty) }}</template></el-table-column>
              <el-table-column prop="score" label="分数" sortable="custom" width="110" />
              <el-table-column prop="duration_seconds" label="用时" sortable="custom" width="120"><template #default="{ row }">{{ duration(row.duration_seconds) }}</template></el-table-column>
              <el-table-column prop="record_id" label="答卷 ID" width="120" />
            </el-table>
            <template v-if="ranking.total" #pagination>
              <el-pagination v-if="ranking.total" v-model:current-page="filters.page" v-model:page-size="filters.page_size"
                :total="ranking.total" layout="total, prev, pager, next" @current-change="onRankingPageChange" />
            </template>
          </FitsTable>
        </div>
        <p class="as-of">统计时点：{{ formatTime(summary.as_of) }}</p>
      </template>
      <el-empty v-else-if="!loading && !detailError" description="该场次暂无统计数据" />
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { FitsListSearch, FitsTable, FitsTableAction, FitsTableActions } from '../../components/FitsTable';
import http, { download } from '../../api/http';
import type {
  ExamDifficulty, LearnerSource, Page, RankRow, TrainingExamOverviewRow, TrainingExamSummary, TrainingStatisticsOptions,
  TrainingUncompletedReason,
} from '../../api/training-types';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
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
function rate(value: number | null) { return value === null ? '—' : `${(value * 100).toFixed(1)}%`; }
function difficultyLabel(value: ExamDifficulty) { return difficultyOptions.find((item) => item.value === value)?.label || value; }
function sourceLabel(value: LearnerSource | null) { return value === 'institution' ? '本机构' : value === 'external' ? '外来' : '未知'; }
function genderLabel(value: RankRow['gender']) { return value === 'male' ? '男' : value === 'female' ? '女' : '未填写'; }
function reasonLabel(value: TrainingUncompletedReason) {
  return ({ learning_incomplete: '未完成学习', not_started: '未参加考试', not_passed: '考试未通过' })[value];
}
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
  if (!query.paper_id || !query.difficulty) {
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
async function reload() {
  if (!filters.paper_id) return;
  const epoch = ++requestEpoch;
  rankingEpoch += 1;
  filters.page = 1;
  const query = params();
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
    await loadRanking(epoch, query);
  } catch (error) {
    if (epoch === requestEpoch) detailError.value = error instanceof Error ? error.message : '成绩分析加载失败';
  } finally {
    if (epoch === requestEpoch) loading.value = false;
  }
}
function onPaperChange() {
  // The narrow options endpoint describes the editable paper, not its frozen release category.
  filters.category_id = '';
  void reload();
}
async function exportRanking() {
  if (!auth.can('statistics:export') || !filters.paper_id || !filters.difficulty || loading.value || rankingLoading.value || !ranking.items.length) return;
  const epoch = requestEpoch;
  try {
    await download('/statistics/training/export', '培训考试难度排名.xlsx', params());
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
  filters.paper_id = row.paper_id;
  filters.category_id = row.category_id || '';
  await reload();
}
async function backToOverview() {
  requestEpoch += 1;
  rankingEpoch += 1;
  filters.paper_id = '';
  summary.value = null;
  clearRanking();
  detailError.value = '';
  rankingError.value = '';
  loading.value = false;
  rankingLoading.value = false;
  await loadOverview();
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
  await Promise.all([loadOptions(), filters.paper_id ? reload() : loadOverview()]);
}

let initialActivationSeen = false;
onMounted(initialize);
onBeforeUnmount(() => { requestEpoch += 1; rankingEpoch += 1; overviewEpoch += 1; optionsEpoch += 1; });
onActivated(() => {
  if (!initialActivationSeen) {
    initialActivationSeen = true;
    return;
  }
  void initialize();
});
</script>

<style scoped>
.overview-note{margin:0 0 16px;font-size:12px;line-height:1.7;color:var(--re-text-3)}.analysis-navigation{margin-bottom:16px}.exam-facts{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px;margin-bottom:16px;padding:14px 16px;border:1px solid var(--re-border);border-radius:var(--re-radius)}.exam-facts strong{font-size:15px}.exam-facts span{font-size:13px;color:var(--re-text-2)}.supplementary-statistics{margin-top:14px}
.scope-note{margin-bottom:16px}.filters{flex-wrap:wrap}.kpi-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.kpi{display:flex;flex-direction:column;gap:5px;padding:16px;border:1px solid var(--re-border);border-radius:var(--re-radius);background:#fff}.kpi span{font-size:12px;color:var(--re-text-2)}.kpi strong{font-size:26px;color:var(--re-text)}.kpi small,.panel-title span,.panel p,.as-of{font-size:11px;color:var(--re-text-3)}.detail-row{margin-top:14px}.panel{height:100%;padding:18px;border:1px solid var(--re-border);border-radius:var(--re-radius);background:#fff}.panel-title{font-weight:600;margin-bottom:14px}.panel-title span{font-weight:400;margin-left:8px}.course-value{font-size:34px;font-weight:700;color:var(--re-primary)}.reason-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.reason-grid>div{display:flex;justify-content:space-between;padding:14px;border-radius:8px;background:#f7f8fb}.reason-grid b{font-size:20px}.score-panel,.ranking-panel{margin-top:14px;height:auto}.composition{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:-2px 0 14px}.composition-label,.composition-empty{font-size:12px;color:var(--re-text-3);margin-right:2px}.bucket{display:inline-block;margin:3px 8px 3px 0;padding:3px 7px;border-radius:5px;background:#f1f3f8;font-size:11px}.as-of{text-align:right;margin:14px 0 0}@media(max-width:1280px){.kpi-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
</style>
