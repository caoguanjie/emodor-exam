<script setup lang="ts">
import AppIcon from '@/components/common/AppIcon.vue'
import IdentityVerifiedBadge from './IdentityVerifiedBadge.vue'
import { computed } from 'vue'
import type { IdentityVerifiedInfo } from '@/types/identity'

const props = withDefaults(defineProps<{ mode: 'success' | 'detail' | 'load-error'; info: IdentityVerifiedInfo }>(), { mode: 'success' })
const rows = computed(() => [{ label: '姓名', value: props.info.name }, { label: '身份证号', value: props.info.maskedId }, { label: '性别', value: props.info.gender }, { label: '出生日期', value: props.info.birthday }, { label: '民族', value: props.info.nationality }, { label: '签发机关', value: props.info.authority }, { label: '有效期限', value: props.info.validity }].filter(row => row.value))
const emit = defineEmits<{ details: []; profile: []; retry: [] }>()
</script>

<template>
  <view v-if="mode === 'success'" class="identity-result">
    <view class="identity-result__hero"><view class="identity-result__mark"><AppIcon name="shield-check" :size="44" color="#07c160" /></view><text class="identity-result__title">实名认证成功</text><text class="identity-result__description">已完成本人身份核验</text></view>
    <view class="identity-result__card"><view class="identity-result__name-row"><text class="identity-result__name">{{ info.name }}</text><IdentityVerifiedBadge /></view><text class="identity-result__number">{{ info.maskedId }}</text><text class="identity-result__privacy">身份证号码已脱敏展示</text></view>
    <wd-button block @click="emit('details')">查看实名信息</wd-button>
    <wd-button block type="info" variant="plain" @click="emit('profile')">返回个人中心</wd-button>
  </view>
  <view v-else-if="mode === 'detail'" class="identity-result">
    <view class="identity-result__detail-status"><AppIcon name="badge-check" :size="26" color="#07c160" /><text>已通过实名认证</text></view>
    <view class="identity-result__list">
      <view v-for="row in rows" :key="row.label" class="identity-result__row"><text class="identity-result__label">{{ row.label }}</text><text class="identity-result__value" :class="{ 'identity-result__value--small': row.label === '有效期限' }">{{ row.value }}</text></view>
    </view>
    <text class="identity-result__detail-privacy">信息来自本次身份核验，仅本人可查看。</text>
    <wd-button block type="info" variant="plain" @click="emit('profile')">返回个人中心</wd-button>
  </view>
  <view v-else class="identity-result identity-result--error">
    <view class="identity-result__mark identity-result__mark--error"><AppIcon name="cloud-off" :size="38" color="#1989fa" /></view>
    <text class="identity-result__error-title">暂时无法获取实名状态</text>
    <text class="identity-result__error-copy">{{ '请检查网络后重试。\n不会将你的实名状态改为未认证。' }}</text>
    <wd-button block @click="emit('retry')">重新加载</wd-button>
    <wd-button block type="info" variant="plain" @click="emit('profile')">返回个人中心</wd-button>
  </view>
</template>

<style scoped>
.identity-result { padding: 28px 16px 20px; display: flex; flex-direction: column; gap: 18px; --wot-button-height-medium: 50px; --wot-button-radius-main: var(--app-radius-md); --wot-button-spacing-block: 0; --wot-button-info-plain-bg: var(--app-color-surface); --wot-button-info-plain-border: var(--app-color-border-strong); }
.identity-result__hero { padding: 14px 12px 20px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.identity-result__mark { display: flex; align-items: center; justify-content: center; width: 80px; height: 80px; background: var(--app-color-success-soft); border-radius: var(--app-radius-full); flex: none; }
.identity-result__title { font-size: 22px; font-weight: 600; }
.identity-result__description { color: var(--app-color-text-secondary); font-size: 14px; }
.identity-result__card { padding: 20px; display: flex; flex-direction: column; gap: 16px; border-radius: var(--app-radius-lg); background: var(--app-color-surface); }
.identity-result__name-row { display: flex; align-items: center; gap: 10px; }
.identity-result__name { font-size: 22px; font-weight: 600; }
.identity-result__number { font-size: 17px; font-family: 'IBM Plex Mono', monospace; color: var(--app-color-text-secondary); }
.identity-result__privacy, .identity-result__detail-privacy { font-size: 12px; color: var(--app-color-text-muted); }
.identity-result__detail-privacy { text-align: center; }
.identity-result__detail-status { display: flex; align-items: center; gap: 10px; padding: 16px; background: var(--app-color-success-soft); border-radius: var(--app-radius-md); font-size: 16px; font-weight: 600; }
.identity-result__list { padding: 0 16px; background: var(--app-color-surface); border-radius: var(--app-radius-lg); }
.identity-result__row { min-height: 58px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--app-color-border); }
.identity-result__row:last-child { border-bottom: 0; }
.identity-result__label { width: 64px; flex: none; color: var(--app-color-text-muted); font-size: 13px; }
.identity-result__value { flex: 1; min-width: 0; text-align: right; font-size: 14px; overflow-wrap: anywhere; }
.identity-result__value--small { font-size: 12px; }
.identity-result--error { padding: 100px 24px 24px; align-items: center; }
.identity-result--error :deep(.wd-button) { width: 100%; }
.identity-result__mark--error { background: var(--app-color-primary-soft); }
.identity-result__error-title { font-size: 20px; font-weight: 600; text-align: center; }
.identity-result__error-copy { font-size: 14px; color: var(--app-color-text-secondary); text-align: center; white-space: pre-line; }
.identity-result--error { line-height: 1.5; --wot-button-radius-main: 12px; }
.identity-result--error :deep(.wd-button) { font-size: 16px; font-weight: 600; }
</style>
