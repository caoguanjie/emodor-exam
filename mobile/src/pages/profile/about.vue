<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import { institution, platformSubtitle, useShellScenario } from '@/fixtures/ui-scenarios/shell'
import { isStaticSessionPreview } from '@/platform/session'
const { loadScenario } = useShellScenario('about-default')
const preview = ref(false)
onLoad(query => { preview.value = isStaticSessionPreview(query); loadScenario(query) })
function openTerms() { uni.navigateTo({ url: `/pages/profile/terms${preview.value ? '?scenario=terms-default' : ''}` }) }
</script>
<template><AppPage title="关于我们" :back-target="`/pages/profile/index${preview ? '?scenario=profile-default' : ''}`"><view class="about-brand"><image class="about-brand__logo" src="/static/brand-logo.png" mode="aspectFit" /><text class="about-brand__title">{{ institution }}</text><text class="about-brand__subtitle">{{ platformSubtitle }}</text></view><view class="about-info"><wd-cell-group border><wd-cell title="版本信息" value="1.2.0" /><wd-cell title="联系邮箱" value="待配置" /><wd-cell title="公众号" value="待配置" /><wd-cell title="官方 QQ 交流群" value="待配置" /><wd-cell title="服务条款" is-link @click="openTerms" /></wd-cell-group></view></AppPage></template>
<style scoped>
.about-brand { display: flex; flex-direction: column; align-items: center; gap: 14px; min-height: 190px; padding: 12px 12px 22px; }
.about-brand__logo { width: 80px; height: 80px; }
.about-brand__title { font-size: 20px; font-weight: 600; text-align: center; }
.about-brand__subtitle { color: var(--app-color-text-muted); font-size: 12px; }
.about-info { margin-top: 16px; overflow: hidden; border-radius: var(--app-radius-lg); --wot-cell-padding: 18px 16px; --wot-cell-title-font-size: 14px; --wot-cell-value-font-size: 13px; }
</style>
