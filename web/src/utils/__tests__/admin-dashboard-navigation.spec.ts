import { describe, expect, it } from 'vitest';
import type { LocationQuery } from 'vue-router';
import { dashboardListIdentity, parseDashboardEntry } from '../admin-dashboard-navigation';

describe('dashboard list navigation', () => {
  it.each(['students', 'questions', 'papers', 'training-statistics'])('shares the %s list identity across filters', path => {
    expect(dashboardListIdentity(`/admin/${path}?entry=dashboard#filters`)).toBe(`/admin/${path}`);
  });
  it.each(['/admin/papers/8?designer=1', '/admin/questions/import?file=2', '/admin/exam-records?page=2', '/admin/courses?category_id=3'])('preserves the identity of %s', path => {
    expect(dashboardListIdentity(path)).toBe(path);
  });
  it('parses enabled students and consumes only the entry marker', () => {
    expect(parseDashboardEntry('/admin/students', { entry: 'dashboard', source: 'external', status: '1' })).toEqual({
      explicitEntry: true, intent: { kind: 'students', source: 'external', status: 1 },
      invalidKeys: [], cleanQuery: { source: 'external', status: '1' },
    });
  });
  it('represents the common students entry as all statuses and sources', () => {
    expect(parseDashboardEntry('/admin/students', { entry: 'dashboard' }).intent).toEqual({ kind: 'students', source: undefined, status: undefined });
  });
  it.each([['all', undefined], ['true', true], ['false', false]] as const)('restores question enabled=%s after entry consumption', (enabled, expected) => {
    expect(parseDashboardEntry('/admin/questions', { enabled }).intent).toEqual({ kind: 'questions', enabled: expected });
  });
  it('keeps create pending until a dialog actually opens', () => {
    expect(parseDashboardEntry('/admin/papers', { entry: 'dashboard', status: 'all', create: '1' })).toEqual({
      explicitEntry: true, intent: { kind: 'papers', status: undefined, create: true },
      invalidKeys: [], cleanQuery: { status: 'all', create: '1' },
    });
  });
  it('keeps string IDs exact for direct summary links', () => {
    expect(parseDashboardEntry('/admin/training-statistics', { entry: 'dashboard', paper_id: '9007199254740993' }).intent).toEqual({ kind: 'statistics', paperId: '9007199254740993' });
  });
  it.each([
    ['/admin/students', { source: ['external'], status: '2' }, ['source', 'status']],
    ['/admin/questions', { enabled: '1' }, ['enabled']],
    ['/admin/papers', { status: 'deleted', create: ['1', '1'] }, ['status', 'create']],
    ['/admin/training-statistics', { paper_id: '0' }, ['paper_id']],
    ['/admin/training-statistics', { paper_id: '1e2' }, ['paper_id']],
    ['/admin/training-statistics', { paper_id: ['8', '9'] }, ['paper_id']],
  ] as Array<[string, LocationQuery, string[]]>)('removes malformed route parameters on %s', (path, query, invalidKeys) => {
    const result = parseDashboardEntry(path, { ...query, entry: 'dashboard' });
    expect(result.invalidKeys).toEqual(invalidKeys);
    expect(result.cleanQuery).toEqual({});
  });
  it('leaves the normal menu defaults and unrelated routes alone', () => {
    expect(parseDashboardEntry('/admin/questions', {}).intent).toBeNull();
    expect(parseDashboardEntry('/admin/papers/8', { designer: '1' })).toEqual({ explicitEntry: false, intent: null, invalidKeys: [], cleanQuery: { designer: '1' } });
  });
});
