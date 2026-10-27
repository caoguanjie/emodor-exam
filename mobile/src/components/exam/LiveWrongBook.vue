<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import QuestionView from './QuestionView.vue'
import WrongBookSegmented from './WrongBookSegmented.vue'
import ReadonlyRichContent from '@/components/rich-content/ReadonlyRichContent.vue'
import { useExamStore } from '@/stores/exam'
import { reviewItem, type QuestionType } from '@/types/exam'
const store = useExamStore(), filter = ref('全部')
const filters: { label: string; type?: QuestionType }[] = [{ label: '全部' }, { label: '单选', type: 'single' }, { label: '多选', type: 'multiple' }, { label: '判断', type: 'judgment' }]
const rows = computed(() => store.wrong.items.filter(row => !filters.find(tab => tab.label === filter.value)?.type || row.type === filters.find(tab => tab.label === filter.value)?.type).map(row => ({ ...reviewItem(row), recordId: row.record_id, submittedAt: row.submitted_at })))
async function load(page = 1) { try { await store.loadWrong(page) } catch { /* Loaded rows remain visible. */ } }
onMounted(() => load())
function exams() { uni.reLaunch({ url: '/pages/exam/index' }) }
</script>
<template>
  <AppPage title="我的错题本" back-target="/pages/profile/index" :history-first="false"><WrongBookSegmented v-model="filter" /><text v-if="store.wrongLoading && !store.wrong.items.length">错题加载中…</text><EmptyState v-else-if="store.wrongError && !store.wrong.items.length" title="加载失败" :description="store.wrongError"><wd-button @click="load()">重新加载</wd-button></EmptyState><EmptyState v-else-if="!rows.length" image="/static/states/empty-data.png" title="暂无错题" description="成功交卷后答错的题会出现在这里。"><wd-button @click="exams">去考试</wd-button></EmptyState><view v-for="(row, index) in rows" :key="`${row.recordId}:${row.item.id}`" class="wrong-card"><text class="wrong-card__date">交卷 {{ new Date(row.submittedAt).toLocaleString() }}</text><QuestionView :item="row.item" :number="index + 1" :total="rows.length" :review="row" :assets="store.assets[row.item.id] || {}" @retry-image="store.loadItemMedia(row.item.id, row.recordId)" /><view class="wrong-analysis"><text>解析</text><ReadonlyRichContent :doc="row.analysis" :schema-version="row.item.content_schema_version ?? 2" :assets="store.assets[row.item.id] || {}" @retry-image="store.loadItemMedia(row.item.id, row.recordId)" /><text v-if="store.mediaErrors[row.item.id]" role="button" @click="store.loadItemMedia(row.item.id, row.recordId)">图片加载失败，点击重试</text></view></view><text v-if="store.wrongError && store.wrong.items.length">{{ store.wrongError }}</text><wd-button v-if="store.wrong.items.length < store.wrong.total" block variant="soft" :loading="store.wrongLoading" @click="load(store.wrong.page + 1)">加载更多</wd-button></AppPage>
</template>
<style scoped>
.wrong-card { background:var(--app-color-surface); border:1px solid var(--app-color-border); border-radius:var(--app-radius-md); padding:16px; margin-bottom:16px; }.wrong-card__date { display:block; margin-bottom:16px; font-size:11px; color:var(--app-color-text-muted); }.wrong-analysis { margin-top:16px; padding-top:14px; border-top:1px solid var(--app-color-border); font-size:13px; }.wrong-analysis > text:first-child { display:block; margin-bottom:8px; font-weight:600; }
</style>
