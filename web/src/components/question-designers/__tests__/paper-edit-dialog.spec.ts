import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import Papers from '../../../views/admin/Papers.vue';

const transport = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; path: string; payload?: any }>, permissions: new Set<string>(),
  respond: async (_method: string, _path: string, _payload?: any): Promise<any> => ({}),
}));
vi.mock('../../../api/http', () => ({ default: Object.fromEntries(['get', 'put', 'post', 'delete'].map(method => [method, async (path: string, payload?: any) => {
  transport.calls.push({ method, path, payload: payload ? JSON.parse(JSON.stringify(payload)) : undefined });
  return transport.respond(method, path, payload);
}])) }));
vi.mock('../../../stores/auth', () => ({ useAuthStore: () => ({ can: (permission: string) => transport.permissions.has(permission) }) }));
const row = {
  id: '2', title: '列表旧名称', business_scope: 'training', category_id: '1', status: 'draft', mode: 'fixed',
  requires_learning: false, required_learning_minutes: null, course_ids: [], regulation_ids: [], rules: [],
  duration_minutes: 30, total_score: 100, pass_score: 60, max_attempts: 3, partial_credit_ratio: .5, remark: null,
};
const latest = {
  ...row, title: '最新名称', duration_minutes: 45, total_score: 120, pass_score: 72, remark: '最新备注',
  requires_learning: true, required_learning_minutes: 90, course_ids: ['10'],
  regulation_ids: ['98'], rules: [{ type: 'single', count: 2, score_cents: 6000 }],
  max_attempts: 8, partial_credit_ratio: .8, sort_order: 12,
  designer_layout: { schema_version: 1, settings: { templateName: '已有版式', pageSize: 'A4', pageOrientation: 1, pageSizeReduce: { top: 15, bottom: 15, left: 15, right: 15 } } },
  latest_release_id: null, sum_score_cents: 12000, questions: [{ question_version_id: '50', score_cents: 12000 }],
};
const wrappers: VueWrapper[] = [];
beforeEach(() => {
  transport.calls = []; transport.permissions = new Set(['papers:read', 'papers:write']);
  transport.respond = async (_method, path) => {
    if (path === '/admin/papers/category-options') return { items: [{ id: '1', name: '产业工人' }, { id: '3', name: '管理人员' }], total: 2 };
    if (path === '/admin/papers/course-options') return { items: [{ id: '10', title: '安全课程' }], total: 1 };
    if (path === '/admin/papers') return { items: [row], total: 1 };
    if (path === '/admin/papers/2') return JSON.parse(JSON.stringify(latest));
    return { ...latest, id: '5', title: '另一份试卷' };
  };
});
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); document.body.innerHTML = ''; });
async function list() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/papers', component: Papers }, { path: '/away', component: { template: '<div />' } }] });
  await router.push('/admin/papers'); await router.isReady();
  const wrapper = mount(RouterView, { attachTo: document.body, global: { plugins: [ElementPlus, router] } });
  wrappers.push(wrapper); await flushPromises();
  return { wrapper, router, state: (wrapper.getComponent(Papers).vm.$ as any).setupState };
}
function dialog(wrapper: VueWrapper) {
  const component = wrapper.getComponent({ name: 'PaperEditDialog' });
  return { component, state: (component.vm.$ as any).setupState };
}
const puts = () => transport.calls.filter(c => c.method === 'put');
function saveButton() { return Array.from(document.querySelectorAll<HTMLButtonElement>('.paper-edit-dialog .el-dialog__footer button')).find(button => button.textContent?.trim() === '保存')!; }

describe('paper basic configuration dialog', () => {
  it('displays immutable practice purpose and unlimited attempts, preserving null on save and reopen', async () => {
    const original = transport.respond;
    transport.respond = async (method, path, payload) => method === 'get' && path === '/admin/papers/2'
      ? { ...latest, exam_purpose: 'practice', mode: 'random', pool_scope: 'public', category_id: null, total_score: 100,
        pass_score: 60, max_attempts: null, rules: [{ type: 'single', count: 50, score_cents: 200 }], questions: [] }
      : original(method, path, payload);
    const { wrapper, state: listState } = await list();
    await listState.editPaper({ ...row, mode: 'random' }); await flushPromises();
    const { component, state } = dialog(wrapper);
    expect(state.form.max_attempts).toBeNull();
    expect(component.text()).toContain('模拟考（不可变更）'); expect(component.text()).toContain('不限次数');
    expect(component.text()).not.toContain('已有考试归属沿用首次开考时冻结的次数上限');
    state.form.title = '模拟卷修改'; await state.save();
    expect(puts()).toHaveLength(1); expect(puts()[0]?.payload).toMatchObject({ title: '模拟卷修改', max_attempts: null,
      rules: [{ type: 'single', count: 50, score_cents: 200 }], course_ids: ['10'], required_learning_minutes: 90 });
    expect(puts()[0]?.payload).not.toHaveProperty('exam_purpose');
    await listState.editPaper({ ...row, mode: 'random' }); await flushPromises();
    expect(state.form.max_attempts).toBeNull(); expect(state.visible).toBe(true);
  });

  it('loads public learning courses with an explicit scope and keeps the null category when saving', async () => {
    const original = transport.respond;
    transport.respond = async (method, path, payload) => method === 'get' && path === '/admin/papers/2'
      ? { ...latest, mode: 'random', pool_scope: 'public', category_id: null, total_score: 100, pass_score: 60, questions: [],
        rules: [{ type: 'single', count: 100, score_cents: 100 }] }
      : original(method, path, payload);
    const { wrapper, state: listState } = await list(); await listState.editPaper({ ...row, mode: 'random' }); await flushPromises();
    const { state } = dialog(wrapper);
    expect(transport.calls.find(call => call.path === '/admin/papers/course-options')?.payload.params).toEqual({ pool_scope: 'public', page: 1, page_size: 100 });
    expect(state.courses).toEqual([{ id: '10', title: '安全课程' }]);
    await state.save(); expect(puts()[0]?.payload).toMatchObject({ pool_scope: 'public', category_id: null, course_ids: ['10'], required_learning_minutes: 90 });
  });
  it.each(['public', 'category', undefined])('reloads random rules and attempts and preserves the %s pool scope', async scope => {
    const randomDetail = { ...latest, mode: 'random', pool_scope: scope, category_id: scope === 'public' ? null : '1', questions: [],
      requires_learning: false, course_ids: [], required_learning_minutes: null,
      total_score: 100, pass_score: 60, rules: [{ type: 'single', count: 100, score_cents: 100 }], max_attempts: 7 };
    const original = transport.respond;
    transport.respond = async (method, path, payload) => method === 'get' && path === '/admin/papers/2' ? randomDetail : original(method, path, payload);
    const { wrapper, state: listState, router } = await list();
    await listState.editPaper({ ...row, mode: 'random' }); await flushPromises();
    const { state } = dialog(wrapper);
    expect(state.visible).toBe(true); expect(state.loaded).toBe(true);
    expect(state.form.rules).toEqual([{ type: 'single', count: 100, score_cents: 100 }]);
    expect(state.form.max_attempts).toBe(7);
    expect(document.querySelector('.paper-edit-dialog')?.textContent).toContain('本机构：简单题；外来人员：困难题');
    state.form.max_attempts = 100;
    state.form.rules = [{ type: 'single', count: 60, score_cents: 100 }, { type: 'multiple', count: 10, score_cents: 300 }, { type: 'judgment', count: 10, score_cents: 100 }];
    await state.save();
    expect(puts()[0]?.payload).toMatchObject({ pool_scope: scope || 'category', category_id: scope === 'public' ? null : '1', max_attempts: 100,
      rules: [{ type: 'single', count: 60, score_cents: 100 }, { type: 'multiple', count: 10, score_cents: 300 }, { type: 'judgment', count: 10, score_cents: 100 }] });
    expect(puts()[0]?.payload).not.toHaveProperty('mode'); expect(puts()[0]?.payload).not.toHaveProperty('preserve_questions');
    expect(router.currentRoute.value.fullPath).toBe('/admin/papers');
  });
  it('retains random edits after a failed save and refuses mismatched totals and invalid attempt limits', async () => {
    const original = transport.respond;
    transport.respond = async (method, path, payload) => {
      if (method === 'get' && path === '/admin/papers/2') return { ...latest, mode: 'random', pool_scope: 'public', category_id: null,
        total_score: 100, pass_score: 60, questions: [], rules: [{ type: 'single', count: 100, score_cents: 100 }] };
      if (method === 'put') throw new Error('write failed');
      return original(method, path, payload);
    };
    const { wrapper, state: listState } = await list(); await listState.editPaper({ ...row, mode: 'random' }); await flushPromises();
    const { state } = dialog(wrapper); expect(state.loaded).toBe(true);
    state.form.total_score = 99; await state.save(); expect(puts()).toHaveLength(0);
    state.form.total_score = 100; state.form.max_attempts = 101; await state.save(); expect(puts()).toHaveLength(0);
    state.form.max_attempts = 3; state.form.title = '保留随机卷输入'; await state.save();
    expect(puts()).toHaveLength(1); expect(state.form.title).toBe('保留随机卷输入'); expect(state.visible).toBe(true); expect(state.dirty).toBe(true);
  });
  it('loads the latest detail and saves only the displayed configuration without entering the designer', async () => {
    const { wrapper, state: listState, router } = await list();
    await listState.editPaper(row); await flushPromises();
    const { state } = dialog(wrapper);
    expect(state.form.title).toBe('最新名称'); expect(state.form.duration_minutes).toBe(45); expect(state.form.course_ids).toEqual(['10']);
    expect(document.querySelector('.paper-edit-dialog')?.textContent).toContain('关联课程');
    expect(document.querySelector<HTMLInputElement>('.paper-edit-dialog input')?.value).toBe('最新名称');
    state.form.title = '最新名称-修改'; state.form.remark = '  修改备注  ';
    await flushPromises(); saveButton().click(); await flushPromises();
    expect(puts()).toEqual([{ method: 'put', path: '/admin/papers/2', payload: {
      title: '最新名称-修改', category_id: '1', duration_minutes: 45, total_score: 120, pass_score: 72, max_attempts: 8,
      requires_learning: true, course_ids: ['10'], required_learning_minutes: 90, remark: '修改备注', preserve_questions: true,
    } }]);
    expect(state.visible).toBe(false); expect(router.currentRoute.value.fullPath).toBe('/admin/papers');
    expect(transport.calls.filter(c => c.path === '/admin/papers')).toHaveLength(2);
  });
  it('keeps learning fields conditional and clears them when the switch is turned off', async () => {
    const { wrapper, state: listState } = await list(); await listState.editPaper(row); await flushPromises();
    const { state } = dialog(wrapper); state.form.requires_learning = false; await flushPromises();
    expect(document.querySelector('.paper-edit-dialog')?.textContent).not.toContain('关联课程');
    expect(state.form.course_ids).toEqual([]); expect(state.form.required_learning_minutes).toBeNull();
    await state.save();
    expect(puts()[0]?.payload).toMatchObject({ requires_learning: false, course_ids: [], required_learning_minutes: null });
  });
  it('preserves the loaded category and question list when altered form state attempts to reclassify a nonempty paper', async () => {
    let stored = JSON.parse(JSON.stringify(latest)); const original = transport.respond;
    transport.respond = async (method, path, payload) => {
      if (method === 'put' && path === '/admin/papers/2') {
        // The existing service removes links when its category changes.
        if (payload.category_id !== stored.category_id) stored.questions = [];
        stored = { ...stored, ...payload }; return stored;
      }
      return original(method, path, payload);
    };
    const { wrapper, state: listState } = await list(); await listState.editPaper(row); await flushPromises();
    const { state } = dialog(wrapper);
    const dialogText = document.querySelector('.paper-edit-dialog')?.textContent;
    state.form.category_id = '3'; state.form.title = '只改名称'; await state.save();
    expect(puts()[0]?.payload.category_id).toBe('1'); expect(stored.questions).toEqual([{ question_version_id: '50', score_cents: 12000 }]);
    expect(puts().every(call => call.path === '/admin/papers/2')).toBe(true);
    expect(puts()[0]?.payload).not.toHaveProperty('questions'); expect(puts()[0]?.payload).not.toHaveProperty('designer_layout');
    expect(dialogText).toContain('已有试题，培训类别不可修改');
  });
  it('allows changing category for an empty paper even when its ordinary designer layout exists', async () => {
    const original = transport.respond;
    transport.respond = async (method, path, payload) => method === 'get' && path === '/admin/papers/2'
      ? { ...latest, questions: [], regulation_ids: [], requires_learning: false, course_ids: [], required_learning_minutes: null }
      : original(method, path, payload);
    const { wrapper, state: listState } = await list(); await listState.editPaper(row); await flushPromises();
    const { state } = dialog(wrapper); state.form.category_id = '3'; state.onCategoryChange(); await state.save();
    expect(puts()[0]?.payload.category_id).toBe('3'); expect(puts()[0]?.payload).not.toHaveProperty('designer_layout');
  });
  it.each([
    ['blank title', { title: ' ' }], ['missing category', { category_id: '' }], ['fractional duration', { duration_minutes: 1.5 }],
    ['duration over limit', { duration_minutes: 1441 }], ['invalid total', { total_score: 0 }], ['fractional cents', { total_score: 100.001 }],
    ['pass above total', { pass_score: 121 }], ['missing learning courses', { course_ids: [] }],
    ['missing learning minutes', { required_learning_minutes: null }], ['overlong remark', { remark: '字'.repeat(1001) }],
  ])('does not save %s', async (_name, patch) => {
    const { wrapper, state: listState } = await list(); await listState.editPaper(row); await flushPromises();
    const { state } = dialog(wrapper); Object.assign(state.form, patch); await state.save();
    expect(puts()).toEqual([]); expect(state.visible).toBe(true);
  });
  it('rejects a stale list row when the latest server detail has already been published', async () => {
    const original = transport.respond;
    transport.respond = async (method, path, payload) => path === '/admin/papers/2' ? { ...latest, status: 'published' } : original(method, path, payload);
    const { wrapper, state: listState } = await list(); await listState.editPaper(row); await flushPromises();
    const { state } = dialog(wrapper); await state.save(); expect(state.visible).toBe(false); expect(puts()).toEqual([]);
  });
  it('ignores an older detail response after another paper opens and after the dialog closes', async () => {
    let complete!: (value: any) => void; const original = transport.respond;
    transport.respond = (method, path, payload) => path === '/admin/papers/2' ? new Promise(resolve => { complete = resolve; }) : original(method, path, payload);
    const { wrapper, state: listState } = await list(); const pending = listState.editPaper(row); await flushPromises();
    const { component, state } = dialog(wrapper);
    await component.vm.open({ ...row, id: '5' }); complete(latest); await pending; await flushPromises();
    expect(state.form.title).toBe('另一份试卷'); expect(state.paperId).toBe('5'); expect(state.visible).toBe(true);
    component.vm.close();
    const closed = component.vm.open(row); await flushPromises(); component.vm.close(); complete(latest); await closed; await flushPromises();
    expect(state.visible).toBe(false); expect(state.paperId).toBeNull();
  });
  it('confirms unsaved cancellation and leaves the dialog open when discard is rejected', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValueOnce('confirm' as any);
    const { wrapper, state: listState } = await list(); await listState.editPaper(row); await flushPromises();
    const { state } = dialog(wrapper); state.form.title = '未保存修改'; await flushPromises();
    await state.requestClose(); expect(state.visible).toBe(true); expect(puts()).toEqual([]);
    await state.requestClose(); expect(state.visible).toBe(false); expect(confirm).toHaveBeenCalledTimes(2);
  });
  it('does not apply a late discard confirmation to a newer paper dialog', async () => {
    let confirm!: (value: any) => void;
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => new Promise(resolve => { confirm = resolve; }) as any);
    const { wrapper, state: listState } = await list(); await listState.editPaper(row); await flushPromises();
    const { component, state } = dialog(wrapper); state.form.title = '旧弹框未保存'; await flushPromises();
    const closing = state.requestClose(); await flushPromises();
    component.vm.close(); await component.vm.open({ ...row, id: '5' }); await flushPromises();
    confirm('confirm'); await closing; await flushPromises();
    expect(state.visible).toBe(true); expect(state.form.title).toBe('另一份试卷'); expect(state.paperId).toBe('5');
  });
  it('sends one save and never closes or refreshes a newer dialog from a late receipt', async () => {
    let complete!: (value: any) => void; const original = transport.respond;
    transport.respond = (method, path, payload) => method === 'put' ? new Promise(resolve => { complete = resolve; }) : original(method, path, payload);
    const { wrapper, state: listState } = await list(); await listState.editPaper(row); await flushPromises();
    const { component, state } = dialog(wrapper); state.form.title = '待保存'; await flushPromises();
    const pending = state.save(); await flushPromises(); await state.save(); expect(puts()).toHaveLength(1);
    component.vm.close(); await component.vm.open({ ...row, id: '5' }); await flushPromises();
    complete(latest); await pending; await flushPromises();
    expect(state.visible).toBe(true); expect(state.form.title).toBe('另一份试卷');
    expect(transport.calls.filter(c => c.path === '/admin/papers')).toHaveLength(1);
  });
  it('retains inputs and emits no saved event after a 40970 concurrent question conflict without retrying', async () => {
    const original = transport.respond;
    transport.respond = (method, path, payload) => {
      if (method === 'get' && path === '/admin/papers/2') return Promise.resolve({ ...latest, questions: [], requires_learning: false, course_ids: [], required_learning_minutes: null });
      if (method === 'put') return Promise.reject({ response: { status: 409, data: { code: 40970, message: '试卷已有试题，不能更改培训类别' } } });
      return original(method, path, payload);
    };
    const { wrapper, state: listState } = await list(); await listState.editPaper(row); await flushPromises();
    const { component, state } = dialog(wrapper); state.form.title = '保留修改'; state.form.category_id = '3'; await state.save(); await flushPromises();
    expect(state.visible).toBe(true); expect(state.form.title).toBe('保留修改'); expect(state.saving).toBe(false); expect(puts()).toHaveLength(1);
    expect(state.form.category_id).toBe('3'); expect(state.dirty).toBe(true);
    expect(component.emitted('saved')).toBeUndefined(); expect(transport.calls.filter(c => c.path === '/admin/papers')).toHaveLength(1);
    expect(puts()[0]?.payload).toMatchObject({ category_id: '3', preserve_questions: true });
  });
});
