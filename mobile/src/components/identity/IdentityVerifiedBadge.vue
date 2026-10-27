<script setup lang="ts">
import AppIcon from '@/components/common/AppIcon.vue'
</script>

<template>
  <view class="identity-verified-badge"><AppIcon name="badge-check" :size="14" color="#07c160" style="margin-right:0" /><text>已实名</text></view>
</template>

<style scoped>
.identity-verified-badge { display: inline-flex; align-items: center; flex: none; gap: 4px; padding: 4px 8px; color: var(--app-color-success); background: var(--app-color-success-soft); border-radius: var(--app-radius-sm); font-size: 12px; line-height: 1.5; white-space: nowrap; vertical-align: middle; }
</style>
