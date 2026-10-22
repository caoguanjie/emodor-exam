<template>
  <div class="page-card">
    <div class="page-head statistics-head">
      <div>
        <div class="eyebrow">管理台</div>
        <h2>统计分析</h2>
        <p class="desc">按场次、当前类别、冻结来源与难度核算；排名必须明确难度</p>
      </div>
    </div>

    <el-alert v-if="summary" type="info" :closable="false" show-icon class="scope-note">
      <template #title>
        成绩与排名只比较当前发布版本（{{ summary?.release_id || '遗留无版本' }}）、相同冻结评分规则和所选难度；参与与提交人数属于该试卷历史范围。
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
      <el-button v-if="auth.can('statistics:export')" :disabled="!filters.paper_id || !filters.difficulty" @click="exportRanking">
        导出当前页排名
      </el-button>
    </div>

    <div v-loading="loading">
      <template v-if="summary">
        <div class="kpi-grid">
          <div class="kpi"><span>当前应考</span><strong class="re-mono">{{ summary.eligible_count }}</strong><small>当前启用学员</small></div>
          <div class="kpi"><span>当前范围已开考</span><strong class="re-mono">{{ summary.eligible_started_count }}</strong><small>与历史成功开考取交集</small></div>
          <div class="kpi"><span>参考率</span><strong class="re-mono">{{ rate(summary.participation_rate) }}</strong><small>零分母显示空值</small></div>
          <div class="kpi"><span>历史已开考</span><strong class="re-mono">{{ summary.historical_started_count }}</strong><small>其中当前范围外 {{ summary.historical_only_started_count }}</small></div>
          <div class="kpi"><span>已交卷</span><strong class="re-mono">{{ summary.submitted_attempts }}</strong><small>{{ summary.submitted_users }} 人</small></div>
        </div>

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

        <div class="panel score-panel">
          <div class="panel-title">按难度成绩分析 <span>每人已出分记录的最高分</span></div>
          <div class="composition" aria-label="历史开考难度构成">
            <span class="composition-label">历史开考难度构成</span>
            <el-tag v-for="item in summary.difficulty_composition" :key="item.difficulty" effect="plain">
              {{ difficultyLabel(item.difficulty) }} {{ item.users }} 人
            </el-tag>
            <span v-if="!summary.difficulty_composition.length" class="composition-empty">暂无开考记录</span>
          </div>
          <el-table :data="summary.score_groups" empty-text="暂无最终成绩">
            <el-table-column label="难度" width="90"><template #default="{ row }">{{ difficultyLabel(row.difficulty) }}</template></el-table-column>
            <el-table-column prop="finalized_users" label="最终人数" width="90" />
            <el-table-column label="平均分" width="90"><template #default="{ row }">{{ row.average_score ?? '—' }}</template></el-table-column>
            <el-table-column label="通过率" width="90"><template #default="{ row }">{{ rate(row.pass_rate) }}</template></el-table-column>
            <el-table-column label="分布" min-width="320">
              <template #default="{ row }">
                <span v-for="bucket in row.distribution" :key="bucket.lower" class="bucket re-mono">[{{ bucket.lower }},{{ bucket.upper }}{{ bucket.upper === 100 ? ']' : ')' }} {{ bucket.count }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="panel ranking-panel">
          <div class="panel-title">难度排名 <span>同分并列 1/1/3，用时不打破名次</span></div>
          <el-empty v-if="!filters.difficulty" :image-size="54" description="请先明确选择一个难度" />
          <template v-else>
            <el-table :data="ranking.items" empty-text="该难度暂无最终成绩">
              <el-table-column prop="rank" label="名次" width="72" />
              <el-table-column prop="name" label="姓名" min-width="120" />
              <el-table-column label="来源" width="100"><template #default="{ row }">{{ sourceLabel(row.source) }}</template></el-table-column>
              <el-table-column label="难度" width="90"><template #default="{ row }">{{ difficultyLabel(row.difficulty) }}</template></el-table-column>
              <el-table-column prop="score" label="分数" width="90" />
              <el-table-column label="用时" width="110"><template #default="{ row }">{{ duration(row.duration_seconds) }}</template></el-table-column>
              <el-table-column prop="record_id" label="答卷 ID" width="120" />
            </el-table>
            <el-pagination v-if="ranking.total" v-model:current-page="filters.page" v-model:page-size="filters.page_size"
              :total="ranking.total" layout="total, prev, pager, next" class="pagination" @current-change="onRankingPageChange" />
          </template>
        </div>
        <p class="as-of">统计时点：{{ formatTime(summary.as_of) }}</p>
      </template>
      <el-empty v-else-if="!filters.paper_id" description="请选择考试场次" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onMounted, reactive, ref } from 'vue';
import http, { download } from '../../api/http';
import type {
  ExamDifficulty, LearnerSource, Page, RankRow, TrainingExamSummary, TrainingStatisticsOptions,
  TrainingUncompletedReason,
} from '../../api/training-types';
import { useAuthStore } from '../../stores/auth';

const auth = useAuthStore();
const loading = ref(false);
const options = reactive<TrainingStatisticsOptions>({ papers: [], categories: [] });
const summary = ref<TrainingExamSummary | null>(null);
const ranking = reactive<Page<RankRow>>({ items: [], total: 0, page: 1, page_size: 20 });
const filters = reactive({
  paper_id: '', category_id: '', source: '' as LearnerSource | '',
  difficulty: '' as ExamDifficulty | '', page: 1, page_size: 20,
});
const difficultyOptions: Array<{ value: ExamDifficulty; label: string }> = [
  { value: 'easy', label: '初级' }, { value: 'medium', label: '中级' }, { value: 'hard', label: '高级' },
  { value: 'mixed', label: '固定混档' }, { value: 'unknown', label: '遗留未知' },
];

let requestEpoch = 0;
let rankingEpoch = 0;
function params() {
  return {
    paper_id: filters.paper_id,
    category_id: filters.category_id || undefined,
    source: filters.source || undefined,
    difficulty: filters.difficulty || undefined,
    page: filters.page,
    page_size: filters.page_size,
  };
}
function rate(value: number | null) { return value === null ? '—' : `${(value * 100).toFixed(1)}%`; }
function difficultyLabel(value: ExamDifficulty) { return difficultyOptions.find((item) => item.value === value)?.label || value; }
function sourceLabel(value: LearnerSource | null) { return value === 'institution' ? '本机构' : value === 'external' ? '外来' : '未知'; }
function reasonLabel(value: TrainingUncompletedReason) {
  return ({ learning_incomplete: '未完成学习', not_started: '未参加考试', not_passed: '考试未通过' })[value];
}
function duration(seconds: number) { return `${Math.floor(seconds / 60)}分${seconds % 60}秒`; }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Shanghai' }).format(new Date(value)); }

async function loadRanking(parentEpoch?: number, query = params()) {
  const epoch = ++rankingEpoch;
  if (!query.paper_id || !query.difficulty) {
    Object.assign(ranking, { items: [], total: 0, page: filters.page, page_size: filters.page_size });
    return;
  }
  const data = await http.get('/statistics/training/ranking', { params: query }) as Page<RankRow>;
  if (epoch !== rankingEpoch || (parentEpoch !== undefined && parentEpoch !== requestEpoch)) return;
  Object.assign(ranking, data);
}
async function onRankingPageChange() {
  await loadRanking();
}
async function reload() {
  if (!filters.paper_id) return;
  const epoch = ++requestEpoch;
  rankingEpoch += 1;
  filters.page = 1;
  const query = params();
  summary.value = null;
  Object.assign(ranking, { items: [], total: 0, page: 1, page_size: filters.page_size });
  loading.value = true;
  try {
    const data = await http.get('/statistics/training/summary', { params: query }) as TrainingExamSummary;
    if (epoch !== requestEpoch) return;
    summary.value = data;
    await loadRanking(epoch, query);
  } finally {
    if (epoch === requestEpoch) loading.value = false;
  }
}
function onPaperChange() {
  const selected = options.papers.find((paper) => paper.id === filters.paper_id);
  filters.category_id = selected?.category_id || '';
  void reload();
}
function exportRanking() {
  if (!filters.difficulty) return;
  void download('/statistics/training/export', '培训考试难度排名.xlsx', params());
}

async function initialize() {
  const data = await http.get('/statistics/training/options') as TrainingStatisticsOptions;
  Object.assign(options, data);
  if (!options.papers.some((paper) => paper.id === filters.paper_id) && options.papers.length) {
    filters.paper_id = options.papers[0].id;
    filters.category_id = options.papers[0].category_id || '';
  }
  if (filters.paper_id) await reload();
}

let initialActivationSeen = false;
onMounted(initialize);
onActivated(() => {
  if (!initialActivationSeen) {
    initialActivationSeen = true;
    return;
  }
  void initialize();
});
</script>

<style scoped>
.statistics-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.scope-note{margin-bottom:16px}.filters{flex-wrap:wrap}.kpi-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.kpi{display:flex;flex-direction:column;gap:5px;padding:16px;border:1px solid var(--re-border);border-radius:var(--re-radius);background:#fff}.kpi span{font-size:12px;color:var(--re-text-2)}.kpi strong{font-size:26px;color:var(--re-text)}.kpi small,.panel-title span,.panel p,.as-of{font-size:11px;color:var(--re-text-3)}.detail-row{margin-top:14px}.panel{height:100%;padding:18px;border:1px solid var(--re-border);border-radius:var(--re-radius);background:#fff}.panel-title{font-weight:600;margin-bottom:14px}.panel-title span{font-weight:400;margin-left:8px}.course-value{font-size:34px;font-weight:700;color:var(--re-primary)}.reason-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.reason-grid>div{display:flex;justify-content:space-between;padding:14px;border-radius:8px;background:#f7f8fb}.reason-grid b{font-size:20px}.score-panel,.ranking-panel{margin-top:14px;height:auto}.composition{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:-2px 0 14px}.composition-label,.composition-empty{font-size:12px;color:var(--re-text-3);margin-right:2px}.bucket{display:inline-block;margin:3px 8px 3px 0;padding:3px 7px;border-radius:5px;background:#f1f3f8;font-size:11px}.pagination{justify-content:flex-end;margin-top:14px}.as-of{text-align:right;margin:14px 0 0}@media(max-width:1280px){.kpi-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
</style>
