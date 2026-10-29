import { computed, ref, watch, toRaw } from 'vue'
import { defineStore } from 'pinia'
import { createIdentitySession, getIdentity, getIdentitySession, releaseIdentityImage, uploadIdentityImage, type IdentityImageType, type IdentitySessionView, type IdentityVerificationView } from '@/api/identity'
import { ApiError } from '@/api/client'
import type { MediaTicketView } from '@/api/media'
import { resolveMediaUrl } from '@/platform/media-url'
import { pickIdentityMedia, releasePickedMedia, type MediaSource, type PickedMedia } from '@/platform/media-picker'
import { useSessionStore } from './session'
import { useLearnerStore } from './learner'
import type { IdentityMaterialKind } from '@/types/identity'

interface Material { asset_id: string; state: 'uploading' | 'ready' | 'error'; preview: string; file?: PickedMedia; ticket?: MediaTicketView }
const imageTypes: Record<IdentityMaterialKind, IdentityImageType> = { portrait: 'id_card_portrait', emblem: 'id_card_emblem', face: 'face' }
const kinds: IdentityMaterialKind[] = ['portrait', 'emblem', 'face']
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '请求失败，请稍后重试' }
export const useIdentityStore = defineStore('mobile-identity', () => {
  const session = useSessionStore()
  const authority = ref<IdentityVerificationView | null>(null)
  const currentSession = ref<IdentitySessionView | null>(null)
  const materials = ref<Record<IdentityMaterialKind, Material | null>>({ portrait: null, emblem: null, face: null })
  const consent = ref(false), loading = ref(false), submitting = ref(false), polling = ref(false), selecting = ref(false), picking = ref(false)
  const loadError = ref(''), error = ref('')
  const failure = ref<{ reason?: string; service: boolean; kind?: IdentityMaterialKind; upload: boolean } | null>(null)
  const verified = computed(() => authority.value?.status === 'verified' && !loadError.value && !loading.value)
  const pending = computed(() => !verified.value && (currentSession.value?.status === 'pending' || authority.value?.status === 'pending'))
  const busy = computed(() => loading.value || submitting.value || polling.value || selecting.value || kinds.some(k => materials.value[k]?.state === 'uploading'))
  const canSubmit = computed(() => !!authority.value && !loadError.value && !verified.value && !pending.value && !busy.value && consent.value && kinds.every(k => materials.value[k]?.state === 'ready' && !!materials.value[k]?.asset_id && (k === 'face' || !!materials.value[k]?.preview)))
  let revision = 0, readRevision = 0, timer: ReturnType<typeof setTimeout> | undefined, wake: (() => void) | undefined
  const pickedFiles = new Set<PickedMedia>()
  function release(file: PickedMedia) { const raw = toRaw(file); if (pickedFiles.delete(raw)) releasePickedMedia(raw) }
  function valid(start: number, epoch: number) { return start === revision && epoch === session.sessionEpoch }
  function clear(kind: IdentityMaterialKind, remote = false) { const material = materials.value[kind]; if (material?.file) release(material.file); if (remote && material?.asset_id) void releaseIdentityImage(material.asset_id).catch(() => {}); materials.value[kind] = null }
  function clearMaterials(remote = false) { kinds.forEach(kind => clear(kind, remote)); consent.value = false }
  function leave(remote = true) { revision++; readRevision++; if (timer) clearTimeout(timer); wake?.(); wake = undefined; clearMaterials(remote && !currentSession.value && !submitting.value && !verified.value); pickedFiles.forEach(release); authority.value = null; currentSession.value = null; loading.value = false; submitting.value = false; polling.value = false; selecting.value = false; picking.value = false; error.value = ''; loadError.value = ''; failure.value = null }
  function hide() { if (!picking.value) leave() }
  watch(() => session.sessionEpoch, () => leave(false), { flush: 'sync' })
  function applyError(cause: unknown, kind?: IdentityMaterialKind) {
    failure.value = { service: cause instanceof ApiError && cause.code === 50004 && !kind,
      upload: !!kind && cause instanceof ApiError && (cause.code === -1 || cause.code === -2 || cause.status >= 500), kind,
      reason: cause instanceof ApiError ? (cause.data as { reason_code?: string } | null)?.reason_code : undefined }
    if (cause instanceof ApiError && cause.data && typeof cause.data === 'object') {
      const data = cause.data as { clear_materials?: unknown }
      if (Array.isArray(data.clear_materials)) for (const kind of kinds) if (data.clear_materials.includes(imageTypes[kind])) clear(kind, true)
    }
    error.value = errorMessage(cause)
  }
  async function load() {
    const start = revision, epoch = session.sessionEpoch, read = ++readRevision
    loading.value = true; loadError.value = ''
    try {
      if (!session.initialized && !await session.bootstrap()) return
      if (!valid(start, epoch)) return
      const result = await getIdentity()
      if (!valid(start, epoch) || read !== readRevision) return
      authority.value = result
      if (session.user) useLearnerStore().user = { ...session.user, identity_status: result.status, ...(result.real_name ? { real_name: result.real_name } : {}) }
      if (result.status === 'verified') { currentSession.value = null; clearMaterials() }
    } catch (cause) { if (valid(start, epoch) && read === readRevision) loadError.value = errorMessage(cause) }
    finally { if (valid(start, epoch) && read === readRevision) loading.value = false }
  }
  async function upload(kind: IdentityMaterialKind, source: MediaSource) {
    if (busy.value || pending.value || verified.value) return
    const start = revision, epoch = session.sessionEpoch
    selecting.value = true; picking.value = true; error.value = ''; failure.value = null
    let picked: PickedMedia | null = null
    let receivedAsset = ''
    try {
      picked = await pickIdentityMedia(kind, source)
      if (valid(start, epoch)) picking.value = false
      if (!picked) return
      pickedFiles.add(picked)
      if (!valid(start, epoch)) { release(picked); return }
      const result = await uploadIdentityImage(imageTypes[kind], picked)
      receivedAsset = typeof result.asset_id === 'string' ? result.asset_id : ''
      if (!valid(start, epoch)) { release(picked); if (epoch === session.sessionEpoch) void releaseIdentityImage(result.asset_id).catch(() => {}); return }
      if (!receivedAsset || result.scan_status !== 'safe' || result.image_type !== imageTypes[kind] || (kind !== 'face' && !result.processed_preview)) throw new Error('照片处理未完成，请重新上传')
      const preview = kind === 'face' ? picked.tempFilePath : resolveMediaUrl(result.processed_preview!.content_url)
      clear(kind, !currentSession.value); currentSession.value = null
      if (authority.value) authority.value = { ...authority.value, status: 'unverified', current_session_id: null, reason_code: null }
      materials.value[kind] = { asset_id: result.asset_id, state: 'ready', preview, file: picked, ...(result.processed_preview ? { ticket: result.processed_preview } : {}) }
    } catch (cause) { if (picked) release(picked); if (receivedAsset && epoch === session.sessionEpoch) void releaseIdentityImage(receivedAsset).catch(() => {}); if (valid(start, epoch)) applyError(cause, picked ? kind : undefined) }
    finally { if (valid(start, epoch)) { selecting.value = false; picking.value = false } }
  }
  async function accept(result: IdentitySessionView, start: number, epoch: number) {
    if (!valid(start, epoch)) return
    currentSession.value = result
    if (result.status === 'rejected') {
      for (const kind of kinds) if (result.clear_materials.includes(imageTypes[kind])) clear(kind)
      if (authority.value) authority.value = { ...authority.value, status: 'rejected', reason_code: result.reason_code }
    } else if (result.status === 'verified') await load()
  }
  async function poll() {
    if (polling.value) return
    const id = currentSession.value?.session_id || authority.value?.current_session_id
    if (!id) return
    const start = revision, epoch = session.sessionEpoch
    polling.value = true; error.value = ''; failure.value = null
    try {
      for (let index = 0; index < 12; index++) {
        if (!valid(start, epoch)) return
        const result = await getIdentitySession(id)
        await accept(result, start, epoch)
        if (!valid(start, epoch) || result.status !== 'pending') return
        if (index < 11) await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(() => { wake = undefined; resolve() }, 800) })
      }
    } catch (cause) { if (valid(start, epoch)) applyError(cause) }
    finally { if (valid(start, epoch)) polling.value = false }
  }
  async function createSession() {
    if (!canSubmit.value) return
    const start = revision, epoch = session.sessionEpoch
    submitting.value = true; error.value = ''; failure.value = null
    try {
      const result = await createIdentitySession({ face_asset_id: materials.value.face!.asset_id, id_card_portrait_asset_id: materials.value.portrait!.asset_id, id_card_emblem_asset_id: materials.value.emblem!.asset_id })
      await accept(result, start, epoch)
      if (valid(start, epoch) && result.status === 'pending') { submitting.value = false; await poll() }
    } catch (cause) {
      if (valid(start, epoch)) {
        if (cause instanceof ApiError && cause.status === 409 && (cause.data as { status?: string } | null)?.status === 'verified') await load()
        else applyError(cause)
      }
    }
    finally { if (valid(start, epoch)) submitting.value = false }
  }
  return { authority, currentSession, materials, consent, loading, submitting, polling, selecting, picking, loadError, error, failure, verified, pending, busy, canSubmit, load, upload, createSession, poll, hide, leave }
})
