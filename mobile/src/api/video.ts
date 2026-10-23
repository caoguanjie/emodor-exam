import { ApiError, request } from './client'
import { safeMediaUrl, type MediaTicketView } from './media'

export type VideoPlaybackState = 'playing' | 'paused' | 'buffering' | 'background' | 'ended'
export interface VideoProgress { confirmed_position_ms: number; credited_ms: number; coverage_ms: number; duration_ms: number; completed: boolean; last_seq: number }
export interface VideoSessionView {
  session_id: string
  version_id: string
  heartbeat_interval_ms: 30000
  media: { asset_id: string; ticket: MediaTicketView }
  progress: VideoProgress
}
export interface VideoHeartbeat { seq: number; position_ms: number; state: VideoPlaybackState }
export async function startVideoSession(lessonId: string): Promise<VideoSessionView> {
  const view = await request<VideoSessionView>({ url: '/me/video-sessions', method: 'POST', data: { lesson_id: lessonId } })
  const positiveId = (id: unknown): id is string => typeof id === 'string' && /^[1-9]\d*$/.test(id)
  if (!view || !positiveId(view.session_id) || !positiveId(view.version_id) || !positiveId(view.media?.asset_id) || view.heartbeat_interval_ms !== 30000 || !view.progress || !Number.isFinite(view.progress.confirmed_position_ms) || !Number.isSafeInteger(view.progress.last_seq) || view.progress.duration_ms <= 0) throw new ApiError(-2, '视频会话响应异常，请重试')
  safeMediaUrl(view.media.ticket.content_url)
  return view
}
export function heartbeatVideoSession(sessionId: string, data: VideoHeartbeat): Promise<VideoProgress> { return request({ url: `/me/video-sessions/${encodeURIComponent(sessionId)}/heartbeat`, method: 'POST', data }) }
export function closeVideoSession(sessionId: string): Promise<VideoProgress> { return request({ url: `/me/video-sessions/${encodeURIComponent(sessionId)}/close`, method: 'POST' }) }
