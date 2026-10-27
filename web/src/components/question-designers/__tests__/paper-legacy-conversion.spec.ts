import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElFormItem, ElInput, ElMessageBox, ElSelect } from 'element-plus';
import { defineComponent, h, KeepAlive } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import PaperDetail from '../../../views/admin/PaperDetail.vue';
import Papers from '../../../views/admin/Papers.vue';
import PaperDesigner from '../PaperDesigner.vue';
import QuestionProperties from '../QuestionProperties.vue';
import { copy, paperFixture } from './paper-designer-fixtures';

const transport = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; path: string; body?: any }>,
  respond: async (_method: string, _path: string, _body?: any): Promise<any> => ({}),
}));
vi.mock('../../../api/http', () => ({ default: Object.fromEntries(['get', 'post', 'put'].map((method) => [method, async (path: string, body?: any) => {
  transport.calls.push(copy({ method, path, body })); return transport.respond(method, path, body);
}])) }));
vi.mock('../../../stores/auth', () => ({ useAuthStore: () => ({ can: (permission: string) => ['papers:read', 'papers:write', 'questions:read', 'questions:write'].includes(permission) }) }));

const wrappers: VueWrapper[] = [];
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeAll(() => {
  if (!rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  if (!rangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
});
afterAll(() => { if (!rangeRects) Reflect.deleteProperty(Range.prototype, 'getClientRects'); if (!rangeBounds) Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect'); });
afterEach(async () => { ElMessageBox.close(); wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); await flushPromises(); });

function record(overrides = {}) {
  return { ...paperFixture().paper, business_scope: 'training', status: 'draft', total_score: 100, latest_release_id: null,
    sum_score_cents: 10000, rules: [], designer_layout: null, regulation_ids: ['30'],
    questions: [{ question_id: '40', question_version_id: '50', sort: 0, score_cents: 10000, type: 'single', difficulty: 'easy',
      concept_id: null, regulation_id: '30', stem: '来源题干', options: [], enabled: true }], ...overrides };
}
function sourceBundle() {
  const document = copy(paperFixture().document);
  Object.assign(document.questions.question_one!, { question_id: '40', base_revision: 1, concept_id: null, regulation_id: '30', regulation_version_id: '31' });
  return { document, option_ids: { question_one: { question_one_a: 'A', question_one_b: 'B' } },
    identities: { question_one: { question_id: '40', expected_version_id: '50', expected_enabled: true } }, layouts: {} };
}
let records: Map<string, any>;
beforeEach(() => {
  transport.calls = []; records = new Map([['100', record()]]);
  transport.respond = async (method, path, body) => {
    if (path === '/admin/questions/authoring-options') return { difficulties: [{ code: 'easy', label: '简单', enabled: true, sort: 1 }, { code: 'hard', label: '困难', enabled: true, sort: 2 }] };
    if (path === '/admin/papers/category-options') return { items: [{ id: '10', name: '原培训类别' }, { id: '20', name: '新培训类别' }], total: 2, page: 1, page_size: 100 };
    if (path === '/admin/papers') {
      if (method === 'get') return { items: [...records.values()], total: records.size, page: 1, page_size: 20 };
      const created = record({ ...body, id: '300', regulation_ids: [], questions: [] }); records.set('300', created); return copy(created);
    }
    if (path === '/admin/papers/100/copy') { const copied = record({ ...copy(records.get('100')), id: '200', title: '旧卷副本', status: 'draft', latest_release_id: null }); records.set('200', copied); return copy(copied); }
    if (path === '/admin/question-documents/assemble') return sourceBundle();
    if (path === '/admin/question-documents/commit') return { request_id: body.request_id, bundle: copy(body.bundle),
      items: Object.keys(body.bundle.document.questions).map((client_id) => ({ client_id, question_id: '90', saved_version_id: '91', revision: 1 })) };
    const paperPath = path.match(/^\/admin\/papers\/(\d+)$/);
    if (paperPath) {
      const current = records.get(paperPath[1]!);
      if (method === 'put') records.set(paperPath[1]!, { ...current, ...copy(body), ...(body.category_id !== current.category_id ? { questions: [] } : {}) });
      return copy(records.get(paperPath[1]!));
    }
    if (path.endsWith('/questions')) return {};
    if (path === '/ai/papers' || path === '/ai/questions') return { list: [], total: 0 };
    throw new Error(`Unexpected ${method} ${path}`);
  };
});
async function show(url = '/admin/papers/100?scope=training') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/papers', component: Papers }, { path: '/admin/papers/:id', component: PaperDetail }] });
  await router.push(url); await router.isReady();
  const wrapper = mount(defineComponent({ setup: () => () => h(RouterView, null, {
    default: ({ Component, route }: any) => h(KeepAlive, null, () => Component ? h(Component, { key: route.fullPath }) : null),
  }) }), { attachTo: document.body, global: { plugins: [ElementPlus, router] } });
  wrappers.push(wrapper); await flushPromises(); return { wrapper, router };
}
function button(wrapper: Pick<VueWrapper, 'findAll'> | DOMWrapper<Element>, text: string) { return wrapper.findAll('button').find((item) => item.text() === text)!; }
function confirmation() {
  const body = new DOMWrapper(document.body);
  return body.findAll('.el-message-box').filter((item) => item.isVisible()).at(-1) || body.find('[data-no-confirmation]');
}
const writes = () => transport.calls.filter((call) => call.method !== 'get' && call.path !== '/admin/question-documents/assemble');
async function editQuestion(wrapper: VueWrapper) {
  const designer = wrapper.getComponent(PaperDesigner);
  await designer.getComponent(QuestionProperties).get('input[type="radio"][value="hard"]').setValue(true); await flushPromises();
  expect(designer.props('modelValue').document.questions.question_one).toMatchObject({ difficulty: 'hard', regulation_id: '30', regulation_version_id: '31' });
  return designer;
}

describe('legacy paper range conversion through the real UI', () => {
  it('cancels an edited source question without writes and then continues the existing phased save after conversion', async () => {
    const { wrapper } = await show('/admin/papers/100?scope=training&designer=1');
    const designer = await editQuestion(wrapper);
    await button(designer, '保存').trigger('click'); await flushPromises();
    expect(confirmation().exists()).toBe(true); expect(writes()).toEqual([]);
    await button(confirmation(), '取消').trigger('click'); await flushPromises();
    expect(designer.props('modelValue').paper.regulation_ids).toEqual(['30']);
    expect(designer.props('modelValue').document.questions.question_one).toMatchObject({ difficulty: 'hard', regulation_id: '30', regulation_version_id: '31' });
    expect(writes()).toEqual([]);
    await button(designer, '保存').trigger('click'); await flushPromises();
    await button(confirmation(), '转换并保存').trigger('click'); await flushPromises();
    expect(writes().map((call) => call.path)).toEqual(['/admin/question-documents/commit', '/admin/papers/100', '/admin/papers/100/questions']);
    expect(writes()[1]!.body.regulation_ids).toEqual([]);
    expect(writes()[0]!.body.bundle).toMatchObject({ identities: {}, document: { questions: { question_one: { regulation_id: null, regulation_version_id: null } } } });
    expect(wrapper.findComponent(PaperDesigner).exists()).toBe(false);
    expect(records.get('100').regulation_ids).toEqual([]);
  });

  it('converts an inherited range on a copied draft while leaving the published source intact', async () => {
    const published = record({ status: 'published', latest_release_id: '500' }); records.set('100', published);
    records.set('200', record({ id: '200', regulation_ids: ['30'] }));
    const { wrapper } = await show('/admin/papers/200?scope=training');
    const designer = await editQuestion(wrapper);
    await button(designer, '保存').trigger('click'); await flushPromises();
    expect(confirmation().exists()).toBe(true);
    await button(confirmation(), '转换并保存').trigger('click'); await flushPromises();
    expect(writes().find((call) => call.path === '/admin/papers/200')?.body.regulation_ids).toEqual([]);
    expect(wrapper.findComponent(PaperDesigner).exists()).toBe(false);
    expect(records.get('100')).toEqual(published);
    expect(writes().some((call) => call.method === 'put' && call.path.startsWith('/admin/papers/100'))).toBe(false);
  });

  it('creates a new fixed draft and opens its designer without a conversion prompt', async () => {
    const { wrapper, router } = await show('/admin/papers');
    await button(wrapper, '新增试卷').trigger('click'); await flushPromises();
    const dialog = new DOMWrapper(document.body).find('.re-form-dialog');
    await dialog.get('input[maxlength="128"]').setValue('新配置试卷');
    await button(dialog, '保存并组卷').trigger('click'); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers/300?scope=training&designer=1');
    expect(confirmation().exists()).toBe(false);
    expect(wrapper.findComponent(PaperDesigner).exists()).toBe(true);
    expect(writes().map((call) => call.path)).toEqual(['/admin/papers']);
  });

  it.each([false, true])('does not save a departed designer route after confirming conversion (query flag=%s)', async (designerMode) => {
    const { wrapper, router } = await show(`/admin/papers/100?scope=training${designerMode ? '&designer=1' : ''}`);
    const page = wrapper.getComponent(PaperDetail);
    await button(wrapper.getComponent(PaperDesigner), '保存').trigger('click'); await flushPromises();
    expect(confirmation().exists()).toBe(true);
    await router.push('/admin/papers'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/admin/papers');
    await button(confirmation(), '转换并保存').trigger('click'); await flushPromises();
    expect(writes()).toEqual([]);
    expect(records.get('100').regulation_ids).toEqual(['30']);
  });
});
