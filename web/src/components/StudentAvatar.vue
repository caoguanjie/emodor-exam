<template>
  <el-image v-if="imageUrl" class="student-avatar" :src="imageUrl" alt="学员头像" fit="cover"
    :preview-src-list="[imageUrl]" preview-teleported hide-on-click-modal @error="retryImage" />
  <span v-else class="student-avatar student-avatar--empty">{{ loading ? '加载中' : failed ? '加载失败' : '暂无头像' }}</span>
</template>

<script setup lang="ts">
import { toRef } from 'vue';
import { usePcMediaUrl } from '../composables/usePcMediaUrl';
const props = defineProps<{ assetId?: string | null }>();
const { imageUrl, loading, failed, retryImage } = usePcMediaUrl(toRef(props, 'assetId'));
</script>

<style scoped>
.student-avatar { display: inline-flex; width: 48px; height: 48px; vertical-align: middle; border-radius: 4px; }
.student-avatar--empty { align-items: center; justify-content: center; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 11px; }
</style>
