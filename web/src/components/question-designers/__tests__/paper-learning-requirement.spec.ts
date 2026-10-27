import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElDialog, ElFormItem, ElInput, ElInputNumber, ElMessage, ElMessageBox, ElSelect, ElSwitch } from 'element-plus';
import { defineComponent, h, KeepAlive, ref } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import Papers from '../../../views/admin/Papers.vue';
import PaperDetail from '../../../views/admin/PaperDetail.vue';
import PaperProperties from '../PaperProperties.vue';
import { createPaperDesignerHost } from '../../../composables/paper-designer-host';
import { copy, deferred, paperFixture } from './paper-designer-fixtures';

const transport = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; path: string; body?: any; config?: any }>,
  respond: async (_method: string, _path: string, _body?: any, _config?: any): Promise<any> => ({}),
}));
vi.mock('../../../api/http', () => ({ default: Object.fromEntries(['get', 'post', 'put'].map((method) => [method, async (path: string, input?: any) => {
  transport.calls.push(copy({ method, path, ...(method === 'get' ? { config: input } : { body: input }) }));
  return transport.respond(method, path, method === 'get' ? undefined : input, method === 'get' ? input : undefined);
}])) }));
vi.mock('../../../stores/auth', () => ({ useAuthStore: () => ({ can: (permission: string) => ['papers:read', 'papers:write'].includes(permission) }) }));

const wrappers: VueWrapper[] = [];
let saved: any;
function detail(overrides = {}) {
  return { ...paperFixture().paper, business_scope: 'training', mode: 'fixed', status: 'draft', total_score: 100,
    required_learning_minutes: null, remark: null, questions: [], rules: [], latest_release_id: null, sum_score_cents: 0, ...overrides };
}
const courses = [{ id: '71', title: '安全课程' }, { id: '72', title: '应急课程' }];
beforeEach(() => {
  transport.calls = []; saved = detail();
  transport.respond = async (method, path, body, config) => {
    if (path === '/admin/papers/category-options') return { items: [{ id: '10', name: '安全培训' }, { id: '20', name: '应急培训' }], total: 2, page: 1, page_size: 100 };
    if (path === '/admin/papers/course-options') return { items: config.params.category_id === '10' ? courses : [{ id: '81', title: '新类别课程' }], total: 2, page: 1, page_size: 100 };
    if (path === '/admin/papers/regulation-options') return { items: [], total: 0, page: 1, page_size: 100 };
    if (path === '/admin/papers') return method === 'post' ? detail({ ...body, id: '101' }) : { items: [saved], total: 1, page: 1, page_size: 20 };
    if (path === '/admin/papers/100') { if (method === 'put') saved = { ...saved, ...copy(body) }; return copy(saved); }
    throw new Error(`Unexpected ${method} ${path}`);
  };
  vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close() {} }) as any);
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
});
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); vi.restoreAllMocks(); });

async function show(component: typeof Papers | typeof PaperDetail) {
  const path = component === Papers ? '/admin/papers' : '/admin/papers/100';
  const empty = defineComponent({ render: () => h('div') });
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/admin/papers', component: component === Papers ? Papers : empty },
    { path: '/admin/papers/:id', component: component === PaperDetail ? PaperDetail : empty },
  ] });
  await router.push(path); await router.isReady();
  const wrapper = mount(defineComponent({ setup: () => () => h(RouterView, null, {
    default: ({ Component, route }: any) => h(KeepAlive, null, () => Component ? h(Component, { key: route.fullPath }) : null),
  }) }), { attachTo: document.body, global: { plugins: [ElementPlus, router] } });
  wrappers.push(wrapper); await flushPromises();
  return { wrapper, router, state: (wrapper.getComponent(component).vm.$ as any).setupState as any };
}
type FormRoot = Pick<VueWrapper, 'findAllComponents'>;
function formItem(wrapper: FormRoot, label: string) { return wrapper.findAllComponents(ElFormItem).find((item) => item.props('label') === label)!; }
const requests = (method: string, path: string) => transport.calls.filter((call) => call.method === method && call.path === path);
async function openCreate() { const view = await show(Papers); view.state.openTrainingCreate(); await flushPromises(); return view; }
async function setSwitch(wrapper: FormRoot, value: boolean) {
  formItem(wrapper, '考前学习要求').getComponent(ElSwitch).vm.$emit('update:modelValue', value); await flushPromises();
}

describe('paper pre-exam learning configuration', () => {
  it('opens the public creation dialog with clear fields and leaves learning inputs hidden until enabled', async () => {
    const { wrapper, state } = await show(Papers);
    expect(wrapper.findAll('button').some((button) => button.text() === '新增试卷')).toBe(true);
    await wrapper.findAll('button').find((button) => button.text() === '新增试卷')!.trigger('click'); await flushPromises();
    const dialog = wrapper.findAllComponents(ElDialog).find((item) => item.props('title') === '新增试卷')!;
    expect(document.querySelector('.el-dialog.re-form-dialog')).not.toBeNull();
    const labels = () => dialog.findAllComponents(ElFormItem).map((item) => item.props('label'));
    expect(labels()).toEqual(['试卷名称', '考试时间', '培训类别', '试卷总分', '及格分数', '考前学习要求', '备注']);
    const duration = formItem(dialog, '考试时间').getComponent(ElInput);
    const score = formItem(dialog, '及格分数').getComponent(ElInput);
    expect(duration.get('.el-input-group__append').text()).toBe('分钟');
    expect(score.get('.el-input-group__append').text()).toBe('分');
    await duration.get('input').setValue('45');
    await score.get('input').setValue('75.5');
    expect(state.trainingCreate.duration_minutes).toBe(45);
    expect(state.trainingCreate.pass_score).toBe(75.5);
    expect(requests('get', '/admin/papers/course-options')).toHaveLength(0);
    expect(requests('get', '/admin/papers/regulation-options')).toHaveLength(0);
    await setSwitch(dialog, true);
    expect(formItem(dialog, '关联课程').props('required')).toBe(true);
    const learningMinutes = formItem(dialog, '累计学习时长');
    expect(learningMinutes.props('required')).toBe(true);
    expect(learningMinutes.get('.el-input-group__append').text()).toBe('分钟');
    await learningMinutes.get('input').setValue('45');
    expect(state.trainingCreate.required_learning_minutes).toBe(45);
    expect(formItem(dialog, '关联课程').getComponent(ElSelect).props('multiple')).toBe(true);
    expect(requests('get', '/admin/papers/course-options')).toHaveLength(1);
    expect(formItem(dialog, '备注').getComponent(ElInput).props()).toMatchObject({ type: 'textarea', maxlength: 1000 });
    expect(dialog.findAll('.el-dialog__footer button').map((button) => button.text())).toEqual(['取消', '保存草稿', '保存并组卷']);
    expect(wrapper.findAll('.el-table__header-wrapper .cell').map((item) => item.text())).not.toContain('考前学习要求');
  });

  it('clears stale learning values from the disabled create payload and still opens the fixed designer', async () => {
    const { state, router } = await openCreate();
    Object.assign(state.trainingCreate, { title: '无门槛试卷', course_ids: ['71'], required_learning_minutes: 20, remark: '   ' });
    await state.createTraining(); await flushPromises();
    expect(requests('post', '/admin/papers')[0]?.body).toMatchObject({ title: '无门槛试卷', mode: 'fixed', requires_learning: false, course_ids: [], required_learning_minutes: null, remark: null });
    const payload = requests('post', '/admin/papers')[0]?.body;
    expect(payload).not.toHaveProperty('regulation_ids');
    expect(payload.max_attempts ?? 3).toBe(3); expect(payload.partial_credit_ratio ?? 0.5).toBe(0.5);
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers/101?scope=training&designer=1');
  });

  it.each([
    { course_ids: [], required_learning_minutes: 15 },
    { course_ids: ['71'], required_learning_minutes: null },
    { course_ids: ['71'], required_learning_minutes: 0 },
    { course_ids: ['71'], required_learning_minutes: 1.5 },
    { course_ids: ['71'], required_learning_minutes: 2147483648 },
  ])('rejects an enabled creation with invalid learning requirements %j', async (requirements) => {
    const { state } = await openCreate();
    Object.assign(state.trainingCreate, { title: '需要学习', requires_learning: true, ...requirements });
    await state.createTraining();
    expect(requests('post', '/admin/papers')).toHaveLength(0);
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it.each([
    ['考试时间', ''], ['考试时间', '1.5'], ['考试时间', '1441'],
    ['及格分数', ''], ['及格分数', '101'],
    ['累计学习时长', ''], ['累计学习时长', '1.5'], ['累计学习时长', '2147483648'],
  ])('rejects invalid ordinary number input %s=%s through the create form', async (label, value) => {
    const { wrapper } = await openCreate();
    const dialog = wrapper.findAllComponents(ElDialog).find(item => item.props('title') === '新增试卷')!;
    await formItem(dialog, '试卷名称').get('input').setValue('数字输入校验');
    await setSwitch(dialog, true);
    formItem(dialog, '关联课程').getComponent(ElSelect).vm.$emit('update:modelValue', ['71']);
    await formItem(dialog, '累计学习时长').get('input').setValue('15');
    await formItem(dialog, label).get('input').setValue(value);
    await dialog.findAll('button').find((item) => item.text() === '保存并组卷')!.trigger('click'); await flushPromises();
    expect(requests('post', '/admin/papers')).toHaveLength(0);
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it('submits both course choices, the maximum integer minutes and a trimmed remark', async () => {
    const { state } = await openCreate();
    Object.assign(state.trainingCreate, { title: '需要学习', requires_learning: true, course_ids: ['71', '72'], required_learning_minutes: 2147483647, remark: '  管理备注  ' });
    await state.createTraining();
    expect(requests('post', '/admin/papers')[0]?.body).toMatchObject({ requires_learning: true, course_ids: ['71', '72'], required_learning_minutes: 2147483647, remark: '管理备注' });
  });

  it('rejects an overlong remark before creating or saving', async () => {
    const create = await openCreate(); Object.assign(create.state.trainingCreate, { title: '超长备注', remark: '字'.repeat(1001) });
    await create.state.createTraining(); expect(requests('post', '/admin/papers')).toHaveLength(0);
  });

  it('keeps only the latest category courses and ignores a course response after disabling and reopening', async () => {
    const first = deferred<any>(); const second = deferred<any>(); const fallback = transport.respond;
    transport.respond = (method, path, body, config) => path === '/admin/papers/course-options'
      ? (config.params.category_id === '10' ? first.promise : second.promise) : fallback(method, path, body, config);
    const { wrapper, state } = await openCreate();
    expect(requests('get', '/admin/papers/course-options')).toHaveLength(0);
    await setSwitch(wrapper, true);
    state.trainingCreate.course_ids = ['71'];
    const category = formItem(wrapper.findAllComponents(ElDialog).find(item => item.props('title') === '新增试卷')!, '培训类别').getComponent(ElSelect);
    category.vm.$emit('update:modelValue', '20'); category.vm.$emit('change', '20'); await flushPromises();
    expect(state.trainingCreate.course_ids).toEqual([]);
    second.resolve({ items: [{ id: '81', title: '新课程' }] }); await flushPromises();
    first.resolve({ items: [{ id: '71', title: '迟到旧课程' }] }); await flushPromises();
    expect(state.createCourses).toEqual([{ id: '81', title: '新课程' }]);
    await setSwitch(wrapper, false);
    expect(formItem(wrapper, '关联课程')).toBeUndefined();
    const late = deferred<any>();
    transport.respond = (method, path, body, config) => path === '/admin/papers/course-options' ? late.promise : fallback(method, path, body, config);
    await setSwitch(wrapper, true);
    await state.closeTrainingCreate(); state.openTrainingCreate(); await flushPromises();
    late.resolve({ items: [{ id: '81', title: '旧弹窗迟到课程' }] }); await flushPromises();
    expect(state.trainingCreate.requires_learning).toBe(false);
    expect(state.createCourses).toEqual([]);
  });

  it('preserves an unsaved remark when cancellation is rejected', async () => {
    const { state } = await openCreate(); state.trainingCreate.remark = '尚未保存'; await flushPromises();
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel');
    await state.closeTrainingCreate();
    expect(state.trainingCreateVisible).toBe(true); expect(state.trainingCreate.remark).toBe('尚未保存');
  });

  it('uses the same conditional fields in designer properties and clears course selection on category change', async () => {
    const value = ref<any>({ ...paperFixture().paper, required_learning_minutes: null, remark: null });
    const wrapper = mount(defineComponent({ setup: () => () => h(PaperProperties, { modelValue: value.value,
      categories: [{ id: '10', name: '安全' }, { id: '20', name: '应急' }], courses,
      onChange: (patch) => { value.value = { ...value.value, ...patch }; },
    }) }), { global: { plugins: [ElementPlus] } }); wrappers.push(wrapper);
    expect(formItem(wrapper, '关联资料')).toBeUndefined();
    expect(formItem(wrapper, '关联课程').getComponent(ElSelect).props('disabled')).toBe(true);
    await setSwitch(wrapper, true);
    expect(formItem(wrapper, '关联课程').props('required')).toBe(true);
    formItem(wrapper, '关联课程').getComponent(ElSelect).vm.$emit('update:modelValue', ['71']);
    formItem(wrapper, '累计学习时长').getComponent(ElInput).vm.$emit('update:modelValue', '25');
    formItem(wrapper, '备注').getComponent(ElInput).vm.$emit('update:modelValue', '设计器备注'); await flushPromises();
    expect(value.value).toMatchObject({ requires_learning: true, course_ids: ['71'], required_learning_minutes: 25, remark: '设计器备注' });
    formItem(wrapper, '培训类别').getComponent(ElSelect).vm.$emit('update:modelValue', '20'); await flushPromises();
    expect(value.value.course_ids).toEqual([]);
    await setSwitch(wrapper, false);
    expect(value.value).toMatchObject({ course_ids: [], required_learning_minutes: null });
  });

  it('validates designer settings before writes and saves both new fields', async () => {
    const writes: any[] = [];
    const host = createPaperDesignerHost({ paperId: '100', access: { read: true, write: true, questionsRead: true, questionsWrite: true }, api: {
      get: async () => detail({ requires_learning: true, course_ids: ['71'], required_learning_minutes: 25, remark: '载入备注' }),
      post: async () => { throw new Error('unchanged questions must not be committed'); },
      put: async (path, body) => { writes.push({ path, body: copy(body) }); return {}; },
    } });
    expect((await host.load()).paper).toMatchObject({ required_learning_minutes: 25, remark: '载入备注' });
    const value = paperFixture(); Object.assign(value.paper, { requires_learning: true, course_ids: ['71'], required_learning_minutes: 0, remark: '备注' });
    await expect(host.saveDraft(value, { request_id: 'invalid' })).rejects.toThrow('累计学习时长'); expect(writes).toHaveLength(0);
    Object.assign(value.paper, { required_learning_minutes: 25, remark: '  设计器备注  ' });
    await host.saveDraft(value, { request_id: 'valid' });
    expect(writes[0]).toMatchObject({ path: '/admin/papers/100', body: { requires_learning: true, course_ids: ['71'], required_learning_minutes: 25, remark: '设计器备注' } });
    host.dispose();
  });
});
