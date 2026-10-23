<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { renderableNodes } from '@/types/content'
import { validateRichDocV3, renderableRichNodes } from '@/types/content-v3'
import RichNode from './RichNode.vue'
const props = withDefaults(defineProps<{ doc: unknown; schemaVersion?: 2 | 3; assets?: Record<string, string> }>(), { schemaVersion: 2, assets: () => ({}) })
const emit = defineEmits<{ retryImage: [assetId: string] }>()
const failedUrls = ref<Record<string, string>>({})
function failed(assetId: string) { return !!props.assets[assetId] && failedUrls.value[assetId] === props.assets[assetId] }
function fail(assetId: string) { if (props.assets[assetId]) failedUrls.value[assetId] = props.assets[assetId] }
const richNodes = computed(() => {
  if (props.schemaVersion !== 3) return null
  try { return renderableRichNodes(validateRichDocV3(props.doc)) } catch { return null }
})
const nodes = computed(() => props.schemaVersion === 2 ? renderableNodes(props.doc) : richNodes.value ? [] : [{ type: 'unsupported' as const }])
watch(nodes, value => { if (value.some(node => node.type === 'unsupported')) console.warn('readonly-content: unsupported-node') }, { immediate: true })
</script>
<template>
  <view class="readonly-content">
    <RichNode v-for="(node, index) in richNodes || []" :key="`rich-${index}`" :node="node" :assets="assets" @retry-image="emit('retryImage', $event)" />
    <template v-for="(node, index) in nodes" :key="index">
      <text v-if="node.type === 'unsupported'" class="readonly-content__placeholder">内容暂不支持显示</text>
      <view v-else-if="node.type === 'paragraph'" class="readonly-content__paragraph">
        <template v-for="(child, childIndex) in node.children" :key="childIndex">
          <text v-if="child.type === 'text'" user-select>{{ child.text }}</text>
          <text v-else-if="child.type === 'hardBreak'">{{ '\n' }}</text>
          <text v-else-if="failed(child.assetId)" class="readonly-content__placeholder" role="button" aria-disabled="false" aria-label="图片加载失败，点击重试" @click.stop="emit('retryImage', child.assetId)">图片加载失败，点击重试</text>
          <image v-else-if="assets[child.assetId]" class="readonly-content__image" :src="assets[child.assetId]" mode="aspectFit" @error="fail(child.assetId)" />
          <text v-else class="readonly-content__placeholder">图片暂不可用</text>
        </template>
      </view>
      <text v-else-if="failed(node.assetId)" class="readonly-content__placeholder" role="button" aria-disabled="false" aria-label="图片加载失败，点击重试" @click.stop="emit('retryImage', node.assetId)">图片加载失败，点击重试</text>
      <image v-else-if="assets[node.assetId]" class="readonly-content__image" :src="assets[node.assetId]" mode="aspectFit" @error="fail(node.assetId)" />
      <text v-else class="readonly-content__placeholder">图片暂不可用</text>
    </template>
  </view>
</template>
<style scoped>
.readonly-content { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.readonly-content__paragraph { line-height: inherit; }
.readonly-content__paragraph + .readonly-content__paragraph { margin-top: 12px; }
.readonly-content__image { display: block; width: 100%; height: 146px; }
.readonly-content__placeholder { color: var(--app-color-text-muted); font-size: 13px; }
</style>
