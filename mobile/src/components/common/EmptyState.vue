<script setup lang="ts">
import AppIcon from './AppIcon.vue'
withDefaults(defineProps<{ title?: string; description?: string; icon?: string; image?: string }>(), { title: '暂无内容', description: '', icon: 'book-open', image: '' })
</script>
<template><view class="empty-state"><image v-if="image" class="empty-state__image" :src="image" mode="aspectFit" /><AppIcon v-else :name="icon" :size="48" color="#969799" /><text class="empty-state__title">{{ title }}</text><text v-if="description" class="empty-state__description">{{ description }}</text><slot /></view></template>
<style scoped>
.empty-state { min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 28px 20px; text-align: center; }
.empty-state__image { width: 200px; max-width: 100%; height: 118px; }
.empty-state__title { font-size: 16px; font-weight: 600; }
.empty-state__description { font-size: 13px; color: var(--app-color-text-muted); }
</style>
