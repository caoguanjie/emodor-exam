<script setup lang="ts">
import AppIcon from '@/components/common/AppIcon.vue'
import { examNumber } from '@/utils/exam-summary'
defineProps<{
  title: string; status: string; active?: boolean; waiting?: boolean; ended?: boolean;
  duration?: number | null; count?: number | null; totalScore?: number | null; passScore?: number | null;
  caption?: string; purposeLabel?: string; hint: string; action: string; disabled?: boolean; success?: boolean;
  draft?: { answered: number; total: number; remaining: string; savedAt: string };
}>()
const emit = defineEmits<{ open: [] }>()
</script>
<template>
  <view class="exam-card" :class="{ 'exam-card--active': active, 'exam-card--waiting': waiting, 'exam-card--ended': ended, 'exam-card--disabled': disabled }" :hover-class="disabled ? '' : 'exam-card--pressed'" @click="!disabled && emit('open')">
    <view class="exam-card__heading"><text class="exam-card__status">{{ status }}</text><text v-if="caption" class="exam-card__caption">{{ caption }}</text></view>
    <text class="exam-card__title">{{ title }}</text>
    <view class="exam-card__meta">
      <text v-if="purposeLabel">{{ purposeLabel }}</text>
      <view class="exam-card__metric"><AppIcon name="timer" :size="13" color="#969799" /><text>{{ examNumber(duration) }} 分钟</text></view>
      <view class="exam-card__metric"><AppIcon name="list-ordered" :size="13" color="#969799" /><text>{{ examNumber(count) }} 题</text></view>
      <view class="exam-card__metric"><AppIcon name="award" :size="13" color="#969799" /><text>满分 {{ examNumber(totalScore) }} 分</text></view>
      <text v-if="passScore !== undefined">及格 {{ examNumber(passScore) }} 分</text>
    </view>
    <view v-if="draft" class="exam-card__draft">
      <view class="exam-card__draft-label"><text>草稿 · 已答 {{ draft.answered }} / {{ draft.total }}</text><text>剩余 {{ draft.remaining }}</text></view>
      <view class="exam-card__track"><view class="exam-card__progress" :style="{ width: `${draft.total > 0 ? Math.min(100, draft.answered / draft.total * 100) : 0}%` }" /></view>
    </view>
    <view class="exam-card__footer">
      <text class="exam-card__hint" :class="{ 'exam-card__hint--success': success }">{{ draft ? `上次离开于 ${draft.savedAt}` : hint }}</text>
      <wd-button size="small" :variant="ended ? 'plain' : 'base'" :disabled="disabled" custom-class="exam-card__action" @click.stop="emit('open')"><view class="exam-card__button-content"><text>{{ action }}</text><AppIcon name="arrow-right" :size="14" :color="disabled ? '#969799' : ended ? '#323233' : '#ffffff'" /></view></wd-button>
    </view>
  </view>
</template>
<style scoped>
.exam-card { cursor:pointer; display:flex; flex-direction:column; gap:12px; background:var(--app-color-surface); border:1px solid var(--app-color-border); border-radius:18px; padding:16px; margin-bottom:12px; --wot-button-height-small:36px; --wot-button-padding-small:0 16px; --wot-button-font-size-small:13px; --wot-button-radius-main:6px; --wot-button-disabled:1; }
.exam-card--pressed { background:var(--app-color-primary-soft); }
.exam-card--active { border:1.5px solid var(--app-color-primary); }
.exam-card__heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.exam-card__status { flex:none; padding:3px 8px; border-radius:4px; color:var(--app-color-primary); background:var(--app-color-primary-soft); font-size:11px; font-weight:600; line-height:1.5; }
.exam-card--waiting .exam-card__status { background:var(--app-color-warning-soft); color:var(--app-color-warning); }
.exam-card--ended .exam-card__status { background:#f2f3f5; color:var(--app-color-text-secondary); }
.exam-card__caption { min-width:0; text-align:right; color:var(--app-color-text-muted); font:400 11px/1.5 'IBM Plex Mono',monospace; overflow-wrap:anywhere; }
.exam-card__title { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; font-size:18px; font-weight:700; line-height:1.35; overflow-wrap:anywhere; }
.exam-card__meta { display:flex; flex-wrap:wrap; align-items:center; gap:8px 14px; color:var(--app-color-text-secondary); font-size:12px; line-height:1.5; }
.exam-card__metric { display:flex; align-items:center; gap:4px; white-space:nowrap; }
.exam-card__draft { display:flex; flex-direction:column; gap:6px; }
.exam-card__draft-label { display:flex; flex-wrap:wrap; justify-content:space-between; gap:6px; color:var(--app-color-primary); font-size:12px; line-height:1.5; }
.exam-card__draft-label > text:first-child { font-weight:600; }
.exam-card__draft-label > text:last-child { font-family:'IBM Plex Mono',monospace; }
.exam-card__track { height:4px; border-radius:2px; background:var(--app-color-primary-soft); overflow:hidden; }
.exam-card__progress { height:100%; border-radius:inherit; background:var(--app-color-primary); }
.exam-card__footer { display:flex; align-items:center; justify-content:space-between; gap:12px; border-top:1px solid var(--app-color-border); padding-top:12px; }
.exam-card__hint { flex:1; min-width:0; font-size:12px; line-height:1.5; color:var(--app-color-text-muted); overflow-wrap:anywhere; }
.exam-card__hint--success { color:var(--app-color-success); }
.exam-card__button-content { display:flex; align-items:center; gap:4px; font-weight:600; }
.exam-card :deep(.exam-card__action) { flex:none; }
.exam-card--ended { --wot-button-primary-plain-border:var(--app-color-border-strong); --wot-button-primary-color:var(--app-color-text); }
.exam-card--disabled { --wot-button-primary-bg:#f2f3f5; --wot-button-main-color:var(--app-color-text-muted); }
</style>
