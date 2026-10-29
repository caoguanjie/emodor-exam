<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import type { IdentityMaterialKind, IdentityMaterials } from '@/types/identity'
import ProtectedImage from '@/components/common/ProtectedImage.vue'
import type { MediaTicketView } from '@/api/media'

const props = withDefaults(defineProps<{ materials: IdentityMaterials; previews?: Partial<Record<IdentityMaterialKind, string>>; assets?: Partial<Record<IdentityMaterialKind, { asset_id: string; ticket?: MediaTicketView } | null>>; ownerId?: string; pending?: boolean; issue?: string }>(), { pending: false, issue: '', previews: () => ({}), assets: () => ({}), ownerId: '' })
const emit = defineEmits<{ select: [kind: IdentityMaterialKind] }>()
const count = computed(() => Number(props.materials.portrait === 'ready') + Number(props.materials.emblem === 'ready'))
const cards: { kind: 'portrait' | 'emblem'; title: string; icon: string }[] = [
  { kind: 'portrait', title: '身份证人像面', icon: 'contact-round' },
  { kind: 'emblem', title: '身份证国徽面', icon: 'id-card' },
]
function action(kind: IdentityMaterialKind): string {
  const state = props.materials[kind]
  if (props.pending) return '已提交 · 等待核验'
  if (state === 'uploading') return '正在处理照片…'
  if (state === 'ready') return kind === 'face' ? '已上传 · 重新拍摄' : '已上传 · 可重拍'
  if (state === 'error' && props.issue === 'upload') return '上传失败 · 点击重试'
  if (kind === 'face') return state === 'error' ? '重新拍摄正脸' : '现场拍照'
  if (state === 'unsafe') return '安全检查未通过 · 重新上传'
  if (state === 'error') return props.issue === 'upload' ? '上传失败 · 点击重试' : '识别失败 · 重新上传'
  return '拍照 / 相册选择'
}
const faceHint = computed(() => props.issue === 'face'
  ? '未能确认人证一致，请本人重新拍摄\n面部无遮挡、光线充足'
  : props.materials.face === 'ready'
    ? '请确认照片清晰、为本人拍摄\n提交后将进行人证比对'
    : '仅支持拍照，请正对镜头\n面部无遮挡、光线充足')
function select(kind: IdentityMaterialKind) {
  if (!props.pending && props.materials[kind] !== 'uploading') emit('select', kind)
}
</script>

<template>
  <view class="capture">
    <view class="capture__heading"><text>身份证照片</text><text class="capture__count" :class="{ 'capture__count--ready': count === 2 }">{{ count }} / 2</text></view>
    <text class="capture__requirement">证件在有效期内，四角完整、清晰无遮挡</text>
    <view class="capture__cards">
      <view v-for="card in cards" :key="card.kind" class="capture__card" :class="{ 'capture__card--error': materials[card.kind] === 'error' || materials[card.kind] === 'unsafe' }" role="button" :aria-label="card.title" :aria-disabled="pending || materials[card.kind] === 'uploading'" @click="select(card.kind)">
        <view class="capture__preview"><wd-loading v-if="materials[card.kind] === 'uploading'" :size="24" /><AppIcon v-else-if="materials[card.kind] === 'error' || materials[card.kind] === 'unsafe'" :name="card.icon" :size="24" color="#ee0a24" /><ProtectedImage v-else-if="assets[card.kind] && ownerId" :key="assets[card.kind]!.asset_id" :asset-id="assets[card.kind]!.asset_id" owner-type="identity_verification_user" :owner-id="ownerId" :initial-ticket="assets[card.kind]!.ticket" :width="72" :height="48" /><wd-img v-else-if="previews[card.kind]" :src="previews[card.kind]" width="72" height="48" mode="aspectFit" /><AppIcon v-else :name="materials[card.kind] === 'ready' ? card.icon : 'camera'" :size="24" color="#1989fa" /></view>
        <text class="capture__title">{{ card.title }}</text>
        <text class="capture__action" :class="{ 'capture__action--ready': materials[card.kind] === 'ready', 'capture__action--error': materials[card.kind] === 'error' && issue !== 'upload' || materials[card.kind] === 'unsafe', 'capture__action--pending': pending }">{{ action(card.kind) }}</text>
      </view>
    </view>
    <view class="capture__face" :class="{ 'capture__face--error': materials.face === 'error' }" role="button" aria-label="本人正脸照片" :aria-disabled="pending" @click="select('face')">
      <view class="capture__face-preview"><AppIcon v-if="materials.face === 'error'" name="scan-face" :size="30" color="#ee0a24" /><wd-img v-else-if="previews.face" :src="previews.face" width="76" height="76" mode="aspectFill" /><AppIcon v-else :name="materials.face === 'ready' ? 'user-round' : 'scan-face'" :size="30" color="#1989fa" /></view>
      <view class="capture__face-copy"><text class="capture__face-title">本人正脸照片</text><text class="capture__face-hint">{{ faceHint }}</text><text class="capture__face-action" :class="{ 'capture__action--ready': materials.face === 'ready', 'capture__action--pending': pending }">{{ action('face') }}</text></view>
    </view>
  </view>
</template>

<style scoped>
.capture { display: flex; flex-direction: column; gap: 8px; }
.capture__heading { display: flex; justify-content: space-between; align-items: center; font-size: 15px; font-weight: 600; }
.capture__count { color: var(--app-color-text-muted); font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 400; }
.capture__count--ready { color: var(--app-color-success); }
.capture__requirement { color: var(--app-color-text-secondary); font-size: 12px; }
.capture__cards { display: flex; gap: 12px; }
.capture__card { flex: 1; min-width: 0; height: 144px; padding: 12px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 7px; border: 1px solid var(--app-color-border); border-radius: var(--app-radius-md); background: var(--app-color-surface); }
.capture__preview { display: flex; justify-content: center; align-items: center; width: 72px; height: 48px; background: var(--app-color-primary-soft); border-radius: var(--app-radius-sm); }
.capture__title { font-size: 14px; font-weight: 500; }
.capture__action { color: var(--app-color-primary); font-size: 11px; text-align: center; overflow-wrap: anywhere; }
.capture__face { margin-top: 8px; min-height: 116px; padding: 14px; display: flex; align-items: center; gap: 14px; border: 1px solid var(--app-color-border); border-radius: var(--app-radius-md); background: var(--app-color-surface); }
.capture__face-preview { display: flex; align-items: center; justify-content: center; width: 76px; height: 76px; flex: none; border-radius: var(--app-radius-md); background: var(--app-color-primary-soft); }
.capture__face-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 5px; }
.capture__face-title { font-size: 15px; font-weight: 600; }
.capture__face-hint { white-space: pre-line; color: var(--app-color-text-secondary); font-size: 12px; }
.capture__face-action { color: var(--app-color-primary); font-size: 13px; font-weight: 500; }
.capture__action--ready { color: var(--app-color-success); }
.capture__action--error { color: var(--app-color-danger); }
.capture__action--pending { color: var(--app-color-text-muted); }
.capture { line-height: 1.5; }
.capture__card, .capture__face { box-sizing: border-box; border-radius: 12px; }
.capture__face { padding: 13px; }
.capture__preview { border-radius: 6px; }
.capture__face-preview { border-radius: 12px; }
.capture__card--error, .capture__face--error { border-color: var(--app-color-danger); }
.capture__card--error .capture__preview, .capture__face--error .capture__face-preview { background: var(--app-color-danger-soft); }
</style>
