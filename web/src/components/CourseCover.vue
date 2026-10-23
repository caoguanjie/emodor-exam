<template>
  <el-image v-if="imageUrl" class="course-cover" :src="imageUrl" :alt="alt" fit="contain"
    :preview-src-list="[imageUrl]" preview-teleported hide-on-click-modal>
    <template #error><span class="course-cover__placeholder">加载失败</span></template>
  </el-image>
  <span v-else class="course-cover course-cover__placeholder">{{ loading ? '加载中' : failed ? '加载失败' : '暂无封面' }}</span>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { getMediaImageContent } from '../api/media';

const props = withDefaults(defineProps<{ assetId?: string | null; alt?: string }>(), { assetId: null, alt: '课程封面' });
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
.course-cover { display: inline-flex; width: 64px; height: 64px; vertical-align: middle; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-fill-color-light); }
.course-cover__placeholder { align-items: center; justify-content: center; color: var(--el-text-color-secondary); font-size: 12px; }
</style>
