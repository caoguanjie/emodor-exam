<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useExamStore } from '@/stores/exam'
const store = useExamStore(), filter = ref('全部')
const labels: Record<string, string> = { published: '进行中', withdrawn: '已结束', draft: '待考试' }
const rows = computed(() => store.list.items.filter(row => filter.value === '全部' || labels[row.status] === filter.value))
async function load() { try { await store.loadList() } catch { /* Store owns the error. */ } }
async function more() { try { await store.loadList(store.list.page + 1) } catch { /* Retry keeps prior rows. */ } }
onMounted(load)
function open(paper: string) { uni.navigateTo({ url: `/pages/exam/instructions?paper_id=${encodeURIComponent(paper)}` }) }
</script>
<template>
  <AppPage tab="exam"><view class="center-heading"><view><text class="center-heading__title">考试</text><text class="center-heading__sub">选择考试后阅读须知并开始答题</text></view><text>{{ store.list.total }} 场</text></view>
    <view class="center-tabs"><text v-for="tab in ['全部', '进行中', '待考试', '已结束']" :key="tab" :class="{ active: filter === tab }" role="button" @click="filter = tab">{{ tab }}</text></view>
    <text v-if="store.listLoading && !store.list.items.length">考试加载中…</text>
    <EmptyState v-else-if="store.listError && !store.list.items.length" title="考试加载失败" :description="store.listError"><wd-button @click="load">重新加载</wd-button></EmptyState>
    <EmptyState v-else-if="!rows.length" title="暂无考试" description="考试发布后将显示在这里。" />
    <view v-for="exam in rows" :key="exam.paper_id" class="exam-card"><text class="exam-card__status">{{ labels[exam.status] || exam.status }}</text><text class="exam-card__title">{{ exam.title }}</text><view class="exam-card__bottom"><text>进入后核验本次考试资格</text><wd-button size="small" @click="open(exam.paper_id)">查看须知 ›</wd-button></view></view>
    <view v-if="store.list.items.length && store.listError" class="list-error">{{ store.listError }}</view><wd-button v-if="store.list.items.length < store.list.total" block variant="soft" :loading="store.listLoading" @click="more">{{ store.listError ? '重试加载' : '加载更多' }}</wd-button>
  </AppPage>
</template>
<style scoped>
.center-heading { display:flex; align-items:center; justify-content:space-between; padding:12px 2px; font-size:12px; color:var(--app-color-text-muted); }.center-heading__title { display:block; font-size:28px; font-weight:700; color:var(--app-color-text); }.center-heading__sub { display:block; margin-top:6px; font-size:12px; }.center-tabs { display:flex; gap:22px; padding:8px 0 18px; color:var(--app-color-text-muted); font-size:14px; }.center-tabs .active { color:var(--app-color-primary); font-weight:600; }.exam-card { border:1px solid var(--app-color-border); background:var(--app-color-surface); border-radius:var(--app-radius-md); padding:16px; margin-bottom:12px; }.exam-card__status { font-size:11px; color:var(--app-color-primary); }.exam-card__title { display:block; margin:12px 0; font-size:16px; font-weight:600; }.exam-card__bottom { display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:11px; color:var(--app-color-text-muted); }.list-error { color:var(--app-color-danger); padding:12px 0; font-size:12px; }
</style>
