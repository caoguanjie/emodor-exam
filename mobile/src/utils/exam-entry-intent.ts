export type ExamEntryIntent = { kind: 'exam-tab' } | { kind: 'exam-instructions'; paperId: string }

const STORAGE_KEY = 'ruleexam:mobile:exam-entry-intent:v1'
const validId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,31}$/.test(value)

/** Accept a small navigation contract, never a caller-supplied URL or record. */
export function parseExamEntryIntent(value: unknown): ExamEntryIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>, keys = Object.keys(input)
  if (input.kind === 'exam-tab' && keys.length === 1) return { kind: 'exam-tab' }
  if (input.kind === 'exam-instructions' && keys.length === 2 && validId(input.paperId)) return { kind: 'exam-instructions', paperId: input.paperId }
  return null
}

export function examEntryIntentFromRoute(path: string | undefined, query: Record<string, unknown> = {}): ExamEntryIntent | null {
  if (path === 'pages/exam/index' || path === '/pages/exam/index') return { kind: 'exam-tab' }
  if (path === 'pages/exam/instructions' || path === '/pages/exam/instructions') return parseExamEntryIntent({ kind: 'exam-instructions', paperId: query.paper_id })
  return null
}

export function examEntryIntentUrl(intent: ExamEntryIntent): string {
  const target = parseExamEntryIntent(intent)
  return target?.kind === 'exam-instructions' ? `/pages/exam/instructions?paper_id=${encodeURIComponent(target.paperId)}` : '/pages/exam/index'
}

function storedIntent(): { intent: ExamEntryIntent; ownerId: string | null } | null {
  try {
    const value = uni.getStorageSync?.(STORAGE_KEY)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const intent = parseExamEntryIntent(value.intent)
    if (!intent || Object.keys(value).some(key => key !== 'intent' && key !== 'ownerId')) return null
    if (value.ownerId !== null && !validId(value.ownerId)) return null
    if (intent.kind === 'exam-instructions' && !validId(value.ownerId)) return null
    return { intent, ownerId: value.ownerId }
  } catch { return null }
}

export function saveExamEntryIntent(value: ExamEntryIntent, ownerId?: string): void {
  const intent = parseExamEntryIntent(value)
  if (!intent) { clearExamEntryIntent(); return }
  const owner = validId(ownerId) ? ownerId : null
  // A selected paper belongs to an authenticated account. Anonymous entry is the Tab.
  const target: ExamEntryIntent = intent.kind === 'exam-instructions' && !owner ? { kind: 'exam-tab' } : intent
  try { uni.setStorageSync(STORAGE_KEY, { intent: target, ownerId: target.kind === 'exam-instructions' ? owner : null }) } catch { /* Navigation still works if local storage is unavailable. */ }
}

export function readExamEntryIntent(ownerId?: string): ExamEntryIntent | null {
  const saved = storedIntent()
  return saved && (saved.ownerId === null || saved.ownerId === ownerId) ? saved.intent : null
}

export function clearExamEntryIntent(): void {
  try { if (uni.getStorageSync?.(STORAGE_KEY)) uni.removeStorageSync(STORAGE_KEY) } catch { /* No credentials or exam data are persisted here. */ }
}

export function reconcileExamEntryOwner(ownerId: string): void {
  const saved = storedIntent()
  if (saved?.ownerId && saved.ownerId !== ownerId) saveExamEntryIntent({ kind: 'exam-tab' })
}

export function consumeExamEntryIntent(ownerId: string): ExamEntryIntent | null {
  const intent = readExamEntryIntent(ownerId)
  clearExamEntryIntent()
  return intent
}
