import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElCheckbox, ElDialog, ElMessageBox, ElOption, ElSelect } from 'element-plus';
import { KeepAlive, defineComponent, h, provide, ref } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import QuestionImport from '../../views/admin/QuestionImport.vue';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), download: vi.fn(), upload: vi.fn() }));
vi.mock('../../api/http', () => ({ default: api, download: api.download, upload: api.upload, ApiError: class extends Error {} }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: () => true }) }));
const wrappers: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (path: string) => {
    if (path === '/admin/questions/authoring-options') return {
      difficulties: [{ code: 'easy', label: '简单', enabled: true, sort: 1 }],
    };
    if (path === '/ai/question-category-options') return {
      items: [{ id: '7', name: '安全培训' }], total: 1, page: 1, page_size: 100,
    };
    throw new Error(`Unexpected GET ${path}`);
  });
  api.upload.mockResolvedValue({ batch_id: '31', valid_rows: [2], duplicates: [], errors: [] });
  api.post.mockResolvedValue({ batch_id: '31', created_ids: ['41'], committed_rows: [2] });
});
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); vi.restoreAllMocks(); });

function ordinaryPreview(rows = [
  {
    row_number: 2, category: '7', type: 'single', difficulty: 'easy', stem: '<p>普通有效题</p>',
    options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }], answer: [0], analysis: '', errors: [],
  },
  {
    row_number: 5, category: '7', type: 'judgment', difficulty: 'easy', stem: '<p>另一有效题</p>',
    options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], answer: [1], analysis: '', errors: [],
  },
]) {
  return { batch_id: '31', valid_rows: rows.map((row) => row.row_number), duplicates: [], errors: [], rows };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function previewDialog(wrapper: VueWrapper) {
  return wrapper.findAllComponents(ElDialog).find((dialog) => dialog.props('title') === '试题导入预览');
}

function teleportedBody() { return new DOMWrapper(document.body); }

async function show() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: QuestionImport },
    { path: '/admin/questions', component: { template: '<p>试题管理</p>' } },
  ] });
  await router.push('/'); await router.isReady();
  const Host = defineComponent({
    setup() {
      const target = ref<HTMLElement>();
      provide('contentDialogTarget', target);
      return () => h('section', [
        h('div', { ref: target, id: 'test-content-dialog-host', class: 'content-dialog-host' }),
        h('main', { class: 'main' }, [h(RouterView)]),
      ]);
    },
  });
  const wrapper = mount(Host, { attachTo: document.body, global: { plugins: [ElementPlus, router] } });
  wrappers.push(wrapper); await flushPromises();
  return { wrapper, router };
}

async function chooseFile(wrapper: VueWrapper, file: File) {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
  await input.trigger('change'); await flushPromises();
}

async function selectCategory(wrapper: VueWrapper, categoryId = '7') {
  const select = wrapper.findAllComponents(ElSelect).find((item) => item.props('placeholder') === '请选择培训类别');
  expect(select, '培训类别选择器').toBeDefined();
  select!.vm.$emit('update:modelValue', categoryId);
  await flushPromises();
  return select!;
}

async function click(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === label)
    || teleportedBody().findAll('button').find((item) => item.text() === label);
  expect(button, label).toBeDefined();
  await button!.trigger('click'); await flushPromises();
}

describe('guided question import', () => {
  it('shows the approved two-column guidance and a real drag-and-drop target', async () => {
    const { wrapper } = await show();
    expect(wrapper.text()).toContain('批量导入试题');
    expect(wrapper.text()).toContain('按模板填写并上传，预览确认后导入题库。');
    expect(wrapper.text()).toContain('01 准备试题');
    expect(wrapper.text()).toContain('02 上传与预览');
    expect(wrapper.text()).toContain('上传后可检查错误、排除重复题目，确认后再导入。');
    expect(wrapper.find('.el-upload-dragger').exists()).toBe(true);
    expect(wrapper.find('.import-workspace').exists()).toBe(true);
    expect(wrapper.findAll('.el-step')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('可选设置');
    expect(wrapper.text()).not.toContain('默认难度');
    expect(wrapper.text()).not.toContain('填写规则');
  });

  it('blocks file selection until a required category is chosen', async () => {
    const { wrapper } = await show();
    expect((wrapper.get('input[type="file"]').element as HTMLInputElement).disabled).toBe(true);
    const trigger = wrapper.findAll('button').find((button) => button.text() === '选择文件并预览')!;
    expect((trigger.element as HTMLButtonElement).disabled).toBe(true);
    expect(trigger.classes()).toContain('el-button--primary');
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));
    expect(api.upload).not.toHaveBeenCalled();
  });

  it('loads every category page so the 101st category can be selected for upload', async () => {
    const categories = Array.from({ length: 101 }, (_, index) => ({ id: String(101 - index), name: `培训类别 ${101 - index}` }));
    api.get.mockImplementation(async (path: string, config?: { params?: { page?: number } }) => {
      if (path === '/admin/questions/authoring-options') return {
        difficulties: [{ code: 'easy', label: '简单', enabled: true, sort: 1 }],
      };
      if (path === '/ai/question-category-options') {
        const page = Number(config?.params?.page || 1);
        return { items: categories.slice((page - 1) * 100, page * 100), total: 101, page, page_size: 100 };
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    const { wrapper } = await show();
    expect(api.get).toHaveBeenCalledWith('/ai/question-category-options', { params: { page: 2, page_size: 100 } });
    expect(wrapper.findAllComponents(ElOption).some((option) => option.props('value') === '1')).toBe(true);
    await selectCategory(wrapper, '1');
    const file = new File(['example'], '较早类别题库.xlsx');
    await chooseFile(wrapper, file);
    expect(api.upload).toHaveBeenCalledWith('/admin/questions/import-preview', file, 'file', { format: 'xlsx', category_id: '1' });
  });

  it('blocks incomplete category options after a later page fails and exposes a retry', async () => {
    let failSecondPage = true;
    api.get.mockImplementation(async (path: string, config?: { params?: { page?: number } }) => {
      if (path === '/admin/questions/authoring-options') return {
        difficulties: [{ code: 'easy', label: '简单', enabled: true, sort: 1 }],
      };
      if (path === '/ai/question-category-options') {
        const page = Number(config?.params?.page || 1);
        if (page === 2 && failSecondPage) throw new Error('第二页暂不可用');
        const items = page === 1
          ? Array.from({ length: 100 }, (_, index) => ({ id: String(101 - index), name: `培训类别 ${101 - index}` }))
          : [{ id: '1', name: '培训类别 1' }];
        return { items, total: 101, page, page_size: 100 };
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    const { wrapper } = await show();
    expect(wrapper.text()).toContain('培训类别加载失败，请重试');
    expect(wrapper.findAllComponents(ElOption)).toHaveLength(0);
    expect((wrapper.get('input[type="file"]').element as HTMLInputElement).disabled).toBe(true);
    failSecondPage = false;
    await click(wrapper, '重新加载培训类别');
    expect(wrapper.text()).not.toContain('培训类别加载失败，请重试');
    expect(wrapper.findAllComponents(ElOption).some((option) => option.props('value') === '1')).toBe(true);
  });

  it.each([['现有题库.XLSX', 'xlsx'], ['现有题库.TXT', 'txt']])(
    'previews %s directly without downloading a template and waits for confirmation', async (name, format) => {
      const { wrapper, router } = await show();
      const category = await selectCategory(wrapper);
      expect((wrapper.get('input[type="file"]').element as HTMLInputElement).disabled).toBe(false);
      const file = new File(['example'], name);
      await chooseFile(wrapper, file);
      expect(api.download).not.toHaveBeenCalled();
      expect(api.upload).toHaveBeenCalledWith('/admin/questions/import-preview', file, 'file', { format, category_id: '7' });
      expect(teleportedBody().text()).toContain('可导入 1 行');
      expect(category.props('disabled')).toBe(true);
      expect(api.post).not.toHaveBeenCalled();
      await click(wrapper, '确认导入并启用 1 行');
      expect(api.post).toHaveBeenCalledWith('/admin/questions/import-batches/31/commit', { row_numbers: [2] });
      expect(router.currentRoute.value.path).toBe('/admin/questions');
    },
  );

  it('offers both templates without making the chosen download restrict later uploads', async () => {
    const { wrapper } = await show();
    await click(wrapper, '下载 Excel 模板（推荐）');
    expect(api.download).toHaveBeenLastCalledWith('/admin/questions/import-template', '题库导入模板.xlsx', { format: 'xlsx' });
    await click(wrapper, '下载 TXT 模板');
    expect(api.download).toHaveBeenLastCalledWith('/admin/questions/import-template', '题库导入模板.txt', { format: 'txt' });
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));
    expect(api.upload.mock.calls.at(-1)![3]).toEqual({ format: 'xlsx', category_id: '7' });
  });

  it('uses the selected category for the whole batch and leaves difficulty to the server default', async () => {
    const { wrapper } = await show();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.txt'));
    expect(api.upload.mock.calls.at(-1)![3]).toEqual({ format: 'txt', category_id: '7' });
  });

  it('renders normalized rich question stems as decoded plain-text summaries', async () => {
    api.upload.mockResolvedValue({
      batch_id: '31', valid_rows: [2], duplicates: [], errors: [], rows: [{
        row_number: 2, category: '7', type: 'single', difficulty: 'easy', stem: '<p>1 &lt; 2</p>',
        options: [{ key: 'A', text: '是' }, { key: 'B', text: '否' }], answer: [0], analysis: '', errors: [],
      }],
    });
    const { wrapper } = await show();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));
    const summary = teleportedBody().get('.preview-stem-summary');
    expect(summary.text()).toBe('1 < 2');
    expect(summary.text()).not.toContain('<p>');
    expect(summary.text()).not.toContain('&lt;');
  });

  it('auto-opens a bounded dialog with separate tagged type and difficulty columns', async () => {
    api.upload.mockResolvedValue(ordinaryPreview());
    const { wrapper } = await show();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));

    const dialog = previewDialog(wrapper);
    expect(dialog, '成功预览后应自动打开导入预览弹窗').toBeDefined();
    expect(dialog!.props('width')).toBe('min(1120px, calc(100vw - 32px))');
    expect(dialog!.props('top')).toBe('4vh');
    expect(dialog!.props('appendToBody')).toBe(true);
    const body = teleportedBody();
    const headings = body.findAll('.question-import-preview-dialog th .cell').map((item) => item.text());
    expect(headings).toContain('题型');
    expect(headings).toContain('难度');
    expect(headings).not.toContain('题型/难度');
    const tags = body.findAll('.question-import-preview-dialog .el-table__body .el-tag').map((item) => item.text());
    expect(tags).toContain('单选题');
    expect(tags).toContain('简单');
    expect(body.get('.question-import-preview-dialog .el-table').attributes('style')).toContain('max-height');
    expect(body.get('.question-import-preview-dialog .el-dialog__footer').element).toBeInstanceOf(HTMLElement);
    expect(wrapper.find('.preview-panel').exists()).toBe(false);
  });

  it('closes and reopens without reuploading or restoring a deselected row', async () => {
    api.upload.mockResolvedValue(ordinaryPreview());
    const { wrapper } = await show();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));
    const first = wrapper.findAllComponents(ElCheckbox).find((checkbox) => checkbox.attributes('aria-label') === '选择第 2 行');
    expect(first).toBeDefined();
    first!.vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(teleportedBody().text()).toContain('确认导入并启用 1 行');

    previewDialog(wrapper)!.vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(previewDialog(wrapper)!.props('modelValue')).toBe(false);
    expect(wrapper.text()).toContain('查看预览');
    await click(wrapper, '查看预览');
    expect(previewDialog(wrapper)!.props('modelValue')).toBe(true);
    expect(teleportedBody().text()).toContain('确认导入并启用 1 行');
    expect(api.upload).toHaveBeenCalledTimes(1);
  });

  it('clears the whole batch then imports only the individually reselected sparse row', async () => {
    api.upload.mockResolvedValue(ordinaryPreview());
    api.post.mockResolvedValue({ batch_id: '31', created_ids: ['41'], committed_rows: [5], enabled: true });
    const { wrapper } = await show();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));

    await click(wrapper, '取消全选');
    expect(teleportedBody().text()).toContain('已选 0 / 2 行');
    const confirm = teleportedBody().findAll('button').find((button) => button.text() === '确认导入并启用 0 行')!;
    expect((confirm.element as HTMLButtonElement).disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
    previewDialog(wrapper)!.vm.$emit('update:modelValue', false);
    await flushPromises();
    await click(wrapper, '查看预览');
    expect(teleportedBody().text()).toContain('已选 0 / 2 行');

    const row = wrapper.findAllComponents(ElCheckbox).find((checkbox) => checkbox.attributes('aria-label') === '选择第 5 行')!;
    await row.get('input').setValue(true);
    const all = wrapper.findAllComponents(ElCheckbox).find((checkbox) => checkbox.attributes('aria-label') === '全选可导入题目')!;
    expect(all.props()).toMatchObject({ modelValue: false, indeterminate: true });
    expect(teleportedBody().text()).toContain('已选 1 / 2 行');
    await click(wrapper, '确认导入并启用 1 行');
    expect(api.post.mock.calls).toEqual([['/admin/questions/import-batches/31/commit', { row_numbers: [5] }]]);
  });

  it('selects and clears only valid rows through both bulk buttons and the header checkbox', async () => {
    const batch = ordinaryPreview();
    const template = batch.rows[0]!;
    api.upload.mockResolvedValue({
      ...batch, duplicates: [11], errors: [{ row: 8, message: '缺少答案' }],
      rows: [...batch.rows, { ...template, row_number: 8, errors: ['缺少答案'] }, { ...template, row_number: 11 }],
    });
    api.post.mockResolvedValue({ batch_id: '31', created_ids: ['41', '42'], committed_rows: [2, 5], enabled: true });
    const { wrapper } = await show();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));
    const header = wrapper.findAllComponents(ElCheckbox).find((checkbox) => checkbox.attributes('aria-label') === '全选可导入题目');
    expect(header, '预览表头应提供全选框').toBeDefined();
    expect(header!.props()).toMatchObject({ modelValue: true, indeterminate: false });
    await header!.get('input').setValue(false);
    expect(teleportedBody().text()).toContain('已选 0 / 2 行');
    await click(wrapper, '全选');
    expect(header!.props()).toMatchObject({ modelValue: true, indeterminate: false });
    for (const row of [8, 11]) {
      const checkbox = wrapper.findAllComponents(ElCheckbox).find((item) => item.attributes('aria-label') === `选择第 ${row} 行`)!;
      expect(checkbox.props()).toMatchObject({ modelValue: false, disabled: true });
    }
    await click(wrapper, '取消全选');
    await header!.get('input').setValue(true);
    expect(teleportedBody().text()).toContain('已选 2 / 2 行');
    await click(wrapper, '确认导入并启用 2 行');
    expect(api.post.mock.calls).toEqual([['/admin/questions/import-batches/31/commit', { row_numbers: [2, 5] }]]);
  });

  it('disables bulk selection and confirmation when there are no valid rows', async () => {
    const batch = ordinaryPreview();
    api.upload.mockResolvedValue({ ...batch, valid_rows: [], errors: [{ row: 2, message: '答案错误' }, { row: 5, message: '答案错误' }] });
    const { wrapper } = await show();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));
    const header = wrapper.findAllComponents(ElCheckbox).find((checkbox) => checkbox.attributes('aria-label') === '全选可导入题目');
    expect(header, '无有效行时仍应有明确禁用的全选框').toBeDefined();
    expect(header!.props()).toMatchObject({ modelValue: false, indeterminate: false, disabled: true });
    for (const label of ['全选', '取消全选', '确认导入并启用 0 行']) {
      const button = teleportedBody().findAll('button').find((item) => item.text() === label)!;
      expect((button.element as HTMLButtonElement).disabled).toBe(true);
    }
    expect(api.post).not.toHaveBeenCalled();
  });

  it('opens an ordinary full preview above the list dialog with an ordinary title', async () => {
    api.upload.mockResolvedValue(ordinaryPreview());
    const { wrapper } = await show();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));
    await click(wrapper, '预览');

    const titles = teleportedBody().findAll('.el-dialog__title').map((item) => item.text());
    expect(titles).toContain('试题预览');
    expect(titles).not.toContain('生成题预览');
    const listOverlay = document.querySelector('.question-import-preview-dialog')?.closest('.el-overlay') as HTMLElement;
    const rowOverlay = document.querySelector('.question-import-row-preview-dialog')?.closest('.el-overlay') as HTMLElement;
    const host = wrapper.get('#test-content-dialog-host').element;
    expect(host.contains(listOverlay)).toBe(true);
    expect(host.contains(rowOverlay)).toBe(true);
    expect(wrapper.get('.main').element.contains(listOverlay)).toBe(false);
    expect(Number(rowOverlay?.style.zIndex)).toBeGreaterThan(Number(listOverlay?.style.zIndex));
  });

  it('blocks every list-dialog dismissal while commit status is pending or unknown and keeps recovery available', async () => {
    const batch = ordinaryPreview();
    const commit = deferred<never>();
    const status = deferred<ReturnType<typeof ordinaryPreview>>();
    api.upload.mockResolvedValue(batch);
    api.post.mockReturnValue(commit.promise);
    const priorGet = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (path: string, ...args: unknown[]) => (
      path === '/admin/questions/import-batches/31' ? status.promise : priorGet(path, ...args)
    ));
    const { wrapper } = await show();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));
    const first = wrapper.findAllComponents(ElCheckbox).find((checkbox) => checkbox.attributes('aria-label') === '选择第 2 行')!;
    first.vm.$emit('update:modelValue', false);
    await flushPromises();
    await click(wrapper, '确认导入并启用 1 行');
    await flushPromises();

    let dialog = previewDialog(wrapper)!;
    expect(dialog.props('closeOnClickModal')).toBe(false);
    expect(dialog.props('closeOnPressEscape')).toBe(false);
    expect(dialog.props('showClose')).toBe(false);
    for (const label of ['全选', '取消全选']) {
      const button = teleportedBody().findAll('button').find((item) => item.text() === label);
      expect(button, label).toBeDefined();
      expect((button!.element as HTMLButtonElement).disabled).toBe(true);
    }
    const header = wrapper.findAllComponents(ElCheckbox).find((checkbox) => checkbox.attributes('aria-label') === '全选可导入题目')!;
    expect(header.props('disabled')).toBe(true);
    wrapper.findComponent({ name: 'QuestionImportPreviewDialog' }).vm.$emit('select-all', true);
    await flushPromises();
    expect(teleportedBody().text()).toContain('确认导入并启用 1 行');
    dialog.vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(previewDialog(wrapper)!.props('modelValue')).toBe(true);

    commit.reject(new Error('提交响应丢失'));
    await flushPromises();
    dialog = previewDialog(wrapper)!;
    expect(dialog.props('showClose')).toBe(false);
    expect(header.props('disabled')).toBe(true);
    wrapper.findComponent({ name: 'QuestionImportPreviewDialog' }).vm.$emit('select-all', false);
    await flushPromises();
    expect(teleportedBody().text()).toContain('确认导入并启用 1 行');
    dialog.vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(previewDialog(wrapper)!.props('modelValue')).toBe(true);
    expect(teleportedBody().text()).toContain('查询原批次状态');

    await click(wrapper, '查询原批次状态');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/admin/questions/import-batches/31');
    expect(header.props('disabled')).toBe(true);
    wrapper.findComponent({ name: 'QuestionImportPreviewDialog' }).vm.$emit('select-all', true);
    await flushPromises();
    expect(teleportedBody().text()).toContain('确认导入并启用 1 行');
    status.resolve(batch);
    await flushPromises();
    expect(previewDialog(wrapper)!.props('showClose')).toBe(true);
    expect(teleportedBody().text()).toContain('确认导入并启用 1 行');
    previewDialog(wrapper)!.vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(previewDialog(wrapper)!.props('modelValue')).toBe(false);
  });

  it('discards the batch only through the explicit reset action and closes the dialog', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    api.upload.mockResolvedValue(ordinaryPreview());
    const { wrapper } = await show();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));
    await click(wrapper, '修正后重新上传');

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(previewDialog(wrapper)!.props('modelValue')).toBe(false);
    expect(wrapper.text()).not.toContain('查看预览');
    expect((wrapper.get('input[type="file"]').element as HTMLInputElement).disabled).toBe(false);
  });

  it('closes teleported previews on KeepAlive deactivation and reopens the preserved selection after activation', async () => {
    api.upload.mockResolvedValue(ordinaryPreview());
    const active = ref(true);
    const Host = defineComponent({
      setup() {
        const target = ref<HTMLElement>();
        provide('contentDialogTarget', target);
        return () => h('section', [
          h('div', { ref: target, class: 'content-dialog-host' }),
          h(KeepAlive, null, () => active.value
            ? h(QuestionImport, { key: 'import' })
            : h('div', { key: 'other' }, '其他页面')),
        ]);
      },
    });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Host }] });
    await router.push('/'); await router.isReady();
    const wrapper = mount(RouterView, { attachTo: document.body, global: { plugins: [ElementPlus, router], stubs: { transition: false } } });
    wrappers.push(wrapper); await flushPromises();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));
    const first = wrapper.findAllComponents(ElCheckbox).find((checkbox) => checkbox.attributes('aria-label') === '选择第 2 行')!;
    first.vm.$emit('update:modelValue', false);
    await flushPromises();
    await click(wrapper, '预览');
    expect(document.querySelector('.question-import-row-preview-dialog')).not.toBeNull();

    active.value = false;
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    const deactivatedDialog = document.querySelector('.question-import-preview-dialog');
    const deactivatedOverlay = deactivatedDialog?.closest('.el-overlay') as HTMLElement | null;
    expect(!deactivatedDialog || deactivatedOverlay?.style.display === 'none').toBe(true);
    expect(document.querySelector('.question-import-row-preview-dialog')).toBeNull();
    active.value = true;
    await flushPromises();
    expect(wrapper.text()).toContain('查看预览');
    await click(wrapper, '查看预览');
    expect(teleportedBody().text()).toContain('确认导入并启用 1 行');
    expect(api.upload).toHaveBeenCalledTimes(1);
  });

  it('supports dropping a file after category selection', async () => {
    const { wrapper } = await show();
    await selectCategory(wrapper);
    const file = new File(['example'], '拖入题库.txt');
    await wrapper.get('.el-upload-dragger').trigger('drop', { dataTransfer: { files: [file], items: [] } });
    await flushPromises();
    expect(api.upload).toHaveBeenCalledWith('/admin/questions/import-preview', file, 'file', { format: 'txt', category_id: '7' });
  });

  it('downloads the legacy AI reference template with its explicit purpose', async () => {
    const { wrapper } = await show();
    const aiTab = wrapper.findAll('.el-tabs__item').find((item) => item.text() === 'AI 生成');
    expect(aiTab).toBeDefined();
    await aiTab!.trigger('click'); await flushPromises();
    await click(wrapper, '下载 XLSX 模板');
    expect(api.download).toHaveBeenLastCalledWith('/admin/questions/import-template', 'AI参考题模板.xlsx', { format: 'xlsx', purpose: 'ai' });
  });

  it('rejects unsupported and oversized files without starting a preview', async () => {
    const { wrapper } = await show();
    await selectCategory(wrapper);
    await chooseFile(wrapper, new File(['example'], '题库.csv'));
    await chooseFile(wrapper, new File([new Uint8Array(5 * 1024 * 1024 + 1)], '题库.xlsx'));
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});
