<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isStaticSessionPreview } from '@/platform/session'
import LiveExamCenter from '@/components/exam/LiveExamCenter.vue'
import StaticExamCenter from '@/components/exam/StaticExamCenter.vue'
const query = ref<Record<string, unknown> | null>(null)
const preview = ref(false)
onLoad(value => { query.value = value || {}; preview.value = isStaticSessionPreview(value) })
</script>
<template><StaticExamCenter v-if="query && preview" :query="query" practice /><LiveExamCenter v-else-if="query" purpose="practice" /></template>
