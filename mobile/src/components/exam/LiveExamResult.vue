<script setup lang="ts">
import { computed, onMounted } from 'vue'
import AppPage from '@/components/common/AppPage.vue'
import AppTopBar from '@/components/common/AppTopBar.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useExamStore } from '@/stores/exam'
import { areOptionIdsCorrect, attemptStatusLabels, examPurposeLabel, questionTypeLabels, type QuestionType } from '@/types/exam'
import { examNumber, practiceRetryUrl } from '@/utils/exam-summary'
const props = defineProps<{ recordId: string }>(), store = useExamStore()
const graded = computed(() => store.result?.grading_state === 'finalized' && ['passed', 'failed'].includes(store.result.status))
const retryUrl = computed(() => practiceRetryUrl(store.result))
const record = computed(() => store.history.items.find(item => item.record_id === props.recordId))
const paperTitle = computed(() => record.value?.paper_title || (store.summary?.paper_id === store.result?.paper_id ? store.summary?.title : '') || examPurposeLabel(store.result || {}))
const elapsed = computed(() => {
  const start = record.value?.started_at, end = store.result?.submitted_at
  if (!start || !end) return ''
  const seconds = Math.floor((Date.parse(end) - Date.parse(start)) / 1000)
  return Number.isFinite(seconds) && seconds >= 0 ? `用时 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : ''
})
const submittedTime = computed(() => {
  const value = store.result?.submitted_at
  if (!value) return '交卷时间未知'
  const time = new Date(value), pad = (n: number) => String(n).padStart(2, '0')
  return `交卷 ${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`
})
const summary = computed(() => {
  const items = store.result?.items || [], correct = items.filter(row => areOptionIdsCorrect(row.selected_option_ids, row.correct_option_ids)).length
  const unanswered = items.filter(row => !row.selected_option_ids.length).length
  return [{ value: correct, label: '答对', kind: 'correct' }, { value: items.length - correct - unanswered, label: '答错', kind: 'wrong' }, { value: unanswered, label: '未答', kind: 'unanswered' }, { value: `${items.length ? Math.round(correct / items.length * 100) : 0}%`, label: '正确率', kind: 'rate' }]
})
const ratios = computed(() => summary.value.slice(0, 3).map(metric => ({ ...metric, width: `${store.result?.items.length ? Number(metric.value) / store.result.items.length * 100 : 0}%` })))
const typeRows = computed(() => (['single', 'multiple', 'judgment'] as QuestionType[]).map(type => {
  const items = store.result?.items.filter(row => row.type === type) || []
  return { type, label: questionTypeLabels[type], count: items.length, correct: items.filter(item => areOptionIdsCorrect(item.selected_option_ids, item.correct_option_ids)).length, score: items.reduce((sum, item) => sum + item.gained_score, 0), total: items.reduce((sum, item) => sum + item.score, 0) }
}).filter(row => row.count))
async function load() { if (!props.recordId) return; try { await store.loadResult(props.recordId) } catch { /* Retry visible. */ } }
onMounted(load)
function list() { uni.reLaunch({ url: '/pages/exam/index' }) }
function review() { uni.navigateTo({ url: `/pages/exam/review?record_id=${encodeURIComponent(props.recordId)}` }) }
function retry() { if (retryUrl.value) uni.redirectTo({ url: retryUrl.value }) }
</script>
<template>
  <AppPage :padded="false"><template #header>
    <view v-if="graded && store.result" class="result-hero">
      <AppTopBar title="考试结果" back-target="/pages/exam/index" light />
      <view class="result-hero__content">
        <text class="result-hero__purpose">{{ paperTitle }}</text>
        <view class="result-hero__score"><text class="result-hero__number">{{ store.result.score }}</text><text class="result-hero__unit">/ {{ examNumber(store.result.total_score) }} 分</text></view>
        <view class="result-hero__status"><wd-icon :name="store.result.status === 'passed' ? 'check-circle' : 'close-circle'" size="15px" /><text>{{ attemptStatusLabels[store.result.status] }} · 及格线 {{ examNumber(store.result.pass_score) }} 分</text></view>
      </view>
    </view>
    <AppTopBar v-else title="考试结果" back-target="/pages/exam/index" />
    </template>
    <view v-if="store.phase === 'loading'" class="result-body">考试结果加载中…</view>
    <EmptyState v-else-if="store.loadError || !store.result" title="考试结果暂不可用" :description="store.loadError || '请从考试记录重新进入。'"><wd-button @click="load">重新加载</wd-button></EmptyState>
    <view v-else-if="!graded"><text class="result-purpose">{{ examPurposeLabel(store.result) }}</text><EmptyState :title="attemptStatusLabels[store.result.status]" :description="store.result.status === 'timeout' ? '考试已截止且未成功主动交卷，本次不生成逐题评分或解析。' : '该历史记录的最终结果待确认，暂不展示成绩与解析。'"><wd-button v-if="retryUrl" @click="retry">返回模拟考须知</wd-button><wd-button type="info" variant="plain" @click="list">返回考试中心</wd-button></EmptyState></view>
    <view v-else class="result-body" :class="{ 'result-body--practice': !!retryUrl }">
      <view class="result-summary">
        <view class="result-summary__metrics"><view v-for="metric in summary" :key="metric.label" class="result-summary__metric" :class="`result-summary__metric--${metric.kind}`"><text class="result-summary__value">{{ metric.value }}</text><text>{{ metric.label }}</text></view></view>
        <view class="result-summary__details">
          <view class="result-summary__ratio" aria-label="答对、答错和未答题目比例"><view v-for="segment in ratios" :key="segment.kind" :class="`result-summary__segment--${segment.kind}`" :style="{ width: segment.width }" /></view>
          <view class="result-summary__meta"><text v-if="elapsed">{{ elapsed }}</text><text class="result-time">{{ submittedTime }}</text></view>
        </view>
      </view>
      <view class="result-types"><text class="result-types__heading">题型得分</text><view v-for="row in typeRows" :key="row.type" class="result-types__row"><view class="result-types__top"><view class="result-types__label"><text>{{ row.label }}</text><text class="result-types__count">对 {{ row.correct }}/{{ row.count }}</text></view><text class="result-types__score">{{ examNumber(row.score) }} / {{ examNumber(row.total) }}</text></view><view class="result-types__track"><view :style="{ width: `${row.total ? row.score / row.total * 100 : 0}%` }" /></view></view></view>
    </view>
    <template #footer><view v-if="graded" class="result-footer" :class="{ 'result-footer--practice': !!retryUrl }"><wd-button type="info" variant="plain" @click="list">返回列表</wd-button><wd-button @click="review">查看答案解析</wd-button><view v-if="retryUrl" class="result-footer__retry"><wd-button block @click="retry">再考一次</wd-button></view></view></template>
  </AppPage>
</template>
<style scoped>
.result-hero__purpose { display:block; font-size:13px; line-height:20px; color:rgba(255,255,255,.8); }
.result-purpose { display:block; padding:12px 16px 0; text-align:center; font-size:13px; color:var(--app-color-text-secondary); }
.result-body.result-body--practice { padding-bottom:164px; }
.result-footer--practice { flex-wrap:wrap; }
.result-footer__retry { flex:1 0 100%; }
.result-hero { padding-bottom:32px; text-align:center; color:var(--app-color-surface); background:linear-gradient(180deg,var(--app-color-primary),var(--app-color-primary-deep)); }
.result-hero__content { display:flex; flex-direction:column; align-items:center; gap:6px; padding:12px 20px 0; }
.result-hero__score { display:flex; align-items:baseline; justify-content:center; gap:4px; }
.result-hero__number { font-family:'Times New Roman',Times,serif; font-style:normal; font-weight:700; font-size:72px; line-height:1.2; font-variant-numeric:tabular-nums; }
.result-hero__unit { font-size:16px; color:rgba(255,255,255,.8); }
.result-hero__status { display:flex; align-items:center; gap:6px; background:rgba(255,255,255,.15); padding:5px 12px; border-radius:14px; font-size:12px; font-weight:600; line-height:18px; }
.result-body { padding:0 16px 100px; }
.result-summary { background:var(--app-color-surface); padding:18px 8px; border-radius:18px; box-shadow:0 8px 24px rgba(25,137,250,.12); }
.result-summary__metrics { display:flex; text-align:center; }
.result-summary__metric { display:flex; flex:1; flex-direction:column; gap:4px; font-size:12px; line-height:18px; color:var(--app-color-text-muted); }
.result-summary__metric + .result-summary__metric { border-left:1px solid var(--app-color-border); }
.result-summary__value { font:normal 700 22px/1.3 'Times New Roman',Times,serif; }
.result-summary__metric--correct .result-summary__value { color:var(--app-color-success); }
.result-summary__metric--wrong .result-summary__value { color:var(--app-color-danger); }
.result-summary__metric--rate .result-summary__value { color:var(--app-color-primary); }
.result-summary__details { margin-top:16px; padding:0 12px; }
.result-summary__ratio { display:flex; height:8px; border-radius:4px; overflow:hidden; background:var(--app-color-border-strong); }
.result-summary__segment--correct { background:var(--app-color-success); }
.result-summary__segment--wrong { background:var(--app-color-danger); }
.result-summary__segment--unanswered { background:var(--app-color-border-strong); }
.result-summary__meta { display:flex; flex-wrap:wrap; gap:4px 12px; justify-content:space-between; margin-top:8px; color:var(--app-color-text-secondary); font-size:12px; line-height:18px; }
.result-time { margin-left:auto; color:var(--app-color-text-muted); font-family:'Times New Roman',Times,serif; }
.result-types { margin-top:14px; padding:16px; border-radius:18px; background:var(--app-color-surface); }
.result-types__heading { font-size:15px; font-weight:700; line-height:22px; }
.result-types__row { margin-top:14px; }
.result-types__top { display:flex; justify-content:space-between; align-items:center; gap:8px; line-height:20px; }
.result-types__label { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; }
.result-types__count { color:var(--app-color-text-muted); font-size:12px; font-weight:400; }
.result-types__score { font:normal 400 13px 'Times New Roman',Times,serif; color:var(--app-color-text-secondary); }
.result-types__track { height:6px; margin-top:8px; border-radius:3px; background:#f2f3f5; overflow:hidden; }
.result-types__track > view { height:100%; border-radius:3px; background:var(--app-color-primary); }
.result-footer { position:fixed; left:0; right:0; bottom:0; padding:12px 16px calc(12px + var(--app-safe-area-bottom)); display:flex; gap:12px; background:var(--app-color-surface); border-top:1px solid var(--app-color-border); --wot-button-height-medium:50px; --wot-button-radius-main:12px; --wot-button-font-weight:600; }
.result-footer :deep(.wd-button) { flex:1; }
</style>
