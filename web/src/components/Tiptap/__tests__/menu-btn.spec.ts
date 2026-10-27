import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import MenuBtn from '../components/MenuBtn.vue';

const wrappers: VueWrapper[] = [];

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});

describe('Tiptap menu button', () => {
  it('mounts the font-size popover and tooltip without Vue root-node directive warnings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    wrappers.push(mount(MenuBtn, { global: { plugins: [ElementPlus] } }));
    await flushPromises();

    const rootNodeDirectiveWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes('Runtime directive used on component with non-element root node'),
    );
    expect(rootNodeDirectiveWarnings).toEqual([]);
  });
});
