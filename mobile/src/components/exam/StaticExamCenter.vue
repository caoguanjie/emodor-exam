<script setup lang="ts">
import { computed, ref } from 'vue'
import ExamCenterLayout from './ExamCenterLayout.vue'
import ExamCenterCard from './ExamCenterCard.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { examTitle, useExamScenario } from '@/fixtures/ui-scenarios/exam'
import type { ExamListState } from '@/types/exam'
const { scenario, loadScenario } = useExamScenario('exam-center')
const props = defineProps<{ query: Record<string, unknown>; practice?: boolean }>()
loadScenario(props.query)
const state = ref<ExamListState>('all')
const exams = [
  { title: examTitle, duration: 30, count: 20, totalScore: 100, active: true, status: '进行中', caption: '截止 10-25 18:00', hint: '', action: '继续答题', draft: { answered: 6, total: 20, remaining: '18:42', savedAt: '10-21 14:06' }, filter: 'active' },
  { title: '有限空间作业安全规程测试', duration: 25, count: 15, totalScore: 100, status: '进行中', caption: '截止 10-31 23:59', hint: '剩余可考 2 次', action: '开始答题', filter: 'active' },
  { title: '电气作业安全基础（外来人员）', duration: 20, count: 20, totalScore: 100, waiting: true, disabled: true, status: '待考试', caption: '10-28 09:00 开考', hint: '未到开考时间', action: '未开始', filter: 'published' },
  { title: '产业工人综合答题练习', duration: 30, count: 20, totalScore: 100, ended: true, success: true, status: '已结束', caption: '10-12 已截止', hint: '最好成绩 92 分', action: '查看结果', filter: 'ended' },
]
const practiceExams = [{ title: '消防安全模拟考试', duration: 30, count: 20, totalScore: 100, status: '待考试', caption: '开考后限时 30 分钟', hint: '不限次数', action: '开始模拟', filter: 'published' }]
const available = computed(() => props.practice ? practiceExams : exams)
const visible = computed(() => available.value.filter(exam => state.value === 'all' || exam.filter === state.value))
function openExam(exam: typeof exams[number]) {
  if (exam.disabled) return
  uni.navigateTo({ url: exam.active ? '/pages/exam/take?scenario=exam-single' : exam.ended ? '/pages/exam/result?scenario=exam-result' : '/pages/exam/instructions?scenario=exam-instructions' })
}
</script>
<template>
  <ExamCenterLayout :total="scenario.state ? 0 : available.length" :subtitle="scenario.state ? '考试发布后将显示在这里' : practice ? '不限次数 · 可反复练习' : '2 场进行中 · 1 份未交卷草稿'" :state="state" :practice="practice" @filter="state = $event">
    <EmptyState v-if="scenario.state" :image="scenario.state === 'empty' ? '/static/states/empty-data.png' : ''" :title="scenario.state === 'empty' ? '暂无考试' : '考试尚未开始'" :description="scenario.state === 'empty' ? '考试发布后将显示在这里。' : '10-28 09:00 开考，届时可从考试中心进入。'"><wd-button v-if="scenario.state === 'not-started'" @click="scenario.state = undefined">返回考试中心</wd-button></EmptyState>
    <template v-else>
      <ExamCenterCard v-for="exam in visible" :key="exam.title" v-bind="exam" @open="openExam(exam)" />
      <text class="center-end">— 没有更多了 —</text>
    </template>
  </ExamCenterLayout>
</template>
<style scoped>
.center-end { display:block; padding:4px 0; text-align:center; color:var(--app-color-text-muted); font-size:12px; }
</style>
