<script setup lang="ts">
import { onMounted } from 'vue'
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useExamStore } from '@/stores/exam'
import { examHistoryStatusLabel, examPurposeLabel, type ExamHistoryItemV2 } from '@/types/exam'
const store = useExamStore()
async function load(page = 1) { try { await store.loadHistory(page) } catch { /* Keep prior records. */ } }
onMounted(() => load())
function open(record: ExamHistoryItemV2) { uni.navigateTo({ url: `/pages/exam/${record.status === 'in_progress' ? 'take' : 'result'}?record_id=${encodeURIComponent(record.record_id)}` }) }
</script>
<template>
  <AppPage title="考试记录" back-target="/pages/profile/index"><text v-if="store.historyLoading && !store.history.items.length">记录加载中…</text><EmptyState v-else-if="store.historyError && !store.history.items.length" title="记录加载失败" :description="store.historyError"><wd-button @click="load()">重新加载</wd-button></EmptyState><EmptyState v-else-if="!store.history.items.length" image="/static/states/empty-data.png" title="暂无考试记录" description="完成考试后可在这里查看成绩。" /><template v-else><text class="history-count">共 {{ store.history.total }} 次考试记录</text><view v-for="record in store.history.items" :key="record.record_id" class="history-record" role="button" :aria-label="`查看${record.paper_title || '考试'}结果`" @click="open(record)"><view class="history-record__body"><text class="history-record__title">{{ record.paper_title || '考试记录' }}</text><view class="history-record__meta"><text>{{ examPurposeLabel(record) }}</text><text :class="record.status === 'passed' ? 'pass' : 'fail'">{{ examHistoryStatusLabel(record) }}</text><text>{{ new Date(record.submitted_at || record.started_at).toLocaleString() }}</text></view></view><view class="history-record__score"><text>{{ record.grading_state === 'finalized' ? record.score : '—' }}</text><text>{{ record.grading_state === 'finalized' ? '分 ›' : '›' }}</text></view></view><text v-if="store.historyError" class="fail">{{ store.historyError }}</text><wd-button v-if="store.history.items.length < store.history.total" block variant="soft" :loading="store.historyLoading" @click="load(store.history.page + 1)">加载更多</wd-button></template></AppPage>
</template>
<style scoped>
.history-count { display:block; margin-bottom:16px; color:var(--app-color-text-muted); font-size:12px; }.history-record { display:flex; gap:12px; align-items:center; padding:18px 14px; border-radius:var(--app-radius-md); background:var(--app-color-surface); margin-bottom:12px; }.history-record__body { min-width:0; flex:1; }.history-record__title { font-size:15px; font-weight:600; }.history-record__meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; color:var(--app-color-text-muted); font-size:11px; }.history-record__score { white-space:nowrap; }.history-record__score > text:first-child { font:600 27px monospace; }.history-record__score > text:last-child { font-size:11px; margin-left:4px; color:var(--app-color-text-muted); }.pass { color:var(--app-color-success); }.fail { color:var(--app-color-danger); }
</style>
