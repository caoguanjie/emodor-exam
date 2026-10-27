import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import AuditLogs from '../../views/admin/AuditLogs.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../api/http', () => ({ default: { get: mocks.get } }));

const rows = [
  {
    ts: '2026-10-27T06:19:50.000Z', actor_id: 1, actor_name: 'admin',
    action: 'system.menu.update', object_type: 'sys_menu', object_id: '49',
    detail: { name: '审计日志', changes: { name: { before: '旧名称', after: '审计日志' } } },
    result: 'success', source_ip: '127.0.0.1',
  },
  {
    ts: '2026-10-27T06:18:50.000Z', actor_id: 5, actor_name: 'system',
    action: 'access.role.update', object_type: 'sys_role', object_id: '5', detail: {},
    result: 'success', source_ip: null,
  },
];

const wrappers: VueWrapper[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ items: rows, total: 2, page: 1, page_size: 20 });
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

async function render() {
  const wrapper = mount(AuditLogs, { attachTo: document.body, global: { plugins: [ElementPlus] } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, state: (wrapper.vm.$ as any).setupState };
}

describe('audit operation records', () => {
  it('defaults to management records and renders business language instead of raw fields', async () => {
    const { wrapper } = await render();
    expect(mocks.get).toHaveBeenCalledWith('/admin/audit-logs', {
      params: expect.objectContaining({ scope: 'management', page: 1, page_size: 20 }),
    });
    expect(wrapper.text()).toContain('系统设置');
    expect(wrapper.text()).toContain('修改菜单');
    expect(wrapper.text()).toContain('菜单“审计日志”');
    expect(wrapper.text()).toContain('用户 #5（历史记录）');
    expect(wrapper.text()).not.toContain('system.menu.update');
    expect(wrapper.text()).not.toContain('sys_menu');
    expect(wrapper.text()).not.toContain('{"name"');
    expect(wrapper.find('.fits-table__actions').exists()).toBe(false);
  });

  it('uses the shared table action and content dialog for on-demand details', async () => {
    const { wrapper } = await render();
    const detailButton = wrapper.findAll('button').find((button) => button.text() === '查看');
    expect(detailButton).toBeDefined();
    expect(detailButton!.classes()).toContain('fits-table-action');
    expect(detailButton!.element.closest('.fits-table-actions')).not.toBeNull();
    await detailButton!.trigger('click');
    await flushPromises();
    expect(document.body.querySelector('.audit-detail-dialog')).not.toBeNull();
    expect(document.body.querySelector('.el-drawer')).toBeNull();
    expect(document.body.textContent).toContain('记录详情');
    expect(document.body.textContent).toContain('127.0.0.1');
    expect(document.body.textContent).toContain('system.menu.update');
    expect(document.body.textContent).toContain('旧名称');
    expect(document.body.textContent).toContain('审计日志');
  });

  it('applies the selected record scope and result from page one', async () => {
    const { state } = await render();
    mocks.get.mockClear();
    state.query.page = 4;
    state.query.scope = 'security';
    state.query.result = 'failure';
    await state.search();
    expect(mocks.get).toHaveBeenCalledWith('/admin/audit-logs', {
      params: expect.objectContaining({ scope: 'security', result: 'failure', page: 1 }),
    });
  });

  it('keeps the attempted account visible for an unauthenticated login failure', async () => {
    mocks.get.mockResolvedValueOnce({ items: [
      { ts: '2026-10-27T06:20:00.000Z', actor_id: null, actor_name: 'ghost', action: 'auth.login', object_type: 'sys_user', object_id: null, detail: { reason: 'bad_credentials' }, result: 'failure', source_ip: '10.0.0.8' },
    ], total: 1, page: 1, page_size: 20 });
    const { wrapper } = await render();
    expect(wrapper.text()).toContain('未认证账号“ghost”');
    expect(wrapper.text()).not.toContain('系统任务');

    const detailButton = wrapper.findAll('button').find((button) => button.text() === '查看');
    await detailButton!.trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('原始操作人');
    expect(document.body.textContent).toContain('ghost');
  });

  it('distinguishes ordinary session revocation from an administrator force-revoke', async () => {
    mocks.get.mockResolvedValueOnce({ items: [
      { ts: '2026-10-27T06:19:00.000Z', actor_id: 5, actor_name: 'admin', action: 'auth.session.force_revoke', object_type: 'auth_session', object_id: '88', detail: { user_id: '17' }, result: 'success', source_ip: '127.0.0.1' },
      { ts: '2026-10-27T06:18:00.000Z', actor_id: 17, actor_name: 'user:17', action: 'auth.session.revoke', object_type: 'auth_session', object_id: '89', detail: { user_id: '17' }, result: 'success', source_ip: null },
    ], total: 2, page: 1, page_size: 20 });
    const { wrapper } = await render();
    expect(wrapper.text()).toContain('强制下线');
    expect(wrapper.text()).toContain('会话吊销');
  });
});
