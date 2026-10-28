import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, KeepAlive, reactive } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import Papers from '../../../views/admin/Papers.vue';
import PaperPreviewDialog from '../../PaperPreviewDialog.vue';

interface Call { method: string; path: string; payload?: any }
const transport = vi.hoisted(() => ({
  calls: [] as Call[], permissions: new Set<string>(),
  respond: async (_method: string, _path: string, _payload?: any): Promise<any> => ({}),
}));
vi.mock('../../../api/http', () => ({ default: Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, async (path: string, payload?: any) => {
  transport.calls.push({ method, path, payload: payload ? JSON.parse(JSON.stringify(payload)) : undefined });
  return transport.respond(method, path, payload);
}])) }));
vi.mock('../../../stores/auth', () => ({ useAuthStore: () => ({ can: (permission: string) => transport.permissions.has(permission) }) }));
const wrappers: VueWrapper[] = [];
const draft = {
  id: '2', title: '草稿试卷', business_scope: 'training', mode: 'fixed', status: 'draft', category_id: '1',
  requires_learning: true, required_learning_minutes: 60, course_ids: ['10'], regulation_ids: [], rules: [],
  duration_minutes: 45, total_score: 100, pass_score: 60, max_attempts: 3, partial_credit_ratio: .5,
  remark: '班组考核备注', created_at: '2026-10-27T00:30:00Z',
};
const random = { ...draft, id: '3', title: '历史随机卷', mode: 'random' };
const published = { ...draft, id: '4', title: '发布试卷', status: 'published' };
const publishedRandom = { ...published, id: '6', title: '已发布随机卷', mode: 'random' };
const withdrawn = { ...draft, id: '7', title: '已撤回固定卷', status: 'withdrawn' };
const withdrawnRandom = { ...withdrawn, id: '8', title: '已撤回随机卷', mode: 'random' };
const archived = { ...draft, id: '9', title: '已归档试卷', status: 'archived' };
function previewData(id = '2') {
  return {
    paper_id: id, release_id: null, mode: 'fixed', sample_kind: 'fixed_paper', note: '预览', difficulty: 'easy',
    rule: { total_cents: 10000, pass_cents: 6000, duration_minutes: 30, max_attempts: 3, partial_credit_ratio: .5, rules: [] },
    capacities: [], questions: [{ question_id: '40', question_version_id: '50', type: 'single', difficulty: 'easy', stem: '题干', options: [{ key: 'A', text: '选项甲' }, { key: 'B', text: '选项乙' }], score: 100, answer: [0], analysis: '秘密解析' }],
  };
}
beforeEach(() => {
  transport.calls = [];
  transport.permissions = reactive(new Set(['papers:read', 'papers:write', 'papers:publish', 'questions:read']));
  transport.respond = async (_method, path) => {
    if (path === '/admin/papers/category-options') return { items: [{ id: '1', name: '产业工人' }], total: 1 };
    if (path === '/admin/papers') return { items: [draft, random, published], total: 3 };
    if (path.includes('/preview')) return previewData();
    return { id: '5' };
  };
});
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); document.body.innerHTML = ''; });
async function list(cached = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/papers', component: Papers }, { path: '/admin/papers/:id', component: { template: '<div />' } }] });
  await router.push('/admin/papers'); await router.isReady();
  const host = cached ? defineComponent({ setup: () => () => h(RouterView, null, {
    default: ({ Component }: { Component: any }) => h(KeepAlive, null, { default: () => Component }),
  }) }) : RouterView;
  const wrapper = mount(host, { attachTo: document.body, global: { plugins: [ElementPlus, router] } });
  wrappers.push(wrapper); await flushPromises();
  return { wrapper, router, state: (wrapper.getComponent(Papers).vm.$ as any).setupState };
}
async function preview(realQuestion = false) {
  const wrapper = mount(PaperPreviewDialog, {
    attachTo: document.body,
    global: { plugins: [ElementPlus], stubs: realQuestion ? {} : { QuestionPreview: defineComponent({ name: 'QuestionPreview', emits: ['ready'], template: '<div class="question-preview-stub" />' }) } },
  });
  wrappers.push(wrapper); await flushPromises();
  return { wrapper, state: (wrapper.vm.$ as any).setupState };
}
function rowActions(wrapper: VueWrapper, title: string) {
  const id = ({ 草稿试卷: '2', 历史随机卷: '3', 发布试卷: '4', 已发布随机卷: '6', 已撤回固定卷: '7', 已撤回随机卷: '8', 已归档试卷: '9' } as Record<string, string>)[title];
  return wrapper.getComponent(Papers).get(`[data-paper-id="${id}"]`);
}
async function choose(wrapper: VueWrapper, title: string, label: string) {
  const button = rowActions(wrapper, title).findAll('button').find(item => item.text() === label);
  expect(button, `missing row action ${label}`).toBeDefined();
  await button!.trigger('click'); await flushPromises();
}
const requests = (method: string, path: string) => transport.calls.filter(c => c.method === method && c.path === path);
function showPapers(items: typeof draft[]) {
  const original = transport.respond;
  transport.respond = async (method, path, payload) => method === 'get' && path === '/admin/papers'
    ? { items, total: items.length } : original(method, path, payload);
}
function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

describe('paper list operations', () => {
  it('renders seven management columns without exposing learning requirements in a row', async () => {
    const { wrapper } = await list();
    expect(wrapper.findAll('.el-table__header th').map(h => h.text())).toEqual(['试卷名称', '培训类别', '考试时间', '状态', '备注', '创建时间', '操作']);
    const row = wrapper.findAll('.el-table__body tr').find(r => r.text().includes('草稿试卷'))!;
    expect(row.text()).toContain('产业工人'); expect(row.text()).toContain('45 分钟'); expect(row.text()).toContain('班组考核备注');
    expect(row.text()).not.toContain('学习'); expect(row.text()).not.toContain('开启');
  });
  it('shows status-appropriate flat action buttons and keeps historical random publication', async () => {
    const { wrapper } = await list();
    const labels = (title: string) => rowActions(wrapper, title).findAll('button').map(item => item.text());
    expect(labels('草稿试卷')).toEqual(['试卷管理', '修改', '预览/打印', '复制', '发布', '删除']);
    expect(labels('历史随机卷')).toEqual(['预览/打印', '发布', '删除']);
    expect(labels('发布试卷')).toEqual(['预览/打印', '复制', '撤回发布']);
  });
  it('opens ordinary preview from its row button without requesting answers', async () => {
    const { wrapper } = await list();
    await choose(wrapper, '草稿试卷', '预览/打印');
    expect(requests('get', '/admin/papers/2/preview')).toHaveLength(1);
    expect(transport.calls.some(c => c.path.endsWith('/answers'))).toBe(false);
    expect(wrapper.get('.paper-detail').classes()).toContain('paper-preview-open');
    wrapper.getComponent(PaperPreviewDialog).vm.close(); await flushPromises();
    expect(wrapper.get('.paper-detail').classes()).not.toContain('paper-preview-open');
  });
  it('routes paper management to the existing designer', async () => {
    const { wrapper, router } = await list();
    await choose(wrapper, '草稿试卷', '试卷管理');
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers/2?scope=training&designer=1');
  });
  it('blocks writes for read-only access and allows basic editing without question access', async () => {
    transport.permissions = new Set(['papers:read']);
    const { wrapper, state } = await list();
    expect(wrapper.findAll('.fits-table-action').map(i => i.text())).toEqual(['预览/打印', '预览/打印', '预览/打印']);
    await state.copyPaper(draft); await state.publishPaper(draft); await state.deletePaper(draft); await state.editPaper(draft);
    expect(transport.calls.filter(c => c.method !== 'get')).toEqual([]);
    transport.permissions.add('papers:write');
    expect(state.canModify(draft)).toBe(true); expect(state.canEdit(draft)).toBe(false);
  });
  it('sends one copy request during repeated clicks and refreshes without leaving the list', async () => {
    const original = transport.respond; let complete!: (value: any) => void;
    transport.respond = async (method, path, payload) => path.endsWith('/copy') ? new Promise(resolve => { complete = resolve; }) : original(method, path, payload);
    const { wrapper, state, router } = await list();
    const first = state.copyPaper(draft); await flushPromises(); await state.copyPaper(draft);
    expect(requests('post', '/admin/papers/2/copy')).toHaveLength(1);
    expect(rowActions(wrapper, '草稿试卷').findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true);
    complete({ id: '5' }); await first; await flushPromises();
    expect(requests('get', '/admin/papers')).toHaveLength(2);
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers');
    await state.copyPaper(random); expect(requests('post', '/admin/papers/3/copy')).toHaveLength(0);
  });
  it('confirms publication once, refreshes the list, and ignores cancel', async () => {
    let confirm!: (value: any) => void;
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => new Promise(resolve => { confirm = resolve; }) as any);
    const { state } = await list();
    const first = state.publishPaper(draft); await flushPromises(); await state.publishPaper(draft);
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1); confirm('confirm'); await first; await flushPromises();
    expect(requests('post', '/admin/papers/2/publish')).toHaveLength(1);
    expect(requests('get', '/admin/papers')).toHaveLength(2);
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel'); await state.publishPaper(draft);
    expect(requests('post', '/admin/papers/2/publish')).toHaveLength(1);
    vi.mocked(ElMessageBox.confirm).mockResolvedValueOnce('confirm' as any); await state.publishPaper(random);
    expect(requests('post', '/admin/papers/3/publish')).toHaveLength(1);
  });
  it('confirms deletion once and holds its lock through the pending receipt', async () => {
    let confirm!: (value: any) => void; let deleted!: (value: any) => void;
    const original = transport.respond;
    transport.respond = (method, path, payload) => method === 'delete' ? new Promise(resolve => { deleted = resolve; }) : original(method, path, payload);
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => new Promise(resolve => { confirm = resolve; }) as any);
    const { state } = await list();
    const first = state.deletePaper(draft); await flushPromises(); await state.deletePaper(draft);
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1); expect(requests('delete', '/admin/papers/2')).toHaveLength(0);
    confirm('confirm'); await flushPromises(); await state.deletePaper(draft);
    expect(requests('delete', '/admin/papers/2')).toHaveLength(1);
    deleted(null); await first;
    expect(requests('get', '/admin/papers')).toHaveLength(2);
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel'); await state.deletePaper(draft); await state.deletePaper(published);
    expect(requests('delete', '/admin/papers/2')).toHaveLength(1); expect(requests('delete', '/admin/papers/4')).toHaveLength(0);
  });
  it('returns from an emptied final page to the previous remaining page after deletion', async () => {
    let deleted = false; const original = transport.respond;
    transport.respond = async (method, path, payload) => {
      if (method === 'delete') { deleted = true; return null; }
      if (path === '/admin/papers' && payload?.params.page === 2) return { items: deleted ? [] : [draft], total: deleted ? 20 : 21 };
      if (path === '/admin/papers' && deleted) return { items: [published], total: 20 };
      return original(method, path, payload);
    };
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    const { state } = await list(); state.trainingQuery.page = 2; await state.loadTraining();
    await state.deletePaper(draft); await flushPromises();
    expect(state.trainingQuery.page).toBe(1); expect(state.trainingItems.map((item: any) => item.id)).toEqual(['4']);
    expect(requests('get', '/admin/papers').at(-1)?.payload.params.page).toBe(1);
  });
  it('does not delete after leaving a pending confirmation', async () => {
    let confirm!: (value: any) => void;
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => new Promise(resolve => { confirm = resolve; }) as any);
    const { state, router } = await list();
    const pending = state.deletePaper(draft); await flushPromises(); await router.push('/admin/papers/4');
    confirm('confirm'); await pending;
    expect(requests('delete', '/admin/papers/2')).toHaveLength(0);
  });
  it('ignores a delete receipt that arrives after the list has been left', async () => {
    let complete!: (value: any) => void; const original = transport.respond;
    transport.respond = (method, path, payload) => method === 'delete' ? new Promise(resolve => { complete = resolve; }) : original(method, path, payload);
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    const { state, router } = await list(); const pending = state.deletePaper(draft); await flushPromises();
    expect(requests('delete', '/admin/papers/2')).toHaveLength(1);
    await router.push('/admin/papers/4'); complete(null); await pending; await flushPromises();
    expect(requests('get', '/admin/papers')).toHaveLength(1);
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers/4');
  });
});

describe('paper publication withdrawal', () => {
  it('offers withdrawal for both published modes and keeps withdrawn papers read-only', async () => {
    showPapers([draft, published, publishedRandom, withdrawn, withdrawnRandom, archived]);
    const { wrapper, state } = await list();
    const labels = (title: string) => rowActions(wrapper, title).findAll('button').map(item => item.text());
    expect(labels('发布试卷')).toEqual(['预览/打印', '复制', '撤回发布']);
    expect(labels('已发布随机卷')).toEqual(['预览/打印', '撤回发布']);
    expect(labels('已撤回固定卷')).toEqual(['预览/打印', '复制']);
    expect(labels('已撤回随机卷')).toEqual(['预览/打印']);
    expect(labels('已归档试卷')).toEqual(['预览/打印', '复制']);
    await state.publishPaper(withdrawn); await state.editPaper(withdrawn);
    expect(transport.calls.filter(call => call.method !== 'get')).toEqual([]);
    state.trainingQuery.status = 'withdrawn'; await state.searchTraining();
    expect(requests('get', '/admin/papers').at(-1)?.payload.params.status).toBe('withdrawn');
  });

  it('uses publish permission independently of write permission', async () => {
    showPapers([published, publishedRandom]);
    transport.permissions = new Set(['papers:read', 'papers:publish']);
    const { wrapper } = await list();
    expect(wrapper.findAll('.fits-table-action').map(button => button.text())).toEqual(['预览/打印', '撤回发布', '预览/打印', '撤回发布']);
  });

  it('returns the withdrawn paper to a real editable draft and restores its management actions', async () => {
    let status = 'published'; const original = transport.respond;
    transport.respond = async (method, path, payload) => {
      if (path === '/admin/papers') return { items: [{ ...published, status }], total: 1 };
      if (method === 'post' && path === '/admin/papers/4/withdraw') { status = 'draft'; return { paper_id: '4', status: 'draft' }; }
      return original(method, path, payload);
    };
    const confirmation = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    const success = vi.spyOn(ElMessage, 'success');
    const { wrapper, router } = await list();
    await choose(wrapper, '发布试卷', '撤回发布');
    const message = String(confirmation.mock.calls[0]?.[0]);
    expect(message).toContain('发布试卷'); expect(message).toContain('禁止新开考');
    expect(message).toMatch(/草稿/); expect(message).toMatch(/修改.*重新发布/);
    expect(message).toMatch(/进行中的考试.*继续/); expect(message).toMatch(/历史成绩.*保留/);
    expect(requests('post', '/admin/papers/4/withdraw')).toHaveLength(1);
    expect(requests('get', '/admin/papers')).toHaveLength(2); expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith('试卷已撤回为草稿，可修改后重新发布');
    expect(rowActions(wrapper, '发布试卷').findAll('button').map(button => button.text())).toEqual(['试卷管理', '修改', '预览/打印', '复制', '发布', '删除']);
    const row = wrapper.findAll('.el-table__body tr').find(item => item.text().includes('发布试卷'))!;
    expect(row.get('.el-tag').text()).toBe('草稿');
    expect(rowActions(wrapper, '发布试卷').text()).not.toContain('撤回发布');
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers');
  });

  it('restores draft actions according to current permissions after a withdrawal', async () => {
    let status = 'published'; const original = transport.respond;
    transport.respond = async (method, path, payload) => {
      if (path === '/admin/papers') return { items: [{ ...published, status }], total: 1 };
      if (method === 'post' && path === '/admin/papers/4/withdraw') { status = 'draft'; return { paper_id: '4', status: 'draft' }; }
      return original(method, path, payload);
    };
    transport.permissions = new Set(['papers:read', 'papers:publish']);
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    const { wrapper } = await list();
    await choose(wrapper, '发布试卷', '撤回发布');
    expect(rowActions(wrapper, '发布试卷').findAll('button').map(button => button.text())).toEqual(['预览/打印', '发布']);
  });

  it('does not promise a question editor for a historical random paper', async () => {
    showPapers([publishedRandom]);
    const confirmation = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    const success = vi.spyOn(ElMessage, 'success');
    const { wrapper } = await list();
    await choose(wrapper, '已发布随机卷', '撤回发布');
    expect(String(confirmation.mock.calls[0]?.[0])).toContain('可重新发布');
    expect(String(confirmation.mock.calls[0]?.[0])).not.toContain('修改');
    expect(success).toHaveBeenCalledWith('试卷已撤回为草稿，可重新发布');
  });

  it.each(['cancel', 'close'])('does not write when the confirmation is dismissed with %s', async action => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(action);
    const success = vi.spyOn(ElMessage, 'success');
    const { wrapper, state } = await list();
    await choose(wrapper, '发布试卷', '撤回发布');
    expect(requests('post', '/admin/papers/4/withdraw')).toHaveLength(0);
    expect(requests('get', '/admin/papers')).toHaveLength(1); expect(success).not.toHaveBeenCalled();
    expect(state.isRowBusy(published)).toBe(false);
  });

  it('holds one row lock through confirmation and the pending request for a random paper', async () => {
    showPapers([publishedRandom]);
    const confirmation = deferred(); const receipt = deferred(); const original = transport.respond;
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => confirmation.promise as any);
    transport.respond = (method, path, payload) => path === '/admin/papers/6/withdraw' ? receipt.promise : original(method, path, payload);
    const { wrapper, state } = await list();
    expect(rowActions(wrapper, '已发布随机卷').text()).toContain('撤回发布');
    const pending = state.withdrawPaper(publishedRandom); await flushPromises(); await state.withdrawPaper(publishedRandom);
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1); expect(requests('post', '/admin/papers/6/withdraw')).toHaveLength(0);
    expect(rowActions(wrapper, '已发布随机卷').findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true);
    expect(rowActions(wrapper, '已发布随机卷').findAll('button').find(button => button.text() === '撤回发布')!.classes()).toContain('is-loading');
    confirmation.resolve('confirm'); await flushPromises(); await state.withdrawPaper(publishedRandom);
    expect(requests('post', '/admin/papers/6/withdraw')).toHaveLength(1);
    receipt.resolve({ paper_id: '6', status: 'draft' }); await pending; await flushPromises();
    expect(state.isRowBusy(publishedRandom)).toBe(false); expect(requests('get', '/admin/papers')).toHaveLength(2);
  });

  it('releases busy state without retrying a failed network request', async () => {
    const original = transport.respond;
    transport.respond = async (method, path, payload) => {
      if (path === '/admin/papers/4/withdraw') throw new Error('network unavailable');
      return original(method, path, payload);
    };
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    const success = vi.spyOn(ElMessage, 'success');
    const { wrapper, state } = await list();
    await choose(wrapper, '发布试卷', '撤回发布'); await flushPromises();
    expect(requests('post', '/admin/papers/4/withdraw')).toHaveLength(1);
    expect(requests('get', '/admin/papers')).toHaveLength(1); expect(success).not.toHaveBeenCalled();
    expect(state.isRowBusy(published)).toBe(false);
  });

  it('rejects calls without permission, published status, or training scope', async () => {
    const confirmation = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    const { wrapper, state } = await list();
    expect(rowActions(wrapper, '发布试卷').text()).toContain('撤回发布');
    for (const row of [draft, withdrawn, archived, { ...published, business_scope: 'regulation' }]) await state.withdrawPaper(row);
    transport.permissions.delete('papers:publish'); await state.withdrawPaper(published);
    await wrapper.vm.$nextTick();
    expect(rowActions(wrapper, '发布试卷').text()).not.toContain('撤回发布');
    expect(confirmation).not.toHaveBeenCalled(); expect(transport.calls.filter(call => call.method !== 'get')).toEqual([]);
  });

  it.each(['permission', 'status'])('rechecks %s after a pending confirmation', async changed => {
    const confirmation = deferred();
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => confirmation.promise as any);
    const { wrapper, state } = await list();
    expect(rowActions(wrapper, '发布试卷').text()).toContain('撤回发布');
    const row = { ...published }; const pending = state.withdrawPaper(row); await flushPromises();
    if (changed === 'permission') transport.permissions.delete('papers:publish'); else row.status = 'withdrawn';
    confirmation.resolve('confirm'); await pending;
    expect(requests('post', '/admin/papers/4/withdraw')).toHaveLength(0); expect(state.isRowBusy(published)).toBe(false);
  });

  it.each([false, true])('ignores a confirmation after leaving the list (cached: %s)', async cached => {
    const confirmation = deferred();
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => confirmation.promise as any);
    const { wrapper, state, router } = await list(cached);
    expect(rowActions(wrapper, '发布试卷').text()).toContain('撤回发布');
    const pending = state.withdrawPaper(published); await flushPromises(); await router.push('/admin/papers/4');
    if (cached) { await router.push('/admin/papers'); await flushPromises(); }
    confirmation.resolve('confirm'); await pending;
    expect(requests('post', '/admin/papers/4/withdraw')).toHaveLength(0);
  });

  it('ignores a pending confirmation after navigating to another list filter', async () => {
    const confirmation = deferred();
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => confirmation.promise as any);
    const { wrapper, state, router } = await list();
    expect(rowActions(wrapper, '发布试卷').text()).toContain('撤回发布');
    const pending = state.withdrawPaper(published); await flushPromises(); await router.push('/admin/papers?status=withdrawn');
    confirmation.resolve('confirm'); await pending;
    expect(requests('post', '/admin/papers/4/withdraw')).toHaveLength(0);
  });

  it.each([false, true])('does not refresh or show success for a receipt after leaving (cached: %s)', async cached => {
    const receipt = deferred(); const original = transport.respond;
    transport.respond = (method, path, payload) => path === '/admin/papers/4/withdraw' ? receipt.promise : original(method, path, payload);
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as any);
    const success = vi.spyOn(ElMessage, 'success');
    const { wrapper, state, router } = await list(cached);
    expect(rowActions(wrapper, '发布试卷').text()).toContain('撤回发布');
    const pending = state.withdrawPaper(published); await flushPromises();
    expect(requests('post', '/admin/papers/4/withdraw')).toHaveLength(1);
    await router.push('/admin/papers/4');
    if (cached) { await router.push('/admin/papers'); await flushPromises(); }
    const loads = requests('get', '/admin/papers').length;
    receipt.resolve({ paper_id: '4', status: 'draft' }); await pending; await flushPromises();
    expect(requests('get', '/admin/papers')).toHaveLength(loads); expect(success).not.toHaveBeenCalled();
    expect(router.currentRoute.value.fullPath).toBe(cached ? '/admin/papers' : '/admin/papers/4');
  });
});

describe('reusable paper preview', () => {
  it('does not reopen a closed dialog when its request finishes late', async () => {
    let complete!: (value: any) => void; transport.respond = async () => new Promise(resolve => { complete = resolve; });
    const { wrapper, state } = await preview(); const open = wrapper.vm.open(draft, false); await flushPromises();
    wrapper.vm.close(); complete(previewData()); await open; await flushPromises();
    expect(state.previewVisible).toBe(false); expect(state.previewSession).toBeNull();
  });
  it('discards a late answer response after a newer ordinary preview and gates printing by media readiness', async () => {
    let answer!: (value: any) => void;
    transport.respond = async (_m, path) => path.endsWith('/answers') ? new Promise(resolve => { answer = resolve; }) : previewData('4');
    const { wrapper, state } = await preview(); const old = wrapper.vm.open(draft, true); await flushPromises();
    await wrapper.vm.open(published, false); answer(previewData('2')); await old; await flushPromises();
    expect(state.previewSession.paperId).toBe('4'); expect(state.previewAnswers).toBe(false);
    expect(state.previewResourcesReady).toBe(false);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {}); state.printPreview(); expect(print).not.toHaveBeenCalled();
    const op = state.previewSession.operation; state.markPreviewQuestionReady(op, 0, '50', { ok: false }); expect(state.previewResourcesFailed).toBe(true);
    state.retryPreviewMedia(); state.markPreviewQuestionReady(op, 0, '50', { ok: true }); expect(state.previewResourcesReady).toBe(false);
    state.markPreviewQuestionReady(op, 1, '50', { ok: true }); state.printPreview(); expect(print).toHaveBeenCalledTimes(1);
  });
  it('renders an ordinary printable paper without exposing answer, analysis, or JSON export actions', async () => {
    const { wrapper } = await preview(true); await wrapper.vm.open(draft, false); await flushPromises();
    const dialog = document.body.querySelector('.paper-preview-dialog')!;
    expect(dialog.textContent).toContain('草稿试卷'); expect(dialog.textContent).toContain('题干'); expect(dialog.textContent).toContain('选项甲');
    expect(dialog.textContent).not.toContain('秘密解析'); expect(dialog.textContent).not.toContain('正确答案');
    expect(Array.from(dialog.querySelectorAll('.el-dialog__footer button')).map(button => button.textContent?.trim())).toEqual(['关闭', '打印']);
    expect(dialog.querySelector('.el-dialog__footer .el-button--primary')?.textContent?.trim()).toBe('打印');
    expect(dialog.classList.contains('re-form-dialog')).toBe(true);
    expect(dialog.querySelector('.paper-print-sheet')).not.toBeNull();
    expect(dialog.querySelector('.question-preview__meta')).toBeNull();
    expect(dialog.textContent).not.toContain('简单');
    expect(dialog.textContent).not.toContain('单选题');
    expect(transport.calls.some(c => c.path.endsWith('/answers'))).toBe(false);
  });
});
