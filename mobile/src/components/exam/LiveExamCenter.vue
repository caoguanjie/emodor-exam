<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useExamStore } from '@/stores/exam'
import { useSessionStore } from '@/stores/session'
import type { ExamListItem } from '@/types/exam'
import { examEntry, examNumber } from '@/utils/exam-summary'
import { clearExamEntryIntent, readExamEntryIntent } from '@/utils/exam-entry-intent'
const store = useExamStore()
const session = useSessionStore()
async function load() {
  try {
    await store.loadList(1, 'all')
    if (readExamEntryIntent(session.user ? String(session.user.id) : undefined)?.kind === 'exam-tab') clearExamEntryIntent()
  } catch { /* Store owns the error. */ }
}
async function more() { try { await store.loadList(store.list.page + 1, 'all') } catch { /* Retry keeps prior rows. */ } }
let mounted = false
function refresh() { void load() }
onMounted(() => { mounted = true; refresh() })
onShow(() => { if (mounted) refresh() })
// A refresh may accept a different account. The store invalidates the old
// request; explicitly fetch the new account's list after that invalidation.
watch(() => session.user?.id, (next, previous) => {
  if (mounted && next && previous && String(next) !== String(previous)) refresh()
}, { flush: 'post' })
function open(exam: ExamListItem) { uni.navigateTo({ url: examEntry(exam).url }) }
</script>
<template>
  <AppPage class="exam-center-page" title="考试" :back="false" tab="exam" :padded="false">
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
