<script setup lang="ts">
import { computed, useSlots } from 'vue'
import AppIcon from './AppIcon.vue'
const props = withDefaults(defineProps<{ title?: string; back?: boolean; action?: string; light?: boolean; backTarget?: string; historyFirst?: boolean }>(), { title: '', back: true, action: '', light: false, backTarget: '', historyFirst: true })
const emit = defineEmits<{ action: []; back: [] }>()
const slots = useSlots()
let native = false
// #ifdef MP-WEIXIN
native = true
// #endif
const nativeActions = computed(() => native && !!(props.action || slots.right))
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
    <view class="top-bar__main">
      <view class="top-bar__side"><view v-if="back" class="top-bar__back" role="button" aria-label="返回" @click="goBack"><AppIcon name="chevron-left" :size="24" :color="props.light ? '#ffffff' : '#323233'" /></view><slot name="left" /></view>
      <text class="top-bar__title">{{ title }}</text>
      <view v-if="!nativeActions" class="top-bar__side top-bar__right"><text v-if="action" role="button" @click="emit('action')">{{ action }}</text><slot name="right" /></view>
    </view>
    <view v-if="nativeActions" class="top-bar__actions"><text v-if="action" role="button" @click="emit('action')">{{ action }}</text><slot name="right" /></view>
  </view>
</template>
<style scoped>
.top-bar { position: relative; flex: none; display: flex; flex-direction: column; background: var(--app-color-surface); color: var(--app-color-text); }
.top-bar::before { content: ''; position: absolute; left: 0; right: 0; top: calc(0px - var(--app-safe-area-top, 0px)); height: var(--app-safe-area-top, 0px); background: var(--app-color-surface); pointer-events: none; }
.top-bar__main { position: relative; height: var(--app-native-nav-height, 44px); display: flex; align-items: center; justify-content: space-between; padding: 0 12px; }
.top-bar--light { color: var(--app-color-surface); background: transparent; }
.top-bar--light::before { display: none; }
.top-bar__side { width: 72px; flex: none; font-size: 14px; }
.top-bar__back { width: 32px; height: 40px; display: flex; align-items: center; }
.top-bar__right { text-align: right; }
.top-bar__title { position: absolute; left: 50%; transform: translateX(-50%); max-width: calc(100% - var(--app-native-title-inset, 84px) - var(--app-native-title-inset, 84px)); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; font-size: 17px; font-weight: 600; }
.top-bar__actions { min-height: 28px; padding: 0 12px 8px; display: flex; align-items: center; justify-content: flex-end; font-size: 14px; }
</style>
