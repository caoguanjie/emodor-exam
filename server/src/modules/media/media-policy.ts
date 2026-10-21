import { Errors } from '../../common/errors';

export const MEDIA_PURPOSES = ['avatar', 'course_cover', 'video', 'question', 'branding'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];
export type MediaKind = 'image' | 'video';
export const DEFAULT_MEDIA_IMAGE_MAX_PIXELS = 25_000_000;

export const DEFAULT_MEDIA_LIMITS = Object.freeze({
  videoMaxBytes: 512 * 1024 * 1024,
  imageMaxBytes: 10 * 1024 * 1024,
  imageMaxPixels: DEFAULT_MEDIA_IMAGE_MAX_PIXELS,
  probeTimeoutMs: 30_000,
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  allowedVideoTypes: ['video/mp4'] as const,
});

export type MediaLimits = {
  videoMaxBytes: number;
  imageMaxBytes: number;
  imageMaxPixels: number;
  probeTimeoutMs: number;
  allowedImageTypes: readonly string[];
  allowedVideoTypes: readonly string[];
};

export function assertMediaPurpose(value: unknown): asserts value is MediaPurpose {
  if (typeof value !== 'string' || !MEDIA_PURPOSES.includes(value as MediaPurpose)) {
    throw Errors.param('媒体用途不支持；answer 必须由考试答案专用接口包装');
  }
}

export function mediaKindForPurpose(purpose: MediaPurpose): MediaKind {
  return purpose === 'video' ? 'video' : 'image';
}

export function assertMediaSize(kind: MediaKind, size: number, limits: MediaLimits = DEFAULT_MEDIA_LIMITS): void {
  const max = kind === 'video' ? limits.videoMaxBytes : limits.imageMaxBytes;
  if (!Number.isFinite(size) || size < 0 || size > max) throw Errors.fileTooLarge();
}

export function assertOwnerTypeRegistered(
  authorizers: Map<string, unknown> | undefined,
  ownerType: string,
): void {
  if (!authorizers?.has(ownerType)) throw Errors.forbidden('媒体业务归属类型未注册');
}

export type ByteRange = { start: number; end: number };

/** Parse a single RFC 7233 byte range. The caller maps an invalid range to 416. */
export function parseRange(value: string | undefined, size: number): ByteRange | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) throw new RangeError('invalid byte range');
  const [, startText, endText] = match;
  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) throw new RangeError('invalid byte range');
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
      throw new RangeError('invalid byte range');
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}
