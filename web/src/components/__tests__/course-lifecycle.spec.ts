import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, KeepAlive } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import ElementPlus, { ElDialog } from 'element-plus';
import Courses from '../../views/admin/Courses.vue';
import CourseEditor from '../../views/admin/CourseEditor.vue';
import { confirmUnsavedChanges } from '../../composables/useUnsavedChanges';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../../api/http', () => ({ default: { get: mocks.get, put: mocks.put } }));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: () => true }) }));

const course = { id: '11', title: '施工安全', category_id: '10', description: '已保存简介', cover_asset_id: null,
  status: 'draft', is_recommended: false, sort_order: 0, required_lesson_count: 0, chapters: [] };
const wrappers: VueWrapper[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/admin/courses/category-options') return { items: [{ id: '10', name: '产业工人' }] };
    if (url === '/admin/courses') return { items: [structuredClone(course)], total: 1 };
    if (url === '/admin/courses/11') return structuredClone(course);
    throw new Error(url);
  });
  mocks.put.mockResolvedValue({});
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); });

async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/courses', component: Courses }, { path: '/other', component: { render: () => h('div', '其他页面') } },
  ] });
  await router.push('/courses');
  const shell = defineComponent({ render: () => h(RouterView, null, {
    default: ({ Component }: { Component: object }) => h(KeepAlive, null, [h(Component)]),
  }) });
  const wrapper = mount(shell, { attachTo: document.body, global: { plugins: [router, ElementPlus], stubs: { MediaUpload: true } } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}
async function click(wrapper: VueWrapper, label: string) {
  await wrapper.findAll('button').find(item => item.text() === label)!.trigger('click');
  await flushPromises();
}

describe('course dialog route lifecycle', () => {
  it('destroys nested body dialogs when the cached course page deactivates', async () => {
    const { wrapper, router } = await render();
    await click(wrapper, '章节管理');
    await click(wrapper, '新增章节');
    expect(document.body.textContent).toContain('章节标题');
    await router.push('/other');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/other');
    expect(wrapper.findComponent(CourseEditor).exists()).toBe(false);
    expect(document.body.textContent).not.toContain('章节标题');
    await router.push('/courses');
    await flushPromises();
    expect(wrapper.findAllComponents(ElDialog).some(dialog => dialog.props('modelValue'))).toBe(false);
    expect(wrapper.findComponent(CourseEditor).exists()).toBe(false);
  });

  it('blocks router, tab confirmation and native unload while a write is pending with no dirty draft', async () => {
    const { wrapper, router } = await render();
    await click(wrapper, '修改课程');
    const state = (wrapper.findComponent(CourseEditor).vm.$ as any).setupState;
    let resolveWrite!: () => void;
    mocks.put.mockReturnValueOnce(new Promise<void>(resolve => { resolveWrite = resolve; }));
    state.form.description = '提交的 B';
    const saving = state.saveCourse();
    state.form.description = course.description;
    await flushPromises();
    expect(state.courseDirty).toBe(false);
    await router.push('/other');
    expect(router.currentRoute.value.path).toBe('/courses');
    expect(await confirmUnsavedChanges('/courses')).toBe(false);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    resolveWrite();
    await saving;
    await flushPromises();
  });
});
