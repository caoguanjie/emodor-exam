<script setup lang="ts">
import { ref, watch } from 'vue'
import AppPage from '@/components/common/AppPage.vue'
import { examInstructionRules as rules } from './exam-instructions'
import { examTitle, useExamScenario } from '@/fixtures/ui-scenarios/exam'
import { questionTypeLabels, type ExamQuestionTypeSummary } from '@/types/exam'
const questionTypes: ExamQuestionTypeSummary[] = [
  { type: 'single', count: 10, score_per_question: 6, total_score: 60 },
  { type: 'multiple', count: 5, score_per_question: 8, total_score: 40 },
  { type: 'judgment', count: 5, score_per_question: 4, total_score: 20 },
]
const { scenario, loadScenario } = useExamScenario('exam-instructions')
const props = defineProps<{ query: Record<string, unknown> }>()
loadScenario(props.query)
const showDraft = ref(false)
watch(scenario, value => { showDraft.value = !!value.overlay }, { immediate: true })
function start() { uni.navigateTo({ url: '/pages/exam/take' }) }
function list() { uni.reLaunch({ url: '/pages/exam/index' }) }

</script>
<template>
  <AppPage class="paper-page" title="考试须知" :padded="false">
    <view class="paper-body">
      <view class="paper-intro">
        <text class="paper-intro__kicker">PAPER · NO.0016</text>
        <text class="paper-intro__title">{{ examTitle.replace('季度', '季度\n') }}</text>
        <text class="paper-intro__description">满分 120 分 · 请在开始前核对考试信息。</text>
      </view>
      <view class="paper-stats">
        <view class="paper-stat"><view class="paper-stat__value"><text class="paper-stat__number">30</text><text class="paper-stat__unit">分钟</text></view><text class="paper-stat__label">时长</text></view>
        <view class="paper-stat"><view class="paper-stat__value"><text class="paper-stat__number">20</text><text class="paper-stat__unit">道</text></view><text class="paper-stat__label">题量</text></view>
          <view class="paper-stat"><view class="paper-stat__value"><text class="paper-stat__number">72</text><text class="paper-stat__unit">分</text></view><text class="paper-stat__label">及格</text></view>
      </view>
      <view class="paper-composition">
        <text class="paper-section__title">题型构成</text>
        <view v-for="item in questionTypes" :key="item.type" class="paper-composition__row">
          <text class="paper-composition__type">{{ questionTypeLabels[item.type] }}</text>
          <text class="paper-composition__detail">{{ item.count }} 题 × {{ item.score_per_question }} 分</text>
          <text class="paper-composition__score">{{ item.total_score }} 分</text>
        </view>
      </view>
      <view class="paper-rules"><text class="paper-section__title">考试规则</text><view v-for="(rule, index) in rules" :key="rule" class="paper-rule"><text>{{ String(index + 1).padStart(2, '0') }}</text><text>{{ rule }}</text></view></view>
    </view>
    <template #footer><view class="paper-footer"><wd-button block custom-style="font-weight:600" @click="start">开始答题</wd-button><text>开始后计时不可暂停</text></view></template>
    <wd-popup v-model="showDraft" position="center" round :close-on-click-modal="false" custom-style="width: calc(100% - 48px); max-width: 366px"><view class="draft-dialog"><text class="draft-dialog__title">{{ scenario.overlay === 'recover' ? '发现未完成的答题' : '本地草稿无法恢复' }}</text><text>{{ scenario.overlay === 'recover' ? '上次作答于 10-21 14:06，已答 6 / 20 题。考试截止时间不会因重新开始而延长。' : '草稿与当前试卷版本不一致或已损坏，已忽略这份草稿。服务端已保存的作答状态和截止时间不受影响。' }}</text><text v-if="scenario.overlay === 'recover'" class="draft-dialog__remaining">剩余 18:42</text><view v-else class="draft-dialog__reasons"><text>题目版本已更新</text><text>草稿数据损坏</text><text>考试已截止（将查询结果）</text></view><view class="draft-dialog__actions"><wd-button variant="soft" @click="scenario.overlay === 'recover' ? start() : list()">{{ scenario.overlay === 'recover' ? '重新开始' : '返回列表' }}</wd-button><wd-button @click="start">{{ scenario.overlay === 'recover' ? '恢复答题' : '继续作答' }}</wd-button></view></view></wd-popup>
  </AppPage>
</template>
<style scoped src="./exam-instructions.css"></style>
<style scoped>
.draft-dialog { padding:24px; font-size:13px; line-height:1.7; color:var(--app-color-text-secondary); }
.draft-dialog__title { display:block; font-size:19px; color:var(--app-color-text); font-weight:600; margin-bottom:14px; }
.draft-dialog__remaining { display:block; margin:16px 0; color:var(--app-color-primary); font-family:monospace; }
.draft-dialog__actions { display:flex; gap:10px; margin-top:24px; }
.draft-dialog__actions :deep(.wd-button) { flex:1; }
.draft-dialog__reasons { display:flex; flex-direction:column; margin-top:12px; color:var(--app-color-text-muted); font-size:11px; }
</style>
