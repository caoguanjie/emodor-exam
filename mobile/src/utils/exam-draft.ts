import type { ExamAnswers } from '@/types/exam'

export interface LocalExamDraft { answers: ExamAnswers; currentIndex: number; savedAt: string }
interface DraftQuestion { item_id: string; type: string; options: { id: string }[] }
const tails = new Map<string, Promise<unknown>>()
const userGeneration = new Map<string, number>(), recordGeneration = new Map<string, number>()
const knownRecords = new Map<string, Set<string>>()
export const draftKey = (user: string, record: string) => `ruleexam:mobile:${user}:exam-draft:${record}`
const indexKey = (user: string) => `ruleexam:mobile:${user}:exam-draft-index`
function enqueue<T>(user: string, operation: () => Promise<T>): Promise<T> {
  const pending = (tails.get(user) || Promise.resolve()).catch(() => {}).then(operation)
  tails.set(user, pending.catch(() => {}))
  return pending
}
function read(key: string): Promise<unknown> { return new Promise(resolve => uni.getStorage({ key, success: o => resolve(o.data), fail: () => resolve(null) })) }
function write(key: string, data: unknown): Promise<void> { return new Promise((resolve, reject) => uni.setStorage({ key, data, success: () => resolve(), fail: () => reject(new Error('草稿保存失败，请保持页面打开并重试')) })) }
function remove(key: string): Promise<void> { return new Promise((resolve, reject) => uni.removeStorage({ key, success: () => resolve(), fail: () => reject(new Error('草稿清理失败，请重试')) })) }
function index(value: unknown): string[] { return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && /^[1-9]\d*$/.test(id)))] : [] }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function copy(draft: LocalExamDraft): LocalExamDraft { return { answers: Object.fromEntries(Object.entries(draft.answers).map(([id, ids]) => [id, [...ids]])), currentIndex: draft.currentIndex, savedAt: draft.savedAt } }

export function saveDraft(user: string, record: string, draft: LocalExamDraft): Promise<void> {
  const snapshot = copy(draft), key = draftKey(user, record)
  const generation = userGeneration.get(user), revision = recordGeneration.get(key)
  const known = knownRecords.get(user) || new Set<string>(); known.add(record); knownRecords.set(user, known)
  return enqueue(user, async () => {
    const valid = () => generation === userGeneration.get(user) && revision === recordGeneration.get(key)
    if (!valid()) return
    // Register before writing the draft, so a successful draft can always be found at logout.
    const records = index(await read(indexKey(user)))
    if (!valid()) return
    if (!records.includes(record)) await write(indexKey(user), [...records, record])
    if (valid()) await write(key, snapshot)
  })
}

export function loadDraft(user: string, record: string, questions: DraftQuestion[]): Promise<LocalExamDraft | null> {
  return enqueue(user, async () => {
    const value = await read(draftKey(user, record))
    if (!object(value) || Object.keys(value).sort().join(',') !== 'answers,currentIndex,savedAt' || !object(value.answers)
      || !Number.isInteger(value.currentIndex) || (value.currentIndex as number) < 0 || (value.currentIndex as number) >= questions.length
      || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))) return null
    for (const [id, ids] of Object.entries(value.answers)) {
      const question = questions.find(q => q.item_id === id)
      if (!question || !Array.isArray(ids) || ids.some(option => typeof option !== 'string' || !question.options.some(o => o.id === option))
        || new Set(ids).size !== ids.length || (question.type !== 'multiple' && ids.length > 1)) return null
    }
    return copy(value as unknown as LocalExamDraft)
  })
}

export function clearDraft(user: string, record: string): Promise<void> {
  const key = draftKey(user, record)
  recordGeneration.set(key, (recordGeneration.get(key) || 0) + 1)
  return enqueue(user, async () => {
    await remove(key)
    await write(indexKey(user), index(await read(indexKey(user))).filter(id => id !== record))
    knownRecords.get(user)?.delete(record)
  })
}

export function clearUserDrafts(user: string): Promise<void> {
  userGeneration.set(user, (userGeneration.get(user) || 0) + 1)
  return enqueue(user, async () => {
    const records = new Set([...index(await read(indexKey(user))), ...(knownRecords.get(user) || [])])
    for (const record of records) await remove(draftKey(user, record))
    await remove(indexKey(user)); knownRecords.delete(user)
  })
}
