<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isStaticSessionPreview } from '@/platform/session'
import StaticExamInstructions from '@/components/exam/StaticExamInstructions.vue'
import LiveExamInstructions from '@/components/exam/LiveExamInstructions.vue'
const query = ref<Record<string, unknown> | null>(null), preview = ref(false)
onLoad(value => { preview.value = isStaticSessionPreview(value); query.value = value || {} })
</script>
<template><StaticExamInstructions v-if="query && preview" :query="query" /><LiveExamInstructions v-else-if="query" :paper-id="String(query.paper_id || '')" /></template>
