import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearExamEntryIntent, consumeExamEntryIntent, examEntryIntentFromRoute, examEntryIntentUrl, parseExamEntryIntent, readExamEntryIntent, reconcileExamEntryOwner, saveExamEntryIntent } from '../src/utils/exam-entry-intent'
import { navigateExamEntryIntent, resumeLearnerNavigation } from '../src/platform/navigation'

let storage: Map<string, unknown>
beforeEach(() => {
  storage = new Map()
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)), removeStorageSync: (key: string) => storage.delete(key),
    reLaunch: vi.fn(), redirectTo: vi.fn(), navigateTo: vi.fn(),
  })
})

describe('controlled exam entry intent', () => {
  it.each([
    'https://evil.invalid/', '//evil.invalid/', '/pages/exam/index', { kind: 'url', url: 'https://evil.invalid' },
    { kind: 'exam-tab', return_url: 'https://evil.invalid' }, { kind: 'exam-instructions', paperId: '../take' },
    { kind: 'exam-instructions', paperId: '1&jwt=secret' }, { kind: 'exam-instructions', paperId: '01' },
    { kind: 'exam-instructions', paperId: 7 }, { kind: 'exam-instructions', paperId: '7', recordId: '9' },
  ])('rejects arbitrary or expanded return target %j', input => {
    expect(parseExamEntryIntent(input)).toBeNull()
  })

  it('keeps the generic entry free of paper IDs and captures only a selected valid paper', () => {
    expect(examEntryIntentFromRoute('pages/exam/index', { paper_id: '7', return_url: 'https://evil.invalid' })).toEqual({ kind: 'exam-tab' })
    expect(examEntryIntentUrl({ kind: 'exam-tab' })).toBe('/pages/exam/index')
    expect(examEntryIntentFromRoute('/pages/exam/instructions', { paper_id: '9007199254740993' })).toEqual({ kind: 'exam-instructions', paperId: '9007199254740993' })
    expect(examEntryIntentFromRoute('pages/exam/take', { record_id: '88' })).toBeNull()
    expect(examEntryIntentFromRoute('https://evil.invalid', {})).toBeNull()
  })

  it('restores the selected target after a reload, consumes it only for its owner, and clears it on an account switch', () => {
    saveExamEntryIntent({ kind: 'exam-instructions', paperId: '7' }, '17')
    expect(readExamEntryIntent('17')).toEqual({ kind: 'exam-instructions', paperId: '7' })
    expect(readExamEntryIntent()).toBeNull()
    reconcileExamEntryOwner('18')
    expect(consumeExamEntryIntent('18')).toEqual({ kind: 'exam-tab' })
    expect(readExamEntryIntent('17')).toBeNull()
  })

  it('never persists a selected paper without an authenticated owner', () => {
    saveExamEntryIntent({ kind: 'exam-instructions', paperId: '7' })
    expect(readExamEntryIntent()).toEqual({ kind: 'exam-tab' })
    clearExamEntryIntent()
    expect(readExamEntryIntent()).toBeNull()
  })

  it('rejects an injected persisted external target rather than navigating to it', () => {
    saveExamEntryIntent({ kind: 'exam-tab' })
    const key = [...storage.keys()][0]!
    storage.set(key, { intent: { kind: 'exam-tab', url: 'https://evil.invalid' }, ownerId: null })
    expect(readExamEntryIntent()).toBeNull()
  })
})

describe('cross-platform return navigation', () => {
  it('uses reLaunch for the existing exam Tab and page navigation for an instructions target', () => {
    navigateExamEntryIntent({ kind: 'exam-tab' })
    expect(uni.reLaunch).toHaveBeenCalledWith({ url: '/pages/exam/index' })
    navigateExamEntryIntent({ kind: 'exam-instructions', paperId: '7' })
    expect(uni.redirectTo).toHaveBeenCalledWith({ url: '/pages/exam/instructions?paper_id=7' })
    expect(uni.navigateTo).not.toHaveBeenCalled()
  })

  it('preserves the Tab target during required name onboarding and resumes it after saving', () => {
    saveExamEntryIntent({ kind: 'exam-tab' })
    resumeLearnerNavigation({ id: 17, real_name: '', category_id: null })
    expect(uni.reLaunch).toHaveBeenLastCalledWith({ url: '/pages/profile/info?onboarding=1' })
    expect(readExamEntryIntent('17')).toEqual({ kind: 'exam-tab' })
    resumeLearnerNavigation({ id: 17, real_name: '学员', category_id: null })
    expect(uni.reLaunch).toHaveBeenLastCalledWith({ url: '/pages/exam/index' })
    expect(readExamEntryIntent('17')).toBeNull()
  })
})
