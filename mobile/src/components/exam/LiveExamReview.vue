<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppPage from '@/components/common/AppPage.vue'
import AppTopBar from '@/components/common/AppTopBar.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import ReadonlyRichContent from '@/components/rich-content/ReadonlyRichContent.vue'
import QuestionView from './QuestionView.vue'
import AnswerCard from './AnswerCard.vue'
import { areOptionIdsCorrect, reviewItem } from '@/types/exam'
import { useExamStore } from '@/stores/exam'
const props = defineProps<{ recordId: string }>(), store = useExamStore(), index = ref(0), card = ref(false)
const reviews = computed(() => store.result?.items.map(reviewItem) || []), review = computed(() => reviews.value[index.value])
const answers = computed(() => Object.fromEntries(reviews.value.map(row => [row.item.id, row.selectedOptionIds])))
const items = computed(() => reviews.value.map(row => row.item))
async function load() { if (!props.recordId) return; try { await store.loadResult(props.recordId) } catch { /* Visible retry. */ } }
onMounted(load)
watch(() => review.value?.item.id, id => { if (id) void store.loadItemMedia(id) })
function labels(ids: string[]) { return ids.length ? ids.map(id => { const at = review.value.item.options.findIndex(option => option.id === id); return review.value.item.type === 'judgment' ? at === 0 ? '正确' : '错误' : String.fromCharCode(65 + at) }).join(' ') : '未作答' }
</script>
<template>
  <AppPage :padded="false"><template #header><AppTopBar title="答案解析" :back-target="`/pages/exam/result?record_id=${encodeURIComponent(recordId)}`"><template #right><text class="review-count">{{ review ? index + 1 : 0 }} / {{ reviews.length }}</text></template></AppTopBar></template>
    <view v-if="store.phase === 'loading'" class="review-body">解析加载中…</view><EmptyState v-else-if="store.loadError" title="解析加载失败" :description="store.loadError"><wd-button @click="load">重新加载</wd-button></EmptyState><EmptyState v-else-if="!review" image="/static/states/empty-data.png" title="本次考试无答案解析" description="仅成功主动交卷并完成评分后可以查看逐题解析。" />
    <view v-else class="review-body"><QuestionView :item="review.item" :number="index + 1" :total="reviews.length" :review="review" :assets="store.assets[review.item.id] || {}" @retry-image="store.loadItemMedia(review.item.id)" /><view class="review-analysis"><view class="review-analysis__answers"><view><text>正确答案</text><text class="right">{{ labels(review.correctOptionIds) }}</text></view><view><text>你的答案</text><text :class="areOptionIdsCorrect(review.selectedOptionIds, review.correctOptionIds) ? 'right' : 'wrong'">{{ labels(review.selectedOptionIds) }}</text></view></view><text class="review-analysis__title">解析</text><ReadonlyRichContent :doc="review.analysis" :schema-version="review.item.content_schema_version ?? 2" :assets="store.assets[review.item.id] || {}" @retry-image="store.loadItemMedia(review.item.id)" /><text v-if="store.mediaErrors[review.item.id]" role="button" class="wrong" @click="store.loadItemMedia(review.item.id)">图片加载失败，点击重试</text></view></view>
    <template #footer><view v-if="review" class="review-footer"><wd-button type="info" variant="plain" round :disabled="index === 0" @click="index--">‹ 上一题</wd-button><view role="button" aria-label="打开解析卡" class="review-footer__card" @click="card = true">▦ 解析卡</view><wd-button round :disabled="index === reviews.length - 1" @click="index++">下一题 ›</wd-button></view></template><AnswerCard v-if="review" v-model="card" :items="items" :answers="answers" :current-id="review.item.id" :reviews="reviews" @select="index = items.findIndex(item => item.id === $event)" />
  </AppPage>
</template>
<style scoped>
.review-count { color:var(--app-color-text-muted); font:12px monospace; }.review-body { padding:24px 16px 110px; }.review-analysis { margin-top:20px; padding:18px 16px; background:var(--app-color-surface); border-radius:var(--app-radius-md); font-size:13px; line-height:1.7; }.review-analysis__answers { display:flex; gap:32px; padding-bottom:16px; border-bottom:1px solid var(--app-color-border); }.review-analysis__answers > view { display:flex; flex-direction:column; gap:5px; color:var(--app-color-text-muted); font-size:11px; }.review-analysis__answers > view > text:last-child { font-size:17px; font-weight:600; }.right { color:var(--app-color-success); }.wrong { color:var(--app-color-danger); }.review-analysis__title { display:block; margin:16px 0 10px; font-weight:600; }.review-footer { position:fixed; z-index:3; bottom:0; left:0; right:0; display:flex; align-items:center; gap:10px; padding:10px 16px calc(12px + var(--app-safe-area-bottom)); background:var(--app-color-surface); border-top:1px solid var(--app-color-border); }.review-footer :deep(.wd-button) { width:96px; padding:0 10px; font-size:14px; --wot-button-height-medium:44px; }.review-footer__card { display:flex; align-items:center; justify-content:center; flex:1; min-width:0; height:44px; border-radius:22px; background:var(--app-color-background); font-size:14px; font-weight:600; }
</style>
