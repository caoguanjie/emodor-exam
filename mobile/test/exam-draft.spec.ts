import { beforeEach, describe, expect, it, vi } from 'vitest'

const path = '../src/utils/' + 'exam-draft.ts'
const draft = { answers: { '101': ['choice-b'] }, currentIndex: 0, savedAt: '2026-10-22T10:00:00.000Z' }
const questions = [{ item_id: '101', type: 'single', options: [{ id: 'choice-a' }, { id: 'choice-b' }] }]
const values = new Map<string, unknown>()
beforeEach(() => {
  values.clear()
  vi.stubGlobal('uni', {
    setStorage: vi.fn((o: any) => { values.set(o.key, structuredClone(o.data)); o.success?.({}) }),
    getStorage: vi.fn((o: any) => values.has(o.key) ? o.success({ data: structuredClone(values.get(o.key)) }) : o.fail({ errMsg: 'not found' })),
    removeStorage: vi.fn((o: any) => { values.delete(o.key); o.success?.({}) }),
  })
})
describe('local exam draft boundary', () => {
  it('stores the minimal snapshot and index under the current user only', async () => {
    const { saveDraft = async () => {}, loadDraft = async () => null } = await import(path).catch(() => ({}))
    await saveDraft('17', '81', draft)
    expect(values.get('ruleexam:mobile:17:exam-draft:81')).toEqual(draft)
    expect(values.get('ruleexam:mobile:17:exam-draft-index')).toEqual(['81'])
    expect(await loadDraft('18', '81', questions)).toBeNull()
    expect(await loadDraft('17', '81', questions)).toEqual(draft)
  })
  it('rejects the entire draft on unknown IDs, duplicate choices or extra fields', async () => {
    const { loadDraft = async () => ({ partial: true }) } = await import(path).catch(() => ({}))
    for (const bad of [
      { ...draft, answers: { '101': ['choice-b'], '102': [] } },
      { ...draft, answers: { '101': ['unknown'] } },
      { ...draft, answers: { '101': ['choice-a', 'choice-a'] } },
      { ...draft, answers: { '101': ['choice-a', 'choice-b'] } },
      { ...draft, deadline: 'later' }, { ...draft, currentIndex: 8 }, 'corrupt',
    ]) {
      values.set('ruleexam:mobile:17:exam-draft:81', bad)
      expect(await loadDraft('17', '81', questions)).toBeNull()
    }
  })
  it('clones each snapshot and serializes older storage writes before newer ones', async () => {
    const { saveDraft = async () => {} } = await import(path).catch(() => ({}))
    let release: () => void = () => {}
    const written: unknown[] = []
    uni.setStorage = vi.fn((o: any) => {
      if (o.key.endsWith(':81') && written.length === 0) { written.push(o.data); release = () => { values.set(o.key, o.data); o.success({}) }; return }
      values.set(o.key, o.data); if (o.key.endsWith(':81')) written.push(o.data); o.success({})
    })
    const first = structuredClone(draft), pending = saveDraft('17', '81', first)
    first.answers['101'] = ['choice-a']
    const second = saveDraft('17', '81', first)
    await vi.waitFor(() => expect(written).toHaveLength(1))
    expect(written[0]).toEqual(draft)
    release(); await Promise.all([pending, second])
    expect(values.get('ruleexam:mobile:17:exam-draft:81')).toEqual({ ...draft, answers: { '101': ['choice-a'] } })
  })
  it('terminal cleanup tombstones an in-flight write so it cannot resurrect a draft', async () => {
    const { saveDraft = async () => {}, clearDraft = async () => {} } = await import(path).catch(() => ({}))
    let release: () => void = () => {}, started = false
    uni.setStorage = vi.fn((o: any) => { if (o.key.endsWith(':81')) { started = true; release = () => { values.set(o.key, o.data); o.success({}) } } else { values.set(o.key, o.data); o.success({}) } })
    const pending = saveDraft('17', '81', draft)
    await vi.waitFor(() => expect(started).toBe(true))
    const cleanup = clearDraft('17', '81')
    release(); await Promise.all([pending, cleanup])
    expect(values.has('ruleexam:mobile:17:exam-draft:81')).toBe(false)
    expect(values.get('ruleexam:mobile:17:exam-draft-index')).toEqual([])
  })
  it('logout clears indexed drafts for only that user and surfaces write failure', async () => {
    const { saveDraft = async () => {}, clearUserDrafts = async () => {} } = await import(path).catch(() => ({}))
    await saveDraft('17', '81', draft); await saveDraft('17', '82', draft); await saveDraft('18', '81', draft)
    await clearUserDrafts('17')
    expect([...values.keys()]).toEqual(['ruleexam:mobile:18:exam-draft-index', 'ruleexam:mobile:18:exam-draft:81'])
    uni.setStorage = vi.fn((o: any) => o.fail({ errMsg: 'full' }))
    await expect(saveDraft('18', '82', draft)).rejects.toThrow()
  })
})
