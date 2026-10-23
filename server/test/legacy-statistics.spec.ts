import { describe, expect, it } from 'vitest';
import { StatisticsService } from '../src/modules/statistics/statistics.service';

function fixture() {
  const submittedAt = new Date('2026-10-22T02:00:00.000Z');
  const rows: any[] = [
    { id: '101', userId: '1', paperId: '11', regulationId: '2', attemptNo: 1, status: 'passed', gradingState: 'finalized', score: '80.00', submittedAt },
    { id: '102', userId: '2', paperId: '11', regulationId: '2', attemptNo: 1, status: 'timeout', gradingState: 'not_submitted', score: '0.00', submittedAt: null },
    { id: '103', userId: '3', paperId: '11', regulationId: '2', attemptNo: 1, status: 'timeout', gradingState: 'finalized', score: '90.00', submissionMethod: 'timeout', submittedAt },
    { id: '104', userId: '4', paperId: '11', regulationId: '2', attemptNo: 1, status: 'timeout', gradingState: 'finalized', score: '40.00', submissionMethod: null, submittedAt },
    { id: '105', userId: '1', paperId: '11', regulationId: '2', attemptNo: 2, status: 'timeout', gradingState: 'not_submitted', score: '0.00', submittedAt: null },
  ];
  const users: any[] = ['1', '2', '3', '4'].map((id) => ({ id, username: `u${id}`, realName: `学员${id}`, role: 'employee', status: 1, departmentId: '7' }));
  const reg: any = { id: '2', title: '旧制度', requiredMinutes: 1, scrollSegments: 10 };
  const papers: any[] = [{ id: '11', regulationId: '2', title: '旧制度卷', passScore: '60.00' }];
  const records: any[] = users.map((user) => ({ userId: user.id, regulationId: '2', isValid: 1, totalSeconds: 60, scrollCoverage: { total_segments: 10, covered: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] } }));
  const query = { where() { return this; }, andWhere() { return this; }, getMany: async () => rows };
  const service = new StatisticsService(
    { findOne: async () => reg, find: async () => [reg] } as any,
    { find: async () => [{ isAll: 1 }] } as any,
    { find: async () => records } as any,
    { createQueryBuilder: () => query, find: async ({ where }: any) => rows.filter((row) => String(row.userId) === String(where.userId)) } as any,
    { find: async () => papers } as any,
    { find: async () => users, findOne: async ({ where }: any) => users.find((user) => user.id === where.id) } as any,
    { find: async () => [{ id: '7', name: '旧部门' }] } as any,
    {} as any, {} as any,
  );
  return { service };
}

describe('legacy statistics scored-result boundary', () => {
  it('excludes pure timeout from overview denominators, means and buckets while retaining graded historical timeout', async () => {
    const { service } = fixture();
    expect((await service.computeOverview('2')).exam).toEqual({ participant_count: 3, participation_rate: 0.75, passed_count: 2, pass_rate: 0.667, average_score: 70, score_distribution: { '[0,60)': 1, '[60,70)': 0, '[70,80)': 0, '[80,90)': 1, '[90,100]': 1 } });
  });

  it('uses the same scored facts in departmental averages and pass rates', async () => {
    const { service } = fixture();
    expect((await service.departmentBreakdown('2')).list[0]).toMatchObject({ assigned_count: 4, participant_count: 3, passed_count: 2, pass_rate: 0.667, average_score: 70 });
  });

  it('keeps a timeout-only learner out of best-score and export results without deleting their attempt history', async () => {
    const { service } = fixture();
    const personal = await service.personal('2');
    expect(personal.exams[0]).toMatchObject({ attempts: 1, best_score: null, has_passed: false, records: [{ status: 'timeout', score: 0 }] });
    const details = await service.regulationUserDetails('2');
    expect(details.find((row) => row.name === '学员2')).toMatchObject({ attempts: 1, best: '—', status: '未参考', paper: '' });
    expect((await service.personal('3')).exams[0]).toMatchObject({ best_score: 90 });
    expect(details.find((row) => row.name === '学员3')).toMatchObject({ best: 90, status: 'timeout' });
  });

  it('classifies a learner with only pure timeout as having no scored result', async () => {
    const { service } = fixture();
    expect((await service.uncompletedList('2')).list.find((row) => row?.user_id === 2)).toMatchObject({ best_score: null, exam_status: null, type: '未参考' });
  });
});
