import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDashboardTrendOption, buildDashboardLearningOption, createDashboardChart, dashboardTrendPointLabel } from '../dashboard-charts';

const mocks = vi.hoisted(() => ({ init: vi.fn(), use: vi.fn() }));
vi.mock('echarts/core', () => ({ init: mocks.init, use: mocks.use }));
const trend = {
  as_of: '2026-10-27T02:00:00.000Z', timezone: 'Asia/Shanghai' as const, days: 7 as const,
  date_from: '2026-10-26', date_to: '2026-10-27', points: [
    { date: '2026-10-26', participant_count: 6, institution_count: 4, external_count: 2, unknown_source_count: 0 },
    { date: '2026-10-27', participant_count: 9, institution_count: 3, external_count: 5, unknown_source_count: 1 },
  ],
};
const learning = {
  as_of: trend.as_of, state: 'ready' as const, paper_id: '10', release_id: '11', title: '安全培训', released_at: trend.as_of,
  required_learning_minutes: 480, eligible_count: 100, achieved_count: 80, pending_count: 20, achievement_rate: 0.8,
};
function fakeChart() { return { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn(), off: vi.fn(), dispatchAction: vi.fn() }; }
let charts: ReturnType<typeof fakeChart>[];
let observers: Array<{ resize: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }>;
beforeEach(() => {
  charts = []; observers = []; mocks.init.mockReset();
  mocks.init.mockImplementation(() => { const chart = fakeChart(); charts.push(chart); return chart; });
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn();
    constructor(resize: ResizeObserverCallback) { observers.push({ resize, disconnect: this.disconnect }); }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('dashboard ECharts data and lifecycle', () => {
  it('binds Shanghai dates and all source counts to stacked bar series with neutral unknown data', () => {
    const option = buildDashboardTrendOption(trend);
    expect((option.xAxis as any).data).toEqual(['2026-10-26', '2026-10-27']);
    expect((option.series as any[]).map(series => ({ name: series.name, type: series.type, stack: series.stack, data: series.data }))).toEqual([
      { name: '外来', type: 'bar', stack: 'participants', data: [2, 5] },
      { name: '本机构', type: 'bar', stack: 'participants', data: [4, 3] },
      { name: '来源未记录', type: 'bar', stack: 'participants', data: [0, 1] },
    ]);
    expect((option.series as any[])[2].itemStyle.color).toBe('#7a8794');
    expect((option.tooltip as any).formatter([{ dataIndex: 1 }])).toContain('来源未记录 1 人');
    expect(dashboardTrendPointLabel(trend.points[1])).toContain('2026-10-27：参考 9 人');
  });

  it('removes an absent unknown series and keeps genuine all-zero daily data', () => {
    const option = buildDashboardTrendOption({ ...trend, points: [{ date: '2026-10-27', participant_count: 0, institution_count: 0, external_count: 0, unknown_source_count: 0 }] });
    expect((option.series as any[]).map(series => series.data)).toEqual([[0], [0]]);
    expect((option.yAxis as any).max).toBe(4);
  });

  it('builds a learning donut from achieved and pending counts without fabricating an empty audience rate', () => {
    const option = buildDashboardLearningOption(learning);
    expect((option.series as any[])[0]).toMatchObject({ type: 'pie', radius: ['80%', '100%'], data: [{ name: '已达标', value: 80 }, { name: '未达标', value: 20 }] });
    const empty = buildDashboardLearningOption({ ...learning, state: 'no_audience', eligible_count: 0, achieved_count: 0, pending_count: 0, achievement_rate: null });
    expect(empty.series).toEqual([]);
    expect((buildDashboardLearningOption({ ...learning, achieved_count: 0, pending_count: 100, achievement_rate: 0 }).series as any[])[0].data.map((item: any) => item.value)).toEqual([0, 100]);
  });

  it('initializes once, replaces options and responds to container resize', () => {
    const chart = createDashboardChart(); const element = document.createElement('div');
    const option = buildDashboardTrendOption(trend); chart.setElement(element); chart.setOption(option);
    expect(mocks.init).not.toHaveBeenCalled(); chart.activate(); chart.activate();
    expect(mocks.init).toHaveBeenCalledTimes(1); expect(mocks.init).toHaveBeenCalledWith(element, undefined, { renderer: 'canvas' });
    expect(charts[0].setOption).toHaveBeenLastCalledWith(option, { notMerge: true });
    observers[0].resize([], {} as ResizeObserver); expect(charts[0].resize).toHaveBeenCalledTimes(1);
    const next = buildDashboardLearningOption(learning); chart.setOption(next);
    expect(charts[0].setOption).toHaveBeenLastCalledWith(next, { notMerge: true }); chart.dispose();
  });

  it('disposes the old canvas and observer while inactive, then creates a fresh chart on activation', () => {
    const chart = createDashboardChart(); chart.setElement(document.createElement('div')); chart.setOption(buildDashboardTrendOption(trend)); chart.activate();
    chart.deactivate(); expect(charts[0].dispose).toHaveBeenCalledTimes(1); expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    observers[0].resize([], {} as ResizeObserver); expect(charts[0].resize).not.toHaveBeenCalled();
    chart.setOption(buildDashboardLearningOption(learning)); chart.activate();
    expect(mocks.init).toHaveBeenCalledTimes(2); expect(charts[1].setOption).toHaveBeenCalledTimes(1);
    chart.dispose(); chart.dispose(); expect(charts[1].dispose).toHaveBeenCalledTimes(1);
  });

  it('forwards bar clicks and provides focused tooltip actions without leaving stale chart handlers', () => {
    const click = vi.fn(); const chart = createDashboardChart(click);
    chart.setElement(document.createElement('div')); chart.setOption(buildDashboardTrendOption(trend)); chart.activate();
    const callback = charts[0].on.mock.calls.find(([name]) => name === 'click')?.[1];
    callback({ componentType: 'series', seriesType: 'bar', dataIndex: 1, name: '2026-10-27' });
    expect(click).toHaveBeenCalledWith({ componentType: 'series', seriesType: 'bar', dataIndex: 1, name: '2026-10-27' });
    chart.showTip(1); expect(charts[0].dispatchAction).toHaveBeenCalledWith({ type: 'showTip', seriesIndex: 0, dataIndex: 1 });
    chart.hideTip(); expect(charts[0].dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' });
    chart.deactivate(); callback({ dataIndex: 0 }); expect(click).toHaveBeenCalledTimes(1);
  });
});
