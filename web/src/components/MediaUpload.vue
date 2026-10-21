<template>
  <div class="media-upload" :class="{ 'is-disabled': disabled }">
    <input
      ref="fileInput"
      class="media-upload__input"
      type="file"
      :accept="accept"
      :disabled="disabled"
      @change="onFileChange"
    />

    <div class="media-upload__actions">
      <button type="button" class="media-upload__button media-upload__button--primary" :disabled="disabled" @click="chooseFile">
        选择文件
      </button>
      <button
        v-if="state.status === 'error' && (state.file || state.assetId)"
        type="button"
        class="media-upload__button"
        :disabled="disabled"
        @click="retry"
      >
        {{ state.assetId ? '重新查询' : '重试上传' }}
      </button>
      <button
        v-if="state.file || state.assetId || modelValue"
        type="button"
        class="media-upload__button"
        :disabled="disabled"
        @click="clearSelection"
      >
        清除
      </button>
    </div>

    <p class="media-upload__hint">{{ limitHint }}</p>

    <img v-if="previewUrl" class="media-upload__preview" :src="previewUrl" alt="媒体预览" />

    <div v-if="displayName || state.status !== 'idle'" class="media-upload__summary">
      <span class="media-upload__filename" :title="displayName">{{ displayName || '媒体文件' }}</span>
      <span class="media-upload__status" :data-status="state.status">{{ statusLabel }}</span>
      <span v-if="state.durationMs !== null" class="media-upload__duration">时长 {{ formatDuration(state.durationMs) }}</span>
    </div>

    <progress v-if="state.status === 'uploading'" class="media-upload__progress" max="100" :value="state.progress">
      {{ state.progress }}%
    </progress>
    <p v-if="state.status === 'uploading'" class="media-upload__progress-label">上传中 {{ state.progress }}%</p>
    <p v-if="state.error" class="media-upload__error" role="alert">{{ state.error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { getMediaImageContent, getMediaLimits, getMediaMetadata, uploadMedia, type MediaMetadata, type MediaUploadResponse } from '../api/media';
import {
  createMediaUploadState,
  mediaKindForPurpose,
  nextMediaUploadAction,
  reduceMediaUploadState,
  validateMediaFile,
  type MediaFileLike,
  type MediaLimits,
  type MediaPurpose,
  type MediaUploadState,
} from './media-upload-state';

interface MediaUploadError {
  message: string;
  assetId: string | null;
  recoverable: boolean;
}

const props = withDefaults(defineProps<{
  modelValue?: string | null;
  purpose?: MediaPurpose;
  ownerId?: string;
  disabled?: boolean;
}>(), {
  modelValue: null,
  purpose: 'avatar',
  ownerId: undefined,
  disabled: false,
});

const emit = defineEmits<{
  (event: 'update:modelValue', value: string | null): void;
  (event: 'uploaded', value: MediaUploadResponse): void;
  (event: 'status', value: MediaMetadata): void;
  (event: 'error', value: MediaUploadError): void;
}>();

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 30;

const fileInput = ref<HTMLInputElement | null>(null);
const limits = ref<MediaLimits | null>(null);
const state = ref<MediaUploadState>(createMediaUploadState());
const metadata = ref<MediaMetadata | null>(null);
const previewUrl = ref<string | null>(null);
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let pollAttempts = 0;
let requestSerial = 0;
let uploadController: AbortController | null = null;

const disabled = computed(() => props.disabled);
const accept = computed(() => {
  const kind = mediaKindForPurpose(props.purpose);
  const values = kind === 'video' ? limits.value?.allowed_video_types : limits.value?.allowed_image_types;
  if (values?.length) return values.join(',');
  return kind === 'video' ? 'video/*' : 'image/*';
});

const displayName = computed(() => state.value.file?.name || metadata.value?.original_name || (props.modelValue ? '已绑定媒体' : ''));
const statusLabel = computed(() => {
  switch (state.value.status) {
    case 'uploading': return '上传中';
    case 'processing': return '处理中';
    case 'ready': return '已就绪';
    case 'error': return '处理失败';
    default: return state.value.file ? '待上传' : '';
  }
});
const limitHint = computed(() => {
  const kind = mediaKindForPurpose(props.purpose);
  if (!kind) return '当前用途不支持通用媒体上传';
  const maxBytes = kind === 'video' ? limits.value?.video_max_bytes : limits.value?.image_max_bytes;
  const types = kind === 'video' ? limits.value?.allowed_video_types : limits.value?.allowed_image_types;
  const typeText = types?.length ? types.join('、') : kind === 'video' ? '服务端允许的视频类型' : '服务端允许的图片类型';
  return `${typeText} · ${maxBytes === undefined ? '大小由服务端校验' : `最大 ${formatBytes(maxBytes)}`}`;
});

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function chooseFile() {
  if (!disabled.value) fileInput.value?.click();
}

function clearPoll(resetAttempts = true) {
  if (pollTimer !== undefined) {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  }
  if (resetAttempts) pollAttempts = 0;
}

function revokePreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = null;
  }
}

function abortCurrentRequest() {
  uploadController?.abort();
  uploadController = null;
}

function resetInput() {
  if (fileInput.value) fileInput.value.value = '';
}

function safeErrorMessage(error: unknown): string {
  const candidate = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message || '') : '';
  const normalized = candidate.replace(/https?:\/\/\S+/gi, '请求失败').trim();
  return normalized && normalized.length <= 200 ? normalized : '上传失败，请稍后重试';
}

function errorAssetId(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === 'object' && typeof (data as { asset_id?: unknown }).asset_id === 'string') {
    return String((data as { asset_id: string }).asset_id);
  }
  return null;
}

function emitError(message: string, assetId: string | null) {
  emit('error', { message, assetId, recoverable: true });
}

function setError(message: string, assetId?: string | null) {
  state.value = reduceMediaUploadState(state.value, { type: 'error', message, assetId });
  emitError(message, state.value.assetId);
}

function markAssetReady(assetId: string, durationMs: number | null) {
  state.value = reduceMediaUploadState(state.value, { type: 'ready', assetId, durationMs });
  // Bound assets loaded from the parent are already persisted. Upload and
  // recovery paths still need to publish the ready id to the parent form.
  if (props.modelValue !== assetId) emit('update:modelValue', assetId);
}

async function loadPreview(asset: MediaMetadata, serial: number) {
  if (asset.media_kind !== 'image' || asset.status !== 'ready') return;
  try {
    const blob = await getMediaImageContent(asset.asset_id);
    if (serial !== requestSerial) return;
    revokePreview();
    previewUrl.value = URL.createObjectURL(blob);
  } catch {
    // A preview is optional; metadata/status remain authoritative and no
    // request details are surfaced in the UI.
  }
}

function schedulePoll(assetId: string, serial: number) {
  clearPoll(false);
  if (serial !== requestSerial || state.value.status !== 'processing') return;
  if (pollAttempts >= MAX_POLL_ATTEMPTS) {
    setError('媒体处理状态查询超时，请重新查询', assetId);
    return;
  }
  pollTimer = setTimeout(() => {
    pollTimer = undefined;
    void pollAsset(assetId, serial);
  }, POLL_INTERVAL_MS);
}

async function pollAsset(assetId: string, serial = requestSerial) {
  if (serial !== requestSerial || !assetId) return;
  clearPoll(false);
  pollAttempts += 1;
  try {
    const result = await getMediaMetadata(assetId);
    if (serial !== requestSerial) return;
    metadata.value = result;
    emit('status', result);
    if (result.status === 'ready') {
      markAssetReady(assetId, result.duration_ms);
      await loadPreview(result, serial);
      return;
    }
    if (result.status === 'failed') {
      setError(result.probe_error || '媒体内容校验失败', assetId);
      return;
    }
    state.value = reduceMediaUploadState(state.value, { type: 'processing', assetId, durationMs: result.duration_ms });
    schedulePoll(assetId, serial);
  } catch (error) {
    if (serial !== requestSerial) return;
    setError(safeErrorMessage(error), assetId);
    schedulePoll(assetId, serial);
  }
}

async function startUpload(file: File, serial = ++requestSerial) {
  if (disabled.value || serial !== requestSerial) return;
  clearPoll();
  abortCurrentRequest();
  state.value = reduceMediaUploadState(state.value, { type: 'upload-start' });
  const controller = new AbortController();
  uploadController = controller;
  try {
    const result = await uploadMedia(file, props.purpose, {
      ownerId: props.ownerId,
      signal: controller.signal,
      onProgress: (progress) => {
        if (serial === requestSerial) state.value = reduceMediaUploadState(state.value, { type: 'progress', progress });
      },
    });
    if (serial !== requestSerial) return;
    emit('uploaded', result);
    if (!result.asset_id) throw new Error('上传响应缺少媒体标识');
    if (result.status === 'ready') {
      markAssetReady(result.asset_id, result.duration_ms);
      try {
        const detail = await getMediaMetadata(result.asset_id);
        if (serial !== requestSerial) return;
        metadata.value = detail;
        emit('status', detail);
        await loadPreview(detail, serial);
      } catch {
        // The upload result is already ready; metadata/preview are optional.
      }
      return;
    }
    if (result.status === 'processing') {
      state.value = reduceMediaUploadState(state.value, { type: 'processing', assetId: result.asset_id, durationMs: result.duration_ms });
      await pollAsset(result.asset_id, serial);
      return;
    }
    setError('媒体处理失败', result.asset_id);
  } catch (error) {
    if (serial !== requestSerial || controller.signal.aborted) return;
    const assetId = errorAssetId(error);
    setError(safeErrorMessage(error), assetId);
    if (assetId) await pollAsset(assetId, serial);
  } finally {
    if (uploadController === controller) uploadController = null;
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || disabled.value) return;
  requestSerial += 1;
  const serial = requestSerial;
  clearPoll();
  abortCurrentRequest();
  revokePreview();
  metadata.value = null;
  state.value = reduceMediaUploadState(state.value, { type: 'select', file });
  const validation = validateMediaFile(file, props.purpose, limits.value);
  if (!validation.ok) {
    setError(validation.message);
    resetInput();
    return;
  }
  void startUpload(file, serial);
}

function retry() {
  if (disabled.value) return;
  const action = nextMediaUploadAction(state.value);
  if (action === 'poll' && state.value.assetId) {
    requestSerial += 1;
    clearPoll();
    void pollAsset(state.value.assetId, requestSerial);
    return;
  }
  if (action === 'upload' && state.value.file) {
    const validation = validateMediaFile(state.value.file, props.purpose, limits.value);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    requestSerial += 1;
    void startUpload(state.value.file as File, requestSerial);
  }
}

function clearSelection() {
  requestSerial += 1;
  clearPoll();
  abortCurrentRequest();
  revokePreview();
  metadata.value = null;
  state.value = reduceMediaUploadState(state.value, { type: 'clear' });
  resetInput();
  // Clearing the UI only changes the parent binding; it never DELETEs an
  // already-uploaded asset. The parent decides when a reference is saved.
  emit('update:modelValue', null);
}

async function loadLimits() {
  try {
    limits.value = await getMediaLimits();
  } catch {
    // Keep the picker usable. The server remains authoritative for limits.
  }
}

async function loadBoundAsset(assetId: string | null) {
  requestSerial += 1;
  const serial = requestSerial;
  clearPoll();
  abortCurrentRequest();
  revokePreview();
  metadata.value = null;
  if (!assetId) {
    state.value = reduceMediaUploadState(state.value, { type: 'clear' });
    return;
  }
  state.value = reduceMediaUploadState(createMediaUploadState(), { type: 'processing', assetId });
  try {
    const result = await getMediaMetadata(assetId);
    if (serial !== requestSerial) return;
    metadata.value = result;
    emit('status', result);
    if (result.status === 'ready') {
      markAssetReady(assetId, result.duration_ms);
      await loadPreview(result, serial);
    } else if (result.status === 'failed') {
      setError(result.probe_error || '媒体内容校验失败', assetId);
    } else {
      state.value = reduceMediaUploadState(state.value, { type: 'processing', assetId, durationMs: result.duration_ms });
      schedulePoll(assetId, serial);
    }
  } catch (error) {
    if (serial === requestSerial) setError(safeErrorMessage(error), assetId);
  }
}

function invalidateMediaContext() {
  requestSerial += 1;
  clearPoll();
  abortCurrentRequest();
  revokePreview();
  metadata.value = null;
  state.value = reduceMediaUploadState(state.value, { type: 'clear' });
  resetInput();
}

watch(() => props.purpose, () => { void loadLimits(); }, { immediate: true });
watch(() => [props.ownerId, props.purpose], ([ownerId, purpose], [previousOwnerId, previousPurpose]) => {
  if (ownerId === previousOwnerId && purpose === previousPurpose) return;
  invalidateMediaContext();
});
watch(() => props.modelValue, (assetId) => {
  if (assetId === state.value.assetId && state.value.status !== 'idle') return;
  void loadBoundAsset(assetId || null);
}, { immediate: true });

onBeforeUnmount(() => {
  requestSerial += 1;
  clearPoll();
  abortCurrentRequest();
  revokePreview();
});
</script>

<style scoped>
.media-upload { display: grid; gap: 8px; min-width: 240px; color: #334155; }
.media-upload.is-disabled { opacity: .65; }
.media-upload__input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.media-upload__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.media-upload__button { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 12px; background: #fff; color: #334155; cursor: pointer; }
.media-upload__button--primary { border-color: #3056d3; background: #3056d3; color: #fff; }
.media-upload__button:disabled { cursor: not-allowed; opacity: .6; }
.media-upload__hint, .media-upload__progress-label { margin: 0; color: #64748b; font-size: 12px; line-height: 1.5; }
.media-upload__summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 13px; }
.media-upload__filename { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.media-upload__status[data-status="ready"] { color: #18864b; }
.media-upload__status[data-status="error"] { color: #c2410c; }
.media-upload__status[data-status="processing"], .media-upload__status[data-status="uploading"] { color: #2563eb; }
.media-upload__duration { color: #64748b; }
.media-upload__progress { width: 100%; height: 8px; }
.media-upload__error { margin: 0; color: #b42318; font-size: 13px; line-height: 1.5; }
.media-upload__preview { width: 72px; height: 72px; border-radius: 8px; object-fit: cover; border: 1px solid #e2e8f0; }
</style>
