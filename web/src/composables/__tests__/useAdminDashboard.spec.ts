import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, type EffectScope } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { useAdminDashboard } from '../useAdminDashboard';

const api = vi.hoisted(() => ({
  getDashboard: vi.fn(), getDashboardTrend: vi.fn(), getDashboardLearningOptions: vi.fn(),
  getDashboardLearningSummary: vi.fn(), getDashboardRecentExams: vi.fn(),
}));
vi.mock('../../api/admin-dashboard', () => api);

const time = '2026-10-27T02:00:00.000Z';
const overview = (as_of = time, date = '2026-10-27') => ({
  as_of, timezone: 'Asia/Shanghai',
  periods: { today: { date_from: date, date_to: date }, last_7_days: { date_from: '2026-10-21', date_to: date } },
  metrics: { learner_count: 1286, learner_institution_count: 986, learner_external_count: 300, learner_unknown_source_count: 0,
    today_participant_count: 66, today_attempt_count: 70, last_7_days_participant_count: 318, last_7_days_attempt_count: 400,
    question_count: 2468, enabled_question_count: 2400, paper_count: 36, published_paper_count: 16 },
});
const trend = (days = 7, as_of = time, date_to = '2026-10-27') => ({
  as_of, timezone: 'Asia/Shanghai', days, date_from: '2026-10-21', date_to,
  points: [{ date: date_to, participant_count: 0, institution_count: 0, external_count: 0, unknown_source_count: 0 }],
});
const options = (paper_id = '10', release_id = '11') => ({
  as_of: time, items: [{ paper_id, release_id, title: '安全培训', released_at: time, required_learning_minutes: 480 }],
  total: 1, page: 1, page_size: 20,
});
const summary = (paper_id = '10', release_id = '11') => ({
  as_of: time, state: 'ready', paper_id, release_id, title: `培训${paper_id}`, released_at: time,
  required_learning_minutes: 480, eligible_count: 100, achieved_count: 80, pending_count: 20, achievement_rate: 0.8,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const scopes: EffectScope[] = [];
const states: ReturnType<typeof useAdminDashboard>[] = [];
function create(permissions = ['statistics:read', 'students:read', 'questions:read', 'papers:read']) {
  const allowed = reactive(new Set(permissions));
  const scope = effectScope(); scopes.push(scope);
  const state = scope.run(() => useAdminDashboard(permission => allowed.has(permission)))!;
  states.push(state); return { state, allowed };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getDashboard.mockResolvedValue(overview());
  api.getDashboardTrend.mockImplementation(async days => trend(days));
  api.getDashboardLearningOptions.mockResolvedValue(options());
  api.getDashboardLearningSummary.mockImplementation(async (paper, release) => summary(paper, release));
  api.getDashboardRecentExams.mockResolvedValue({ as_of: time, limit: 4, items: [] });
});
afterEach(() => { states.splice(0).forEach(state => state.deactivate()); scopes.splice(0).forEach(scope => scope.stop()); });

describe('admin dashboard independent requests', () => {
  it('deduplicates mounted and activated loads, then reloads after reactivation', async () => {
    const { state } = create(); await Promise.all([state.activate(), state.activate()]);
    expect(api.getDashboard).toHaveBeenCalledTimes(1);
    expect(api.getDashboardLearningSummary).toHaveBeenCalledTimes(1);
    state.deactivate(); await state.activate();
    expect(api.getDashboard).toHaveBeenCalledTimes(2);
    expect(state.overview.value.data?.metrics.learner_count).toBe(1286);
  });

  it('drops an old 7-day response after selecting 30 days', async () => {
    const old = deferred<ReturnType<typeof trend>>(); api.getDashboardTrend.mockReturnValueOnce(old.promise);
    const { state } = create(); const initial = state.activate();
    await state.setDays(30); old.resolve(trend(7)); await initial;
    expect(state.days.value).toBe(30); expect(state.trend.value.data?.days).toBe(30);
    expect(api.getDashboard).toHaveBeenCalledTimes(1);
  });

  it('loads the default learning summary as soon as options resolve while another module is still pending', async () => {
    const slowTrend = deferred<ReturnType<typeof trend>>(); api.getDashboardTrend.mockReturnValueOnce(slowTrend.promise);
    const { state } = create(); const initial = state.activate(); await flushPromises();
    expect(state.learningSummary.value.data?.paper_id).toBe('10');
    expect(state.trend.value.loading).toBe(true);
    slowTrend.resolve(trend()); await initial;
  });

  it('still initializes learning when the trend range changes before initial candidates arrive', async () => {
    const candidates = deferred<ReturnType<typeof options>>(); api.getDashboardLearningOptions.mockReturnValueOnce(candidates.promise);
    const { state } = create(); const initial = state.activate();
    await state.setDays(30); candidates.resolve(options()); await initial;
    expect(state.trend.value.data?.days).toBe(30);
    expect(state.learningSummary.value.data?.paper_id).toBe('10');
  });

  it('discards responses after deactivation and creates live request scopes again', async () => {
    const old = deferred<ReturnType<typeof overview>>(); api.getDashboard.mockReturnValueOnce(old.promise);
    const { state } = create(); const first = state.activate();
    const signal = api.getDashboard.mock.calls[0][0] as AbortSignal;
    state.deactivate(); expect(signal.aborted).toBe(true);
    await state.activate(); old.resolve(overview('2020-01-01T00:00:00.000Z')); await first;
    expect(state.overview.value.data?.as_of).toBe(time);
    expect(state.overview.value.loading).toBe(false);
  });

  it('changes only learning summary and keeps its latest selection', async () => {
    const { state } = create(); await state.activate();
    const old = deferred<ReturnType<typeof summary>>(); api.getDashboardLearningSummary.mockReturnValueOnce(old.promise);
    const first = state.selectLearning({ paper_id: '20', release_id: '21' });
    await state.selectLearning({ paper_id: '30', release_id: '31' }); old.resolve(summary('20', '21')); await first;
    expect(state.learningSummary.value.data?.paper_id).toBe('30');
    expect(api.getDashboardTrend).toHaveBeenCalledTimes(1); expect(api.getDashboardRecentExams).toHaveBeenCalledTimes(1);
  });

  it('paginates or searches candidates without changing the selected summary', async () => {
    const { state } = create(); await state.activate();
    api.getDashboardLearningOptions.mockResolvedValue({ ...options('50', '51'), page: 2, total: 25 });
    await state.searchLearningOptions('消防', 2);
    expect(state.selection.value).toEqual({ paper_id: '10', release_id: '11' });
    expect(state.learningSummary.value.data?.title).toBe('培训10');
    expect(api.getDashboardLearningSummary).toHaveBeenCalledTimes(1);
    expect(api.getDashboardLearningOptions.mock.calls.at(-1)?.[0]).toEqual({ keyword: '消防', page: 2, page_size: 20 });
  });

  it('preserves and revalidates a selected paper absent from the refreshed first page', async () => {
    const { state } = create(); await state.activate(); await state.selectLearning({ paper_id: '90', release_id: '91' });
    api.getDashboardLearningOptions.mockResolvedValue(options('50', '51')); await state.refresh();
    expect(state.selection.value).toEqual({ paper_id: '90', release_id: '91' });
    expect(state.learningSummary.value.data?.paper_id).toBe('90');
    expect(api.getDashboardLearningSummary.mock.calls.at(-1)?.slice(0, 2)).toEqual(['90', '91']);
  });

  it('does not request statistics modules without statistics permission', async () => {
    const { state } = create(['students:read']); await state.activate();
    expect(api.getDashboard).toHaveBeenCalledTimes(1);
    expect(api.getDashboardTrend).not.toHaveBeenCalled(); expect(api.getDashboardLearningOptions).not.toHaveBeenCalled();
    expect(api.getDashboardLearningSummary).not.toHaveBeenCalled(); expect(api.getDashboardRecentExams).not.toHaveBeenCalled();
    expect(state.learningSummary.value.data).toBeNull();
  });

  it('replaces permission-trimmed metrics instead of retaining old fields', async () => {
    const { state } = create(); await state.activate();
    api.getDashboard.mockResolvedValue({ ...overview(), metrics: { learner_count: 1 } }); await state.refresh();
    expect(state.overview.value.data?.metrics).toEqual({ learner_count: 1 });
  });

  it('immediately clears restricted cached data when current permissions are removed', async () => {
    const { state, allowed } = create(); await state.activate();
    allowed.delete('statistics:read'); allowed.delete('questions:read'); await nextTick();
    expect(state.learningSummary.value.data).toBeNull(); expect(state.recentExams.value.data).toBeNull();
    expect(state.trend.value.data).toBeNull(); expect(state.overview.value.data?.metrics).not.toHaveProperty('question_count');
    expect(state.overview.value.data?.metrics).not.toHaveProperty('today_participant_count');
  });

  it('clears old statistics on forbidden errors while leaving unrelated metrics usable', async () => {
    const { state } = create(); await state.activate();
    api.getDashboardTrend.mockRejectedValue(Object.assign(new Error('无权访问'), { code: 40301 }));
    await state.retry('trend');
    expect(state.trend.value.data).toBeNull(); expect(state.learningSummary.value.data).toBeNull();
    expect(state.recentExams.value.data).toBeNull(); expect(state.overview.value.data?.metrics.learner_count).toBe(1286);
  });

  it('clears every section on a final unauthorized response', async () => {
    const { state } = create(); await state.activate();
    api.getDashboard.mockRejectedValue({ response: { status: 401 } }); await state.refresh();
    expect(state.overview.value.data).toBeNull(); expect(state.trend.value.data).toBeNull();
    expect(state.learningSummary.value.data).toBeNull(); expect(state.recentExams.value.data).toBeNull();
    expect(state.updatedAt.value).toBeNull();
  });

  it('uses the earliest server time only after the complete visible load succeeds', async () => {
    api.getDashboardTrend.mockResolvedValue(trend(7, '2026-10-27T01:59:58.000Z'));
    const { state } = create(); await state.activate(); expect(state.updatedAt.value).toBe('2026-10-27T01:59:58.000Z');
    api.getDashboard.mockResolvedValue(overview('2026-10-27T03:00:00.000Z'));
    api.getDashboardRecentExams.mockRejectedValue(new Error('网络失败')); await state.refresh();
    expect(state.updatedAt.value).toBe('2026-10-27T01:59:58.000Z');
    expect(state.recentExams.value.error).toBe('网络失败'); expect(state.overview.value.data?.as_of).toBe('2026-10-27T03:00:00.000Z');
  });

  it('does not advance the header timestamp after a local switch', async () => {
    const { state } = create(); await state.activate();
    api.getDashboardTrend.mockResolvedValue(trend(30, '2026-10-27T04:00:00.000Z')); await state.setDays(30);
    expect(state.updatedAt.value).toBe(time); expect(state.trend.value.asOf).toBe('2026-10-27T04:00:00.000Z');
  });

  it('realigns only overview and trend when their server business dates cross midnight', async () => {
    api.getDashboard.mockResolvedValueOnce(overview('2026-10-27T15:59:59.000Z')).mockResolvedValue(overview('2026-10-27T16:00:02.000Z', '2026-10-28'));
    api.getDashboardTrend.mockResolvedValue(trend(7, '2026-10-27T16:00:01.000Z', '2026-10-28'));
    const { state } = create(); await state.activate();
    expect(api.getDashboard).toHaveBeenCalledTimes(2); expect(api.getDashboardTrend).toHaveBeenCalledTimes(2);
    expect(api.getDashboardRecentExams).toHaveBeenCalledTimes(1); expect(api.getDashboardLearningOptions).toHaveBeenCalledTimes(1);
    expect(state.overview.value.data?.periods.today.date_to).toBe(state.trend.value.data?.date_to);
    expect(state.updatedAt.value).toBe(time);
  });

  it('realigns business dates after a local trend switch crossing Shanghai midnight without advancing header time', async () => {
    const { state } = create(); await state.activate();
    api.getDashboard.mockResolvedValue(overview('2026-10-27T16:00:02.000Z', '2026-10-28'));
    api.getDashboardTrend.mockResolvedValue(trend(30, '2026-10-27T16:00:01.000Z', '2026-10-28'));
    await state.setDays(30);
    expect(state.overview.value.data?.periods.today.date_to).toBe('2026-10-28');
    expect(api.getDashboard).toHaveBeenCalledTimes(2); expect(api.getDashboardTrend).toHaveBeenCalledTimes(3);
    expect(api.getDashboardLearningOptions).toHaveBeenCalledTimes(1); expect(api.getDashboardRecentExams).toHaveBeenCalledTimes(1);
    expect(state.updatedAt.value).toBe(time);
  });

  it('clears obsolete learning data and does not choose another paper after a version conflict', async () => {
    const { state } = create(); await state.activate();
    api.getDashboardLearningSummary.mockRejectedValueOnce(Object.assign(new Error('版本失效'), { code: 40970 }));
    api.getDashboardLearningOptions.mockResolvedValue(options('50', '51')); await state.retry('learningSummary');
    expect(state.selection.value).toBeNull(); expect(state.learningSummary.value.data).toBeNull();
    expect(state.learningSummary.value.error).toBe('培训要求已更新，请重新选择');
    expect(state.learningOptions.value.data?.items[0].paper_id).toBe('50');
    await state.refresh(); expect(state.selection.value).toBeNull();
    await state.selectLearning({ paper_id: '50', release_id: '51' }); expect(state.learningSummary.value.data?.paper_id).toBe('50');
  });

  it('keeps the last complete timestamp while a learning version conflict still needs a new selection', async () => {
    const { state } = create(); await state.activate();
    api.getDashboardLearningSummary.mockRejectedValueOnce(Object.assign(new Error('版本失效'), { code: 40970 }));
    await state.retry('learningSummary');
    const later = '2026-10-27T05:00:00.000Z';
    api.getDashboard.mockResolvedValue(overview(later)); api.getDashboardTrend.mockResolvedValue(trend(7, later));
    api.getDashboardRecentExams.mockResolvedValue({ as_of: later, limit: 4, items: [] });
    api.getDashboardLearningOptions.mockResolvedValue({ ...options('50', '51'), as_of: later });
    await state.refresh();
    expect(state.learningSummary.value.error).toBe('培训要求已更新，请重新选择');
    expect(state.updatedAt.value).toBe(time);
  });

  it('keeps no candidates, no audience and zero achievement distinct from network failures', async () => {
    api.getDashboardLearningOptions.mockResolvedValue({ ...options(), items: [], total: 0 });
    const { state } = create(); await state.activate();
    expect(state.learningSummary.value.data).toBeNull(); expect(state.learningSummary.value.error).toBeNull();
    expect(api.getDashboardLearningSummary).not.toHaveBeenCalled();
    api.getDashboardLearningSummary.mockResolvedValue({ ...summary(), state: 'no_audience', eligible_count: 0, achieved_count: 0, pending_count: 0, achievement_rate: null });
    await state.selectLearning({ paper_id: '10', release_id: '11' });
    expect(state.learningSummary.value.data?.achievement_rate).toBeNull();
    api.getDashboardLearningSummary.mockResolvedValue({ ...summary(), achieved_count: 0, pending_count: 100, achievement_rate: 0 });
    await state.retry('learningSummary'); expect(state.learningSummary.value.data?.achievement_rate).toBe(0);
    api.getDashboardLearningSummary.mockRejectedValue(new Error('网络不可用')); await state.retry('learningSummary');
    expect(state.learningSummary.value.error).toBe('网络不可用');
  });
});
