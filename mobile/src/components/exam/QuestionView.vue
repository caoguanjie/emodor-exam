<script setup lang="ts">
import ReadonlyRichContent from '@/components/rich-content/ReadonlyRichContent.vue'
import OptionCard from './OptionCard.vue'
import { areOptionIdsCorrect, questionTypeLabels, type ExamReviewItem, type ExamTakeItem } from '@/types/exam'
const props = withDefaults(defineProps<{ item: ExamTakeItem; number: number; total?: number; selected?: string[]; disabled?: boolean; review?: ExamReviewItem; assets?: Record<string, string> }>(), { total: 20, selected: () => [], disabled: false, assets: () => ({}) })
const emit = defineEmits<{ select: [id: string]; retryImage: [assetId: string] }>()
function label(index: number) { return props.item.type === 'judgment' ? index === 0 ? '✓' : '✕' : String.fromCharCode(65 + index) }
function status(id: string): 'correct' | 'wrong' | 'missed' | undefined {
  if (!props.review) return undefined
  const chosen = props.review.selectedOptionIds.includes(id)
  const right = props.review.correctOptionIds.includes(id)
  return right ? chosen ? 'correct' : 'missed' : chosen ? 'wrong' : undefined
}
function mark(id: string) { const state = status(id); return state === 'wrong' ? '✕ 你的选择 · 选错' : state === 'correct' ? '✓ 你的选择 · 正确' : state === 'missed' ? '正确答案' : '' }
</script>
<template>
  <view class="question-view">
    <view class="question-view__heading"><view class="question-view__identity"><text class="question-view__number">{{ String(number).padStart(2, '0') }}</text><text class="question-view__total">/{{ total }}</text><text class="question-view__tag">{{ questionTypeLabels[item.type] }}</text></view><text class="question-view__score">{{ item.score }} 分</text></view>
    <view v-if="review" class="question-view__verdict" :class="areOptionIdsCorrect(review.selectedOptionIds, review.correctOptionIds) ? 'question-view__verdict--right' : ''"><text>{{ areOptionIdsCorrect(review.selectedOptionIds, review.correctOptionIds) ? '回答正确' : review.selectedOptionIds.length ? '回答错误' : '未作答' }}</text><text>得 {{ review.earnedScore }} / {{ item.score }}</text></view>
    <view class="question-view__stem"><ReadonlyRichContent :doc="item.stem" :assets="assets" @retry-image="emit('retryImage', $event)" /></view>
    <text v-if="item.type === 'multiple'" class="question-view__hint">多选题 · 请选择所有符合的选项</text>
    <text v-else-if="item.imageOptions" class="question-view__hint">单选题 · 请选择 1 张图片</text>
    <view class="question-view__options" :class="{ 'question-view__options--images': item.imageOptions }">
      <OptionCard v-for="(option, index) in item.options" :key="option.id" :option="option" :label="label(index)" :selected="(review?.selectedOptionIds || selected).includes(option.id)" :disabled="disabled || !!review" :multiple="item.type === 'multiple'" :image="item.imageOptions" :status="status(option.id)" :mark="mark(option.id)" :assets="assets" @select="emit('select', $event)" @retry-image="emit('retryImage', $event)" />
    </view>
  </view>
</template>
<style scoped>
.question-view { min-width: 0; display: flex; flex-direction: column; gap: 18px; }
.question-view__heading, .question-view__identity { display: flex; align-items: center; }
.question-view__heading { justify-content: space-between; }
.question-view__number { font: 600 28px monospace; color: var(--app-color-primary); }
.question-view__total { align-self: end; margin: 0 10px 3px 2px; font: 12px monospace; color: var(--app-color-text-muted); }
.question-view__tag { padding: 3px 8px; background: var(--app-color-primary); color: var(--app-color-surface); border-radius: 4px; font-size: 11px; }
.question-view__score, .question-view__hint { color: var(--app-color-text-muted); font-size: 12px; }
.question-view__stem { font-size: 17px; font-weight: 500; line-height: 1.65; }
.question-view__options { display: flex; flex-direction: column; gap: 8px; }
.question-view__options--images { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.question-view__verdict { display: flex; justify-content: space-between; color: var(--app-color-danger); font-size: 12px; }
.question-view__verdict--right { color: var(--app-color-success); }
</style>
