<script setup lang="ts">
import ReadonlyRichContent from '@/components/rich-content/ReadonlyRichContent.vue'
import type { ExamOption } from '@/types/exam'
withDefaults(defineProps<{ option: ExamOption; schemaVersion?: 2 | 3; label: string; selected?: boolean; disabled?: boolean; multiple?: boolean; image?: boolean; status?: 'correct' | 'wrong' | 'missed'; mark?: string; assets?: Record<string, string> }>(), { schemaVersion: 2, selected: false, disabled: false, multiple: false, image: false, mark: '', assets: () => ({}) })
const emit = defineEmits<{ select: [id: string]; retryImage: [assetId: string] }>()
</script>
<template>
  <view class="option-card" :class="[{ 'option-card--selected': selected, 'option-card--image': image, 'option-card--multiple': multiple }, status && `option-card--${status}`]" :role="multiple ? 'checkbox' : 'radio'" :aria-label="`选项 ${label}`" :aria-checked="selected" :aria-disabled="disabled" @click="!disabled && emit('select', option.id)">
    <view v-if="!image" class="option-card__key">{{ label }}</view><view class="option-card__body"><ReadonlyRichContent :doc="option.content" :schema-version="schemaVersion" :assets="assets" @retry-image="emit('retryImage', $event)" /><view v-if="image" class="option-card__footer"><view class="option-card__key">{{ label }}</view><text v-if="mark" class="option-card__mark">{{ mark }}</text></view><text v-else-if="mark" class="option-card__mark">{{ mark }}</text></view>
  </view>
</template>
<style scoped>
.option-card { display: flex; min-width: 0; gap: 12px; padding: 12px 14px; background: var(--app-color-surface); border: 1px solid var(--app-color-border); border-radius: var(--app-radius-md); }
.option-card__key { display: flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1.5px solid var(--app-color-border-strong); border-radius: 50%; color: var(--app-color-text-secondary); font-family: monospace; font-size: 13px; font-weight: 600; }
.option-card__body { min-width: 0; flex: 1; padding-top: 3px; font-size: 15px; line-height: 1.5; }
.option-card__mark { display: block; margin-top: 6px; font-size: 11px; font-weight: 600; }
.option-card--selected { border: 1.5px solid var(--app-color-primary); background: var(--app-color-primary-soft); }
.option-card--selected .option-card__key { color: var(--app-color-surface); background: var(--app-color-primary); border-color: var(--app-color-primary); }
.option-card--multiple .option-card__key { border-radius: var(--app-radius-sm); }
.option-card--correct, .option-card--missed { border-color: var(--app-color-success); background: var(--app-color-success-soft); color: var(--app-color-success); }
.option-card--correct .option-card__key, .option-card--missed .option-card__key { border-color: var(--app-color-success); background: var(--app-color-success); color: var(--app-color-surface); }
.option-card--wrong { border-color: var(--app-color-danger); background: var(--app-color-danger-soft); color: var(--app-color-danger); }
.option-card--wrong .option-card__key { border-color: var(--app-color-danger); background: var(--app-color-danger); color: var(--app-color-surface); }
.option-card--image { position: relative; display: block; padding: 8px; }
.option-card--image .option-card__key { width: 22px; height: 22px; font-size: 11px; background: var(--app-color-surface); }
.option-card__footer { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.option-card__footer .option-card__mark { flex: 1; min-width: 0; margin-top: 0; overflow-wrap: anywhere; }
.option-card--image .option-card__body { padding: 0; }
.option-card--image.option-card--selected .option-card__key { background: var(--app-color-primary); }
</style>
