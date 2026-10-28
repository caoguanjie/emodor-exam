import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { KeepAlive, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import ElementPlus, { ElSelect } from 'element-plus';
import TrainingStatistics from '../../views/admin/TrainingStatistics.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), download: vi.fn() }));
vi.mock('../../api/http', () => ({ default: { get: mocks.get }, download: mocks.download }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: () => true }) }));
const wrappers: VueWrapper[] = [];
const exam = { paper_id: '10', title: '公共考试', pool_scope: 'public', category_id: null, mode: 'random', total_score: 100, duration_minutes: 30, pass_score: 60, excellent_score: null };
const group = (difficulty: string, score: number) => ({ difficulty, finalized_users: 1, average_score: score, highest_score: score, lowest_score: score, passed_users: 1, pass_rate: 1, average_duration_seconds: 600, excellent_users: null, distribution: [] });
let summary: any;
beforeEach(() => {
  vi.resetAllMocks();
  summary = {
    exam: { ...exam }, release_id: '20', eligible_count: 0, eligible_started_count: 0, historical_started_count: 2,
    historical_only_started_count: 2, submitted_attempts: 3, submitted_users: 2, finalized_users: 2, participation_rate: null,
    score_groups: [group('easy', 80), group('hard', 90)], difficulty_composition: [{ difficulty: 'easy', users: 1 }, { difficulty: 'hard', users: 1 }],
    course_completion: { eligible_users: 0, required_lessons: 0, completed_users: 0, completion_rate: null }, uncompleted_reasons: [], as_of: '2026-10-28T01:00:00Z',
  };
  mocks.get.mockImplementation(async (path: string, config?: any) => {
    if (path.endsWith('/options')) return { papers: [{ id: '10', title: exam.title, category_id: null, pool_scope: 'public', status: 'published' }], categories: [] };
    if (path.endsWith('/overview')) return { items: [{ ...exam, status: 'published', release_id: '20', category_name: null, participant_count: 2, finalized_users: 2, average_score: 85 }], total: 1, page: 1, page_size: 20 };
    if (path.endsWith('/summary')) return summary;
    if (path.endsWith('/ranking')) {
      const difficulty = config.params.difficulty;
      return { items: [{ rank: 1, user_id: difficulty === 'easy' ? '1' : '2', name: difficulty === 'easy' ? '简单学员' : '困难学员', gender: null, source: difficulty === 'easy' ? 'institution' : 'external', difficulty, score: difficulty === 'easy' ? 80 : 90, duration_seconds: 600, record_id: '201' }], total: 1, page: 1, page_size: 20 };
    }
    throw new Error(`Unexpected statistics API ${path}`);
  });
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ''; });

async function render(path = '/admin/training-statistics') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/training-statistics', component: { template: '<div />' } }] });
  await router.push(path); await router.isReady();
  const wrapper = mount({ render: () => h(KeepAlive, null, { default: () => h(TrainingStatistics) }) }, {
    attachTo: document.body, global: { plugins: [router, ElementPlus] },
  });
  wrappers.push(wrapper); await flushPromises();
  return wrapper;
}

function description(wrapper: VueWrapper, label: string) {
  const cell = wrapper.findAll('.el-descriptions__label').find(item => item.text() === label);
  expect(cell, `missing description ${label}`).toBeDefined();
  return cell!.element.nextElementSibling?.textContent || '';
}

describe('public training statistics', () => {
  it('shows public scope and actual participation without presenting an estimated audience or rate', async () => {
    const wrapper = await render('/admin/training-statistics?paper_id=10');
    expect(wrapper.text()).toContain('公共题库');
    for (const label of ['当前应考', '参考率']) {
      expect(description(wrapper, label)).toContain('不适用');
    }
    expect(description(wrapper, '参考人数')).toContain('2 人');
    expect(description(wrapper, '已交卷人数')).toContain('2 人');
    expect(wrapper.text()).toContain('实际参与');
  });

  it('requests one frozen difficulty at a time and exports the same group', async () => {
    const wrapper = await render('/admin/training-statistics?paper_id=10');
    const rankingCalls = () => mocks.get.mock.calls.filter(([path]) => path.endsWith('/ranking'));
    expect(rankingCalls().at(-1)?.[1].params).toMatchObject({ paper_id: '10', difficulty: 'easy' });
    const difficulty = wrapper.findAllComponents(ElSelect).find(select => select.props('placeholder') === '选择卷面难度')!;
    difficulty.vm.$emit('update:modelValue', 'hard');
    difficulty.vm.$emit('change', 'hard');
    await flushPromises();
    expect(rankingCalls().at(-1)?.[1].params).toMatchObject({ difficulty: 'hard' });
    expect(wrapper.text()).toContain('困难学员');
    expect(wrapper.text()).not.toContain('简单学员');
    const button = wrapper.findAll('button').find(item => item.text() === '导出当前排名')!;
    await button.trigger('click'); await flushPromises();
    expect(mocks.download).toHaveBeenCalledWith('/statistics/training/export', expect.any(String), expect.objectContaining({ difficulty: 'hard' }));
    expect(rankingCalls().every(([, config]) => ['easy', 'hard'].includes(config.params.difficulty))).toBe(true);
  });

  it('does not label an old response with an empty category as a public exam', async () => {
    summary.exam = { ...summary.exam, pool_scope: undefined };
    const wrapper = await render('/admin/training-statistics?paper_id=10');
    expect(description(wrapper, '培训类别')).toContain('未填写');
    expect(description(wrapper, '当前应考')).toContain('0 人');
  });
});
