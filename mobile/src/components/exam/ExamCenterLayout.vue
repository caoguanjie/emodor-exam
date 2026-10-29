<script setup lang="ts">
import AppPage from '@/components/common/AppPage.vue'
import AppTopBar from '@/components/common/AppTopBar.vue'
import type { ExamListState } from '@/types/exam'
withDefaults(defineProps<{ total: number; subtitle: string; state: ExamListState; practice?: boolean }>(), { practice: false })
const emit = defineEmits<{ filter: [state: ExamListState] }>()
const filters: { name: ExamListState; title: string }[] = [
  { name: 'all', title: '全部' }, { name: 'active', title: '进行中' },
  { name: 'published', title: '待考试' }, { name: 'ended', title: '已结束' },
]
function change({ name }: { name: string | number }) {
  const filter = filters.find(item => item.name === name)
  if (filter) emit('filter', filter.name)
}
</script>
<template>
  <AppPage class="exam-center-page" :title="practice ? '模拟考试' : '考试'" :back="practice" :tab="practice ? '' : 'exam'" :padded="false">
    <template #header>
      <AppTopBar v-if="practice" title="模拟考试" back-target="/pages/profile/index" />
      <view class="center-heading" :class="{ 'center-heading--practice': practice }">
        <view v-if="!practice" class="center-heading__row"><text class="center-heading__title">考试</text><text class="center-heading__count">{{ String(total).padStart(2, '0') }} 场</text></view>
        <text class="center-heading__subtitle">{{ subtitle }}</text>
        <text v-if="practice" class="center-heading__count">{{ String(total).padStart(2, '0') }} 场</text>
      </view>
      <wd-tabs :model-value="state" custom-class="center-tabs" slidable="always" :line-width="18" :line-height="3" color="#323233" inactive-color="#969799" @change="change">
        <wd-tab v-for="filter in filters" :key="filter.name" :name="filter.name" :title="filter.title" />
      </wd-tabs>
    </template>
    <view class="center-list"><slot /></view>
  </AppPage>
</template>
<style scoped>
.center-heading { padding:12px 20px 8px; }
.center-heading--practice { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.center-heading--practice .center-heading__subtitle { margin-top:0; }
.center-heading__row { display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
.center-heading__title { font-size:30px; font-weight:700; line-height:1.5; }
.center-heading__count { font:400 13px/1.5 'IBM Plex Mono',monospace; color:var(--app-color-text-secondary); }
.center-heading__subtitle { display:block; margin-top:4px; font-size:13px; line-height:1.5; color:var(--app-color-text-secondary); }
.exam-center-page { --wot-tabs-nav-bg:transparent; --wot-tabs-nav-item-font-size:15px; --wot-tabs-nav-item-line-height:23px; --wot-tabs-nav-item-padding:8px 11px 13px; --wot-tabs-nav-font-weight-active:700; --wot-tabs-nav-line-bottom:4px; }
.exam-center-page :deep(.center-tabs) { padding:0 9px; }
.exam-center-page :deep(.app-page__body) { padding-bottom:0; }
/* Tabs positions its indicator by summing item widths, so spacing must be padding. */
.exam-center-page :deep(.center-tabs .wd-tabs__nav-item) { flex:none; }
.center-list { padding:12px 16px calc(90px + var(--app-safe-area-bottom)); }
</style>
