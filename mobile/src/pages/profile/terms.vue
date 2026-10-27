<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import { institution, serviceTerms, useShellScenario } from '@/fixtures/ui-scenarios/shell'
import { isStaticSessionPreview } from '@/platform/session'
const { loadScenario } = useShellScenario('terms-default')
const preview = ref(false)
onLoad(query => { preview.value = isStaticSessionPreview(query); loadScenario(query) })
</script>
<template><AppPage title="服务协议" :back-target="`/pages/profile/about${preview ? '?scenario=about-default' : ''}`"><view class="terms-paper"><text class="terms-paper__title">{{ institution }}服务使用协议</text><text class="terms-paper__intro">欢迎使用{{ institution }}在线教育平台（以下简称“本平台”）。请您仔细阅读以下条款：</text><view v-for="section in serviceTerms" :key="section.title" class="terms-paper__section"><text class="terms-paper__heading">{{ section.title }}</text><text>{{ section.text }}</text></view></view></AppPage></template>
<style scoped>
.terms-paper { display: flex; flex-direction: column; gap: 20px; padding: 20px; border-radius: var(--app-radius-lg); background: var(--app-color-surface); font-size: 14px; color: var(--app-color-text-secondary); }
.terms-paper__title { white-space: pre-line; color: var(--app-color-text); font-size: 18px; line-height: 1.5; font-weight: 600; text-align: center; }
.terms-paper__intro { line-height: 1.5; }
.terms-paper__section { display: flex; flex-direction: column; gap: 8px; line-height: 1.8; white-space: pre-line; }
.terms-paper__heading { color: var(--app-color-text); font-size: 14px; font-weight: 600; }
</style>
