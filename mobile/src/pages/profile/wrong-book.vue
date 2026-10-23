<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { isStaticSessionPreview } from '@/platform/session'
import StaticWrongBook from '@/components/exam/StaticWrongBook.vue'
import LiveWrongBook from '@/components/exam/LiveWrongBook.vue'
const query = ref<Record<string, unknown> | null>(null), preview = ref(false)
onLoad(value => { preview.value = isStaticSessionPreview(value); query.value = value || {} })
</script>
<template><StaticWrongBook v-if="query && preview" :query="query" /><LiveWrongBook v-else-if="query" /></template>
