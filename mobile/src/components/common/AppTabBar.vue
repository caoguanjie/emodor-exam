<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { isStaticSessionPreview } from '@/platform/session'
withDefaults(defineProps<{ active?: string }>(), { active: 'home' })
const tabs = [
  { id: 'home', title: '首页', icon: 'house', url: '/pages/home/index', scenario: 'home-default' },
  { id: 'course', title: '课程', icon: 'book-open', url: '/pages/course/index', scenario: 'course-list' },
  { id: 'exam', title: '考试', icon: 'clipboard-pen-line', url: '/pages/exam/index', scenario: 'exam-center' },
  { id: 'profile', title: '我的', icon: 'user-round', url: '/pages/profile/index', scenario: 'profile-default' },
]
function navigate(tab: typeof tabs[number]) {
  const current = typeof getCurrentPages === 'function' ? getCurrentPages().at(-1) as unknown as { options?: Record<string, unknown> } : undefined
  const url = isStaticSessionPreview(current?.options) ? `${tab.url}?scenario=${tab.scenario}` : tab.url
  uni.reLaunch({ url })
}
</script>
<template>
  <view class="tab-bar" role="navigation" aria-label="主导航">
    <view class="tab-bar__capsule">
      <view v-for="tab in tabs" :key="tab.id" class="tab-bar__item" :class="{ 'tab-bar__item--active': active === tab.id }" role="button" :aria-label="tab.title" :aria-current="active === tab.id ? 'page' : undefined" @click="navigate(tab)">
        <AppIcon :name="tab.icon" :size="22" :color="active === tab.id ? '#1989fa' : '#646566'" /><text>{{ tab.title }}</text>
      </view>
    </view>
  </view>
</template>
<style scoped>
.tab-bar { position: fixed; z-index: 20; left: 0; right: 0; bottom: 0; width: 100%; padding: 0 16px calc(12px + var(--app-safe-area-bottom)); pointer-events: none; }
.tab-bar__capsule { height: 58px; display: flex; padding: 5px; border-radius: var(--app-radius-full); background: color-mix(in srgb, var(--app-color-primary-soft) 55%, transparent); backdrop-filter: blur(10px); box-shadow: inset 0 1px 1px var(--app-color-surface), 0 10px 30px #16202e1f; pointer-events: auto; }
.tab-bar__item { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 3px; border-radius: var(--app-radius-full); color: var(--app-color-text-secondary); font-size: 10px; font-weight: 500; }
.tab-bar__item--active { background: color-mix(in srgb, var(--app-color-primary) 10%, transparent); color: var(--app-color-primary); font-weight: 600; }
</style>
