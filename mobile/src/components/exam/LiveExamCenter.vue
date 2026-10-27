<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useExamStore } from '@/stores/exam'
import { useLearnerStore } from '@/stores/learner'
import { useSessionStore } from '@/stores/session'
import { useIdentityStore } from '@/stores/identity'
import type { ExamListItem } from '@/types/exam'
import { examEntry, examNumber, examStatusLabel } from '@/utils/exam-summary'
const store = useExamStore()
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
async function load() { try { await store.loadList(1, 'all') } catch { /* Store owns the error. */ } }
async function more() { try { await store.loadList(store.list.page + 1, 'all') } catch { /* Retry keeps prior rows. */ } }
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
</script>
<template>
  <AppPage title="考试" :back="false" tab="exam">
    <view class="exam-guidance" v-if="guidance"><text>{{ guidance.message }}</text><wd-button v-if="guidance.action" size="small" variant="soft" @click="followGuidance">{{ guidance.action }}</wd-button></view>
    <text v-if="store.listLoading && !store.list.items.length">考试加载中…</text>
    <EmptyState v-else-if="store.listError && !store.list.items.length" title="考试加载失败" :description="store.listError"><wd-button @click="load">重新加载</wd-button></EmptyState>
    <EmptyState v-else-if="!store.list.items.length" image="/static/states/empty-data.png" title="暂无考试" description="考试发布后将显示在这里。" />
    <view v-for="exam in store.list.items" :key="exam.paper_id" class="exam-card">
      <view class="exam-card__body"><text class="exam-card__title">{{ exam.title }}</text><view class="exam-card__meta"><text class="exam-card__status" :class="{ 'exam-card__status--muted': exam.status !== 'published' && !exam.active_record_id }">{{ examStatusLabel(exam) }}</text><text>· {{ examNumber(exam.duration_minutes) }} 分钟</text></view></view>
      <view class="exam-card__action"><wd-button size="small" :variant="exam.status !== 'published' && !exam.active_record_id ? 'plain' : 'base'" @click="open(exam)">{{ examEntry(exam).kind === 'instructions' ? '进入考试' : examEntry(exam).label }}</wd-button></view>
    </view>
    <view v-if="store.list.items.length && store.listError" class="list-error">{{ store.listError }}</view>
    <wd-button v-if="store.list.items.length < store.list.total" block variant="soft" :loading="store.listLoading" @click="more">{{ store.listError ? '重试加载' : '加载更多' }}</wd-button>
    <text v-else-if="store.list.items.length && !store.listLoading && !store.listError" class="center-end">没有更多了</text>
  </AppPage>
</template>
<style scoped>
.exam-guidance { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px; margin-bottom:12px; border-radius:var(--app-radius-md); background:var(--app-color-primary-soft); font-size:13px; line-height:1.6; }
.exam-card { display:flex; align-items:center; gap:12px; background:var(--app-color-surface); border-radius:var(--app-radius-sm); padding:16px; margin-bottom:12px; }
.exam-card__body { flex:1; min-width:0; }
.exam-card__title { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:16px; font-weight:600; line-height:1.5; }
.exam-card__meta { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:6px; color:var(--app-color-text-muted); font-size:12px; }
.exam-card__status { color:var(--app-color-primary); }
.exam-card__status--muted { color:var(--app-color-text-muted); }
.exam-card__action { flex:none; }
.center-end { display:block; padding:24px 0; text-align:center; color:var(--app-color-text-muted); font-size:12px; }
.list-error { color:var(--app-color-danger); padding:12px 0; font-size:12px; }
</style>
