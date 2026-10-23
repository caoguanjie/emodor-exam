import { ApiError, request } from './client'
import { useSessionStore } from '@/stores/session'
import type { PickedMedia } from '@/platform/media-picker'
import { safeMediaUrl } from '@/platform/media-url'
export { safeMediaUrl } from '@/platform/media-url'

export interface MediaTicketView { content_url: string; expires_at: string }
export async function getMediaTicket(assetId: string, ownerType: string, ownerId: string): Promise<MediaTicketView> {
  const ticket = await request<MediaTicketView>({ url: `/media/${encodeURIComponent(assetId)}/tickets`, method: 'POST', data: { owner_type: ownerType, owner_id: ownerId } })
  safeMediaUrl(ticket.content_url)
  return ticket
}
/** Upload transport shares the session epoch and one-refresh rule with JSON requests. */
export async function uploadMedia<T>(url: string, file: PickedMedia, formData: Record<string, string>): Promise<T> {
  const session = useSessionStore(), epoch = session.sessionEpoch
  function same() { if (epoch !== session.sessionEpoch || session.isLoggingIn) throw new ApiError(40107, '登录会话已切换，请重新操作') }
  async function send(replayed: boolean): Promise<T> {
    same(); const token = session.accessToken
    const result = await new Promise<UniApp.UploadFileSuccessCallbackResult>((resolve, reject) => uni.uploadFile({
      url: `/api/v1${url}`, filePath: file.tempFilePath, name: 'file', formData,
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
export function uploadAvatar(file: PickedMedia): Promise<{ asset_id: string; status: string; duration_ms: number | null }> { return uploadMedia('/media/upload', file, { purpose: 'avatar' }) }
