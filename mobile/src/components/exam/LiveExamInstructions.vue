<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useExamStore } from '@/stores/exam'
import { examNumber, examEntry } from '@/utils/exam-summary'
const props = defineProps<{ paperId: string }>(), store = useExamStore(), starting = ref(false), actionError = ref('')
const paper = computed(() => store.summary?.paper_id === props.paperId ? store.summary : null)
const learning = computed(() => paper.value?.learning)
const hasRequirement = computed(() => typeof learning.value?.required_learning_minutes === 'number' && learning.value.required_learning_minutes > 0)
const learningKnown = computed(() => typeof learning.value?.remaining_seconds === 'number' && Number.isFinite(learning.value.remaining_seconds))
const needsLearning = computed(() => hasRequirement.value && (!learningKnown.value || learning.value!.remaining_seconds! > 0))
const entry = computed(() => paper.value ? examEntry(paper.value) : null)
const rules = ['倒计时以服务端截止时间为准，刷新或切后台不会暂停。', '答案保存为本人本机草稿，短时断网可继续答题；刷新页面需要联网重新获取题目。', '退出前会再次确认，截止前可从考试中心继续原考试。', '时间到只锁定作答。未成功主动交卷按超时处理，不再接受提交。', '请主动点击交卷，交卷后不可修改答案。']
async function reload() {
  actionError.value = ''
  if (!props.paperId) return
  try { await store.loadSummary(props.paperId) } catch { /* Store exposes retryable detail errors. */ }
}
watch(() => props.paperId, reload, { immediate: true })
let mounted = false
onMounted(() => { mounted = true })
onShow(() => { if (mounted) void reload() })
async function start() {
  if (starting.value || store.summaryLoading || !paper.value) return
  if (entry.value?.kind !== 'instructions') { if (entry.value) uni.redirectTo({ url: entry.value.url }); return }
  if (needsLearning.value) { await reload(); return }
  starting.value = true; actionError.value = ''
  try {
    await store.start(props.paperId)
    const attempt = store.attempt
    if (attempt) uni.redirectTo({ url: `/pages/exam/${attempt.status === 'in_progress' ? 'take' : 'result'}?record_id=${encodeURIComponent(attempt.record_id)}` })
  } catch (error) { actionError.value = error instanceof Error ? error.message : '暂时无法开始考试，请重试' }
  finally { starting.value = false }
}
function identity() { uni.navigateTo({ url: '/pages/identity/index' }) }
function study(course: { id: string; available: boolean }) { if (course.available) uni.navigateTo({ url: `/pages/course/detail?id=${encodeURIComponent(course.id)}&from_exam=${encodeURIComponent(props.paperId)}` }) }
const actionLabel = computed(() => entry.value?.kind === 'resume' ? '继续答题' : entry.value?.kind === 'records' ? '查看记录' : needsLearning.value ? '刷新学习进度' : '开始答题')
</script>
<template>
  <AppPage title="考试须知" back-target="/pages/exam/index">
    <view class="paper-body">
      <view v-if="store.summaryLoading" class="paper-loading">考试信息加载中…</view>
      <EmptyState v-else-if="!paperId || store.summaryError || !paper" title="考试信息加载失败" :description="store.summaryError || '未找到考试，请从考试中心重新进入。'"><wd-button v-if="paperId" @click="reload">重新加载</wd-button></EmptyState>
      <template v-else>
        <view class="paper-intro"><text class="paper-intro__eyebrow">PAPER · {{ paperId }}</text><text class="paper-intro__title">{{ paper.title }}</text><view class="paper-intro__metadata"><text>满分 {{ examNumber(paper.total_score) }} 分</text><text>及格线 {{ examNumber(paper.pass_score) }} 分</text></view></view>
        <view class="paper-stats"><view><text>{{ examNumber(paper.duration_minutes) }}</text><text>分钟</text></view><view><text>{{ examNumber(paper.question_count) }}</text><text>题</text></view><view><text>{{ examNumber(paper.pass_score) }}</text><text>及格分</text></view></view>
        <view v-if="hasRequirement" class="paper-section learning-section"><text class="paper-section__title">考前学习要求</text><text class="learning-section__status" :class="{ 'learning-section__status--ready': learningKnown && !needsLearning }">{{ !learningKnown ? '学习进度暂未确认' : needsLearning ? `还需学习 ${Math.ceil(learning!.remaining_seconds! / 60)} 分钟` : '考前学习已达标' }}</text><text class="learning-section__summary">要求累计 {{ examNumber(learning!.required_learning_minutes) }} 分钟 · 已有效学习 {{ typeof learning!.credited_seconds === 'number' ? Math.floor(learning!.credited_seconds / 60) : '—' }} 分钟</text><view v-for="course in learning!.courses" :key="course.id" class="learning-course"><text>{{ course.title || '关联课程' }}</text><wd-button size="small" variant="plain" :disabled="!course.available" @click="study(course)">{{ course.available ? '去学习' : '暂不可学习' }}</wd-button></view><text class="learning-section__hint">仅累计以上课程的有效视频学习时长。</text><wd-button v-if="!needsLearning" size="small" variant="text" :loading="store.summaryLoading" @click="reload">刷新学习进度</wd-button></view>
        <view class="paper-section"><text class="paper-section__title">考试规则</text><view v-for="(rule, index) in rules" :key="rule" class="paper-rule"><text>{{ String(index + 1).padStart(2, '0') }}</text><text>{{ rule }}</text></view></view>
        <EmptyState v-if="actionError" :title="store.identityReason ? '实名认证' : '暂时无法开始考试'" :description="actionError"><wd-button v-if="store.identityReason" @click="identity">{{ store.identityReason === 'IDENTITY_PENDING' ? '查看实名状态' : '去实名认证' }}</wd-button></EmptyState>
      </template>
    </view>
    <template #footer><view class="paper-footer"><wd-button block :disabled="!paper || store.summaryLoading" :loading="starting" @click="start">{{ actionLabel }}</wd-button><text>{{ entry?.kind === 'resume' ? '继续原次考试，截止时间不会延长' : entry?.kind === 'records' ? '本试卷已结束，可查看本人考试记录' : needsLearning ? '学习达标后再开始，不消耗考试次数' : '开始前由服务端核验最新资格' }}</text></view></template>
  </AppPage>
</template>
<style scoped>
.paper-body { padding-bottom:105px; }.paper-loading { padding:32px 16px; text-align:center; color:var(--app-color-text-muted); font-size:13px; }.paper-intro { padding:4px 0 18px; }.paper-intro__eyebrow { color:var(--app-color-primary); font:11px monospace; letter-spacing:2px; }.paper-intro__title { display:block; margin:12px 0; font-size:23px; line-height:1.4; font-weight:700; overflow-wrap:anywhere; }.paper-intro__metadata { display:flex; flex-wrap:wrap; gap:12px; color:var(--app-color-text-secondary); font-size:12px; }.paper-stats { display:flex; padding:16px 0; margin-bottom:16px; background:linear-gradient(120deg,var(--app-color-primary),var(--app-color-primary-deep)); border-radius:var(--app-radius-md); color:var(--app-color-surface); }.paper-stats > view { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; border-right:1px solid rgba(255,255,255,.2); }.paper-stats > view:last-child { border-right:0; }.paper-stats > view > text:first-child { font:600 26px monospace; }.paper-stats > view > text:last-child { font-size:11px; }.paper-section { background:var(--app-color-surface); border-radius:var(--app-radius-md); padding:18px 16px; margin-bottom:16px; }.paper-section__title { display:block; font-size:14px; font-weight:600; }.paper-rule { display:flex; gap:12px; margin-top:12px; font-size:12px; line-height:1.7; }.paper-rule > text:first-child { color:var(--app-color-primary); font-family:monospace; }.paper-rule > text:last-child { flex:1; }.learning-section__status { display:block; margin-top:12px; color:var(--app-color-primary); font-size:15px; font-weight:600; }.learning-section__status--ready { color:var(--app-color-success); }.learning-section__summary { display:block; margin:8px 0 12px; color:var(--app-color-text-secondary); font-size:12px; line-height:1.6; }.learning-course { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 0; }.learning-course > text { flex:1; min-width:0; font-size:13px; overflow-wrap:anywhere; }.learning-course :deep(.wd-button) { flex:none; }.learning-section__hint { display:block; margin-top:8px; color:var(--app-color-text-muted); font-size:11px; line-height:1.6; }.paper-footer { position:fixed; z-index:3; left:0; right:0; bottom:0; padding:12px 16px calc(12px + var(--app-safe-area-bottom)); text-align:center; background:var(--app-color-surface); border-top:1px solid var(--app-color-border); }.paper-footer > text { display:block; margin-top:8px; color:var(--app-color-text-muted); font-size:11px; }
</style>
