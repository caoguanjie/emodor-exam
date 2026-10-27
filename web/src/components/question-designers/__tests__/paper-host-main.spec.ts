import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElMessageBox, ElOption, ElSelect } from 'element-plus';
import { defineComponent, h, KeepAlive } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import PaperDetail from '../../../views/admin/PaperDetail.vue';
import Papers from '../../../views/admin/Papers.vue';
import PaperDesigner from '../PaperDesigner.vue';
import QuestionDocumentEditor from '../QuestionDocumentEditor.vue';
import QuestionProperties from '../QuestionProperties.vue';
import PaperLibrarySidebar from '../PaperLibrarySidebar.vue';
import { confirmUnsavedRoutes } from '../../../composables/useUnsavedChanges';
import type { AuthoringBundle } from '../../../api/question-document-types';
import { paperFixture, copy } from './paper-designer-fixtures';
import { tabCacheKey } from '../../../stores/tab-cache';

const transport = vi.hoisted(() => ({ calls: [] as Array<{ method: string; path: string; body?: any; config?: any }>, permissions: new Set<string>(), respond: async (_method: string, _path: string, _body?: any, _config?: any): Promise<any> => ({}) }));
vi.mock('../../../api/http', () => ({ default: Object.fromEntries(['get', 'post', 'put', 'delete'].map((method) => [method, async (path: string, body?: any, config?: any) => {
  const request = { method, path, ...(method === 'get' ? { config: body } : { body, config }) };
  transport.calls.push(copy(request)); return transport.respond(method, path, method === 'get' ? undefined : body, method === 'get' ? body : config);
}])) }));
vi.mock('../../../stores/auth', () => ({ useAuthStore: () => ({ can: (permission: string) => transport.permissions.has(permission) }) }));
const wrappers: VueWrapper[] = [];
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeAll(() => {
  if (!rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  if (!rangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
});
afterAll(() => { if (!rangeRects) Reflect.deleteProperty(Range.prototype, 'getClientRects'); if (!rangeBounds) Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect'); });
const base = paperFixture();
function detail(overrides = {}) { return { ...base.paper, business_scope: 'training', status: 'draft', total_score: 100, latest_release_id: null, sum_score_cents: 10000, rules: [], designer_layout: null,
  questions: [{ question_id: '40', question_version_id: '50', sort: 0, score_cents: 10000, type: 'single', difficulty: 'easy', concept_id: '20', regulation_id: null, stem: '题干', options: [], enabled: true }], ...overrides }; }
function bundle(): AuthoringBundle { const document = copy(base.document); document.questions.question_one!.question_id = '40'; document.questions.question_one!.base_revision = 1;
  return { document, option_ids: { question_one: { question_one_a: 'A', question_one_b: 'B' } }, identities: { question_one: { question_id: '40', expected_version_id: '50', expected_enabled: true } }, layouts: {} }; }
beforeEach(() => {
  transport.calls = []; transport.permissions = new Set(['papers:read', 'papers:write', 'questions:read', 'questions:write']);
  transport.respond = async (method, path, body) => {
    if (path === '/admin/questions/authoring-options') return { difficulties: [{ code: 'easy', label: '简单', enabled: true, sort: 1 }, { code: 'medium', label: '中级', enabled: false, sort: 2 }, { code: 'hard', label: '困难', enabled: true, sort: 3 }] };
    if (path === '/admin/papers/category-options') return { items: [{ id: '10', name: '安全培训' }], total: 1, page: 1, page_size: 100 };
    if (path.endsWith('-options')) return { items: [], total: 0, page: 1, page_size: 100 };
    if (path === '/admin/papers') return method === 'post' ? detail({ id: '101', mode: body.mode }) : { items: [detail()], total: 1, page: 1, page_size: 20 };
    if (path === '/admin/question-documents/assemble') return bundle();
    if (path === '/ai/papers') return { list: [], total: 0 };
    if (path === '/ai/questions') return { list: [], total: 0 };
    if (path.endsWith('/candidates')) return { items: [], total: 0, page: 1, page_size: 50 };
    if (path.startsWith('/admin/papers/')) return detail();
    throw new Error(`Unexpected ${method} ${path}`);
  };
});
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); document.body.innerHTML = ''; });
async function show(component: typeof PaperDetail | typeof Papers, url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/papers', component: Papers }, { path: '/admin/papers/:id', component: PaperDetail }] });
  await router.push(url); await router.isReady();
  // Mirror MainLayout: list filters share one cache; designer details keep their full URL.
  const wrapper = mount(defineComponent({ setup: () => () => h(RouterView, null, {
    default: ({ Component, route }: any) => h(KeepAlive, { max: 20 }, () => Component ? h(Component, { key: tabCacheKey(route.fullPath, {}) }) : null),
  }) }), { attachTo: document.body, global: { plugins: [ElementPlus, router] } }); wrappers.push(wrapper); await flushPromises();
  return { wrapper, router, state: (wrapper.getComponent(component).vm.$ as any).setupState as any };
}

describe('main fixed paper entry', () => {
  it('opens a dashboard create once and protects the consumed URL when leaving or refreshing is cancelled', async () => {
    const { wrapper, state, router } = await show(Papers, '/admin/papers?entry=dashboard&create=1');
    expect(state.trainingCreateVisible).toBe(true);
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers');
    state.trainingCreate.title = '继续编辑的草稿';
    await flushPromises();
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel');
    try {
      expect(await confirmUnsavedRoutes(['/admin/papers'])).toBe(false);
      await router.push('/admin/papers?entry=dashboard&status=all');
      await flushPromises();
      expect(router.currentRoute.value.fullPath).toBe('/admin/papers');
      expect((wrapper.getComponent(Papers).vm.$ as any).setupState.trainingCreate.title).toBe('继续编辑的草稿');
      expect(state.trainingCreateVisible).toBe(true);
      expect(transport.calls.filter(call => call.method === 'post')).toEqual([]);
    } finally { confirm.mockRestore(); }
  });

  it('creates a 120 point draft and rejects a pass score above its target', async () => {
    const { state } = await show(Papers, '/admin/papers');
    state.openTrainingCreate(); state.trainingCreate.title = '120分试卷';
    expect(state.trainingCreate.total_score).toBe(100);
    state.trainingCreate.total_score = 120; state.trainingCreate.pass_score = 121;
    await state.createTraining('save'); await flushPromises();
    expect(transport.calls.some(call => call.method === 'post' && call.path === '/admin/papers')).toBe(false);
    state.trainingCreate.pass_score = 72;
    await state.createTraining('save'); await flushPromises();
    expect(transport.calls.find(call => call.method === 'post' && call.path === '/admin/papers')?.body).toMatchObject({ total_score: 120, pass_score: 72 });
  });

  it('queries and resets the training list explicitly with all supported status filters', async () => {
    const { wrapper, state } = await show(Papers, '/admin/papers');
    const listReads = () => transport.calls.filter((call) => call.method === 'get' && call.path === '/admin/papers');
    const selects = wrapper.findAllComponents(ElSelect);
    const category = selects.find((select) => select.props('placeholder') === '培训类别')!;
    const status = selects.find((select) => select.props('placeholder') === '状态')!;
    expect(status.findAllComponents(ElOption).map((option) => ({ value: option.props('value'), label: option.props('label') }))).toEqual([
      { value: 'draft', label: '草稿' },
      { value: 'published', label: '已发布' },
      { value: 'withdrawn', label: '已撤回' },
      { value: 'archived', label: '已归档' },
    ]);

    const initialReads = listReads().length;
    category.vm.$emit('update:modelValue', '10'); category.vm.$emit('change', '10');
    status.vm.$emit('update:modelValue', 'published'); status.vm.$emit('change', 'published');
    await flushPromises();
    expect(listReads()).toHaveLength(initialReads);

    state.trainingQuery.page = 4;
    await wrapper.get('input[placeholder="试卷标题"]').setValue('安全培训');
    await wrapper.findAll('button').find((button) => button.text() === '查询')!.trigger('click');
    await flushPromises();
    expect(listReads().at(-1)?.config?.params).toEqual({ page: 1, page_size: 20, keyword: '安全培训', category_id: '10', status: 'published' });

    state.trainingQuery.page = 3;
    await wrapper.findAll('button').find((button) => button.text() === '重置')!.trigger('click');
    await flushPromises();
    expect(state.trainingQuery).toMatchObject({ page: 1, page_size: 20, keyword: '', category_id: '', status: '' });
    expect(listReads().at(-1)?.config?.params).toEqual({ page: 1, page_size: 20 });

    state.trainingQuery.page = 5;
    await wrapper.get('input[placeholder="试卷标题"]').setValue('回车查询');
    const beforeEnter = listReads().length;
    await wrapper.get('input[placeholder="试卷标题"]').trigger('keyup.enter');
    await flushPromises();
    expect(listReads()).toHaveLength(beforeEnter + 1);
    expect(listReads().at(-1)?.config?.params).toEqual({ page: 1, page_size: 20, keyword: '回车查询' });
  });
  it('renders one training-paper list without a legacy tab, state, or request', async () => {
    const { wrapper, state } = await show(Papers, '/admin/papers');
    expect(wrapper.text()).not.toContain('培训考试');
    expect(wrapper.text()).not.toContain('历史固定卷');
    expect(wrapper.findAllComponents({ name: 'ElTabs' })).toHaveLength(0);
    expect(transport.calls.some((call) => call.path.startsWith('/ai/papers'))).toBe(false);
    expect(state.activeScope).toBeUndefined();
    expect(state.legacyQuery).toBeUndefined();
    expect(state.loadLegacy).toBeUndefined();
  });
  it('shows a disabled draft question and prevents saving it through the designer', async () => {
    const fallback = transport.respond;
    transport.respond = async (method, path, body, config) => path === '/admin/papers/100'
      ? detail({ questions: [{ ...detail().questions[0], enabled: false }] }) : fallback(method, path, body, config);
    const { wrapper } = await show(PaperDetail, '/admin/papers/100?scope=training&designer=1');
    const designer = wrapper.getComponent(PaperDesigner);
    expect(designer.text()).toContain('题单包含已停用题目');
    await designer.vm.save(); await flushPromises();
    expect(transport.calls.filter((call) => call.method === 'put')).toHaveLength(0);
  });
  it('saves a draft on the list without opening the designer and prevents a second save action while pending', async () => {
    const fallback = transport.respond;
    let complete!: (value: any) => void;
    let created: ReturnType<typeof detail> | null = null;
    transport.respond = async (method, path, body, config) => {
      if (method === 'post' && path === '/admin/papers') return new Promise((resolve) => { complete = resolve; });
      if (method === 'get' && path === '/admin/papers' && created) return { items: [created], total: 1, page: 1, page_size: 20 };
      return fallback(method, path, body, config);
    };
    const { wrapper, state, router } = await show(Papers, '/admin/papers');
    state.openTrainingCreate(); state.trainingCreate.title = '只保存的草稿'; await flushPromises();
    const save = wrapper.findAll('button').find((button) => button.text() === '保存草稿')!;
    const design = wrapper.findAll('button').find((button) => button.text() === '保存并组卷')!;
    expect(save).toBeDefined(); expect(design).toBeDefined();
    await save.trigger('click');
    expect((save.element as HTMLButtonElement).disabled).toBe(true);
    expect((design.element as HTMLButtonElement).disabled).toBe(true);
    await design.trigger('click');
    created = detail({ id: '101', title: '只保存的草稿' }); complete(created); await flushPromises();
    expect(transport.calls.filter((call) => call.method === 'post' && call.path === '/admin/papers')).toHaveLength(1);
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers');
    expect(state.trainingCreateVisible).toBe(false);
    expect(wrapper.text()).toContain('只保存的草稿');
  });
  it('creates a fixed draft once and automatically opens its designer query', async () => {
    const { state, router } = await show(Papers, '/admin/papers');
    state.openTrainingCreate(); state.trainingCreate.title = '新固定卷';
    await Promise.all([state.createTraining(), state.createTraining()]); await flushPromises();
    const creates = transport.calls.filter((call) => call.method === 'post' && call.path === '/admin/papers');
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toMatchObject({ title: '新固定卷', mode: 'fixed' });
    expect(creates[0].body).not.toHaveProperty('rules');
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers/101?scope=training&designer=1');
  });
  it('forces fixed creation without rules even if internal create state is tampered with', async () => {
    const { state, router } = await show(Papers, '/admin/papers');
    state.openTrainingCreate();
    state.trainingCreate.title = '被篡改的创建草稿';
    state.trainingCreate.mode = 'random';
    state.trainingCreate.rules = [{ type: 'single', count: 1, score_cents: 10000 }];
    await state.createTraining(); await flushPromises();
    const request = transport.calls.find((call) => call.method === 'post' && call.path === '/admin/papers')!;
    expect(request.body).toMatchObject({ title: '被篡改的创建草稿', mode: 'fixed' });
    expect(request.body).not.toHaveProperty('rules');
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers/101?scope=training&designer=1');
  });
  it('removes mode and rule entry controls from the paper list and create dialog', async () => {
    const { wrapper, state } = await show(Papers, '/admin/papers');
    const visibleLabels = () => wrapper.findAll('.el-form-item__label').map((label) => label.text().trim());
    const tableHeaders = () => wrapper.findAll('.el-table__header-wrapper .cell').map((cell) => cell.text().trim());
    expect(visibleLabels()).not.toContain('组卷模式');
    expect(tableHeaders()).not.toContain('模式');
    expect(tableHeaders()).not.toContain('规则');
    state.openTrainingCreate(); await flushPromises();
    expect(visibleLabels()).not.toContain('组卷模式');
    expect(visibleLabels()).not.toContain('随机规则');
  });
  it('opens the designer directly and returns to the list after a successful save', async () => {
    const { wrapper, router } = await show(PaperDetail, '/admin/papers/100?scope=training&designer=1');
    expect(wrapper.findAll('.paper-designer__canvas .ProseMirror')).toHaveLength(1);
    expect(wrapper.findAllComponents(QuestionDocumentEditor)).toHaveLength(1);
    const designer = wrapper.getComponent(PaperDesigner);
    expect(designer.props('difficultyOptions')).toEqual([{ value: 'easy', label: '简单' }, { value: 'hard', label: '困难' }]);
    await designer.get('input[aria-label="顶部试卷标题"]').setValue('重命名');
    await designer.vm.save(); await flushPromises();
    expect(transport.calls.filter((call) => call.path === '/admin/question-documents/commit')).toHaveLength(0);
    expect(transport.calls.filter((call) => call.method === 'put').map((call) => call.path)).toEqual(['/admin/papers/100', '/admin/papers/100/questions']);
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers');
    expect(wrapper.findComponent(PaperDesigner).exists()).toBe(false);
  });
  it('does not open a writer for random, published, or missing question-read access', async () => {
    for (const override of [{ mode: 'random' }, { status: 'published' }, {}]) {
      const fallback = transport.respond; transport.respond = async (method, path, body, config) => path === '/admin/papers/100' ? detail(override) : fallback(method, path, body, config);
      if (!Object.keys(override).length) transport.permissions.delete('questions:read');
      const { wrapper } = await show(PaperDetail, '/admin/papers/100?scope=training&designer=1');
      expect(wrapper.findComponent(PaperDesigner).exists()).toBe(false); wrapper.unmount(); wrappers.pop(); transport.respond = fallback;
    }
  });
  it('blocks authoring when the authoritative difficulty catalog fails and permits retry', async () => {
    const fallback = transport.respond; let failed = true;
    transport.respond = async (method, path, body, config) => { if (path === '/admin/questions/authoring-options' && failed) throw new Error('目录离线'); return fallback(method, path, body, config); };
    const { wrapper } = await show(PaperDetail, '/admin/papers/100?scope=training&designer=1');
    expect(wrapper.findComponent(PaperDesigner).exists()).toBe(false); expect(wrapper.text()).toContain('目录离线');
    failed = false; const retry = wrapper.findAll('button').find((button) => button.text().includes('重试设计器'))!;
    await retry.trigger('click'); await flushPromises(); expect(wrapper.findAll('.paper-designer__canvas .ProseMirror')).toHaveLength(1);
  });
  it('protects the real route and tab-close guard while a commit receipt is unknown, with only a native browser unload prompt', async () => {
    const fallback = transport.respond;
    transport.respond = async (method, path, body, config) => { if (path === '/admin/question-documents/commit') throw new Error('提交响应丢失'); if (path.includes('/commits/')) throw new Error('离线'); return fallback(method, path, body, config); };
    const { wrapper, router } = await show(PaperDetail, '/admin/papers/100?scope=training&designer=1');
    const designer = wrapper.getComponent(PaperDesigner); designer.getComponent(QuestionProperties).vm.$emit('change', { difficulty: 'hard' }); await flushPromises();
    expect(await designer.vm.save()).toBe(false); await flushPromises();
    expect(await confirmUnsavedRoutes([router.currentRoute.value.fullPath])).toBe(false);
    await router.push('/admin/papers'); expect(router.currentRoute.value.path).toBe('/admin/papers/100');
    await designer.vm.requestClose(); await flushPromises(); expect(wrapper.findComponent(PaperDesigner).exists()).toBe(true);
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    expect(transport.calls.filter((call) => call.path === '/admin/question-documents/commit')).toHaveLength(1);
  });
  it.each([false, true])('loads replacement category courses only for requires_learning=%s while retaining its settings and current draft ID', async (requiresLearning) => {
    const { wrapper } = await show(PaperDetail, '/admin/papers/100?scope=training&designer=1');
    const designer = wrapper.getComponent(PaperDesigner); const source = paperFixture('200', '11', 'replacement');
    Object.assign(source.paper, { regulation_ids: ['31'], course_ids: requiresLearning ? ['41'] : [], requires_learning: requiresLearning,
      required_learning_minutes: requiresLearning ? 15 : null, remark: '来源备注' });
    designer.getComponent(PaperLibrarySidebar).vm.$emit('use-paper', source); await flushPromises();
    const replace = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.trim() === '整卷替换')!; replace.click(); await flushPromises();
    expect(transport.calls.some((call) => call.path === '/admin/papers/course-options' && call.config?.params.category_id === '11')).toBe(requiresLearning);
    expect(transport.calls.some((call) => call.path === '/admin/papers/regulation-options')).toBe(false);
    expect(designer.props('modelValue').paper).toMatchObject({ ...source.paper, id: '100' });
  });
  it('reopens a cached designer route using the latest server value after closing to the list', async () => {
    const fallback = transport.respond; let persisted = detail();
    transport.respond = async (method, path, body, config) => {
      if (path === '/admin/papers/100') { if (method === 'put') persisted = { ...persisted, ...copy(body) }; return copy(persisted); }
      return fallback(method, path, body, config);
    };
    const { wrapper, router } = await show(PaperDetail, '/admin/papers/100?scope=training');
    const designer = wrapper.getComponent(PaperDesigner);
    await designer.get('input[aria-label="顶部试卷标题"]').setValue('保存后的标题');
    expect(await designer.vm.save()).toBe(true); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers');
    expect(wrapper.findComponent(PaperDesigner).exists()).toBe(false);
    persisted.title = '服务端更新后的标题';
    await router.push('/admin/papers/100?scope=training'); await flushPromises();
    const reopened = wrapper.getComponent(PaperDesigner);
    expect((reopened.get('input[aria-label="顶部试卷标题"]').element as HTMLInputElement).value).toBe('服务端更新后的标题');
    expect(transport.calls.filter(call=>call.path==='/admin/question-documents/assemble')).toHaveLength(2);
    await reopened.vm.requestClose(); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/admin/papers');
    expect(wrapper.findComponent(PaperDesigner).exists()).toBe(false);
  });
});
