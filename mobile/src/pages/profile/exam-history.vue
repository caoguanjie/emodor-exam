<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isStaticSessionPreview } from '@/platform/session'
import StaticExamHistory from '@/components/exam/StaticExamHistory.vue'
import LiveExamHistory from '@/components/exam/LiveExamHistory.vue'
const query = ref<Record<string, unknown> | null>(null), preview = ref(false)
onLoad(value => { preview.value = isStaticSessionPreview(value); query.value = value || {} })
</script>
<template><StaticExamHistory v-if="query && preview" :query="query" /><LiveExamHistory v-else-if="query" /></template>
