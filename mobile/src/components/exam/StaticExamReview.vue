<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppPage from '@/components/common/AppPage.vue'
import AppTopBar from '@/components/common/AppTopBar.vue'
import QuestionView from '@/components/exam/QuestionView.vue'
import AnswerCard from '@/components/exam/AnswerCard.vue'
import ReadonlyRichContent from '@/components/rich-content/ReadonlyRichContent.vue'
import { examAssets, examReviewItems, examTakeItems, useExamScenario } from '@/fixtures/ui-scenarios/exam'
const { scenario, loadScenario } = useExamScenario('exam-review-single')
const props = defineProps<{ query: Record<string, unknown> }>()
loadScenario(props.query)
const currentIndex = ref(0)
const cardVisible = ref(false)
watch(scenario, value => { currentIndex.value = value.questionIndex || 0; cardVisible.value = value.overlay === 'card' }, { immediate: true })
const review = computed(() => examReviewItems[currentIndex.value])
const reviewAnswers = Object.fromEntries(examReviewItems.map(row => [row.item.id, row.selectedOptionIds]))
function displayIds(ids: string[]) { if (!ids.length) return '未作答'; return ids.map(id => { const index = review.value.item.options.findIndex(option => option.id === id); return review.value.item.type === 'judgment' ? index === 0 ? '正确' : '错误' : String.fromCharCode(65 + index) }).join(' ') }
function move(offset: number) { currentIndex.value = Math.max(0, Math.min(19, currentIndex.value + offset)) }
function jump(id: string) { currentIndex.value = examTakeItems.findIndex(item => item.id === id) }
</script>
<template>
  <AppPage :padded="false"><template #header><AppTopBar title="答案解析" back-target="/pages/exam/index"><template #right><text class="review-count">{{ String(currentIndex + 1).padStart(2, '0') }} / 20</text></template></AppTopBar></template><view class="review-body"><QuestionView :item="review.item" :number="currentIndex + 1" :review="review" :assets="examAssets" /><view class="review-analysis"><view class="review-analysis__answers"><view><text>正确答案</text><text class="review-analysis__right">{{ displayIds(review.correctOptionIds) }}</text></view><view><text>你的答案</text><text :class="review.earnedScore ? 'review-analysis__right' : 'review-analysis__wrong'">{{ displayIds(review.selectedOptionIds) }}</text></view></view><text class="review-analysis__title">解析</text><ReadonlyRichContent :doc="review.analysis" :assets="examAssets" /><text class="review-analysis__source">{{ review.source }}</text></view></view><template #footer><view class="review-footer"><wd-button type="info" variant="plain" round :disabled="currentIndex === 0" @click="move(-1)">‹ 上一题</wd-button><view role="button" aria-label="打开解析卡" class="review-footer__card" @click="cardVisible = true">▦ 解析卡</view><wd-button round :disabled="currentIndex === 19" @click="move(1)">下一题 ›</wd-button></view></template><AnswerCard v-model="cardVisible" :items="examTakeItems" :answers="reviewAnswers" :current-id="review.item.id" :reviews="examReviewItems" @select="jump" /></AppPage>
</template>
<style scoped>
.review-count { color: var(--app-color-text-muted); font: 12px monospace; white-space: nowrap; }.review-body { padding: 24px 16px 110px; }.review-analysis { margin-top: 20px; padding: 18px 16px; background: var(--app-color-surface); border-radius: var(--app-radius-md); font-size: 13px; line-height: 1.7; }.review-analysis__answers { display: flex; gap: 32px; padding-bottom: 16px; border-bottom: 1px solid var(--app-color-border); }.review-analysis__answers > view { display: flex; flex-direction: column; gap: 5px; color: var(--app-color-text-muted); font-size: 11px; }.review-analysis__answers > view > text:last-child { font-size: 17px; font-weight: 600; }.review-analysis__right { color: var(--app-color-success); }.review-analysis__wrong { color: var(--app-color-danger); }.review-analysis__title { display: block; margin: 16px 0 10px; font-weight: 600; }.review-analysis__source { display: block; margin-top: 16px; color: var(--app-color-text-muted); font-size: 10px; }.review-footer { position: fixed; z-index: 3; bottom: 0; left: 0; right: 0; display: flex; align-items: center; gap: 10px; padding: 10px 16px calc(12px + var(--app-safe-area-bottom)); background: var(--app-color-surface); border-top: 1px solid var(--app-color-border); }.review-footer :deep(.wd-button) { width: 96px; padding: 0 10px; font-size: 14px; --wot-button-height-medium: 44px; }.review-footer__card { display: flex; align-items: center; justify-content: center; flex: 1; min-width: 0; height: 44px; border-radius: 22px; background: var(--app-color-background); font-size: 14px; font-weight: 600; }
</style>
