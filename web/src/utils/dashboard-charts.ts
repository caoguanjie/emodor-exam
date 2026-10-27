import { init, use, type ComposeOption, type EChartsType } from 'echarts/core';
import { BarChart, PieChart, type BarSeriesOption, type PieSeriesOption } from 'echarts/charts';
import { GridComponent, TooltipComponent, type GridComponentOption, type TooltipComponentOption } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { DashboardExamTrend, DashboardLearningSummary } from '../api/training-types';

use([BarChart, PieChart, GridComponent, TooltipComponent, CanvasRenderer]);

export type DashboardChartOption = ComposeOption<BarSeriesOption | PieSeriesOption | GridComponentOption | TooltipComponentOption>;
export interface DashboardChartClick { componentType?: string; seriesType?: string; dataIndex?: number; name?: string }
const colors = { institution: '#2a78d6', external: '#1baf7a', muted: '#7a8794', line: '#e6eaee', ink: '#17233d' };

export function dashboardTrendPointLabel(point: DashboardExamTrend['points'][number]): string {
  return `${point.date}：参考 ${point.participant_count} 人，本机构 ${point.institution_count} 人，外来 ${point.external_count} 人${point.unknown_source_count ? `，来源未记录 ${point.unknown_source_count} 人` : ''}`;
}

export function buildDashboardTrendOption(data: DashboardExamTrend): DashboardChartOption {
  const maximum = Math.max(4, Math.ceil(Math.max(0, ...data.points.map(point => point.participant_count)) / 4) * 4);
  const sources = [
    { name: '外来', key: 'external_count' as const, color: colors.external },
    { name: '本机构', key: 'institution_count' as const, color: colors.institution },
    ...(data.points.some(point => point.unknown_source_count > 0) ? [{ name: '来源未记录', key: 'unknown_source_count' as const, color: colors.muted }] : []),
  ];
  return {
    animation: false,
    grid: { left: 30, right: 8, top: 20, bottom: 28 },
    tooltip: {
      trigger: 'axis', renderMode: 'richText', confine: true,
      axisPointer: { type: 'shadow', shadowStyle: { color: '#2a78d608' } },
      formatter: params => {
        const entry = Array.isArray(params) ? params[0] : params;
        const index = entry?.dataIndex;
        return typeof index === 'number' && data.points[index] ? dashboardTrendPointLabel(data.points[index]).replaceAll('，', '\n') : '';
      },
    },
    xAxis: {
      type: 'category', data: data.points.map(point => point.date),
      axisLine: { lineStyle: { color: colors.line } }, axisTick: { show: false },
      axisLabel: { color: colors.muted, fontSize: 10, interval: data.days === 30 ? 4 : 0, showMinLabel: true, showMaxLabel: true,
        formatter: (value: string) => value.slice(5).replace('-', '/') },
    },
    yAxis: {
      type: 'value', min: 0, max: maximum, interval: maximum / 4,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: colors.muted, fontSize: 10 }, splitLine: { lineStyle: { color: colors.line } },
    },
    series: sources.map((source, index): BarSeriesOption => ({
      name: source.name, type: 'bar', stack: 'participants', barMaxWidth: 32,
      data: data.points.map(point => point[source.key]),
      itemStyle: { color: source.color, borderColor: '#ffffff', borderWidth: .5, ...(index === sources.length - 1 ? { borderRadius: [4, 4, 0, 0] } : {}) },
      emphasis: { focus: 'series' },
      label: index === sources.length - 1 ? { show: true, position: 'top', color: '#51565f', fontSize: 10,
        formatter: params => data.days === 7 || params.dataIndex % 3 === 0 ? String(data.points[params.dataIndex]?.participant_count ?? '') : '' } : { show: false },
    })),
  };
}

export function buildDashboardLearningOption(data: DashboardLearningSummary): DashboardChartOption {
  if (data.state !== 'ready' || data.eligible_count === 0) return { series: [] };
  return {
    animation: false,
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, formatter: params => {
      const entry = Array.isArray(params) ? params[0] : params;
      return `${entry?.name ?? ''}：${entry?.value ?? 0} 人`;
    } },
    series: [{
      type: 'pie', radius: ['80%', '100%'], center: ['50%', '50%'], startAngle: 90,
      clockwise: true, label: { show: false }, labelLine: { show: false }, emphasis: { scale: false },
      data: [
        { name: '已达标', value: data.achieved_count, itemStyle: { color: colors.external } },
        { name: '未达标', value: data.pending_count, itemStyle: { color: colors.line } },
      ],
    }],
  };
}

/** Owns the canvas and observer; cached pages release both until activated again. */
export function createDashboardChart(onClick?: (event: DashboardChartClick) => void) {
  let element: HTMLElement | null = null;
  let chart: EChartsType | null = null;
  let observer: ResizeObserver | null = null;
  let option: DashboardChartOption | null = null;
  let active = false;
  function disposeInstance() {
    observer?.disconnect(); observer = null;
    if (chart) { chart.off('click'); chart.dispose(); chart = null; }
  }
  function render() {
    if (!active || !element || !option) return;
    if (!chart) {
      const instance = init(element, undefined, { renderer: 'canvas' });
      chart = instance;
      instance.on('click', event => { if (active && chart === instance) onClick?.(event as DashboardChartClick); });
      observer = new ResizeObserver(() => { if (active && chart === instance) instance.resize(); });
      observer.observe(element);
    }
    chart.setOption(option, { notMerge: true });
  }
  return {
    setElement(value: HTMLElement | null) {
      if (element === value) return;
      disposeInstance(); element = value; render();
    },
    setOption(value: DashboardChartOption) { option = value; render(); },
    activate() { if (!active) { active = true; render(); } },
    deactivate() { active = false; disposeInstance(); },
    dispose() { active = false; disposeInstance(); element = null; option = null; },
    showTip(dataIndex: number) { chart?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex }); },
    hideTip() { chart?.dispatchAction({ type: 'hideTip' }); },
  };
}
