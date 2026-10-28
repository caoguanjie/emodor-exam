<script setup lang="ts">
import AppIcon from '@/components/common/AppIcon.vue'
import AppTopBar from '@/components/common/AppTopBar.vue'
import ExamTimer from './ExamTimer.vue'

defineProps<{
  remainingSeconds: number
  answered: number
  total: number
  savedLabel: string
  answeredLabel?: string
  draftError?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ exit: []; submit: [] }>()
</script>

<template>
  <view class="take-header">
    <AppTopBar title="在线考试" :back="false">
      <template #left>
        <view class="take-header__exit" role="button" aria-label="退出答题" @click="emit('exit')">
          <AppIcon name="chevron-left" :size="24" />
        </view>
      </template>
    </AppTopBar>
    <view class="take-header__content">
      <view class="take-header__bar">
        <view class="take-header__remaining"><text>剩余</text><ExamTimer :remaining-seconds="remainingSeconds" /></view>
        <view class="take-header__submit"><wd-button size="small" round role="button" aria-label="交卷" :disabled="disabled" :aria-disabled="disabled" @click="emit('submit')">交卷</wd-button></view>
      </view>
      <view class="take-progress"><view class="take-progress__value" :style="{ width: `${total ? answered / total * 100 : 0}%` }" /></view>
      <view class="take-header__meta"><text>已答 {{ answeredLabel ?? answered }} / {{ total }}</text><text :class="{ 'take-header__error': draftError }">{{ savedLabel }}</text></view>
    </view>
  </view>
</template>

<style scoped>
.take-header { flex: none; background: var(--app-color-surface); }
.take-header__exit { width: 32px; height: 40px; display: flex; align-items: center; }
.take-header__content { padding: 0 16px 12px; }
.take-header__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 48px; }
.take-header__remaining { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--app-color-text-secondary); font-size: 14px; }
.take-header__submit { flex: none; }
.take-header__submit :deep(.wd-button) { min-width: 76px; font-size: 14px; }
.take-progress { height: 4px; margin-top: 2px; overflow: hidden; border-radius: 2px; background: var(--app-color-background); }
.take-progress__value { height: 100%; border-radius: 2px; background: var(--app-color-primary); }
.take-header__meta { display: flex; justify-content: space-between; gap: 8px; padding-top: 8px; color: var(--app-color-text-muted); font-size: 11px; }
.take-header__error { color: var(--app-color-danger); }
</style>
