import { describe, expect, it } from 'vitest';
import { dashboardQueryFixture } from './support/dashboard-query-fixture';

const NOW = new Date('2026-10-27T02:00:00.000Z');

describe('AdminDashboardService overview and trend', () => {
  it('counts people and attempts independently using the record-list scope', async () => {
    const { AdminDashboardService } = await import('../src/modules/statistics/admin-dashboard.service');
    const f = await dashboardQueryFixture(['students:read', 'questions:read', 'papers:read', 'statistics:read']);
    f.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM sys_user')) return [{ learner_count: '3', learner_institution_count: '1', learner_external_count: '1', learner_unknown_source_count: '1' }];
      if (sql.includes('FROM question')) return [{ question_count: '2', enabled_question_count: '1' }];
      if (sql.includes('FROM exam_paper')) return [{ paper_count: '4', published_paper_count: '1' }];
      if (sql.includes('today_participant_count')) return [{ today_participant_count: '2', today_attempt_count: '3', last_7_days_participant_count: '2', last_7_days_attempt_count: '4' }];
      return [{ date: '2026-10-27', count: '5' }];
    });
    const service = new AdminDashboardService(f.source, f.access as any);
    const result = await service.overview('9', NOW);
    expect(result.metrics).toEqual({ learner_count: 3, learner_institution_count: 1, learner_external_count: 1,
      learner_unknown_source_count: 1, today_participant_count: 2, today_attempt_count: 3,
      last_7_days_participant_count: 2, last_7_days_attempt_count: 4,
      question_count: 2, enabled_question_count: 1, paper_count: 4, published_paper_count: 1 });
    expect(result.periods).toEqual({ today: { date_from: '2026-10-27', date_to: '2026-10-27' },
      last_7_days: { date_from: '2026-10-21', date_to: '2026-10-27' } });
    expect(result.exam_trend).toHaveLength(7);
    expect(result.exam_trend?.at(-1)).toEqual({ date: '2026-10-27', count: 5 });
    const statements = f.query.mock.calls.map(([sql]) => sql);
    expect(statements.find(sql => sql.includes('FROM sys_user'))).toMatch(/NOT EXISTS.*sys_user_role/s);
    expect(statements.find(sql => sql.includes('FROM question'))).toContain('deleted_at IS NULL');
    expect(statements.find(sql => sql.includes('FROM exam_paper'))).toContain("business_scope = 'training'");
    const [participationSql, parameters] = f.query.mock.calls.find(([sql]) => sql.includes('today_participant_count'))!;
    expect(participationSql).toContain("'in_progress', 'passed', 'failed', 'timeout'");
    expect(participationSql).toContain('`record`.`submitted_at` IS NOT NULL');
    expect(participationSql).toMatch(/COUNT\(DISTINCT.*user_id/s);
    expect(participationSql).not.toMatch(/exam_answer|record_question|`learner`\.`status`/);
    expect(parameters).toContainEqual(new Date('2026-10-20T16:00:00Z'));
    expect(parameters).toContainEqual(NOW);
    const legacySql = statements.at(-1)!;
    expect(legacySql).not.toMatch(/grading_state|status IN|DISTINCT/);
  });

  it('omits unauthorized groups and never queries their tables', async () => {
    const { AdminDashboardService } = await import('../src/modules/statistics/admin-dashboard.service');
    const f = await dashboardQueryFixture(['students:read']);
    f.query.mockResolvedValue([{ learner_count: '0', learner_institution_count: '0', learner_external_count: '0', learner_unknown_source_count: '0' }]);
    const result = await new AdminDashboardService(f.source, f.access as any).overview('9', NOW);
    expect(result.metrics).not.toHaveProperty('today_participant_count');
    expect(result.metrics).not.toHaveProperty('question_count');
    expect(result).not.toHaveProperty('exam_trend');
    expect(result.metrics.learner_count).toBe(0);
    expect(f.query).toHaveBeenCalledTimes(1);
    const empty = await dashboardQueryFixture([]);
    expect((await new AdminDashboardService(empty.source, empty.access as any).overview('9', NOW)).metrics).toEqual({});
    expect(empty.query).not.toHaveBeenCalled();
  });

  it('zero-fills days and chooses one frozen source per person-day with a stable first-record order', async () => {
    const { AdminDashboardService } = await import('../src/modules/statistics/admin-dashboard.service');
    const f = await dashboardQueryFixture(['statistics:read']);
    f.query.mockResolvedValue([{ date: '2026-10-27', participant_count: '3', institution_count: '1', external_count: '1', unknown_source_count: '1' }]);
    const trend = await new AdminDashboardService(f.source, f.access as any).examTrend('9', 7, NOW);
    expect(trend.points).toHaveLength(7);
    expect(trend.points[0]).toEqual({ date: '2026-10-21', participant_count: 0, institution_count: 0, external_count: 0, unknown_source_count: 0 });
    const today = trend.points.at(-1)!;
    expect(today.participant_count).toBe(today.institution_count + today.external_count + today.unknown_source_count);
    const [sql, parameters] = f.query.mock.calls[0];
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER.*PARTITION BY.*user_id.*ORDER BY.*started_at.*id/s);
    expect(sql).toContain('INTERVAL 8 HOUR');
    expect(sql).not.toContain('exam_answer');
    expect(parameters).toContainEqual(NOW);
  });

  it('rejects statistics reads for an actor with only business-list permissions', async () => {
    const { AdminDashboardService } = await import('../src/modules/statistics/admin-dashboard.service');
    const f = await dashboardQueryFixture(['students:read']);
    await expect(new AdminDashboardService(f.source, f.access as any).examTrend('9', 7, NOW)).rejects.toMatchObject({ code: 40301 });
    expect(f.query).not.toHaveBeenCalled();
  });
});


it('restricts all dashboard paper and record aggregates to formal before aggregation', async () => {
  const { AdminDashboardService } = await import('../src/modules/statistics/admin-dashboard.service');
  const f = await dashboardQueryFixture(['papers:read', 'statistics:read']);
  const service = new AdminDashboardService(f.source, f.access as any);
  await service.overview('9', NOW); await service.examTrend('9', 7, NOW);
  const calls = f.query.mock.calls;
  expect(calls.find(([sql]) => sql.includes('FROM exam_paper'))![0]).toContain("exam_purpose = 'formal'");
  expect(calls.find(([sql]) => sql.includes('FROM exam_record WHERE'))![0]).toContain("exam_purpose = 'formal'");
  for (const [sql, params] of calls.filter(([sql]) => sql.includes('today_participant_count') || sql.includes('ROW_NUMBER()'))) {
    expect(sql).toContain('`record`.`exam_purpose`'); expect(params).toContain('formal');
  }
});
