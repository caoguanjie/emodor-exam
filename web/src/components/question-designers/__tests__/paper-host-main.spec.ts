import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElOption, ElSelect } from 'element-plus';
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
  // MainLayout caches each full URL separately, including the designer query.
  const wrapper = mount(defineComponent({ setup: () => () => h(RouterView, null, {
    default: ({ Component, route }: any) => h(KeepAlive, { max: 20 }, () => Component ? h(Component, { key: route.fullPath }) : null),
  }) }), { attachTo: document.body, global: { plugins: [ElementPlus, router] } }); wrappers.push(wrapper); await flushPromises();
  return { wrapper, router, state: (wrapper.getComponent(component).vm.$ as any).setupState as any };
}

describe('main fixed paper entry', () => {
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
  it.each([undefined, 7300])('assigns a paper score on insertion, ignoring candidate score %s', async (oldScore) => {
    const candidate = { question_id: '41', question_version_id: '51', type: 'single', difficulty: 'easy',
      concept_id: null, regulation_id: null, stem: '新候选', options: [], ...(oldScore === undefined ? {} : { score_cents: oldScore }) };
    const fallback = transport.respond;
    transport.respond = async (method, path, body, config) => path.endsWith('/candidates')
      ? { items: [candidate], total: 1, page: 1, page_size: 50 } : fallback(method, path, body, config);
    const { wrapper, state } = await show(PaperDetail, '/admin/papers/100?scope=training');
    await state.openCandidatePicker(); await flushPromises();
    const table = wrapper.findAllComponents({ name: 'ElTable' }).find((table) => table.props('data')?.[0]?.question_version_id === '51')!;
    expect(table.text()).not.toMatch(/建议分|默认分/);
    table.vm.$emit('selection-change', [candidate]); await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === '加入题单')!.trigger('click');
    expect(state.fixedQuestions.map((item: any) => item.score_cents)).toEqual([10000, 500]);
    expect(candidate).toEqual(expect.objectContaining({ question_id: '41' }));
  });
  it('creates a fixed draft once and automatically opens its designer query', async () => {
    const { state, router } = await show(Papers, '/admin/papers');
    state.openTrainingCreate(); state.trainingCreate.title = '新固定卷';
    await Promise.all([state.createTraining(), state.createTraining()]); await flushPromises();
    expect(transport.calls.filter((call) => call.method === 'post' && call.path === '/admin/papers')).toHaveLength(1);
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers/101?scope=training&designer=1');
  });
  it('keeps random creation on the existing configuration page', async () => {
    const { state, router } = await show(Papers, '/admin/papers'); state.openTrainingCreate(); state.trainingCreate.title = '随机卷'; state.trainingCreate.mode = 'random';
    await state.createTraining(); await flushPromises(); expect(router.currentRoute.value.fullPath).toBe('/admin/papers/101?scope=training');
  });
  it('uses only enabled catalog difficulties in the existing fixed candidate picker', async () => {
    const fallback = transport.respond;
    transport.respond = async (method, path, body, config) => path.endsWith('/candidates') ? { items: [], total: 0, page: 1, page_size: 50 } : fallback(method, path, body, config);
    const { wrapper, state } = await show(PaperDetail, '/admin/papers/100?scope=training');
    await state.openCandidatePicker(); await flushPromises();
    const difficulty = wrapper.findAllComponents(ElSelect).find((select) => select.props('placeholder') === '难度')!;
    expect(difficulty.findAllComponents(ElOption).map((option) => ({ value: option.props('value'), label: option.props('label') }))).toEqual([{ value: 'easy', label: '简单' }, { value: 'hard', label: '困难' }]);
    expect(transport.calls.filter((call) => call.path === '/admin/questions/authoring-options')).toHaveLength(1);
  });
  it('does not fetch candidates until the authoritative difficulty catalog can be loaded', async () => {
    const fallback = transport.respond; let failed = true;
    transport.respond = async (method, path, body, config) => { if (path === '/admin/questions/authoring-options' && failed) throw new Error('候选难度离线'); return fallback(method, path, body, config); };
    const { state } = await show(PaperDetail, '/admin/papers/100?scope=training');
    await state.openCandidatePicker(); await flushPromises();
    expect(state.candidateVisible).toBe(false); expect(transport.calls.some((call) => call.path.endsWith('/candidates'))).toBe(false);
    failed = false; await state.openCandidatePicker(); await flushPromises();
    expect(state.candidateVisible).toBe(true); expect(transport.calls.filter((call) => call.path.endsWith('/candidates'))).toHaveLength(1);
  });
  it('describes the current two random pools without offering historical medium questions for new fixed papers', async () => {
    const fallback = transport.respond;
    transport.respond = async (method, path, body, config) => path === '/admin/papers/100' ? detail({ mode: 'random' }) : fallback(method, path, body, config);
    const { wrapper } = await show(PaperDetail, '/admin/papers/100?scope=training');
    expect(wrapper.text()).toContain('简单题池'); expect(wrapper.text()).toContain('困难题池');
    expect(wrapper.text()).not.toContain('可用于固定卷');
  });
  it('mounts the complete real designer and saves in place before closing to the current detail', async () => {
    const { wrapper, router } = await show(PaperDetail, '/admin/papers/100?scope=training&designer=1');
    expect(wrapper.findAll('.paper-designer__canvas .ProseMirror')).toHaveLength(1);
    expect(wrapper.findAllComponents(QuestionDocumentEditor)).toHaveLength(1);
    const designer = wrapper.getComponent(PaperDesigner);
    expect(designer.props('difficultyOptions')).toEqual([{ value: 'easy', label: '简单' }, { value: 'hard', label: '困难' }]);
    await designer.get('input[aria-label="顶部试卷标题"]').setValue('重命名');
    await designer.vm.save(); await flushPromises();
    expect(designer.get('[role="status"]').text()).toBe('已保存');
    expect(transport.calls.filter((call) => call.path === '/admin/question-documents/commit')).toHaveLength(0);
    expect(transport.calls.filter((call) => call.method === 'put').map((call) => call.path)).toEqual(['/admin/papers/100', '/admin/papers/100/questions']);
    expect(router.currentRoute.value.query.designer).toBe('1');
    await designer.vm.requestClose(); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers/100?scope=training');
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
  it('reloads relation options for the replacement category without changing its adopted paper settings or current draft ID', async () => {
    const { wrapper } = await show(PaperDetail, '/admin/papers/100?scope=training&designer=1');
    const designer = wrapper.getComponent(PaperDesigner); const source = paperFixture('200', '11', 'replacement'); source.paper.regulation_ids = ['31']; source.paper.course_ids = ['41'];
    designer.getComponent(PaperLibrarySidebar).vm.$emit('use-paper', source); await flushPromises();
    const replace = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.trim() === '整卷替换')!; replace.click(); await flushPromises();
    expect(transport.calls.some((call) => call.path === '/admin/papers/course-options' && call.config?.params.category_id === '11')).toBe(true);
    expect(designer.props('modelValue').paper).toMatchObject({ id: '100', title: '试卷 200', category_id: '11', regulation_ids: ['31'], course_ids: ['41'] });
  });
  it('opens one designer session per fullPath and refreshes the cached ordinary detail after save and close', async () => {
    const fallback = transport.respond; let persisted = detail();
    transport.respond = async (method, path, body, config) => {
      if (path === '/admin/papers/100') { if (method === 'put') persisted = { ...persisted, ...copy(body) }; return copy(persisted); }
      return fallback(method, path, body, config);
    };
    const { wrapper, router } = await show(PaperDetail, '/admin/papers/100?scope=training');
    const originalDetailUid = wrapper.getComponent(PaperDetail).vm.$.uid;
    await wrapper.findAll('button').find((button) => button.text() === '编辑试卷')!.trigger('click'); await flushPromises();
    const designer = wrapper.getComponent(PaperDesigner);
    await designer.get('input[aria-label="顶部试卷标题"]').setValue('缓存壳保存后的标题');
    expect(await designer.vm.save()).toBe(true); await flushPromises();
    await designer.vm.requestClose(); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers/100?scope=training');
    expect(wrapper.getComponent(PaperDetail).vm.$.uid).toBe(originalDetailUid);
    expect(wrapper.findComponent(PaperDesigner).exists()).toBe(false);
    expect(wrapper.get('.detail-title').text()).toBe('缓存壳保存后的标题');
    expect(transport.calls.filter((call) => call.path === '/admin/question-documents/assemble')).toHaveLength(1);

    persisted.title = '服务端更新后的标题';
    await wrapper.findAll('button').find((button) => button.text() === '编辑试卷')!.trigger('click'); await flushPromises();
    const reopened = wrapper.getComponent(PaperDesigner);
    expect((reopened.get('input[aria-label="顶部试卷标题"]').element as HTMLInputElement).value).toBe('服务端更新后的标题');
    expect(transport.calls.filter((call) => call.path === '/admin/question-documents/assemble')).toHaveLength(2);
    await reopened.vm.requestClose(); await flushPromises();
    expect(wrapper.findComponent(PaperDesigner).exists()).toBe(false);
    expect(wrapper.get('.detail-title').text()).toBe('服务端更新后的标题');
  });
});
