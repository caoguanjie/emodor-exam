import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElDatePicker, ElFormItem, ElSelect } from 'element-plus';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ExamRecords from '../../views/admin/ExamRecords.vue';
import ExamRecordDetail from '../../views/admin/ExamRecordDetail.vue';
import type { ExamRecordSummary } from '../../api/training-types';

interface Call { method: string; path: string; options?: any }
const transport = vi.hoisted(() => ({
  calls: [] as Call[],
  respond: async (_method: string, _path: string, _options?: any): Promise<any> => ({}),
}));
vi.mock('../../api/http', () => ({ default: Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, async (path: string, options?: any) => {
  transport.calls.push({ method, path, options });
  return transport.respond(method, path, options);
}])) }));

const wrappers: VueWrapper[] = [];
function record(overrides: Partial<ExamRecordSummary> = {}): ExamRecordSummary {
  return {
    record_id: '42', paper_id: '7', paper_title: '安全考试', user_id: '9', username: 'learner9', name: '学员甲',
    source: 'institution', category_id: '3', difficulty: 'easy', release_id: '5', attempt_no: 2,
    started_at: '2026-10-27T01:00:00.000Z', deadline_at: '2026-10-27T01:30:00.000Z',
    submitted_at: null, answered_count: 0, total_count: 2, status: 'in_progress', grading_state: 'not_submitted',
    submission_method: null, score: 0, ...overrides,
  };
}
const options = { papers: [{ id: '7', title: '安全考试' }], categories: [{ id: '3', name: '产业工人' }] };
const requests = (path: string) => transport.calls.filter(c => c.method === 'get' && c.path === path);
const latestParams = () => requests('/admin/exam-records').at(-1)?.options.params;
beforeEach(() => {
  transport.calls = [];
  transport.respond = async (_method, path) => {
    if (path === '/admin/exam-records/options') return options;
    if (path === '/admin/exam-records') return { items: [record()], total: 90, page: 1, page_size: 20 };
    if (path.endsWith('/result')) return { record_id: '42', status: 'failed', grading_state: 'finalized', submission_method: 'manual', legacy: false, score: 0, passed: false, correct_rate: 0, submitted_at: '2026-10-27T01:10:00Z', graded_at: '2026-10-27T01:10:00Z', items: [] };
    return record();
  };
});
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); document.body.innerHTML = ''; });
async function page(path = '/admin/exam-records') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/admin/exam-records', component: ExamRecords },
    { path: '/admin/exam-records/:id', component: ExamRecordDetail },
  ] });
  await router.push(path); await router.isReady();
  const wrapper = mount(RouterView, { attachTo: document.body, global: { plugins: [ElementPlus, router] } });
  wrappers.push(wrapper); await flushPromises();
  return { wrapper, router };
}
function formItem(wrapper: VueWrapper, label: string) {
  const field = wrapper.findAllComponents(ElFormItem).find(item => item.props('label') === label);
  expect(field, `missing filter ${label}`).toBeDefined();
  return field!;
}
async function click(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('button').find(item => item.text() === label);
  expect(button, `missing button ${label}`).toBeDefined();
  await button!.trigger('click'); await flushPromises();
}

describe('exam records list', () => {
  it('shows the common illustrated empty state only after an empty successful request', async () => {
    const original = transport.respond;
    let rejectList = false;
    transport.respond = (method, path, payload) => path === '/admin/exam-records'
      ? rejectList ? Promise.reject(new Error('读取记录失败')) : Promise.resolve({ items: [], total: 0 })
      : original(method, path, payload);
    const { wrapper, router } = await page();
    expect(wrapper.find('.el-empty__image svg').exists()).toBe(true);
    expect(wrapper.get('.el-empty__description').text()).toBe('暂无考试记录');
    rejectList = true;
    await router.push('/admin/exam-records?keyword=测试'); await flushPromises();
    expect(wrapper.text()).toContain('读取记录失败');
    expect(wrapper.find('.el-empty').exists()).toBe(false);
  });
  it('keeps unsubmitted zero hidden and finalized scores visible', async () => {
    const rows = [
      record(),
      record({ record_id: '43', name: '学员乙', status: 'failed', grading_state: 'finalized', submitted_at: '2026-10-27T01:10:00Z' }),
      record({ record_id: '44', name: '学员丙', status: 'passed', grading_state: 'finalized', score: 80, submitted_at: '2026-10-27T01:10:00Z' }),
    ];
    const original = transport.respond;
    transport.respond = (method, path, payload) => path === '/admin/exam-records' ? Promise.resolve({ items: rows, total: 3 }) : original(method, path, payload);
    const { wrapper } = await page();
    expect(wrapper.findAll('.el-table__header th').map(h => h.text())).toEqual(['学员', '试卷', '培训类别', '成绩', '考试状态', '开考时间', '操作']);
    const body = wrapper.findAll('.el-table__body tr');
    expect(body[0].text()).not.toContain('0 分'); expect(body[0].text()).toContain('—');
    expect(body[1].text()).toContain('0 分');
    expect(body[2].text()).toContain('已通过'); expect(body[2].text()).toContain('80 分');
    expect(body[0].text()).toContain('第 2 次');
  });
  it('sends all six flat filters while keeping entry labels and old source parameters out of requests', async () => {
    const { wrapper, router } = await page('/admin/exam-records?user_id=9&learner_name=学员甲&paper_title=提示标题&source=external');
    expect(wrapper.findAllComponents(ElFormItem).map(item => item.props('label')).filter(Boolean)).toEqual(['关键字', '试卷名称', '培训类别', '难度', '考试状态', '考试日期']);
    await formItem(wrapper, '关键字').get('input').setValue(' learner ');
    for (const [label, value] of [['试卷名称', '7'], ['培训类别', '3'], ['难度', 'hard'], ['考试状态', 'failed']]) {
      formItem(wrapper, label).getComponent(ElSelect).vm.$emit('update:modelValue', value);
    }
    const dateRange = formItem(wrapper, '考试日期').getComponent(ElDatePicker);
    expect(dateRange.props('type')).toBe('daterange');
    dateRange.vm.$emit('update:modelValue', ['2026-10-26', '2026-10-27']);
    await flushPromises(); await click(wrapper, '查询');
    expect(latestParams()).toEqual({ page: 1, page_size: 20, user_id: '9', keyword: 'learner', paper_id: '7', category_id: '3', difficulty: 'hard', result_status: 'failed', date_from: '2026-10-26', date_to: '2026-10-27' });
    expect(router.currentRoute.value.query).toMatchObject({ paper_id: '7', category_id: '3', difficulty: 'hard', result_status: 'failed', date_from: '2026-10-26', date_to: '2026-10-27' });
    expect(requests('/admin/exam-records/options')).toHaveLength(1);
    expect(transport.calls.every(call => call.method === 'get' && call.path.startsWith('/admin/exam-records'))).toBe(true);
    expect(wrapper.text()).not.toContain('更多筛选');
  });
  it('restores URL filters and paging on navigation, aborts older loads, and discards their late data', async () => {
    let finishOld!: (value: any) => void;
    const original = transport.respond;
    transport.respond = (method, path, payload) => path === '/admin/exam-records' && payload?.params.page === 3
      ? new Promise(resolve => { finishOld = resolve; }) : original(method, path, payload);
    const { wrapper, router } = await page('/admin/exam-records?paper_id=7&paper_title=安全考试&page=3&page_size=20&difficulty=hard');
    expect(latestParams()).toMatchObject({ page: 3, paper_id: '7', difficulty: 'hard' });
    const oldSignal = requests('/admin/exam-records')[0].options.signal;
    await router.push('/admin/exam-records?user_id=9&learner_name=学员甲&page=2&page_size=50'); await flushPromises();
    expect(oldSignal.aborted).toBe(true);
    expect(latestParams()).toEqual({ page: 2, page_size: 50, user_id: '9' });
    finishOld({ items: [record({ name: '迟到数据' })], total: 1 }); await flushPromises();
    expect(wrapper.text()).not.toContain('迟到数据'); expect(wrapper.text()).toContain('学员甲');
    await click(wrapper, '重置');
    expect(latestParams()).toEqual({ page: 1, page_size: 20 });
    expect(router.currentRoute.value.query.user_id).toBeUndefined();
  });
  it('keeps paging in the route and returns from detail to the exact filtered list', async () => {
    const { wrapper, router } = await page('/admin/exam-records?paper_id=7&paper_title=安全考试&page=2&page_size=20&result_status=failed');
    await wrapper.get('.el-pagination .btn-next').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.query.page).toBe('3'); expect(latestParams().page).toBe(3);
    const listPath = router.currentRoute.value.fullPath;
    await click(wrapper, '详情');
    expect(router.currentRoute.value.fullPath).toBe(listPath);
    expect(wrapper.find('.el-dialog.re-form-dialog').exists()).toBe(true);
    expect(wrapper.text()).toContain('考试记录详情');
    await click(wrapper, '关闭');
    expect(router.currentRoute.value.fullPath).toBe(listPath); expect(latestParams().page).toBe(3);
    expect(transport.calls.some(call => call.path.includes('/undefined'))).toBe(false);
  });
  it('keeps an exact paper filter and readable entry label when options fail, then retries options independently', async () => {
    let failed = true; const original = transport.respond;
    transport.respond = (method, path, payload) => path === '/admin/exam-records/options' && failed ? Promise.reject(new Error('筛选选项暂不可用')) : original(method, path, payload);
    const { wrapper } = await page('/admin/exam-records?paper_id=7&paper_title=历史安全卷');
    expect(latestParams().paper_id).toBe('7'); expect(wrapper.text()).toContain('历史安全卷');
    expect(wrapper.text()).toContain('筛选选项暂不可用');
    failed = false; await click(wrapper, '重试选项');
    expect(requests('/admin/exam-records/options')).toHaveLength(2);
    expect(requests('/admin/exam-records')).toHaveLength(1);
  });
  it('restores and clears both ends of the single date range', async () => {
    const { wrapper, router } = await page('/admin/exam-records?paper_id=7&date_from=2026-10-26&date_to=2026-10-27');
    const range = formItem(wrapper, '考试日期').getComponent(ElDatePicker);
    expect(range.props('type')).toBe('daterange');
    expect(range.props('modelValue')).toEqual(['2026-10-26', '2026-10-27']);
    range.vm.$emit('update:modelValue', null);
    await flushPromises(); await click(wrapper, '查询');
    expect(latestParams()).toEqual({ page: 1, page_size: 20, paper_id: '7' });
    expect(router.currentRoute.value.query.date_from).toBeUndefined();
    expect(router.currentRoute.value.query.date_to).toBeUndefined();
  });
  it.each(['date_from', 'date_to'] as const)('drops an incomplete %s bookmark rather than applying an invisible range', async key => {
    const { wrapper } = await page(`/admin/exam-records?paper_id=7&${key}=2026-10-27`);
    expect(latestParams()).toEqual({ page: 1, page_size: 20, paper_id: '7' });
    expect(formItem(wrapper, '考试日期').getComponent(ElDatePicker).props('modelValue')).toBeNull();
  });
});

describe('readonly exam record detail', () => {
  it.each(['in_progress', 'timeout'] as const)('does not request a result or show internal zero for %s', async status => {
    const original = transport.respond;
    transport.respond = (method, path, payload) => path === '/admin/exam-records/42' ? Promise.resolve(record({ status })) : original(method, path, payload);
    const { wrapper } = await page('/admin/exam-records/42');
    expect(requests('/admin/exam-records/42/result')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('0 分'); expect(wrapper.text()).not.toContain('安全元数据');
    expect(wrapper.text()).not.toContain('来源');
  });
  it('preserves zero score, readonly answer preview, correct answers and per-question points', async () => {
    const original = transport.respond;
    transport.respond = async (method, path, payload) => {
      if (path === '/admin/exam-records/42') return { ...record({ status: 'failed', grading_state: 'finalized', submitted_at: '2026-10-27T01:10:00Z' }), total_score: 100, category_name: '产业工人', result_status: 'failed' };
      if (path === '/admin/exam-records/42/result') return { ...(await original(method, path, payload)), items: [
        { item_id: '101', type: 'single', stem: '<p>安全题干</p>', options: [{ key: 'A', text: '正确选项' }, { key: 'B', text: '学员所选' }], score: 100, answer: { item_id: '101', selected: [1] }, correct_answer: [0], analysis: '<p>试题解析</p>', gained_score: 0 },
      ] };
      return original(method, path, payload);
    };
    const { wrapper } = await page('/admin/exam-records/42');
    expect(wrapper.text()).toContain('0 / 100 分'); expect(wrapper.text()).toContain('安全题干');
    expect(wrapper.get('.learner-profile').text()).toContain('学员甲');
    expect(wrapper.get('.learner-profile').text()).toContain('账号：learner9');
    expect(wrapper.find('.profile-avatar').exists()).toBe(true);
    expect(wrapper.get('.exam-description').text()).toContain('10 分 0 秒');
    expect(wrapper.get('.exam-description .el-descriptions__table').classes()).toContain('is-bordered');
    expect(wrapper.find('.question-preview--paper').exists()).toBe(true);
    expect(wrapper.find('.exam-extra').exists()).toBe(false);
    expect(wrapper.get('.time-note').text()).toContain('时间均为北京时间');
    expect(wrapper.text()).not.toContain('可查看本次考试的成绩与逐题作答。');
    expect(wrapper.text()).not.toContain('正确答案：'); expect(wrapper.text()).toContain('试题解析');
    expect(wrapper.text()).not.toContain('难度未知');
    expect(wrapper.get('.question-card header').text()).toContain('单选题');
    expect(wrapper.find('.answer-panel').exists()).toBe(false);
    expect(wrapper.get('.question-feedback-status').text()).toBe('答错');
    expect(wrapper.get('.question-points').text()).toBe('0 / 100 分');
    expect(wrapper.get('.question-preview__option.is-wrong').text()).toContain('学员所选');
    expect(wrapper.get('.question-preview__option.is-correct').text()).toContain('正确选项');
    expect(requests('/admin/exam-records/42/result')[0].options.headers['X-Question-Content-Version']).toBe('3');
    expect(transport.calls.every(call => call.method === 'get')).toBe(true);
  });
  it('does not load an answer sheet for a retired or unavailable record', async () => {
    const original = transport.respond;
    transport.respond = (method, path, payload) => path === '/admin/exam-records/42'
      ? Promise.reject(new Error('考试记录不存在')) : original(method, path, payload);
    const { wrapper } = await page('/admin/exam-records/42');
    expect(wrapper.text()).toContain('考试记录不存在');
    expect(requests('/admin/exam-records/42/result')).toHaveLength(0);
  });
  it('reloads when the detail ID changes and ignores a late result from the previous ID', async () => {
    let finishOld!: (value: any) => void; const original = transport.respond;
    transport.respond = (method, path, payload) => {
      if (path === '/admin/exam-records/42') return Promise.resolve(record({ status: 'failed', grading_state: 'finalized', submitted_at: '2026-10-27T01:10:00Z' }));
      if (path === '/admin/exam-records/42/result') return new Promise(resolve => { finishOld = resolve; });
      if (path === '/admin/exam-records/43') return Promise.resolve(record({ record_id: '43', name: '学员乙' }));
      return original(method, path, payload);
    };
    const { wrapper, router } = await page('/admin/exam-records/42');
    const signal = requests('/admin/exam-records/42/result')[0].options.signal;
    await router.push('/admin/exam-records/43'); await flushPromises();
    expect(signal.aborted).toBe(true); expect(wrapper.text()).toContain('学员乙');
    finishOld({ ...(await original('get', '/admin/exam-records/42/result')), score: 99 }); await flushPromises();
    expect(wrapper.text()).not.toContain('99 分'); expect(requests('/admin/exam-records/43/result')).toHaveLength(0);
  });
  it.each(['https://example.com/admin/exam-records', '//example.com/admin/exam-records', '/admin/users', '/admin/exam-records/42'])('rejects unsafe return target %s', async target => {
    const { wrapper, router } = await page(`/admin/exam-records/42?return_to=${encodeURIComponent(target)}`);
    await click(wrapper, '关闭'); expect(router.currentRoute.value.path).toBe('/admin/exam-records');
  });
});
