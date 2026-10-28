import { describe, expect, it } from 'vitest';
import {
  examRecordResultStatus, examRecordScoreLabel, canReadExamRecordResult,
  examRecordsFiltersFromRoute, examRecordsParams, examRecordsRouteQuery, safeExamRecordsReturnTo,
} from '../exam-records';

describe('exam record business display', () => {
  it.each([
    ['in_progress', 'not_submitted', 0, null, 'in_progress', '—', false],
    ['timeout', 'not_submitted', 0, null, 'timeout', '—', false],
    ['passed', 'finalized', 80, '2026-10-27T01:10:00Z', 'passed', '80 / 100 分', true],
    ['failed', 'finalized', 0, '2026-10-27T01:10:00Z', 'failed', '0 / 100 分', true],
  ] as const)('maps %s/%s/%s without fabricating a score', (status, grading_state, score, submitted_at, expectedStatus, expectedScore, readResult) => {
    const record = { status, grading_state, score, submitted_at, total_score: 100 };
    expect(examRecordResultStatus(record)).toBe(expectedStatus);
    expect(examRecordScoreLabel(record)).toBe(expectedScore);
    expect(canReadExamRecordResult(record)).toBe(readResult);
  });
  it('leaves unknown historical maximum scores unknown and does not turn null into zero', () => {
    expect(examRecordScoreLabel({ status: 'passed', grading_state: 'finalized', score: 80, submitted_at: null })).toBe('80 分');
    expect(examRecordScoreLabel({ status: 'failed', grading_state: 'finalized', score: null, submitted_at: null, total_score: 100 })).toBe('—');
  });
});

describe('exam record route boundaries', () => {
  it.each(['formal', 'practice'])('keeps the %s purpose when restoring and serializing filters', exam_purpose => {
    const filters = examRecordsFiltersFromRoute({ exam_purpose, paper_id: '7' });
    expect(examRecordsParams(filters)).toEqual({ page: 1, page_size: 20, paper_id: '7', exam_purpose });
    expect(examRecordsRouteQuery(filters).exam_purpose).toBe(exam_purpose);
  });
  it.each([undefined, 'all', 'bad', ['practice']])('drops invalid or absent purpose %s instead of creating an invisible filter', exam_purpose => {
    expect(examRecordsParams(examRecordsFiltersFromRoute(exam_purpose === undefined ? {} : { exam_purpose }))).toEqual({ page: 1, page_size: 20 });
  });

  it('keeps exact IDs and dates while excluding display-only labels and retired parameters from HTTP', () => {
    const filters = examRecordsFiltersFromRoute({ page: '3', page_size: '50', user_id: '9', paper_id: '7', category_id: '3', keyword: ' learner ', difficulty: 'hard', result_status: 'failed', date_from: '2026-10-26', date_to: '2026-10-27', learner_name: '学员甲', paper_title: '安全卷', source: 'external', status: 'submitted', grading_state: 'finalized' });
    expect(examRecordsParams(filters)).toEqual({ page: 3, page_size: 50, user_id: '9', paper_id: '7', category_id: '3', keyword: 'learner', difficulty: 'hard', result_status: 'failed', date_from: '2026-10-26', date_to: '2026-10-27' });
    expect(examRecordsRouteQuery(filters, { learner_name: '学员甲', paper_title: '安全卷' })).toMatchObject({ page: '3', page_size: '50', learner_name: '学员甲', paper_title: '安全卷' });
  });
  it('bounds malformed paging without accepting array query values', () => {
    const filters = examRecordsFiltersFromRoute({ page: '-2', page_size: '999', paper_id: ['7', '8'], keyword: null });
    expect(examRecordsParams(filters)).toEqual({ page: 1, page_size: 20 });
  });
  it.each(['medium', 'mixed', 'unknown'])('does not retain an invisible retired difficulty filter from %s links', (difficulty) => {
    const filters = examRecordsFiltersFromRoute({ difficulty, paper_id: '7' });
    expect(filters.difficulty).toBe('');
    expect(examRecordsParams(filters)).toEqual({ page: 1, page_size: 20, paper_id: '7' });
    expect(examRecordsParams({ ...filters, difficulty })).not.toHaveProperty('difficulty');
  });
  it.each(['legacy_pending', 'legacy_scored'])('does not apply retired status filter %s from bookmarks or form state', result_status => {
    const filters = examRecordsFiltersFromRoute({ result_status, paper_id: '7' });
    expect(filters.result_status).toBe('');
    expect(examRecordsParams(filters)).not.toHaveProperty('result_status');
    expect(examRecordsParams({ ...filters, result_status })).not.toHaveProperty('result_status');
  });
  it.each(['date_from', 'date_to'])('does not apply an incomplete range containing only %s', key => {
    const filters = examRecordsFiltersFromRoute({ [key]: '2026-10-27' });
    expect(filters.date_from).toBe(''); expect(filters.date_to).toBe('');
    expect(examRecordsParams(filters)).toEqual({ page: 1, page_size: 20 });
  });
  it.each([
    'https://example.com/admin/exam-records', '//example.com/admin/exam-records', '/admin/users',
    '/admin/exam-records/42', '/admin/exam-records/../users', '/admin/exam-records\\evil',
    '/admin/exam-records#external', '/admin/exam-records%3Fpaper_id=7',
  ])('restricts return target %s to the records list', value => {
    expect(safeExamRecordsReturnTo(value)).toBe('/admin/exam-records');
  });
  it('preserves encoded list filter labels and page positions without double decoding', () => {
    const target = '/admin/exam-records?paper_id=7&paper_title=%E5%AE%89%E5%85%A8%E5%8D%B7&page=3';
    expect(safeExamRecordsReturnTo(target)).toBe(target);
  });
});
