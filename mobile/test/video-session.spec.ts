import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '../src/stores/session'
import { useCourseStore } from '../src/stores/course'
import { createVideoSessionClient } from '../src/stores/video'
import { mediaContentUrl, toHeartbeat } from '../src/platform/media-player'
import { startVideoSession } from '../src/api/video'

type Wire = { url: string; method: string; data?: unknown; success: (value: unknown) => void; fail: (error: unknown) => void }
const progress = { confirmed_position_ms: 12000, credited_ms: 9000, coverage_ms: 9000, duration_ms: 120000, completed: false, last_seq: 4 }
const ok = (data: unknown) => ({ statusCode: 200, data: { code: 0, message: 'ok', data } })
const response = (id = '81', asset = '91') => ({ session_id: id, version_id: '71', heartbeat_interval_ms: 30000, media: { asset_id: asset, ticket: { content_url: `/api/v1/media/tickets/ticket-${id}/content`, expires_at: new Date(Date.now() + 60000).toISOString() } }, progress: { ...progress } })
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); void promise.catch(() => {}); return { promise, resolve, reject } }
let requests: Wire[]
function install(handler: (wire: Wire) => unknown = wire => ok(wire.url.endsWith('/video-sessions') ? response() : wire.url.includes('/tickets') ? { content_url: '/api/v1/media/tickets/renewed/content', expires_at: new Date(Date.now() + 60000).toISOString() } : progress)) {
  vi.stubGlobal('uni', { request: (wire: Wire) => { requests.push(wire); Promise.resolve().then(() => handler(wire)).then(wire.success, wire.fail) }, reLaunch: vi.fn() })
}
function setup() {
  const controls = { play: vi.fn(), pause: vi.fn(), seek: vi.fn() }, refreshProgress = vi.fn().mockResolvedValue(undefined)
  const client = createVideoSessionClient({ controls, getEpoch: () => useSessionStore().sessionEpoch, refreshProgress, resolveUrl: url => mediaContentUrl(url, 'h5') })
  client.select({ courseId: '9007199254740995', lessonId: '9007199254740996' })
  return { client, controls, refreshProgress }
}
async function settle() { for (let n = 0; n < 20; n++) await Promise.resolve() }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T08:00:00Z')); setActivePinia(createPinia()); useSessionStore().$patch({ initialized: true, accessToken: 'video-test-access' }); requests = []; install() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('native video protocol', () => {
  it('maps waiting and hiding to non-playing heartbeats without invented elapsed time', () => {
    expect(toHeartbeat('waiting', 12000)).toEqual({ state: 'buffering', position_ms: 12000 })
    expect(toHeartbeat('app-hide', 12000)).toEqual({ state: 'background', position_ms: 12000 })
    expect(toHeartbeat('error', 12000)).toEqual({ state: 'paused', position_ms: 12000 })
  })
  it('keeps H5 media at the page origin and only resolves MP tickets against an explicit HTTPS origin', () => {
    expect(mediaContentUrl('/api/v1/media/tickets/abc/content', 'h5')).toBe(`${window.location.origin}/api/v1/media/tickets/abc/content`)
    expect(mediaContentUrl('/api/v1/media/tickets/abc/content', 'mp-weixin', 'https://learn.example')).toBe('https://learn.example/api/v1/media/tickets/abc/content')
    expect(() => mediaContentUrl('/api/v1/media/tickets/abc/content', 'mp-weixin')).toThrow('HTTPS')
    expect(() => mediaContentUrl('https://foreign.example/a', 'h5')).toThrow()
  })
  it.each(['session', 'version', 'asset'])('rejects a zero %s ID in a successful start response', async field => {
    const value = response()
    if (field === 'session') value.session_id = '0'
    if (field === 'version') value.version_id = '0'
    if (field === 'asset') value.media.asset_id = '0'
    install(() => ok(value))
    await expect(startVideoSession('61')).rejects.toMatchObject({ code: -2 })
  })
})

describe('video session client', () => {
  it('only starts on an explicit play and uses the authoritative version, ticket, and resume position', async () => {
    const { client, controls } = setup()
    await settle(); expect(requests).toHaveLength(0)
    await client.play()
    expect(requests[0]).toMatchObject({ url: '/api/v1/me/video-sessions', method: 'POST', data: { lesson_id: '9007199254740996' } })
    expect(client.state.src).toBe(`${window.location.origin}/api/v1/media/tickets/ticket-81/content`)
    expect(client.state.progress).toEqual(progress)
    client.ready()
    expect(controls.seek).toHaveBeenCalledWith(12000)
    expect(controls.play).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(1)
    await client.event('play')
    expect(requests[1].data).toEqual({ seq: 5, position_ms: 12000, state: 'playing' })
    await client.dispose()
  })
  it('does not let pre-metadata timeupdate reset the server resume position', async () => {
    const { client, controls } = setup(); await client.play(); client.timeUpdate(0); client.ready()
    expect(controls.seek).toHaveBeenLastCalledWith(12000)
    await client.dispose()
  })
  it.each(['pause', 'waiting', 'app-hide'] as const)('does not spend %s wall time on a forward seek allowance', async boundary => {
    const { client, controls } = setup(); await client.play(); await client.event('play')
    if (boundary === 'app-hide') await client.hide(); else await client.event(boundary)
    await vi.advanceTimersByTimeAsync(60000); client.ready(); controls.seek.mockClear(); client.timeUpdate(60000)
    expect(controls.seek).toHaveBeenLastCalledWith(12000); expect(client.state.positionMs).toBe(12000)
    if (boundary === 'pause') { await client.play(); await client.event('play'); client.timeUpdate(60000); expect(controls.seek).toHaveBeenLastCalledWith(12000) }
    await client.dispose()
  })
  it('sends at most a 30-second playing heartbeat and accepts only server progress', async () => {
    const { client } = setup(); await client.play(); await client.event('play')
    client.timeUpdate(13000); client.timeUpdate(14000)
    await vi.advanceTimersByTimeAsync(29999)
    expect(requests.filter(r => r.url.endsWith('/heartbeat'))).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(requests.at(-1)?.data).toEqual({ seq: 6, position_ms: 14000, state: 'playing' })
    expect(client.state.progress?.credited_ms).toBe(9000)
    await client.dispose()
  })
  it('refreshes course authority once on heartbeat completion even when the learner leaves before ended', async () => {
    const refreshing = deferred<void>(); let beats = 0
    install(wire => ok(wire.url.endsWith('/video-sessions') ? response() : wire.url.endsWith('/heartbeat') ? { ...progress, completed: ++beats >= 2 } : progress))
    const { client, refreshProgress } = setup(); refreshProgress.mockImplementation(() => refreshing.promise)
    await client.play(); await client.event('play'); expect(refreshProgress).not.toHaveBeenCalled()
    await client.event('pause'); expect(client.state.progress?.completed).toBe(true)
    expect(refreshProgress).toHaveBeenCalledTimes(1); expect(refreshProgress).toHaveBeenCalledWith('9007199254740995')
    await client.event('play'); expect(refreshProgress).toHaveBeenCalledTimes(1)
    await client.dispose(); expect(requests.at(-1)?.url).toBe('/api/v1/me/video-sessions/81/close')
    refreshing.resolve()
  })
  it('accepts a pending course summary after a later pause heartbeat without rolling back its lesson snapshot', async () => {
    const summary = deferred<unknown>(); let beats = 0
    install(wire => {
      if (wire.url.endsWith('/video-sessions')) return ok(response())
      if (wire.url.endsWith('/progress')) return summary.promise
      if (wire.url.endsWith('/heartbeat')) return ok({ ...progress, completed: true, confirmed_position_ms: 115000 + ++beats * 1000, last_seq: 4 + beats })
      return ok(progress)
    })
    const course = useCourseStore()
    const client = createVideoSessionClient({ controls: { play() {}, pause() {}, seek() {} }, getEpoch: () => useSessionStore().sessionEpoch, refreshProgress: id => course.loadProgress([id]), acceptProgress: course.acceptLessonProgress, resolveUrl: url => mediaContentUrl(url, 'h5') })
    client.select({ courseId: '41', lessonId: '61' }); await client.play(); await client.event('play'); await settle()
    expect(requests.filter(r => r.url.endsWith('/progress'))).toHaveLength(1)
    await client.event('pause')
    expect(course.lessonProgress['41']['61'].last_seq).toBe(6)
    summary.resolve(ok({ required: 1, completed: 1, completion_rate: 1, lessons: [{ ...progress, lesson_id: '61', version_id: '71', completed: true, confirmed_position_ms: 116000, last_seq: 5 }] })); await settle()
    expect(course.progressPercent['41']).toBe(100); expect(course.progressComplete['41']).toBe(true)
    expect(course.lessonProgress['41']['61'].last_seq).toBe(6); expect(course.lessonProgress['41']['61'].confirmed_position_ms).toBe(117000)
    await client.dispose()
  })
  it('reports pause, waiting, background and ended immediately and stops periodic work', async () => {
    const { client, controls, refreshProgress } = setup(); await client.play(); await client.event('play')
    await client.event('pause'); await vi.advanceTimersByTimeAsync(30000)
    expect(requests.at(-1)?.data).toMatchObject({ state: 'paused' })
    await client.event('play'); await client.event('waiting'); await vi.advanceTimersByTimeAsync(30000)
    expect(requests.filter(r => r.url.endsWith('/heartbeat')).at(-1)?.data).toMatchObject({ state: 'buffering' })
    await client.hide()
    expect(controls.pause).toHaveBeenCalled()
    expect(requests.at(-1)?.data).toMatchObject({ state: 'background' })
    expect(requests.some(r => r.url.endsWith('/close'))).toBe(false)
    client.show(); expect(client.state.status).toBe('paused')
    await client.play(); await client.event('play'); await client.event('ended')
    expect(requests.at(-1)?.data).toMatchObject({ state: 'ended' })
    expect(refreshProgress).toHaveBeenCalledWith('9007199254740995')
    const count = requests.length; await vi.advanceTimersByTimeAsync(30000); expect(requests).toHaveLength(count)
    await client.dispose()
  })
  it('reanchors once when buffering naturally resumes without a second play event', async () => {
    const { client } = setup(); await client.play(); await client.event('play'); await client.event('waiting')
    client.timeUpdate(12000); await settle()
    const before = requests.length
    client.timeUpdate(13000); await settle(); client.timeUpdate(14000); await settle()
    expect(requests.slice(before).map(r => r.data)).toEqual([{ seq: 7, position_ms: 13000, state: 'playing' }])
    await client.event('waiting'); await client.hide(); client.timeUpdate(15000); await settle()
    expect(requests.at(-1)?.data).toMatchObject({ state: 'background' })
    await client.dispose()
  })
  it('serializes heartbeat seqs and never replays a failed heartbeat', async () => {
    const blocked = deferred<unknown>(); let beats = 0
    install(wire => wire.url.endsWith('/heartbeat') && ++beats === 1 ? blocked.promise : ok(wire.url.endsWith('/video-sessions') ? response() : progress))
    const { client } = setup(); await client.play()
    const playing = client.event('play'); await settle()
    const paused = client.event('pause'); await settle()
    expect(requests.filter(r => r.url.endsWith('/heartbeat'))).toHaveLength(1)
    blocked.resolve(ok(progress)); await playing; await paused
    expect(requests.filter(r => r.url.endsWith('/heartbeat')).map(r => r.data)).toEqual([{ seq: 5, position_ms: 12000, state: 'playing' }, { seq: 6, position_ms: 12000, state: 'paused' }])
    install(wire => { if (wire.url.endsWith('/heartbeat')) throw new Error('offline'); return ok(progress) })
    await client.event('play'); const before = requests.length
    await vi.advanceTimersByTimeAsync(1000); expect(requests).toHaveLength(before)
    install(wire => ok(progress)); await vi.advanceTimersByTimeAsync(29000)
    expect(requests.at(-1)?.data).toMatchObject({ seq: 8, state: 'playing' })
    await client.dispose()
  })
  it('does not count loading errors as playing and allows an explicit retry', async () => {
    const { client } = setup(); await client.play(); await client.event('play'); await client.event('error')
    expect(client.state.status).toBe('error')
    expect(client.state.error).toBe('视频加载失败，请重试')
    expect(requests.at(-1)?.data).toMatchObject({ state: 'paused' })
    const before = requests.length; await vi.advanceTimersByTimeAsync(30000); expect(requests).toHaveLength(before)
    await client.play()
    expect(requests.slice(before).map(r => r.url)).toEqual(['/api/v1/me/video-sessions/81/close', '/api/v1/me/video-sessions'])
    await client.dispose()
  })
  it('removes ended playback and only an explicit replay opens a new session from position zero', async () => {
    install(wire => ok(wire.url.endsWith('/video-sessions') ? { ...response(), progress: { ...progress, confirmed_position_ms: 120000 } } : progress))
    const { client, controls } = setup(); await client.play(); await client.event('play'); await client.event('ended')
    expect(client.state.src).toBe(''); expect(client.state.progress?.credited_ms).toBe(9000)
    await client.event('play'); expect(requests.filter(r => r.url === '/api/v1/me/video-sessions')).toHaveLength(1)
    await client.play(); client.ready(); expect(controls.seek).toHaveBeenLastCalledWith(0)
    await client.event('play')
    expect(requests.filter(r => r.url === '/api/v1/me/video-sessions')).toHaveLength(2)
    expect(requests.filter(r => r.url.endsWith('/heartbeat')).at(-1)?.data).toEqual({ seq: 5, state: 'playing', position_ms: 0 })
    expect(client.state.progress?.credited_ms).toBe(9000); await client.dispose()
  })
  it('does not turn a programmatic error pause back into a playable paused session', async () => {
    const { client, controls } = setup(); await client.play(); await client.event('play')
    controls.pause.mockImplementation(() => { void client.event('pause') })
    await client.event('error')
    expect(client.state.status).toBe('error')
    controls.pause.mockReset(); await client.dispose()
  })
  it('clears play intent even when a start finishes after the page hides', async () => {
    const pending = deferred<unknown>(); install(wire => wire.url.endsWith('/video-sessions') ? pending.promise : ok(progress))
    const { client, controls } = setup(); const playing = client.play(); await settle(); await client.hide()
    pending.resolve(ok(response())); await playing; client.show(); client.ready()
    expect(controls.play).not.toHaveBeenCalled()
    expect(client.state.status).toBe('paused')
    await client.dispose()
  })
  it('treats duplicate page/app hide notifications as one pause and one background heartbeat', async () => {
    const { client, controls } = setup(); await client.play(); await client.event('play')
    const before = controls.pause.mock.calls.length
    await client.hide(); await client.hide()
    expect(controls.pause.mock.calls.length - before).toBe(1)
    expect(requests.filter(r => r.url.endsWith('/heartbeat') && (r.data as { state: string }).state === 'background')).toHaveLength(1)
    client.show(); client.show(); expect(client.state.status).toBe('paused')
    await client.dispose()
  })
  it('rejects a zero lesson route before creating a video session', async () => {
    const { client } = setup(); client.select({ courseId: '42', lessonId: '0' }); await client.play()
    expect(requests).toHaveLength(0); expect(client.state.status).toBe('error')
    await client.dispose()
  })
  it('requires a fresh explicit click when closing an old session has an unknown network result', async () => {
    const closing = deferred<unknown>(); let starts = 0
    install(wire => wire.url.endsWith('/close') ? closing.promise : wire.url.endsWith('/video-sessions') ? (starts++, ok(response())) : ok(progress))
    const { client } = setup(); await client.play(); client.select({ courseId: '42', lessonId: '43' }); const next = client.play(); await settle()
    closing.reject(new Error('timeout')); await next
    expect(starts).toBe(1); expect(client.state.status).toBe('stopped')
    install(wire => ok(wire.url.endsWith('/video-sessions') ? response('82') : progress))
    await client.play(); expect(client.state.sessionId).toBe('82'); await client.dispose()
  })
  it.each([40950, 40951])('stops and refreshes authority on terminal code %s', async code => {
    install(wire => wire.url.endsWith('/heartbeat') ? { statusCode: 409, data: { code, message: '课程不可学', data: null } } : ok(response()))
    const { client, controls, refreshProgress } = setup(); await client.play(); await client.event('play')
    expect(client.state.status).toBe('stopped'); expect(client.state.src).toBe('')
    expect(controls.pause).toHaveBeenCalled(); expect(refreshProgress).toHaveBeenCalledWith('9007199254740995')
    const count = requests.length; await vi.advanceTimersByTimeAsync(60000); expect(requests).toHaveLength(count)
    await client.dispose()
  })
  it.each(['IDENTITY_REQUIRED', 'IDENTITY_PENDING'])('uses structured %s rather than guessing the message', async reason => {
    install(() => ({ statusCode: 403, data: { code: 40302, message: '供应商错误文案', data: { reason_code: reason } } }))
    const { client } = setup(); await client.play()
    expect(client.state.identityReason).toBe(reason); expect(client.state.src).toBe('')
    expect(client.state.error).not.toContain('供应商')
    await client.dispose()
  })
  it('allows a fresh authoritative start after returning from the identity page without auto-starting', async () => {
    install(() => ({ statusCode: 403, data: { code: 40302, message: 'identity', data: { reason_code: 'IDENTITY_REQUIRED' } } }))
    const { client } = setup(); await client.play(); await client.hide(); const count = requests.length
    client.show(); expect(client.state.identityReason).toBe(''); expect(requests).toHaveLength(count)
    install(wire => ok(wire.url.endsWith('/video-sessions') ? response() : progress)); await client.play()
    expect(client.state.sessionId).toBe('81'); await client.dispose()
  })
  it('does not restore an old identity reason when a terminal refresh settles after switching lessons', async () => {
    const refreshing = deferred<void>()
    install(wire => wire.url.endsWith('/heartbeat') ? { statusCode: 403, data: { code: 40302, message: 'identity', data: { reason_code: 'IDENTITY_PENDING' } } } : ok(response()))
    const { client, refreshProgress } = setup(); refreshProgress.mockImplementation(() => refreshing.promise)
    await client.play(); const playing = client.event('play'); await settle()
    client.select({ courseId: '42', lessonId: '43' }); refreshing.resolve(); await playing
    expect(client.state.identityReason).toBe(''); expect(client.state.error).toBe('')
    await client.dispose()
  })
  it('sends a fresh session first heartbeat immediately while the old terminal progress refresh is still pending', async () => {
    const refreshing = deferred<void>(); let starts = 0, denied = true
    install(wire => {
      if (wire.url.endsWith('/video-sessions')) return ok(response(String(80 + ++starts)))
      if (wire.url.endsWith('/heartbeat') && denied) { denied = false; return { statusCode: 409, data: { code: 40950, message: 'closed', data: null } } }
      return ok(progress)
    })
    const { client, refreshProgress } = setup(); refreshProgress.mockImplementation(() => refreshing.promise)
    await client.play(); const first = client.event('play'); await settle(); await client.play(); expect(starts).toBe(2)
    const nextBeat = client.event('play'); await settle()
    expect(requests.filter(r => r.url.endsWith('/heartbeat')).at(-1)?.url).toBe('/api/v1/me/video-sessions/82/heartbeat')
    refreshing.resolve(); await first; await nextBeat; expect(client.state.identityReason).toBe('')
    await client.dispose()
  })
  it('renews the exact current media ticket without creating another learning session', async () => {
    install(wire => ok(wire.url.includes('/tickets') ? { content_url: '/api/v1/media/tickets/renewed/content', expires_at: new Date(Date.now() + 60000).toISOString() } : wire.url.endsWith('/video-sessions') ? response() : progress))
    const { client, controls } = setup(); await client.play(); await client.event('play'); client.timeUpdate(13000)
    await vi.advanceTimersByTimeAsync(50000)
    expect(requests.filter(r => r.url === '/api/v1/me/video-sessions')).toHaveLength(1)
    expect(requests.find(r => r.url.includes('/tickets'))).toMatchObject({ url: '/api/v1/media/91/tickets', data: { owner_type: 'lesson_version_video', owner_id: '71' } })
    expect(client.state.src).toBe(`${window.location.origin}/api/v1/media/tickets/renewed/content`)
    client.ready(); expect(controls.seek).toHaveBeenLastCalledWith(13000)
    await client.dispose()
  })
  it('waits for an old in-flight start, closes that successful session, then starts the latest lesson', async () => {
    const old = deferred<unknown>(); let starts = 0
    install(wire => wire.url.endsWith('/video-sessions') ? ++starts === 1 ? old.promise : ok(response('82', '92')) : ok(progress))
    const { client } = setup(); const first = client.play(); await settle()
    client.select({ courseId: '42', lessonId: '43' }); const second = client.play(); await settle()
    expect(starts).toBe(1)
    old.resolve(ok(response('81'))); await first; await second
    expect(requests.map(r => r.url)).toEqual(['/api/v1/me/video-sessions', '/api/v1/me/video-sessions/81/close', '/api/v1/me/video-sessions'])
    expect(requests.at(-1)?.data).toEqual({ lesson_id: '43' }); expect(client.state.sessionId).toBe('82')
    await client.dispose()
  })
  it('keeps an unknown start timeout stopped until another explicit user click', async () => {
    const old = deferred<unknown>(); let starts = 0
    install(wire => wire.url.endsWith('/video-sessions') ? ++starts === 1 ? old.promise : ok(response('82')) : ok(progress))
    const { client } = setup(); const first = client.play(); await settle()
    client.select({ courseId: '42', lessonId: '43' }); const second = client.play()
    old.reject(new Error('timeout')); await first; await second
    expect(starts).toBe(1); expect(client.state.status).toBe('stopped')
    await client.play(); expect(starts).toBe(2); expect(client.state.sessionId).toBe('82')
    await client.dispose()
  })
  it('closes a start that completes after unload and cannot restore its URL', async () => {
    const old = deferred<unknown>(); install(wire => wire.url.endsWith('/video-sessions') ? old.promise : ok(progress))
    const { client } = setup(); const first = client.play(); await settle(); const leaving = client.dispose()
    old.resolve(ok(response())); await first; await leaving
    expect(client.state.src).toBe(''); expect(requests.at(-1)?.url).toBe('/api/v1/me/video-sessions/81/close')
  })
  it('ignores old heartbeat and ticket replies after a lesson switch or login epoch change', async () => {
    const renew = deferred<unknown>()
    install(wire => wire.url.includes('/tickets') ? renew.promise : ok(wire.url.endsWith('/video-sessions') ? response() : progress))
    const { client } = setup(); await client.play(); await vi.advanceTimersByTimeAsync(50000)
    client.select({ courseId: '42', lessonId: '43' }); useSessionStore().expireSession()
    renew.resolve(ok({ content_url: '/api/v1/media/tickets/old/content', expires_at: new Date(Date.now() + 60000).toISOString() })); await settle()
    expect(client.state.src).toBe(''); expect(client.state.sessionId).toBe('')
    await client.dispose()
  })
})
