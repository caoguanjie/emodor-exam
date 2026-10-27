<script setup lang="ts">
import { ref } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
// #ifndef MP-WEIXIN
import { onBackPress } from '@dcloudio/uni-app'
// #endif
import { isStaticSessionPreview } from '@/platform/session'
import StaticExamTake from '@/components/exam/StaticExamTake.vue'
import LiveExamTake from '@/components/exam/LiveExamTake.vue'
const query = ref<Record<string, unknown> | null>(null), preview = ref(false)
const live = ref<{ show(): void; hide(): void; dispose(): void; back(): boolean } | null>(null)
onLoad(value => { preview.value = isStaticSessionPreview(value); query.value = value || {} })
onShow(() => live.value?.show()); onHide(() => live.value?.hide()); onUnload(() => live.value?.dispose())
// WeChat uses its native page-back prompt; swipe-back/closing still persists via hide/unload.
// #ifndef MP-WEIXIN
onBackPress(() => preview.value ? false : live.value?.back() ?? false)
// #endif
</script>
<template><StaticExamTake v-if="query && preview" :query="query" /><LiveExamTake v-else-if="query" ref="live" :record-id="String(query.record_id || '')" /></template>
