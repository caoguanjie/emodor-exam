import type { MediaTicketView } from '../api/media';
import { getPcMediaTicket } from '../api/media';
import { isMediaContextCurrent, mediaContext, onMediaContextChange } from './media-context';
import { assertCosMediaUrl } from './cos-media-url';

const tickets = new Map<string, MediaTicketView>();
onMediaContextChange(() => tickets.clear());

export function assertControlledMediaUrl(value: string): string {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\x00-\x1f\x7f\\]/.test(value)) throw new Error('媒体地址无效');
  const url = new URL(value, 'https://same-origin.invalid');
  if (!url.username && !url.password && !url.search && !url.hash
    && /^\/api\/v1\/media\/preview-tickets\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\/content$/.test(url.pathname)) {
    const current = typeof location !== 'undefined' && location.protocol === 'https:' ? location.origin : '';
    if (value === url.pathname || (current && value === `${current}${url.pathname}`)) return value;
  }
  return assertCosMediaUrl(value, import.meta.env.VITE_COS_MEDIA_ORIGIN || '', import.meta.env.VITE_COS_MEDIA_PREFIX || '');
}

export async function resolvePcMedia(assetId: string, signal?: AbortSignal): Promise<MediaTicketView> {
  if (!/^[1-9]\d{0,19}$/.test(assetId)) throw new Error('媒体标识无效');
  const context = mediaContext();
  const key = `${context.userId}:${context.epoch}:preview:${assetId}`;
  if (signal?.aborted) throw new DOMException('媒体请求已停止', 'AbortError');
  const cached = tickets.get(key);
  if (cached && Date.parse(cached.expires_at) > Date.now() + 10000) return { ...cached };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const unsubscribe = onMediaContextChange(abort);
  try {
    const ticket = await getPcMediaTicket(assetId, controller.signal);
    if (!isMediaContextCurrent(context) || controller.signal.aborted) throw new DOMException('媒体请求已停止', 'AbortError');
    const content_url = assertControlledMediaUrl(ticket.content_url);
    if (!Number.isFinite(Date.parse(ticket.expires_at)) || Date.parse(ticket.expires_at) <= Date.now()) throw new Error('媒体地址已过期');
    const safe = { content_url, expires_at: ticket.expires_at };
    tickets.set(key, safe);
    return { ...safe };
  } finally { signal?.removeEventListener('abort', abort); unsubscribe(); }
}

export async function resolvePcMediaSource(assetId: string): Promise<string> {
  return (await resolvePcMedia(assetId)).content_url;
}

export function resolvePublicBranding(assetId: string | null | undefined): string {
  if (assetId === null || assetId === undefined || assetId === '') return '';
  if (!/^[1-9]\d{0,19}$/.test(assetId)) throw new Error('品牌媒体标识无效');
  return `/api/v1/site-config/assets/${assetId}/content`;
}

/** An image load failure invalidates an otherwise unexpired cached ticket. */
export function invalidatePcMedia(assetId: string): void {
  const context = mediaContext();
  tickets.delete(`${context.userId}:${context.epoch}:preview:${assetId}`);
}
