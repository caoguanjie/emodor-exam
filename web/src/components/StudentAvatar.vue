<template>
  <el-image v-if="imageUrl" class="student-avatar" :src="imageUrl" alt="学员头像" fit="cover"
    :preview-src-list="[imageUrl]" preview-teleported hide-on-click-modal />
  <span v-else class="student-avatar student-avatar--empty">{{ loading ? '加载中' : failed ? '加载失败' : '暂无头像' }}</span>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { getMediaImageContent } from '../api/media';

const props = defineProps<{ assetId?: string | null }>();
const imageUrl = ref('');
const loading = ref(false);
const failed = ref(false);
watch(() => props.assetId, async (assetId, _previous, onCleanup) => {
  let active = true;
  let objectUrl = '';
  onCleanup(() => {
    active = false;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });
  imageUrl.value = '';
  failed.value = false;
  loading.value = Boolean(assetId);
  if (!assetId) return;
  try {
    const blob = await getMediaImageContent(assetId);
    if (!active) return;
    objectUrl = URL.createObjectURL(blob);
    imageUrl.value = objectUrl;
  } catch {
    if (active) failed.value = true;
  } finally {
    if (active) loading.value = false;
  }
}, { immediate: true });
</script>

<style scoped>
.student-avatar { display: inline-flex; width: 48px; height: 48px; vertical-align: middle; border-radius: 4px; }
.student-avatar--empty { align-items: center; justify-content: center; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 11px; }
</style>
