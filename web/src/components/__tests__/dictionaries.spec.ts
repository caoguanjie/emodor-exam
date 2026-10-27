import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import ElementPlus from 'element-plus';
import Dictionaries from '../../views/admin/Dictionaries.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), confirm: vi.fn(), success: vi.fn(), permissions: new Set<string>() }));
vi.mock('../../api/http', () => ({ default: { get: mocks.get, post: mocks.post, put: mocks.put, delete: mocks.delete } }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (permission: string) => mocks.permissions.has(permission) }) }));
vi.mock('element-plus', async original => ({ ...await original<typeof import('element-plus')>(), ElMessage: { success: mocks.success }, ElMessageBox: { confirm: mocks.confirm } }));

const dictionary = (overrides = {}) => ({ id: '1', type: 'question_type', code: 'single', label: '单选题', sort: 0, status: 1, is_system: true, remark: null, ...overrides });
const category = (overrides = {}) => ({ type: 'notice_channel', label: '通知渠道', description: null as string | null, sort: 1000, count: 42, is_system: false, ...overrides });
let categories: ReturnType<typeof category>[];
let records: ReturnType<typeof dictionary>[];
const wrappers: VueWrapper[] = [];
const listCalls = () => mocks.get.mock.calls.filter(call => call[0] === '/admin/dictionaries');
const lastParams = () => listCalls().at(-1)![1].params;
function pageResponse(params: Record<string, unknown> = {}) {
  const items = records.filter(row => (!params.type || row.type === params.type) && (params.status === undefined || row.status === params.status) && (!params.keyword || `${row.label} ${row.code}`.includes(String(params.keyword))));
  const total = params.keyword || params.status !== undefined ? items.length : params.type ? categories.find(type => type.type === params.type)?.count ?? 0 : categories.reduce((sum, type) => sum + type.count, 0);
  return { items, total };
}
function respond(path: string, config?: { params?: Record<string, unknown> }) {
  return Promise.resolve(path === '/admin/dictionaries/types' ? { items: categories.map(type => ({ ...type })), total: categories.length } : pageResponse(config?.params));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set(['system_settings:read', 'system_settings:write']);
  categories = [
    category({ type: 'question_type', label: '题目类型', sort: 0, count: 31, is_system: true }),
    category({ type: 'difficulty', label: '难度', sort: 1, count: 2, is_system: true }),
    category(),
  ];
  records = [dictionary(), dictionary({ id: '2', type: 'difficulty', code: 'easy', label: '简单' }), dictionary({ id: '3', type: 'notice_channel', code: 'inbox', label: '站内信', is_system: false, remark: '通知时使用' })];
  mocks.get.mockImplementation(respond);
  mocks.confirm.mockResolvedValue('confirm');
  mocks.post.mockResolvedValue(null); mocks.put.mockResolvedValue(null); mocks.delete.mockResolvedValue(null);
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); });

async function render(cached = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: Dictionaries }] });
  await router.push('/admin/system/dictionaries'); await router.isReady();
  const active = ref(true);
  const subject = defineComponent({ setup: () => ({ active, cached }), template: '<router-view v-slot="{ Component }"><KeepAlive v-if="cached"><component :is="Component" v-if="active" /></KeepAlive><component v-else :is="Component" /></router-view>' });
  const wrapper = mount(subject, { attachTo: document.body, global: { plugins: [router, ElementPlus] } });
  wrappers.push(wrapper); await flushPromises();
  const state = (wrapper.getComponent(Dictionaries).vm.$ as any).setupState;
  return { wrapper, state, active };
}
function button(wrapper: VueWrapper | DOMWrapper<Element>, text: string) {
  const found = wrapper.findAll('button').find(candidate => candidate.text() === text);
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found;
}
function dialog() { return new DOMWrapper(document.body.querySelector('.el-dialog')!); }
async function chooseStatus(wrapper: VueWrapper, label: string) {
  await wrapper.findAllComponents({ name: 'ElSelect' })[0].get('.el-select__wrapper').trigger('click');
  await flushPromises();
  const option = [...document.body.querySelectorAll('.el-select-dropdown__item')].find(element => element.textContent === label)!;
  await new DOMWrapper(option).trigger('click'); await flushPromises();
}
async function categoryMenu(wrapper: VueWrapper, type: string) {
  const label = categories.find(item => item.type === type)!.label;
  await wrapper.get(`button[aria-label="管理分类${label}"]`).trigger('click'); await flushPromises();
  return new DOMWrapper(document.body.querySelector(`.el-dropdown-menu[data-category-menu="${type}"]`)!);
}
function categoryDialog() { return new DOMWrapper(document.body.querySelector('.dictionary-category-dialog')!); }

describe('dictionary categories and item maintenance', () => {
  it('loads the complete category catalog once and selects the first real category', async () => {
    const { wrapper } = await render(true);
    expect(mocks.get.mock.calls.filter(call => call[0] === '/admin/dictionaries/types')).toHaveLength(1);
    expect(listCalls()).toHaveLength(1);
    expect(lastParams()).toEqual({ page: 1, page_size: 20, type: 'question_type' });
    expect(wrapper.findComponent({ name: 'ElTree' }).exists()).toBe(true);
    expect(wrapper.get('.el-tree-node.is-current').attributes('data-key')).toBe('question_type');
    expect(wrapper.get('[data-dictionary-type="notice_channel"]').text()).toContain('42');
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('题目类型');
    expect(wrapper.text()).toContain('只读');
    expect(wrapper.get('.dictionary-categories').text()).not.toMatch(/question_type|difficulty|notice_channel/);
    expect(wrapper.findAll('button').some(candidate => ['编辑', '删除'].includes(candidate.text()))).toBe(false);
  });

  it('searches categories locally by Chinese label or English type without losing selection', async () => {
    const { wrapper } = await render(); const calls = mocks.get.mock.calls.length;
    const input = wrapper.get('input[aria-label="搜索字典分类"]');
    await input.setValue('难度');
    expect(wrapper.find('[data-dictionary-type="difficulty"]').exists()).toBe(true);
    expect(wrapper.find('[data-dictionary-type="question_type"]').exists()).toBe(false);
    await input.setValue('NOTICE');
    expect(wrapper.find('[data-dictionary-type="notice_channel"]').exists()).toBe(true);
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('题目类型');
    expect(mocks.get).toHaveBeenCalledTimes(calls);
  });

  it('resets the page and right filters when selecting a category, while reset keeps the category', async () => {
    const { wrapper } = await render();
    await wrapper.get('.el-pagination .btn-next').trigger('click'); await flushPromises();
    expect(lastParams().page).toBe(2);
    await wrapper.get('input[aria-label="字典项关键词"]').setValue('old');
    await wrapper.get('[data-dictionary-type="notice_channel"]').trigger('click'); await flushPromises();
    expect(lastParams()).toEqual({ page: 1, page_size: 20, type: 'notice_channel' });
    expect((wrapper.get('input[aria-label="字典项关键词"]').element as HTMLInputElement).value).toBe('');
    await wrapper.get('input[aria-label="字典项关键词"]').setValue(' inbox ');
    await chooseStatus(wrapper, '停用');
    await button(wrapper, '查询').trigger('click'); await flushPromises();
    expect(lastParams()).toEqual({ page: 1, page_size: 20, type: 'notice_channel', keyword: 'inbox', status: 0 });
    await button(wrapper, '重置').trigger('click'); await flushPromises();
    expect(lastParams()).toEqual({ page: 1, page_size: 20, type: 'notice_channel' });
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('通知渠道');
    await wrapper.get('[data-dictionary-type=""]').trigger('click'); await flushPromises();
    expect(lastParams()).toEqual({ page: 1, page_size: 20 });
    expect(wrapper.findAll('.el-table__header th').map(cell => cell.text())).toContain('类型');
  });

  it('discards stale category selections without letting their finalizer clear the current loading state', async () => {
    const { wrapper, state } = await render();
    let resolveOld!: (value: unknown) => void; let resolveNew!: (value: unknown) => void;
    mocks.get.mockImplementation((path, config) => path === '/admin/dictionaries/types' ? respond(path, config) : config.params.type === 'difficulty' ? new Promise(resolve => { resolveOld = resolve; }) : new Promise(resolve => { resolveNew = resolve; }));
    await wrapper.get('[data-dictionary-type="difficulty"]').trigger('click');
    await wrapper.get('[data-dictionary-type="notice_channel"]').trigger('click');
    resolveOld({ items: [dictionary({ label: '过期结果' })], total: 1 }); await flushPromises();
    expect(state.loading).toBe(true); expect(wrapper.text()).not.toContain('过期结果');
    resolveNew({ items: [dictionary({ type: 'notice_channel', label: '最新结果', is_system: false })], total: 1 }); await flushPromises();
    expect(state.loading).toBe(false); expect(wrapper.text()).toContain('最新结果');
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('通知渠道');
  });

  it('prevents all writes for read-only actors at method boundaries', async () => {
    mocks.permissions.delete('system_settings:write');
    const { wrapper, state } = await render();
    await wrapper.get('[data-dictionary-type="notice_channel"]').trigger('click'); await flushPromises();
    expect(wrapper.findAll('button').some(candidate => ['新增字典项', '编辑', '删除'].includes(candidate.text()))).toBe(false);
    state.openCreate(); state.openEdit(records[2]); await state.save(); await state.remove(records[2]);
    state.openCreateCategory(); state.openEditCategory(categories[2]); await state.saveCategory(); await state.removeCategory(categories[2]);
    expect(wrapper.find('button[aria-label="新增字典分类"]').exists()).toBe(false);
    expect(wrapper.find('.dictionary-tree-node__actions').exists()).toBe(false);
    expect(document.body.querySelector('.el-dialog')).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.delete).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('does not issue catalog or list reads without read permission', async () => {
    mocks.permissions.clear(); const { state } = await render();
    await state.load(); await state.loadTypes();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('prefills a custom type, saves once, and refreshes the full catalog counts and items', async () => {
    const { wrapper, state } = await render();
    await wrapper.get('[data-dictionary-type="notice_channel"]').trigger('click'); await flushPromises();
    await button(wrapper, '新增字典项').trigger('click'); await flushPromises();
    expect(wrapper.findAllComponents({ name: 'ElSelect' }).at(-1)!.props('modelValue')).toBe('notice_channel');
    await dialog().get('input[aria-label="字典项编码"]').setValue('email');
    await dialog().get('input[aria-label="字典项名称"]').setValue('邮件');
    let finishSave!: () => void;
    mocks.post.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = () => { categories[2].count = 43; records.push(dictionary({ id: '4', type: 'notice_channel', code: 'email', label: '邮件', is_system: false })); resolve(); }; }));
    await button(dialog(), '保存').trigger('click'); await state.save();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/admin/dictionaries', { type: 'notice_channel', code: 'email', label: '邮件', sort: 0, status: 1, remark: null });
    finishSave(); await flushPromises();
    expect(wrapper.get('[data-dictionary-type="notice_channel"]').text()).toContain('43');
    expect(wrapper.text()).toContain('邮件');
    expect(lastParams().type).toBe('notice_channel');
  });

  it('creates custom items from a fixed category with an empty type and rejects fixed type edits', async () => {
    const { wrapper, state } = await render();
    await button(wrapper, '新增字典项').trigger('click'); await flushPromises();
    expect(dialog().text()).toContain('自定义');
    expect(wrapper.findAllComponents({ name: 'ElSelect' }).at(-1)!.props('modelValue')).toBe('');
    await button(dialog(), '保存').trigger('click'); await flushPromises();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(dialog().text()).toContain('请填写');
    state.form.type = 'question_type'; state.form.code = 'custom'; state.form.label = '错误固定项'; await state.save();
    expect(mocks.post).not.toHaveBeenCalled(); expect(dialog().text()).toContain('内置');
  });

  it('keeps a failed save open with its values and lets the user retry or discard changes', async () => {
    const { wrapper } = await render();
    await wrapper.get('[data-dictionary-type="notice_channel"]').trigger('click'); await flushPromises();
    await button(wrapper, '编辑').trigger('click'); await flushPromises();
    await dialog().get('input[aria-label="字典项名称"]').setValue('修改后名称');
    mocks.put.mockRejectedValueOnce(new Error('保存暂不可用'));
    await button(dialog(), '保存').trigger('click'); await flushPromises();
    expect(dialog().text()).toContain('保存暂不可用');
    expect((dialog().get('input[aria-label="字典项名称"]').element as HTMLInputElement).value).toBe('修改后名称');
    mocks.confirm.mockRejectedValueOnce('cancel');
    await button(dialog(), '取消').trigger('click'); await flushPromises();
    expect(document.body.querySelector('.el-dialog')).not.toBeNull();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    await button(dialog(), '保存').trigger('click'); await flushPromises();
    expect(mocks.put).toHaveBeenCalledTimes(2);
  });

  it('retries category and list failures separately without claiming a successful empty result', async () => {
    let failTypes = true; let failList = true;
    mocks.get.mockImplementation((path, config) => path === '/admin/dictionaries/types' && failTypes ? Promise.reject(new Error('分类暂不可用')) : path === '/admin/dictionaries' && failList ? Promise.reject(new Error('字典项暂不可用')) : respond(path, config));
    const { wrapper } = await render();
    expect(wrapper.get('[role="alert"]').text()).toContain('分类暂不可用');
    expect(wrapper.find('.el-empty').exists()).toBe(false);
    failTypes = false;
    await wrapper.get('[aria-label="重试加载字典分类"]').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('字典项暂不可用');
    expect(wrapper.find('.el-empty').exists()).toBe(false);
    const typeRequests = mocks.get.mock.calls.filter(call => call[0] === '/admin/dictionaries/types').length;
    failList = false;
    await wrapper.get('[aria-label="重试加载字典项"]').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('单选题');
    expect(mocks.get.mock.calls.filter(call => call[0] === '/admin/dictionaries/types')).toHaveLength(typeRequests);
  });

  it('keeps a custom category selected after its final dictionary item is deleted', async () => {
    categories[2].count = 1;
    const { wrapper } = await render();
    await wrapper.get('[data-dictionary-type="notice_channel"]').trigger('click'); await flushPromises();
    mocks.delete.mockImplementationOnce(async () => { categories[2].count = 0; records.pop(); });
    await button(wrapper, '删除').trigger('click'); await flushPromises();
    expect(mocks.delete).toHaveBeenCalledWith('/admin/dictionaries/3');
    expect(wrapper.get('[data-dictionary-type="notice_channel"]').text()).toContain('0');
    expect(lastParams()).toEqual({ page: 1, page_size: 20, type: 'notice_channel' });
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('通知渠道');
    expect(wrapper.find('.el-empty').exists()).toBe(true);
  });

  it('refreshes on cached activation while preserving the selected type and applied filters', async () => {
    const { wrapper, active } = await render(true);
    await wrapper.get('[data-dictionary-type="notice_channel"]').trigger('click'); await flushPromises();
    await wrapper.get('input[aria-label="字典项关键词"]').setValue('inbox');
    await button(wrapper, '查询').trigger('click'); await flushPromises();
    const reads = mocks.get.mock.calls.length;
    active.value = false; await flushPromises(); active.value = true; await flushPromises();
    expect(mocks.get.mock.calls.length).toBe(reads + 2);
    expect(lastParams()).toEqual({ page: 1, page_size: 20, type: 'notice_channel', keyword: 'inbox' });
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('通知渠道');
  });

  it('moves an item only to an existing custom category and keeps its source category empty', async () => {
    categories[2].count = 1;
    categories.push(category({ type: 'notice_method', label: '通知方式', count: 0 }));
    const { wrapper } = await render();
    await wrapper.get('[data-dictionary-type="notice_channel"]').trigger('click'); await flushPromises();
    await button(wrapper, '编辑').trigger('click'); await flushPromises();
    const typeSelect = wrapper.findAllComponents({ name: 'ElSelect' }).at(-1)!;
    await typeSelect.get('.el-select__wrapper').trigger('click');
    expect(typeSelect.props('allowCreate')).toBe(false);
    await typeSelect.get('input.el-select__input').setValue('不存在的分类'); await flushPromises();
    expect([...document.body.querySelectorAll('.el-select-dropdown__item')].some(element => element.textContent?.trim() === '不存在的分类')).toBe(false);
    await typeSelect.get('input.el-select__input').setValue('通知方式'); await flushPromises();
    const targetOption = [...document.body.querySelectorAll('.el-select-dropdown__item')].find(element => element.textContent?.trim() === '通知方式');
    expect(targetOption).toBeDefined();
    await new DOMWrapper(targetOption!).trigger('click'); await flushPromises();
    mocks.put.mockImplementationOnce(async (_path, payload) => {
      records[2].type = payload.type;
      categories[2].count = 0; categories[3].count = 1;
    });
    await button(dialog(), '保存').trigger('click'); await flushPromises();
    expect(mocks.put.mock.calls[0][1].type).toBe('notice_method');
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('通知方式');
    expect(lastParams()).toEqual({ page: 1, page_size: 20, type: 'notice_method' });
    expect(wrapper.get('.el-tree-node.is-current').attributes('data-key')).toBe('notice_method');
    expect(wrapper.get('[data-dictionary-type="notice_channel"]').text()).toContain('0');
  });

  it('moves back from an empty final page after deleting an item without losing the category', async () => {
    categories[2].count = 41;
    const { wrapper } = await render();
    await wrapper.get('[data-dictionary-type="notice_channel"]').trigger('click'); await flushPromises();
    await wrapper.get('.el-pagination .btn-next').trigger('click'); await flushPromises();
    await wrapper.get('.el-pagination .btn-next').trigger('click'); await flushPromises();
    expect(lastParams().page).toBe(3);
    mocks.delete.mockImplementationOnce(async () => { categories[2].count = 40; });
    await button(wrapper, '删除').trigger('click'); await flushPromises();
    expect(lastParams()).toEqual({ page: 2, page_size: 20, type: 'notice_channel' });
    expect(wrapper.get('[data-dictionary-type="notice_channel"]').text()).toContain('40');
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('通知渠道');
  });

  it('discards late catalog responses and keeps the newer catalog request loading', async () => {
    const { wrapper, state } = await render();
    let resolveOld!: (value: unknown) => void; let resolveNew!: (value: unknown) => void;
    mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
    const older = state.loadTypes(); const newer = state.loadTypes();
    resolveOld({ items: [{ type: 'question_type', label: '过期分类', count: 1, is_system: true }], total: 1 }); await older;
    expect(state.typesLoading).toBe(true); expect(wrapper.text()).not.toContain('过期分类');
    resolveNew({ items: [{ type: 'question_type', label: '题目类型', count: 99, is_system: true }], total: 1 }); await newer; await flushPromises();
    expect(state.typesLoading).toBe(false);
    expect(wrapper.get('[data-dictionary-type="question_type"]').text()).toContain('99');
  });

  it('discards pending list responses after deactivation and refreshes once on return', async () => {
    const { wrapper, state, active } = await render(true);
    let resolvePending!: (value: unknown) => void;
    mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolvePending = resolve; }));
    const pending = state.load(); active.value = false; await flushPromises();
    resolvePending({ items: [dictionary({ label: '离开后的旧响应' })], total: 1 }); await pending;
    expect(state.items[0].label).toBe('单选题'); expect(state.loading).toBe(false);
    const calls = mocks.get.mock.calls.length;
    active.value = true; await flushPromises();
    expect(mocks.get.mock.calls.length).toBe(calls + 2);
    expect(wrapper.text()).not.toContain('离开后的旧响应');
  });

  it('keeps the all-items entry usable when there are no real categories', async () => {
    categories = []; records = [];
    const { wrapper } = await render();
    expect(lastParams()).toEqual({ page: 1, page_size: 20 });
    expect(wrapper.get('[data-dictionary-type=""]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('全部字典');
    expect(wrapper.find('.el-empty').exists()).toBe(true);
  });

  it('opens a category menu without selecting that category and edits only its name and description', async () => {
    const { wrapper } = await render(); const reads = listCalls().length;
    const menu = await categoryMenu(wrapper, 'notice_channel');
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('题目类型');
    expect(listCalls()).toHaveLength(reads);
    await menu.get('[data-category-action="edit"]').trigger('click'); await flushPromises();
    expect(categoryDialog().text()).toContain('编辑字典分类');
    expect((categoryDialog().get('input[aria-label="字典分类名称"]').element as HTMLInputElement).value).toBe('通知渠道');
    expect(categoryDialog().findAll('input, textarea')).toHaveLength(2);
    expect(categoryDialog().text()).not.toContain('notice_channel');
  });

  it('creates an empty named category once and selects it with item creation ready', async () => {
    const { wrapper, state } = await render();
    await wrapper.get('button[aria-label="新增字典分类"]').trigger('click'); await flushPromises();
    await categoryDialog().get('input[aria-label="字典分类名称"]').setValue('  服务类型  ');
    await categoryDialog().get('textarea[aria-label="字典分类描述"]').setValue('  业务服务分类  ');
    const created = category({ type: 'custom_generated_1', label: '服务类型', description: '业务服务分类', count: 0 });
    let finish!: () => void;
    mocks.post.mockImplementationOnce(() => new Promise(resolve => { finish = () => { categories.push(created); resolve(created); }; }));
    await button(categoryDialog(), '保存').trigger('click'); await state.saveCategory();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/admin/dictionaries/types', { label: '服务类型', description: '业务服务分类' });
    finish(); await flushPromises();
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('服务类型');
    expect(wrapper.get('.el-tree-node.is-current').attributes('data-key')).toBe('custom_generated_1');
    expect(lastParams()).toEqual({ page: 1, page_size: 20, type: 'custom_generated_1' });
    expect(wrapper.get('.dictionary-categories').text()).not.toContain('custom_generated_1');
    expect(wrapper.find('.el-empty').exists()).toBe(true);
    await button(wrapper, '新增字典项').trigger('click'); await flushPromises();
    const typeSelect = wrapper.findAllComponents({ name: 'ElSelect' }).at(-1)!;
    expect(typeSelect.props('modelValue')).toBe('custom_generated_1');
    expect(typeSelect.text()).toContain('服务类型');
  });

  it('renames a builtin category without changing its type, items, selection or applied filters', async () => {
    const { wrapper } = await render();
    await wrapper.get('input[aria-label="字典项关键词"]').setValue('single');
    await button(wrapper, '查询').trigger('click'); await flushPromises();
    const reads = listCalls().length;
    const menu = await categoryMenu(wrapper, 'question_type');
    await menu.get('[data-category-action="edit"]').trigger('click'); await flushPromises();
    await categoryDialog().get('input[aria-label="字典分类名称"]').setValue('题型分类');
    await categoryDialog().get('textarea[aria-label="字典分类描述"]').setValue('用于考试题型');
    mocks.put.mockImplementationOnce(async (_path, payload) => { Object.assign(categories[0], payload); return { ...categories[0] }; });
    await button(categoryDialog(), '保存').trigger('click'); await flushPromises();
    expect(mocks.put).toHaveBeenCalledWith('/admin/dictionaries/types/question_type', { label: '题型分类', description: '用于考试题型' });
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('题型分类');
    expect(wrapper.get('[data-dictionary-type="question_type"]').text()).toContain('题型分类');
    expect(wrapper.get('.el-tree-node.is-current').attributes('data-key')).toBe('question_type');
    expect(listCalls()).toHaveLength(reads); expect(lastParams().keyword).toBe('single');
    expect(records[0].code).toBe('single'); expect(wrapper.text()).toContain('单选题');
  });

  it('explains disabled deletion for builtin and nonempty categories and blocks direct calls', async () => {
    const { wrapper, state } = await render();
    const builtinMenu = await categoryMenu(wrapper, 'question_type');
    expect(builtinMenu.get('[data-category-action="delete"]').classes()).toContain('is-disabled');
    expect(builtinMenu.text()).toContain('内置分类不可删除');
    const customMenu = await categoryMenu(wrapper, 'notice_channel');
    expect(customMenu.get('[data-category-action="delete"]').classes()).toContain('is-disabled');
    expect(customMenu.text()).toContain('请先删除分类下的字典项');
    await state.removeCategory(categories[0]); await state.removeCategory(categories[2]);
    expect(mocks.delete).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('deletes an empty selected category and selects a neighboring category', async () => {
    const empty = category({ type: 'custom_empty', label: '空分类', count: 0 }); categories.push(empty);
    const { wrapper } = await render();
    await wrapper.get('[data-dictionary-type="custom_empty"]').trigger('click'); await flushPromises();
    const menu = await categoryMenu(wrapper, 'custom_empty');
    expect(menu.get('[data-category-action="delete"]').classes()).not.toContain('is-disabled');
    mocks.delete.mockImplementationOnce(async () => { categories.pop(); });
    await menu.get('[data-category-action="delete"]').trigger('click'); await flushPromises();
    expect(mocks.delete).toHaveBeenCalledWith('/admin/dictionaries/types/custom_empty');
    expect(wrapper.find('[data-dictionary-type="custom_empty"]').exists()).toBe(false);
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('通知渠道');
    expect(lastParams()).toEqual({ page: 1, page_size: 20, type: 'notice_channel' });
  });

  it('deletes an unselected empty category without reloading the table or clearing its filters', async () => {
    categories.push(category({ type: 'custom_empty', label: '空分类', count: 0 }));
    const { wrapper } = await render();
    await wrapper.get('input[aria-label="字典项关键词"]').setValue('single');
    await button(wrapper, '查询').trigger('click'); await flushPromises();
    const reads = listCalls().length; const menu = await categoryMenu(wrapper, 'custom_empty');
    mocks.delete.mockImplementationOnce(async () => { categories.pop(); });
    await menu.get('[data-category-action="delete"]').trigger('click'); await flushPromises();
    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(listCalls()).toHaveLength(reads);
    expect(lastParams()).toEqual({ page: 1, page_size: 20, type: 'question_type', keyword: 'single' });
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('题目类型');
  });

  it('preserves failed category input and asks before discarding it, then allows retry', async () => {
    const { wrapper } = await render();
    await wrapper.get('button[aria-label="新增字典分类"]').trigger('click'); await flushPromises();
    await button(categoryDialog(), '保存').trigger('click'); await flushPromises();
    expect(mocks.post).not.toHaveBeenCalled(); expect(categoryDialog().text()).toContain('请填写分类名称');
    await categoryDialog().get('input[aria-label="字典分类名称"]').setValue('重名分类');
    await categoryDialog().get('textarea[aria-label="字典分类描述"]').setValue('需要保留的描述');
    mocks.post.mockRejectedValueOnce(new Error('分类名称已存在'));
    await button(categoryDialog(), '保存').trigger('click'); await flushPromises();
    expect(categoryDialog().text()).toContain('分类名称已存在');
    expect((categoryDialog().get('textarea').element as HTMLTextAreaElement).value).toBe('需要保留的描述');
    mocks.confirm.mockRejectedValueOnce('cancel');
    await button(categoryDialog(), '取消').trigger('click'); await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledTimes(1); expect(categoryDialog().exists()).toBe(true);
    const created = category({ type: 'custom_retry', label: '重名分类', description: '需要保留的描述', count: 0 });
    mocks.post.mockImplementationOnce(async () => { categories.push(created); return created; });
    await button(categoryDialog(), '保存').trigger('click'); await flushPromises();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('重名分类');
  });

  it('guides item creation to category creation when there are no custom categories', async () => {
    categories.pop(); records.pop(); const { wrapper } = await render();
    await button(wrapper, '新增字典项').trigger('click'); await flushPromises();
    expect(categoryDialog().text()).toContain('请先新增字典分类');
    expect(categoryDialog().find('input[aria-label="字典项编码"]').exists()).toBe(false);
  });

  it('keeps a pending response from a deleted selection out of the neighboring category', async () => {
    const empty = category({ type: 'custom_empty', label: '空分类', count: 0 }); categories.push(empty);
    const { wrapper, state } = await render();
    await wrapper.get('[data-dictionary-type="custom_empty"]').trigger('click'); await flushPromises();
    let resolveOld!: (value: unknown) => void; let resolveCatalog!: (value: unknown) => void;
    mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockImplementationOnce(() => new Promise(resolve => { resolveCatalog = resolve; }));
    const pending = state.load();
    mocks.delete.mockImplementationOnce(async () => { categories.pop(); });
    const deleting = state.removeCategory(empty); await flushPromises();
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('通知渠道');
    resolveOld({ items: [dictionary({ type: 'custom_empty', label: '删除前的旧结果', is_system: false })], total: 1 }); await pending; await flushPromises();
    expect(wrapper.text()).not.toContain('删除前的旧结果');
    expect(state.loading).toBe(true);
    resolveCatalog({ items: categories, total: categories.length }); await deleting; await flushPromises();
    expect(lastParams().type).toBe('notice_channel'); expect(state.loading).toBe(false);
  });

  it('does not restore a preferred type when the user has selected another type during catalog refresh', async () => {
    const { wrapper, state } = await render();
    let finish!: (value: unknown) => void;
    mocks.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refresh = state.loadTypes('notice_channel');
    await wrapper.get('[data-dictionary-type="difficulty"]').trigger('click'); await flushPromises();
    finish({ items: categories, total: categories.length }); await refresh; await flushPromises();
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('难度');
    expect(wrapper.get('.el-tree-node.is-current').attributes('data-key')).toBe('difficulty');
    expect(lastParams().type).toBe('difficulty');
  });

  it('selects a focused category with the tree keyboard interaction', async () => {
    const { wrapper } = await render();
    expect(wrapper.get('.el-tree-node[data-key="question_type"]').attributes('tabindex')).toBe('0');
    await wrapper.get('input[aria-label="搜索字典分类"]').setValue('难度'); await flushPromises();
    const node = wrapper.get('.el-tree-node[data-key="difficulty"]');
    expect(node.attributes('tabindex')).toBe('0');
    (node.element as HTMLElement).focus();
    await node.trigger('keydown', { code: 'Enter', key: 'Enter' }); await flushPromises();
    expect(wrapper.get('#dictionary-detail-title').text()).toBe('难度');
    expect(lastParams().type).toBe('difficulty');
  });
});
