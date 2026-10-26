/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wrappers: VueWrapper[] = [];
const styleNodes: HTMLStyleElement[] = [];
const projectStyles = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8');

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  styleNodes.splice(0).forEach((style) => style.remove());
  [...document.body.classList]
    .filter((className) => className.endsWith('-parent--hidden'))
    .forEach((className) => document.body.classList.remove(className));
  document.body.style.removeProperty('width');
});

describe('modal scroll lock', () => {
  it('locks the layout main scroller while an Element Plus modal is open', async () => {
    const style = document.createElement('style');
    style.textContent = projectStyles;
    document.head.appendChild(style);
    styleNodes.push(style);

    const visible = ref(true);
    const Host = defineComponent({
      setup() {
        return { visible };
      },
      template: `
        <main class="main">
          <el-dialog v-model="visible" title="测试弹窗">弹窗内容</el-dialog>
        </main>
      `,
    });
    const wrapper = mount(Host, {
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });
    wrappers.push(wrapper);

    await nextTick();
    await flushPromises();

    expect(document.body.classList.contains('el-popup-parent--hidden')).toBe(true);
    const main = wrapper.get('.main').element;
    expect(getComputedStyle(main).overflow).toBe('hidden');

    visible.value = false;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushPromises();

    expect(document.body.classList.contains('el-popup-parent--hidden')).toBe(false);
    expect(getComputedStyle(main).overflow).not.toBe('hidden');
  });

  it('locks the layout main scroller for Element Plus service modals', async () => {
    const style = document.createElement('style');
    style.textContent = projectStyles;
    document.head.appendChild(style);
    styleNodes.push(style);

    const main = document.createElement('main');
    main.className = 'main';
    document.body.appendChild(main);
    const pending = ElMessageBox.confirm('确定继续吗？', '测试确认框', {
      cancelButtonText: '取消',
      confirmButtonText: '确定',
    }).catch(() => undefined);

    await nextTick();
    await flushPromises();

    expect(document.body.classList.contains('el-message-box-parent--hidden')).toBe(true);
    expect(getComputedStyle(main).overflow).toBe('hidden');

    const cancel = [...document.querySelectorAll<HTMLButtonElement>('.el-message-box button')]
      .find((button) => button.textContent?.trim() === '取消');
    cancel?.click();
    await pending;
  });

  it('keeps a custom-target dialog overlay inside the content region while locking main', async () => {
    const style = document.createElement('style');
    style.textContent = projectStyles;
    document.head.appendChild(style);
    styleNodes.push(style);

    const visible = ref(false);
    const Host = defineComponent({
      setup() {
        const target = ref<HTMLElement>();
        return { target, visible };
      },
      template: `
        <section class="content-region">
          <div ref="target" class="content-dialog-host" />
          <main class="main">页面内容</main>
          <el-dialog v-if="target" v-model="visible" :append-to="target" title="内页弹窗">弹窗内容</el-dialog>
        </section>
      `,
    });
    const wrapper = mount(Host, {
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });
    wrappers.push(wrapper);

    await nextTick();
    visible.value = true;
    await nextTick();
    await flushPromises();

    const host = wrapper.get('.content-dialog-host');
    const overlay = host.get('.el-overlay');
    expect(host.element.contains(overlay.element)).toBe(true);
    expect(getComputedStyle(overlay.element).position).toBe('absolute');
    expect(getComputedStyle(wrapper.get('.main').element).overflow).toBe('hidden');
  });
});
