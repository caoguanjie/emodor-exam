import type { PickedMedia } from './media-picker'
import { watch } from 'vue'
import { ApiError, request } from '@/api/client'
import { getMediaLimits } from '@/api/media'
import { useSessionStore } from '@/stores/session'
export interface DirectImageLimits { upload_mode?: 'direct' | 'proxy'; image_max_bytes: number; allowed_image_types: string[] }
export interface UploadResult { asset_id: string; status: 'ready'; duration_ms: number | null }
interface SessionView { session_id: string; mode: 'simple' | 'multipart'; state: string; result: UploadResult | null }
interface SimpleGrant { mode: 'simple'; method: 'PUT'; url: string; headers: Record<string, string>; expires_at: string }

/** Only a storage PUT network failure can be retried through the controlled API. */
export class DirectUploadNetworkError extends ApiError {
  constructor() { super(-1, '照片直传网络连接失败') }
}

export async function uploadImageDirect(file: PickedMedia, purpose: 'avatar', providedLimits?: DirectImageLimits): Promise<UploadResult> {
  const session = useSessionStore(), epoch = session.sessionEpoch, controller = new AbortController()
  const stop = watch(() => session.sessionEpoch, () => controller.abort(), { flush: 'sync' })
  let sessionId = '', completing = false, finished = false
  const same = () => { if (epoch !== session.sessionEpoch || session.isLoggingIn || !session.accessToken) throw new ApiError(40107, '登录会话已切换，请重新操作') }
  const check = (value: SessionView) => {
    if (!value || typeof value.session_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.session_id) || (sessionId && value.session_id !== sessionId)) throw new ApiError(-2, '上传会话响应无效')
    return value
  }
  const url = (suffix = '') => `/media/upload-sessions/${encodeURIComponent(sessionId)}${suffix}`
  const status = async () => { same(); const value = check(await request<SessionView>({ url: url() })); same(); return value }
  try {
    same()
    if (purpose !== 'avatar' || typeof window === 'undefined') throw new ApiError(40001, '当前用途不支持图片直传')
    let picked: URL
    try { picked = new URL(file.tempFilePath) } catch { throw new ApiError(40001, '请选择本次上传的本地照片') }
    if (picked.protocol !== 'blob:' || picked.origin !== window.location.origin || picked.href !== file.tempFilePath) throw new ApiError(40001, '请选择本次上传的本地照片')
    const limits = providedLimits || await getMediaLimits(); same()
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > Math.min(10485760, limits.image_max_bytes)) throw new ApiError(40001, '照片超过上传大小限制')
    const source = await fetch(file.tempFilePath, { credentials: 'omit', redirect: 'error', signal: controller.signal }); same()
    if (!source.ok) throw new ApiError(-2, '无法读取本次选择的照片')
    const blob = await source.blob(); same()
    if (blob.size !== file.size || blob.size <= 0 || blob.size > Math.min(10485760, limits.image_max_bytes)
      || !limits.allowed_image_types.includes(blob.type) || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new ApiError(40001, '照片内容或类型无效，请重新选择')
    if (!globalThis.crypto?.subtle || typeof crypto.randomUUID !== 'function') throw new ApiError(-2, '当前浏览器需要在安全连接下上传照片')
    const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join(''); same()
    const body = { client_request_id: crypto.randomUUID(), purpose, filename: `avatar.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`, mime_type: blob.type, size_bytes: blob.size, fingerprint_sha256: fingerprint }
    let view = check(await request<SessionView>({ url: '/media/upload-sessions', method: 'POST', data: body })); same()
    sessionId = view.session_id
    if (view.mode !== 'simple') throw new ApiError(-2, '当前图片上传模式不可用，请稍后重试')
    if (view.state === 'uploading') {
      for (let attempt = 0; ; attempt++) {
        same()
        const grant = await request<SimpleGrant>({ url: url('/credentials'), method: 'POST' }); same()
        let destination: URL
        try { destination = new URL(grant.url) } catch { throw new ApiError(-2, '上传授权地址无效') }
        if (grant.mode !== 'simple' || grant.method !== 'PUT' || destination.protocol !== 'https:' || destination.username || destination.password || destination.hash
          || !grant.headers || typeof grant.headers !== 'object' || Object.entries(grant.headers).some(([key, value]) => /^cookie$/i.test(key) || (/^authorization$/i.test(key) && /^bearer\s/i.test(value)))) throw new ApiError(-2, '上传授权响应无效')
        let put: Response
        try {
          put = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body: blob, credentials: 'omit', redirect: 'error', signal: controller.signal })
        } catch (error) {
          same()
          // CORS rejection is exposed as TypeError. Abort and business/API errors
          // must not create a second upload, especially after switching accounts.
          if (!controller.signal.aborted && error instanceof TypeError) throw new DirectUploadNetworkError()
          throw error
        }
        same()
        if (put.status === 0) throw new DirectUploadNetworkError()
        if (put.ok) break
        if (attempt === 0 && [401, 403].includes(put.status)) continue
        throw new ApiError(-1, '照片直传失败，请稍后重试')
      }
      completing = true
      try { view = check(await request<SessionView>({ url: url('/complete'), method: 'POST' })); same() }
      catch (error) {
        same()
        if (!(error instanceof ApiError) || (error.code !== -1 && error.status < 500)) throw error
        view = await status()
        if (view.state === 'uploading') { view = check(await request<SessionView>({ url: url('/complete'), method: 'POST' })); same() }
      }
    }
    for (let count = 0; ['uploading', 'finalizing'].includes(view.state) && count < 120; count++) {
      view = await status()
      if (['uploading', 'finalizing'].includes(view.state)) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new ApiError(40107, '登录会话已切换，请重新操作')) }
        const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve() }, 1000)
        controller.signal.addEventListener('abort', abort, { once: true })
        if (controller.signal.aborted) abort()
      })
      same()
    }
    if (view.state !== 'completed' || !view.result || view.result.status !== 'ready' || !/^[1-9]\d{0,19}$/.test(view.result.asset_id)) throw new ApiError(-2, view.state === 'finalizing' ? '照片仍在处理中，请稍后重试' : '照片处理失败，请重新选择')
    same(); finished = true; return view.result
  } catch (error) {
    same()
    if (error instanceof ApiError) throw error
    throw new ApiError(-1, '照片上传失败，请检查网络后重试')
  } finally {
    stop(); controller.abort()
    // Do not send an old subject's cleanup using a replacement account's token.
    if (sessionId && !finished && !completing && epoch === session.sessionEpoch && !session.isLoggingIn && session.accessToken) {
      void request({ url: url(), method: 'DELETE' }).catch(() => {})
    }
  }
}
