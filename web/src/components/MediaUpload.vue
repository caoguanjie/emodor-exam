<template>
  <div class="media-upload" :class="{ 'is-disabled': disabled, 'media-upload--picture-card': listType === 'picture-card' }">
    <input
      v-if="listType === 'text'"
      ref="fileInput"
      class="media-upload__input"
      type="file"
      :accept="accept"
      :disabled="disabled"
      @change="onFileChange"
    />

    <el-upload v-if="listType === 'picture-card'" ref="pictureUpload" class="media-upload__picture"
      :class="{ 'is-full': pictureFiles.length > 0 }" list-type="picture-card" :file-list="pictureFiles"
      :auto-upload="false" :limit="1" :accept="accept" :disabled="disabled" :on-change="onPictureChange" :on-remove="clearSelection">
      <el-icon><Plus /></el-icon>
      <template #file>
        <img v-if="previewUrl && !isVideo" class="el-upload-list__item-thumbnail" :src="previewUrl" alt="课程封面缩略图" />
        <video v-else-if="previewUrl && isVideo" class="el-upload-list__item-thumbnail" :src="previewUrl" preload="metadata" muted />
        <span v-else class="media-upload__card-placeholder"><el-icon><VideoCamera v-if="isVideo" /><Picture v-else /></el-icon></span>
        <span class="el-upload-list__item-actions">
          <button type="button" class="media-upload__card-action" aria-label="预览文件" :disabled="!previewUrl && !currentPreviewAssetId"
            title="预览文件" @click.stop="openPreview"><el-icon><ZoomIn /></el-icon></button>
          <button type="button" class="media-upload__card-action" aria-label="移除文件" :disabled="disabled" @click.stop="clearSelection"><el-icon><Delete /></el-icon></button>
        </span>
      </template>
    </el-upload>

    <el-upload v-if="listType === 'drag'" ref="pictureUpload" class="media-upload__drag"
      drag :auto-upload="false" :show-file-list="false" :accept="accept" :disabled="disabled" :on-change="onPictureChange">
      <el-icon class="media-upload__drag-icon"><UploadFilled /></el-icon>
      <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
    </el-upload>

    <div v-if="listType === 'text' || state.status === 'error' || (listType === 'drag' && (state.file || state.assetId))" class="media-upload__actions">
      <button v-if="listType === 'text'" type="button" class="media-upload__button media-upload__button--primary" :disabled="disabled" @click="chooseFile">
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
        v-if="listType !== 'picture-card' && (state.file || state.assetId || modelValue)"
        type="button"
        class="media-upload__button"
        :disabled="disabled"
        @click="clearSelection"
      >
        清除
      </button>
    </div>

    <p v-if="!compact" class="media-upload__hint">{{ limitHint }}</p>

    <img v-if="previewUrl && !isVideo && listType !== 'picture-card'" class="media-upload__preview" :src="previewUrl" alt="媒体预览" />
    <button v-if="isVideo && listType !== 'picture-card' && (previewUrl || currentPreviewAssetId)"
      type="button" class="media-upload__video-preview" aria-label="播放预览" :disabled="previewLoading" @click="openPreview">
      <video v-if="previewUrl" class="media-upload__video-thumbnail" :src="previewUrl" preload="metadata" muted playsinline
        aria-label="视频缩略图" @loadedmetadata="showVideoFrame" />
      <span v-else class="media-upload__video-placeholder"><el-icon><VideoCamera /></el-icon><span>当前视频</span></span>
      <span class="media-upload__video-preview-label">{{ previewLoading ? '加载预览中…' : '播放预览' }}</span>
    </button>

    <div v-if="!compact && (displayName || state.status !== 'idle')" class="media-upload__summary">
      <span class="media-upload__filename" :title="displayName">{{ displayName || '媒体文件' }}</span>
      <span class="media-upload__status" :data-status="state.status">{{ statusLabel }}</span>
      <span v-if="state.durationMs !== null" class="media-upload__duration">时长 {{ formatDuration(state.durationMs) }}</span>
    </div>

    <progress v-if="state.status === 'uploading'" class="media-upload__progress" max="100" :value="state.progress">
      {{ state.progress }}%
    </progress>
    <p v-if="state.status === 'uploading'" class="media-upload__progress-label">上传中 {{ state.progress }}%</p>
    <p v-if="state.error" class="media-upload__error" role="alert">{{ state.error }}</p>
    <el-image-viewer v-if="previewVisible && previewUrl && !isVideo" :url-list="[previewUrl]" teleported @close="previewVisible = false" />
    <el-dialog v-if="previewVisible && isVideo" v-model="previewVisible" title="视频预览" width="min(900px, 92vw)"
      class="re-form-dialog" append-to-body destroy-on-close :before-close="beforePreviewClose">
      <p v-if="previewLoading" role="status">正在加载视频预览，大文件可能需要一些时间，可关闭取消。</p>
      <div v-else-if="previewError"><p role="alert">{{ previewError }}</p><button type="button" class="media-upload__button" @click="openPreview">重试预览</button></div>
      <video v-else-if="previewUrl" ref="videoPlayer" class="media-upload__video-player" :src="previewUrl" controls preload="metadata" />
      <template #footer><el-button @click="previewVisible = false">关闭</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton, ElDialog, ElIcon, ElImageViewer, ElUpload, type UploadFile, type UploadInstance, type UploadUserFile } from 'element-plus';
import { Delete, Picture, Plus, UploadFilled, VideoCamera, ZoomIn } from '@element-plus/icons-vue';
import { getMediaImageContent, getMediaVideoContent, getMediaLimits, getMediaMetadata, uploadMedia, type MediaMetadata, type MediaUploadResponse } from '../api/media';
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
  currentAssetId?: string | null;
  disabled?: boolean;
  listType?: 'text' | 'picture-card' | 'drag';
  compact?: boolean;
}>(), {
  modelValue: null,
  purpose: 'avatar',
  ownerId: undefined,
  currentAssetId: null,
  disabled: false,
  listType: 'text',
  compact: false,
});

const emit = defineEmits<{
  (event: 'update:modelValue', value: string | null): void;
  (event: 'uploaded', value: MediaUploadResponse): void;
  (event: 'status', value: MediaMetadata): void;
  (event: 'error', value: MediaUploadError): void;
  (event: 'pending', value: boolean): void;
}>();

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 30;

const fileInput = ref<HTMLInputElement | null>(null);
const pictureUpload = ref<UploadInstance>();
const previewVisible = ref(false);
const limits = ref<MediaLimits | null>(null);
const state = ref<MediaUploadState>(createMediaUploadState());
watch(() => state.value.status === 'uploading' || state.value.status === 'processing' || (state.value.status === 'error' && Boolean(state.value.file)),
  pending => emit('pending', pending), { immediate: true, flush: 'sync' });
const metadata = ref<MediaMetadata | null>(null);
const previewUrl = ref<string | null>(null);
const videoPlayer = ref<HTMLVideoElement>();
const previewLoading = ref(false);
const previewError = ref('');
let previewSerial = 0;
let previewController: AbortController | null = null;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let pollAttempts = 0;
let requestSerial = 0;
let uploadController: AbortController | null = null;

const disabled = computed(() => props.disabled);
const isVideo = computed(() => mediaKindForPurpose(props.purpose) === 'video');
const currentPreviewAssetId = computed(() => isVideo.value && !state.value.file ? props.currentAssetId || props.modelValue : null);
const pictureFiles = computed<UploadUserFile[]>(() => state.value.file || state.value.assetId || props.modelValue ? [{
  uid: 1,
  name: displayName.value || '媒体文件',
  url: previewUrl.value || undefined,
  status: state.value.status === 'uploading' ? 'uploading' : state.value.status === 'error' ? 'fail' : 'success',
  percentage: state.value.progress,
}] : []);
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
  previewVisible.value = false;
  closeVideoPreview();
  previewError.value = '';
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = null;
  }
}

function closeVideoPreview() {
  previewSerial += 1;
  previewController?.abort();
  previewController = null;
  previewLoading.value = false;
  videoPlayer.value?.pause();
}

// The dialog is conditionally mounted: its transition close event can be
// skipped on unmount, so cancel immediately when the model becomes false.
watch(previewVisible, visible => { if (!visible) closeVideoPreview(); }, { flush: 'sync' });

function beforePreviewClose(done: () => void) {
  closeVideoPreview();
  done();
}

function showVideoFrame(event: Event) {
  const video = event.target as HTMLVideoElement;
  if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2);
}

async function openPreview() {
  previewVisible.value = true;
  if (previewUrl.value || !isVideo.value) return;
  const assetId = currentPreviewAssetId.value;
  if (!assetId || previewLoading.value) return;
  const serial = ++previewSerial;
  const controller = new AbortController();
  previewController = controller;
  previewLoading.value = true;
  previewError.value = '';
  try {
    // Saved videos may be large. Download only on a deliberate preview click,
    // with the existing Authorization header; closing aborts the request.
    const blob = await getMediaVideoContent(assetId, { signal: controller.signal });
    if (serial !== previewSerial || controller.signal.aborted || assetId !== currentPreviewAssetId.value) return;
    previewUrl.value = URL.createObjectURL(blob);
  } catch (error) {
    if (serial === previewSerial && !controller.signal.aborted) previewError.value = safeErrorMessage(error);
  } finally {
    if (serial === previewSerial) previewLoading.value = false;
    if (previewController === controller) previewController = null;
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
      // New videos are intentionally unreadable until a lesson version owns
      // them. The ready upload receipt is authoritative; preview the local
      // File instead of issuing a GET that the server correctly rejects.
      if (isVideo.value) return;
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
  if (file) selectFile(file);
}

function onPictureChange(file: UploadFile) {
  // ElUpload creates its own preview before notifying us. clearFiles() only
  // removes list entries, so release that temporary URL before using our
  // request-scoped preview (which also covers video and context changes).
  if (file.url?.startsWith('blob:')) URL.revokeObjectURL(file.url);
  pictureUpload.value?.clearFiles();
  if (file.raw) selectFile(file.raw);
}

function selectFile(file: File) {
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
  if (props.listType === 'picture-card' || isVideo.value) previewUrl.value = URL.createObjectURL(file);
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
  pictureUpload.value?.clearFiles();
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
  const serial = requestSerial;
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

watch(() => [props.ownerId, props.purpose, props.modelValue] as const, ([ownerId, purpose, assetId], previous) => {
  const previousOwnerId = previous?.[0];
  const previousPurpose = previous?.[1];
  const previousAssetId = previous?.[2];
  const firstRun = previous === undefined;
  const contextChanged = firstRun || ownerId !== previousOwnerId || purpose !== previousPurpose;
  const bindingChanged = firstRun || assetId !== previousAssetId;
  if (!contextChanged && !bindingChanged) return;
  if (firstRun || purpose !== previousPurpose) void loadLimits();
  // A ready id emitted by this component is already reflected in state. Do
  // not turn the v-model feedback into a second GET or a polling reset.
  if (!contextChanged && assetId === state.value.assetId && state.value.status !== 'idle') return;
  invalidateMediaContext();
  if (assetId) void loadBoundAsset(assetId);
}, { immediate: true });

watch(() => props.currentAssetId, () => { if (!state.value.file) revokePreview(); });

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
.media-upload__video-preview { position: relative; width: 176px; height: 100px; padding: 0; overflow: hidden; border: 1px solid var(--el-border-color); border-radius: 8px; background: #151923; color: #fff; cursor: pointer; }
.media-upload__video-thumbnail { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.media-upload__video-placeholder { display: grid; justify-items: center; gap: 4px; padding-bottom: 14px; font-size: 12px; }
.media-upload__video-placeholder .el-icon { font-size: 26px; }
.media-upload__video-preview-label { position: absolute; inset: auto 0 0; padding: 4px; background: rgb(0 0 0 / 65%); font-size: 12px; }
.media-upload__video-preview:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.media-upload__drag { width: 100%; }
.media-upload__drag :deep(.el-upload) { display: block; width: 100%; }
.media-upload__drag :deep(.el-upload-dragger) { width: 100%; padding: 24px 12px; }
.media-upload__drag-icon { margin-bottom: 10px; color: var(--el-text-color-placeholder); font-size: 40px; }
.media-upload__picture :deep(.el-upload--picture-card),
.media-upload__picture :deep(.el-upload-list__item) { width: 112px; height: 112px; }
.media-upload__picture.is-full :deep(.el-upload--picture-card) { display: none; }
.media-upload__picture :deep(.el-upload-list__item-thumbnail) { width: 100%; height: 100%; object-fit: contain; }
.media-upload__picture :deep(.el-upload-list__item-actions) { display: flex; align-items: center; justify-content: center; gap: 16px; }
.media-upload__picture :deep(.el-upload-list__item:focus-within .el-upload-list__item-actions) { opacity: 1; }
.media-upload__card-placeholder { display: flex; height: 100%; align-items: center; justify-content: center; color: var(--el-text-color-placeholder); font-size: 32px; }
.media-upload__card-action { display: inline-flex; border: 0; padding: 4px; color: white; background: transparent; font-size: 20px; cursor: pointer; }
.media-upload__card-action:disabled { opacity: .45; cursor: not-allowed; }
.media-upload__video-player { display: block; width: 100%; max-height: 65vh; background: #000; }
</style>
