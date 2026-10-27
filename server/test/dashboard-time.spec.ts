import { describe, expect, it } from 'vitest';

describe('dashboard Shanghai periods', () => {
  it('uses Shanghai calendar boundaries without losing UTC precision', async () => {
    const { dashboardPeriod } = await import('../src/modules/statistics/dashboard-time');
    const now = new Date('2026-10-27T02:00:00.123Z');
    expect(dashboardPeriod(now, 7)).toEqual({
      startUtc: new Date('2026-10-20T16:00:00.000Z'), endUtc: now,
      date_from: '2026-10-21', date_to: '2026-10-27',
    });
  });

  it('changes the business date exactly at Shanghai midnight across a month', async () => {
    const { dashboardPeriod } = await import('../src/modules/statistics/dashboard-time');
    expect(dashboardPeriod(new Date('2026-10-31T15:59:59.999Z'), 1).date_to).toBe('2026-10-31');
    expect(dashboardPeriod(new Date('2026-10-31T16:00:00.000Z'), 1)).toMatchObject({
      startUtc: new Date('2026-10-31T16:00:00.000Z'), date_from: '2026-11-01', date_to: '2026-11-01',
    });
    expect(dashboardPeriod(new Date('2026-11-01T02:00:00Z'), 30).date_from).toBe('2026-10-03');
  });
});
