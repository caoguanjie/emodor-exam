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
const summary = computed(() => {
  const items = store.result?.items || [], correct = items.filter(row => areOptionIdsCorrect(row.selected_option_ids, row.correct_option_ids)).length
  const unanswered = items.filter(row => !row.selected_option_ids.length).length
  return [{ value: correct, label: '答对' }, { value: items.length - correct - unanswered, label: '答错' }, { value: unanswered, label: '未答' }, { value: `${items.length ? Math.round(correct / items.length * 100) : 0}%`, label: '正确率' }]
})
const typeRows = computed(() => (['single', 'multiple', 'judgment'] as QuestionType[]).map(type => {
  const items = store.result?.items.filter(row => row.type === type) || []
  return { type, label: questionTypeLabels[type], count: items.length, score: items.reduce((sum, item) => sum + item.gained_score, 0), total: items.reduce((sum, item) => sum + item.score, 0) }
}).filter(row => row.count))
async function load() { if (!props.recordId) return; try { await store.loadResult(props.recordId) } catch { /* Retry visible. */ } }
onMounted(load)
function list() { uni.reLaunch({ url: '/pages/exam/index' }) }
function review() { uni.navigateTo({ url: `/pages/exam/review?record_id=${encodeURIComponent(props.recordId)}` }) }
function retry() { if (retryUrl.value) uni.redirectTo({ url: retryUrl.value }) }
</script>
<template>
  <AppPage :padded="false"><template #header><view v-if="graded && store.result" class="result-hero"><AppTopBar title="考试结果" back-target="/pages/exam/index" light /><text class="result-hero__purpose">{{ examPurposeLabel(store.result) }}</text><view class="result-hero__score"><text>{{ store.result.score }}</text><text>/ {{ examNumber(store.result.total_score) }} 分</text></view><text class="result-hero__status">{{ attemptStatusLabels[store.result.status] }}</text><text class="result-hero__threshold">及格线 {{ examNumber(store.result.pass_score) }} 分</text></view><AppTopBar v-else title="考试结果" back-target="/pages/exam/index" /></template>
    <view v-if="store.phase === 'loading'" class="result-body">考试结果加载中…</view>
    <EmptyState v-else-if="store.loadError || !store.result" title="考试结果暂不可用" :description="store.loadError || '请从考试记录重新进入。'"><wd-button @click="load">重新加载</wd-button></EmptyState>
    <view v-else-if="!graded"><text class="result-purpose">{{ examPurposeLabel(store.result) }}</text><EmptyState :title="attemptStatusLabels[store.result.status]" :description="store.result.status === 'timeout' ? '考试已截止且未成功主动交卷，本次不生成逐题评分或解析。' : '该历史记录的最终结果待确认，暂不展示成绩与解析。'"><wd-button v-if="retryUrl" @click="retry">返回模拟考须知</wd-button><wd-button type="info" variant="plain" @click="list">返回考试中心</wd-button></EmptyState></view>
    <view v-else class="result-body" :class="{ 'result-body--practice': !!retryUrl }"><view class="result-summary"><view class="result-summary__metrics"><view v-for="metric in summary" :key="metric.label"><text>{{ metric.value }}</text><text>{{ metric.label }}</text></view></view><text class="result-time">交卷 {{ store.result.submitted_at ? new Date(store.result.submitted_at).toLocaleString() : '—' }}</text></view><view class="result-types"><text class="result-types__heading">题型得分</text><view v-for="row in typeRows" :key="row.type" class="result-types__row"><view><text>{{ row.label }} · {{ row.count }} 题</text><text>{{ row.score }} / {{ row.total }}</text></view><view class="result-types__track"><view :style="{ width: `${row.total ? row.score / row.total * 100 : 0}%` }" /></view></view></view></view>
    <template #footer><view v-if="graded" class="result-footer" :class="{ 'result-footer--practice': !!retryUrl }"><wd-button type="info" variant="plain" @click="list">返回列表</wd-button><wd-button @click="review">查看答案解析</wd-button><view v-if="retryUrl" class="result-footer__retry"><wd-button block @click="retry">再考一次</wd-button></view></view></template>
  </AppPage>
</template>
<style scoped>
.result-hero__purpose { display:block; margin-top:8px; font-size:13px; }
.result-purpose { display:block; padding:12px 16px 0; text-align:center; font-size:13px; color:var(--app-color-text-secondary); }
.result-body.result-body--practice { padding-bottom:164px; }
.result-footer--practice { flex-wrap:wrap; }
.result-footer__retry { flex:1 0 100%; }
.result-hero { padding-bottom:28px; text-align:center; color:var(--app-color-surface); background:linear-gradient(180deg,var(--app-color-primary),var(--app-color-primary-deep)); }.result-hero__score { margin-top:10px; display:flex; align-items:baseline; justify-content:center; gap:4px; }.result-hero__score > text:first-child { font:italic 600 72px monospace; }.result-hero__score > text:last-child { font-size:14px; }.result-hero__status { display:inline-block; margin-top:4px; background:rgba(255,255,255,.16); padding:5px 12px; border-radius:16px; font-size:12px; }.result-hero__threshold { display:block; margin-top:8px; font-size:12px; }.result-body { padding:0 16px 100px; }.result-summary { background:var(--app-color-surface); padding:20px 16px 14px; border-radius:0 0 var(--app-radius-md) var(--app-radius-md); }.result-summary__metrics { display:flex; text-align:center; }.result-summary__metrics > view { display:flex; flex:1; flex-direction:column; gap:4px; font-size:11px; color:var(--app-color-text-muted); border-right:1px solid var(--app-color-border); }.result-summary__metrics > view:last-child { border:0; }.result-summary__metrics > view > text:first-child { font:500 22px monospace; color:var(--app-color-primary); }.result-time { display:block; margin-top:18px; color:var(--app-color-text-muted); font-size:11px; }.result-types { margin-top:16px; padding:18px 16px; border-radius:var(--app-radius-md); background:var(--app-color-surface); }.result-types__heading { font-size:15px; font-weight:600; }.result-types__row { margin-top:18px; font-size:12px; }.result-types__row > view:first-child { display:flex; justify-content:space-between; }.result-types__track { height:5px; margin-top:8px; border-radius:4px; background:var(--app-color-background); overflow:hidden; }.result-types__track > view { height:100%; background:var(--app-color-primary); }.result-footer { position:fixed; left:0; right:0; bottom:0; padding:12px 16px calc(12px + var(--app-safe-area-bottom)); display:flex; gap:12px; background:var(--app-color-surface); border-top:1px solid var(--app-color-border); }.result-footer :deep(.wd-button) { flex:1; }
</style>
