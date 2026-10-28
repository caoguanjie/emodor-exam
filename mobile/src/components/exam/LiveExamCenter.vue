<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useExamStore } from '@/stores/exam'
import { useLearnerStore } from '@/stores/learner'
import { useSessionStore } from '@/stores/session'
import { useIdentityStore } from '@/stores/identity'
import type { ExamListItem } from '@/types/exam'
import { examEntry, examNumber } from '@/utils/exam-summary'
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
  <AppPage class="exam-center-page" title="考试" :back="false" tab="exam" :padded="false">
    <view class="exam-guidance" v-if="guidance"><text>{{ guidance.message }}</text><wd-button v-if="guidance.action" size="small" variant="soft" @click="followGuidance">{{ guidance.action }}</wd-button></view>
    <text v-if="store.listLoading && !store.list.items.length">考试加载中…</text>
    <EmptyState v-else-if="store.listError && !store.list.items.length" title="考试加载失败" :description="store.listError"><wd-button @click="load">重新加载</wd-button></EmptyState>
    <EmptyState v-else-if="!store.list.items.length" image="/static/states/empty-data.png" title="暂无考试" description="考试发布后将显示在这里。" />
    <view v-for="exam in store.list.items" :key="exam.paper_id" class="exam-card" :class="{ 'exam-card--active': !!exam.active_record_id }" hover-class="exam-card--pressed" @click="open(exam)">
      <text v-if="exam.active_record_id" class="exam-card__status">答题中</text>
      <text class="exam-card__title">{{ exam.title }}</text>
      <view class="exam-card__details">
        <view class="exam-card__meta">
          <view class="exam-card__metric"><AppIcon name="timer" :size="16" color="#969799" /><text>{{ examNumber(exam.duration_minutes) }} 分钟</text></view>
          <view class="exam-card__metric"><AppIcon name="list-ordered" :size="16" color="#969799" /><text>{{ examNumber(exam.question_count) }} 题</text></view>
          <view class="exam-card__metric"><AppIcon name="award" :size="16" color="#969799" /><text>满分 {{ examNumber(exam.total_score) }} 分</text></view>
        </view>
        <view class="exam-card__action"><wd-button size="small" variant="text" custom-style="height:auto;min-height:44px;min-width:0;padding:4px 0;font-size:16px;font-weight:600;line-height:1.35" @click.stop="open(exam)"><view class="exam-card__button-content"><text>{{ examEntry(exam).kind === 'instructions' ? '进入考试' : examEntry(exam).label }}</text><AppIcon name="chevron-right" :size="16" color="#1989fa" /></view></wd-button></view>
      </view>
    </view>
    <view v-if="store.list.items.length && store.listError" class="list-error">{{ store.listError }}</view>
    <wd-button v-if="store.list.items.length < store.list.total" block variant="soft" :loading="store.listLoading" @click="more">{{ store.listError ? '重试加载' : '加载更多' }}</wd-button>
    <text v-else-if="store.list.items.length && !store.listLoading && !store.listError" class="center-end">没有更多了</text>
  </AppPage>
</template>
<style scoped>
.exam-center-page :deep(.app-page__body) { padding:8px 16px calc(80px + var(--app-safe-area-bottom)); }
.exam-guidance { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px; margin-bottom:12px; border-radius:var(--app-radius-md); background:var(--app-color-primary-soft); font-size:14px; line-height:1.6; }
.exam-card { cursor:pointer; display:flex; flex-direction:column; gap:10px; background:var(--app-color-surface); border:1px solid var(--app-color-border); border-radius:18px; padding:14px 16px; margin-bottom:12px; }
.exam-card--pressed { background:var(--app-color-primary-soft); }
.exam-card--active { border-color:var(--app-color-primary); }
.exam-card__status { align-self:flex-start; padding:3px 8px; border-radius:var(--app-radius-sm); color:var(--app-color-primary); background:var(--app-color-primary-soft); font-size:14px; }
.exam-card__title { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; font-size:16px; font-weight:700; line-height:1.5; overflow-wrap:anywhere; }
.exam-card__details { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 12px; }
.exam-card__meta { display:flex; flex-wrap:wrap; align-items:center; gap:14px; max-width:100%; color:var(--app-color-text-secondary); font-size:14px; font-weight:400; line-height:1.5; }
.exam-card__metric { display:flex; align-items:center; gap:4px; white-space:nowrap; }
.exam-card__action { display:flex; flex:none; justify-content:flex-end; margin-left:auto; }
.exam-card__button-content { display:flex; align-items:center; gap:4px; }
.center-end { display:block; padding:24px 0; text-align:center; color:var(--app-color-text-secondary); font-size:14px; }
.list-error { color:var(--app-color-danger); padding:12px 0; font-size:12px; }
</style>
