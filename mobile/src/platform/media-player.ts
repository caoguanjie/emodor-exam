import type { VideoPlaybackState } from '@/api/video'
export { mediaContentUrl, resolveMediaUrl as nativeVideoUrl } from './media-url'

export type MediaPlayerState =
  | 'idle'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'background'
  | 'ended'
  | 'error'

/** Native player events are normalized here before reaching learning logic. */
export interface MediaPlayerSnapshot {
  state: MediaPlayerState
  positionMs: number
  durationMs?: number
  /** Sanitized public error only; never include media URLs or credentials. */
  error?: { code?: string; message?: string }
}

export interface MediaPlayerAdapter {
  play(): void
  pause(): void
  seek(positionMs: number): void
  subscribe(listener: (snapshot: MediaPlayerSnapshot) => void): () => void
}
export type NativeVideoEvent = 'play' | 'pause' | 'waiting' | 'ended' | 'error' | 'app-hide'
export function toHeartbeat(event: NativeVideoEvent, positionMs: number): { state: VideoPlaybackState; position_ms: number } {
  const states: Record<NativeVideoEvent, VideoPlaybackState> = { play: 'playing', pause: 'paused', waiting: 'buffering', ended: 'ended', error: 'paused', 'app-hide': 'background' }
  return { state: states[event], position_ms: Math.max(0, Math.round(positionMs)) }
}
export function observeMediaVisibility(listener: (visible: boolean) => void): () => void {
  // #ifdef H5
  if (typeof document !== 'undefined') {
    const changed = () => listener(!document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }
  // #endif
  return () => {}
}
