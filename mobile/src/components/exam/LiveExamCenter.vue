<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import ExamCenterLayout from './ExamCenterLayout.vue'
import ExamCenterCard from './ExamCenterCard.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useExamStore } from '@/stores/exam'
import { useSessionStore } from '@/stores/session'
import { examPurposeLabel, type ExamListState, type ExamListItem } from '@/types/exam'
import { examAttemptsLabel, examEntry, examDeadlineLabel } from '@/utils/exam-summary'
import { clearExamEntryIntent, readExamEntryIntent } from '@/utils/exam-entry-intent'
const store = useExamStore()
const props = withDefaults(defineProps<{ purpose?: 'formal' | 'practice' }>(), { purpose: 'formal' })
const session = useSessionStore()
const state = ref<ExamListState>('all')
const subtitle = computed(() => store.listLoading ? '正在加载考试信息…' : `已加载 ${store.list.items.length} 场 · ${store.list.items.filter(exam => exam.active_record_id).length} 场答题中`)
function filter(value: ExamListState) { state.value = value; void load() }
async function load() {
  try {
    await store.loadList(1, state.value, props.purpose)
    if (readExamEntryIntent(session.user ? String(session.user.id) : undefined)?.kind === 'exam-tab') clearExamEntryIntent()
  } catch { /* Store owns the error. */ }
}
async function more() { try { await store.loadList(store.list.page + 1, state.value, props.purpose) } catch { /* Retry keeps prior rows. */ } }
let mounted = false
function refresh() { void load() }
onMounted(() => { mounted = true; refresh() })
onShow(() => { if (mounted) refresh() })
// A refresh may accept a different account. The store invalidates the old
// request; explicitly fetch the new account's list after that invalidation.
watch(() => session.user?.id, (next, previous) => {
  if (mounted && next && previous && String(next) !== String(previous)) refresh()
}, { flush: 'post' })
function entry(exam: ExamListItem) {
  if (state.value === 'ended' && exam.latest_record_id && !exam.active_record_id) return { kind: 'records', label: '查看结果', url: `/pages/exam/result?record_id=${encodeURIComponent(exam.latest_record_id)}` }
  return examEntry(exam)
}
function open(exam: ExamListItem) { uni.navigateTo({ url: entry(exam).url }) }
</script>
<template>
  <ExamCenterLayout :total="store.list.total" :subtitle="subtitle" :state="state" :practice="purpose === 'practice'" @filter="filter">
    <text v-if="store.listLoading && !store.list.items.length">考试加载中…</text>
    <EmptyState v-else-if="store.listError && !store.list.items.length" title="考试加载失败" :description="store.listError"><wd-button @click="load">重新加载</wd-button></EmptyState>
    <EmptyState v-else-if="!store.list.items.length" image="/static/states/empty-data.png" :title="state === 'ended' ? '暂无已结束的考试' : '暂无考试'" :description="state === 'ended' ? '已完成的考试将显示在这里。' : '考试发布后将显示在这里。'" />
    <ExamCenterCard v-for="exam in store.list.items" :key="exam.paper_id"
      :title="exam.title" :active="!!exam.active_record_id"
      :status="exam.active_record_id ? '答题中' : state === 'ended' ? '已结束' : exam.status === 'published' ? '待考试' : '已结束'"
      :waiting="state !== 'ended' && !exam.active_record_id && exam.status === 'published'" :ended="!exam.active_record_id && (state === 'ended' || exam.status !== 'published')"
      :duration="exam.duration_minutes" :count="exam.question_count" :total-score="exam.total_score" :pass-score="exam.pass_score"
      :caption="state === 'ended' ? undefined : examDeadlineLabel(exam)" :purpose-label="examPurposeLabel(exam)" :hint="examAttemptsLabel(exam) || (exam.active_record_id ? '恢复原次作答，截止时间不变' : entry(exam).kind === 'records' ? '查看本人考试记录' : '开始前请先阅读考试须知')"
      :action="entry(exam).kind === 'instructions' ? '进入考试' : entry(exam).label"
      @open="open(exam)" />
    <view v-if="store.list.items.length && store.listError" class="list-error">{{ store.listError }}</view>
    <wd-button v-if="store.list.items.length < store.list.total" block variant="soft" :loading="store.listLoading" @click="more">{{ store.listError ? '重试加载' : '加载更多' }}</wd-button>
    <text v-else-if="store.list.items.length && !store.listLoading && !store.listError" class="center-end">没有更多了</text>
  </ExamCenterLayout>
</template>
<style scoped>
.center-end { display:block; padding:4px 0; text-align:center; color:var(--app-color-text-muted); font-size:12px; }
.list-error { color:var(--app-color-danger); padding:12px 0; font-size:12px; }
</style>
