import { ref, shallowRef, watch, type Ref } from 'vue';
import {
  getDashboard, getDashboardTrend, getDashboardLearningOptions,
  getDashboardLearningSummary, getDashboardRecentExams,
} from '../api/admin-dashboard';
import type {
  AdminDashboard, DashboardExamTrend, DashboardLearningOptions,
  DashboardLearningSummary, DashboardRecentExams,
} from '../api/training-types';
import { createLatestRequestScope } from '../utils/latest-request-scope';

export interface DashboardSection<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  asOf: string | null;
}
export interface DashboardLearningSelection { paper_id: string; release_id: string }
interface DashboardPayloads {
  overview: AdminDashboard;
  trend: DashboardExamTrend;
  learningOptions: DashboardLearningOptions;
  learningSummary: DashboardLearningSummary;
  recentExams: DashboardRecentExams;
}
export type DashboardModule = keyof DashboardPayloads;
export type UseAdminDashboardReturn = {
  [K in DashboardModule]: Ref<DashboardSection<DashboardPayloads[K]>>;
} & {
  days: Ref<7 | 30>;
  selection: Ref<DashboardLearningSelection | null>;
  updatedAt: Ref<string | null>;
  statisticsAllowed: Ref<boolean>;
  activate(): Promise<void>;
  refresh(): Promise<void>;
  deactivate(): void;
  setDays(days: 7 | 30): Promise<void>;
  searchLearningOptions(keyword: string, page?: number): Promise<void>;
  selectLearning(selection: DashboardLearningSelection | null): Promise<void>;
  retry(module: DashboardModule): Promise<void>;
};
type Result<T> = { ok: true; data: T } | { ok: false; error?: unknown };
const moduleNames: DashboardModule[] = ['overview', 'trend', 'learningOptions', 'learningSummary', 'recentExams'];
const permissions = ['students:read', 'questions:read', 'papers:read', 'statistics:read'];
const emptySection = <T>(): DashboardSection<T> => ({ data: null, loading: false, error: null, asOf: null });
function errorCode(error: unknown): number {
  const value = error as { code?: number; response?: { status?: number } } | null;
  return Number(value?.response?.status ?? value?.code ?? 0);
}

export function useAdminDashboard(hasPermission: (permission: string) => boolean): UseAdminDashboardReturn {
  const sections = {
    overview: shallowRef(emptySection<AdminDashboard>()),
    trend: shallowRef(emptySection<DashboardExamTrend>()),
    learningOptions: shallowRef(emptySection<DashboardLearningOptions>()),
    learningSummary: shallowRef(emptySection<DashboardLearningSummary>()),
    recentExams: shallowRef(emptySection<DashboardRecentExams>()),
  };
  const days = ref<7 | 30>(7);
  const selection = ref<DashboardLearningSelection | null>(null);
  const updatedAt = ref<string | null>(null);
  const statisticsAllowed = ref(hasPermission('statistics:read'));
  let active = false;
  let scopes = createScopes();
  let batchGeneration = 0;
  let activation: Promise<void> | null = null;
  let mustReselect = false;
  let optionQuery = { keyword: '', page: 1, page_size: 20 };

  function createScopes() {
    return Object.fromEntries(moduleNames.map(name => [name, createLatestRequestScope()])) as Record<DashboardModule, ReturnType<typeof createLatestRequestScope>>;
  }
  function section<K extends DashboardModule>(name: K): Ref<DashboardSection<DashboardPayloads[K]>> {
    return sections[name] as Ref<DashboardSection<DashboardPayloads[K]>>;
  }
  function canReadStatistics() { return statisticsAllowed.value && hasPermission('statistics:read'); }
  function trimMetrics() {
    const current = sections.overview.value.data;
    if (!current) return;
    const metrics = { ...current.metrics };
    if (!hasPermission('students:read')) {
      delete metrics.learner_count; delete metrics.learner_institution_count;
      delete metrics.learner_external_count; delete metrics.learner_unknown_source_count;
    }
    if (!hasPermission('questions:read')) { delete metrics.question_count; delete metrics.enabled_question_count; }
    if (!hasPermission('papers:read')) { delete metrics.paper_count; delete metrics.published_paper_count; }
    if (!canReadStatistics()) {
      delete metrics.today_participant_count; delete metrics.today_attempt_count;
      delete metrics.last_7_days_participant_count; delete metrics.last_7_days_attempt_count;
    }
    sections.overview.value = { ...sections.overview.value, data: { ...current, metrics, ...(!canReadStatistics() ? { exam_trend: undefined } : {}) } };
  }
  function clearStatistics() {
    batchGeneration++;
    for (const name of moduleNames.filter(name => name !== 'overview')) {
      scopes[name].stop(); scopes[name] = createLatestRequestScope();
      sections[name].value = emptySection() as never;
    }
    selection.value = null;
    trimMetrics();
  }
  function deactivate() {
    active = false; batchGeneration++; activation = null;
    for (const name of moduleNames) {
      scopes[name].stop();
      sections[name].value = { ...sections[name].value, loading: false } as never;
    }
  }
  function clearSession() {
    deactivate(); statisticsAllowed.value = false;
    for (const name of moduleNames) sections[name].value = emptySection() as never;
    selection.value = null; updatedAt.value = null;
  }
  watch(() => permissions.map(hasPermission), (current, previous) => {
    if (current[3] !== previous[3]) {
      statisticsAllowed.value = current[3];
      if (!current[3]) clearStatistics();
    }
    if (current.some((allowed, index) => !allowed && previous[index])) batchGeneration++;
    trimMetrics();
  }, { flush: 'sync' });

  async function request<K extends DashboardModule>(
    name: K, load: (signal: AbortSignal) => Promise<DashboardPayloads[K]>,
  ): Promise<Result<DashboardPayloads[K]>> {
    if (!active || (name !== 'overview' && !canReadStatistics())) return { ok: false };
    const target = section(name);
    const ticket = scopes[name].begin();
    target.value = { ...target.value, loading: true, error: null };
    try {
      const data = await load(ticket.signal);
      if (!ticket.isCurrent() || (name !== 'overview' && !canReadStatistics())) return { ok: false };
      target.value = { data, asOf: data.as_of, loading: false, error: null };
      if (name === 'overview') trimMetrics();
      return { ok: true, data };
    } catch (error) {
      if (!ticket.isCurrent()) return { ok: false };
      const code = errorCode(error);
      if (code === 401 || (code >= 40100 && code < 40200)) {
        clearSession();
      } else if (code === 403 || code === 40301) {
        if (name !== 'overview') { statisticsAllowed.value = false; clearStatistics(); }
        else target.value = { ...emptySection(), error: '当前账号无权查看运营数据' };
      } else {
        const message = code === 40970 ? '培训要求已更新，请重新选择'
          : error instanceof Error ? error.message : '加载失败，请重试';
        target.value = { ...target.value, loading: false, error: message,
          ...(code === 40970 ? { data: null, asOf: null } : {}) };
      }
      return { ok: false, error };
    } finally {
      if (ticket.isCurrent()) target.value = { ...target.value, loading: false };
      ticket.finish();
    }
  }
  const loadOverview = () => request('overview', getDashboard);
  const loadTrend = () => request('trend', signal => getDashboardTrend(days.value, signal));
  const loadRecent = () => request('recentExams', getDashboardRecentExams);
  function loadOptions() {
    const query = { ...(optionQuery.keyword ? { keyword: optionQuery.keyword } : {}), page: optionQuery.page, page_size: optionQuery.page_size };
    return request('learningOptions', signal => getDashboardLearningOptions(query, signal));
  }
  async function loadSummary(value: DashboardLearningSelection) {
    const result = await request('learningSummary', signal => getDashboardLearningSummary(value.paper_id, value.release_id, signal));
    if (!result.ok && errorCode(result.error) === 40970 && active
      && selection.value?.paper_id === value.paper_id && selection.value.release_id === value.release_id) {
      mustReselect = true; selection.value = null;
      optionQuery = { keyword: '', page: 1, page_size: 20 };
      await loadOptions();
    }
    return result;
  }
  async function chooseInitialOption(result: Result<DashboardLearningOptions>) {
    if (result.ok && !selection.value && !mustReselect && canReadStatistics() && active) {
      const first = result.data.items[0];
      if (first) {
        selection.value = { paper_id: first.paper_id, release_id: first.release_id };
        return loadSummary(selection.value);
      }
      sections.learningSummary.value = emptySection();
    }
    return null;
  }
  async function refresh(): Promise<void> {
    if (!active) return activate();
    batchGeneration++;
    if (!hasPermission('statistics:read')) { statisticsAllowed.value = false; clearStatistics(); }
    // Each result belongs to this full-page batch. Local changes invalidate its timestamp only.
    const batch = batchGeneration;
    const statistics = canReadStatistics();
    const currentSelection = selection.value && { ...selection.value };
    const overviewJob = loadOverview();
    const trendJob = statistics ? loadTrend() : null;
    const recentJob = statistics ? loadRecent() : null;
    const optionsJob = statistics ? loadOptions() : null;
    const summaryJob = statistics && currentSelection ? loadSummary(currentSelection) : null;
    const initialSummaryJob = optionsJob && !currentSelection
      ? optionsJob.then(chooseInitialOption) : null;
    const results: Array<Result<{ as_of: string }>> = [];
    const [overviewResult, trendResult, recentResult, optionsResult, summaryResult, initialSummary] = await Promise.all([
      overviewJob, trendJob, recentJob, optionsJob, summaryJob, initialSummaryJob,
    ]);
    results.push(overviewResult);
    for (const result of [trendResult, recentResult, optionsResult, summaryResult]) if (result) results.push(result);
    if (initialSummary) results.push(initialSummary);
    if (!active || batch !== batchGeneration) return;
    if (statistics && overviewResult.ok && trendResult?.ok
      && overviewResult.data.periods.today.date_to !== trendResult.data.date_to) {
      const [alignedOverview, alignedTrend] = await Promise.all([loadOverview(), loadTrend()]);
      results[0] = alignedOverview;
      results[1] = alignedTrend;
      if (!active || batch !== batchGeneration) return;
      if (alignedOverview.ok && alignedTrend.ok && alignedOverview.data.periods.today.date_to !== alignedTrend.data.date_to) {
        sections.trend.value = { ...sections.trend.value, error: '统计日期已变化，请刷新重试' };
        return;
      }
    }
    const visibleModules = statistics ? moduleNames : ['overview'] as const;
    if (results.every(result => result.ok) && visibleModules.every(name => !sections[name].value.error)) {
      const times = results.flatMap(result => result.ok ? [result.data.as_of] : []);
      updatedAt.value = times.reduce((earliest, value) => Date.parse(value) < Date.parse(earliest) ? value : earliest);
    }
  }
  async function activate(): Promise<void> {
    if (active) return activation ?? Promise.resolve();
    active = true; scopes = createScopes(); statisticsAllowed.value = hasPermission('statistics:read');
    const pending = refresh(); activation = pending;
    try { await pending; } finally { if (activation === pending) activation = null; }
  }
  async function setDays(value: 7 | 30): Promise<void> {
    if (days.value === value) return;
    days.value = value; const generation = ++batchGeneration;
    if ((await loadTrend()).ok) await alignLocalDates(generation);
  }
  async function alignLocalDates(generation: number): Promise<void> {
    if (!active || generation !== batchGeneration || !canReadStatistics()) return;
    const currentOverview = sections.overview.value;
    const currentTrend = sections.trend.value;
    if (!currentOverview.data || !currentTrend.data || currentOverview.error || currentTrend.error
      || currentOverview.data.periods.today.date_to === currentTrend.data.date_to) return;
    const [alignedOverview, alignedTrend] = await Promise.all([loadOverview(), loadTrend()]);
    if (active && generation === batchGeneration && alignedOverview.ok && alignedTrend.ok
      && alignedOverview.data.periods.today.date_to !== alignedTrend.data.date_to) {
      sections.trend.value = { ...sections.trend.value, error: '统计日期已变化，请刷新重试' };
    }
  }
  async function searchLearningOptions(keyword: string, page = 1): Promise<void> {
    batchGeneration++; optionQuery = { keyword: keyword.trim(), page, page_size: 20 };
    await loadOptions();
  }
  async function selectLearning(value: DashboardLearningSelection | null): Promise<void> {
    batchGeneration++;
    scopes.learningSummary.stop(); scopes.learningSummary = createLatestRequestScope();
    selection.value = value && { ...value }; mustReselect = !value;
    sections.learningSummary.value = emptySection();
    if (value) await loadSummary(value);
  }
  async function retry(name: DashboardModule): Promise<void> {
    const generation = ++batchGeneration;
    if (name === 'overview') { if ((await loadOverview()).ok) await alignLocalDates(generation); }
    else if (name === 'trend') { if ((await loadTrend()).ok) await alignLocalDates(generation); }
    else if (name === 'recentExams') await loadRecent();
    else if (name === 'learningOptions') await chooseInitialOption(await loadOptions());
    else if (selection.value) await loadSummary({ ...selection.value });
    else await loadOptions();
  }
  return { ...sections, days, selection, updatedAt, statisticsAllowed, activate, refresh, deactivate,
    setDays, searchLearningOptions, selectLearning, retry };
}
