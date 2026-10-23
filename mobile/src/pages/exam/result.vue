<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isStaticSessionPreview } from '@/platform/session'
import StaticExamResult from '@/components/exam/StaticExamResult.vue'
import LiveExamResult from '@/components/exam/LiveExamResult.vue'
const query = ref<Record<string, unknown> | null>(null), preview = ref(false)
onLoad(value => { preview.value = isStaticSessionPreview(value); query.value = value || {} })
</script>
<template><StaticExamResult v-if="query && preview" :query="query" /><LiveExamResult v-else-if="query" :record-id="String(query.record_id || '')" /></template>
