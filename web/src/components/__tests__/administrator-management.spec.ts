import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import Administrators from '../../views/admin/Administrators.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), confirm: vi.fn(), success: vi.fn(), warning: vi.fn(), permissions: new Set<string>(), isSuperAdmin: false }));
vi.mock('../../api/http', () => ({ default: mocks }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ user: { id: '7' }, get isSuperAdmin() { return mocks.isSuperAdmin; }, can: (code: string) => mocks.permissions.has(code) }) }));
vi.mock('element-plus', async (original) => ({
  ...await original<typeof import('element-plus')>(),
  ElMessage: { success: mocks.success, warning: mocks.warning }, ElMessageBox: { confirm: mocks.confirm },
}));

const baseline = {
  id: '8', username: 'manager', real_name: '管理员', phone: '', email: '', system_role: 'employee',
  status: 1, last_login_at: null, login_count: 0, last_login_ip: null, created_at: '2026-10-27T01:02:03Z',
  role_ids: ['role-1'], permissions: [],
};
const wrappers: VueWrapper[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set(['administrators:read', 'administrators:create', 'administrators:update', 'administrators:reset_password', 'administrators:delete']);
  mocks.isSuperAdmin = false;
  mocks.confirm.mockResolvedValue('confirm');
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/admin/administrators') return { items: [structuredClone(baseline)], total: 12, page: 1, page_size: 10 };
    if (path === '/admin/administrators/assignable-roles') return [{ id: 'role-1', name: '业务角色', code: 'business', status: 1, is_system: false }];
    if (path === '/admin/administrators/8') return { ...structuredClone(baseline), real_name: '最新姓名', role_ids: ['role-1', 'inactive-role'] };
    throw new Error(`Unexpected administrator GET ${path}`);
  });
  mocks.post.mockResolvedValue({});
  mocks.put.mockResolvedValue({});
  mocks.delete.mockResolvedValue({});
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

const FormDialog = defineComponent({
  props: ['modelValue'],
  setup(props, { slots }) { return () => props.modelValue ? h('section', [slots.default?.(), slots.footer?.()]) : null; },
});

async function render(withDialogSlots = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/administrators', component: Administrators }] });
  await router.push('/admin/administrators');
  const wrapper = mount(RouterView, { global: { plugins: [ElementPlus, router], stubs: { ElDialog: withDialogSlots ? FormDialog : true } } });
  wrappers.push(wrapper);
  await flushPromises();
  return (wrapper.getComponent(Administrators).vm.$ as any).setupState;
}

describe('administrator account maintenance', () => {
  it.each(['create', 'edit'])('binds the reusable role select in the %s flow', async (mode) => {
    const state = await render(true);
    if (mode === 'create') await state.openCreate();
    else await state.openEdit(baseline);
    await flushPromises();
    const picker = wrappers.at(-1)!.findComponent({ name: 'RoleSelect' });
    expect(picker.exists()).toBe(true);
    expect(picker.props('modelValue')).toEqual(mode === 'create' ? [] : ['role-1', 'inactive-role']);
    expect(picker.props('options')).toContainEqual(expect.objectContaining({ id: 'role-1', name: '业务角色', code: 'business' }));
    if (mode !== 'create') expect(picker.props('options')).toContainEqual(expect.objectContaining({ id: 'inactive-role', unavailable: true }));
    picker.vm.$emit('update:modelValue', ['role-1']);
    await flushPromises();
    expect(state.createForm.role_ids).toEqual(['role-1']);
    expect(state.createDirty).toBe(true);
    state.createSaving = true;
    await flushPromises();
    expect(picker.props('disabled')).toBe(true);
  });

  it('keeps an empty dropdown available when there are no enabled business roles', async () => {
    const normalGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path) => path === '/admin/administrators/assignable-roles' ? Promise.resolve([]) : normalGet(path));
    const state = await render(true);
    await state.openCreate();
    await flushPromises();
    const picker = wrappers.at(-1)!.findComponent({ name: 'RoleSelect' });
    expect(picker.exists()).toBe(true);
    expect(picker.props('options')).toEqual([]);
    expect(wrappers.at(-1)!.text()).toContain('暂无可用业务角色');
  });

  it('blocks a mismatched confirmation before the create API receives a password', async () => {
    const state = await render();
    await state.openCreate();
    Object.assign(state.createForm, { username: 'new.manager', real_name: '新管理员', role_ids: ['role-1'], password: 'Secure123', confirm_password: 'Different123' });
    await state.createAdministrator();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('loads fresh edit details and retains a historical inactive role in the update payload', async () => {
    const state = await render();
    expect(state.openEdit).toBeTypeOf('function');
    await state.openEdit(baseline);
    expect(state.createForm.real_name).toBe('最新姓名');
    state.createForm.real_name = ' 更新姓名 ';
    await state.createAdministrator();
    expect(mocks.put).toHaveBeenCalledWith('/admin/administrators/8', { real_name: '更新姓名', phone: '', status: 1, role_ids: ['role-1', 'inactive-role'] });
  });

  it('resets server pagination when a keyword search starts', async () => {
    const state = await render();
    expect(state.total).toBe(12);
    state.query.page = 3;
    state.query.keyword = ' manager ';
    await state.searchAdministrators();
    expect(mocks.get).toHaveBeenLastCalledWith('/admin/administrators', { params: { page: 1, page_size: 10, keyword: 'manager' } });
    expect(state.rows.map((row: { id: string }) => row.id)).toEqual(['8']);
  });

  for (const operation of ['create', 'update', 'reset_password', 'delete'] as const) {
    it('limits an administrator ' + operation + '-only actor to its own buttons and methods', async () => {
      mocks.permissions = new Set(['administrators:read', 'administrators:' + operation]);
      const state = await render();
      const labels = wrappers.at(-1)!.findAll('button').map((button) => button.text());
      expect(labels.includes('新增管理员')).toBe(operation === 'create');
      expect(labels).not.toContain('为账号配置角色');
      expect(labels.includes('修改')).toBe(operation === 'update');
      expect(labels.includes('重置密码')).toBe(operation === 'reset_password');
      expect(labels.includes('删除')).toBe(operation === 'delete');
      if (operation !== 'create') await state.openCreate();
      if (operation !== 'update') await state.openEdit(baseline);
      if (operation !== 'reset_password') await state.openResetPassword(baseline);
      if (operation !== 'delete') await state.deleteAdministrator(baseline);
      expect(mocks.get.mock.calls.some(([path]) => path !== '/admin/administrators')).toBe(false);
      expect(mocks.post).not.toHaveBeenCalled();
      expect(mocks.put).not.toHaveBeenCalled();
      expect(mocks.delete).not.toHaveBeenCalled();
      if (operation === 'create') {
        await state.openCreate();
        Object.assign(state.createForm, { username: 'only.create', password: 'Secure123', confirm_password: 'Secure123', role_ids: ['role-1'] });
        await state.createAdministrator();
        expect(mocks.post).toHaveBeenCalledWith('/admin/administrators', { username: 'only.create', password: 'Secure123', real_name: '', phone: '', status: 1, role_ids: ['role-1'] });
      } else if (operation === 'update') {
        await state.openEdit(baseline);
        state.createForm.role_ids = ['role-1'];
        await state.createAdministrator();
        expect(mocks.put).toHaveBeenCalledWith('/admin/administrators/8', { real_name: '最新姓名', phone: '', status: 1, role_ids: ['role-1'] });
      } else if (operation === 'reset_password') {
        expect(state.canEditAdministrator(baseline)).toBe(false);
        expect(state.canResetAdministrator(baseline)).toBe(true);
        await state.openResetPassword(baseline);
        Object.assign(state.resetForm, { password: 'Reset1234', confirm_password: 'Reset1234' });
        await state.saveResetPassword();
        expect(mocks.post).toHaveBeenCalledWith('/admin/administrators/8/reset-password', { password: 'Reset1234' });
      } else if (operation === 'delete') {
        await state.deleteAdministrator(baseline);
        expect(mocks.delete).toHaveBeenCalledWith('/admin/administrators/8');
      }
    });
  }

  it('does not revive the retired account-promotion entry for a stale role-assignment grant', async () => {
    mocks.permissions = new Set(['administrators:read', 'administrators:assign_roles']);
    const state = await render();
    expect(wrappers.at(-1)!.findAll('button').map((button) => button.text())).not.toContain('为账号配置角色');
    expect(state.openAssignment).toBeUndefined();
    expect(mocks.get.mock.calls.map(([path]) => path)).toEqual(['/admin/administrators']);
  });

  it('does not treat the retired administrators write permission as a fine action grant', async () => {
    mocks.permissions = new Set(['administrators:read', 'administrators:write']);
    const state = await render();
    await state.openCreate();
    await state.openEdit(baseline);
    await state.openResetPassword(baseline);
    await state.deleteAdministrator(baseline);
    expect(mocks.get.mock.calls.every(([path]) => path === '/admin/administrators')).toBe(true);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('keeps self and super administrator reset protections for a reset-only actor', async () => {
    mocks.permissions = new Set(['administrators:read', 'administrators:reset_password']);
    const state = await render();
    expect(state.canResetAdministrator({ ...baseline, id: '7' })).toBe(false);
    expect(state.canResetAdministrator({ ...baseline, system_role: 'super_admin' })).toBe(false);
    mocks.isSuperAdmin = true;
    expect(state.canResetAdministrator({ ...baseline, system_role: 'super_admin' })).toBe(true);
  });
});
