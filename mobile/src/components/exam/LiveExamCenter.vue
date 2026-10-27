<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useExamStore } from '@/stores/exam'
import { useLearnerStore } from '@/stores/learner'
import { useSessionStore } from '@/stores/session'
import { useIdentityStore } from '@/stores/identity'
import type { ExamListItem, ExamListState } from '@/types/exam'
import { examEntry, examNumber, examStatusLabel } from '@/utils/exam-summary'
const store = useExamStore(), filter = ref<ExamListState>('all')
const learner = useLearnerStore(), session = useSessionStore(), identity = useIdentityStore()
const prerequisitesLoading = ref(true)
const guidance = computed(() => {
  if (prerequisitesLoading.value || learner.profileLoading || identity.loading) return { message: '考试资料核验中…', action: '', target: '' }
  if (learner.profileError || !learner.profile || learner.categoryReadRequired) return { message: '个人资料加载失败，请刷新后重试。', action: '刷新资料', target: 'refresh' }
  if (!learner.profile.category_id) return { message: '请选择培训工种，以便匹配考试。', action: '去选择培训工种', target: '/pages/profile/info' }
  if (identity.loadError || !identity.authority) return { message: '实名认证状态加载失败，请刷新后重试。', action: '刷新资料', target: 'refresh' }
  if (identity.authority.status === 'pending') return { message: '实名认证正在处理中，请查看认证进度。', action: '查看认证进度', target: '/pages/identity/index' }
  if (identity.authority.status === 'rejected') return { message: '实名认证未通过，请重新核验后参加新的考试。', action: '重新实名认证', target: '/pages/identity/index' }
  if (identity.authority.status !== 'verified') return { message: '完成实名认证后即可参加新的考试。', action: '去实名认证', target: '/pages/identity/index' }
  return null
})
const tabs: { value: ExamListState; label: string }[] = [{ value: 'all', label: '全部' }, { value: 'active', label: '答题中' }, { value: 'published', label: '已发布' }, { value: 'ended', label: '已结束' }]
async function load() { try { await store.loadList(1, filter.value) } catch { /* Store owns the error. */ } }
async function more() { try { await store.loadList(store.list.page + 1, filter.value) } catch { /* Retry keeps prior rows. */ } }
function selectFilter(state: ExamListState) { if (filter.value !== state) { filter.value = state; void load() } }
let prerequisiteRevision = 0
async function loadPrerequisites() {
  const revision = ++prerequisiteRevision, epoch = session.sessionEpoch
  prerequisitesLoading.value = true
  try {
    if (!session.initialized && !await session.bootstrap()) return
    if (epoch !== session.sessionEpoch || !session.accessToken) return
    await Promise.allSettled([learner.loadProfile(), identity.load()])
  } finally { if (revision === prerequisiteRevision && epoch === session.sessionEpoch) prerequisitesLoading.value = false }
}
let mounted = false
function refresh() { void load(); void loadPrerequisites() }
onMounted(() => { mounted = true; refresh() })
onShow(() => { if (mounted) refresh() })
function open(exam: ExamListItem) { uni.navigateTo({ url: examEntry(exam).url }) }
function followGuidance() { if (guidance.value?.target === 'refresh') void loadPrerequisites(); else if (guidance.value?.target) uni.navigateTo({ url: guidance.value.target }) }
function openHistory() { uni.navigateTo({ url: '/pages/profile/exam-history' }) }
</script>
<template>
  <AppPage tab="exam"><view class="center-heading"><view><text class="center-heading__title">考试</text><text class="center-heading__sub">选择考试后阅读须知并开始答题</text></view><text>{{ store.list.total }} 场</text></view>
    <view class="exam-guidance" v-if="guidance"><text>{{ guidance.message }}</text><wd-button v-if="guidance.action" size="small" variant="soft" @click="followGuidance">{{ guidance.action }}</wd-button></view>
    <wd-button size="small" variant="text" @click="openHistory">考试记录</wd-button>
    <view class="center-tabs"><text v-for="tab in tabs" :key="tab.value" :class="{ active: filter === tab.value }" role="button" :aria-label="tab.label" :aria-pressed="filter === tab.value" @click="selectFilter(tab.value)">{{ tab.label }}</text></view>
    <text v-if="store.listLoading && !store.list.items.length">考试加载中…</text>
    <EmptyState v-else-if="store.listError && !store.list.items.length" title="考试加载失败" :description="store.listError"><wd-button @click="load">重新加载</wd-button></EmptyState>
    <EmptyState v-else-if="!store.list.items.length" title="暂无考试" description="当前筛选下暂无考试。" />
    <view v-for="exam in store.list.items" :key="exam.paper_id" class="exam-card"><text class="exam-card__status">{{ examStatusLabel(exam) }}</text><text class="exam-card__title">{{ exam.title }}</text><view class="exam-card__meta"><text>{{ examNumber(exam.duration_minutes) }} 分钟</text><text>{{ examNumber(exam.question_count) }} 题</text><text>满分 {{ examNumber(exam.total_score) }}</text></view><view class="exam-card__bottom"><text>{{ exam.active_record_id ? '继续原次作答，截止时间不延长' : exam.status !== 'published' ? '本试卷已结束，可查看本人记录' : guidance ? guidance.message : '开考前核验本次考试资格' }}</text><wd-button size="small" :variant="exam.status !== 'published' && !exam.active_record_id ? 'plain' : 'base'" @click="open(exam)">{{ examEntry(exam).label }}</wd-button></view></view>
    <view v-if="store.list.items.length && store.listError" class="list-error">{{ store.listError }}</view><wd-button v-if="store.list.items.length < store.list.total" block variant="soft" :loading="store.listLoading" @click="more">{{ store.listError ? '重试加载' : '加载更多' }}</wd-button>
  </AppPage>
</template>
<style scoped>
.exam-guidance { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px; margin-bottom:12px; border-radius:var(--app-radius-md); background:var(--app-color-primary-soft); font-size:13px; line-height:1.6; }
.center-heading { display:flex; align-items:center; justify-content:space-between; padding:12px 2px; font-size:12px; color:var(--app-color-text-muted); }.center-heading__title { display:block; font-size:28px; font-weight:700; color:var(--app-color-text); }.center-heading__sub { display:block; margin-top:6px; font-size:12px; }.center-tabs { display:flex; gap:22px; padding:8px 0 18px; color:var(--app-color-text-muted); font-size:14px; }.center-tabs .active { color:var(--app-color-primary); font-weight:600; }.exam-card { border:1px solid var(--app-color-border); background:var(--app-color-surface); border-radius:var(--app-radius-md); padding:16px; margin-bottom:12px; }.exam-card__status { font-size:11px; color:var(--app-color-primary); }.exam-card__title { display:block; margin:12px 0; font-size:16px; font-weight:600; }.exam-card__meta { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:16px; color:var(--app-color-text-muted); font-size:11px; }.exam-card__bottom { display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:11px; color:var(--app-color-text-muted); }.list-error { color:var(--app-color-danger); padding:12px 0; font-size:12px; }
</style>
