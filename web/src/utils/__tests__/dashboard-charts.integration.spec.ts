// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { init, use } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { buildDashboardLearningOption, buildDashboardTrendOption } from '../dashboard-charts';

use([SVGRenderer]);
describe('dashboard options with the real ECharts engine', () => {
  it('initializes real source providers and renders both production options', () => {
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 900, height: 220 });
    try {
      chart.setOption(buildDashboardTrendOption({ as_of: '2026-10-27T02:00:00.000Z', timezone: 'Asia/Shanghai', days: 7,
        date_from: '2026-10-26', date_to: '2026-10-27', points: [
          { date: '2026-10-26', participant_count: 6, institution_count: 4, external_count: 2, unknown_source_count: 0 },
          { date: '2026-10-27', participant_count: 9, institution_count: 3, external_count: 5, unknown_source_count: 1 },
        ] }), { notMerge: true });
      expect(chart.renderToSVGString()).toContain('10/27');
      expect(chart.getOption()).toMatchObject({ series: [
        { type: 'bar', data: [2, 5] }, { type: 'bar', data: [4, 3] }, { type: 'bar', data: [0, 1] },
      ] });
      chart.setOption(buildDashboardLearningOption({ as_of: '2026-10-27T02:00:00.000Z', state: 'ready',
        paper_id: '10', release_id: '11', title: '安全培训', released_at: '2026-10-27T02:00:00.000Z',
        required_learning_minutes: 480, eligible_count: 100, achieved_count: 80, pending_count: 20, achievement_rate: .8 }), { notMerge: true });
      expect(chart.renderToSVGString()).toContain('<path');
      expect(chart.getOption()).toMatchObject({ series: [{ type: 'pie', data: [{ name: '已达标', value: 80 }, { name: '未达标', value: 20 }] }] });
    } finally { chart.dispose(); }
  });
});
