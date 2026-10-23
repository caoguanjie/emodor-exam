<script setup lang="ts">
import { ref } from 'vue'
import { onBackPress, onHide, onLoad, onUnload } from '@dcloudio/uni-app'
import { isStaticSessionPreview } from '@/platform/session'
import StaticExamTake from '@/components/exam/StaticExamTake.vue'
import LiveExamTake from '@/components/exam/LiveExamTake.vue'
const query = ref<Record<string, unknown> | null>(null), preview = ref(false)
const live = ref<{ hide(): void; dispose(): void; back(): boolean } | null>(null)
onLoad(value => { preview.value = isStaticSessionPreview(value); query.value = value || {} })
onHide(() => live.value?.hide()); onUnload(() => live.value?.dispose())
onBackPress(() => preview.value ? false : live.value?.back() ?? false)
</script>
<template><StaticExamTake v-if="query && preview" :query="query" /><LiveExamTake v-else-if="query" ref="live" :record-id="String(query.record_id || '')" /></template>
