import { describe, expect, it, vi } from 'vitest';
import { ExamAdminController } from '../src/modules/exams/exam-admin.controller';
import { ExamRecordsService, recordSummaryView } from '../src/modules/exams/exam-records.service';

const ROW = {
  record_id: '41', paper_id: '11', paper_title: '安全培训考试', user_id: '9',
  username: 'student9', name: '张三', source: 'institution', category_id: '7', difficulty: 'medium',
  release_id: '21', attempt_no: '2', started_at: '2026-10-22T09:00:00.000Z',
  deadline_at: '2026-10-22T09:30:00.000Z', submitted_at: '2026-10-22T09:20:00.000Z',
  answered_count: '3', total_count: '3', status: 'passed', grading_state: 'finalized',
  submission_method: 'manual', score: '100.00',
};

function serviceFixture(row: any = ROW) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: any = {};
  for (const method of [
    'innerJoin', 'select', 'addSelect', 'andWhere', 'where', 'orderBy', 'addOrderBy', 'offset', 'limit',
  ]) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  builder.getCount = vi.fn(async () => row ? 1 : 0);
  builder.getRawMany = vi.fn(async () => row ? [row] : []);
  builder.getRawOne = vi.fn(async () => row || null);
  const repo: any = { createQueryBuilder: vi.fn(() => builder) };
  return { service: new ExamRecordsService(repo), builder, calls };
}

describe('ExamRecordsService pure record projection', () => {
  it('returns record and scoring facts without monitoring or manual-grading fields', () => {
    const result = recordSummaryView(ROW);

    expect(result).toEqual({
      record_id: '41', paper_id: '11', paper_title: '安全培训考试', user_id: '9',
      username: 'student9', name: '张三', source: 'institution', category_id: '7', difficulty: 'medium',
      release_id: '21', attempt_no: 2, started_at: '2026-10-22T09:00:00.000Z',
      deadline_at: '2026-10-22T09:30:00.000Z', submitted_at: '2026-10-22T09:20:00.000Z',
      answered_count: 3, total_count: 3, status: 'passed', grading_state: 'finalized',
      submission_method: 'manual', score: 100,
    });
    for (const removed of [
      'connection_state', 'server_now', 'remaining_seconds', 'last_heartbeat_at',
      'switch_count', 'device_summary', 'grading_revision',
    ]) expect(result).not.toHaveProperty(removed);
  });

  it('lists records with pagination and supported filters while counting selected answers only', async () => {
    const { service, builder, calls } = serviceFixture();

    const page = await service.list('1', {
      page: 2, page_size: 10, keyword: '张', paper_id: '11', source: 'institution',
      difficulty: 'medium', status: 'passed', grading_state: 'finalized',
    });

    expect(page).toMatchObject({ total: 1, page: 2, page_size: 10, items: [expect.objectContaining({ record_id: '41' })] });
    expect(builder.offset).toHaveBeenCalledWith(10);
    expect(builder.limit).toHaveBeenCalledWith(10);
    expect(calls.some(({ method, args }) => method === 'addSelect'
      && String(args[0]).includes('JSON_LENGTH(record_answer.selected)'))).toBe(true);
    expect(calls.filter(({ method }) => method === 'andWhere')).toHaveLength(6);
  });

  it('returns a single record detail and reports a missing record', async () => {
    const existing = serviceFixture();
    await expect(existing.service.detail('1', '41')).resolves.toMatchObject({ record_id: '41', score: 100 });
    expect(existing.builder.where).toHaveBeenCalledWith('record.id = :recordId', { recordId: '41' });

    const missing = serviceFixture(null);
    await expect(missing.service.detail('1', '404')).rejects.toMatchObject({ code: 40401 });
  });
});

describe('ExamAdminController retained read-only result route', () => {
  it('delegates an administrator result read to ExamHistoryService', async () => {
    const history = { adminResult: vi.fn(async () => ({ record_id: '41', grading_state: 'finalized', score: 90 })) };
    const controller = new (ExamAdminController as any)({} as any, history);

    await expect((controller as any).result('41', { id: 8 })).resolves.toMatchObject({
      record_id: '41', grading_state: 'finalized', score: 90,
    });
    expect(history.adminResult).toHaveBeenCalledWith('8', '41');
  });
});
