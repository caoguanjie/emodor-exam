import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, KeepAlive, nextTick } from 'vue';
import ElementPlus, { ElMessageBox, ElTree } from 'element-plus';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import Roles from '../../views/admin/Roles.vue';
import type { RolePermissionTreeResponse } from '../../utils/role-permission-tree';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), permissions: new Set<string>() }));
vi.mock('../../api/http', () => ({ default: mocks }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (code: string) => mocks.permissions.has(code) }) }));

const baseline = {
  id: '8', code: 'internal_role', name: '角色基线', remark: '原备注', created_at: '2026-10-27T01:02:03Z',
  updated_at: '2026-10-27T01:02:03Z', is_system: false, status: 1, permissions: ['roles:read', 'statistics:export'],
};
const treeResponse: RolePermissionTreeResponse = {
  menus: [
    { id: 'system', parent_id: null, name: '系统设置', type: 'directory', permission_code: null, sort: 1, status: 1 },
    { id: 'roles', parent_id: 'system', name: '角色管理', type: 'menu', permission_code: 'roles:read', sort: 1, status: 1 },
    { id: 'create', parent_id: 'roles', name: '新增角色', type: 'button', permission_code: 'roles:create', sort: 1, status: 1 },
    { id: 'roles-copy', parent_id: 'system', name: '另一角色入口', type: 'menu', permission_code: 'roles:read', sort: 2, status: 0 },
  ],
  permissions: [
    { code: 'roles:read', name: '查看角色' },
    { code: 'roles:create', name: '新增角色' },
    { code: 'roles:update', name: '修改角色' },
    { code: 'roles:delete', name: '删除角色' },
    { code: 'statistics:export', name: '导出统计' },
  ],
};
const wrappers: VueWrapper[] = [];
const DialogContent = defineComponent({
  props: ['modelValue', 'title'],
  setup(props, { slots }) { return () => props.modelValue ? h('section', [slots.default?.(), slots.footer?.()]) : null; },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set(['roles:read', 'roles:create', 'roles:update', 'roles:delete', 'roles:permissions']);
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/admin/roles') return { items: [structuredClone(baseline)], total: 12, page: 1, page_size: 10 };
    if (path === '/admin/roles/8') return { ...structuredClone(baseline), name: '最新角色', remark: '最新备注' };
    if (path === '/admin/roles/permission-tree') return structuredClone(treeResponse);
    if (path === '/admin/permissions') return structuredClone(treeResponse.permissions);
    throw new Error(`Unexpected role GET ${path}`);
  });
  mocks.post.mockResolvedValue({});
  mocks.put.mockResolvedValue({});
  mocks.delete.mockResolvedValue({});
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>);
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});

async function render({ realTree = false, keepAlive = false, realList = false } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/admin/roles', component: Roles },
    { path: '/other', component: defineComponent({ render: () => h('div', '其它页面') }) },
  ] });
  await router.push('/admin/roles');
  const root = keepAlive ? defineComponent({
    setup() { return () => h(RouterView, null, { default: ({ Component }: any) => h(KeepAlive, null, [Component]) }); },
  }) : RouterView;
  const wrapper = mount(root, { global: {
    plugins: [ElementPlus, router],
    stubs: { ...(realList ? {} : { FitsTable: true }), ElDialog: realTree ? DialogContent : true },
  } });
  wrappers.push(wrapper);
  await flushPromises();
  const state = (wrapper.getComponent(Roles).vm.$ as any).setupState;
  return { wrapper, router, state };
}

describe('role metadata and independent permissions', () => {
  it('creates a role from a required name and optional remark without requiring a technical code or permissions', async () => {
    const { state } = await render();
    await state.openCreate();
    Object.assign(state.form, { name: ' 新角色 ', remark: ' 备注 ' });
    await state.save();
    expect(mocks.post).toHaveBeenCalledWith('/admin/roles', { name: '新角色', remark: '备注' });
  });

  it('reads fresh metadata and saves only name, remark, and status without overwriting permissions', async () => {
    const { state } = await render();
    await state.openEdit(baseline);
    expect(state.form.name).toBe('最新角色');
    expect(state.form.remark).toBe('最新备注');
    Object.assign(state.form, { name: ' 修改角色 ', remark: ' 修改备注 ', status: 0 });
    await state.save();
    expect(mocks.put).toHaveBeenCalledWith('/admin/roles/8', { name: '修改角色', remark: '修改备注', status: 0 });
    expect(state.dirty).toBe(false);
  });

  it('queries server pagination by role name and resets the page for a new search', async () => {
    const { state } = await render();
    expect(state.total).toBe(12);
    state.query.page = 3;
    state.query.keyword = ' 业务角色 ';
    await state.searchRoles();
    expect(mocks.get).toHaveBeenLastCalledWith('/admin/roles', { params: { page: 1, page_size: 10, keyword: '业务角色' } });
    expect(state.roles.map((row: { id: string }) => row.id)).toEqual(['8']);
    expect(mocks.get.mock.calls.some(([path]) => path === '/admin/permissions' || path === '/admin/menus')).toBe(false);
  });

  it('preserves existing permissions missing from menus and saves an explicit empty permissions array', async () => {
    const { state } = await render();
    await state.openPermissions(baseline);
    expect(state.permissionTarget.name).toBe('最新角色');
    expect(state.selectedPermissions).toEqual(['roles:read', 'statistics:export']);
    await state.savePermissions();
    expect(mocks.put).toHaveBeenLastCalledWith('/admin/roles/8/permissions', { permissions: ['roles:read', 'statistics:export'] });
    await state.openPermissions(baseline);
    state.clearPermissions();
    await state.savePermissions();
    expect(mocks.put).toHaveBeenLastCalledWith('/admin/roles/8/permissions', { permissions: [] });
  });

  it('shows a partial parent for read-only selection and synchronizes shared permission removal in the real tree', async () => {
    const { state, wrapper } = await render({ realTree: true });
    await state.openPermissions(baseline);
    await flushPromises();
    const tree = wrapper.getComponent(ElTree);
    const treeApi = tree.vm as any;
    const roleModule = state.permissionTree[0].children.find((node: any) => node.label === '角色管理');
    expect(treeApi.getHalfCheckedKeys()).toContain(roleModule.id);
    const readNodes = state.permissionTree[0].children.flatMap((node: any) => node.children || []).filter((node: any) => node.permissionCode === 'roles:read');
    expect(readNodes).toHaveLength(2);
    expect(treeApi.getCheckedKeys(true)).toEqual(expect.arrayContaining(readNodes.map((node: any) => node.id)));
    tree.vm.$emit('check', readNodes[0], { checkedKeys: [] });
    await nextTick();
    expect(state.selectedPermissions).toEqual(['statistics:export']);
    expect(treeApi.getCheckedKeys(true)).not.toEqual(expect.arrayContaining([readNodes[1].id]));
  });

  it('checks and unchecks a parent through the real tree without adding a directory grant', async () => {
    const { state, wrapper } = await render({ realTree: true });
    await state.openPermissions(baseline);
    await flushPromises();
    const tree = wrapper.getComponent(ElTree);
    const parent = tree.findAll('.el-tree-node__content').find((node) => node.text() === '角色管理')!;
    await parent.get('input[type="checkbox"]').setValue(true);
    await flushPromises();
    expect(state.selectedPermissions).toEqual(['roles:create', 'roles:delete', 'roles:read', 'roles:update', 'statistics:export']);
    await parent.get('input[type="checkbox"]').setValue(false);
    await flushPromises();
    expect(state.selectedPermissions).toEqual(['statistics:export']);
  });

  it('keeps the permission draft on cancel and blocks repeated permission saves or navigation until the receipt arrives', async () => {
    const pending = deferred<{}>();
    mocks.put.mockReturnValue(pending.promise);
    const { state, router } = await render();
    await state.openPermissions(baseline);
    state.clearPermissions();
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel');
    await state.closePermissionsDialog();
    expect(state.permissionsDialog).toBe(true);
    expect(state.selectedPermissions).toEqual([]);
    const saving = state.savePermissions();
    await state.savePermissions();
    await state.closePermissionsDialog();
    await state.openEdit(baseline);
    await router.push('/other');
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe('/admin/roles');
    expect(state.permissionsDialog).toBe(true);
    pending.resolve({});
    await saving;
    expect(state.permissionsDialog).toBe(false);
    expect(state.permissionDirty).toBe(false);
  });

  it('keeps an unsaved permission draft after a rejected write', async () => {
    const { state, wrapper } = await render({ realTree: true });
    await state.openPermissions(baseline);
    state.clearPermissions();
    mocks.put.mockRejectedValueOnce(new Error('save failed'));
    await expect(state.savePermissions()).rejects.toThrow('save failed');
    expect(state.permissionsDialog).toBe(true);
    expect(state.selectedPermissions).toEqual([]);
    expect(state.permissionDirty).toBe(true);
    expect(state.permissionSaving).toBe(false);
    await flushPromises();
    const parent = wrapper.getComponent(ElTree).findAll('.el-tree-node__content').find((node) => node.text() === '角色管理')!;
    await parent.get('input[type="checkbox"]').setValue(true);
    await flushPromises();
    expect(state.selectedPermissions).toEqual(['roles:create', 'roles:delete', 'roles:read', 'roles:update']);
  });

  it('ignores an older metadata response after another role edit has started', async () => {
    const first = deferred<typeof baseline>();
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/admin/roles') return { items: [structuredClone(baseline)], total: 1, page: 1, page_size: 10 };
      if (path === '/admin/roles/8') return first.promise;
      if (path === '/admin/roles/9') return { ...structuredClone(baseline), id: '9', name: '后打开角色', remark: '后打开备注' };
      throw new Error(`Unexpected role GET ${path}`);
    });
    const { state } = await render();
    const openingFirst = state.openEdit(baseline);
    await flushPromises();
    await state.openEdit({ ...baseline, id: '9' });
    first.resolve({ ...baseline, name: '迟到角色' });
    await openingFirst;
    expect(state.form.id).toBe('9');
    expect(state.form.name).toBe('后打开角色');
    expect(state.form.remark).toBe('后打开备注');
  });

  it('blocks repeated saves, draft replacement, and navigation while metadata saving is pending', async () => {
    const pending = deferred<{}>();
    mocks.put.mockReturnValue(pending.promise);
    const { state, router } = await render();
    await state.openEdit(baseline);
    state.form.remark = '保存中备注';
    const saving = state.save();
    await state.save();
    await state.openCreate();
    await state.closeDialog();
    await router.push('/other');
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe('/admin/roles');
    expect(state.form.id).toBe('8');
    expect(state.dialog).toBe(true);
    pending.resolve({});
    await saving;
    expect(state.dialog).toBe(false);
    expect(state.dirty).toBe(false);
  });

  it('fetches a cached list again on return without making a duplicate first-mount request', async () => {
    const { router } = await render({ keepAlive: true });
    expect(mocks.get.mock.calls.filter(([path]) => path === '/admin/roles')).toHaveLength(1);
    await router.push('/other');
    await router.push('/admin/roles');
    await flushPromises();
    expect(mocks.get.mock.calls.filter(([path]) => path === '/admin/roles')).toHaveLength(2);
  });

  it('ignores permission details that arrive after leaving and returning to the cached page', async () => {
    const pending = deferred<typeof baseline>();
    const get = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path: string, options?: unknown) => path === '/admin/roles/8' ? pending.promise : get(path, options));
    const { state, router } = await render({ keepAlive: true });
    const opening = state.openPermissions(baseline);
    await flushPromises();
    await router.push('/other');
    await router.push('/admin/roles');
    await flushPromises();
    await state.openCreate();
    state.form.remark = '新草稿';
    pending.resolve({ ...baseline, name: '迟到权限角色' });
    await opening;
    expect(state.permissionsDialog).toBe(false);
    expect(state.dialog).toBe(true);
    expect(state.form.remark).toBe('新草稿');
    expect(state.dirty).toBe(true);
  });

  it('deletes only after confirmation and queries the previous page when the last row is removed', async () => {
    const { state } = await render();
    state.query.page = 2;
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel');
    await state.deleteRole(baseline);
    expect(mocks.delete).not.toHaveBeenCalled();
    await state.deleteRole(baseline);
    expect(mocks.delete).toHaveBeenCalledWith('/admin/roles/8');
    expect(mocks.get).toHaveBeenLastCalledWith('/admin/roles', { params: { page: 1, page_size: 10, keyword: '' } });
  });

  it('keeps system role permissions read-only and blocks system role metadata or deletion', async () => {
    const systemRole = { ...baseline, is_system: true };
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/admin/roles') return { items: [systemRole], total: 1, page: 1, page_size: 10 };
      if (path === '/admin/roles/8') return structuredClone(systemRole);
      if (path === '/admin/roles/permission-tree') return structuredClone(treeResponse);
      throw new Error(`Unexpected role GET ${path}`);
    });
    const { state } = await render();
    await state.openEdit(systemRole);
    await state.deleteRole(systemRole);
    await state.openPermissions(systemRole);
    expect(state.permissionsDialog).toBe(true);
    state.clearPermissions();
    await state.savePermissions();
    expect(state.selectedPermissions).toEqual(['roles:read', 'statistics:export']);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('renders a read-only list and refuses every unauthorized write method', async () => {
    mocks.permissions = new Set(['roles:read']);
    const { state, wrapper } = await render({ realList: true });
    await state.openCreate();
    await state.openEdit(baseline);
    await state.openPermissions(baseline);
    await state.deleteRole(baseline);
    expect(wrapper.text()).toContain('角色基线');
    expect(wrapper.text()).toContain('2026-10-27 09:02');
    expect(wrapper.text()).not.toContain('新增角色');
    expect(wrapper.text()).not.toContain('权限设置');
    expect(wrapper.text()).not.toContain('internal_role');
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
