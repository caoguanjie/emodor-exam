<script setup lang="ts">
import AppPage from '@/components/common/AppPage.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { examTitle, useExamScenario } from '@/fixtures/ui-scenarios/exam'
const { scenario, loadScenario } = useExamScenario('exam-center')
const props = defineProps<{ query: Record<string, unknown> }>()
loadScenario(props.query)
const exams = [
  { title: examTitle, duration: 30, count: 20, totalScore: 100, active: true },
  { title: '有限空间作业安全规程测试', duration: 35, count: 24, totalScore: 120, active: false },
]
function openExam(active: boolean) { uni.navigateTo({ url: active ? '/pages/exam/take?scenario=exam-single' : '/pages/exam/instructions?scenario=exam-instructions' }) }
</script>
<template>
  <AppPage class="exam-center-page" title="考试" :back="false" tab="exam" :padded="false">
    <EmptyState v-if="scenario.state" :image="scenario.state === 'empty' ? '/static/states/empty-data.png' : ''" :title="scenario.state === 'empty' ? '暂无考试' : '考试尚未开始'" :description="scenario.state === 'empty' ? '考试发布后将显示在这里。' : '10-28 09:00 开考，届时可从考试中心进入。'"><wd-button v-if="scenario.state === 'not-started'" @click="scenario.state = undefined">返回考试中心</wd-button></EmptyState>
    <template v-else>
      <view v-for="exam in exams" :key="exam.title" class="exam-card" :class="{ 'exam-card--active': exam.active }" hover-class="exam-card--pressed" @click="openExam(exam.active)">
        <text v-if="exam.active" class="exam-card__status">答题中</text>
        <text class="exam-card__title">{{ exam.title }}</text>
        <view class="exam-card__details">
          <view class="exam-card__meta">
            <view class="exam-card__metric"><AppIcon name="timer" :size="16" color="#969799" /><text>{{ exam.duration }} 分钟</text></view>
            <view class="exam-card__metric"><AppIcon name="list-ordered" :size="16" color="#969799" /><text>{{ exam.count }} 题</text></view>
            <view class="exam-card__metric"><AppIcon name="award" :size="16" color="#969799" /><text>满分 {{ exam.totalScore }} 分</text></view>
          </view>
          <view class="exam-card__action"><wd-button size="small" variant="text" custom-style="height:auto;min-height:44px;min-width:0;padding:4px 0;font-size:16px;font-weight:600;line-height:1.35" @click.stop="openExam(exam.active)"><view class="exam-card__button-content"><text>{{ exam.active ? '继续答题' : '进入考试' }}</text><AppIcon name="chevron-right" :size="16" color="#1989fa" /></view></wd-button></view>
        </view>
      </view>
      <text class="center-end">没有更多了</text>
    </template>
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
</style>
