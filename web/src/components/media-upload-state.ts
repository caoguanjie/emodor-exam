/**
 * Runtime-independent upload state.  Keep this module free of Vue, Axios, and
 * browser globals so the transition and validation contract can be exercised by
 * Node's built-in test runner.
 */

export const MEDIA_PURPOSES = ['avatar', 'course_cover', 'video', 'question', 'branding'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];
export type MediaKind = 'image' | 'video';
export type MediaUploadStatus = 'idle' | 'uploading' | 'processing' | 'ready' | 'error';

export interface MediaLimits {
  video_max_bytes: number;
  image_max_bytes: number;
  probe_timeout_ms: number;
  allowed_image_types: string[];
  allowed_video_types: string[];
}

export interface MediaFileLike {
  name: string;
  type: string;
  size: number;
}

export interface MediaUploadState {
  status: MediaUploadStatus;
  file: MediaFileLike | null;
  progress: number;
  assetId: string | null;
  durationMs: number | null;
  error: string | null;
}

export type MediaValidation =
  | { ok: true; kind: MediaKind }
  | { ok: false; kind: null; message: string };

export type MediaUploadEvent =
  | { type: 'select'; file: MediaFileLike }
  | { type: 'upload-start' }
  | { type: 'progress'; progress: number }
  | { type: 'processing'; assetId: string; durationMs?: number | null }
  | { type: 'ready'; assetId: string; durationMs?: number | null }
  | { type: 'error'; message: string; assetId?: string | null }
  | { type: 'retry' }
  | { type: 'clear' };

export function createMediaUploadState(): MediaUploadState {
  return {
    status: 'idle',
    file: null,
    progress: 0,
    assetId: null,
    durationMs: null,
    error: null,
  };
}

export function mediaKindForPurpose(purpose: string): MediaKind | null {
  if (purpose === 'video') return 'video';
  if (purpose === 'avatar' || purpose === 'course_cover' || purpose === 'question' || purpose === 'branding') return 'image';
  return null;
}

function maxBytesForKind(kind: MediaKind, limits: MediaLimits | null | undefined): number | null {
  if (!limits) return null;
  const raw = kind === 'video' ? limits.video_max_bytes : limits.image_max_bytes;
  return Number.isFinite(raw) && raw >= 0 ? raw : null;
}

function allowedTypesForKind(kind: MediaKind, limits: MediaLimits | null | undefined): string[] {
  if (!limits) return [];
  return (kind === 'video' ? limits.allowed_video_types : limits.allowed_image_types)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.toLowerCase());
}

function readableBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

/**
 * This is an early UX check only.  The API remains authoritative for content
 * decoding, MIME sniffing, and the final size policy.
 */
export function validateMediaFile(
  file: MediaFileLike | null | undefined,
  purpose: string,
  limits?: MediaLimits | null,
): MediaValidation {
  const kind = mediaKindForPurpose(purpose);
  if (!kind) return { ok: false, kind: null, message: '该用途不支持通用媒体上传' };
  if (!file || !Number.isFinite(file.size) || file.size < 0) {
    return { ok: false, kind: null, message: '请选择有效文件' };
  }

  const allowed = allowedTypesForKind(kind, limits);
  if (allowed.length > 0 && !allowed.includes(String(file.type || '').toLowerCase())) {
    return { ok: false, kind: null, message: `文件类型不支持，请选择${kind === 'video' ? 'MP4 视频' : 'PNG/JPEG/WebP 图片'}` };
  }

  const maxBytes = maxBytesForKind(kind, limits);
  if (maxBytes !== null && file.size > maxBytes) {
    return { ok: false, kind: null, message: `文件超过服务端限制（最大 ${readableBytes(maxBytes)}）` };
  }
  return { ok: true, kind };
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function safeAssetId(assetId: string | null | undefined): string | null {
  const value = typeof assetId === 'string' ? assetId.trim() : '';
  return value || null;
}

function safeDuration(durationMs: number | null | undefined): number | null {
  return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
}

export function reduceMediaUploadState(state: MediaUploadState, event: MediaUploadEvent): MediaUploadState {
  switch (event.type) {
    case 'select':
      return {
        ...createMediaUploadState(),
        file: event.file,
      };
    case 'upload-start':
      return { ...state, status: 'uploading', progress: 0, error: null };
    case 'progress':
      return { ...state, status: state.status === 'idle' ? 'uploading' : state.status, progress: clampProgress(event.progress), error: null };
    case 'processing':
      return {
        ...state,
        status: 'processing',
        progress: 100,
        assetId: safeAssetId(event.assetId),
        durationMs: safeDuration(event.durationMs),
        error: null,
      };
    case 'ready':
      return {
        ...state,
        status: 'ready',
        progress: 100,
        assetId: safeAssetId(event.assetId),
        durationMs: safeDuration(event.durationMs),
        error: null,
      };
    case 'error':
      return {
        ...state,
        status: 'error',
        assetId: event.assetId === undefined ? state.assetId : safeAssetId(event.assetId),
        error: event.message || '媒体处理失败，请重试',
      };
    case 'retry':
      // If an asset id exists, a prior write may have completed.  Poll its
      // status instead of sending the same file a second time.
      if (state.assetId) return { ...state, status: 'error', error: '已有媒体结果，请查询处理状态' };
      return state.file ? { ...state, status: 'uploading', progress: 0, error: null } : state;
    case 'clear':
      return createMediaUploadState();
    default:
      return state;
  }
}

export function nextMediaUploadAction(state: MediaUploadState): 'upload' | 'poll' | 'none' {
  if (state.assetId) return 'poll';
  if (state.file) return 'upload';
  return 'none';
}
