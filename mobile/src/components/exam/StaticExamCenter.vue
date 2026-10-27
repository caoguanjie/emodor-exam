<script setup lang="ts">
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { examTitle, useExamScenario } from '@/fixtures/ui-scenarios/exam'
const { scenario, loadScenario } = useExamScenario('exam-center')
const props = defineProps<{ query: Record<string, unknown> }>()
loadScenario(props.query)
const exams = [
  { title: examTitle, state: '进行中', deadline: '截止 10-25 18:00', duration: 30, count: 20, draft: true, caption: '草稿 · 已答 6 / 20', action: '继续答题' },
  { title: '有限空间作业安全规程测试', state: '进行中', deadline: '截止 10-31 23:59', duration: 25, count: 15, caption: '剩余可考 2 次', action: '进入考试' },
  { title: '电气作业安全基础（外来人员）', state: '待考试', deadline: '10-28 09:00 开考', duration: 20, count: 20, caption: '未到开考时间', action: '未开始' },
  { title: '产业工人综合答题练习', state: '已结束', deadline: '10-12 已截止', duration: 30, count: 20, caption: '最好成绩 92 分', action: '查看结果' },
]
function openExam(index: number) { uni.navigateTo({ url: index === 3 ? '/pages/exam/result' : index === 2 ? '/pages/exam/index?scenario=exam-not-started' : `/pages/exam/instructions?scenario=${index === 0 ? 'exam-draft-recover' : 'exam-instructions'}` }) }
</script>
<template>
  <AppPage title="考试" :back="false" tab="exam">
    <EmptyState v-if="scenario.state" :image="scenario.state === 'empty' ? '/static/states/empty-data.png' : ''" :title="scenario.state === 'empty' ? '暂无考试' : '考试尚未开始'" :description="scenario.state === 'empty' ? '考试发布后将显示在这里。' : '10-28 09:00 开考，届时可从考试中心进入。'"><wd-button v-if="scenario.state === 'not-started'" @click="scenario.state = undefined">返回考试中心</wd-button></EmptyState>
    <template v-else><view v-for="(exam, index) in exams" :key="exam.title" class="exam-card"><view class="exam-card__body"><text class="exam-card__title">{{ exam.title }}</text><view class="exam-card__meta"><text class="exam-card__status" :class="{ 'exam-card__status--muted': index > 1 }">{{ exam.state }}</text><text>· {{ exam.duration }} 分钟</text></view></view><view class="exam-card__action"><wd-button size="small" :variant="index > 1 ? 'soft' : 'base'" :disabled="index === 2" @click="openExam(index)">{{ exam.action }}</wd-button></view></view><text class="center-end">没有更多了</text></template>
  </AppPage>
</template>
<style scoped>
.exam-card { display:flex; align-items:center; gap:12px; background:var(--app-color-surface); border-radius:var(--app-radius-sm); padding:16px; margin-bottom:12px; }
.exam-card__body { flex:1; min-width:0; }
.exam-card__title { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:16px; font-weight:600; line-height:1.5; }
.exam-card__meta { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:6px; color:var(--app-color-text-muted); font-size:12px; }
.exam-card__status { color:var(--app-color-primary); }
.exam-card__status--muted { color:var(--app-color-text-muted); }
.exam-card__action { flex:none; }
.center-end { display:block; padding:24px 0; text-align:center; color:var(--app-color-text-muted); font-size:12px; }
</style>
