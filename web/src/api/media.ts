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
