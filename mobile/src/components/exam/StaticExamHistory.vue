<script setup lang="ts">
import { ref } from 'vue'
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { examHistory, useExamScenario } from '@/fixtures/ui-scenarios/exam'
const { scenario, loadScenario } = useExamScenario('exam-history')
const preview = ref(false)
const props = defineProps<{ query: Record<string, unknown> }>()
preview.value = true; loadScenario(props.query)
function open() { uni.navigateTo({ url: `/pages/exam/result${preview.value ? '?scenario=exam-result' : ''}` }) }
</script>
<template>
  <AppPage title="考试记录" :back-target="`/pages/profile/index${preview ? '?scenario=profile-default' : ''}`"><EmptyState v-if="scenario.state === 'empty'" title="暂无考试记录" description="完成考试后可在这里查看成绩。" /><template v-else><view class="history-stats"><view v-for="metric in [{ value: 4, label: '累计参考' }, { value: '74.3', label: '平均分' }, { value: 3, label: '通过' }]" :key="metric.label"><text>{{ metric.value }}</text><text>{{ metric.label }}</text></view></view><view v-for="record in examHistory" :key="record.title" class="history-record" role="button" :aria-label="`查看${record.title}结果`" @click="open"><view class="history-record__body"><text class="history-record__title">{{ record.title }}</text><view class="history-record__meta"><text :class="record.score >= 60 ? 'pass' : 'fail'">{{ record.score >= 60 ? '通过' : '未通过' }}</text><text>{{ record.time }}</text></view></view><view class="history-record__score" :class="record.score >= 60 ? 'pass' : 'fail'"><text>{{ record.score }}</text><text>分 ›</text></view></view><text class="history-end">— 没有更多数据啦 —</text></template></AppPage>
</template>
<style scoped>
.history-stats { display: flex; background: var(--app-color-primary); color: var(--app-color-surface); border-radius: var(--app-radius-md); padding: 20px 8px; margin-bottom: 18px; }.history-stats > view { flex: 1; text-align: center; }.history-stats > view > text:first-child { display: block; font: 600 27px monospace; }.history-stats > view > text:last-child { font-size: 11px; opacity: .85; }.history-record { display: flex; gap: 12px; align-items: center; padding: 18px 14px; border-radius: var(--app-radius-md); background: var(--app-color-surface); margin-bottom: 12px; }.history-record__body { min-width: 0; flex: 1; }.history-record__title { font-size: 15px; font-weight: 600; line-height: 1.5; }.history-record__meta { display: flex; gap: 12px; align-items: center; margin-top: 12px; color: var(--app-color-text-muted); font-size: 11px; }.history-record__score { white-space: nowrap; }.history-record__score > text:first-child { font: 600 27px monospace; }.history-record__score > text:last-child { font-size: 11px; margin-left: 4px; color: var(--app-color-text-muted); }.pass { color: var(--app-color-success); }.fail { color: var(--app-color-danger); }.history-end { display: block; text-align: center; padding: 20px; color: var(--app-color-text-muted); font-size: 11px; }
</style>
