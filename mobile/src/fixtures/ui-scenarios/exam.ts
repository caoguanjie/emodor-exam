import { ref } from 'vue'
import { textDoc, type ReadonlyTiptapDoc } from '@/types/content'
import type { ExamAnswers, ExamReviewItem, ExamTakeItem } from '@/types/exam'

export const examTitle = '2026 年第四季度消防安全专项考试'
export const examAssets: Record<string, string> = {
  'sign-prohibition': '/static/exam/question-bank-prohibition-no-riding.png',
  'sign-caution': '/static/exam/question-bank-warning-caution.png',
  'sign-fire': '/static/exam/question-bank-warning-fire.png',
  'sign-helmet': '/static/exam/question-bank-mandatory-safety-helmet.png',
}
const options = (values: string[], prefix: string) => values.map((value, index) => ({ id: `${prefix}-${index + 1}`, content: textDoc(value) }))
const three: ExamTakeItem = { id: 'item-1', type: 'single', score: 5, stem: textDoc('新进场的劳动者必须经过“三级”安全教育，即公司教育、（  ）、班组教育。'), options: options(['技术教育', '专业教育', '项目教育'], 'education') }
const four: ExamTakeItem = { id: 'item-2', type: 'single', score: 5, stem: textDoc('安全教育培训的目的是提高员工的安全素质，防患于未然，使员工努力做到（  ）。'), options: options(['事不关己，高高挂起', '保证自己安全，不伤害自己', '保护自己，不被他人伤害', '不伤害自己，不伤害他人，不被他人伤害，保护他人不受伤害'], 'safety') }
const fire: ExamTakeItem = { id: 'item-3', type: 'single', score: 5, stem: textDoc('发现初起火灾时，在确保自身安全的前提下，应首先采取的措施是？'), options: options(['立即离开现场，等待消防人员到达', '大声呼救并拨打 119 报警，同时就近使用灭火器扑救', '先回工位收拾贵重物品再撤离', '乘坐电梯迅速撤离到首层'], 'fire') }
const images: ExamTakeItem = { id: 'item-4', type: 'single', score: 5, imageOptions: true, stem: textDoc('下列属于禁止标志的选项是（  ）'), options: ['sign-prohibition', 'sign-caution', 'sign-fire', 'sign-helmet'].map(asset => ({ id: `option-${asset}`, content: { type: 'doc', content: [{ type: 'image', attrs: { asset_id: asset } }] } })) }
const multiple: ExamTakeItem = { id: 'item-11', type: 'multiple', score: 6, stem: textDoc('下列干粉灭火器的使用方法正确的有？'), options: options(['拔掉保险销，一手握住喷管', '站在火源下风方向进行喷射', '对准火焰根部左右扫射', '压把压下后可倒置使用'], 'extinguisher') }
const judgment: ExamTakeItem = { id: 'item-19', type: 'judgment', score: 4, stem: textDoc('遇六级及以上大风天气，应停止脚手架搭设与拆除作业。'), options: [{ id: 'judgment-true', content: textDoc('正确') }, { id: 'judgment-false', content: textDoc('错误') }] }
export const examTakeItems: ExamTakeItem[] = Array.from({ length: 20 }, (_, index) => {
  const base = index === 0 ? three : index === 1 ? four : index === 3 ? images : index < 10 ? fire : index < 15 ? multiple : judgment
  return { ...base, id: `item-${index + 1}` }
})

// Only the post-exam review fixture contains grading and analysis.
export const examReviewItems: ExamReviewItem[] = examTakeItems.map((item, index) => {
  const right = item.type === 'judgment' ? ['judgment-true'] : item.type === 'multiple' ? ['extinguisher-1', 'extinguisher-3'] : item.imageOptions ? ['option-sign-prohibition'] : index === 0 ? ['education-3'] : index === 1 ? ['safety-4'] : ['fire-2']
  const selected = index === 19
    ? []
    : item.type === 'multiple'
      ? index <= 12 ? [...right] : ['extinguisher-1', 'extinguisher-2']
      : index === 3 ? [item.options[1].id] : [...right]
  const isCorrect = selected.length > 0 && [...selected].sort().join('|') === [...right].sort().join('|')
  return { item, correctOptionIds: right, selectedOptionIds: selected, earnedScore: isCorrect ? item.score : 0,
    analysis: textDoc(item.type === 'multiple'
      ? '使用干粉灭火器应站在上风方向，对准火焰根部由近及远左右扫射；灭火器不可倒置使用，否则无法正常喷粉。'
      : item.type === 'judgment'
        ? `原文将本题标记为“√”。${selected.length ? '本题回答正确' : '本题未作答'}，原文件未提供逐题解析。`
        : `原题正确答案：${item.imageOptions ? 'A' : index === 0 ? 'C' : index === 1 ? 'D' : 'B'}。原文件未附逐题解析。`),
    source: item.type === 'multiple' ? '出题资料 ·《消防安全培训讲义》v3 · 第 4.2 节' : `题库来源 · 0915 产业工人质量安全培训考题题库 · ${item.type === 'judgment' ? '判断1' : `单选${index + 1}`}` }
})

const reviewTypes = [
  { type: 'single' as const, title: '单选题' },
  { type: 'multiple' as const, title: '多选题' },
  { type: 'judgment' as const, title: '判断题' },
]
export const examReviewSummary = {
  score: examReviewItems.reduce((total, row) => total + row.earnedScore, 0),
  totalScore: examReviewItems.reduce((total, row) => total + row.item.score, 0),
  correct: examReviewItems.filter(row => row.earnedScore > 0).length,
  wrong: examReviewItems.filter(row => row.selectedOptionIds.length > 0 && row.earnedScore === 0).length,
  unanswered: examReviewItems.filter(row => row.selectedOptionIds.length === 0).length,
  accuracy: Math.round(examReviewItems.filter(row => row.earnedScore > 0).length / examReviewItems.length * 100),
  typeRows: reviewTypes.map(({ type, title }) => {
    const rows = examReviewItems.filter(row => row.item.type === type)
    return {
      type, title,
      correct: rows.filter(row => row.earnedScore > 0).length,
      count: rows.length,
      score: rows.reduce((total, row) => total + row.earnedScore, 0),
      totalScore: rows.reduce((total, row) => total + row.item.score, 0),
    }
  }),
}

export interface ExamScenario { id: string; group: 'center' | 'instructions' | 'take' | 'result' | 'review' | 'history' | 'wrong'; questionIndex?: number; overlay?: 'card' | 'submit' | 'exit' | 'timeout' | 'submitting' | 'submit-failed' | 'recover' | 'invalid'; state?: 'empty' | 'load-failed' | 'expired' | 'not-started' | 'unavailable' | 'missing'; remaining?: number }
export const examScenarios: Record<string, ExamScenario> = {
  'exam-center': { id: 'exam-center', group: 'center' },
  'exam-center-empty': { id: 'exam-center-empty', group: 'center', state: 'empty' },
  'exam-not-started': { id: 'exam-not-started', group: 'center', state: 'not-started' },
  'exam-instructions': { id: 'exam-instructions', group: 'instructions' },
  'exam-draft-recover': { id: 'exam-draft-recover', group: 'instructions', overlay: 'recover' },
  'exam-draft-invalid': { id: 'exam-draft-invalid', group: 'instructions', overlay: 'invalid' },
  'exam-single': { id: 'exam-single', group: 'take', questionIndex: 0 },
  'exam-single-four': { id: 'exam-single-four', group: 'take', questionIndex: 1, remaining: 1122 },
  'exam-multiple': { id: 'exam-multiple', group: 'take', questionIndex: 10 },
  'exam-judgment': { id: 'exam-judgment', group: 'take', questionIndex: 18, remaining: 179 },
  'exam-images': { id: 'exam-images', group: 'take', questionIndex: 3 },
  'exam-answer-card': { id: 'exam-answer-card', group: 'take', questionIndex: 2, overlay: 'card' },
  'exam-submit-confirm': { id: 'exam-submit-confirm', group: 'take', questionIndex: 18, overlay: 'submit', remaining: 179 },
  'exam-exit-confirm': { id: 'exam-exit-confirm', group: 'take', questionIndex: 2, overlay: 'exit' },
  'exam-timeout': { id: 'exam-timeout', group: 'take', questionIndex: 18, overlay: 'timeout', remaining: 0 },
  'exam-submitting': { id: 'exam-submitting', group: 'take', questionIndex: 18, overlay: 'submitting', remaining: 179 },
  'exam-submit-failed': { id: 'exam-submit-failed', group: 'take', questionIndex: 18, overlay: 'submit-failed', remaining: 161 },
  'exam-load-failed': { id: 'exam-load-failed', group: 'take', questionIndex: 2, state: 'load-failed' },
  'exam-session-expired': { id: 'exam-session-expired', group: 'take', state: 'expired' },
  'exam-result': { id: 'exam-result', group: 'result' },
  'exam-result-unavailable': { id: 'exam-result-unavailable', group: 'result', state: 'unavailable' },
  'exam-record-missing': { id: 'exam-record-missing', group: 'result', state: 'missing' },
  'exam-review-single': { id: 'exam-review-single', group: 'review', questionIndex: 0 },
  'exam-review-four': { id: 'exam-review-four', group: 'review', questionIndex: 1 },
  'exam-review-judgment': { id: 'exam-review-judgment', group: 'review', questionIndex: 18 },
  'exam-review-images': { id: 'exam-review-images', group: 'review', questionIndex: 3 },
  'exam-review-multiple': { id: 'exam-review-multiple', group: 'review', questionIndex: 10 },
  'exam-review-card': { id: 'exam-review-card', group: 'review', questionIndex: 10, overlay: 'card' },
  'exam-history': { id: 'exam-history', group: 'history' },
  'exam-history-empty': { id: 'exam-history-empty', group: 'history', state: 'empty' },
  'exam-wrong-book': { id: 'exam-wrong-book', group: 'wrong' },
  'exam-wrong-empty': { id: 'exam-wrong-empty', group: 'wrong', state: 'empty' },
  'exam-wrong-failed': { id: 'exam-wrong-failed', group: 'wrong', state: 'load-failed' },
}
export function resolveExamScenario(query: unknown, fallback: string): ExamScenario {
  const baseline = examScenarios[fallback] || examScenarios['exam-center']
  const selected = typeof query === 'string' ? examScenarios[query] : undefined
  return { ...(selected?.group === baseline.group ? selected : baseline) }
}
export function useExamScenario(fallback: string) {
  const scenario = ref(resolveExamScenario(undefined, fallback))
  return { scenario, loadScenario(query?: Record<string, unknown>) { scenario.value = resolveExamScenario(query?.scenario, fallback) } }
}
export function initialExamAnswers(scenario: ExamScenario): ExamAnswers {
  if (scenario.id === 'exam-single') return { 'item-1': ['education-3'] }
  if (scenario.id === 'exam-images') return { 'item-4': ['option-sign-caution'] }
  if (scenario.id === 'exam-multiple') return { 'item-11': ['extinguisher-1', 'extinguisher-3'] }
  if (scenario.id === 'exam-judgment') return { 'item-19': ['judgment-true'] }
  return Object.fromEntries(examTakeItems.slice(0, 15).map(item => [item.id, [item.options[0].id]]))
}
export const examHistory = [
  { title: examTitle, score: 79, time: '10-21 14:28' }, { title: '有限空间作业安全规程测试', score: 72, time: '10-18 09:12' },
  { title: '消防与应急逃生专项测试', score: 54, time: '10-12 16:40' }, { title: '产业工人综合答题练习', score: 92, time: '10-09 10:05' },
]
export const wrongBookItems: ExamReviewItem[] = [
  { item: { id: 'wrong-1', type: 'single', score: 5, stem: textDoc('火灾发生时，下列逃生做法正确的是？'), options: options(['乘坐电梯快速下楼', '用湿毛巾捂住口鼻，低姿沿疏散通道撤离', '躲进卫生间等待救援'], 'escape') }, correctOptionIds: ['escape-2'], selectedOptionIds: ['escape-1'], earnedScore: 0, analysis: textDoc(''), source: '消防与应急逃生 · 第 3 题' },
  { item: { ...judgment, id: 'wrong-2', stem: textDoc('电气设备着火时，可以直接用水扑救。') }, correctOptionIds: ['judgment-false'], selectedOptionIds: [], earnedScore: 0, analysis: textDoc(''), source: '综合答题练习 · 第 18 题' },
]
