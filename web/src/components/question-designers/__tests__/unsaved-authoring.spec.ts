import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { useUnsavedChanges } from '../../../composables/useUnsavedChanges';

afterEach(() => vi.restoreAllMocks());

describe('authoring receipt leave protection', () => {
  it('keeps an unknown receipt on the active route without offering discard', async () => {
    const dirty = ref(true); let blocked = 0;
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('未确认回执不能丢弃'));
    const Page = defineComponent({ setup() { useUnsavedChanges(dirty, { canDiscard: () => false, onBlocked: () => { blocked += 1; } }); return () => h('p', 'pending authoring'); } });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Page }, { path: '/next', component: { render: () => h('p', 'next') } }] });
    await router.push('/'); await router.isReady();
    const wrapper = mount(RouterView, { global: { plugins: [router] } }); await flushPromises();
    await router.push('/next'); await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(blocked).toBe(1); expect(confirm).not.toHaveBeenCalled(); expect(dirty.value).toBe(true);
    wrapper.unmount();
  });
});
