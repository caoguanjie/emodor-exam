<script setup lang="ts">
import { useToast } from '@wot-ui/ui'
import { useAppStore } from '@/stores/app'

const app = useAppStore()
const toast = useToast()
</script>

<template>
  <view class="foundation-page">
    <view class="foundation-card">
      <text class="foundation-title">学员学习端</text>
      <text class="foundation-description">移动端基础组件预览</text>
      <text class="foundation-state">已点击 {{ app.previewCount }} 次</text>
      <wd-button
        block
        round
        @click="app.previewCount += 1; toast.success('基础组件已就绪')"
      >
        体验提示
      </wd-button>
    </view>
    <wd-toast />
  </view>
</template>

<style scoped lang="scss">
@use '@/styles/mixins.scss' as mixins;

.foundation-page {
  @include mixins.page-content;
  @include mixins.safe-bottom(32rpx);
  padding-top: 80rpx;
}

.foundation-card {
  @include mixins.surface-card;
  padding: var(--app-space-6) var(--app-space-4);
}

.foundation-title,
.foundation-description,
.foundation-state {
  display: block;
}

.foundation-title {
  font-size: 40rpx;
  font-weight: 600;
}

.foundation-description {
  margin-top: var(--app-space-2);
  color: var(--app-color-text-secondary);
}

.foundation-state {
  margin: var(--app-space-6) 0 var(--app-space-4);
  color: var(--app-color-text-muted);
}
</style>
