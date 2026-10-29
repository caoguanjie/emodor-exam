<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import AppPage from '@/components/common/AppPage.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import IdentityVerifiedBadge from '@/components/identity/IdentityVerifiedBadge.vue'
import ConfirmSheet from '@/components/common/ConfirmSheet.vue'
import { shellProfile, useShellScenario } from '@/fixtures/ui-scenarios/shell'
import { isStaticSessionPreview } from '@/platform/session'
import { useSessionStore } from '@/stores/session'
import { useLearnerStore } from '@/stores/learner'
import ProtectedImage from '@/components/common/ProtectedImage.vue'
const { scenario, loadScenario } = useShellScenario('profile-default')
const preview = ref(false)
const loggingOut = ref(false)
const session = useSessionStore()
const learner = useLearnerStore()
const displayName = computed(() => preview.value ? shellProfile.name : learner.profile?.real_name || session.user?.real_name || '未登记姓名')
const displayCategory = computed(() => {
  if (preview.value) return `${shellProfile.job} · 本机构学员`
  const source = learner.profile ? learner.profile.source : session.user?.source
  return `${learner.profile?.category_name || (learner.profile?.category_id ? '已设置培训工种' : learner.profileError ? '工种加载失败' : learner.profileLoading ? '工种加载中' : '未设置培训工种')} · ${source === 'institution' ? '本机构学员' : source === 'external' ? '社会学员' : '学员'}`
})
const verified = computed(() => preview.value ? scenario.value.verified : session.user?.identity_status === 'verified')
const identityLabel = computed(() => verified.value ? '已实名' : !preview.value && session.user?.identity_status === 'pending' ? '认证中' : '未实名')
onLoad(query => { preview.value = isStaticSessionPreview(query); loadScenario(query) })
onShow(() => { if (!preview.value) void reload() })
async function reload() { if (!session.initialized && !await session.bootstrap()) return; if (session.accessToken) void learner.loadProfile().catch(() => {}) }
const logoutVisible = ref(false)
const previewRoutes: Record<string, string> = { '/pages/exam/practice': 'exam-practice', '/pages/profile/info': 'profile-info', '/pages/profile/exam-history': 'exam-history', '/pages/profile/wrong-book': 'exam-wrong-book', '/pages/identity/index': 'identity-collect', '/pages/profile/about': 'about-default' }
function open(path: string) { uni.navigateTo({ url: preview.value && previewRoutes[path] ? `${path}?scenario=${previewRoutes[path]}` : path }) }
async function logout() {
  if (loggingOut.value) return
  if (preview.value) { uni.reLaunch({ url: '/pages/auth/login' }); return }
  loggingOut.value = true
  try { await session.logout() }
  finally { loggingOut.value = false }
}
</script>
<template>
  <AppPage tab="profile"><template #header><view class="profile-hero" role="button" aria-label="查看个人资料" @click="open('/pages/profile/info')"><view class="profile-hero__avatar"><ProtectedImage v-if="!preview && learner.profile?.avatar_id" :asset-id="learner.profile.avatar_id" owner-type="user_avatar" :owner-id="learner.profile.id" :width="56" :height="56"><AppIcon name="user-round" :size="30" color="#ffffff" /></ProtectedImage><AppIcon v-else name="user-round" :size="30" color="#ffffff" /></view><view class="profile-hero__copy"><text class="profile-hero__name">{{ displayName }}</text><text class="profile-hero__category">{{ displayCategory }}</text></view><AppIcon name="chevron-right" :size="18" color="#ffffff" /></view></template>
    <view v-if="!preview && learner.profileError" class="profile-error"><text>{{ learner.profileError }}</text><wd-button size="small" @click="reload">重新加载</wd-button></view>
    <view class="profile-quick"><view role="button" aria-label="考试记录" @click="open('/pages/profile/exam-history')"><view class="profile-quick__icon"><AppIcon name="clipboard" :size="24" color="#1989fa" /></view><view><text>考试记录</text><text class="profile-quick__count">{{ preview ? `${shellProfile.recordCount} 条` : '查看记录' }}</text></view></view><view role="button" aria-label="我的错题本" @click="open('/pages/profile/wrong-book')"><view class="profile-quick__icon"><AppIcon name="book-check" :size="24" color="#1989fa" /></view><view><text>我的错题本</text><text class="profile-quick__count">{{ preview ? `${shellProfile.wrongCount} 题` : '查看错题' }}</text></view></view></view>
    <view class="profile-menu">
      <wd-cell-group border>
        <wd-cell title="模拟考试" is-link @click="open('/pages/exam/practice')"><template #prefix><AppIcon name="clipboard-pen-line" :size="18" /></template></wd-cell>
        <wd-cell title="个人资料" is-link @click="open('/pages/profile/info')"><template #prefix><AppIcon name="user-pen" :size="18" /></template></wd-cell>
        <wd-cell title="实名认证" is-link @click="open('/pages/identity/index')"><IdentityVerifiedBadge v-if="verified" /><text v-else>{{ identityLabel }}</text><template #prefix><AppIcon name="badge-check" :size="18" /></template></wd-cell>
        <wd-cell title="关于我们" is-link @click="open('/pages/profile/about')"><template #prefix><AppIcon name="info" :size="18" /></template></wd-cell>
      </wd-cell-group>
    </view>
    <view class="profile-logout"><wd-button block type="danger" variant="text" custom-style="--wot-button-height-medium:50px;--wot-button-radius-main:var(--app-radius-lg)" @click="logoutVisible = true">退出登录</wd-button></view>
    <ConfirmSheet v-model="logoutVisible" title="退出登录" message="确定要退出当前账号吗？" confirm-text="退出登录" @confirm="logout" />
  </AppPage>
</template>
<style scoped>
.profile-hero { display: flex; gap: 14px; align-items: center; min-height: 108px; padding: 24px 20px; background: linear-gradient(180deg, var(--app-color-primary), var(--app-color-primary-deep)); color: var(--app-color-surface); }
.profile-hero__avatar { width: 60px; height: 60px; flex: none; display: flex; align-items: center; justify-content: center; overflow:hidden; background: #ffffff33; border: 2px solid #ffffff66; border-radius: var(--app-radius-full); }
.profile-hero__copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.profile-hero__name { font-size: 19px; font-weight: 700; }
.profile-hero__category { color: #ffffffcc; font-size: 12px; }
.profile-quick { display: flex; min-height: 80px; padding: 16px 8px; border-radius: var(--app-radius-lg); background: var(--app-color-surface); margin-bottom: 14px; }
.profile-quick > view { flex: 1; display: flex; align-items: center; gap: 12px; padding: 0 16px; font-size: 14px; }
.profile-quick > view + view { border-left: 1px solid var(--app-color-border); }
.profile-quick__icon { width: 40px; height: 40px; flex: none; display: flex; align-items: center; justify-content: center; border-radius: var(--app-radius-md); background: var(--app-color-primary-soft); }
.profile-quick__count { display: block; margin-top: 2px; color: var(--app-color-text-muted); font-size: 12px; }
.profile-menu { overflow: hidden; border-radius: var(--app-radius-lg); --wot-cell-padding: 15px 16px; --wot-cell-title-font-size: 15px; --wot-cell-value-font-size: 13px; --wot-cell-value-color: var(--app-color-primary); }
.profile-menu :deep(.app-icon) { margin-right: 12px; }
.profile-logout { margin-top: 14px; border-radius: var(--app-radius-lg); background: var(--app-color-surface); }
.profile-error { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px; margin-bottom: 12px; color: var(--app-color-danger); font-size: 13px; }
</style>
