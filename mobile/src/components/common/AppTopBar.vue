<script setup lang="ts">
import AppIcon from './AppIcon.vue'
const props = withDefaults(defineProps<{ title?: string; back?: boolean; action?: string; light?: boolean; backTarget?: string; historyFirst?: boolean }>(), { title: '', back: true, action: '', light: false, backTarget: '', historyFirst: true })
const emit = defineEmits<{ action: []; back: [] }>()
function goBack() {
  emit('back')
  if (props.historyFirst && getCurrentPages().length > 1) uni.navigateBack()
  else if (props.backTarget) uni.reLaunch({ url: props.backTarget })
  else if (getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/home/index' })
}
</script>
<template>
  <view class="top-bar" :class="{ 'top-bar--light': light }">
    <view class="top-bar__side"><view v-if="back" class="top-bar__back" role="button" aria-label="返回" @click="goBack"><AppIcon name="chevron-left" :size="24" :color="props.light ? '#ffffff' : '#323233'" /></view><slot name="left" /></view>
    <text class="top-bar__title">{{ title }}</text>
    <view class="top-bar__side top-bar__right"><text v-if="action" role="button" @click="emit('action')">{{ action }}</text><slot name="right" /></view>
  </view>
</template>
<style scoped>
.top-bar { height: 44px; flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; background: var(--app-color-surface); color: var(--app-color-text); }
.top-bar--light { color: var(--app-color-surface); background: transparent; }
.top-bar__side { width: 72px; flex: none; font-size: 14px; }
.top-bar__back { width: 32px; height: 40px; display: flex; align-items: center; }
.top-bar__right { text-align: right; }
.top-bar__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; font-weight: 600; }
</style>
