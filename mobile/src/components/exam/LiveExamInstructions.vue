<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useExamStore } from '@/stores/exam'
import { examAttemptsLabel, examNumber, examEntry } from '@/utils/exam-summary'
import { questionTypeLabels } from '@/types/exam'
import { useSessionStore } from '@/stores/session'
import { useLearnerStore } from '@/stores/learner'
import { useIdentityStore } from '@/stores/identity'
import { needsLearnerProfile } from '@/utils/learner-onboarding'
import { saveExamEntryIntent } from '@/utils/exam-entry-intent'
const props = defineProps<{ paperId: string }>(), store = useExamStore(), starting = ref(false), actionError = ref('')
const session = useSessionStore(), learner = useLearnerStore(), identityStore = useIdentityStore()
let active = true, pageRevision = 0
function deactivate() { active = false; pageRevision++ }
onHide(deactivate)
onBeforeUnmount(deactivate)
const paper = computed(() => store.summary?.paper_id === props.paperId ? store.summary : null)
const learning = computed(() => paper.value?.learning)
const hasRequirement = computed(() => typeof learning.value?.required_learning_minutes === 'number' && learning.value.required_learning_minutes > 0)
const learningKnown = computed(() => typeof learning.value?.remaining_seconds === 'number' && Number.isFinite(learning.value.remaining_seconds))
const needsLearning = computed(() => hasRequirement.value && (!learningKnown.value || learning.value!.remaining_seconds! > 0))
const learningCreditedMinutes = computed(() => {
  const credited = learning.value?.credited_seconds
  return typeof credited === 'number' && Number.isFinite(credited) ? Math.floor(Math.max(0, credited) / 60) : null
})
const learningProgress = computed(() => {
  const required = learning.value?.required_learning_minutes, credited = learning.value?.credited_seconds
  if (typeof required !== 'number' || !Number.isFinite(required) || required <= 0 || typeof credited !== 'number' || !Number.isFinite(credited)) return null
  return Math.min(100, Math.max(0, credited / (required * 60) * 100))
})
const entry = computed(() => paper.value ? examEntry(paper.value) : null)
const questionTypes = computed(() => paper.value?.question_types?.filter(item => item.count > 0) ?? [])
const rules = ['考试开始后计时不会暂停，刷新、退出或切后台均不延长截止时间。', '答案仅保存为本人本机草稿，截止前可恢复原次作答且截止时间不变；刷新时需联网获取题目。', '请提前交卷，确认交卷成功后再退出。时间到了不会自动交卷，未成功交卷不计成绩；交卷成功后不能修改答案。']
async function reload() {
  actionError.value = ''
  if (!props.paperId) return
  try { await store.loadSummary(props.paperId) } catch { /* Store exposes retryable detail errors. */ }
}
watch(() => props.paperId, reload, { immediate: true })
let mounted = false
onMounted(() => { mounted = true })
onShow(() => { active = true; if (mounted) void reload() })
async function start() {
  if (starting.value || store.summaryLoading || !paper.value) return
  if (entry.value?.kind !== 'instructions') { if (entry.value) uni.redirectTo({ url: entry.value.url }); return }
  if (needsLearning.value) { await reload(); return }
  starting.value = true; actionError.value = ''
  const epoch = session.sessionEpoch, current = pageRevision
  const stillHere = () => active && epoch === session.sessionEpoch && current === pageRevision
  try {
    const profile = await learner.loadProfile()
    if (!stillHere()) return
    if (needsLearnerProfile(profile)) {
      saveExamEntryIntent({ kind: 'exam-instructions', paperId: props.paperId }, String(session.user!.id))
      uni.navigateTo({ url: '/pages/profile/info?onboarding=1' })
      return
    }
    await identityStore.load()
    if (!stillHere()) return
    if (identityStore.loadError || !identityStore.authority) throw new Error(identityStore.loadError || '实名状态读取失败，请重试')
    if (!identityStore.verified) { identity(); return }
    await store.start(props.paperId)
    if (!stillHere()) return
    const attempt = store.attempt
    if (attempt) uni.redirectTo({ url: `/pages/exam/${attempt.status === 'in_progress' ? 'take' : 'result'}?record_id=${encodeURIComponent(attempt.record_id)}` })
  } catch (error) { if (stillHere()) actionError.value = store.loadError || (error instanceof Error ? error.message : '暂时无法开始考试，请重试') }
  finally { starting.value = false }
}
function identity() {
  if (!session.user) return
  saveExamEntryIntent({ kind: 'exam-instructions', paperId: props.paperId }, String(session.user.id))
  uni.navigateTo({ url: '/pages/identity/index' })
}
function study(course: { id: string; available: boolean }) { if (course.available) uni.navigateTo({ url: `/pages/course/detail?id=${encodeURIComponent(course.id)}&from_exam=${encodeURIComponent(props.paperId)}` }) }
const actionLabel = computed(() => entry.value && entry.value.kind !== 'instructions' ? entry.value.label : needsLearning.value ? '刷新学习进度' : '开始答题')
</script>
<template>
  <AppPage title="考试须知" back-target="/pages/exam/index" :padded="false">
    <view class="paper-body">
      <view v-if="store.summaryLoading" class="paper-loading">考试信息加载中…</view>
      <EmptyState v-else-if="!paperId || store.summaryError || !paper" title="考试信息加载失败" :description="store.summaryError || '未找到考试，请从考试中心重新进入。'"><wd-button v-if="paperId" @click="reload">重新加载</wd-button></EmptyState>
      <template v-else>
        <view class="paper-intro"><text class="paper-intro__title">{{ paper.title }}</text><text v-if="examAttemptsLabel(paper)" class="paper-intro__attempts">{{ examAttemptsLabel(paper) }}</text></view>
        <view class="paper-stats">
          <view class="paper-stat"><view class="paper-stat__value"><text class="paper-stat__number">{{ examNumber(paper.duration_minutes) }}</text><text class="paper-stat__unit">分钟</text></view><text class="paper-stat__label">时长</text></view>
          <view class="paper-stat"><view class="paper-stat__value"><text class="paper-stat__number">{{ examNumber(paper.question_count) }}</text><text class="paper-stat__unit">道</text></view><text class="paper-stat__label">题量</text></view>
          <view class="paper-stat"><view class="paper-stat__value"><text class="paper-stat__number">{{ examNumber(paper.total_score) }}</text><text class="paper-stat__unit">分</text></view><text class="paper-stat__label">满分</text></view>
          <view class="paper-stat"><view class="paper-stat__value"><text class="paper-stat__number">{{ examNumber(paper.pass_score) }}</text><text class="paper-stat__unit">分</text></view><text class="paper-stat__label">及格</text></view>
        </view>
        <view v-if="hasRequirement" class="learning-section" :class="{ 'learning-section--ready': learningKnown && !needsLearning }">
          <view class="learning-section__heading"><AppIcon name="book-open" :size="18" :color="learningKnown && !needsLearning ? '#07c160' : '#1989fa'" /><text>考前学习要求</text></view>
          <text class="learning-section__status">{{ !learningKnown ? '学习进度暂未确认' : needsLearning ? `还需学习 ${Math.ceil(learning!.remaining_seconds! / 60)} 分钟` : '考前学习已达标' }}</text>
          <text class="learning-section__summary">已有效学习 {{ learningCreditedMinutes === null ? '—' : learningCreditedMinutes }} 分钟 · 要求 {{ examNumber(learning!.required_learning_minutes) }} 分钟</text>
          <view v-if="learningProgress !== null" class="learning-section__progress" role="progressbar" aria-label="考前学习进度" :aria-valuenow="learningProgress" aria-valuemin="0" aria-valuemax="100"><view class="learning-section__progress-fill" :style="{ width: `${learningProgress}%` }" /></view>
          <view class="learning-courses">
            <view v-for="course in learning!.courses" :key="course.id" class="learning-course"><text>{{ course.title || '关联课程' }}</text><wd-button size="small" custom-style="font-weight:600" :disabled="!course.available" @click="study(course)">{{ course.available ? '去学习' : '暂不可学习' }}</wd-button></view>
          </view>
          <text class="learning-section__hint">仅累计以上课程的有效视频学习时长。</text>
        </view>
        <view class="paper-composition">
          <text class="paper-section__title">题型构成</text>
          <template v-if="questionTypes.length">
            <view v-for="item in questionTypes" :key="item.type" class="paper-composition__row">
              <text class="paper-composition__type">{{ questionTypeLabels[item.type] }}</text>
              <text class="paper-composition__detail">{{ examNumber(item.count) }} 题<template v-if="item.score_per_question !== null"> × {{ examNumber(item.score_per_question) }} 分</template></text>
              <text class="paper-composition__score">{{ examNumber(item.total_score) }} 分</text>
            </view>
          </template>
          <text v-else class="paper-composition__unknown">题型信息暂不可用</text>
        </view>
        <view class="paper-section paper-rules"><text class="paper-section__title">考试规则</text><view v-for="(rule, index) in rules" :key="rule" class="paper-rule"><text>{{ String(index + 1).padStart(2, '0') }}</text><text>{{ rule }}</text></view></view>
        <EmptyState v-if="actionError" :title="store.identityReason ? '实名认证' : '暂时无法开始考试'" :description="actionError"><wd-button v-if="store.identityReason" @click="identity">{{ store.identityReason === 'IDENTITY_PENDING' ? '查看实名状态' : '去实名认证' }}</wd-button></EmptyState>
      </template>
    </view>
    <template #footer><view class="paper-footer"><wd-button block custom-style="font-weight:600" :disabled="!paper || store.summaryLoading" :loading="starting" @click="start">{{ actionLabel }}</wd-button><text>{{ entry?.kind === 'resume' ? '继续原次考试，截止时间不会延长' : entry?.kind === 'records' ? paper?.attempts_remaining === 0 ? '考试次数已用完，可查看本试卷最近一次考试结果' : '本试卷已结束，可查看本人考试记录' : needsLearning ? '学习达标后再开始，不消耗考试次数' : '开始后计时不会暂停' }}</text></view></template>
  </AppPage>
</template>
<style scoped>
.paper-body { display:flex; flex-direction:column; gap:16px; padding:4px 20px calc(117px + var(--app-safe-area-bottom)); }
.paper-loading { padding:32px 0; text-align:center; color:var(--app-color-text-muted); font-size:13px; }
.paper-intro { display:flex; flex-direction:column; gap:6px; }
.paper-intro__title { display:block; font-size:22px; line-height:1.3; font-weight:700; overflow-wrap:break-word; }
.paper-intro__attempts { color:var(--app-color-text-secondary); font-size:14px; line-height:1.5; }
.paper-stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); padding:14px 0; background:linear-gradient(120deg,var(--app-color-primary),var(--app-color-primary-deep)); border-radius:18px; color:var(--app-color-surface); }
.paper-stat { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:4px; border-right:1px solid rgba(255,255,255,.2); }
.paper-stat:last-child { border-right:0; }
.paper-stat__value { display:flex; align-items:baseline; justify-content:center; gap:3px; }
.paper-stat__number { font:600 28px/1.2 monospace; }
.paper-stat__unit { font-size:11px; color:rgba(255,255,255,.65); }
.paper-stat__label { font-size:12px; line-height:1.4; color:rgba(255,255,255,.65); }
.paper-section__title { display:block; font-size:16px; font-weight:700; line-height:1.4; }
.paper-composition { display:flex; flex-direction:column; gap:8px; }
.paper-composition__row { display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:12px; background:var(--app-color-surface); }
.paper-composition__type { flex:none; font-size:14px; font-weight:700; }
.paper-composition__detail { flex:1; min-width:0; font-size:12px; line-height:1.5; color:var(--app-color-text-muted); }
.paper-composition__score { flex:none; font-size:13px; color:var(--app-color-text-secondary); }
.paper-composition__unknown { font-size:12px; line-height:1.6; color:var(--app-color-text-muted); }
.paper-rules { display:flex; flex-direction:column; gap:8px; }
.paper-rule { display:flex; gap:10px; font-size:13px; line-height:1.55; color:var(--app-color-text-secondary); }
.paper-rule > text:first-child { flex:none; color:var(--app-color-primary); font:600 12px/1.68 monospace; }
.paper-rule > text:last-child { flex:1; min-width:0; }
.learning-section { --wot-button-height-small:44px; --wot-button-padding-small:0 14px; --wot-button-font-size-small:14px; --wot-button-radius-main:8px; padding:16px; border:1px solid rgba(25,137,250,.18); border-left:3px solid var(--app-color-primary); border-radius:var(--app-radius-md); background:linear-gradient(180deg,var(--app-color-primary-soft),var(--app-color-surface) 148px); }
.learning-section__heading { display:flex; align-items:center; gap:8px; font-size:15px; font-weight:600; line-height:1.4; color:var(--app-color-primary); }
.learning-section__status { display:block; margin-top:12px; color:var(--app-color-primary); font-size:20px; font-weight:700; line-height:1.4; }
.learning-section__summary { display:block; margin-top:6px; color:var(--app-color-text-secondary); font-size:13px; line-height:1.6; }
.learning-section__progress { height:5px; margin-top:12px; overflow:hidden; border-radius:3px; background:var(--app-color-primary-soft); }
.learning-section__progress-fill { height:100%; border-radius:inherit; background:var(--app-color-primary); }
.learning-section--ready { border-color:rgba(7,193,96,.2); border-left-color:var(--app-color-success); background:linear-gradient(180deg,#eefbf4,var(--app-color-surface) 148px); }
.learning-section--ready .learning-section__heading, .learning-section--ready .learning-section__status { color:var(--app-color-success); }
.learning-section--ready .learning-section__progress { background:#e4f7ec; }
.learning-section--ready .learning-section__progress-fill { background:var(--app-color-success); }
.learning-courses { display:flex; flex-direction:column; gap:12px; margin-top:14px; padding-top:14px; border-top:1px solid var(--app-color-border); }
.learning-course { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.learning-course > text { flex:1; min-width:0; font-size:14px; line-height:1.5; overflow-wrap:break-word; }
.learning-course :deep(.wd-button) { flex:none; }
.learning-section__hint { display:block; margin-top:12px; color:var(--app-color-text-muted); font-size:12px; line-height:1.6; }
.paper-footer { --wot-button-height-medium:50px; --wot-button-radius-main:12px; --wot-button-font-size-medium:16px; --wot-button-padding-medium:0 22px; position:fixed; z-index:3; left:0; right:0; bottom:0; padding:12px 20px calc(12px + var(--app-safe-area-bottom)); text-align:center; background:var(--app-color-surface); border-top:1px solid var(--app-color-border); }
.paper-footer > text { display:block; margin-top:8px; color:var(--app-color-text-muted); font-size:11px; line-height:1.4; }
@media (max-width:374px) { .paper-stats { grid-template-columns:repeat(2,minmax(0,1fr)); row-gap:18px; } .paper-stat:nth-child(2) { border-right:0; } }
</style>
