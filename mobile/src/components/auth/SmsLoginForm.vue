<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '../common/AppIcon.vue'
import LoginConsent from './LoginConsent.vue'
import type { ShellScenario } from '@/fixtures/ui-scenarios/shell'
const props = defineProps<{ scenario: ShellScenario }>()
const emit = defineEmits<{ scenario: [value: string]; login: []; terms: [] }>()
const phone = ref('')
const code = ref('')
const consent = ref<InstanceType<typeof LoginConsent>>()
const confirmingConsent = ref(false)
watch(() => props.scenario.id, () => {
  if (!phone.value && props.scenario.loginState !== 'idle') phone.value = '13800000000'
  if (!code.value && ['error', 'expired', 'loading'].includes(props.scenario.loginState || '')) code.value = '268013'
}, { immediate: true })
const isLoading = computed(() => props.scenario.loginState === 'loading')
const hasError = computed(() => ['error', 'expired', 'send-failed'].includes(props.scenario.loginState || ''))
const isSent = computed(() => ['sent', 'loading'].includes(props.scenario.loginState || ''))
const sendLabel = computed(() => isSent.value ? '49s 后重新获取' : hasError.value ? '重新获取' : '获取验证码')
const canLogin = computed(() => /^1\d{10}$/.test(phone.value) && /^\d{6}$/.test(code.value))
function sendCode() { if (/^1\d{10}$/.test(phone.value)) emit('scenario', 'login-sent') }
async function submitLogin() {
  if (!canLogin.value || isLoading.value || confirmingConsent.value) return
  confirmingConsent.value = true
  const approved = await consent.value?.ensureConsent()
  confirmingConsent.value = false
  if (approved && canLogin.value && !isLoading.value) emit('login')
}
function cancelPending() { consent.value?.cancelPending() }
defineExpose({ cancelPending })
</script>
<template>
  <view class="login-form">
    <text class="login-form__title">手机号验证码登录</text>
    <view class="login-form__fields">
      <view class="login-form__field"><text class="login-form__label">手机号</text><wd-input v-model="phone" type="tel" :maxlength="11" placeholder="请输入11位手机号" clearable custom-style="flex:1;min-width:0" /></view>
      <view class="login-form__field"><text class="login-form__label">验证码</text><wd-input v-model="code" type="number" :maxlength="6" :error="hasError" :placeholder="isSent ? '请输入验证码' : '6位短信验证码'" custom-style="flex:1;min-width:0" /><wd-button size="small" variant="soft" :disabled="isSent" custom-style="width:110px;padding:0;flex:none" @click="sendCode">{{ sendLabel }}</wd-button></view>
    </view>
    <view class="login-form__feedback" :class="{ 'login-form__feedback--error': hasError, 'login-form__feedback--sent': isSent }"><AppIcon :name="hasError ? 'circle-x' : 'info'" :size="14" :color="hasError ? '#ee0a24' : isSent ? '#1989fa' : '#969799'" /><text>{{ scenario.message }}</text></view>
    <wd-button block :disabled="!canLogin || isLoading || confirmingConsent" :loading="isLoading" custom-style="--wot-button-height-medium:50px;--wot-button-radius-main:var(--app-radius-md);font-weight:600" @click="submitLogin">{{ isLoading ? '正在登录' : '登录' }}</wd-button>
    <LoginConsent ref="consent" :disabled="isLoading" :eligible="canLogin" :context-key="`${phone}|${code}|${scenario.id}`" @terms="emit('terms')" />
  </view>
</template>
<style scoped>
.login-form { display: flex; flex-direction: column; gap: 14px; }
.login-form__title { font-size: 17px; font-weight: 600; }
.login-form__fields { padding: 0 16px; border-radius: var(--app-radius-lg); background: var(--app-color-surface); }
.login-form__field { display: flex; align-items: center; gap: 12px; min-height: 64px; --wot-input-padding: 0; --wot-input-inner-font-size: 15px; --wot-input-bg: transparent; }
.login-form__field + .login-form__field { border-top: 1px solid var(--app-color-border); }
.login-form__label { width: 48px; flex: none; color: var(--app-color-text-secondary); font-size: 14px; }
.login-form__feedback { min-height: 22px; display: flex; gap: 6px; align-items: center; color: var(--app-color-text-muted); font-size: 12px; }
.login-form__feedback--error { color: var(--app-color-danger); }
.login-form__feedback--sent { color: var(--app-color-primary); }
</style>
