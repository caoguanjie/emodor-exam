<template>
  <el-image v-if="imageUrl" class="course-cover" :src="imageUrl" :alt="alt" fit="contain"
    :preview-src-list="[imageUrl]" preview-teleported hide-on-click-modal @error="retryImage">
    <template #error><span class="course-cover__placeholder">加载失败</span></template>
  </el-image>
  <span v-else class="course-cover course-cover__placeholder">{{ loading ? '加载中' : failed ? '加载失败' : '暂无封面' }}</span>
</template>

<script setup lang="ts">
import { toRef } from 'vue';
import { usePcMediaUrl } from '../composables/usePcMediaUrl';
const props = withDefaults(defineProps<{ assetId?: string | null; alt?: string }>(), { assetId: null, alt: '课程封面' });
const { imageUrl, loading, failed, retryImage } = usePcMediaUrl(toRef(props, 'assetId'));
</script>

<style scoped>
.course-cover { display: inline-flex; width: 64px; height: 64px; vertical-align: middle; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-fill-color-light); }
.course-cover__placeholder { align-items: center; justify-content: center; color: var(--el-text-color-secondary); font-size: 12px; }
</style>
