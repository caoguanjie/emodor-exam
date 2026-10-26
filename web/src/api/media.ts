import http from './http';
import type { MediaLimits, MediaPurpose } from '../components/media-upload-state';

export type { MediaPurpose };
export type MediaUploadPurpose = MediaPurpose;

export type MediaStatus = 'processing' | 'ready' | 'failed';

export interface MediaUploadResponse {
  asset_id: string;
  status: MediaStatus;
  duration_ms: number | null;
}

export interface MediaMetadata {
  asset_id: string;
  purpose: MediaPurpose;
  media_kind: 'image' | 'video';
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: MediaStatus;
  duration_ms: number | null;
  probe_error: string | null;
  created_at: string;
}

export interface MediaUploadOptions {
  ownerId?: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export type UploadState = 'uploading' | 'finalizing' | 'completed' | 'failed' | 'aborted' | 'expired';
export interface UploadSessionView {
  session_id: string; state: UploadState; mode: 'simple' | 'multipart'; expires_at: string;
  part_size: number; parallel_limit: number;
  parts: Array<{ partNumber: number; etag: string; sizeBytes: number }>;
  result: MediaUploadResponse | null; reason_code: string | null;
}
export interface UploadInit {
  client_request_id: string; purpose: MediaPurpose; owner_id?: string;
  filename: string; mime_type: string; size_bytes: number; fingerprint_sha256: string;
}
export type UploadGrant =
  | { mode: 'simple'; method: 'PUT'; url: string; headers: Record<string, string>; expires_at: string }
  | { mode: 'multipart'; bucket: string; region: string; key: string; upload_id: string;
      credentials: { tmp_secret_id: string; tmp_secret_key: string; token: string }; start_time: number; expired_time: number };
export type MediaTicketView = { content_url: string; expires_at: string };

export { createMediaUploadTask } from '../services/media-upload';
export async function beginMediaUpload(input: UploadInit, signal?: AbortSignal): Promise<UploadSessionView> {
  return await http.post('/media/upload-sessions', input, { signal }) as UploadSessionView;
}
export async function getMediaUploadSession(id: string, signal?: AbortSignal): Promise<UploadSessionView> {
  return await http.get(`/media/upload-sessions/${encodeURIComponent(id)}`, { signal }) as UploadSessionView;
}
export async function getMediaUploadGrant(id: string, signal?: AbortSignal): Promise<UploadGrant> {
  return await http.post(`/media/upload-sessions/${encodeURIComponent(id)}/credentials`, undefined, { signal }) as UploadGrant;
}
export async function completeMediaUpload(id: string, signal?: AbortSignal): Promise<UploadSessionView> {
  return await http.post(`/media/upload-sessions/${encodeURIComponent(id)}/complete`, undefined, { signal }) as UploadSessionView;
}
export async function cancelMediaUpload(id: string): Promise<UploadSessionView> {
  return await http.delete(`/media/upload-sessions/${encodeURIComponent(id)}`) as UploadSessionView;
}
export async function getPcMediaTicket(assetId: string, signal?: AbortSignal): Promise<MediaTicketView> {
  return await http.post(mediaPath(assetId, '/preview-ticket'), undefined, { signal }) as MediaTicketView;
}

function mediaPath(assetId: string, suffix = ''): string {
  return `/media/${encodeURIComponent(assetId)}${suffix}`;
}

export async function getMediaLimits(): Promise<MediaLimits> {
  return await http.get('/media/limits') as MediaLimits;
}

export async function uploadMedia(
  file: File,
  purpose: MediaPurpose,
  options: MediaUploadOptions = {},
): Promise<MediaUploadResponse> {
  const { createMediaUploadTask } = await import('../services/media-upload');
  return createMediaUploadTask(file, purpose, options).result;
}

/** Compatibility transport for local mode and the controlled proxy endpoint. */
export async function uploadMediaProxy(
  file: File,
  purpose: MediaPurpose,
  options: MediaUploadOptions = {},
): Promise<MediaUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('purpose', purpose);
  if (options.ownerId) form.append('owner_id', options.ownerId);

  return await http.post('/media/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // Large legal video files may legitimately take longer than the ordinary
    // 60s API timeout. AbortController remains the explicit user cancellation
    // path (the component's clear action aborts this request).
    timeout: 0,
    signal: options.signal,
    onUploadProgress: (event) => {
      const total = event.total || file.size;
      if (total > 0) options.onProgress?.(Math.round((event.loaded / total) * 100));
    },
  }) as MediaUploadResponse;
}

export async function getMediaMetadata(assetId: string): Promise<MediaMetadata> {
  return await http.get(mediaPath(assetId)) as MediaMetadata;
}

/** Fetch image bytes through the authenticated content policy for a preview. */
export async function getMediaImageContent(assetId: string): Promise<Blob> {
  const response: any = await http.get(mediaPath(assetId, '/content'), { responseType: 'blob' });
  const blob = typeof Blob !== 'undefined' && response instanceof Blob ? response : response?.data;
  if (!(typeof Blob !== 'undefined' && blob instanceof Blob)) throw new Error('图片预览响应不是文件流');
  return blob;
}

/** Authoring preview only: use the existing authenticated content policy, never a JWT URL. */
export async function getMediaVideoContent(assetId: string, options: { signal?: AbortSignal } = {}): Promise<Blob> {
  const response: any = await http.get(mediaPath(assetId, '/content'), {
    responseType: 'blob', timeout: 0, signal: options.signal,
  });
  const blob = typeof Blob !== 'undefined' && response instanceof Blob ? response : response?.data;
  if (!(typeof Blob !== 'undefined' && blob instanceof Blob) || blob.type !== 'video/mp4') {
    throw new Error('视频预览响应不是 MP4 文件流');
  }
  return blob;
}
