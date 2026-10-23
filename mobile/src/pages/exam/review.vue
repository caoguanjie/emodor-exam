<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isStaticSessionPreview } from '@/platform/session'
import StaticExamReview from '@/components/exam/StaticExamReview.vue'
import LiveExamReview from '@/components/exam/LiveExamReview.vue'
const query = ref<Record<string, unknown> | null>(null), preview = ref(false)
onLoad(value => { preview.value = isStaticSessionPreview(value); query.value = value || {} })
</script>
<template><StaticExamReview v-if="query && preview" :query="query" /><LiveExamReview v-else-if="query" :record-id="String(query.record_id || '')" /></template>
