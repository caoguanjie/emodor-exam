import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElPagination, ElSelect } from 'element-plus';
import { defineComponent, provide, ref } from 'vue';
import Questions from '../../views/admin/Questions.vue';

const api = vi.hoisted(() => ({
  get: vi.fn(), put: vi.fn(), post: vi.fn(), remove: vi.fn(),
  canWrite: true, success: vi.fn(), warning: vi.fn(), confirm: vi.fn(),
}));
vi.mock('../../api/http', () => ({ default: { get: api.get, put: api.put, post: api.post, delete: api.remove } }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({
  can: (permission: string) => permission !== 'questions:write' || api.canWrite,
}) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../composables/useUnsavedChanges', () => ({
  useUnsavedChanges: () => ({ markClean: vi.fn(), confirmDiscard: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('element-plus', async (original) => ({
  ...await original<typeof import('element-plus')>(),
  ElMessage: { success: api.success, warning: api.warning },
  ElMessageBox: { confirm: api.confirm },
}));

interface QuestionRow {
  question_id: string; current_version_id: string; enabled: boolean;
  category_id: string; type: 'single' | 'multiple' | 'judgment'; difficulty: string | null;
  stem: string; options: Array<{ key: string; text: string }>; answer: number[]; analysis: string;
}
let rows: QuestionRow[];
const wrappers: VueWrapper[] = [];
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.canWrite = true;
  api.confirm.mockResolvedValue('confirm');
  rows = ['40', '41'].map((id, index) => ({
    question_id: id, current_version_id: String(50 + index), enabled: true,
    category_id: '7', type: 'single', difficulty: index === 0 ? 'easy' : 'hard',
    stem: `题目 ${id}`, options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }],
    answer: [0], analysis: '',
  }));
  api.get.mockImplementation(async (path: string, config?: { params?: { enabled?: boolean; category_id?: string; page?: number; page_size?: number } }) => {
    if (path === '/admin/questions/authoring-options') return { difficulties: [
      { code: 'easy', label: '简单', enabled: true, sort: 1 },
      { code: 'medium', label: '中级', enabled: false, sort: 2 },
      { code: 'hard', label: '困难', enabled: true, sort: 3 },
    ] };
    if (path === '/ai/question-category-options' || path === '/ai/question-category-filters') return { items: [{ id: '7', name: '安全培训' }, { id: '8', name: '专项培训' }] };
    if (path === '/ai/questions') {
      const list = rows.filter((row) => (config?.params?.enabled === undefined || row.enabled === config.params.enabled)
        && (!config?.params?.category_id || row.category_id === config.params.category_id));
      const offset = ((config?.params?.page ?? 1) - 1) * (config?.params?.page_size ?? 20);
      return { list: copy(list.slice(offset, offset + (config?.params?.page_size ?? 20))), total: list.length };
    }
    return copy(rows.find((row) => path === `/ai/questions/${row.question_id}`));
  });
  api.put.mockImplementation(async (path: string, body: { enabled: boolean }) => {
    const row = rows.find((item) => path === `/ai/questions/${item.question_id}/enabled`)!;
    row.enabled = body.enabled;
    return copy(row);
  });
  api.remove.mockImplementation(async (path: string) => {
    const row = rows.find((item) => path === `/ai/questions/${item.question_id}`)!;
    rows = rows.filter((item) => item !== row);
    return { question_id: row.question_id, deleted: true, deleted_at: '2026-10-26T06:00:00.000Z' };
  });
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

async function render(all = true) {
  const wrapper = mount(Questions, { global: {
    plugins: [ElementPlus], stubs: { ManualQuestionEditor: true, QuestionPreview: true },
  } });
  wrappers.push(wrapper);
  await flushPromises();
  if (all) {
    const filter = wrapper.findAllComponents(ElSelect).find((select) => select.props('placeholder') === '启用状态')!;
    filter.vm.$emit('update:modelValue', '');
    filter.vm.$emit('change', '');
    await flushPromises();
  }
  return wrapper;
}
async function renderInContentHost() {
  const Host = defineComponent({
    components: { Questions },
    setup() {
      const contentDialogTarget = ref<HTMLElement>();
      provide('contentDialogTarget', contentDialogTarget);
      return { contentDialogTarget };
    },
    template: `
      <section class="test-content-region">
        <div ref="contentDialogTarget" class="content-dialog-host" />
        <Questions />
      </section>
    `,
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [ElementPlus], stubs: { ManualQuestionEditor: true, transition: false } },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
function bodyRows(wrapper: VueWrapper) { return wrapper.findAll('.el-table__body-wrapper tbody tr'); }
function toggle(wrapper: VueWrapper, index = 0) { return bodyRows(wrapper)[index]!.get('[role="switch"]'); }
function rowAction(wrapper: VueWrapper, label: string, index = 0) {
  return bodyRows(wrapper)[index]!.findAll('button').find((button) => button.text() === label)!;
}
function queuedAction(wrapper: VueWrapper, label: string, index = 0) {
  return wrapper.findAllComponents({ name: 'FitsTableAction' }).filter((action) => action.text() === label)[index]!;
}
function editorDialog(wrapper: VueWrapper) { return wrapper.findComponent({ name: 'ElDialog' }); }
function editorButton(wrapper: VueWrapper, label: string) {
  return wrapper.get('.manual-question-dialog').findAll('button').find((button) => button.text() === label)!;
}

describe('question list actions and confirmed lifecycle switches', () => {
  it('uses the shared Element Plus empty state only after the empty question query settles', async () => {
    const pending = deferred<{ list: QuestionRow[]; total: number }>();
    const original = api.get.getMockImplementation()!;
    api.get.mockImplementation((path: string, ...args: unknown[]) => path === '/ai/questions'
      ? pending.promise : original(path, ...args));
    const wrapper = await render(false);
    expect(wrapper.get('.question-table').findComponent({ name: 'ElEmpty' }).exists()).toBe(false);

    pending.resolve({ list: [], total: 0 });
    await flushPromises();
    const empty = wrapper.get('.question-table').getComponent({ name: 'ElEmpty' });
    expect(empty.props('description')).toBe('暂无试题');
    expect(empty.find('.el-empty__image svg').exists()).toBe(true);
  });

  it('places the primary create-question action before import and opens the existing editor', async () => {
    const wrapper = await render();
    const buttons = wrapper.get('[aria-label="列表操作"]').findAll('button');
    expect(buttons.map((button) => button.text())).toEqual(['新增试题', '试题导入']);
    expect(buttons[0]!.classes()).toContain('el-button--primary');
    await buttons[0]!.trigger('click');
    await flushPromises();
    expect(editorDialog(wrapper).props()).toMatchObject({ modelValue: true, title: '新增试题' });
  });

  it('uses one inner-page business dialog and switches preview to the existing editor in place', async () => {
    const wrapper = await renderInContentHost();
    expect(wrapper.findAllComponents({ name: 'ElDialog' })).toHaveLength(1);

    await rowAction(wrapper, '预览').trigger('click');
    await flushPromises();

    const host = wrapper.get('.content-dialog-host');
    const dialog = host.get('.el-dialog').element;
    expect(dialog.classList).toContain('question-business-dialog');
    expect(dialog.classList).toContain('question-preview-dialog');
    expect(dialog.closest('.el-overlay')?.parentElement).toBe(host.element);
    expect(host.get('.el-dialog__title').text()).toBe('题目预览');
    expect(host.get('.question-preview').classes()).toContain('question-preview--library');
    expect(host.find('.question-preview__meta').exists()).toBe(false);
    expect(host.find('.preview-identity').exists()).toBe(false);
    expect(host.find('.version-history').exists()).toBe(false);
    expect(api.get.mock.calls.some(([path]) => String(path).endsWith('/history'))).toBe(false);
    expect(host.get('.el-dialog__footer').findAll('button').map((button) => button.text())).toEqual(['关闭', '编辑题目']);

    await host.get('.el-dialog__footer').findAll('button')[1]!.trigger('click');
    await flushPromises();

    expect(host.get('.el-dialog').element).toBe(dialog);
    expect(dialog.classList).toContain('re-form-dialog');
    expect(dialog.classList).toContain('manual-question-dialog');
    expect(host.get('.el-dialog__title').text()).toBe('修订试题');
    expect(host.findComponent({ name: 'ManualQuestionEditor' }).exists()).toBe(true);
    expect(host.text()).toContain('保存会生成新版本并启用；旧版本保持不变。');
    expect(host.get('.el-dialog__footer').text()).toContain('正确答案');
    expect(host.get('.el-dialog__footer').text()).toContain('暂无未保存修改');
    expect(host.get('.el-dialog__footer').text()).toContain('取消');
    expect(host.get('.el-dialog__footer').text()).toContain('保存');
  });

  it.each([
    ['新增试题', '新增试题', false],
    ['修改', '修订试题', true],
    ['预览', '题目预览', false],
  ] as const)('places the revision hint beside the title only for %s', async (action, title, hasHint) => {
    const wrapper = await renderInContentHost();
    if (action === '新增试题') {
      await wrapper.get('[aria-label="列表操作"]').findAll('button')[0]!.trigger('click');
    } else {
      await rowAction(wrapper, action).trigger('click');
    }
    await flushPromises();
    const host = wrapper.get('.content-dialog-host');
    const header = host.get('.el-dialog__header');
    expect(header.get('.el-dialog__title').text()).toBe(title);
    expect(header.find('.editor-hint').exists()).toBe(hasHint);
    if (hasHint) {
      expect(header.get('.editor-hint').text()).toBe('保存会生成新版本并启用；旧版本保持不变。');
    }
    expect(host.get('.el-dialog__body').text()).not.toContain('保存会生成新版本并启用；旧版本保持不变。');
  });

  it('keeps the lightweight preview read-only when the account cannot edit questions', async () => {
    api.canWrite = false;
    const wrapper = await renderInContentHost();

    await rowAction(wrapper, '预览').trigger('click');
    await flushPromises();

    const footer = wrapper.get('.content-dialog-host').get('.el-dialog__footer');
    expect(footer.findAll('button').map((button) => button.text())).toEqual(['关闭']);
  });

  it('keeps preview open when the selected question cannot enter the editor', async () => {
    Object.assign(rows[0]!, {
      content_schema_version: 3,
      content_json: { stem: { type: 'doc', content: [] }, options: [] },
    });
    const wrapper = await renderInContentHost();

    await rowAction(wrapper, '预览').trigger('click');
    await flushPromises();
    const host = wrapper.get('.content-dialog-host');
    const dialog = host.get('.el-dialog').element;
    await host.get('.el-dialog__footer').findAll('button')[1]!.trigger('click');
    await flushPromises();

    expect(host.get('.el-dialog').element).toBe(dialog);
    expect(host.get('.el-dialog__title').text()).toBe('题目预览');
    expect(host.findComponent({ name: 'ManualQuestionEditor' }).exists()).toBe(false);
    expect(api.warning).toHaveBeenCalled();
  });

  it('returns from an unknown-save inspection to the preserved editor in the same dialog', async () => {
    const wrapper = await renderInContentHost();
    await rowAction(wrapper, '修改').trigger('click');
    await flushPromises();

    const host = wrapper.get('.content-dialog-host');
    const dialog = host.get('.el-dialog').element;
    api.put.mockResolvedValueOnce({ question_id: '40' });
    await (wrapper.getComponent(Questions).vm.$ as unknown as {
      setupState: { saveQuestion(): Promise<void> };
    }).setupState.saveQuestion();
    await flushPromises();
    expect(host.text()).toContain('保存结果尚未确认');

    await host.findAll('button').find((button) => button.text() === '查询当前题目')!.trigger('click');
    await flushPromises();
    expect(host.get('.el-dialog').element).toBe(dialog);
    expect(host.get('.el-dialog__title').text()).toBe('题目预览');
    expect(host.get('.el-dialog__footer').findAll('button').map((button) => button.text())).toEqual(['返回编辑']);

    await host.get('.el-dialog__footer button').trigger('click');
    await flushPromises();
    expect(host.get('.el-dialog').element).toBe(dialog);
    expect(host.get('.el-dialog__title').text()).toBe('修订试题');
    expect(host.text()).toContain('保存结果尚未确认');
  });

  it.each([
    ['single', 'easy', '单选题', '简单', 'primary', 'success'],
    ['multiple', 'hard', '多选题', '困难', 'info', 'danger'],
    ['judgment', null, '判断题', '未知', 'info', 'info'],
    ['single', 'medium', '单选题', '中级', 'primary', 'warning'],
    ['multiple', 'legacy', '多选题', 'legacy', 'info', 'info'],
  ] as const)('renders %s/%s as distinct non-interactive tags without replacing historical difficulty', async (type, difficulty, typeText, difficultyText, typeColor, difficultyColor) => {
    rows[0] = { ...rows[0]!, type, difficulty };
    const wrapper = await render();
    const headers = wrapper.findAll('.el-table__header-wrapper th .cell').map((cell) => cell.text());
    expect(headers).toContain('题型');
    expect(headers).toContain('难度');
    expect(headers).not.toContain('题型/难度');
    const cells = bodyRows(wrapper)[0]!.findAll('td');
    const typeTag = cells[headers.indexOf('题型')]!.getComponent({ name: 'ElTag' });
    const difficultyTag = cells[headers.indexOf('难度')]!.getComponent({ name: 'ElTag' });
    expect(typeTag.text()).toBe(typeText);
    expect(typeTag.props()).toMatchObject({ type: typeColor, effect: 'light', round: false });
    expect(typeTag.classes()).toContain(`question-type-tag--${type}`);
    expect(difficultyTag.text()).toBe(difficultyText);
    expect(difficultyTag.props()).toMatchObject({ type: difficultyColor, effect: 'light', round: false });
    for (const tag of [typeTag, difficultyTag]) {
      expect(tag.classes()).toContain('question-meta-tag');
      expect(tag.element.closest('button, [role="button"]')).toBeNull();
      expect(tag.find('button, [role="button"]').exists()).toBe(false);
    }
  });

  it('keeps short type and difficulty tags in compact centered columns', async () => {
    const wrapper = await render();
    const columns = wrapper.findAllComponents({ name: 'ElTableColumn' });
    for (const [label, maxWidth] of [['题型', 88], ['难度', 80]] as const) {
      const column = columns.find((item) => item.props('label') === label)!;
      expect(Number(column.props('width'))).toBeLessThanOrEqual(maxWidth);
      expect(column.props()).toMatchObject({ align: 'center', headerAlign: 'center' });
    }
  });

  it('uses labelled switches and a narrow centered actions column without lifecycle row actions', async () => {
    const wrapper = await render();
    expect(bodyRows(wrapper)[0]!.text()).toContain('启用');
    expect(toggle(wrapper).attributes('aria-checked')).toBe('true');
    const column = wrapper.findAllComponents({ name: 'ElTableColumn' }).find((item) => item.props('label') === '操作')!;
    expect(column.props()).toMatchObject({ width: '180', align: 'center', headerAlign: 'center' });
    const actions = bodyRows(wrapper)[0]!.get('.fits-table-actions');
    expect(actions.classes()).toContain('question-row-actions');
    expect(actions.findAll('button').map((button) => button.text())).toEqual(['预览', '修改', '删除']);
    expect(actions.text()).not.toMatch(/修订|停用|恢复/);
  });

  it('writes the precise version immediately without a confirmation and uses the confirmed result', async () => {
    const wrapper = await render();
    await toggle(wrapper).trigger('click');
    await flushPromises();
    expect(api.put).toHaveBeenCalledWith('/ai/questions/40/enabled', { enabled: false, expected_version_id: '50' });
    expect(api.confirm).not.toHaveBeenCalled();
    expect(toggle(wrapper).attributes('aria-checked')).toBe('false');
    expect(bodyRows(wrapper)[0]!.text()).toContain('停用');
  });

  it('keeps the previous value while pending and blocks only that question', async () => {
    const wrapper = await render();
    const gate = deferred<QuestionRow>();
    api.put.mockImplementationOnce(() => gate.promise);
    await toggle(wrapper).trigger('click');
    expect(toggle(wrapper).attributes('aria-checked')).toBe('true');
    expect(toggle(wrapper).attributes('aria-disabled')).toBe('true');
    expect(toggle(wrapper, 1).attributes('aria-disabled')).not.toBe('true');
    await toggle(wrapper).trigger('click');
    expect(api.put).toHaveBeenCalledTimes(1);
    rows[0]!.enabled = false;
    gate.resolve(copy(rows[0]!));
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-checked')).toBe('false');
  });

  it.each([false, true])('reads detail instead of retrying a lost write (applied=%s)', async (applied) => {
    const wrapper = await render();
    api.put.mockImplementationOnce(async () => {
      if (applied) rows[0]!.enabled = false;
      throw new Error('lost response');
    });
    await toggle(wrapper).trigger('click');
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith('/ai/questions/40');
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(toggle(wrapper).attributes('aria-checked')).toBe(applied ? 'false' : 'true');
    expect(api.success).not.toHaveBeenCalled();
  });

  it('keeps a failed reconciliation locked until a detail query succeeds', async () => {
    const wrapper = await render();
    const get = api.get.getMockImplementation()!;
    let offline = true;
    api.get.mockImplementation(async (path: string, ...args: unknown[]) => {
      if (path === '/ai/questions/40' && offline) throw new Error('offline');
      return get(path, ...args);
    });
    api.put.mockRejectedValueOnce(new Error('lost response'));
    await toggle(wrapper).trigger('click');
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-disabled')).toBe('true');
    await toggle(wrapper).trigger('click');
    expect(api.put).toHaveBeenCalledTimes(1);
    offline = false;
    await bodyRows(wrapper)[0]!.findAll('button').find((button) => button.text() === '查询状态')!.trigger('click');
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-disabled')).not.toBe('true');
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('disables switches without write permission', async () => {
    api.canWrite = false;
    const wrapper = await render();
    expect(toggle(wrapper).attributes('aria-disabled')).toBe('true');
    await toggle(wrapper).trigger('click');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('refreshes the enabled filter when a question is disabled', async () => {
    const wrapper = await render(false);
    expect(bodyRows(wrapper)).toHaveLength(2);
    await toggle(wrapper).trigger('click');
    await flushPromises();
    expect(bodyRows(wrapper)).toHaveLength(1);
    expect(bodyRows(wrapper)[0]!.text()).toContain('题目 41');
  });

  it('does not restore a stale row when independent lifecycle refreshes arrive out of order', async () => {
    const wrapper = await render(false);
    const staleRow = copy(rows[1]!);
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const get = api.get.getMockImplementation()!;
    let listRequests = 0;
    api.get.mockImplementation((path: string, ...args: unknown[]) => {
      if (path === '/ai/questions') return ++listRequests === 1 ? first.promise : second.promise;
      return get(path, ...args);
    });
    await toggle(wrapper).trigger('click');
    await flushPromises();
    await toggle(wrapper, 1).trigger('click');
    await flushPromises();
    second.resolve({ list: [], total: 0 });
    await flushPromises();
    first.resolve({ list: [staleRow], total: 1 });
    await flushPromises();
    expect(bodyRows(wrapper)).toHaveLength(0);
  });

  it.each(['receipt', 'reconciliation'])('invalidates a pending all-status list after a confirmed %s', async (confirmation) => {
    const wrapper = await render();
    const staleRows = copy(rows);
    const mutation = deferred<unknown>();
    const staleList = deferred<unknown>();
    const get = api.get.getMockImplementation()!;
    api.put.mockImplementationOnce(() => mutation.promise);
    api.get.mockImplementationOnce((path: string, ...args: unknown[]) => path === '/ai/questions'
      ? staleList.promise : get(path, ...args));
    await toggle(wrapper).trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === '查询')!.trigger('click');
    rows[0]!.enabled = false;
    mutation.resolve(confirmation === 'receipt' ? copy(rows[0]!) : {});
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-checked')).toBe('false');
    const loadingAfterConfirmation = (wrapper.vm.$ as unknown as { setupState: { loading: boolean } }).setupState.loading;
    staleList.resolve({ list: staleRows, total: staleRows.length });
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-checked')).toBe('false');
    expect(loadingAfterConfirmation).toBe(false);
    expect(api.put).toHaveBeenCalledTimes(1);
    if (confirmation === 'reconciliation') expect(api.get).toHaveBeenCalledWith('/ai/questions/40');
  });

  it.each([
    ['receipt', 'page'], ['receipt', 'category'],
    ['reconciliation', 'page'], ['reconciliation', 'category'],
  ] as const)('reloads the current %s query after a pending %s change instead of leaving old rows', async (confirmation, change) => {
    const first = copy(rows[0]!);
    rows = change === 'page'
      ? Array.from({ length: 21 }, (_, index) => ({ ...copy(first), question_id: String(40 + index), stem: `题目 ${40 + index}` }))
      : [first, { ...copy(first), question_id: '80', category_id: '8', stem: '题目 80' }];
    const wrapper = await render();
    const mutation = deferred<unknown>();
    const pendingQuery = deferred<void>();
    const get = api.get.getMockImplementation()!;
    api.put.mockImplementationOnce(() => mutation.promise);
    api.get.mockImplementationOnce(async (path: string, ...args: unknown[]) => {
      const response = await get(path, ...args);
      await pendingQuery.promise;
      return response;
    });
    await toggle(wrapper).trigger('click');
    if (change === 'page') {
      const pagination = wrapper.findComponent(ElPagination);
      pagination.vm.$emit('update:current-page', 2);
      pagination.vm.$emit('current-change', 2);
    } else {
      const category = wrapper.findAllComponents(ElSelect).find((select) => select.props('placeholder') === '培训类别')!;
      category.vm.$emit('update:modelValue', '8');
      category.vm.$emit('change', '8');
    }
    await flushPromises();
    rows[0]!.enabled = false;
    mutation.resolve(confirmation === 'receipt' ? copy(rows[0]!) : {});
    await flushPromises();
    pendingQuery.resolve();
    await flushPromises();
    expect(bodyRows(wrapper).map((row) => row.get('.stem-summary').text())).toEqual([change === 'page' ? '题目 60' : '题目 80']);
    expect(wrapper.findComponent(ElPagination).props('total')).toBe(change === 'page' ? 21 : 1);
    const latestListRequest = api.get.mock.calls.filter(([path]) => path === '/ai/questions').at(-1)!;
    expect(latestListRequest[1].params).toEqual(expect.objectContaining(change === 'page' ? { page: 2 } : { page: 1, category_id: '8' }));
    expect(api.put).toHaveBeenCalledTimes(1);
    if (confirmation === 'reconciliation') expect(api.get).toHaveBeenCalledWith('/ai/questions/40');
  });

  it('holds a submitted question lock after closing its editor and releases that ID without unlocking another row', async () => {
    const wrapper = await render();
    const save = deferred<unknown>();
    const otherChange = deferred<unknown>();
    api.put.mockImplementation((path: string) => path === '/ai/questions/40' ? save.promise : otherChange.promise);
    await rowAction(wrapper, '修改').trigger('click');
    await flushPromises();
    await editorButton(wrapper, '保存').trigger('click');
    await flushPromises();
    expect(api.put).toHaveBeenCalledWith('/ai/questions/40', expect.objectContaining({ expected_version_id: '50', expected_enabled: true }));
    await editorButton(wrapper, '取消').trigger('click');
    await flushPromises();
    expect(editorDialog(wrapper).props('modelValue')).toBe(false);
    expect(toggle(wrapper).attributes('aria-disabled')).toBe('true');
    expect(rowAction(wrapper, '修改').attributes('disabled')).toBeDefined();
    expect(rowAction(wrapper, '删除').attributes('disabled')).toBeDefined();
    expect(toggle(wrapper, 1).attributes('aria-disabled')).not.toBe('true');
    queuedAction(wrapper, '修改').vm.$emit('click');
    queuedAction(wrapper, '删除').vm.$emit('click');
    wrapper.findAllComponents({ name: 'ElSwitch' })[0]!.vm.$emit('change', false);
    await flushPromises();
    expect(editorDialog(wrapper).props('modelValue')).toBe(false);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.remove).not.toHaveBeenCalled();
    expect(api.confirm).not.toHaveBeenCalled();
    await rowAction(wrapper, '修改', 1).trigger('click');
    await flushPromises();
    wrapper.findAllComponents({ name: 'ElSwitch' })[1]!.vm.$emit('change', false);
    await flushPromises();
    expect(api.put).toHaveBeenCalledTimes(2);
    rows[0]!.current_version_id = '52';
    save.resolve({ ...copy(rows[0]!), saved_version_id: '52' });
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-disabled')).not.toBe('true');
    expect(toggle(wrapper, 1).attributes('aria-disabled')).toBe('true');
    expect(editorDialog(wrapper).props('modelValue')).toBe(true);
    rows[1]!.enabled = false;
    otherChange.resolve(copy(rows[1]!));
    await flushPromises();
    expect(toggle(wrapper, 1).attributes('aria-disabled')).not.toBe('true');
  });

  it('blocks a queued editor save when the same question already has an in-flight status write', async () => {
    const wrapper = await render();
    const change = deferred<unknown>();
    api.put.mockImplementation((path: string) => path.endsWith('/enabled') ? change.promise : { ...copy(rows[0]!), saved_version_id: '52' });
    await rowAction(wrapper, '修改').trigger('click');
    await flushPromises();
    wrapper.findAllComponents({ name: 'ElSwitch' })[0]!.vm.$emit('change', false);
    await flushPromises();
    expect(editorButton(wrapper, '保存').attributes('disabled')).toBeDefined();
    wrapper.findComponent({ name: 'ManualQuestionEditor' }).vm.$emit('save');
    await flushPromises();
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put.mock.calls[0]![0]).toBe('/ai/questions/40/enabled');
    rows[0]!.enabled = false;
    change.resolve(copy(rows[0]!));
    await flushPromises();
  });

  it.each(['malformed', 'lost'])('retains the submitted ID lock after a %s save result until detail reconciliation', async (result) => {
    const wrapper = await render();
    const save = deferred<unknown>();
    api.put.mockImplementationOnce(() => save.promise);
    await rowAction(wrapper, '修改').trigger('click');
    await flushPromises();
    const pendingSave = (wrapper.vm.$ as unknown as { setupState: { saveQuestion(): Promise<void> } }).setupState.saveQuestion().catch((error) => error);
    await flushPromises();
    await editorButton(wrapper, '取消').trigger('click');
    await flushPromises();
    await rowAction(wrapper, '修改', 1).trigger('click');
    await flushPromises();
    const lost = new Error('lost save response');
    if (result === 'lost') save.reject(lost); else save.resolve({ question_id: '40' });
    const failure = await pendingSave;
    if (result === 'lost') expect(failure).toBe(lost);
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-disabled')).toBe('true');
    expect(toggle(wrapper, 1).attributes('aria-disabled')).not.toBe('true');
    expect(wrapper.get('.manual-question-dialog').text()).not.toContain('保存结果尚未确认');
    await editorButton(wrapper, '取消').trigger('click');
    await flushPromises();
    queuedAction(wrapper, '修改').vm.$emit('click');
    await flushPromises();
    expect(editorDialog(wrapper).props('modelValue')).toBe(false);
    const get = api.get.getMockImplementation()!;
    let offline = true;
    api.get.mockImplementation((path: string, ...args: unknown[]) => {
      if (path === '/ai/questions/40' && offline) throw new Error('offline');
      return get(path, ...args);
    });
    await rowAction(wrapper, '查询状态').trigger('click');
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-disabled')).toBe('true');
    offline = false;
    await rowAction(wrapper, '查询状态').trigger('click');
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-disabled')).not.toBe('true');
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('confirms logical deletion once and sends both current-state guards', async () => {
    const wrapper = await render();
    await bodyRows(wrapper)[0]!.findAll('button').find((button) => button.text() === '删除')!.trigger('click');
    await flushPromises();
    expect(api.confirm).toHaveBeenCalledTimes(1);
    expect(api.confirm.mock.calls[0]![0]).toMatch(/从题库移除.*保留历史/);
    expect(api.remove).toHaveBeenCalledWith('/ai/questions/40', { data: { expected_version_id: '50', expected_enabled: true } });
    expect(api.put).not.toHaveBeenCalled();
    expect(bodyRows(wrapper)).toHaveLength(1);
    expect(bodyRows(wrapper)[0]!.text()).toContain('题目 41');
  });

  it('cancels deletion without writing or locking the row', async () => {
    const wrapper = await render();
    api.confirm.mockRejectedValueOnce('cancel');
    await bodyRows(wrapper)[0]!.findAll('button').find((button) => button.text() === '删除')!.trigger('click');
    await flushPromises();
    expect(api.remove).not.toHaveBeenCalled();
    expect(toggle(wrapper).attributes('aria-disabled')).not.toBe('true');
  });

  it('interlocks deletion, status and editing only on the pending row', async () => {
    const wrapper = await render();
    const gate = deferred<unknown>();
    api.remove.mockImplementationOnce(() => gate.promise);
    const deleteButton = bodyRows(wrapper)[0]!.findAll('button').find((button) => button.text() === '删除')!;
    await deleteButton.trigger('click');
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-disabled')).toBe('true');
    expect(toggle(wrapper, 1).attributes('aria-disabled')).not.toBe('true');
    expect(bodyRows(wrapper)[0]!.findAll('button').find((button) => button.text() === '修改')!.attributes('disabled')).toBeDefined();
    await deleteButton.trigger('click');
    await toggle(wrapper).trigger('click');
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
    rows.shift();
    gate.resolve({ question_id: '40', deleted: true, deleted_at: '2026-10-26T06:00:00.000Z' });
    await flushPromises();
  });

  it('reconciles a lost deletion using detail 40401 without resending or claiming success', async () => {
    const wrapper = await render();
    const get = api.get.getMockImplementation()!;
    api.remove.mockImplementationOnce(async () => { rows.shift(); throw new Error('lost response'); });
    api.get.mockImplementation(async (path: string, ...args: unknown[]) => {
      if (path === '/ai/questions/40') throw { code: 40401 };
      return get(path, ...args);
    });
    await bodyRows(wrapper)[0]!.findAll('button').find((button) => button.text() === '删除')!.trigger('click');
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith('/ai/questions/40');
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(api.success).not.toHaveBeenCalled();
    expect(bodyRows(wrapper)).toHaveLength(1);
  });

  it('keeps an existing authoritative row after a failed delete without resending', async () => {
    const wrapper = await render();
    api.remove.mockImplementationOnce(async () => { rows[0]!.enabled = false; throw { code: 40940 }; });
    await bodyRows(wrapper)[0]!.findAll('button').find((button) => button.text() === '删除')!.trigger('click');
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith('/ai/questions/40');
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(bodyRows(wrapper)).toHaveLength(2);
    expect(toggle(wrapper).attributes('aria-checked')).toBe('false');
    expect(api.success).not.toHaveBeenCalled();
    expect(api.warning).toHaveBeenCalled();
  });

  it('locks unknown deletion until a later detail query reconciles without another delete', async () => {
    const wrapper = await render();
    const get = api.get.getMockImplementation()!;
    let offline = true;
    api.remove.mockRejectedValueOnce(new Error('lost response'));
    api.get.mockImplementation(async (path: string, ...args: unknown[]) => {
      if (path === '/ai/questions/40' && offline) throw new Error('offline');
      return get(path, ...args);
    });
    await bodyRows(wrapper)[0]!.findAll('button').find((button) => button.text() === '删除')!.trigger('click');
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-disabled')).toBe('true');
    offline = false;
    await bodyRows(wrapper)[0]!.findAll('button').find((button) => button.text() === '查询状态')!.trigger('click');
    await flushPromises();
    expect(toggle(wrapper).attributes('aria-disabled')).not.toBe('true');
    expect(api.remove).toHaveBeenCalledTimes(1);
  });

  it('returns to the previous page after deleting its last row', async () => {
    const first = rows[0]!;
    rows = Array.from({ length: 21 }, (_, index) => ({ ...copy(first), question_id: String(40 + index), stem: `题目 ${40 + index}` }));
    const wrapper = await render();
    const pagination = wrapper.findComponent(ElPagination);
    pagination.vm.$emit('update:current-page', 2);
    pagination.vm.$emit('current-change', 2);
    await flushPromises();
    expect(bodyRows(wrapper)).toHaveLength(1);
    await bodyRows(wrapper)[0]!.findAll('button').find((button) => button.text() === '删除')!.trigger('click');
    await flushPromises();
    expect(pagination.props('currentPage')).toBe(1);
    expect(bodyRows(wrapper)).toHaveLength(20);
  });
});
