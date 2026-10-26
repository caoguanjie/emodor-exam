import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElSelect } from 'element-plus';
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
    if (path === '/ai/question-category-options') return { items: [{ id: '7', name: '安全培训' }] };
    throw new Error(`Unexpected GET ${path}`);
  });
  api.upload.mockResolvedValue({ batch_id: '31', valid_rows: [2], duplicates: [], errors: [] });
  api.post.mockResolvedValue({ batch_id: '31', created_ids: ['41'], committed_rows: [2] });
});
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); });

async function show() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: QuestionImport },
    { path: '/admin/questions', component: { template: '<p>试题管理</p>' } },
  ] });
  await router.push('/'); await router.isReady();
  const wrapper = mount(RouterView, { attachTo: document.body, global: { plugins: [ElementPlus, router] } });
  wrappers.push(wrapper); await flushPromises();
  return { wrapper, router };
}

async function chooseFile(wrapper: VueWrapper, file: File) {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
  await input.trigger('change'); await flushPromises();
}

async function click(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === label);
  expect(button, label).toBeDefined();
  await button!.trigger('click'); await flushPromises();
}

describe('guided question import', () => {
  it.each([['现有题库.XLSX', 'xlsx'], ['现有题库.TXT', 'txt']])(
    'previews %s directly without downloading a template and waits for confirmation', async (name, format) => {
      const { wrapper, router } = await show();
      expect((wrapper.get('input[type="file"]').element as HTMLInputElement).disabled).toBe(false);
      const file = new File(['example'], name);
      await chooseFile(wrapper, file);
      expect(api.download).not.toHaveBeenCalled();
      expect(api.upload).toHaveBeenCalledWith('/admin/questions/import-preview', file, 'file', { format });
      expect(wrapper.text()).toContain('可导入 1 行');
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
    await chooseFile(wrapper, new File(['example'], '题库.xlsx'));
    expect(api.upload.mock.calls.at(-1)![3]).toEqual({ format: 'xlsx' });
  });

  it('retains optional defaults when their section is collapsed and sends them with the preview', async () => {
    const { wrapper } = await show();
    const optional = wrapper.findAll('.el-collapse-item').find((item) => item.text().includes('可选设置'))!;
    expect(optional.get('[role="button"]').attributes('aria-expanded')).toBe('false');
    await optional.get('[role="button"]').trigger('click');
    const selects = optional.findAllComponents(ElSelect);
    selects[0]!.vm.$emit('update:modelValue', '7');
    selects[1]!.vm.$emit('update:modelValue', 'easy');
    await flushPromises();
    await optional.get('[role="button"]').trigger('click');
    await chooseFile(wrapper, new File(['example'], '题库.txt'));
    expect(api.upload.mock.calls.at(-1)![3]).toEqual({ format: 'txt', category_id: '7', difficulty: 'easy' });
  });

  it('rejects unsupported and oversized files without starting a preview', async () => {
    const { wrapper } = await show();
    await chooseFile(wrapper, new File(['example'], '题库.csv'));
    await chooseFile(wrapper, new File([new Uint8Array(5 * 1024 * 1024 + 1)], '题库.xlsx'));
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});
