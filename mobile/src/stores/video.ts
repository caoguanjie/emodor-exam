import { reactive } from 'vue'
import { ApiError } from '@/api/client'
import { getMediaTicket, type MediaTicketView } from '@/api/media'
import { closeVideoSession, heartbeatVideoSession, startVideoSession, type VideoPlaybackState, type VideoProgress, type VideoSessionView } from '@/api/video'
import { toHeartbeat, type NativeVideoEvent, type NativeVideoFailure } from '@/platform/media-player'
import { mediaTicketNextSignatureDelay, mediaTicketRenewalDelay, mediaTicketRetryDelay } from '@/platform/media-ticket-timing'

interface VideoClientOptions {
  controls: { play(): void; pause(): void; seek(positionMs: number): void }
  getEpoch(): number
  refreshProgress(courseId: string): Promise<unknown>
  acceptProgress?(courseId: string, lessonId: string, versionId: string, progress: VideoProgress): void
  resolveUrl(url: string): string
}
type Status = 'idle' | 'starting' | 'ready' | 'playing' | 'paused' | 'buffering' | 'background' | 'ended' | 'error' | 'stopped'
interface ActiveSession {
  view: VideoSessionView
  revision: number
  epoch: number
  courseId: string
  lessonId: string
  nextSeq: number
  pendingStates: VideoPlaybackState[]
  heartbeatFlight: Promise<void> | null
  completionRefreshed: boolean
  ticketExpiresAt: number
  ticketFlight: Promise<void> | null
  networkRecoveries: number
  recovering: boolean
  recoverySource: string
}

/** One client belongs to one player page; no learning proof is persisted locally. */
export function createVideoSessionClient(options: VideoClientOptions) {
  const state = reactive({ status: 'idle' as Status, src: '', sessionId: '', courseId: '', lessonId: '', positionMs: 0, progress: null as VideoProgress | null, error: '', identityReason: '' })
  let revision = 0, disposed = false, active: ActiveSession | null = null
  let intent = false, foreground = true, restoring = false
  let furthestPosition = 0, playingSince = Date.now(), playingFrom = 0, windowFurthest = 0, bufferingPosition = 0
  let lifecycleTail: Promise<void> = Promise.resolve()
  let clickNumber = 0, minimumClick = 0
  let beatTimer: ReturnType<typeof setInterval> | undefined, ticketTimer: ReturnType<typeof setTimeout> | undefined
  let cancelTicketWait: (() => void) | undefined

  function current(handle: ActiveSession) { return !disposed && handle === active && handle.revision === revision && handle.epoch === options.getEpoch() }
  function clearBeat() { if (beatTimer) clearInterval(beatTimer); beatTimer = undefined }
  function clearTicket() { if (ticketTimer) clearTimeout(ticketTimer); ticketTimer = undefined; cancelTicketWait?.(); cancelTicketWait = undefined }
  function pausePlayer() { options.controls.pause() }
  function reset() {
    clearBeat(); clearTicket(); intent = false; restoring = false
    state.src = ''; state.sessionId = ''; state.positionMs = 0; state.progress = null; state.error = ''; state.identityReason = ''; state.status = 'idle'
  }
  function enqueue(operation: () => Promise<void>): Promise<void> {
    const result = lifecycleTail.then(operation)
    lifecycleTail = result.catch(() => {})
    return result
  }
  async function refresh(courseId: string) { try { await options.refreshProgress(courseId) } catch { /* Existing authority remains visible; no optimistic completion. */ } }
  function unknownResult() {
    minimumClick = clickNumber + 1
    if (disposed) return
    clearBeat(); clearTicket(); state.status = 'stopped'; state.src = ''; state.sessionId = ''; intent = false
    state.error = '播放请求结果暂未确认，请检查网络后再次点击播放'
  }
  async function close(handle: ActiveSession) {
    if (handle.heartbeatFlight) await handle.heartbeatFlight
    // Never send an old user's close request with the next user's credentials.
    if (handle.epoch !== options.getEpoch()) return
    try { await closeVideoSession(handle.view.session_id) }
    catch (error) { if (!(error instanceof ApiError && [40950, 40951].includes(error.code))) unknownResult() }
  }
  function select(target: { courseId: string; lessonId: string }) {
    if (disposed) return
    const previous = active
    revision++; active = null; pausePlayer(); reset()
    state.courseId = target.courseId; state.lessonId = target.lessonId
    if (previous) void enqueue(() => close(previous))
  }
  async function stop(handle: ActiveSession, error: unknown) {
    if (!current(handle)) return
    clearBeat(); clearTicket(); handle.pendingStates = []; intent = false; pausePlayer()
    state.src = ''; state.sessionId = ''; state.status = 'stopped'; active = null
    state.error = error instanceof Error ? error.message : '课程已不可播放，请刷新后重试'
    // Progress reading is independent of the heartbeat HTTP lock. A slow refresh
    // must not retain an old session's queue and swallow the next session's play.
    void refresh(handle.courseId)
  }
  function identityError(error: unknown): boolean {
    const reason = error instanceof ApiError && error.code === 40302 && error.data && typeof error.data === 'object' ? (error.data as { reason_code?: string }).reason_code : undefined
    if (reason !== 'IDENTITY_REQUIRED' && reason !== 'IDENTITY_PENDING') return false
    state.identityReason = reason
    state.error = reason === 'IDENTITY_PENDING' ? '实名认证正在处理中，请稍后查看' : '完成实名认证后即可学习视频课程'
    return true
  }
  async function handleFailure(handle: ActiveSession, error: unknown) {
    if (!current(handle)) return
    if (error instanceof ApiError && [40950, 40951].includes(error.code)) { await stop(handle, error); return }
    if (identityError(error)) {
      const message = state.error, reason = state.identityReason
      await stop(handle, error)
      if (!disposed && handle.revision === revision && handle.epoch === options.getEpoch()) { state.error = message; state.identityReason = reason }
    }
    // A transient failure is not retried or kept in an offline queue.
  }
  function displayTicket(handle: ActiveSession, ticket: MediaTicketView) {
    const remaining = Date.parse(ticket.expires_at) - Date.now()
    if (!Number.isFinite(remaining) || remaining <= 0) throw new ApiError(-2, '视频播放地址已过期，请重试')
    const src = options.resolveUrl(ticket.content_url)
    // 同 URL 不会产生 loadedmetadata，不能重新进入等待恢复位置的状态。
    if (src === state.src) return false
    handle.ticketExpiresAt = Date.parse(ticket.expires_at); restoring = true; state.src = src
    clearTicket()
    ticketTimer = setTimeout(() => { if (current(handle)) void renewTicket(handle) }, mediaTicketRenewalDelay(handle.ticketExpiresAt))
    return true
  }
  async function failPlayback(handle: ActiveSession, message = '视频加载失败，请重试') {
    if (!current(handle)) return
    intent = false; restoring = false; handle.recovering = false
    state.status = 'error'; state.error = message; clearBeat(); clearTicket(); pausePlayer()
    await report(handle, 'paused')
  }
  function waitForTicketRetry(delay: number): Promise<boolean> {
    return new Promise(resolve => {
      ticketTimer = setTimeout(() => { ticketTimer = undefined; cancelTicketWait = undefined; resolve(true) }, delay)
      cancelTicketWait = () => resolve(false)
    })
  }
  function renewTicket(handle: ActiveSession): Promise<void> {
    const renewable = () => current(handle) && !['ended', 'error', 'stopped'].includes(state.status)
    if (!renewable()) return Promise.resolve()
    if (handle.ticketFlight) return handle.ticketFlight
    clearTicket()
    const pending = (async () => {
      let networkRetries = 0, duplicateRetries = 0
      while (renewable()) {
        try {
          const ticket = await getMediaTicket(handle.view.media.asset_id, 'lesson_version_video', handle.view.version_id)
          if (!renewable()) return
          if (displayTicket(handle, ticket)) return
          if (duplicateRetries++ >= 1) { await failPlayback(handle, '播放地址未更新，请重试'); return }
          if (!await waitForTicketRetry(mediaTicketNextSignatureDelay())) return
        } catch (error) {
          if (!renewable()) return
          if (networkRetries++ === 0 && error instanceof ApiError && (error.code === -1 || error.status >= 500)) {
            const retry = await waitForTicketRetry(mediaTicketRetryDelay(handle.ticketExpiresAt))
            if (retry) continue
            return
          }
          await handleFailure(handle, error)
          if (current(handle)) await failPlayback(handle)
          return
        }
      }
    })().finally(() => { if (handle.ticketFlight === pending) handle.ticketFlight = null })
    handle.ticketFlight = pending
    return pending
  }
  function startBeat(handle: ActiveSession) {
    clearBeat()
    beatTimer = setInterval(() => { if (current(handle) && state.status === 'playing' && !handle.heartbeatFlight) void report(handle, 'playing') }, handle.view.heartbeat_interval_ms)
  }
  function report(handle: ActiveSession, playback: VideoPlaybackState): Promise<void> {
    if (!current(handle)) return Promise.resolve()
    // At most one non-playing boundary plus its following play is retained while
    // an HTTP request settles. Timer ticks never enqueue historical samples.
    if (playback === 'playing') {
      const boundary = handle.pendingStates.find(item => item !== 'playing')
      handle.pendingStates = boundary ? [boundary, 'playing'] : ['playing']
    } else handle.pendingStates = [playback]
    if (handle.heartbeatFlight) return handle.heartbeatFlight
    const drain = async () => {
      while (current(handle) && handle.pendingStates.length) {
        const stateToSend = handle.pendingStates.shift()!
        try {
          const result = await heartbeatVideoSession(handle.view.session_id, { seq: ++handle.nextSeq, position_ms: state.positionMs, state: stateToSend })
          if (current(handle)) {
            state.progress = result; options.acceptProgress?.(handle.courseId, handle.lessonId, handle.view.version_id, result)
            if (result.completed && !handle.completionRefreshed) { handle.completionRefreshed = true; void refresh(handle.courseId) }
          }
        } catch (error) { handle.pendingStates = []; await handleFailure(handle, error); break }
      }
    }
    const pending = drain().finally(() => { if (handle.heartbeatFlight === pending) handle.heartbeatFlight = null })
    handle.heartbeatFlight = pending
    return pending
  }
  function ready() {
    if (!active || !current(active) || !restoring) return
    restoring = false; active.recovering = false; options.controls.seek(state.positionMs)
    if (intent && foreground) options.controls.play()
  }
  function play(): Promise<void> {
    if (disposed || !foreground || state.status === 'starting') return Promise.resolve()
    if (active && current(active) && !['error', 'ended', 'stopped'].includes(state.status)) {
      intent = true; state.error = ''; if (!active.recovering) options.controls.play(); return Promise.resolve()
    }
    const replayFromStart = state.status === 'ended'
    const clicked = ++clickNumber, startedRevision = ++revision, epoch = options.getEpoch()
    const lessonId = state.lessonId, courseId = state.courseId, previous = active
    active = null; reset(); intent = true; state.status = 'starting'
    return enqueue(async () => {
      if (previous) await close(previous)
      if (disposed || startedRevision !== revision || epoch !== options.getEpoch()) return
      if (clicked < minimumClick) { state.status = 'stopped'; intent = false; return }
      if (!/^[1-9]\d*$/.test(lessonId) || !/^[1-9]\d*$/.test(courseId)) { state.status = 'error'; state.error = '未找到课程课时'; return }
      let result: VideoSessionView
      try { result = await startVideoSession(lessonId) }
      catch (error) {
        if (error instanceof ApiError && error.code === -1) { unknownResult(); return }
        if (disposed || startedRevision !== revision || epoch !== options.getEpoch()) return
        state.status = 'error'; intent = false
        if (!identityError(error)) state.error = error instanceof Error ? error.message : '视频加载失败，请重试'
        if (error instanceof ApiError && [40950, 40951].includes(error.code)) { state.status = 'stopped'; await refresh(courseId) }
        return
      }
      const handle: ActiveSession = { view: result, revision: startedRevision, epoch, courseId, lessonId, nextSeq: result.progress.last_seq, pendingStates: [], heartbeatFlight: null, completionRefreshed: result.progress.completed,
        ticketExpiresAt: 0, ticketFlight: null, networkRecoveries: 0, recovering: false, recoverySource: '' }
      if (disposed || startedRevision !== revision || epoch !== options.getEpoch()) { await close(handle); return }
      active = handle
      state.sessionId = result.session_id; state.progress = result.progress; state.positionMs = replayFromStart ? 0 : result.progress.confirmed_position_ms
      options.acceptProgress?.(courseId, lessonId, result.version_id, result.progress)
      furthestPosition = state.positionMs; state.status = foreground ? 'ready' : 'background'
      try { displayTicket(handle, result.media.ticket) }
      catch (error) {
        active = null; state.status = 'error'; state.src = ''; state.sessionId = ''; intent = false
        state.error = error instanceof Error ? error.message : '视频加载失败，请重试'
        await close(handle)
      }
    })
  }
  async function event(nativeEvent: NativeVideoEvent, failure: NativeVideoFailure = 'unknown') {
    const handle = active
    if (!handle || !current(handle) || state.status === 'stopped') return
    if (state.status === 'ended') { if (nativeEvent === 'play') pausePlayer(); return }
    if (nativeEvent === 'play') {
      if (!foreground) { pausePlayer(); return }
      if (handle.recovering && restoring) { pausePlayer(); return }
      intent = true; restoring = false; state.status = 'playing'; state.error = ''
      playingSince = Date.now(); playingFrom = state.positionMs; windowFurthest = furthestPosition; startBeat(handle)
    } else if (nativeEvent === 'pause') {
      if (state.status === 'background' || state.status === 'error') return
      if (handle.recovering && restoring) return
      if (!restoring) intent = false
      state.status = 'paused'; clearBeat()
    } else if (nativeEvent === 'waiting') {
      if (!intent || !foreground) return
      state.status = 'buffering'; bufferingPosition = state.positionMs; clearBeat()
    } else if (nativeEvent === 'app-hide') { intent = false; state.status = 'background'; clearBeat(); pausePlayer() }
    else if (nativeEvent === 'error') {
      if (state.status === 'error') return
      const recoverable = failure === 'network' || (failure === 'unknown' && (handle.ticketFlight !== null || Date.now() >= handle.ticketExpiresAt))
      if (recoverable && handle.recovering && handle.ticketFlight && state.src === handle.recoverySource) return
      if (recoverable && handle.networkRecoveries === 0) {
        handle.networkRecoveries++; handle.recovering = true; handle.recoverySource = state.src
        restoring = true; state.status = 'buffering'; state.error = ''; clearBeat(); pausePlayer()
        void renewTicket(handle)
        await report(handle, 'buffering')
        return
      }
      await failPlayback(handle); return
    }
    else { intent = false; state.status = 'ended'; state.error = ''; clearBeat(); clearTicket() }
    await report(handle, toHeartbeat(nativeEvent, state.positionMs).state)
    if (nativeEvent === 'ended' && current(handle)) { state.src = ''; restoring = false; await refresh(handle.courseId) }
  }
  function timeUpdate(positionMs: number) {
    if (!active || !current(active) || restoring || !Number.isFinite(positionMs) || positionMs < 0) return
    const position = Math.min(Math.round(positionMs), active.view.progress.duration_ms)
    const continuousPlaying = foreground && intent && state.status === 'playing'
    const allowedPosition = continuousPlaying ? Math.max(windowFurthest, playingFrom + Math.max(0, Date.now() - playingSince) + 2000) : furthestPosition + 2000
    if (position > allowedPosition) { options.controls.seek(furthestPosition); return }
    state.positionMs = position
    if (continuousPlaying) furthestPosition = Math.max(furthestPosition, position)
    if (state.status === 'buffering' && intent && foreground && position > bufferingPosition) void event('play')
  }
  async function hide() {
    if (!foreground) return
    foreground = false; intent = false; clearBeat()
    if (active && current(active) && !['error', 'ended', 'stopped'].includes(state.status)) await event('app-hide')
    else pausePlayer()
  }
  function show() {
    if (foreground) return
    foreground = true
    if (state.status === 'background') state.status = 'paused'
    if (state.identityReason) { state.identityReason = ''; state.error = ''; state.status = 'idle' }
  }
  function dispose(): Promise<void> {
    if (disposed) return lifecycleTail
    const previous = active
    disposed = true; revision++; active = null; pausePlayer(); reset(); state.status = 'stopped'
    return enqueue(async () => { if (previous) await close(previous) })
  }
  return { state, select, play, ready, event, timeUpdate, hide, show, dispose }
}
