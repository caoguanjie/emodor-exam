<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RenderableRichNode } from '@/types/content-v3'
import RichNode from './RichNode.vue'
defineOptions({ options: { virtualHost: true } })
const props = withDefaults(defineProps<{ node: RenderableRichNode; assets?: Record<string, string> }>(), { assets: () => ({}) })
const emit = defineEmits<{ retryImage: [assetId: string] }>()
const failedUrl = ref('')
const assetId = computed(() => props.node.assetId || '')
const url = computed(() => props.assets[assetId.value] || '')
const failed = computed(() => !!url.value && failedUrl.value === url.value)
</script>
<template>
  <text v-if="node.type === 'text'" :style="node.style" user-select>{{ node.text }}</text>
  <text v-else-if="node.type === 'hardBreak'" :style="node.style">{{ '\n' }}</text>
  <template v-else-if="node.type === 'image'">
    <text v-if="failed" class="readonly-content__placeholder" role="button" aria-disabled="false" aria-label="图片加载失败，点击重试" @click.stop="emit('retryImage', assetId)">图片加载失败，点击重试</text>
    <image v-else-if="url" class="readonly-content__image" :src="url" mode="aspectFit" @error="failedUrl = url" />
    <text v-else class="readonly-content__placeholder">图片暂不可用</text>
  </template>
  <scroll-view v-else-if="node.type === 'table'" class="rich-node__table-scroll" scroll-x>
    <view class="rich-node__table" :style="node.style"><RichNode v-for="(child, index) in node.children" :key="index" :node="child" :assets="assets" @retry-image="emit('retryImage', $event)" /></view>
  </scroll-view>
  <view v-else-if="node.type === 'horizontalRule'" class="rich-node__rule" />
  <view v-else-if="node.type === 'listItem'" class="rich-node__list-item" :style="node.style"><text class="rich-node__marker">{{ node.marker }}</text><view class="rich-node__list-body"><RichNode v-for="(child, index) in node.children" :key="index" :node="child" :assets="assets" @retry-image="emit('retryImage', $event)" /></view></view>
  <view v-else :class="`rich-node rich-node--${node.type}`" :style="node.style"><RichNode v-for="(child, index) in node.children" :key="index" :node="child" :assets="assets" @retry-image="emit('retryImage', $event)" /></view>
</template>
<style scoped>
.rich-node { min-width: 0; }
.rich-node--paragraph + .rich-node--paragraph, .rich-node--heading, .rich-node--blockquote, .rich-node--bulletList, .rich-node--orderedList, .rich-node--codeBlock { margin-top: 12px; }
.rich-node--heading { margin-bottom: 12px; }
.rich-node--blockquote { border-left: 3px solid #bdbdbd; padding-left: 12px; }
.rich-node--codeBlock { font-family: monospace; white-space: pre-wrap; background: #f2f2f2; padding: 10px; }
.rich-node__rule { margin: 12px 0; border-top: 1px solid #bdbdbd; }
.rich-node__list-item { display: flex; min-width: 0; }
.rich-node__marker { flex: none; min-width: 2em; padding-right: 6px; }
.rich-node__list-body { flex: 1; min-width: 0; }
.rich-node__table-scroll { width: 100%; min-width: 0; margin: 12px 0; white-space: normal; }
.rich-node__table { display: grid; box-sizing: border-box; border-top: 1px solid #bdbdbd; border-left: 1px solid #bdbdbd; }
.rich-node--tableCell, .rich-node--tableHeader { padding: 8px; box-sizing: border-box; border-right: 1px solid #bdbdbd; border-bottom: 1px solid #bdbdbd; overflow-wrap: anywhere; }
.rich-node--tableHeader { font-weight: 700; background: #f2f2f2; }
.readonly-content__image { display: block; width: 100%; height: 146px; }
.readonly-content__placeholder { color: var(--app-color-text-muted); font-size: 13px; }
</style>
