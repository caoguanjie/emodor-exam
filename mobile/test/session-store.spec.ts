import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '../src/stores/session'
import { useLearnerStore } from '../src/stores/learner'
import { loginWithSms, sendSmsCode } from '../src/api/auth'
import { readExamEntryIntent, saveExamEntryIntent } from '../src/utils/exam-entry-intent'
import { useExamStore } from '../src/stores/exam'

const user = { id: 11, username: 'learner-11', real_name: '', phone_masked: '138****0000', role: 'employee' as const, source: 'external' as const, category_id: null, identity_status: 'unverified' as const }
type WireRequest = { url: string; data?: unknown; header: Record<string, string>; success: (response: { statusCode: number; data: unknown }) => void; fail: (error: unknown) => void }
function installWire(handler: (options: WireRequest) => Promise<unknown> | unknown) {
  vi.stubGlobal('uni', { request: (options: WireRequest) => { Promise.resolve().then(() => handler(options)).then(data => options.success({ statusCode: 200, data }), options.fail); return { abort() {} } }, reLaunch: vi.fn(), setStorageSync: vi.fn(), removeStorageSync: vi.fn() })
}
function ok(data: unknown) { return { code: 0, message: 'ok', data } }
function sessionData(token = 'memory-only-access') { return { access_token: token, expires_in: 900, user } }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.unstubAllGlobals()
  for (const key of ['localStorage', 'sessionStorage']) {
    const values = new Map<string, string>()
    vi.stubGlobal(key, { get length() { return values.size }, getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => values.set(name, value) })
  }
})

describe('mobile session store', () => {
  it('invalidates an old account exam cache even when a refresh returns a different account', async () => {
    installWire(() => ok({ ...sessionData(), user: { ...user, id: 12 } }))
    const session = useSessionStore(), exam = useExamStore()
    useLearnerStore().user = { ...user }
    exam.$patch({ summary: { paper_id: '7' } as any, questions: [{ question_id: 'old' } as any], answers: { old: ['old-account-answer'] } })
    const epoch = session.sessionEpoch
    await session.refreshAccessTokenOnce()
    expect(session.sessionEpoch).toBeGreaterThan(epoch)
    expect(exam.summary).toBeNull(); expect(exam.questions).toEqual([]); expect(exam.answers).toEqual({})
  })

  it('clears a selected owner-bound target on explicit logout instead of recapturing the visible paper', async () => {
    const values = new Map<string, unknown>()
    installWire(() => ok(null))
    Object.assign(uni, { getStorageSync: (key: string) => values.get(key), setStorageSync: (key: string, value: unknown) => values.set(key, value), removeStorageSync: (key: string) => values.delete(key) })
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/exam/instructions', options: { paper_id: '7' } }])
    useLearnerStore().user = { ...user }
    saveExamEntryIntent({ kind: 'exam-instructions', paperId: '7' }, '11')
    await useSessionStore().logout()
    expect(readExamEntryIntent('11')).toBeNull()
  })
  it('captures a generic exam Tab on expired login and keeps the target after SMS authentication', async () => {
    const values = new Map<string, unknown>()
    installWire(options => options.url.endsWith('/refresh') ? { code: 40107, message: 'expired', data: null } : ok(sessionData()))
    Object.assign(uni, { getStorageSync: (key: string) => values.get(key), setStorageSync: (key: string, value: unknown) => values.set(key, value), removeStorageSync: (key: string) => values.delete(key) })
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/exam/index', options: { paper_id: '9' } }])
    await useSessionStore().bootstrap()
    expect(readExamEntryIntent()).toEqual({ kind: 'exam-tab' })
    await useSessionStore().login({ phone: '13800000000', challenge_id: 'challenge-1', code: '123456' })
    expect(readExamEntryIntent('11')).toEqual({ kind: 'exam-tab' })
  })

  it('drops the old selected paper and all in-memory exam data on an account switch', async () => {
    const values = new Map<string, unknown>()
    installWire(() => ok({ ...sessionData(), user: { ...user, id: 12 } }))
    Object.assign(uni, { getStorageSync: (key: string) => values.get(key), setStorageSync: (key: string, value: unknown) => values.set(key, value), removeStorageSync: (key: string) => values.delete(key) })
    const session = useSessionStore(), exam = useExamStore()
    useLearnerStore().user = { ...user }
    exam.$patch({ list: { items: [{ paper_id: '7', title: 'account A' } as any], total: 1, page: 1, page_size: 10 }, summary: { paper_id: '7' } as any, questions: [{ question_id: 'old' } as any], answers: { old: ['secret'] } })
    saveExamEntryIntent({ kind: 'exam-instructions', paperId: '7' }, '11')
    await session.login({ phone: '13900000000', challenge_id: 'challenge-b', code: '123456' })
    expect(readExamEntryIntent('12')).toEqual({ kind: 'exam-tab' })
    expect(exam.list.items).toEqual([]); expect(exam.summary).toBeNull(); expect(exam.questions).toEqual([]); expect(exam.answers).toEqual({})
  })
  it('normalizes phone numbers and keeps challenge and access credentials out of storage', async () => {
    const received: unknown[] = []
    installWire(options => { received.push(options.data); return ok(options.url.endsWith('/send') ? { challenge_id: 'challenge-1', expires_in: 300, retry_after: 60, masked_phone: '138****0000' } : sessionData()) })
    await expect(sendSmsCode('138 0000-0000')).resolves.toMatchObject({ challenge_id: 'challenge-1' })
    await useSessionStore().login({ phone: '138 0000-0000', challenge_id: 'challenge-1', code: '123456' })
    expect(received).toEqual([{ phone: '13800000000' }, { phone: '13800000000', challenge_id: 'challenge-1', code: '123456' }])
    expect(useSessionStore().accessToken).toBe('memory-only-access')
    expect(useLearnerStore().user).toEqual(user)
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(uni.setStorageSync).not.toHaveBeenCalled()
  })

  it.each(['12800000000', '1380000000', '+8613800000000'])('rejects malformed phone %s before transport', async phone => {
    installWire(() => { throw new Error('must not send') })
    await expect(sendSmsCode(phone)).rejects.toMatchObject({ code: 40001 })
  })

  it('rejects a non-six-digit code before transport', async () => {
    installWire(() => { throw new Error('must not send') })
    await expect(loginWithSms({ phone: '13800000000', challenge_id: 'challenge-1', code: '12345' })).rejects.toMatchObject({ code: 40001 })
  })

  it('bootstraps by one silent refresh and restores the authority user', async () => {
    let refreshes = 0
    installWire(async options => { expect(options.url).toBe('/api/v1/mobile/auth/refresh'); refreshes++; await new Promise(resolve => setTimeout(resolve, 5)); return ok(sessionData()) })
    const session = useSessionStore()
    await expect(Promise.all([session.bootstrap(), session.bootstrap()])).resolves.toEqual([true, true])
    expect(refreshes).toBe(1)
    expect(session.initialized).toBe(true)
    expect(session.user?.identity_status).toBe('unverified')
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })

  it('changes the readonly session epoch on login or logout but not ordinary refresh', async () => {
    installWire(options => ok(options.url.endsWith('/logout') ? null : sessionData()))
    const session = useSessionStore()
    const initial = session.sessionEpoch
    await session.login({ phone: '13800000000', challenge_id: 'challenge-1', code: '123456' })
    const loggedIn = session.sessionEpoch
    expect(loggedIn).toBeGreaterThan(initial)
    await session.refreshAccessTokenOnce()
    expect(session.sessionEpoch).toBe(loggedIn)
    await session.logout()
    expect(session.sessionEpoch).toBeGreaterThan(loggedIn)
  })

  it('sends login only after an older bootstrap refresh settles and rejects duplicate submission', async () => {
    let finishRefresh: (value: unknown) => void = () => {}
    let refreshStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { refreshStarted = resolve })
    const paths: string[] = []
    installWire(options => {
      paths.push(options.url)
      if (options.url.endsWith('/refresh')) { refreshStarted(); return new Promise(resolve => { finishRefresh = resolve }) }
      return ok({ ...sessionData('account-b-access'), user: { ...user, id: 12 } })
    })
    const session = useSessionStore()
    const bootstrap = session.bootstrap()
    await started
    const input = { phone: '13800000000', challenge_id: 'new-login-challenge', code: '123456' }
    const login = session.login(input)
    const duplicate = session.login(input).catch(error => error)
    await Promise.resolve()
    await Promise.resolve()
    expect(paths).toEqual(['/api/v1/mobile/auth/refresh'])
    finishRefresh(ok(sessionData('late-account-a-access')))
    await bootstrap
    await login
    await expect(duplicate).resolves.toMatchObject({ code: 40001, message: '正在登录，请稍候' })
    expect(paths).toEqual(['/api/v1/mobile/auth/refresh', '/api/v1/mobile/auth/sms/login'])
    expect(session.accessToken).toBe('account-b-access')
    expect(session.user?.id).toBe(12)
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })

  it('clears only mobile memory and returns to login after refresh failure', async () => {
    installWire(() => ({ code: 40107, message: '会话已失效', data: null }))
    const session = useSessionStore()
    session.$patch({ accessToken: 'stale' })
    useLearnerStore().$patch({ user })
    localStorage.setItem('ruleexam:pc:preferences', 'preserved')
    await expect(session.bootstrap()).resolves.toBe(false)
    expect(session.accessToken).toBe('')
    expect(session.user).toBeNull()
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/auth/login' })
    expect(localStorage.getItem('ruleexam:pc:preferences')).toBe('preserved')
    expect(uni.removeStorageSync).not.toHaveBeenCalled()
  })

  it('does not relaunch an already visible login page when silent refresh fails', async () => {
    installWire(() => ({ code: 40107, message: '会话已失效', data: null }))
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/auth/login' }])
    await expect(useSessionStore().bootstrap()).resolves.toBe(false)
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })

  it('clears mobile memory even when logout fails and never renews during logout', async () => {
    const paths: string[] = []
    installWire(options => { paths.push(options.url); throw new Error('offline') })
    const session = useSessionStore()
    session.$patch({ accessToken: 'old-access' })
    useLearnerStore().$patch({ user })
    await session.logout()
    expect(paths).toEqual(['/api/v1/mobile/auth/logout'])
    expect(session.accessToken).toBe('')
    expect(session.user).toBeNull()
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/auth/login' })
  })

  it('does not restore a session from a refresh that finishes after logout', async () => {
    let completeRefresh: (value: unknown) => void = () => {}
    let refreshStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { refreshStarted = resolve })
    installWire(options => options.url.endsWith('/refresh') ? new Promise(resolve => { completeRefresh = resolve; refreshStarted() }) : ok(null))
    const session = useSessionStore()
    const refresh = session.refreshAccessTokenOnce().catch(() => undefined)
    await started
    const logout = session.logout()
    completeRefresh(ok(sessionData('late-access')))
    await Promise.all([refresh, logout])
    expect(session.accessToken).toBe('')
    expect(session.user).toBeNull()
  })

  it('sends a newer login after an older logout settles so the old response cannot clear its Cookie', async () => {
    let finishLogout: (value: unknown) => void = () => {}
    let logoutStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { logoutStarted = resolve })
    const paths: string[] = []
    installWire(options => {
      paths.push(options.url)
      if (options.url.endsWith('/logout')) { logoutStarted(); return new Promise(resolve => { finishLogout = resolve }) }
      return ok({ ...sessionData('new-login-access'), user: { ...user, id: 12 } })
    })
    const session = useSessionStore()
    session.$patch({ accessToken: 'old-access' })
    const logout = session.logout()
    await started
    const login = session.login({ phone: '13800000000', challenge_id: 'new-login-challenge', code: '123456' })
    await Promise.resolve()
    await Promise.resolve()
    expect(paths).toEqual(['/api/v1/mobile/auth/logout'])
    finishLogout(ok(null))
    await logout
    await login
    expect(session.accessToken).toBe('new-login-access')
    expect(session.user?.id).toBe(12)
    expect(uni.reLaunch).not.toHaveBeenCalled()
  })
})
