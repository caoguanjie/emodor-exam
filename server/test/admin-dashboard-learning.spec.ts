import { describe, expect, it } from 'vitest';
import { dashboardQueryFixture } from './support/dashboard-query-fixture';

const RELEASE = {
  paper_id: '11', title: '必修培训', paper_scope: 'training', status: 'published', release_id: '21',
  release_paper_id: '11', release_scope: 'training', version_no: 2, latest_version_no: 2, category_id: '7',
  requires_learning: 1, required_learning_minutes: 60, course_ids: ['31', '32'], released_at: new Date('2026-10-27T01:00:00Z'),
};

async function fixture(patch = {}, counts = { eligible_count: '4', achieved_count: '2' }, versions = ['51', '52']) {
  const { AdminDashboardService } = await import('../src/modules/statistics/admin-dashboard.service');
  const f = await dashboardQueryFixture(['statistics:read']);
  f.query.mockImplementation(async (sql) => {
    if (sql.includes('FROM exam_paper')) return [{ ...RELEASE, ...patch }];
    if (sql.includes('FROM course_lesson')) return versions.map(version_id => ({ version_id }));
    if (sql.includes('eligible_count')) return [counts];
    return [];
  });
  return { ...f, service: new AdminDashboardService(f.source, f.access as any) };
}

describe('dashboard mandatory learning aggregation', () => {
  it('includes zero-learning people and compares credited milliseconds in one repeatable read', async () => {
    const f = await fixture();
    expect(await f.service.learningSummary('9', '11', '21')).toMatchObject({
      state: 'ready', paper_id: '11', release_id: '21', required_learning_minutes: 60,
      eligible_count: 4, achieved_count: 2, pending_count: 2, achievement_rate: 0.5,
    });
    expect(f.transaction).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
    const [sql, parameters] = f.query.mock.calls.find(([sql]) => sql.includes('eligible_count'))!;
    expect(sql).toMatch(/LEFT JOIN.*SUM\(.*credited_ms\).*GROUP BY.*user_id/s);
    expect(sql).toMatch(/NOT EXISTS.*sys_user_role/s);
    expect(sql).toContain("source IN ('institution', 'external')");
    expect(sql).toContain("role = 'employee'");
    expect(sql).not.toMatch(/is_completed|exam_record|identity|FOR UPDATE/);
    expect(parameters).toContain('3600000');
    expect(parameters).toContain('7');
    expect(f.query).toHaveBeenCalledTimes(3);
    expect(f.query.mock.calls.every(([statement]) => !/\b(?:JOIN|FROM)\s+paper_release\s+release\b/i.test(statement))).toBe(true);
  });

  it('distinguishes no audience from zero achievement and rounds nonzero rates to four places', async () => {
    const empty = await fixture({}, { eligible_count: '0', achieved_count: '0' });
    expect(await empty.service.learningSummary('9', '11', '21')).toMatchObject({
      state: 'no_audience', eligible_count: 0, achieved_count: 0, pending_count: 0, achievement_rate: null,
    });
    const zero = await fixture({}, { eligible_count: '4', achieved_count: '0' });
    expect(await zero.service.learningSummary('9', '11', '21')).toMatchObject({ state: 'ready', achievement_rate: 0 });
    const third = await fixture({}, { eligible_count: '3', achieved_count: '1' });
    expect((await third.service.learningSummary('9', '11', '21')).achievement_rate).toBe(0.3333);
  });

  it('keeps a requirement with no currently effective video and avoids empty IN clauses', async () => {
    const f = await fixture({}, { eligible_count: '4', achieved_count: '0' }, []);
    expect(await f.service.learningSummary('9', '11', '21')).toMatchObject({ pending_count: 4, achievement_rate: 0 });
    expect(f.query.mock.calls.every(([sql]) => !sql.includes('IN ()'))).toBe(true);
  });

  it.each([
    { version_no: 1, latest_version_no: 2 }, { status: 'withdrawn' }, { status: 'archived' },
    { requires_learning: 0 }, { required_learning_minutes: null }, { required_learning_minutes: 0 },
    { course_ids: [] }, { course_ids: ['31', '31'] }, { course_ids: [31] }, { course_ids: ['x'] },
  ])('rejects obsolete or invalid requirements without mixing snapshots: %j', async (patch) => {
    const f = await fixture(patch);
    await expect(f.service.learningSummary('9', '11', '21')).rejects.toMatchObject({ code: 40970 });
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it('returns not found for a missing paper or a release owned by another paper', async () => {
    const f = await fixture({ release_id: null, release_paper_id: null });
    await expect(f.service.learningSummary('9', '11', '21')).rejects.toMatchObject({ code: 40401 });
    f.query.mockResolvedValue([]);
    await expect(f.service.learningSummary('9', '99', '21')).rejects.toMatchObject({ code: 40401 });
  });

  it('keeps the maximum supported minute threshold exact in SQL parameters', async () => {
    const f = await fixture({ required_learning_minutes: 2147483647 });
    await f.service.learningSummary('9', '11', '21');
    const [, parameters] = f.query.mock.calls.find(([sql]) => sql.includes('eligible_count'))!;
    expect(parameters).toContain('128849018820000');
  });

  it('paginates only legal latest published learning requirements in stable release order', async () => {
    const { AdminDashboardService } = await import('../src/modules/statistics/admin-dashboard.service');
    const f = await dashboardQueryFixture(['statistics:read']);
    f.query.mockImplementation(async (sql) => sql.includes('COUNT(*) AS total') ? [{ total: '21' }] : [RELEASE]);
    const result = await new AdminDashboardService(f.source, f.access as any).learningOptions('9', { keyword: '必修', page: 2, pageSize: 20 });
    expect(result).toMatchObject({ total: 21, page: 2, page_size: 20, items: [{ paper_id: '11', release_id: '21', required_learning_minutes: 60 }] });
    const [sql, parameters] = f.query.mock.calls.find(([sql]) => !sql.includes('COUNT(*) AS total'))!;
    expect(sql).toMatch(/MAX\(latest.version_no\)/);
    expect(sql).toContain("paper.status = 'published'");
    expect(sql).toMatch(/JSON_TYPE.*ARRAY/s);
    expect(sql).toContain('JSON_TABLE');
    expect(sql).not.toMatch(/\b(?:JOIN|FROM)\s+paper_release\s+release\b/i);
    expect(sql).toMatch(/ORDER BY \w+\.released_at DESC, \w+\.id DESC/);
    expect(parameters).toEqual(['%必修%', 20, 20]);
    await expect(new AdminDashboardService(f.source, f.access as any).learningOptions('9', { pageSize: 101 })).rejects.toMatchObject({ code: 40001 });
  });
});


it.each([{ paper_purpose: 'practice' }, { release_purpose: 'practice' }])('returns 404 for a direct practice learning summary: %j', async patch => {
  const f = await fixture(patch);
  await expect(f.service.learningSummary('9', '11', '21')).rejects.toMatchObject({ code: 40401 });
  expect(f.query).toHaveBeenCalledTimes(1);
});

it('applies identical formal paper and release conditions to learning option count and page', async () => {
  const f = await fixture();
  await f.service.learningOptions('9', { page: 1, pageSize: 1 });
  for (const [sql] of f.query.mock.calls) {
    expect(sql).toContain("paper.exam_purpose = 'formal'");
    expect(sql).toContain("publication.exam_purpose = 'formal'");
  }
});
