<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import ReadonlyRichContent from '@/components/rich-content/ReadonlyRichContent.vue'
import { institution, serviceTerms as previewTerms, useShellScenario } from '@/fixtures/ui-scenarios/shell'
import { useSiteConfig } from '@/composables/useSiteConfig'
import { isStaticSessionPreview } from '@/platform/session'

const { loadScenario } = useShellScenario('terms-default')
const preview = ref(false)
const { loading, error, serviceTerms, load, invalidate } = useSiteConfig()
const hasDocumentTitle = computed(() => {
    const first = serviceTerms.value?.content[0]
    return first?.type === 'heading' && first.attrs.level === 1
})
onLoad(query => { preview.value = isStaticSessionPreview(query); loadScenario(query) })
onShow(() => { if (!preview.value) void load() })
onHide(invalidate)
onUnload(invalidate)
</script>
<template>
    <AppPage title="服务协议" :back-target="`/pages/profile/about${preview ? '?scenario=about-default' : ''}`">
        <view v-if="preview" class="terms-paper">
            <text class="terms-paper__title">{{ institution }}服务使用协议</text>
            <text class="terms-paper__intro">欢迎使用{{ institution }}在线教育平台（以下简称“本平台”）。请您仔细阅读以下条款：</text>
            <view v-for="section in previewTerms" :key="section.title" class="terms-paper__section"><text class="terms-paper__heading">{{ section.title }}</text><text>{{ section.text }}</text></view>
        </view>
        <view v-else-if="loading" class="terms-state" role="status"><wd-loading /><text>正在加载服务条款</text></view>
        <EmptyState v-else-if="error" title="服务条款加载失败" :description="error"><wd-button size="small" @click="load">重新加载</wd-button></EmptyState>
        <view v-else-if="serviceTerms" class="terms-paper terms-paper--rich" :class="{ 'terms-paper--titled': hasDocumentTitle }"><ReadonlyRichContent :doc="serviceTerms" :schema-version="3" /></view>
        <EmptyState v-else image="/static/states/empty-data.png" title="暂未发布服务条款" />
    </AppPage>
</template>
<style scoped>
.terms-paper { display: flex; flex-direction: column; gap: 20px; padding: 20px; border-radius: var(--app-radius-lg); background: var(--app-color-surface); font-size: 14px; line-height: 1.8; color: var(--app-color-text-secondary); }
.terms-paper__title { white-space: pre-line; color: var(--app-color-text); font-size: 18px; line-height: 1.5; font-weight: 600; text-align: center; }
.terms-paper__intro { line-height: 1.5; }
.terms-paper__section { display: flex; flex-direction: column; gap: 8px; line-height: 1.8; white-space: pre-line; }
.terms-paper__heading { color: var(--app-color-text); font-size: 14px; font-weight: 600; }
/* Adapt generated heading defaults here; explicit text marks retain their formatting. */
.terms-paper--rich :deep(.rich-node--heading) { color: var(--app-color-text); font-size: 14px !important; font-weight: 600 !important; line-height: 1.8; }
.terms-paper--rich :deep(.readonly-content > .rich-node--heading) { margin: 20px 0 8px; }
.terms-paper--rich :deep(.readonly-content > .rich-node--heading:first-child) { margin-top: 0; }
.terms-paper--rich :deep(.readonly-content > .rich-node--heading + *) { margin-top: 0; }
.terms-paper--rich :deep(.readonly-content > .rich-node--paragraph + .rich-node--paragraph) { margin-top: 1.8em; }
.terms-paper--titled :deep(.readonly-content > .rich-node--heading:first-child) { font-size: 18px !important; line-height: 1.5; text-align: center !important; margin-bottom: 20px; }
.terms-paper--titled :deep(.readonly-content > .rich-node--heading:first-child + .rich-node--paragraph) { line-height: 1.5; }
.terms-state { min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--app-color-text-muted); font-size: 14px; }
</style>
