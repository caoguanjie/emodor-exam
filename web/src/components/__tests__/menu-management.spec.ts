import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { defineComponent, h, KeepAlive } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import Menus from '../../views/admin/Menus.vue';
import MainLayout from '../../layouts/MainLayout.vue';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), confirm: vi.fn(),
  success: vi.fn(), warning: vi.fn(), permissions: new Set<string>(),
  tabs: { tabs: [], visit: vi.fn() },
}));
vi.mock('../../api/http', () => ({ default: { get: mocks.get, post: mocks.post, put: mocks.put, delete: mocks.delete } }));
vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ user: { id: '7', real_name: '管理员', role: 'regulation_admin' }, isAdmin: true, isSuperAdmin: false, can: (code: string) => mocks.permissions.has(code) }),
}));
vi.mock('../../stores/tabs', () => ({ useTabsStore: () => mocks.tabs }));
vi.mock('../../services/media-content', () => ({ resolvePublicBranding: () => '/branding-test.png' }));
vi.mock('element-plus', async (original) => ({
  ...await original<typeof import('element-plus')>(),
  ElMessage: { success: mocks.success, warning: mocks.warning },
  ElMessageBox: { confirm: mocks.confirm },
}));

interface MenuRow {
  id: string; parent_id: string | null; name: string; type: 'directory' | 'menu' | 'button';
  route_path: string | null; permission_code: string | null; icon: string | null; sort: number; status: number; children: MenuRow[];
}
const node = (overrides: Partial<MenuRow> = {}): MenuRow => ({
  id: '11', parent_id: '10', name: '旧菜单名称', type: 'menu', route_path: '/admin/students',
  permission_code: 'students:read', icon: 'User', sort: 10, status: 1, children: [], ...overrides,
});
let serverRows: MenuRow[];
let details: Record<string, MenuRow>;
const wrappers: VueWrapper[] = [];
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const Dialog = defineComponent({
  props: ['modelValue'],
  setup(props, { slots }) { return () => props.modelValue ? h('section', { 'data-test': 'menu-dialog' }, [slots.default?.(), slots.footer?.()]) : null; },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permissions = new Set(['menus:read', 'menus:create', 'menus:update', 'menus:delete']);
  mocks.confirm.mockResolvedValue('confirm');
  serverRows = [node({ id: '10', parent_id: null, name: '学习管理', type: 'directory', route_path: null, permission_code: null, icon: 'Reading', children: [
    node({ children: [node({ id: '13', parent_id: '11', name: '孙菜单' })] }),
    node({ id: '12', name: '另一菜单', route_path: '/admin/courses' }),
  ] })];
  details = { '11': node({ name: '最新菜单名称', sort: 30 }), '12': node({ id: '12', name: '另一个最新菜单', route_path: '/admin/courses' }) };
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/admin/menus') return copy(serverRows);
    if (path === '/admin/menus/permission-options') return [
      { code: 'students:read', name: '查看学员' }, { code: 'students:write', name: '维护学员' },
    ];
    if (/^\/admin\/menus\/\d+$/.test(path)) return copy(details[path.split('/').at(-1)!]);
    if (path === '/admin/menus/navigation') return [node({ id: '10', parent_id: null, name: '系统设置', type: 'directory', route_path: null, permission_code: null, children: [
      node({ route_path: '/admin/system/menus', name: '菜单配置', permission_code: 'menus:read' }),
    ] })];
    if (path === '/site-config') return { logo_asset_id: null, banners: [] };
    throw new Error('Unexpected menu GET ' + path);
  });
  mocks.post.mockResolvedValue({});
  mocks.put.mockResolvedValue({});
  mocks.delete.mockResolvedValue({});
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

async function render(withLayout = false, realDialog = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: withLayout ? [{
    path: '/', component: MainLayout, children: [
      { path: 'admin/system/menus', component: Menus, meta: { title: '菜单配置', cache: true } },
      { path: 'other', component: { render: () => h('div', '其他页') } },
    ],
  }] : [
    { path: '/admin/system/menus', component: Menus },
    { path: '/other', component: { render: () => h('div', '其他页') } },
  ] });
  await router.push('/admin/system/menus');
  await router.isReady();
  const Root = withLayout ? RouterView : defineComponent({ render: () => h(RouterView, null, {
    default: ({ Component }: any) => h(KeepAlive, null, () => Component ? h(Component) : null),
  }) });
  const wrapper = mount(Root, { global: { plugins: [ElementPlus, router], stubs: { ElDialog: realDialog ? false : Dialog, MediaUpload: true, BusinessTabs: true } } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router, state: (wrapper.getComponent(Menus).vm.$ as any).setupState };
}

describe('menu maintenance', () => {
  it.each([
    ['孙菜单', '13'],
    ['  /ADMIN/COURSES  ', '12'],
    ['COURSES:PUBLISH', '12'],
  ])('queries menu names, URLs and permission codes while retaining ancestors: %s', async (keyword, matchedId) => {
    serverRows[0]!.children[1]!.permission_code = 'courses:publish';
    const { wrapper, state } = await render();
    const search = wrapper.get('[aria-label="查询条件"]');
    const reads = mocks.get.mock.calls.length;
    await search.get('input').setValue(keyword);
    expect(state.visibleRows[0].children).toHaveLength(2);
    await search.findAll('button').find((button) => button.text() === '查询')!.trigger('click');
    await flushPromises();
    const ids = (rows: MenuRow[]): string[] => rows.flatMap((row) => [row.id, ...ids(row.children || [])]);
    expect(ids(state.visibleRows)).toEqual(matchedId === '13' ? ['10', '11', '13'] : ['10', '12']);
    expect(ids(state.rows)).toEqual(['10', '11', '13', '12']);
    expect(JSON.stringify(state.parentOptions)).toContain('孙菜单');
    expect(mocks.get).toHaveBeenCalledTimes(reads);
  });

  it('queries on Enter, shows an empty result and resets the complete tree', async () => {
    const { wrapper, state } = await render();
    const search = wrapper.get('[aria-label="查询条件"]');
    await search.get('input').setValue('不存在的菜单');
    await search.get('input').trigger('keyup', { key: 'Enter' });
    await flushPromises();
    expect(state.visibleRows).toEqual([]);
    expect(wrapper.text()).toContain('未找到匹配的菜单');
    await search.findAll('button').find((button) => button.text() === '重置')!.trigger('click');
    await flushPromises();
    expect((search.get('input').element as HTMLInputElement).value).toBe('');
    expect(state.visibleRows).toEqual(state.rows);
  });

  it('shows a matched directory with its complete subtree and expands it after a collapsed view', async () => {
    const { wrapper, state } = await render();
    state.toggleExpanded();
    expect(state.expanded).toBe(false);
    const search = wrapper.get('[aria-label="查询条件"]');
    await search.get('input').setValue('学习管理');
    await search.findAll('button').find((button) => button.text() === '查询')!.trigger('click');
    await flushPromises();
    expect(state.expanded).toBe(true);
    expect(state.visibleRows).toEqual(state.rows);
    const row = wrapper.findAll('.el-table__row').find((row) => row.text().includes('孙菜单'))!;
    expect(row.attributes('style') || '').not.toContain('display: none');
  });

  it.each(['create', 'edit'])('keeps the %s dialog outside the scrolled list and inside the content region', async (mode) => {
    const { wrapper, state } = await render(true, true);
    const main = wrapper.get('.main').element as HTMLElement;
    main.scrollTop = 600;
    if (mode === 'create') await state.openCreate();
    else await state.openEdit(serverRows[0]!.children[0]);
    await flushPromises();
    const host = wrapper.get('.content-dialog-host');
    expect(host.find('.menu-dialog').exists()).toBe(true);
    expect(main.querySelector('.menu-dialog')).toBeNull();
    expect(host.get('.menu-dialog').classes()).toContain('is-align-center');
    expect(main.scrollTop).toBe(600);
    await state.closeDialog();
  });

  it('edits the latest detail and excludes its complete branch from parent choices', async () => {
    const { state } = await render();
    await state.openEdit(serverRows[0]!.children[0]);
    expect(mocks.get).toHaveBeenCalledWith('/admin/menus/11');
    expect(state.form.name).toBe('最新菜单名称');
    expect(state.form.sort).toBe(30);
    const flatten = (items: { value: string; children?: any[] }[]): string[] => items.flatMap((item) => [item.value, ...flatten(item.children || [])]);
    expect(flatten(state.parentOptions)).toEqual(['10', '12']);
    state.form.name = ' 更新后的菜单 ';
    await state.save();
    expect(mocks.put).toHaveBeenCalledWith('/admin/menus/11', {
      parent_id: '10', name: '更新后的菜单', type: 'menu', route_path: '/admin/students',
      permission_code: 'students:read', icon: 'User', sort: 30, status: 1,
    });
  });

  it('keeps a cancelled draft, then discards it without writing', async () => {
    const { state } = await render();
    await state.openCreate();
    state.form.name = '未保存菜单';
    mocks.confirm.mockRejectedValueOnce('cancel');
    await state.closeDialog();
    expect(state.dialogVisible).toBe(true);
    expect(state.form.name).toBe('未保存菜单');
    await state.closeDialog();
    expect(state.dialogVisible).toBe(false);
    expect(state.form.name).toBe('');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('sends one update and blocks closing or leaving while even an unchanged edit is saving', async () => {
    const { state, router } = await render();
    await state.openEdit(serverRows[0]!.children[0]);
    const receipt = deferred<object>();
    mocks.put.mockReturnValue(receipt.promise);
    const save = state.save();
    const duplicate = state.save();
    expect(mocks.put).toHaveBeenCalledTimes(1);
    await state.closeDialog();
    expect(state.dialogVisible).toBe(true);
    await router.push('/other');
    expect(router.currentRoute.value.path).toBe('/admin/system/menus');
    receipt.resolve({});
    await Promise.all([save, duplicate]);
    await router.push('/other');
    expect(router.currentRoute.value.path).toBe('/other');
  });

  it('ignores an edit detail that arrives after cancellation and opening another node', async () => {
    const { state } = await render();
    const first = deferred<MenuRow>();
    const normalGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path) => path === '/admin/menus/11' ? first.promise : normalGet(path));
    const opening = state.openEdit(serverRows[0]!.children[0]);
    await flushPromises();
    await state.closeDialog();
    await state.openEdit(serverRows[0]!.children[1]);
    first.resolve(node({ name: '过时的详情' }));
    await opening;
    expect(state.form.id).toBe('12');
    expect(state.form.name).toBe('另一个最新菜单');
  });

  it('restarts an invalidated read when a cached menu page returns and ignores the departed response', async () => {
    const first = deferred<MenuRow[]>();
    const normalGet = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path) => path === '/admin/menus' ? first.promise : normalGet(path));
    const { state, router } = await render();
    expect(mocks.get.mock.calls.filter(([path]) => path === '/admin/menus')).toHaveLength(1);
    await router.push('/other');
    const next = deferred<MenuRow[]>();
    mocks.get.mockImplementation((path) => path === '/admin/menus' ? next.promise : normalGet(path));
    await router.push('/admin/system/menus');
    await flushPromises();
    expect(mocks.get.mock.calls.filter(([path]) => path === '/admin/menus')).toHaveLength(2);
    next.resolve([node({ name: '返回后的菜单' })]); await flushPromises();
    first.resolve([]); await flushPromises();
    expect(state.rows[0].name).toBe('返回后的菜单');
    expect(state.loading).toBe(false);
  });

  for (const permissions of [['menus:read'], ['roles:read', 'roles:write'], ['menus:update'], ['menus:read', 'system_settings:write']]) {
    it('guards writes and does not obtain editor choices without the matching menu permissions: ' + permissions.join(','), async () => {
      mocks.permissions = new Set(permissions);
      const { state, wrapper } = await render();
      expect(wrapper.findAll('button').some((button) => button.text() === '新增菜单')).toBe(false);
      await state.openCreate();
      await state.openEdit(node());
      await state.remove(node());
      Object.assign(state.form, { name: '禁止写入', type: 'menu', route_path: '/admin/students' });
      await state.save();
      expect(mocks.post).not.toHaveBeenCalled();
      expect(mocks.put).not.toHaveBeenCalled();
      expect(mocks.delete).not.toHaveBeenCalled();
      expect(mocks.get.mock.calls.some(([path]) => path === '/admin/menus/permission-options' || path === '/admin/menus/11')).toBe(false);
      if (!permissions.includes('menus:read')) expect(mocks.get).not.toHaveBeenCalled();
    });
  }

  it('accepts only registered route and permission choices, then removes fields disallowed by node type', async () => {
    const { state } = await render();
    await state.openCreate();
    Object.assign(state.form, { name: '新菜单', route_path: '/admin/unregistered', permission_code: 'students:read' });
    await state.save();
    expect(mocks.post).not.toHaveBeenCalled();
    Object.assign(state.form, { route_path: '/admin/students', permission_code: 'invented:write' });
    await state.save();
    expect(mocks.post).not.toHaveBeenCalled();
    Object.assign(state.form, { type: 'button', permission_code: null });
    await state.save();
    expect(mocks.post).not.toHaveBeenCalled();
    Object.assign(state.form, { type: 'directory', permission_code: 'students:read', route_path: '/admin/students', icon: 'Setting' });
    await state.save();
    expect(mocks.post).toHaveBeenCalledWith('/admin/menus', {
      parent_id: null, name: '新菜单', type: 'directory', route_path: null, permission_code: null, icon: 'Setting', sort: 0, status: 1,
    });
  });

  it('does not delete on cancellation or after a late confirmation belongs to a departed page', async () => {
    const { state, router } = await render();
    mocks.confirm.mockRejectedValueOnce('cancel');
    await state.remove(node());
    expect(mocks.delete).not.toHaveBeenCalled();
    const decision = deferred<string>();
    mocks.confirm.mockReturnValueOnce(decision.promise);
    const deletion = state.remove(node());
    await router.push('/other');
    decision.resolve('confirm'); await deletion;
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('refreshes authorized navigation after a saved menu and removes the listener on shell unmount', async () => {
    const { state, wrapper } = await render(true);
    const before = mocks.get.mock.calls.filter(([path]) => path === '/admin/menus/navigation').length;
    await state.openEdit(serverRows[0]!.children[0]);
    state.form.name = '保存菜单';
    await state.save(); await flushPromises();
    expect(mocks.get.mock.calls.filter(([path]) => path === '/admin/menus/navigation')).toHaveLength(before + 1);
    const after = mocks.get.mock.calls.length;
    wrapper.unmount();
    window.dispatchEvent(new CustomEvent('re:admin-menus-changed'));
    await flushPromises();
    expect(mocks.get).toHaveBeenCalledTimes(after);
    expect([...mocks.permissions]).toEqual(['menus:read', 'menus:create', 'menus:update', 'menus:delete']);
  });

  for (const operation of ['create', 'update', 'delete'] as const) {
    it('limits the menu ' + operation + '-only actor to its own button and operation', async () => {
      mocks.permissions = new Set(['menus:read', 'menus:' + operation]);
      const { state, wrapper } = await render();
      const labels = () => wrapper.findAll('button').map((button) => button.text());
      expect(labels().includes('新增菜单')).toBe(operation === 'create');
      expect(labels().includes('修改')).toBe(operation === 'update');
      expect(labels().includes('删除')).toBe(operation === 'delete');
      if (operation !== 'create') await state.openCreate();
      if (operation !== 'update') await state.openEdit(node());
      if (operation !== 'delete') await state.remove(node());
      expect(mocks.post).not.toHaveBeenCalled();
      expect(mocks.put).not.toHaveBeenCalled();
      expect(mocks.delete).not.toHaveBeenCalled();
      expect(mocks.get.mock.calls.some(([path]) => path === '/admin/menus/permission-options')).toBe(false);
      if (operation === 'create') {
        await state.openCreate();
        Object.assign(state.form, { name: '仅可新增', type: 'directory' });
        await state.save();
        expect(mocks.post).toHaveBeenCalledTimes(1);
      } else if (operation === 'update') {
        await state.openEdit(node());
        state.form.name = '仅可修改';
        await state.save();
        expect(mocks.put).toHaveBeenCalledTimes(1);
      } else {
        await state.remove(node({ id: '12' }));
        expect(mocks.delete).toHaveBeenCalledWith('/admin/menus/12');
        expect(mocks.get.mock.calls.some(([path]) => path === '/admin/menus/permission-options')).toBe(false);
      }
    });
  }
});
