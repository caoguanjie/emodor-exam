<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useDialog } from '@wot-ui/ui'

const props = withDefaults(defineProps<{ disabled?: boolean; eligible?: boolean; contextKey?: string }>(), { disabled: false, eligible: true, contextKey: '' })
const emit = defineEmits<{ terms: [] }>()
const accepted = ref(false)
const dialog = useDialog('login-consent')
let pending: Promise<boolean> | undefined
let finishPending: ((value: boolean) => void) | undefined

function cancelPending() {
  dialog.close()
  finishPending?.(false)
}

function ensureConsent(): Promise<boolean> {
  if (!props.eligible || props.disabled) return Promise.resolve(false)
  if (accepted.value) return Promise.resolve(true)
  if (pending) return pending
  pending = new Promise(resolve => {
    finishPending = value => {
      pending = undefined
      finishPending = undefined
      resolve(value)
    }
  })
  const current = pending
  void dialog.confirm({
    title: '请阅读并同意协议',
    msg: '点击“同意并登录”，将自动勾选并同意《服务协议》，然后继续登录。',
    confirmButtonText: '同意并登录',
    cancelButtonText: '暂不同意',
    closeOnClickModal: true,
  }).then(() => {
    if (pending !== current) return
    if (!props.eligible || props.disabled) { finishPending?.(false); return }
    accepted.value = true
    finishPending?.(true)
  }, () => { if (pending === current) finishPending?.(false) })
  return current
}

function openTerms() { cancelPending(); emit('terms') }
watch(() => props.contextKey, cancelPending, { flush: 'sync' })
watch(() => props.eligible && !props.disabled, eligible => { if (!eligible) cancelPending() }, { flush: 'sync' })
onBeforeUnmount(cancelPending)
defineExpose({ ensureConsent, cancelPending })
</script>

<template>
  <view class="login-consent">
    <wd-checkbox v-model="accepted" type="square" :disabled="disabled" role="checkbox" aria-label="我已阅读并同意服务协议" :aria-checked="accepted" custom-class="login-consent__checkbox" custom-style="--wot-checkbox-icon-size:18px;--wot-checkbox-label-font-size:12px;--wot-checkbox-label-color:var(--app-color-text-muted)">我已阅读并同意</wd-checkbox>
    <text class="login-consent__link" role="button" @click.stop="openTerms">《服务协议》</text>
    <wd-dialog selector="login-consent" />
  </view>
</template>

<style scoped>
.login-consent { display: flex; align-items: center; justify-content: center; color: var(--app-color-text-muted); font-size: 12px; white-space: nowrap; }
.login-consent__link { color: var(--app-color-primary); }
</style>
