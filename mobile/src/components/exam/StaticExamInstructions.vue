<script setup lang="ts">
import { ref, watch } from 'vue'
import AppPage from '@/components/common/AppPage.vue'
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
const rules = ['考试开始后计时不会暂停，刷新、退出或切后台均不延长截止时间。', '答案仅保存为本人本机草稿，截止前可恢复原次作答且截止时间不变；刷新时需联网获取题目。', '请提前交卷，确认交卷成功后再退出。时间到了不会自动交卷，未成功交卷不计成绩；交卷成功后不能修改答案。']
</script>
<template>
  <AppPage title="考试须知" :padded="false">
    <view class="paper-body">
      <view class="paper-intro"><text class="paper-intro__title">{{ examTitle }}</text></view>
      <view class="paper-stats">
        <view class="paper-stat"><view class="paper-stat__value"><text class="paper-stat__number">30</text><text class="paper-stat__unit">分钟</text></view><text class="paper-stat__label">时长</text></view>
        <view class="paper-stat"><view class="paper-stat__value"><text class="paper-stat__number">20</text><text class="paper-stat__unit">道</text></view><text class="paper-stat__label">题量</text></view>
        <view class="paper-stat"><view class="paper-stat__value"><text class="paper-stat__number">120</text><text class="paper-stat__unit">分</text></view><text class="paper-stat__label">满分</text></view>
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
    <template #footer><view class="paper-footer"><wd-button block custom-style="font-weight:600" @click="start">开始答题</wd-button><text>开始后计时不会暂停</text></view></template>
    <wd-popup v-model="showDraft" position="center" round :close-on-click-modal="false" custom-style="width: calc(100% - 48px); max-width: 366px"><view class="draft-dialog"><text class="draft-dialog__title">{{ scenario.overlay === 'recover' ? '发现未完成的答题' : '本地草稿无法恢复' }}</text><text>{{ scenario.overlay === 'recover' ? '上次作答于 10-21 14:06，已答 6 / 20 题。考试截止时间不会因重新开始而延长。' : '草稿与当前试卷版本不一致或已损坏，已忽略这份草稿。服务端已保存的作答状态和截止时间不受影响。' }}</text><text v-if="scenario.overlay === 'recover'" class="draft-dialog__remaining">剩余 18:42</text><view v-else class="draft-dialog__reasons"><text>题目版本已更新</text><text>草稿数据损坏</text><text>考试已截止（将查询结果）</text></view><view class="draft-dialog__actions"><wd-button variant="soft" @click="scenario.overlay === 'recover' ? start() : list()">{{ scenario.overlay === 'recover' ? '重新开始' : '返回列表' }}</wd-button><wd-button @click="start">{{ scenario.overlay === 'recover' ? '恢复答题' : '继续作答' }}</wd-button></view></view></wd-popup>
  </AppPage>
</template>
<style scoped>
.paper-body { display:flex; flex-direction:column; gap:16px; padding:4px 20px calc(117px + var(--app-safe-area-bottom)); }
.paper-intro { display:flex; flex-direction:column; gap:6px; }
.paper-intro__title { display:block; font-size:22px; line-height:1.3; font-weight:700; overflow-wrap:break-word; }
.paper-stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); padding:14px 0; background:linear-gradient(120deg,var(--app-color-primary),var(--app-color-primary-deep)); border-radius:18px; color:var(--app-color-surface); }
.paper-stat { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:4px; border-right:1px solid rgba(255,255,255,.2); }
.paper-stat:last-child { border-right:0; }
.paper-stat__value { display:flex; align-items:baseline; justify-content:center; gap:3px; }
.paper-stat__number { font:600 28px/1.2 monospace; }
.paper-stat__unit { font-size:11px; color:rgba(255,255,255,.65); }
.paper-stat__label { font-size:12px; line-height:1.4; color:rgba(255,255,255,.65); }
.paper-section__title { display:block; font-size:16px; font-weight:700; line-height:1.4; }
.paper-composition { display:flex; flex-direction:column; gap:8px; }
.paper-composition__row { display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:12px; background:var(--app-color-surface); }
.paper-composition__type { flex:none; font-size:14px; font-weight:700; }
.paper-composition__detail { flex:1; min-width:0; font-size:12px; line-height:1.5; color:var(--app-color-text-muted); }
.paper-composition__score { flex:none; font-size:13px; color:var(--app-color-text-secondary); }
.paper-rules { display:flex; flex-direction:column; gap:8px; }
.paper-rule { display:flex; gap:10px; font-size:13px; line-height:1.55; color:var(--app-color-text-secondary); }
.paper-rule > text:first-child { flex:none; color:var(--app-color-primary); font:600 12px/1.68 monospace; }
.paper-rule > text:last-child { flex:1; min-width:0; }
.paper-footer { --wot-button-height-medium:50px; --wot-button-radius-main:12px; --wot-button-font-size-medium:16px; --wot-button-padding-medium:0 22px; position:fixed; z-index:3; left:0; right:0; bottom:0; padding:12px 20px calc(12px + var(--app-safe-area-bottom)); text-align:center; background:var(--app-color-surface); border-top:1px solid var(--app-color-border); }
.paper-footer > text { display:block; margin-top:8px; color:var(--app-color-text-muted); font-size:11px; line-height:1.4; }
.draft-dialog { padding:24px; font-size:13px; line-height:1.7; color:var(--app-color-text-secondary); }
.draft-dialog__title { display:block; font-size:19px; color:var(--app-color-text); font-weight:600; margin-bottom:14px; }
.draft-dialog__remaining { display:block; margin:16px 0; color:var(--app-color-primary); font-family:monospace; }
.draft-dialog__actions { display:flex; gap:10px; margin-top:24px; }
.draft-dialog__actions :deep(.wd-button) { flex:1; }
.draft-dialog__reasons { display:flex; flex-direction:column; margin-top:12px; color:var(--app-color-text-muted); font-size:11px; }
@media (max-width:374px) { .paper-stats { grid-template-columns:repeat(2,minmax(0,1fr)); row-gap:18px; } .paper-stat:nth-child(2) { border-right:0; } }
</style>
