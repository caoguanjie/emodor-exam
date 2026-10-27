<script setup lang="ts">
import AppTopBar from './AppTopBar.vue'
import AppTabBar from './AppTabBar.vue'
import { nativeNavigationStyle } from '@/platform/native-layout'
const nativeStyle = nativeNavigationStyle()
withDefaults(defineProps<{ title?: string; back?: boolean; tab?: string; active?: string; padded?: boolean; backTarget?: string; historyFirst?: boolean }>(), { title: '', back: true, tab: '', active: '', padded: true, backTarget: '', historyFirst: true })
</script>
<template>
  <view class="app-page" :class="{ 'app-page--tab': tab || active }" :style="nativeStyle">
    <slot name="header"><AppTopBar v-if="title" :title="title" :back="back" :back-target="backTarget" :history-first="historyFirst" /></slot>
    <view class="app-page__body" :class="{ 'app-page__body--padded': padded }"><slot /></view>
    <slot name="footer" />
    <AppTabBar v-if="tab || active" :active="tab || active" />
  </view>
</template>
<style scoped>
.app-page { min-height: 100vh; display: flex; flex-direction: column; background: var(--app-color-background); padding-top: var(--app-safe-area-top); }
.app-page__body { flex: 1; min-width: 0; }
.app-page__body--padded { padding: 16px; }
.app-page--tab .app-page__body { padding-bottom: calc(92px + var(--app-safe-area-bottom)); }
</style>
