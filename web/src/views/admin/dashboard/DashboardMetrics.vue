<template>
  <section data-testid="dashboard-overview" :aria-busy="section.loading" aria-label="运营概览">
    <div v-if="section.error" class="overview-message" role="alert"><span>{{ section.error }}</span><button class="dashboard-link" type="button" @click="emit('retry')">重试概览</button></div>
    <div v-else-if="section.loading && !section.data" class="metric-skeleton" role="status">正在加载运营概览…</div>
    <div v-else-if="section.data && hasMetrics" class="metric-grid" :class="{ 'is-refreshing': section.loading }">
      <article v-if="can('students:read') && metrics.learner_count !== undefined" class="metric-card learner-card" data-testid="dashboard-learner-card" data-metric="learners">
        <button type="button" class="metric-primary" data-testid="dashboard-learner-total" aria-label="查看启用学员" @click="emit('openLearners')"><span class="metric-heading"><span>学员总数</span><img class="metric-icon" :src="learnersIcon" width="32" height="32" alt="" aria-hidden="true" draggable="false" /></span><strong data-testid="learner-total">{{ number(metrics.learner_count) }}</strong></button>
        <div class="learner-sources">
          <button type="button" class="source-label" data-testid="dashboard-learner-institution" @click="emit('openLearners', 'institution')"><i class="institution-dot" />本机构 {{ number(metrics.learner_institution_count) }} 人</button>
          <button type="button" class="source-label" data-testid="dashboard-learner-external" @click="emit('openLearners', 'external')"><i class="external-dot" />外来 {{ number(metrics.learner_external_count) }} 人</button>
          <span v-if="metrics.learner_unknown_source_count" class="unknown-label">来源未记录 {{ number(metrics.learner_unknown_source_count) }} 人</span>
        </div>
        <div class="source-track" aria-hidden="true"><span :style="{ flexGrow: metrics.learner_institution_count ?? 0 }" /><span :style="{ flexGrow: metrics.learner_external_count ?? 0 }" /><span v-if="metrics.learner_unknown_source_count" :style="{ flexGrow: metrics.learner_unknown_source_count }" /></div>
      </article>
      <article v-if="can('statistics:read') && metrics.today_participant_count !== undefined" class="metric-card" data-testid="dashboard-today-card" data-metric="today">
        <button type="button" class="metric-primary" data-testid="dashboard-today-link" :disabled="!can('exam_records:read')" aria-label="查看今日考试记录" @click="emit('openPeriod', 'today')"><span class="metric-heading"><span>今日参考人数</span><img class="metric-icon" :src="todayExamsIcon" width="32" height="32" alt="" aria-hidden="true" draggable="false" /></span><strong data-testid="today-participants">{{ number(metrics.today_participant_count) }}</strong><span class="metric-note">累计开考 <span data-testid="today-attempts">{{ number(metrics.today_attempt_count) }}</span> 人次</span></button>
      </article>
      <article v-if="can('statistics:read') && metrics.last_7_days_participant_count !== undefined" class="metric-card" data-testid="dashboard-week-card" data-metric="week">
        <button type="button" class="metric-primary" data-testid="dashboard-week-link" :disabled="!can('exam_records:read')" aria-label="查看近 7 日考试记录" @click="emit('openPeriod', 'last_7_days')"><span class="metric-heading"><span>近 7 日参考人数</span><img class="metric-icon" :src="weeklyExamsIcon" width="32" height="32" alt="" aria-hidden="true" draggable="false" /></span><strong data-testid="week-participants">{{ number(metrics.last_7_days_participant_count) }}</strong><span class="metric-note">累计开考 <span data-testid="week-attempts">{{ number(metrics.last_7_days_attempt_count) }}</span> 人次</span></button>
      </article>
      <article v-if="can('questions:read') && metrics.question_count !== undefined" class="metric-card" data-testid="dashboard-question-card" data-metric="questions">
        <button type="button" class="metric-primary" data-testid="dashboard-question-total" aria-label="查看全部题目" @click="emit('openQuestions')"><span class="metric-heading"><span>题目总数</span><img class="metric-icon" :src="questionsIcon" width="32" height="32" alt="" aria-hidden="true" draggable="false" /></span><strong data-testid="question-total">{{ number(metrics.question_count) }}</strong><span class="metric-note">其中已启用 {{ number(metrics.enabled_question_count) }} 题</span></button>
      </article>
      <article v-if="can('papers:read') && metrics.paper_count !== undefined" class="metric-card" data-testid="dashboard-paper-card" data-metric="papers">
        <button type="button" class="metric-primary" data-testid="dashboard-paper-total" aria-label="查看全部试卷" @click="emit('openPapers')"><span class="metric-heading"><span>试卷总数</span><img class="metric-icon" :src="papersIcon" width="32" height="32" alt="" aria-hidden="true" draggable="false" /></span><strong data-testid="paper-total">{{ number(metrics.paper_count) }}</strong><span class="metric-note">其中已发布 {{ number(metrics.published_paper_count) }} 份</span></button>
      </article>
    </div>
    <p v-else class="overview-message">当前账号没有可展示的首页指标</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import learnersIcon from '../../../assets/dashboard/learners.png';
import todayExamsIcon from '../../../assets/dashboard/today-exams.png';
import weeklyExamsIcon from '../../../assets/dashboard/weekly-exams.png';
import questionsIcon from '../../../assets/dashboard/questions.png';
import papersIcon from '../../../assets/dashboard/papers.png';
import type { AdminDashboard, LearnerSource } from '../../../api/training-types';
import type { DashboardSection } from '../../../composables/useAdminDashboard';
const props = defineProps<{ section: DashboardSection<AdminDashboard>; can: (permission: string) => boolean }>();
const emit = defineEmits<{ openLearners: [source?: LearnerSource]; openPeriod: [period: 'today' | 'last_7_days']; openQuestions: []; openPapers: []; retry: [] }>();
const metrics = computed(() => props.section.data?.metrics ?? {});
const hasMetrics = computed(() => Object.values(metrics.value).some(value => value !== undefined));
const number = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('zh-CN');
</script>

<style scoped>
.metric-grid{display:grid;grid-template-columns:minmax(0,1.5fr) repeat(4,minmax(0,1fr));gap:16px}.metric-card{box-sizing:border-box;min-width:0;min-height:164px;border:1px solid var(--dashboard-line);border-radius:var(--dashboard-radius);background:var(--re-surface,#fff);padding:24px 16px 16px}.metric-primary{display:flex;flex-direction:column;gap:16px;width:100%;padding:0;border:0;background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer}.metric-primary:disabled{color:inherit;cursor:default}.metric-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;font-size:14px;color:var(--re-text-2)}.metric-icon{display:block;flex:none;width:32px;height:32px;object-fit:contain;user-select:none}.metric-primary strong{font-family:var(--re-mono);font-weight:500;line-height:1.25;font-size:32px;letter-spacing:-1px}.metric-note{font-size:12px;color:var(--dashboard-muted);line-height:1.5}.learner-card{display:flex;flex-direction:column;gap:12px}.learner-card .metric-primary{gap:16px}.learner-sources{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px 12px}.source-label{display:inline-flex;align-items:center;gap:5px;padding:0;border:0;background:transparent;color:var(--re-text-2);font-family:inherit;font-size:12px;cursor:pointer}.source-label:hover{text-decoration:underline}.source-label i{height:6px;width:6px;border-radius:50%;flex:none}.institution-dot{background:var(--re-primary)}.external-dot{background:#16877e}.unknown-label{font-size:11px;color:var(--dashboard-muted)}.source-track{display:flex;height:4px;gap:3px;margin-top:auto;background:var(--dashboard-soft);border-radius:4px;overflow:hidden}.source-track span{flex-basis:0;background:var(--re-primary)}.source-track span:nth-child(2){background:#16877e}.source-track span:nth-child(3){background:var(--dashboard-muted)}.overview-message,.metric-skeleton{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:12px;margin:0;min-height:164px;padding:24px;border:1px solid var(--dashboard-line);border-radius:var(--dashboard-radius);background:var(--re-surface,#fff);color:var(--dashboard-muted);font-size:13px}.is-refreshing{opacity:.65}@media(max-width:1250px){.metric-grid{gap:12px}.metric-card{padding:20px 12px 14px}.metric-heading{font-size:12px}.metric-primary strong{font-size:28px}.source-label{font-size:11px}}@media(max-width:1050px){.metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.learner-card{grid-column:span 2}}@media(max-width:650px){.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-card{min-height:150px}}
</style>
