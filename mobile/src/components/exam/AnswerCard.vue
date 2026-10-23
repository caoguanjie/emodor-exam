<script setup lang="ts">
import { computed } from 'vue'
import { areOptionIdsCorrect, countAnswered, questionTypeLabels, type ExamAnswers, type ExamTakeItem, type ExamReviewItem, type QuestionType } from '@/types/exam'
const props = withDefaults(defineProps<{ modelValue: boolean; items: ExamTakeItem[]; answers: ExamAnswers; currentId: string; reviews?: ExamReviewItem[] }>(), { reviews: () => [] })
const emit = defineEmits<{ 'update:modelValue': [visible: boolean]; select: [id: string]; submit: [] }>()
const visible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const groups: QuestionType[] = ['single', 'multiple', 'judgment']
const reviewSummary = computed(() => ({
  correct: props.reviews.filter(row => areOptionIdsCorrect(row.selectedOptionIds, row.correctOptionIds)).length,
  wrong: props.reviews.filter(row => row.selectedOptionIds.length > 0 && !areOptionIdsCorrect(row.selectedOptionIds, row.correctOptionIds)).length,
  unanswered: props.reviews.filter(row => row.selectedOptionIds.length === 0).length,
}))
function choose(id: string) { emit('select', id); visible.value = false }
function verdict(id: string) { const review = props.reviews.find(row => row.item.id === id); return review ? areOptionIdsCorrect(review.selectedOptionIds, review.correctOptionIds) ? 'right' : review.selectedOptionIds.length ? 'wrong' : 'unknown' : '' }
</script>
<template>
  <wd-popup v-model="visible" position="bottom" round safe-area-inset-bottom closable>
    <view class="answer-card"><view class="answer-card__heading"><text class="answer-card__title">{{ reviews.length ? '解析卡' : '答题卡' }}</text><text>{{ reviews.length ? `对 ${reviewSummary.correct} · 错 ${reviewSummary.wrong} · 未答 ${reviewSummary.unanswered}` : `已答 ${countAnswered(answers)} · 未答 ${items.length - countAnswered(answers)}` }}</text></view>
      <view class="answer-card__legend"><text>{{ reviews.length ? '■ 正确' : '■ 已答' }}</text><text>{{ reviews.length ? '□ 错误' : '□ 未答' }}</text><text>{{ reviews.length ? '— 未作答' : '▣ 当前' }}</text></view>
      <view v-for="type in groups" :key="type" class="answer-card__group"><text>{{ questionTypeLabels[type] }} · {{ items.filter(item => item.type === type).length }} 题</text><view class="answer-card__grid"><view v-for="item in items.filter(row => row.type === type)" :key="item.id" class="answer-card__cell" :class="[answers[item.id]?.length ? 'answer-card__cell--done' : '', currentId === item.id ? 'answer-card__cell--current' : '', verdict(item.id) && `answer-card__cell--${verdict(item.id)}`]" role="button" :aria-label="`跳转第 ${items.indexOf(item) + 1} 题`" @click="choose(item.id)">{{ items.indexOf(item) + 1 }}</view></view></view>
      <wd-button v-if="!reviews.length" block @click="emit('submit')">交卷</wd-button>
    </view>
  </wd-popup>
</template>
<style scoped>
.answer-card { max-height: 75vh; overflow-y: auto; padding: 24px 20px; }.answer-card__heading { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--app-color-text-muted); }.answer-card__title { font-size: 18px; font-weight: 600; color: var(--app-color-text); }.answer-card__legend { display: flex; gap: 16px; margin: 18px 0; color: var(--app-color-primary); font-size: 11px; }.answer-card__group { margin-bottom: 20px; font-size: 12px; color: var(--app-color-text-secondary); }.answer-card__grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }.answer-card__cell { height: 44px; border: 1px solid var(--app-color-border-strong); border-radius: 10px; display: flex; align-items: center; justify-content: center; font: 13px monospace; }.answer-card__cell--done { color: var(--app-color-surface); background: var(--app-color-primary); border-color: var(--app-color-primary); }.answer-card__cell--current { border-color: var(--app-color-primary); color: var(--app-color-primary); background: var(--app-color-surface); }.answer-card__cell--right { color: var(--app-color-success); background: var(--app-color-success-soft); border-color: var(--app-color-success); }.answer-card__cell--wrong { color: var(--app-color-danger); background: var(--app-color-danger-soft); border-color: var(--app-color-danger); }.answer-card__cell--unknown { color: var(--app-color-text-muted); background: var(--app-color-background); }
</style>
