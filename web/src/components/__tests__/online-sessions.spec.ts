import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import ElementPlus from 'element-plus';
import OnlineSessions from '../../views/admin/OnlineSessions.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), confirm: vi.fn(), success: vi.fn(), logoutLocal: vi.fn(), permissions: new Set<string>() }));
vi.mock('../../api/http', () => ({ default: { get: mocks.get, post: mocks.post } }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (permission: string) => mocks.permissions.has(permission), logoutLocal: mocks.logoutLocal }) }));
vi.mock('element-plus', async original => ({ ...await original<typeof import('element-plus')>(), ElMessage: { success: mocks.success }, ElMessageBox: { confirm: mocks.confirm } }));

const record = (overrides = {}) => ({
  id: '88', sid: 'current-session', user_id: '1', username: 'admin', real_name: '超级管理员', client: 'pc',
  user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  ip_address: '127.0.0.1', created_at: '2026-10-27T05:28:44.005Z', last_seen_at: '2026-10-27T06:01:00Z',
  revoked_at: null, expires_at: '2026-11-03T05:28:44.005Z', status: 'active', is_current: true, ...overrides,
});
const wrappers: VueWrapper[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-27T06:04:00Z').getTime());
  mocks.permissions = new Set(['sessions:read', 'sessions:write']);
  mocks.get.mockResolvedValue({ items: [record(), record({ id: '89', is_current: false })], total: 42, page: 1, page_size: 20 });
  mocks.confirm.mockResolvedValue('confirm'); mocks.post.mockResolvedValue(null);
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); });

async function render(cached = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] });
  await router.push('/admin/sessions'); await router.isReady();
  const active = ref(true);
  const subject = cached ? defineComponent({ components: { OnlineSessions }, setup: () => ({ active }), template: '<KeepAlive><OnlineSessions v-if="active" /></KeepAlive>' }) : OnlineSessions;
  const wrapper = mount(subject, { attachTo: document.body, global: { plugins: [router, ElementPlus] } });
  wrappers.push(wrapper); await flushPromises();
  const state = (wrapper.getComponent(OnlineSessions).vm.$ as any).setupState;
  return { wrapper, state, router, active };
}

describe('online session maintenance', () => {
  it('defaults to valid sessions and presents account, readable device and Shanghai dates', async () => {
    const { wrapper } = await render();
    expect(mocks.get.mock.calls[0][1].params).toEqual({ page: 1, page_size: 20, status: 'active' });
    expect(wrapper.text()).toContain('超级管理员'); expect(wrapper.text()).toContain('admin');
    expect(wrapper.text()).toContain('电脑 · Chrome / macOS');
    expect(wrapper.text()).toContain('2026-10-27 13:28:44'); expect(wrapper.text()).toContain('3 分钟前');
    expect(wrapper.text()).not.toContain('2026-10-27T05:28');
    expect(wrapper.findAll('.current-session')).toHaveLength(1);
    expect(wrapper.text()).toContain('有效'); expect(wrapper.text()).not.toContain('在线');
  });

  it('searches and resets on page one while refresh preserves the last applied filters', async () => {
    const { state } = await render();
    state.page = 3; state.filters.keyword = ' admin '; state.filters.status = 'all';
    await state.search();
    expect(mocks.get.mock.calls.at(-1)![1].params).toEqual({ page: 1, page_size: 20, status: 'all', keyword: 'admin' });
    state.filters.keyword = 'unsubmitted'; state.filters.status = 'revoked'; await state.load();
    expect(mocks.get.mock.calls.at(-1)![1].params).toEqual({ page: 1, page_size: 20, status: 'all', keyword: 'admin' });
    await state.reset();
    expect(mocks.get.mock.calls.at(-1)![1].params).toEqual({ page: 1, page_size: 20, status: 'active' });
  });

  it('discards an older request and its loading finalizer after a new search starts', async () => {
    const { state } = await render();
    let resolveOld!: (value: unknown) => void; let resolveNew!: (value: unknown) => void;
    mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
    const older = state.load(); state.filters.keyword = 'latest'; const newer = state.search();
    resolveOld({ items: [record({ username: 'old' })], total: 1 }); await older;
    expect(state.loading).toBe(true); expect(state.rows[0].username).toBe('admin');
    resolveNew({ items: [record({ username: 'latest' })], total: 1 }); await newer;
    expect(state.rows[0].username).toBe('latest'); expect(state.loading).toBe(false);
  });

  it('returns to page one when Element Plus updates the page size before its change event', async () => {
    const { wrapper, state } = await render(); state.page = 3;
    mocks.get.mockClear(); mocks.get.mockResolvedValue({ items: [record()], total: 500 });
    const pagination = wrapper.getComponent({ name: 'ElPagination' });
    pagination.vm.$emit('update:page-size', 50);
    pagination.vm.$emit('size-change', 50);
    pagination.vm.$emit('change', 3, 50);
    await flushPromises();
    expect(mocks.get.mock.calls.at(-1)![1].params).toEqual({ page: 1, page_size: 50, status: 'active' });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('sends only one search when Enter also triggers the browser form submission', async () => {
    const { wrapper } = await render(); mocks.get.mockClear();
    await wrapper.get('input[aria-label="搜索账号或姓名"]').setValue('admin');
    await wrapper.get('input[aria-label="搜索账号或姓名"]').trigger('keyup', { key: 'Enter' });
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0][1].params.keyword).toBe('admin');
  });

  it('keeps list errors distinct from a successful empty result and allows retry', async () => {
    mocks.get.mockRejectedValueOnce(new Error('会话暂不可用'));
    const { wrapper, state } = await render();
    expect(wrapper.get('[role="alert"]').text()).toContain('会话暂不可用');
    expect(wrapper.find('.el-empty').exists()).toBe(false);
    mocks.get.mockResolvedValueOnce({ items: [], total: 0 }); await state.load();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false); expect(wrapper.find('.el-empty').exists()).toBe(true);
  });

  it('renders expired and revoked separately and falls back for missing accounts and user agents', async () => {
    mocks.get.mockResolvedValueOnce({ items: [record({ username: null, real_name: null, user_agent: null, status: 'expired', is_current: false }), record({ id: '89', status: 'revoked', is_current: false })], total: 2 });
    const { wrapper } = await render();
    expect(wrapper.text()).toContain('账号信息缺失'); expect(wrapper.text()).toContain('已过期'); expect(wrapper.text()).toContain('已下线');
    expect(wrapper.text()).toContain('未知浏览器');
    expect(wrapper.findAll('button').some(button => button.text() === '强制下线')).toBe(false);
  });

  it('blocks read-only actors from sending revoke requests', async () => {
    mocks.permissions.delete('sessions:write'); const { wrapper, state } = await render();
    expect(wrapper.findAll('button').some(button => button.text() === '强制下线')).toBe(false);
    await state.revoke(record()); expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('names the account and device in the confirmation and sends nothing when cancelled', async () => {
    mocks.confirm.mockRejectedValueOnce('cancel'); const { state } = await render();
    await state.revoke(record());
    expect(mocks.confirm.mock.calls[0][0]).toContain('admin'); expect(mocks.confirm.mock.calls[0][0]).toContain('Chrome / macOS');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('prevents duplicate revoke submissions while a confirmation or request is pending', async () => {
    let resolveConfirm!: () => void; mocks.confirm.mockImplementationOnce(() => new Promise<void>(resolve => { resolveConfirm = resolve; }));
    const { state } = await render(); const pending = state.revoke(record({ is_current: false }));
    await state.revoke(record({ is_current: false })); expect(mocks.confirm).toHaveBeenCalledTimes(1);
    resolveConfirm(); await pending; expect(mocks.post).toHaveBeenCalledTimes(1); expect(mocks.logoutLocal).not.toHaveBeenCalled();
  });

  it('clears login only when revoking the exact current session', async () => {
    const { state, router } = await render(); await state.revoke(record()); await flushPromises();
    expect(mocks.post).toHaveBeenCalledWith('/admin/sessions/88/revoke'); expect(mocks.logoutLocal).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('loads once on initial cached activation and discards responses after leaving', async () => {
    const { state, active } = await render(true); expect(mocks.get).toHaveBeenCalledTimes(1);
    let resolvePending!: (value: unknown) => void; mocks.get.mockImplementationOnce(() => new Promise(resolve => { resolvePending = resolve; }));
    const pending = state.load(); active.value = false; await flushPromises();
    resolvePending({ items: [record({ username: 'late' })], total: 1 }); await pending;
    expect(state.rows[0].username).toBe('admin'); expect(state.loading).toBe(false);
    active.value = true; await flushPromises(); expect(mocks.get).toHaveBeenCalledTimes(3);
  });
});
