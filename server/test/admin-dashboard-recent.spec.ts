import { describe, expect, it, vi } from 'vitest';
import { ExamRecord } from '../src/entities/exam-record.entity';
import { dashboardQueryFixture } from './support/dashboard-query-fixture';

const RULE = { totalCents: 10000, passCents: 6000, durationMinutes: 30, maxAttempts: 3, partialCreditRatio: 0.5,
  rules: [{ type: 'single' as const, count: 1, scoreCents: 10000 }] };
const record = (patch = {}): any => ({
  id: '1', paperId: '11', releaseId: '21', userId: '1', categoryId: '7', source: 'institution', difficulty: 'easy',
  ruleSnapshot: RULE, status: 'passed', gradingState: 'finalized', score: '40.00',
  startedAt: new Date('2026-10-27T00:00:00Z'), submittedAt: new Date('2026-10-27T00:10:00Z'),
  deadlineAt: new Date('2026-10-27T00:30:00Z'), gradedAt: new Date('2026-10-27T00:10:00Z'), submissionMethod: 'manual', ...patch,
});

describe('dashboard recent exams and shared scoring', () => {
  it('labels public latest releases and retains actual participation across learner categories', async () => {
    const { AdminDashboardService } = await import('../src/modules/statistics/admin-dashboard.service');
    const f = await dashboardQueryFixture(['statistics:read']);
    f.query.mockResolvedValue([
      { paper_id: '11', title: '公共考试', status: 'published', release_id: '21', pool_scope: 'public', category_id: null, rule_snapshot: RULE, released_at: new Date('2026-10-27T01:00:00Z') },
      { paper_id: '12', title: '历史未填写', status: 'published', release_id: '22', category_id: null, rule_snapshot: RULE, released_at: new Date('2026-10-26T01:00:00Z') },
    ]);
    vi.spyOn(f.source.getRepository(ExamRecord), 'find').mockResolvedValue([
      record({ categoryId: null, score: 80 }),
      record({ id: '2', userId: '2', categoryId: null, source: 'external', difficulty: 'hard', score: 90 }),
    ]);
    const result = await new AdminDashboardService(f.source, f.access as any).recentExams('9');
    expect(result.items[0]).toMatchObject({ pool_scope: 'public', category_id: null, category_name: '公共题库', participant_count: 2, finalized_users: 2, average_score: 85 });
    expect(result.items[1]).toMatchObject({ pool_scope: 'category', category_id: null, category_name: null, participant_count: 0, average_score: null });
    expect(f.query.mock.calls[0][0]).toContain('publication.pool_scope');
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it('summarizes only the selected release and uses one personal best across difficulties', async () => {
    const { summarizeReleaseRecords, statisticsRecordView } = await import('../src/modules/statistics/ranking');
    const records = [
      record(), record({ id: '2', score: '90.00', difficulty: 'hard' }),
      record({ id: '3', userId: '2', score: '100.00', ruleSnapshot: { ...RULE, passCents: 7000 } }),
      record({ id: '4', userId: '3', releaseId: '20', score: '100.00' }),
    ].map(statisticsRecordView);
    expect(summarizeReleaseRecords(records, '21', RULE)).toEqual({ participant_count: 2, finalized_users: 1, average_score: 90 });
    expect(summarizeReleaseRecords([], '21', RULE)).toEqual({ participant_count: 0, finalized_users: 0, average_score: null });
  });

  it('orders latest releases, retains archived and withdrawn exams and reads score fields in one batch', async () => {
    const { AdminDashboardService } = await import('../src/modules/statistics/admin-dashboard.service');
    const f = await dashboardQueryFixture(['statistics:read']);
    const exams = [
      { paper_id: '11', title: '已归档', status: 'archived', release_id: '21' },
      { paper_id: '12', title: '已撤回', status: 'withdrawn', release_id: '22' },
      { paper_id: '13', title: '已发布', status: 'published', release_id: '23' },
      { paper_id: '14', title: '已发布无成绩', status: 'published', release_id: '24' },
    ].map(row => ({ ...row, category_id: '7', rule_snapshot: RULE, released_at: new Date('2026-10-27T01:00:00Z') }));
    f.query.mockImplementation(async sql => sql.includes('FROM exam_paper') ? exams : [{ id: '7', name: '安全培训' }]);
    const read = vi.spyOn(f.source.getRepository(ExamRecord), 'find').mockResolvedValue([
      record(), record({ id: '2', score: '90.00' }), record({ id: '3', userId: '2', status: 'timeout', gradingState: 'not_submitted', score: '0.00', submittedAt: null }),
    ]);
    const result = await new AdminDashboardService(f.source, f.access as any).recentExams('9');
    expect(result.limit).toBe(4);
    expect(result.items.map(row => row.paper_id)).toEqual(['11', '12', '13', '14']);
    expect(result.items[0]).toMatchObject({ status: 'archived', category_name: '安全培训', total_score: 100,
      participant_count: 2, finalized_users: 1, average_score: 90, released_at: '2026-10-27T01:00:00.000Z' });
    expect(result.items[3].average_score).toBeNull();
    const [sql] = f.query.mock.calls[0];
    expect(sql).toContain('MAX(latest.version_no)');
    expect(sql).toMatch(/ORDER BY .*released_at DESC, .*id DESC LIMIT 4/);
    expect(sql).not.toMatch(/\b(?:JOIN|FROM)\s+paper_release\s+release\b/i);
    expect(sql).not.toContain("paper.status = 'published'");
    expect(read).toHaveBeenCalledTimes(1);
    const selection = read.mock.calls[0][0]?.select as string[];
    expect(selection).toContain('ruleSnapshot');
    expect(selection).toContain('gradedAt');
    expect(selection).not.toContain('snapshotJson');
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it('returns an empty list without reading score facts when there is no released exam', async () => {
    const { AdminDashboardService } = await import('../src/modules/statistics/admin-dashboard.service');
    const f = await dashboardQueryFixture(['statistics:read']);
    const read = vi.spyOn(f.source.getRepository(ExamRecord), 'find');
    expect(await new AdminDashboardService(f.source, f.access as any).recentExams('9')).toMatchObject({ limit: 4, items: [] });
    expect(read).not.toHaveBeenCalled();
    expect(f.query).toHaveBeenCalledTimes(1);
  });
});


it('filters formal recent exams before LIMIT and only uses frozen formal record scores', async () => {
  const { AdminDashboardService } = await import('../src/modules/statistics/admin-dashboard.service');
  const f = await dashboardQueryFixture(['statistics:read']);
  f.query.mockImplementation(async sql => sql.includes('FROM exam_paper') ? [{ paper_id: '11', title: '正式', status: 'published', release_id: '21', pool_scope: 'public', category_id: null, rule_snapshot: RULE, released_at: new Date('2026-10-27T01:00:00Z') }] : []);
  const read = vi.spyOn(f.source.getRepository(ExamRecord), 'find').mockResolvedValue([
    record({ score: 60 }), record({ id: '2', score: 100, examPurpose: 'practice' }), record({ id: '3', userId: '2', score: 100, examPurpose: 'practice' }),
  ]);
  expect(await new AdminDashboardService(f.source, f.access as any).recentExams('9')).toMatchObject({ items: [{ participant_count: 1, average_score: 60 }] });
  const sql = f.query.mock.calls[0][0];
  expect(sql.indexOf("paper.exam_purpose = 'formal'")).toBeGreaterThan(-1);
  expect(sql.indexOf("publication.exam_purpose = 'formal'")).toBeGreaterThan(-1);
  expect(sql.indexOf("publication.exam_purpose = 'formal'")).toBeLessThan(sql.indexOf('LIMIT 4'));
  expect(read.mock.calls[0][0]?.where).toMatchObject({ examPurpose: 'formal' });
});
