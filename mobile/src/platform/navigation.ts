import { consumeExamEntryIntent, examEntryIntentUrl, reconcileExamEntryOwner, type ExamEntryIntent } from '@/utils/exam-entry-intent'
import { learnerLandingUrl, needsLearnerProfile } from '@/utils/learner-onboarding'

/** AppTabBar uses reLaunch on both H5 and MP, rather than native switchTab. */
export function navigateExamEntryIntent(intent: ExamEntryIntent): void {
  const url = examEntryIntentUrl(intent)
  if (intent.kind === 'exam-tab') uni.reLaunch({ url })
  else uni.redirectTo({ url })
}

export function resumeLearnerNavigation(profile: { id: string | number; real_name: string; category_id: string | number | null }): void {
  const ownerId = String(profile.id)
  reconcileExamEntryOwner(ownerId)
  if (needsLearnerProfile(profile)) { uni.reLaunch({ url: learnerLandingUrl(profile) }); return }
  const intent = consumeExamEntryIntent(ownerId)
  if (intent) navigateExamEntryIntent(intent)
  else uni.reLaunch({ url: learnerLandingUrl(profile) })
}

export interface NavigationGuard {
  /** true allows navigation; false keeps the learner in the exam. */
  confirmExitExam(): Promise<boolean>
}

/** H5 protects browser history and refresh; WeChat's optional native prompt is managed separately. */
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
