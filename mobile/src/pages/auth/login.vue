<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import AppTopBar from '@/components/common/AppTopBar.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import SmsLoginForm from '@/components/auth/SmsLoginForm.vue'
import LoginConsent from '@/components/auth/LoginConsent.vue'
import ConfirmSheet from '@/components/common/ConfirmSheet.vue'
import { institution, platformSubtitle, smsHelp, useShellScenario, resolveShellScenario } from '@/fixtures/ui-scenarios/shell'
import { ApiError } from '@/api/client'
import { isValidMobilePhone, normalizeMobilePhone, sendSmsCode } from '@/api/auth'
import { isStaticSessionPreview } from '@/platform/session'
import { useSessionStore } from '@/stores/session'
import { learnerLandingUrl } from '@/utils/learner-onboarding'
import { nativeNavigationStyle } from '@/platform/native-layout'
import { useSiteConfig } from '@/composables/useSiteConfig'
import { resolvePublicBrandingUrl } from '@/platform/media-url'

const nativeStyle = nativeNavigationStyle()
const { scenario, loadScenario } = useShellScenario('login-default')
const preview = ref(false)
const realHelpVisible = ref(false)
const phone = ref('')
const code = ref('')
const challengeId = ref('')
const challengeExpiresAt = ref(0)
const retryAt = ref(0)
const clock = ref(Date.now())
const sending = ref(false)
const loggingIn = ref(false)
const confirmingConsent = ref(false)
const consent = ref<InstanceType<typeof LoginConsent>>()
const previewForm = ref<InstanceType<typeof SmsLoginForm>>()
const hasError = ref(false)
const sent = ref(false)
const feedback = ref('短信验证码用于验证你的身份')
const session = useSessionStore()
const { config, load, invalidate } = useSiteConfig()
const logo = computed(() => preview.value ? '/static/brand-logo.png' : resolvePublicBrandingUrl(config.value?.logo_asset_id))
let ticker: ReturnType<typeof setInterval> | undefined
let active = true
let navigationRevision = 0

onLoad(query => {
  preview.value = isStaticSessionPreview(query)
  loadScenario(query)
  if (!preview.value) ticker = setInterval(() => { clock.value = Date.now() }, 250)
})
function deactivateLogin() { active = false; navigationRevision++; invalidate(); consent.value?.cancelPending(); previewForm.value?.cancelPending() }
onHide(deactivateLogin)
onShow(() => { active = true; if (!preview.value) void load() })
onUnload(() => { deactivateLogin(); if (ticker) clearInterval(ticker); challengeId.value = ''; code.value = '' })

const remaining = computed(() => Math.max(0, Math.ceil((retryAt.value - clock.value) / 1000)))
const challengeExpired = computed(() => !!challengeId.value && challengeExpiresAt.value <= clock.value)
const canLogin = computed(() => session.initialized && isValidMobilePhone(phone.value) && /^\d{6}$/.test(code.value) && !!challengeId.value && !challengeExpired.value && !sending.value && !loggingIn.value)
const sendLabel = computed(() => sending.value ? '发送中' : remaining.value ? `${remaining.value}s 后重新获取` : sent.value || hasError.value ? '重新获取' : '获取验证码')
const message = computed(() => challengeExpired.value ? '验证码已过期，请重新获取' : feedback.value)
const feedbackError = computed(() => hasError.value || challengeExpired.value)
const helpVisible = computed({
  get: () => preview.value ? scenario.value.loginState === 'help' : realHelpVisible.value,
  set: value => { if (preview.value) { if (!value) scenario.value = resolveShellScenario('login-default', 'login-default') } else realHelpVisible.value = value },
})
watch(() => normalizeMobilePhone(phone.value), () => {
  challengeId.value = ''; code.value = ''; retryAt.value = 0; sent.value = false; hasError.value = false
  feedback.value = '短信验证码用于验证你的身份'
})

function setScenario(id: string) {
  if (preview.value) scenario.value = resolveShellScenario(id, 'login-default')
  else if (id === 'login-help') realHelpVisible.value = true
}
function openTerms() { uni.navigateTo({ url: `/pages/profile/terms${preview.value ? '?scenario=terms-default' : ''}` }) }
function login() { if (active) uni.reLaunch({ url: preview.value ? '/pages/home/index?scenario=home-default' : session.user ? learnerLandingUrl(session.user) : '/pages/auth/login' }) }

function showError(error: unknown) {
  hasError.value = true
  feedback.value = error instanceof ApiError ? error.message : '操作失败，请稍后重试'
  if (error instanceof ApiError && error.data && typeof error.data === 'object' && 'retry_after' in error.data) {
    const retryAfter = Number(error.data.retry_after)
    if (Number.isFinite(retryAfter) && retryAfter > 0) { clock.value = Date.now(); retryAt.value = clock.value + retryAfter * 1000 }
  }
}

async function sendCode() {
  if (sending.value || loggingIn.value || remaining.value) return
  if (!isValidMobilePhone(phone.value)) { showError(new ApiError(40001, '请输入正确的11位手机号')); return }
  sending.value = true; hasError.value = false
  try {
    const challenge = await sendSmsCode(phone.value)
    clock.value = Date.now()
    challengeId.value = challenge.challenge_id
    challengeExpiresAt.value = clock.value + challenge.expires_in * 1000
    retryAt.value = clock.value + challenge.retry_after * 1000
    code.value = ''; sent.value = true
    feedback.value = '验证码已发送，请留意手机短信'
  } catch (error) { showError(error) }
  finally { sending.value = false }
}

async function submitLogin() {
  if (!canLogin.value || confirmingConsent.value || !active) return
  const startedRevision = navigationRevision
  confirmingConsent.value = true
  const approved = await consent.value?.ensureConsent()
  confirmingConsent.value = false
  clock.value = Date.now()
  if (!approved || !active || startedRevision !== navigationRevision || !canLogin.value) return
  loggingIn.value = true; hasError.value = false
  feedback.value = '正在验证身份，请稍候'
  try {
    await session.login({ phone: phone.value, challenge_id: challengeId.value, code: code.value })
    if (active && startedRevision === navigationRevision) { challengeId.value = ''; code.value = ''; login() }
  } catch (error) { if (active && startedRevision === navigationRevision) showError(error) }
  finally { loggingIn.value = false }
}
</script>
<template>
  <view class="login-page" :style="nativeStyle">
    <view class="login-page__hero"><AppTopBar title="学员登录" :back="false" light /><view class="login-page__brand"><view v-if="logo" class="login-page__logo"><image :src="logo" mode="aspectFit" /></view><view class="login-page__brand-copy"><text class="login-page__institution">{{ institution }}</text><text class="login-page__subtitle">{{ platformSubtitle }}</text></view></view></view>
    <view class="login-page__body">
      <SmsLoginForm v-if="preview" ref="previewForm" :scenario="scenario" @scenario="setScenario" @login="login" @terms="openTerms" />
      <view v-else class="login-form">
        <text class="login-form__title">手机号验证码登录</text>
        <view class="login-form__fields">
          <view class="login-form__field"><text class="login-form__label">手机号</text><wd-input v-model="phone" type="tel" :maxlength="18" :disabled="sending || loggingIn" placeholder="请输入11位手机号" clearable custom-style="flex:1;min-width:0" /></view>
          <view class="login-form__field"><text class="login-form__label">验证码</text><wd-input v-model="code" type="number" :maxlength="6" :disabled="loggingIn" :error="feedbackError" :placeholder="sent ? '请输入验证码' : '6位短信验证码'" custom-style="flex:1;min-width:0" /><wd-button button-id="mobile-sms-send" size="small" variant="soft" :disabled="!!remaining || sending || loggingIn" :loading="sending" custom-style="width:110px;padding:0;flex:none" @click="sendCode">{{ sendLabel }}</wd-button></view>
        </view>
        <view class="login-form__feedback" :class="{ 'login-form__feedback--error': feedbackError, 'login-form__feedback--sent': sent && !feedbackError }" role="status"><AppIcon :name="feedbackError ? 'circle-x' : 'info'" :size="14" :color="feedbackError ? '#ee0a24' : sent ? '#1989fa' : '#969799'" /><text>{{ message }}</text></view>
        <wd-button button-id="mobile-sms-login" block :disabled="!canLogin || confirmingConsent" :loading="loggingIn" custom-style="--wot-button-height-medium:50px;--wot-button-radius-main:var(--app-radius-md);font-weight:600" @click="submitLogin">{{ loggingIn ? '正在登录' : '登录' }}</wd-button>
        <LoginConsent ref="consent" :disabled="sending || loggingIn" :eligible="canLogin" :context-key="`${normalizeMobilePhone(phone)}|${challengeId}|${code}`" @terms="openTerms" />
      </view>
      <view class="login-page__help"><text role="button" @click="setScenario('login-help')">收不到验证码？</text></view>
    </view>
    <ConfirmSheet v-model="helpVisible" title="收不到验证码？" confirm-text="我知道了" cancel-text=""><view class="sms-help"><view v-for="item in smsHelp" :key="item.title" class="sms-help__item"><text class="sms-help__title">{{ item.title }}</text><text>{{ item.description }}</text></view><view class="sms-help__notice"><text class="sms-help__title">首次使用本平台？</text><text>使用本人手机号获取验证码即可登录，首次登录后请补充姓名和培训工种。</text></view></view></ConfirmSheet>
  </view>
</template>
<style scoped>
.login-page { min-height: 100vh; display: flex; flex-direction: column; background: var(--app-color-background); }
.login-page__hero { padding-top: var(--app-safe-area-top); background: linear-gradient(180deg, #3c82f8 70%, var(--app-color-primary-deep)); color: var(--app-color-surface); overflow: hidden; }
.login-page__brand { display: flex; align-items: center; gap: 14px; padding: 24px 24px 36px; }
.login-page__logo { width: 76px; height: 76px; flex: none; padding: 6px; border-radius: 22px; background: var(--app-color-surface); box-shadow: 0 8px 20px #0a3a8c40; }
.login-page__logo image { width: 64px; height: 64px; }
.login-page__brand-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.login-page__institution { font-size: 22px; font-weight: 600; line-height: 1.4; }
.login-page__subtitle { font-size: 14px; }
.login-page__body { flex: 1; display: flex; flex-direction: column; justify-content: space-between; gap: 50px; padding: 28px 20px 24px; }
.login-page__help { text-align: center; display: flex; flex-direction: column; gap: 10px; color: var(--app-color-primary); font-size: 14px; padding-top: 24px; }
.sms-help { display: flex; flex-direction: column; gap: 20px; font-size: 12px; color: var(--app-color-text-secondary); }
.sms-help__item, .sms-help__notice { display: flex; flex-direction: column; gap: 4px; }
.sms-help__title { font-size: 14px; font-weight: 500; color: var(--app-color-text); }
.sms-help__notice { padding: 14px; border-radius: var(--app-radius-md); background: var(--app-color-primary-soft); }
.login-form { display: flex; flex-direction: column; gap: 14px; }
.login-form__title { font-size: 17px; font-weight: 600; }
.login-form__fields { padding: 0 16px; border-radius: var(--app-radius-lg); background: var(--app-color-surface); }
.login-form__field { display: flex; align-items: center; gap: 12px; min-height: 64px; --wot-input-padding: 0; --wot-input-inner-font-size: 15px; --wot-input-bg: transparent; }
.login-form__field + .login-form__field { border-top: 1px solid var(--app-color-border); }
.login-form__label { width: 48px; flex: none; color: var(--app-color-text-secondary); font-size: 14px; }
.login-form__feedback { min-height: 22px; display: flex; gap: 6px; align-items: center; color: var(--app-color-text-muted); font-size: 12px; }
.login-form__feedback--error { color: var(--app-color-danger); }
.login-form__feedback--sent { color: var(--app-color-primary); }
/* #ifdef MP-WEIXIN */
.login-page__body { padding-bottom: calc(24px + var(--app-safe-area-bottom)); }
/* #endif */
</style>
