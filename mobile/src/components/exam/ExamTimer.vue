<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ remainingSeconds: number }>()
const label = computed(() => { const seconds = Math.max(0, Math.floor(props.remainingSeconds)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` })
</script>
<template><view class="exam-timer" :class="{ 'exam-timer--urgent': remainingSeconds <= 180 }" role="timer"><text>{{ label }}</text></view></template>
<style scoped>.exam-timer { color: var(--app-color-text); font: 600 15px monospace; }.exam-timer--urgent { color: var(--app-color-danger); }</style>
