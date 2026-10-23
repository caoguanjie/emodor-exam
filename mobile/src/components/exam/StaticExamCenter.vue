<script setup lang="ts">
import { ref } from 'vue'
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { examTitle, useExamScenario } from '@/fixtures/ui-scenarios/exam'
const { scenario, loadScenario } = useExamScenario('exam-center')
const props = defineProps<{ query: Record<string, unknown> }>()
loadScenario(props.query)
const selectedTab = ref('全部')
const exams = [
  { title: examTitle, state: '进行中', deadline: '截止 10-25 18:00', duration: 30, count: 20, draft: true, caption: '草稿 · 已答 6 / 20', action: '继续答题' },
  { title: '有限空间作业安全规程测试', state: '进行中', deadline: '截止 10-31 23:59', duration: 25, count: 15, caption: '剩余可考 2 次', action: '开始答题' },
  { title: '电气作业安全基础（外来人员）', state: '待考试', deadline: '10-28 09:00 开考', duration: 20, count: 20, caption: '未到开考时间', action: '未开始' },
  { title: '产业工人综合答题练习', state: '已结束', deadline: '10-12 已截止', duration: 30, count: 20, caption: '最好成绩 92 分', action: '查看结果' },
]
function openExam(index: number) { uni.navigateTo({ url: index === 3 ? '/pages/exam/result' : index === 2 ? '/pages/exam/index?scenario=exam-not-started' : `/pages/exam/instructions?scenario=${index === 0 ? 'exam-draft-recover' : 'exam-instructions'}` }) }
</script>
<template>
  <AppPage tab="exam"><view class="center-heading"><view><text class="center-heading__title">考试</text><text class="center-heading__sub">2 场进行中 · 1 份未交卷草稿</text></view><text class="center-heading__count">04 场</text></view>
    <view class="center-tabs"><text v-for="tab in ['全部', '进行中', '待考试', '已结束']" :key="tab" :class="{ active: selectedTab === tab }" role="button" @click="selectedTab = tab">{{ tab }}</text></view>
    <EmptyState v-if="scenario.state" :title="scenario.state === 'empty' ? '暂无考试' : '考试尚未开始'" :description="scenario.state === 'empty' ? '考试发布后将显示在这里。' : '10-28 09:00 开考，届时可从考试中心进入。'"><wd-button v-if="scenario.state === 'not-started'" @click="scenario.state = undefined">返回考试中心</wd-button></EmptyState>
    <template v-else><view v-for="(exam, index) in exams" v-show="selectedTab === '全部' || selectedTab === exam.state" :key="exam.title" class="exam-card" :class="{ 'exam-card--draft': exam.draft }"><view class="exam-card__top"><text class="exam-card__status" :class="{ 'exam-card__status--muted': index > 1 }">{{ exam.state }}</text><text>{{ exam.deadline }}</text></view><text class="exam-card__title">{{ exam.title }}</text><text class="exam-card__meta">◷ {{ exam.duration }} 分钟　▤ {{ exam.count }} 题　满分 100</text><view v-if="exam.draft" class="exam-card__draft"><text>{{ exam.caption }}</text><text>剩余 18:42</text></view><view v-if="exam.draft" class="exam-card__track"><view /></view><view class="exam-card__bottom"><text>{{ exam.draft ? '上次离开于 10-21 14:06' : exam.caption }}</text><wd-button size="small" :variant="index > 1 ? 'soft' : 'base'" :disabled="index === 2" @click="openExam(index)">{{ exam.action }} ›</wd-button></view></view><text class="center-end">— 没有更多了 —</text></template>
  </AppPage>
</template>
<style scoped>
.center-heading { display: flex; align-items: center; justify-content: space-between; padding: 12px 2px; }.center-heading__title { display: block; font-size: 28px; font-weight: 700; }.center-heading__sub { display: block; margin-top: 6px; color: var(--app-color-text-secondary); font-size: 12px; }.center-heading__count { color: var(--app-color-text-muted); font: 12px monospace; }.center-tabs { display: flex; gap: 22px; padding: 8px 0 18px; color: var(--app-color-text-muted); font-size: 14px; }.center-tabs .active { color: var(--app-color-text); font-weight: 600; border-bottom: 2px solid var(--app-color-primary); padding-bottom: 8px; }.exam-card { background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius-md); padding: 14px; margin-bottom: 12px; }.exam-card--draft { border: 1.5px solid var(--app-color-primary); }.exam-card__top, .exam-card__bottom, .exam-card__draft { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.exam-card__top { font-size: 10px; color: var(--app-color-text-muted); }.exam-card__status { color: var(--app-color-primary); background: var(--app-color-primary-soft); border-radius: 4px; padding: 2px 6px; }.exam-card__status--muted { color: var(--app-color-text-muted); background: var(--app-color-background); }.exam-card__title { display: block; margin: 12px 0 8px; font-size: 16px; font-weight: 600; line-height: 1.5; }.exam-card__meta { font-size: 11px; color: var(--app-color-text-muted); }.exam-card__draft { margin: 12px 0 8px; color: var(--app-color-primary); font-size: 11px; }.exam-card__track { height: 3px; background: var(--app-color-primary-soft); }.exam-card__track > view { height: 100%; width: 30%; background: var(--app-color-primary); }.exam-card__bottom { margin-top: 12px; font-size: 10px; color: var(--app-color-text-muted); }.center-end { display: block; text-align: center; color: var(--app-color-text-muted); font-size: 11px; padding: 16px; }
</style>
