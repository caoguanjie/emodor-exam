import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElSelect } from 'element-plus';
import Students from '../../views/admin/Users.vue';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), put: vi.fn(), post: vi.fn(), canWrite: true,
  success: vi.fn(), warning: vi.fn(), confirm: vi.fn(),
}));
vi.mock('../../api/http', () => ({ default: { get: mocks.get, put: mocks.put, post: mocks.post }, download: vi.fn(), upload: vi.fn() }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: () => mocks.canWrite }) }));
vi.mock('../../composables/useUnsavedChanges', () => ({
  useUnsavedChanges: () => ({ markClean: vi.fn(), confirmDiscard: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('element-plus', async (original) => ({
  ...await original<typeof import('element-plus')>(),
  ElMessage: { success: mocks.success, warning: mocks.warning },
  ElMessageBox: { confirm: mocks.confirm, prompt: vi.fn() },
}));

interface Student { id: string; username: string; real_name: string; source: 'institution' | 'external' | null; category_id: string | null; status: number }
let serverRows: Student[];
const wrappers: VueWrapper[] = [];
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canWrite = true;
  serverRows = [
    { id: '11', username: 'learner1', real_name: '学员甲', source: 'external', category_id: null, status: 1 },
    { id: '12', username: 'learner2', real_name: '学员乙', source: 'institution', category_id: '10', status: 0 },
  ];
  mocks.get.mockImplementation(async (url: string, config?: { params?: { source?: string } }) => {
    if (url === '/admin/training-categories') return { items: [{ id: '10', name: '安全培训' }] };
    if (url === '/admin/students') {
      const items = serverRows.filter((row) => !config?.params?.source || row.source === config.params.source);
      return { items: copy(items), total: items.length };
    }
    return copy(serverRows.find((row) => url === `/admin/students/${row.id}`));
  });
  mocks.put.mockImplementation(async (url: string, patch: Partial<Student>) => {
    const row = serverRows.find((item) => url === `/admin/students/${item.id}` || url === `/admin/students/${item.id}/status`)!;
    Object.assign(row, patch);
    return copy(row);
  });
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

async function render() {
  const wrapper = mount(Students, { global: { plugins: [ElementPlus], stubs: { MediaUpload: true, ImportPreview: true } } });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
function switches(wrapper: VueWrapper, rowIndex = 0) {
  return wrapper.findAll('.el-table__body-wrapper tbody tr')[rowIndex]!.findAll('[role="switch"]');
}

describe('student SMS profile dialog', () => {
  it('creates SMS learners without requesting or sending a password', async () => {
    mocks.post.mockResolvedValue({ id: '13' });
    const wrapper = await render();
    expect(wrapper.text()).not.toContain('重置密码');
    await wrapper.findAll('button').find((button) => button.text() === '新增学员')!.trigger('click');
    await flushPromises();
    const form = wrapper.find('.student-edit-form');
    expect(form.text()).not.toContain('初始密码');
    const fields = form.findAll('.el-form-item');
    await fields.find((field) => field.text().includes('姓名'))!.find('input').setValue('短信学员');
    await fields.find((field) => field.text().includes('手机号'))!.find('input').setValue('13900139000');
    await wrapper.find('.el-dialog__footer').findAll('button').find((button) => button.text() === '确定')!.trigger('click');
    await flushPromises();
    expect(mocks.post).toHaveBeenCalledWith('/admin/students', expect.objectContaining({ phone: '13900139000', real_name: '短信学员' }));
    expect(mocks.post.mock.calls[0]![1]).not.toHaveProperty('password');
  });
  it('edits the phone login and profile in the legacy dialog and saves status separately', async () => {
    Object.assign(serverRows[0]!, { phone: '13800138000', category_id: '10', gender: 'female', birthday: '2000-01-01' });
    const wrapper = await render();
    await wrapper.findAll('.el-button').find((button) => button.text() === '编辑')!.trigger('click');
    await flushPromises();
    const form = wrapper.find('.student-edit-form');
    expect(form.exists()).toBe(true);
    expect(form.text()).toContain('手机号');
    expect(form.text()).not.toContain('登录账号');
    expect(form.text()).not.toContain('联系电话');
    expect(form.text()).not.toContain('实名认证');
    expect(form.text()).not.toContain('工号');
    expect(form.findAll('input').some((input) => input.element.value === '13800138000')).toBe(true);
    const fields = form.findAll('.el-form-item');
    const age = fields.find((field) => field.text().includes('年龄'))!;
    expect(age.find('.el-input-number').exists()).toBe(true);
    expect(age.text()).not.toContain('设置生日');
    await age.find('input').setValue('26');
    await age.find('input').trigger('change');
    await fields.find((field) => field.text().includes('手机号'))!.find('input').setValue('13900139000');
    await fields.find((field) => field.text().includes('是否禁用'))!.findAll('input')[1]!.setValue(true);
    await wrapper.find('.el-dialog__footer').findAll('button').find((button) => button.text() === '确定')!.trigger('click');
    await flushPromises();
    expect(mocks.put).toHaveBeenCalledWith('/admin/students/11', expect.objectContaining({ phone: '13900139000', gender: 'female', age: 26, birthday: '2000-01-01' }));
    expect(mocks.put).toHaveBeenCalledWith('/admin/students/11/status', { status: 0 });
  });

});
