import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, reactive, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import ElementPlus from 'element-plus';
import Dashboard from '../../views/admin/Dashboard.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), init: vi.fn(), charts: [] as any[], permissions: new Set<string>() }));
vi.mock('../../api/http', () => ({ default: { get: mocks.get } }));
vi.mock('echarts/core', () => ({ use: vi.fn(), init: mocks.init }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({
  user: { real_name: '管理员' }, can: (permission: string) => mocks.permissions.has(permission),
}) }));
const time = '2026-10-27T02:00:00.000Z';
const periods = { today: { date_from: '2026-10-27', date_to: '2026-10-27' }, last_7_days: { date_from: '2026-10-21', date_to: '2026-10-27' } };
const overview = () => ({ as_of: time, timezone: 'Asia/Shanghai', periods, metrics: {
  learner_count: 1286, learner_institution_count: 986, learner_external_count: 300, learner_unknown_source_count: 0,
  today_participant_count: 66, today_attempt_count: 76, last_7_days_participant_count: 318, last_7_days_attempt_count: 486,
  question_count: 2468, enabled_question_count: 2320, paper_count: 36, published_paper_count: 12,
} });
const trend = () => ({ as_of: time, timezone: 'Asia/Shanghai', days: 7, date_from: '2026-10-21', date_to: '2026-10-27', points: [
  { date: '2026-10-27', participant_count: 66, institution_count: 43, external_count: 20, unknown_source_count: 3 },
] });
const options = () => ({ as_of: time, total: 21, page: 1, page_size: 20, items: [
  { paper_id: '10', release_id: '11', title: '安全基础培训', released_at: time, required_learning_minutes: 480 },
] });
const summary = () => ({ as_of: time, state: 'ready', paper_id: '10', release_id: '11', title: '安全基础培训', released_at: time,
  required_learning_minutes: 480, eligible_count: 100, achieved_count: 80, pending_count: 20, achievement_rate: 0.8 });
const recent = () => ({ as_of: time, limit: 4, items: [
  { paper_id: '20', title: '已经归档的培训', category_id: '1', category_name: '基础', status: 'archived', release_id: '21',
    total_score: 100, duration_minutes: 30, pass_score: 60, participant_count: 4, finalized_users: 0, average_score: null, released_at: time },
] });
const wrappers: VueWrapper[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.charts = [];
  mocks.init.mockImplementation(() => {
    const chart = { setOption: vi.fn(), on: vi.fn(), off: vi.fn(), resize: vi.fn(), dispose: vi.fn(), dispatchAction: vi.fn() };
    mocks.charts.push(chart); return chart;
  });
  mocks.permissions = reactive(new Set(['students:read', 'questions:read', 'questions:write', 'papers:read', 'papers:write', 'statistics:read', 'exam_records:read']));
  mocks.get.mockImplementation(async (path: string, config?: { params?: Record<string, unknown> }) => {
    if (path === '/admin/dashboard') return overview();
    if (path.endsWith('/exam-trend')) return { ...trend(), days: config?.params?.days ?? 7 };
    if (path.endsWith('/learning-options')) return options();
    if (path.endsWith('/learning-summary')) return summary();
    if (path.endsWith('/recent-exams')) return recent();
    throw new Error(`Unexpected dashboard API ${path}`);
  });
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); });
async function render(cached = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] });
  await router.push('/admin/dashboard'); await router.isReady();
  const active = ref(true);
  const subject = cached ? defineComponent({ components: { Dashboard }, setup: () => ({ active }), template: '<KeepAlive><Dashboard v-if="active" /></KeepAlive>' }) : Dashboard;
  const wrapper = mount(subject, { attachTo: document.body, global: { plugins: [router, ElementPlus] } });
  wrappers.push(wrapper); await flushPromises(); return { wrapper, router, active };
}

describe('admin operations dashboard', () => {
  it('renders the total and both sources in one learner card, followed by the other four cards', async () => {
    const { wrapper } = await render(); const card = wrapper.get('[data-testid="dashboard-learner-card"]');
    expect(card.text()).toContain('1,286'); expect(card.text()).toContain('本机构 986'); expect(card.text()).toContain('外来 300');
    expect(wrapper.get('[data-testid="dashboard-overview"]').findAll('[data-metric]').map(item => item.attributes('data-metric')))
      .toEqual(['learners', 'today', 'week', 'questions', 'papers']);
    expect(wrapper.get('[data-testid="today-participants"]').text()).toBe('66');
    expect(wrapper.get('[data-testid="today-attempts"]').text()).toBe('76');
  });

  it.each([
    ['dashboard-learner-total', '/admin/students', { entry: 'dashboard', status: '1' }],
    ['dashboard-learner-institution', '/admin/students', { entry: 'dashboard', status: '1', source: 'institution' }],
    ['dashboard-learner-external', '/admin/students', { entry: 'dashboard', status: '1', source: 'external' }],
    ['dashboard-today-link', '/admin/exam-records', { date_from: '2026-10-27', date_to: '2026-10-27' }],
    ['dashboard-week-link', '/admin/exam-records', { date_from: '2026-10-21', date_to: '2026-10-27' }],
    ['dashboard-question-total', '/admin/questions', { entry: 'dashboard', enabled: 'all' }],
    ['dashboard-paper-total', '/admin/papers', { entry: 'dashboard', status: 'all' }],
    ['dashboard-action-create', '/admin/papers', { entry: 'dashboard', create: '1' }],
    ['dashboard-action-import', '/admin/questions/import', {}],
    ['dashboard-action-students', '/admin/students', { entry: 'dashboard' }],
    ['dashboard-action-statistics', '/admin/training-statistics', { entry: 'dashboard' }],
    ['dashboard-records-link', '/admin/exam-records', {}],
    ['dashboard-statistics-link', '/admin/training-statistics', { entry: 'dashboard' }],
    ['dashboard-recent-detail-20', '/admin/training-statistics', { entry: 'dashboard', paper_id: '20' }],
  ])('opens %s with the agreed target query', async (testId, path, query) => {
    const { wrapper, router } = await render();
    await wrapper.get(`[data-testid="${testId}"]`).trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe(path); expect(router.currentRoute.value.query).toEqual(query);
  });

  it('opens a trend day by keyboard using the server date and no hidden source filter', async () => {
    const { wrapper, router } = await render();
    await wrapper.get('[data-day="2026-10-27"]').trigger('keydown', { key: 'Enter' }); await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ date_from: '2026-10-27', date_to: '2026-10-27' });
  });

  it('reveals the full day values as visible text when a bar is focused', async () => {
    const { wrapper } = await render(); await wrapper.get('[data-day="2026-10-27"]').trigger('focus');
    expect(wrapper.get('[data-testid="dashboard-trend-hint"]').text()).toContain('本机构 43 人');
    expect(wrapper.get('[data-testid="dashboard-trend-hint"]').text()).toContain('来源未记录 3 人');
  });

  it('opens the exact date when an ECharts bar is clicked', async () => {
    const { router } = await render();
    const chart = mocks.charts.find(chart => chart.setOption.mock.calls.some(([option]: any[]) => option.series?.[0]?.type === 'bar'));
    chart.on.mock.calls.find(([name]: string[]) => name === 'click')[1]({ componentType: 'series', seriesType: 'bar', dataIndex: 0, name: '2026-10-27' });
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ date_from: '2026-10-27', date_to: '2026-10-27' });
  });

  it('allows statistics display without granting record navigation', async () => {
    mocks.permissions.delete('exam_records:read'); const { wrapper, router } = await render();
    expect(wrapper.get('[data-testid="dashboard-today-card"]').text()).toContain('66');
    expect(wrapper.get('[data-testid="dashboard-today-link"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="dashboard-records-link"]').exists()).toBe(false);
    await wrapper.get('[data-day="2026-10-27"]').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/admin/dashboard');
  });

  it('hides unauthorized data and requires both paper permissions to offer creation', async () => {
    mocks.permissions.delete('statistics:read'); mocks.permissions.delete('questions:read'); mocks.permissions.delete('papers:write');
    const { wrapper } = await render();
    expect(wrapper.find('[data-testid="dashboard-trend"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="dashboard-learning"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="dashboard-recent"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="dashboard-today-card"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="dashboard-question-card"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="dashboard-action-create"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="dashboard-action-import"]').exists()).toBe(true);
  });

  it('removes old data and entry points after a live permission revocation', async () => {
    const { wrapper } = await render(); mocks.permissions.delete('statistics:read'); mocks.permissions.delete('students:read'); await flushPromises();
    expect(wrapper.find('[data-testid="dashboard-trend"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="dashboard-learner-card"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="dashboard-action-statistics"]').exists()).toBe(false);
  });

  it('renders real zero values and a neutral unknown-source segment with equivalent text', async () => {
    const original = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => path === '/admin/dashboard'
      ? Promise.resolve({ ...overview(), metrics: { ...overview().metrics, today_participant_count: 0, today_attempt_count: 0 } }) : original(path, config));
    const { wrapper } = await render();
    expect(wrapper.get('[data-testid="today-participants"]').text()).toBe('0');
    expect(wrapper.get('[data-testid="today-attempts"]').text()).toBe('0');
    expect(wrapper.get('[data-testid="dashboard-trend"]').text()).toContain('来源未记录');
    expect(wrapper.get('[data-day="2026-10-27"]').attributes('aria-label')).toContain('来源未记录 3');
    expect(wrapper.find('[data-source="unknown"]').exists()).toBe(true);
  });

  it('keeps the learning selection independent from an archived recent exam detail', async () => {
    const { wrapper } = await render(); const before = wrapper.get('[data-testid="dashboard-learning"]').text();
    await wrapper.get('[data-testid="dashboard-recent-detail-20"]').trigger('click'); await flushPromises();
    expect(wrapper.get('[data-testid="dashboard-learning"]').text()).toBe(before);
    expect(mocks.get.mock.calls.filter(([path]) => String(path).endsWith('/learning-summary'))).toHaveLength(1);
    expect(wrapper.get('[data-testid="dashboard-recent"]').text()).toContain('已归档');
    expect(wrapper.get('[data-testid="recent-average-20"]').text()).toBe('—');
  });

  it.each([
    ['no requirement', { options: { ...options(), items: [], total: 0 } }, '暂无必修学时要求'],
    ['no audience', { summary: { ...summary(), state: 'no_audience', eligible_count: 0, achieved_count: 0, pending_count: 0, achievement_rate: null } }, '暂无应学人员'],
    ['zero achieved', { summary: { ...summary(), achieved_count: 0, pending_count: 100, achievement_rate: 0 } }, '0.0%'],
  ])('distinguishes %s in the learning card', async (_name, data, text) => {
    const original = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => {
      if (String(path).endsWith('/learning-options') && 'options' in data) return Promise.resolve(data.options);
      if (String(path).endsWith('/learning-summary') && 'summary' in data) return Promise.resolve(data.summary);
      return original(path, config);
    });
    const { wrapper } = await render(); const card = wrapper.get('[data-testid="dashboard-learning"]');
    expect(card.text()).toContain(text);
    if (_name !== 'zero achieved') expect(card.text()).not.toContain('0.0%');
  });

  it('shows module failure and retries only that module', async () => {
    const original = mocks.get.getMockImplementation()!; let failed = true;
    mocks.get.mockImplementation((path, config) => String(path).endsWith('/recent-exams') && failed
      ? Promise.reject(new Error('考试摘要暂不可用')) : original(path, config));
    const { wrapper } = await render();
    expect(wrapper.get('[data-testid="dashboard-recent"]').text()).toContain('考试摘要暂不可用');
    expect(wrapper.get('[data-testid="dashboard-learner-card"]').text()).toContain('1,286');
    failed = false; await wrapper.get('[data-testid="dashboard-recent-retry"]').trigger('click'); await flushPromises();
    expect(wrapper.get('[data-testid="dashboard-recent"]').text()).toContain('已经归档的培训');
    expect(mocks.get.mock.calls.filter(([path]) => path === '/admin/dashboard')).toHaveLength(1);
  });

  it('recovers the default learning summary after the initial candidate request fails', async () => {
    const original = mocks.get.getMockImplementation()!; let failed = true;
    mocks.get.mockImplementation((path, config) => String(path).endsWith('/learning-options') && failed
      ? Promise.reject(new Error('培训列表暂不可用')) : original(path, config));
    const { wrapper } = await render(); failed = false;
    const retry = wrapper.get('[data-testid="dashboard-learning"]').findAll('button').find(button => button.text() === '重试培训列表')!;
    await retry.trigger('click'); await flushPromises();
    expect(wrapper.get('[data-testid="dashboard-learning"]').text()).toContain('80.0%');
    expect(mocks.get.mock.calls.filter(([path]) => String(path).endsWith('/learning-summary'))).toHaveLength(1);
  });

  it('switches trend duration without fetching or changing either lower module', async () => {
    const { wrapper } = await render();
    await wrapper.get('button[aria-label="查看近 30 日考试趋势"]').trigger('click'); await flushPromises();
    expect(mocks.get.mock.calls.filter(([path]) => String(path).endsWith('/exam-trend')).at(-1)?.[1].params).toEqual({ days: 30 });
    expect(mocks.get.mock.calls.filter(([path]) => String(path).endsWith('/learning-summary'))).toHaveLength(1);
    expect(mocks.get.mock.calls.filter(([path]) => String(path).endsWith('/recent-exams'))).toHaveLength(1);
  });

  it('searches and paginates candidates without losing a selection outside the page', async () => {
    const original = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => {
      if (String(path).endsWith('/learning-options') && (config?.params?.page === 2 || config?.params?.keyword)) return Promise.resolve({
        ...options(), page: config.params.page, items: [{ paper_id: '50', release_id: '51', title: '应急消防培训', released_at: time, required_learning_minutes: 90 }],
      });
      if (String(path).endsWith('/learning-summary') && config?.params?.paper_id === '50') return Promise.resolve({
        ...summary(), paper_id: '50', release_id: '51', title: '应急消防培训', required_learning_minutes: 90,
      });
      return original(path, config);
    });
    const { wrapper } = await render();
    await wrapper.get('button[aria-label="切换必修培训"]').trigger('click'); await flushPromises();
    let picker = document.querySelector('.learning-picker')!;
    const next = Array.from(picker.querySelectorAll('button')).find(button => button.textContent === '下一页')!;
    next.click(); await flushPromises();
    expect(mocks.get.mock.calls.filter(([path]) => String(path).endsWith('/learning-options')).at(-1)?.[1].params).toEqual({ page: 2, page_size: 20 });
    expect(wrapper.get('[data-testid="dashboard-learning"]').text()).toContain('安全基础培训');
    expect(mocks.get.mock.calls.filter(([path]) => String(path).endsWith('/learning-summary'))).toHaveLength(1);
    picker = document.querySelector('.learning-picker')!;
    const input = picker.querySelector('input')!; input.value = '消防'; input.dispatchEvent(new Event('input', { bubbles: true }));
    picker.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises();
    expect(mocks.get.mock.calls.filter(([path]) => String(path).endsWith('/learning-options')).at(-1)?.[1].params).toEqual({ keyword: '消防', page: 1, page_size: 20 });
    (document.querySelector('.learning-option-list button[title="应急消防培训"]') as HTMLButtonElement).click(); await flushPromises();
    expect(wrapper.get('[data-testid="dashboard-learning"]').text()).toContain('应急消防培训');
    expect(wrapper.get('[data-testid="dashboard-learning"]').text()).toContain('1 小时 30 分钟');
    expect(mocks.get.mock.calls.filter(([path]) => String(path).endsWith('/recent-exams'))).toHaveLength(1);
  });

  it('closes the teleported training picker on cached page deactivation and reloads once on return', async () => {
    const { wrapper, active } = await render(true);
    await wrapper.get('button[aria-label="切换必修培训"]').trigger('click'); await flushPromises();
    await vi.waitFor(() => expect(document.querySelector('.el-popover')?.getAttribute('aria-hidden')).toBe('false'));
    active.value = false; await flushPromises();
    expect((document.querySelector('.el-popover') as HTMLElement).style.display).toBe('none');
    active.value = true; await flushPromises();
    expect(mocks.get.mock.calls.filter(([path]) => path === '/admin/dashboard')).toHaveLength(2);
  });
});
