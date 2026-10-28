import { ApiError, request } from './client'
import { useSessionStore } from '@/stores/session'
import type { PickedMedia } from '@/platform/media-picker'
import { safeMediaUrl } from '@/platform/media-url'
import { resolveApiUrl } from '@/platform/api-url'
export { safeMediaUrl } from '@/platform/media-url'

export interface MediaTicketView { content_url: string; expires_at: string }
export interface MediaTicketRequest { asset_id: string; owner_type: string; owner_id: string }
export interface MediaBatchResult extends MediaTicketRequest { index: number; ticket: MediaTicketView | null; error: { code: number; message: string } | null }
export async function getMediaTickets(items: MediaTicketRequest[]): Promise<MediaBatchResult[]> {
  if (!Array.isArray(items) || items.length > 50 || items.some(item => !item || !/^[1-9]\d{0,19}$/.test(item.asset_id)
    || !/^[1-9]\d{0,19}$/.test(item.owner_id) || typeof item.owner_type !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(item.owner_type))) throw new ApiError(40001, '媒体批量请求无效')
  if (!items.length) return []
  const results = await request<MediaBatchResult[]>({ url: '/media/tickets/batch', method: 'POST', data: { items } })
  if (!Array.isArray(results) || results.length !== items.length) throw new ApiError(-2, '媒体批量响应无效')
  return results.map((result, index) => {
    const item = items[index]
    if (!result || result.index !== index || result.asset_id !== item.asset_id || result.owner_type !== item.owner_type || result.owner_id !== item.owner_id) throw new ApiError(-2, '媒体批量响应归属无效')
    if (result.ticket) {
      if (result.error !== null || typeof result.ticket.expires_at !== 'string' || !Number.isFinite(Date.parse(result.ticket.expires_at))) throw new ApiError(-2, '媒体批量响应无效')
      safeMediaUrl(result.ticket.content_url)
    } else if (!result.error || !Number.isInteger(result.error.code) || typeof result.error.message !== 'string') throw new ApiError(-2, '媒体批量响应无效')
    return result
  })
}
export interface MediaLimits {
  upload_mode?: 'proxy' | 'direct'; image_max_bytes: number; allowed_image_types: string[]
}
export function getMediaLimits(): Promise<MediaLimits> { return request<MediaLimits>({ url: '/media/limits' }) }
export async function getMediaTicket(assetId: string, ownerType: string, ownerId: string): Promise<MediaTicketView> {
  const ticket = await request<MediaTicketView>({ url: `/media/${encodeURIComponent(assetId)}/tickets`, method: 'POST', data: { owner_type: ownerType, owner_id: ownerId } })
  safeMediaUrl(ticket.content_url)
  return ticket
}
/** Upload transport shares the session epoch and one-refresh rule with JSON requests. */
export async function uploadMedia<T>(url: string, file: PickedMedia, formData: Record<string, string>): Promise<T> {
  const uploadUrl = resolveApiUrl(url)
  const session = useSessionStore(), epoch = session.sessionEpoch
  function same() { if (epoch !== session.sessionEpoch || session.isLoggingIn) throw new ApiError(40107, '登录会话已切换，请重新操作') }
  async function send(replayed: boolean): Promise<T> {
    same(); const token = session.accessToken
    const result = await new Promise<UniApp.UploadFileSuccessCallbackResult>((resolve, reject) => uni.uploadFile({
      url: uploadUrl, filePath: file.tempFilePath, name: 'file', formData,
      header: token ? { Authorization: `Bearer ${token}` } : {}, timeout: 30000,
      success: resolve, fail: () => reject(new ApiError(-1, '网络连接失败，请重试上传')),
    }))
    same()
    if (result.statusCode === 401) {
      if (!replayed) { if (session.accessToken === token) await session.refreshAccessTokenOnce(); same(); return send(true) }
      session.expireSession()
    }
    let envelope: { code: number; message: string; data: T }
    try { envelope = typeof result.data === 'string' ? JSON.parse(result.data) : result.data } catch { throw new ApiError(-2, '服务器响应异常，请重试') }
    if (!envelope || typeof envelope.code !== 'number' || typeof envelope.message !== 'string' || !('data' in envelope)) throw new ApiError(-2, '服务器响应异常，请重试')
    if (envelope.code !== 0 || result.statusCode < 200 || result.statusCode >= 300) throw new ApiError(envelope.code || result.statusCode, envelope.message, envelope.data, result.statusCode)
    return envelope.data
  }
  return send(false)
}
export async function uploadAvatar(file: PickedMedia): Promise<{ asset_id: string; status: string; duration_ms: number | null }> {
  const session = useSessionStore(), epoch = session.sessionEpoch
  function same() { if (epoch !== session.sessionEpoch || session.isLoggingIn) throw new ApiError(40107, '登录会话已切换，请重新操作') }
  same()
  // #ifdef H5
  if (typeof window !== 'undefined') {
    const limits = await getMediaLimits()
    const direct = limits.upload_mode === 'direct'
    same()
    if (direct) {
      const { uploadImageDirect, DirectUploadNetworkError } = await import('@/platform/media-upload.h5')
      same()
      try {
        const result = await uploadImageDirect(file, 'avatar', limits)
        same()
        return result
      } catch (error) {
        same()
        if (!(error instanceof DirectUploadNetworkError)) throw error
        // The direct uploader aborts its unused staging session. The proxy still
        // enforces authentication, media probing and private COS publication.
      }
    }
  }
  // #endif
  same()
  return uploadMedia('/media/upload', file, { purpose: 'avatar' })
}
