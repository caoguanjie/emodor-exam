<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { institution, platformSubtitle, useShellScenario } from '@/fixtures/ui-scenarios/shell'
import { useSiteConfig } from '@/composables/useSiteConfig'
import { resolvePublicBrandingUrl } from '@/platform/media-url'
import { isStaticSessionPreview } from '@/platform/session'

const { loadScenario } = useShellScenario('about-default')
const preview = ref(false)
const logoFailed = ref(false)
const { config, loading, error, serviceTerms, load, invalidate } = useSiteConfig()
const about = computed(() => preview.value ? {
    institution_name: institution, platform_subtitle: platformSubtitle, version: '1.2.0',
    contact_email: '', wechat_account: '', contact_phone: '',
} : config.value?.about)
const dialNumber = computed(() => about.value?.contact_phone?.replace(/[^\d+]/g, '') || '')
const logo = computed(() => {
    if (!preview.value && config.value?.logo_asset_id && !logoFailed.value) {
        try { return resolvePublicBrandingUrl(config.value.logo_asset_id) } catch { /* Use the bundled logo when unavailable. */ }
    }
    return '/static/brand-logo.png'
})

onLoad(query => { preview.value = isStaticSessionPreview(query); loadScenario(query) })
onShow(() => { if (!preview.value) { logoFailed.value = false; void load() } })
onHide(invalidate)
onUnload(invalidate)
function openTerms() { uni.navigateTo({ url: `/pages/profile/terms${preview.value ? '?scenario=terms-default' : ''}` }) }
function copyContact(value: string) {
    uni.setClipboardData({ data: value, fail: () => uni.showToast({ title: '复制失败，请手动复制', icon: 'none' }) })
}
function callContactPhone() {
    if (!dialNumber.value) return
    uni.makePhoneCall({ phoneNumber: dialNumber.value, fail: () => uni.showToast({ title: '无法发起拨号，请手动拨打', icon: 'none' }) })
}
</script>
<template>
    <AppPage title="关于我们" :back-target="`/pages/profile/index${preview ? '?scenario=profile-default' : ''}`">
        <view v-if="!preview && loading" class="about-state" role="status"><wd-loading /><text>正在加载关于我们</text></view>
        <EmptyState v-else-if="!preview && error" title="关于我们加载失败" :description="error"><wd-button size="small" @click="load">重新加载</wd-button></EmptyState>
        <template v-else-if="about">
            <view class="about-brand">
                <image class="about-brand__logo" :src="logo" mode="aspectFit" @error="logoFailed = true" />
                <text class="about-brand__title">{{ about.institution_name }}</text>
                <text class="about-brand__subtitle">{{ about.platform_subtitle }}</text>
            </view>
            <view class="about-info">
                <wd-cell-group border>
                    <wd-cell title="版本信息" :value="about.version" />
                    <wd-cell v-if="about.contact_email" title="联系邮箱">
                        <!-- #ifdef H5 -->
                        <a class="about-info__email" :href="`mailto:${about.contact_email}`">{{ about.contact_email }}</a>
                        <!-- #endif -->
                        <!-- #ifndef H5 -->
                        <text role="button" :aria-label="`复制邮箱 ${about.contact_email}`" @click="copyContact(about.contact_email)">{{ about.contact_email }}</text>
                        <!-- #endif -->
                    </wd-cell>
                    <wd-cell v-if="about.wechat_account" title="公众号" :value="about.wechat_account" clickable @click="copyContact(about.wechat_account)" />
                    <wd-cell v-if="about.contact_phone" title="联系电话">
                        <!-- #ifdef H5 -->
                        <a class="about-info__phone" :href="`tel:${dialNumber}`">{{ about.contact_phone }}</a>
                        <!-- #endif -->
                        <!-- #ifndef H5 -->
                        <text role="button" :aria-label="`拨打电话 ${about.contact_phone}`" @click="callContactPhone">{{ about.contact_phone }}</text>
                        <!-- #endif -->
                    </wd-cell>
                    <wd-cell v-if="preview || serviceTerms" title="服务条款" is-link @click="openTerms" />
                </wd-cell-group>
            </view>
        </template>
        <EmptyState v-else image="/static/states/empty-data.png" title="暂无机构信息" />
    </AppPage>
</template>
<style scoped>
.about-brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    min-height: 190px;
    padding: 12px 12px 22px;
    overflow-wrap: anywhere;
}

.about-brand__logo {
    width: 80px;
    height: 80px;
}

.about-brand__title {
    font-size: 20px;
    font-weight: 600;
    text-align: center;
}

.about-brand__subtitle {
    color: var(--app-color-text-muted);
    font-size: 12px;
    text-align: center;
}

.about-info {
    margin-top: 16px;
    overflow: hidden;
    overflow-wrap: anywhere;
    border-radius: var(--app-radius-lg);
    --wot-cell-padding: 18px 16px;
    --wot-cell-title-font-size: 14px;
    --wot-cell-value-font-size: 13px;
}
.about-info__email, .about-info__phone { color: inherit; text-decoration: none; overflow-wrap: anywhere; }
.about-state { min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--app-color-text-muted); font-size: 14px; }
</style>
