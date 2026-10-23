<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isStaticSessionPreview } from '@/platform/session'
import StaticExamCenter from '@/components/exam/StaticExamCenter.vue'
import LiveExamCenter from '@/components/exam/LiveExamCenter.vue'
const query = ref<Record<string, unknown> | null>(null), preview = ref(false)
onLoad(value => { preview.value = isStaticSessionPreview(value); query.value = value || {} })
</script>
<template><StaticExamCenter v-if="query && preview" :query="query" /><LiveExamCenter v-else-if="query" /></template>
