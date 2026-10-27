import { watch, type Ref } from 'vue'

interface NativeExitPromptApi {
  enableAlertBeforeUnload?: (options: { message: string; fail?: () => void }) => void
  disableAlertBeforeUnload?: () => void
}
function nativeApi(): NativeExitPromptApi {
  // #ifdef MP-WEIXIN
  if (typeof uni !== 'undefined') return uni
  // #endif
  return {}
}

/** WeChat's optional page-back prompt cannot intercept swipe-back or closing the mini program. */
export function watchNativeExamExitPrompt(active: Readonly<Ref<boolean>>, api: NativeExitPromptApi = nativeApi()): () => void {
  let enabled = false, disposed = false, revision = 0
  function disable() {
    revision++
    if (!enabled) return
    enabled = false
    try { api.disableAlertBeforeUnload?.() } catch { /* Native support is best effort. */ }
  }
  const stop = watch(active, value => {
    if (!value) { disable(); return }
    if (disposed || enabled || typeof api.enableAlertBeforeUnload !== 'function' || typeof api.disableAlertBeforeUnload !== 'function') return
    const current = ++revision
    try {
      enabled = true
      api.enableAlertBeforeUnload({ message: '退出后倒计时不会暂停，本机草稿会保留。', fail: () => { if (current === revision) enabled = false } })
    } catch { enabled = false }
  }, { immediate: true, flush: 'sync' })
  return () => { if (disposed) return; disposed = true; stop(); disable() }
}
