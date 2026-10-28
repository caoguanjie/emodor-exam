import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElDialog, ElFormItem, ElMessageBox, ElRadioGroup, ElSelect } from 'element-plus';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import Papers from '../../../views/admin/Papers.vue';

interface Call { method: string; path: string; payload?: any }
const transport = vi.hoisted(() => ({
  calls: [] as Call[], permissions: new Set<string>(),
  respond: async (_method: string, _path: string, _payload?: any): Promise<any> => ({}),
}));
vi.mock('../../../api/http', () => ({ default: Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, async (path: string, payload?: any) => {
  transport.calls.push({ method, path, payload: payload ? JSON.parse(JSON.stringify(payload)) : undefined });
  return transport.respond(method, path, payload);
}])) }));
vi.mock('../../../stores/auth', () => ({ useAuthStore: () => ({ can: (permission: string) => transport.permissions.has(permission) }) }));
const source = {
  id: '21', title: '公共正式卷', business_scope: 'training', exam_purpose: 'formal', mode: 'random', pool_scope: 'public',
  category_id: null, status: 'published', total_score: 100, pass_score: 70, duration_minutes: 40,
  max_attempts: 8, partial_credit_ratio: .25, rules: [{ type: 'single', count: 100, score_cents: 100 }],
  requires_learning: true, required_learning_minutes: 75, course_ids: ['31'], regulation_ids: [], remark: null,
};
const practiceTemplate = {
  title: '模拟考 · 公共正式卷', exam_purpose: 'practice', mode: 'random', pool_scope: 'public', category_id: null,
  rules: [{ type: 'single', count: 100, score_cents: 100 }], total_score: 100, pass_score: 70, duration_minutes: 40,
  partial_credit_ratio: .25, max_attempts: null, requires_learning: true, required_learning_minutes: 75,
  course_ids: ['31'], regulation_ids: [], remark: null, sort_order: 0,
};
const practice = { ...source, ...practiceTemplate, id: '22', status: 'draft' };
const wrappers: VueWrapper[] = [];
const requests = (method: string, path?: string) => transport.calls.filter(call => call.method === method && (!path || call.path === path));
beforeEach(() => {
  transport.calls = []; transport.permissions = reactive(new Set(['papers:read', 'papers:write', 'papers:publish']));
  transport.respond = async (method, path, payload) => {
    if (path === '/admin/papers/category-options') return { items: [{ id: '1', name: '培训类别' }], total: 1 };
    if (path === '/admin/papers/course-options') return { items: [{ id: '31', title: '安全课程' }], total: 1 };
    if (path === '/admin/papers') return method === 'post' ? { ...practice, ...payload } : { items: [source, practice], total: 2 };
    if (path.endsWith('/practice-template')) return structuredClone(practiceTemplate);
    if (path === '/admin/papers/22') return { ...structuredClone(practice), questions: [], latest_release_id: null, sum_score_cents: 10000 };
    return {};
  };
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); document.body.innerHTML = ''; });
async function page() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/admin/papers', component: Papers }, { path: '/away', component: { template: '<div />' } },
  ] });
  await router.push('/admin/papers'); await router.isReady();
  const wrapper = mount(RouterView, { attachTo: document.body, global: { plugins: [ElementPlus, router] } });
  wrappers.push(wrapper); await flushPromises();
  return { wrapper, router, state: (wrapper.getComponent(Papers).vm.$ as any).setupState };
}
function createDialog(wrapper: VueWrapper) { return wrapper.findAllComponents(ElDialog).find(item => item.props('title') === '新增试卷')!; }
function formItem(wrapper: Pick<VueWrapper, 'findAllComponents'>, label: string) {
  const field = wrapper.findAllComponents(ElFormItem).find(item => item.props('label') === label);
  expect(field, `missing field ${label}`).toBeDefined(); return field!;
}
async function action(wrapper: VueWrapper, id: string, label: string) {
  const button = wrapper.get(`[data-paper-id="${id}"]`).findAll('button').find(item => item.text() === label);
  expect(button, `missing row action ${label}`).toBeDefined(); await button!.trigger('click'); await flushPromises();
}

describe('independent practice paper configuration', () => {
  it('prefills only the explicitly selected source without creating until save, and cancellation writes nothing', async () => {
    const { wrapper, state, router } = await page();
    await action(wrapper, '21', '创建模拟卷');
    expect(requests('get', '/admin/papers/21/practice-template')).toHaveLength(1);
    expect(state.trainingCreate).toMatchObject({ title: '模拟考 · 公共正式卷', exam_purpose: 'practice', mode: 'random', category_id: null,
      max_attempts: null, pass_score: 70, duration_minutes: 40, requires_learning: true, required_learning_minutes: 75, course_ids: ['31'], partial_credit_ratio: .25 });
    expect(createDialog(wrapper).text()).toContain('不限次数');
    expect(requests('post')).toEqual([]);
    await state.closeTrainingCreate(); await flushPromises();
    expect(state.trainingCreateVisible).toBe(false); expect(requests('post')).toEqual([]);
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers');
    expect(source.rules).toEqual([{ type: 'single', count: 100, score_cents: 100 }]);
  });

  it.each([[50, 2, 200], [100, 1, 100]])('saves an independent %i question draft through the existing random rule editor', async (count, points, cents) => {
    const { wrapper, state } = await page(); await action(wrapper, '21', '创建模拟卷');
    const dialog = createDialog(wrapper);
    await dialog.get('[data-rule-type="single"] input[data-field="count"]').setValue(String(count));
    await dialog.get('[data-rule-type="single"] input[data-field="score"]').setValue(String(points));
    expect(dialog.text()).toContain(`共 ${count} 道`);
    await state.createTraining('save'); await flushPromises();
    expect(requests('post')).toHaveLength(1);
    expect(requests('post', '/admin/papers')[0]?.payload).toEqual({
      title: '模拟考 · 公共正式卷', exam_purpose: 'practice', mode: 'random', pool_scope: 'public', category_id: null,
      rules: [{ type: 'single', count, score_cents: cents }], max_attempts: null,
      total_score: 100, pass_score: 70, duration_minutes: 40, partial_credit_ratio: .25,
      requires_learning: true, required_learning_minutes: 75, course_ids: ['31'], remark: null,
    });
    expect(state.trainingCreateVisible).toBe(false);
    expect(source.rules).toEqual([{ type: 'single', count: 100, score_cents: 100 }]);
  });

  it('can create practice without a source and fixes its public random mode and unlimited attempts', async () => {
    const { wrapper, state } = await page(); state.openTrainingCreate(); await flushPromises();
    const dialog = createDialog(wrapper);
    formItem(dialog, '考试用途').getComponent(ElRadioGroup).vm.$emit('update:modelValue', 'practice'); await flushPromises();
    expect(state.trainingCreate).toMatchObject({ exam_purpose: 'practice', mode: 'random', category_id: null, max_attempts: null });
    expect(formItem(dialog, '组卷方式').text()).toContain('随机试卷');
    expect(formItem(dialog, '组卷方式').findComponent(ElRadioGroup).exists()).toBe(false);
    expect(dialog.text()).toContain('不限次数');
    await formItem(dialog, '试卷名称').get('input').setValue('独立模拟卷');
    await state.createTraining('save');
    expect(requests('post', '/admin/papers')[0]?.payload).toMatchObject({ title: '独立模拟卷', exam_purpose: 'practice', pool_scope: 'public', max_attempts: null });
    expect(transport.calls.some(call => call.path.endsWith('/practice-template'))).toBe(false);
  });

  it('offers template creation only for formal training public random drafts and publications with write access', async () => {
    const original = transport.respond;
    transport.respond = async (method, path, payload) => path === '/admin/papers' ? { items: [
      source, practice, { ...source, id: '23', mode: 'fixed' }, { ...source, id: '24', pool_scope: 'category' },
      { ...source, id: '25', status: 'archived' }, { ...source, id: '26', status: 'draft' },
    ], total: 6 } : original(method, path, payload);
    const { wrapper } = await page();
    const hasAction = (id: string) => wrapper.get(`[data-paper-id="${id}"]`).text().includes('创建模拟卷');
    expect(['21', '26'].map(hasAction)).toEqual([true, true]);
    expect(['22', '23', '24', '25'].map(hasAction)).toEqual([false, false, false, false]);
    transport.permissions.delete('papers:write'); await flushPromises(); expect(hasAction('21')).toBe(false);
    expect(requests('post')).toEqual([]);
  });

  it('lists both purposes by default and sends only the selected purpose to the paper query', async () => {
    const { wrapper, state } = await page();
    expect(requests('get', '/admin/papers')[0]?.payload.params).not.toHaveProperty('exam_purpose');
    expect(wrapper.get('.el-table__body').text()).toContain('正式考试');
    expect(wrapper.get('.el-table__body').text()).toContain('模拟考');
    formItem(wrapper, '考试用途').getComponent(ElSelect).vm.$emit('update:modelValue', 'practice'); await flushPromises();
    await state.searchTraining();
    expect(requests('get', '/admin/papers').at(-1)?.payload.params.exam_purpose).toBe('practice');
    state.resetTrainingQuery(); await flushPromises();
    expect(requests('get', '/admin/papers').at(-1)?.payload.params).not.toHaveProperty('exam_purpose');
  });

  it('ignores a template receipt after a different create dialog opens', async () => {
    let resolve!: (value: any) => void; const original = transport.respond;
    transport.respond = async (method, path, payload) => path.endsWith('/practice-template')
      ? new Promise(done => { resolve = done; }) : original(method, path, payload);
    const { wrapper, state } = await page();
    const button = wrapper.get('[data-paper-id="21"]').findAll('button').find(item => item.text() === '创建模拟卷');
    expect(button).toBeDefined(); await button!.trigger('click'); await flushPromises();
    state.openTrainingCreate(); state.trainingCreate.title = '新建中的表单';
    resolve(practiceTemplate); await flushPromises();
    expect(state.trainingCreate.title).toBe('新建中的表单'); expect(state.trainingCreate.exam_purpose).toBe('formal');
    expect(requests('post')).toEqual([]);
  });

  it('does not discard a newer form after an older template confirmation resolves', async () => {
    let resolve!: (value: any) => void;
    vi.mocked(ElMessageBox.confirm).mockImplementationOnce(() => new Promise(done => { resolve = done; }) as any);
    const { state } = await page(); state.openTrainingCreate(); state.trainingCreate.title = '旧表单未保存'; await flushPromises();
    const pending = state.createPracticePaper(source); await flushPromises();
    state.openTrainingCreate(); state.trainingCreate.title = '新表单未保存'; await flushPromises();
    resolve('confirm'); await pending; await flushPromises();
    expect(state.trainingCreate.title).toBe('新表单未保存'); expect(state.trainingCreate.exam_purpose).toBe('formal');
    expect(state.trainingCreateVisible).toBe(true);
    expect(requests('get', '/admin/papers/21/practice-template')).toEqual([]); expect(requests('post')).toEqual([]);
  });

  it('explains latest-version practice behavior when publishing or withdrawing without changing formal wording', async () => {
    const { state } = await page();
    await state.publishPaper(practice);
    expect(vi.mocked(ElMessageBox.confirm).mock.calls[0]?.[0]).toContain('所有学员的下一次新模拟使用本次发布配置');
    await state.withdrawPaper({ ...practice, status: 'published' });
    expect(vi.mocked(ElMessageBox.confirm).mock.calls[1]?.[0]).toContain('所有学员的下一次新模拟使用最新配置');
    expect(requests('post', '/admin/papers/22/publish')).toHaveLength(1);
    expect(requests('post', '/admin/papers/22/withdraw')).toHaveLength(1);
  });
});
