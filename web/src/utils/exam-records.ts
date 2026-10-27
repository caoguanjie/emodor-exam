import type { LocationQuery, LocationQueryRaw } from 'vue-router';
import type { ExamRecordResultStatus, ExamRecordSummary } from '../api/training-types';

type RecordFacts = Pick<ExamRecordSummary, 'status' | 'grading_state' | 'score' | 'submitted_at'>
  & Partial<Pick<ExamRecordSummary, 'result_status' | 'total_score'>>;

export const examRecordResultOptions: Array<{ value: ExamRecordResultStatus; label: string }> = [
  { value: 'in_progress', label: '进行中' },
  { value: 'passed', label: '已通过' },
  { value: 'failed', label: '未通过' },
  { value: 'timeout', label: '超时未交卷' },
];
export const examRecordDifficultyOptions = [
  { value: 'easy', label: '简单' }, { value: 'hard', label: '困难' },
];

export function examRecordResultStatus(record: RecordFacts): ExamRecordResultStatus {
  return record.result_status || record.status;
}

export function examRecordResultLabel(record: RecordFacts): string {
  const status = examRecordResultStatus(record);
  return examRecordResultOptions.find(item => item.value === status)?.label || '状态未知';
}

export function examRecordResultType(record: RecordFacts): 'success' | 'danger' | 'primary' | 'warning' | 'info' {
  const status = examRecordResultStatus(record);
  if (status === 'passed') return 'success';
  if (status === 'failed' || status === 'timeout') return 'danger';
  if (status === 'in_progress') return 'primary';
  return 'info';
}

export function examRecordScoreLabel(record: RecordFacts): string {
  const status = examRecordResultStatus(record);
  if (record.grading_state !== 'finalized' || status === 'in_progress' || status === 'timeout'
    || record.score == null || !Number.isFinite(record.score)) return '—';
  return record.total_score != null && Number.isFinite(record.total_score)
    ? `${record.score} / ${record.total_score} 分` : `${record.score} 分`;
}

export function canReadExamRecordResult(record: RecordFacts): boolean {
  const status = examRecordResultStatus(record);
  return (status === 'passed' || status === 'failed') && record.grading_state === 'finalized';
}

export interface ExamRecordsFilters {
  page: number;
  page_size: number;
  keyword: string;
  paper_id: string;
  user_id: string;
  category_id: string;
  difficulty: string;
  result_status: string;
  date_from: string;
  date_to: string;
}

function queryText(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function activeDifficulty(value: unknown): string {
  const difficulty = queryText(value);
  return examRecordDifficultyOptions.some(option => option.value === difficulty) ? difficulty : '';
}
function activeResultStatus(value: unknown): string {
  const status = queryText(value);
  return examRecordResultOptions.some(option => option.value === status) ? status : '';
}

export function examRecordsFiltersFromRoute(route: LocationQuery): ExamRecordsFilters {
  const page = Number(queryText(route.page));
  const size = Number(queryText(route.page_size));
  const dateFrom = queryText(route.date_from);
  const dateTo = queryText(route.date_to);
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    page_size: [20, 50, 100].includes(size) ? size : 20,
    keyword: queryText(route.keyword), paper_id: queryText(route.paper_id), user_id: queryText(route.user_id),
    category_id: queryText(route.category_id), difficulty: activeDifficulty(route.difficulty),
    result_status: activeResultStatus(route.result_status), date_from: dateFrom && dateTo ? dateFrom : '', date_to: dateFrom && dateTo ? dateTo : '',
  };
}

export function examRecordsParams(filters: ExamRecordsFilters): Record<string, string | number> {
  const params: Record<string, string | number> = { page: filters.page, page_size: filters.page_size };
  for (const key of ['keyword', 'paper_id', 'user_id', 'category_id', 'difficulty', 'result_status', 'date_from', 'date_to'] as const) {
    if ((key === 'date_from' || key === 'date_to') && !(filters.date_from && filters.date_to)) continue;
    const value = key === 'difficulty' ? activeDifficulty(filters[key]) : key === 'result_status' ? activeResultStatus(filters[key]) : filters[key].trim();
    if (value) params[key] = value;
  }
  return params;
}

export function examRecordsRouteQuery(filters: ExamRecordsFilters, hints: { paper_title?: string; learner_name?: string } = {}): LocationQueryRaw {
  const query: LocationQueryRaw = Object.fromEntries(Object.entries(examRecordsParams(filters)).map(([key, value]) => [key, String(value)]));
  if (filters.paper_id && hints.paper_title) query.paper_title = hints.paper_title;
  if (filters.user_id && hints.learner_name) query.learner_name = hints.learner_name;
  return query;
}

/** Only the records list can be a destination, including when a detail URL is opened directly. */
export function safeExamRecordsReturnTo(value: unknown): string {
  const fallback = '/admin/exam-records';
  if (typeof value !== 'string' || !/^\/admin\/exam-records(?:\?|$)/.test(value) || /[\\#\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, 'https://exam-records.invalid');
    return parsed.pathname === fallback ? `${parsed.pathname}${parsed.search}` : fallback;
  } catch { return fallback; }
}

export function formatExamRecordTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'Asia/Shanghai',
  }).format(date);
}
