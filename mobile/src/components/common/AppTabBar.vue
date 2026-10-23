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
const tabbarStyle = [
  '--wot-tabbar-height: 58px',
  '--wot-tabbar-bg: #e8edf573',
  '--wot-tabbar-round-margin-horizontal: 16px',
  '--wot-tabbar-round-radius: 29px',
  '--wot-tabbar-item-title-font-size: 10px',
  '--wot-tabbar-item-title-line-height: 14px',
  'bottom: calc(12px + var(--app-safe-area-bottom))',
  'box-sizing: border-box',
  'padding: 5px',
  'background: #e8edf573',
  'border-radius: 29px',
  'box-shadow: inset 0 1px 1px #fffffff2, inset 0 -1px 1px #0000000f, 0 10px 30px #16202e1f',
  'backdrop-filter: blur(10px)',
  '-webkit-backdrop-filter: blur(10px)',
  'font-family: var(--app-font-family)',
].join('; ')
function navigate(tab: typeof tabs[number]) {
  const current = typeof getCurrentPages === 'function' ? getCurrentPages().at(-1) as unknown as { options?: Record<string, unknown> } : undefined
  const url = isStaticSessionPreview(current?.options) ? `${tab.url}?scenario=${tab.scenario}` : tab.url
  uni.reLaunch({ url })
}
function handleChange({ value }: { value: string | number }) {
  const tab = tabs.find(item => item.id === value)
  if (tab) navigate(tab)
}
</script>
<template>
  <wd-tabbar
    :model-value="active"
    shape="round"
    fixed
    safe-area-inset-bottom
    :bordered="false"
    :z-index="20"
    active-color="#1989fa"
    inactive-color="#646566"
    custom-class="tab-bar"
    :custom-style="tabbarStyle"
    role="navigation"
    aria-label="主导航"
    @change="handleChange"
  >
    <wd-tabbar-item
      v-for="tab in tabs"
      :key="tab.id"
      :name="tab.id"
      :title="tab.title"
      :custom-class="active === tab.id ? 'tab-bar__item tab-bar__item--active' : 'tab-bar__item'"
      role="button"
      :aria-label="tab.title"
      :aria-current="active === tab.id ? 'page' : undefined"
    >
      <template #icon="{ active: itemActive }">
        <AppIcon :name="tab.icon" :size="22" :color="itemActive ? '#1989fa' : '#646566'" />
      </template>
    </wd-tabbar-item>
  </wd-tabbar>
</template>
<style scoped>
:deep(.tab-bar__item) { min-width: 0; border-radius: 24px; }
:deep(.tab-bar__item--active) { background: #1989fa1a; }
:deep(.tab-bar__item .wd-tabbar-item__body) { gap: 3px; }
:deep(.tab-bar__item .wd-tabbar-item__body-title) { font-family: var(--app-font-family); font-weight: 500; }
:deep(.tab-bar__item--active .wd-tabbar-item__body-title) { font-weight: 600; }
</style>
