import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useLearnerStore } from './learner'
import { ApiError } from '@/api/client'
import { loginWithSms, logoutMobileSession, refreshMobileSession } from '@/api/auth'
import { beginNativeAuthLogin, beginNativeAuthLogout, enterMobileLogin, invalidateNativeAuthSession } from '@/platform/session'
import type { MobileSessionResult, SmsLoginInput } from '@/types/api'
import { clearUserDrafts } from '@/utils/exam-draft'

export const useSessionStore = defineStore('mobile-session', () => {
  const accessToken = ref('')
  const expiresIn = ref(0)
  const initialized = ref(false)
  const learner = useLearnerStore()
  const user = computed(() => learner.user)
  const revision = ref(0)
  const sessionEpoch = computed(() => revision.value)
  const loggingIn = ref(false)
  const isLoggingIn = computed(() => loggingIn.value)
  let refreshPromise: Promise<string> | null = null
  let loginPromise: Promise<MobileSessionResult> | null = null
  let authWriteTail: Promise<void> = Promise.resolve()
  let loginNavigationRequested = false

  // Cookie-writing responses must settle in order, including an older bootstrap refresh.
  function enqueueAuthWrite<T>(operation: () => Promise<T>): Promise<T> {
    const pending = authWriteTail.then(operation)
    authWriteTail = pending.then(() => undefined, () => undefined)
    return pending
  }

  function clearMemory() {
    accessToken.value = ''
    expiresIn.value = 0
    learner.user = null
  }

  function acceptSession(result: MobileSessionResult) {
    accessToken.value = result.access_token
    expiresIn.value = result.expires_in
    learner.user = result.user
    initialized.value = true
    loginNavigationRequested = false
  }

  function expireSession() {
    revision.value++
    invalidateNativeAuthSession()
    clearMemory()
    if (!loginNavigationRequested) {
      loginNavigationRequested = true
      enterMobileLogin()
    }
  }

  function refreshAccessTokenOnce(): Promise<string> {
    if (loginPromise) return Promise.reject(new ApiError(40107, '登录会话已切换，请重新操作'))
    if (refreshPromise) return refreshPromise
    const startedRevision = revision.value
    const pending = enqueueAuthWrite(async () => {
      if (startedRevision !== revision.value) throw new ApiError(40107, '登录会话已切换，请重新操作')
      return refreshMobileSession()
    }).then(result => {
      if (startedRevision !== revision.value) throw new ApiError(40107, '登录会话已切换，请重新操作')
      acceptSession(result)
      return result.access_token
    }).catch(error => {
      if (startedRevision === revision.value) expireSession()
      throw error
    }).finally(() => { if (refreshPromise === pending) refreshPromise = null })
    refreshPromise = pending
    return pending
  }

  async function bootstrap(): Promise<boolean> {
    if (initialized.value) return !!accessToken.value
    try { await refreshAccessTokenOnce(); return true }
    catch { return false }
    finally { initialized.value = true }
  }

  function login(input: SmsLoginInput): Promise<MobileSessionResult> {
    if (loginPromise) return Promise.reject(new ApiError(40001, '正在登录，请稍候'))
    const startedRevision = ++revision.value
    beginNativeAuthLogin()
    learner.invalidateProfile()
    loggingIn.value = true
    const pending = enqueueAuthWrite(async () => {
      if (startedRevision !== revision.value) throw new ApiError(40107, '登录会话已切换，请重新操作')
      const result = await loginWithSms(input)
      if (startedRevision !== revision.value) throw new ApiError(40107, '登录会话已切换，请重新操作')
      acceptSession(result)
      return result
    }).finally(() => {
      if (loginPromise === pending) { loginPromise = null; loggingIn.value = false }
    })
    loginPromise = pending
    return pending
  }

  function logout(): Promise<void> {
    const previousUser = user.value?.id
    const startedRevision = ++revision.value
    beginNativeAuthLogout()
    learner.invalidateProfile()
    const previousToken = accessToken.value
    return enqueueAuthWrite(async () => {
      if (previousUser !== undefined) {
        try { await clearUserDrafts(String(previousUser)) }
        catch { uni.showToast?.({ title: '本机草稿清理失败，请重试退出', icon: 'none' }) }
      }
      try { await logoutMobileSession(previousToken) }
      catch { /* Local logout still completes when the network is unavailable. */ }
      finally {
        if (startedRevision === revision.value) expireSession()
        else clearMemory() // A newer login is queued after this response and will restore its own state.
      }
    })
  }

  return { accessToken, expiresIn, initialized, user, sessionEpoch, isLoggingIn, bootstrap, login, logout, refreshAccessTokenOnce, expireSession }
})
