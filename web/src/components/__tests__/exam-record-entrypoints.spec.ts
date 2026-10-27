import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ElementPlus from 'element-plus';
import Papers from '../../views/admin/Papers.vue';
import Students from '../../views/admin/Users.vue';

const state = vi.hoisted(() => ({ permissions: new Set<string>(), get: vi.fn() }));
vi.mock('../../api/http', () => ({ default: { get: state.get }, download: vi.fn(), upload: vi.fn() }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (permission: string) => state.permissions.has(permission) }) }));
vi.mock('../../composables/useUnsavedChanges', () => ({ useUnsavedChanges: () => ({ markClean: vi.fn(), confirmDiscard: vi.fn().mockResolvedValue(true) }) }));

const wrappers: VueWrapper[] = [];
beforeEach(() => {
  state.permissions = new Set(['papers:read', 'students:read']);
  state.get.mockImplementation(async (path: string) => {
    if (path === '/admin/papers') return { items: [{ id: '25', title: '安全培训 / 一期', mode: 'fixed', status: 'published', duration_minutes: 30 }], total: 1 };
    if (path === '/admin/students') return { items: [{ id: '17', real_name: '测试学员', username: 'test-user', source: 'institution', status: 1 }], total: 1 };
    return { items: [], total: 0 };
  });
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ''; vi.clearAllMocks(); });

async function render(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/admin/papers', component: Papers },
    { path: '/admin/students', component: Students },
    { path: '/admin/exam-records', component: { template: '<div>记录列表</div>' } },
  ] });
  await router.push(path); await router.isReady();
  const wrapper = mount(RouterView, { global: { plugins: [ElementPlus, router], stubs: { MediaUpload: true, StudentAvatar: true, ImportPreview: true } } });
  wrappers.push(wrapper); await flushPromises();
  return { wrapper, router };
}

describe('exam record entrypoints', () => {
  it.each(['/admin/papers', '/admin/students'])('does not expose records from %s without read permission', async (path) => {
    const { wrapper } = await render(path);
    expect(wrapper.findAll('button').some(button => button.text() === '考试记录')).toBe(false);
  });
  it('does not expose records from the paper list even with read permission', async () => {
    state.permissions.add('exam_records:read');
    const { wrapper } = await render('/admin/papers');
    expect(wrapper.findAll('button').some(button => button.text() === '考试记录')).toBe(false);
  });
  it('opens exact learner records without requiring write permission', async () => {
    state.permissions.add('exam_records:read');
    const { wrapper, router } = await render('/admin/students');
    const action = wrapper.findAll('button').find(button => button.text() === '考试记录');
    expect(action).toBeDefined();
    await action!.trigger('click'); await flushPromises();
    expect(router.currentRoute.value.path).toBe('/admin/exam-records');
    expect(router.currentRoute.value.query).toEqual({ user_id: '17', learner_name: '测试学员' });
  });
});
