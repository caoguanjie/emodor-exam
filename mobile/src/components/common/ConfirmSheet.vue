<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{ modelValue: boolean; title: string; message?: string; confirmText?: string; cancelText?: string }>(), { message: '', confirmText: '确认', cancelText: '取消' })
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; confirm: []; cancel: [] }>()
const visible = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) })
function cancel() { visible.value = false; emit('cancel') }
function confirm() { visible.value = false; emit('confirm') }
</script>
<template>
  <wd-popup v-model="visible" position="bottom" round safe-area-inset-bottom :z-index="30" @close="emit('cancel')">
    <view class="confirm-sheet"><text class="confirm-sheet__title">{{ title }}</text><text v-if="message" class="confirm-sheet__message">{{ message }}</text><slot /><view class="confirm-sheet__actions"><wd-button v-if="cancelText" block variant="soft" @click="cancel">{{ cancelText }}</wd-button><wd-button block @click="confirm">{{ confirmText }}</wd-button></view></view>
  </wd-popup>
</template>
<style scoped>
.confirm-sheet { padding: 24px 20px; display: flex; flex-direction: column; gap: 20px; }
.confirm-sheet__title { font-size: 19px; font-weight: 600; }
.confirm-sheet__message { font-size: 14px; line-height: 1.6; color: var(--app-color-text-secondary); }
.confirm-sheet__actions { display: flex; gap: 12px; }
.confirm-sheet__actions :deep(.wd-button) { flex: 1; --wot-button-height-medium: 48px; --wot-button-radius-main: var(--app-radius-md); }
</style>
