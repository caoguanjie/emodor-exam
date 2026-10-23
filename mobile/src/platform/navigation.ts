export interface NavigationGuard {
  /** true allows navigation; false keeps the learner in the exam. */
  confirmExitExam(): Promise<boolean>
}

/** Native back uses onBackPress; H5 also protects browser history and refresh. */
export function protectExamNavigation(shouldBlock: () => boolean, requestExit: () => void): () => void {
  // #ifdef H5
  if (typeof window !== 'undefined') {
    const url = window.location.href
    window.history.pushState({ examGuard: true }, '', url)
    const unload = (event: BeforeUnloadEvent) => {
      if (!shouldBlock()) return
      event.preventDefault(); event.returnValue = ''
    }
    const back = (event: PopStateEvent) => {
      if (!shouldBlock()) return
      event.stopImmediatePropagation()
      window.history.pushState({ examGuard: true }, '', url)
      requestExit()
    }
    window.addEventListener('beforeunload', unload)
    window.addEventListener('popstate', back, true)
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('popstate', back, true) }
  }
  // #endif
  return () => {}
}
