import { Editor, type JSONContent } from '@tiptap/core';
import { EditorContent } from '@tiptap/vue-3';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TiptapEditor from '../index.vue';
import { createExtensions } from '../utils/createExtensions';

type Resolver = (assetId: string) => Promise<Blob>;
const editors: Editor[] = [];
const wrappers: VueWrapper[] = [];
const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const createObjectURL = vi.fn<(blob: Blob) => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function mediaDocument(assetId = '9007199254741201', alt: string | null = '受控示意图'): JSONContent {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'mediaImage', attrs: { asset_id: assetId, alt }, marks: [{ type: 'bold' }] }],
    }],
  };
}

function mountEditor(resolver?: Resolver, content = mediaDocument(), onUpdate = vi.fn()) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = new Editor({
    element: host,
    content,
    extensions: createExtensions('rich', {}, resolver),
    onUpdate,
  });
  editors.push(editor);
  return editor;
}

function mediaDom(editor: Editor): HTMLElement {
  const result = editor.view.dom.querySelector<HTMLElement>('[data-media-id]');
  expect(result).not.toBeNull();
  return result!;
}

function image(editor: Editor): HTMLImageElement {
  const result = mediaDom(editor).querySelector('img');
  expect(result).toBeInstanceOf(HTMLImageElement);
  return result!;
}

async function settle() {
  await flushPromises();
  await nextTick();
}

function changeAsset(editor: Editor, assetId: string, alt: string | null = '新示意图') {
  editor.view.dispatch(editor.state.tr.setNodeMarkup(1, undefined, { asset_id: assetId, alt }));
}

beforeEach(() => {
  let count = 0;
  createObjectURL.mockReset().mockImplementation(() => `blob:controlled-media-${++count}`);
  revokeObjectURL.mockReset();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
});

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  editors.splice(0).forEach((editor) => { if (!editor.isDestroyed) editor.destroy(); });
  if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
  else Reflect.deleteProperty(URL, 'createObjectURL');
  if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
  else Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('controlled media image NodeView', () => {
  it('keeps the existing explicit placeholder when no resolver is supplied', async () => {
    const editor = mountEditor();
    await settle();

    expect(mediaDom(editor).textContent).toContain('9007199254741201');
    expect(mediaDom(editor).dataset.controlledMediaPlaceholder).toBe('true');
    expect(mediaDom(editor).querySelector('img')).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(editor.getHTML()).not.toContain('src=');
  });

  it('shows loading then the resolved image without persisting a URL or changing JSON, marks or HTML', async () => {
    const pending = deferred<Blob>();
    const resolver = vi.fn(() => pending.promise);
    const onUpdate = vi.fn();
    const editor = mountEditor(resolver, mediaDocument(), onUpdate);
    const before = editor.getJSON();
    const html = editor.getHTML();
    await settle();

    expect(resolver.mock.calls).toEqual([['9007199254741201']]);
    expect(mediaDom(editor).textContent).toContain('加载中');
    const blob = new Blob(['image-bytes'], { type: 'image/png' });
    pending.resolve(blob);
    await settle();
    const resolvedImage = image(editor);
    expect(resolvedImage.getAttribute('src')).toBe('blob:controlled-media-1');
    expect(resolvedImage.alt).toBe('受控示意图');
    expect(resolvedImage.hidden).toBe(true);
    expect(mediaDom(editor).textContent).toContain('加载中');

    resolvedImage.dispatchEvent(new Event('load'));
    expect(resolvedImage.hidden).toBe(false);
    expect(mediaDom(editor).dataset.controlledMediaPlaceholder).toBe('false');
    expect(createObjectURL.mock.calls).toEqual([[blob]]);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.getHTML()).toBe(html);
    expect(html).toContain('<strong>');
    expect(html).not.toMatch(/src=|blob:|token/);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each(['rejected promise', 'synchronous throw'])('shows an explicit failure for a %s', async (failure) => {
    const resolver = vi.fn((): Promise<Blob> => {
      if (failure === 'synchronous throw') throw new Error('internal resolver detail');
      return Promise.reject(new Error('internal resolver detail'));
    });
    const editor = mountEditor(resolver);
    const before = editor.getJSON();
    await settle();

    expect(mediaDom(editor).textContent).toContain('加载失败');
    expect(mediaDom(editor).textContent).not.toContain('internal resolver detail');
    expect(mediaDom(editor).querySelector('img')).toBeNull();
    expect(editor.getJSON()).toEqual(before);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('revokes a URL and returns to a visible failure placeholder when image decoding fails', async () => {
    const editor = mountEditor(async () => new Blob(['invalid-image']));
    await settle();
    image(editor).dispatchEvent(new Event('error'));

    expect(mediaDom(editor).textContent).toContain('加载失败');
    expect(mediaDom(editor).querySelector('img')).toBeNull();
    expect(revokeObjectURL.mock.calls).toEqual([['blob:controlled-media-1']]);
    editor.destroy();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('keeps the resolved image attached when its load state changes', async () => {
    const editor = mountEditor(async () => new Blob(['image']));
    await settle();
    const resolvedImage = image(editor);
    const observer = new MutationObserver(() => {});
    observer.observe(mediaDom(editor), { childList: true });

    resolvedImage.dispatchEvent(new Event('load'));
    const removed = observer.takeRecords().flatMap((record) => Array.from(record.removedNodes));
    observer.disconnect();
    expect(removed).not.toContain(resolvedImage);
    expect(resolvedImage.hidden).toBe(false);
  });

  it('revokes the previous URL immediately when the asset changes and loads the new asset', async () => {
    const next = deferred<Blob>();
    const resolver = vi.fn((assetId: string) => assetId === '2' ? next.promise : Promise.resolve(new Blob(['first'])));
    const editor = mountEditor(resolver);
    await settle();
    const oldImage = image(editor);
    oldImage.dispatchEvent(new Event('load'));

    changeAsset(editor, '2');
    await settle();
    expect(revokeObjectURL.mock.calls).toEqual([['blob:controlled-media-1']]);
    expect(mediaDom(editor).dataset.mediaId).toBe('2');
    expect(mediaDom(editor).textContent).toContain('加载中');
    expect(mediaDom(editor).querySelector('img')).toBeNull();
    oldImage.dispatchEvent(new Event('load'));
    expect(mediaDom(editor).textContent).toContain('加载中');

    next.resolve(new Blob(['second']));
    await settle();
    expect(image(editor).getAttribute('src')).toBe('blob:controlled-media-2');
    expect(image(editor).alt).toBe('新示意图');
    expect(resolver.mock.calls.map(([assetId]) => assetId)).toEqual(['9007199254741201', '2']);
  });

  it('ignores a late old Blob without allocating a URL or replacing the new image', async () => {
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    const editor = mountEditor((assetId) => assetId === '2' ? second.promise : first.promise);
    await settle();
    changeAsset(editor, '2');
    second.resolve(new Blob(['second']));
    await settle();
    image(editor).dispatchEvent(new Event('load'));

    first.resolve(new Blob(['late-first']));
    await settle();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(image(editor).getAttribute('src')).toBe('blob:controlled-media-1');
    expect(mediaDom(editor).dataset.mediaId).toBe('2');
    expect(mediaDom(editor).dataset.controlledMediaPlaceholder).toBe('false');
  });

  it('does not let a late rejection replace a newer successful image', async () => {
    const old = deferred<Blob>();
    const editor = mountEditor((assetId) => assetId === '2' ? Promise.resolve(new Blob(['new'])) : old.promise);
    await settle();
    changeAsset(editor, '2');
    await settle();
    image(editor).dispatchEvent(new Event('load'));

    old.reject(new Error('late failure'));
    await settle();
    expect(mediaDom(editor).dataset.controlledMediaPlaceholder).toBe('false');
    expect(mediaDom(editor).textContent).not.toContain('加载失败');
    expect(image(editor).getAttribute('src')).toBe('blob:controlled-media-1');
  });

  it('revokes the active resource on editor destruction', async () => {
    const editor = mountEditor(async () => new Blob(['first']));
    await settle();
    const resolvedImage = image(editor);
    resolvedImage.dispatchEvent(new Event('load'));
    editor.destroy();

    expect(revokeObjectURL.mock.calls).toEqual([['blob:controlled-media-1']]);
    expect(resolvedImage.getAttribute('src')).toBeNull();
  });

  it('does not allocate a resource or update detached DOM when a Blob resolves after destruction', async () => {
    const pending = deferred<Blob>();
    const editor = mountEditor(() => pending.promise);
    const dom = mediaDom(editor);
    await settle();
    editor.destroy();
    const textAfterDestroy = dom.textContent;
    pending.resolve(new Blob(['late']));
    await settle();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(dom.querySelector('img')).toBeNull();
    expect(dom.textContent).toBe(textAfterDestroy);
  });

  it('releases the resource when the image node is removed from the document', async () => {
    const editor = mountEditor(async () => new Blob(['first']));
    await settle();
    expect(image(editor).getAttribute('src')).toBe('blob:controlled-media-1');

    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(editor.view.dom.querySelector('[data-media-id]')).toBeNull();
    expect(revokeObjectURL.mock.calls).toEqual([['blob:controlled-media-1']]);
  });

  it('updates alt text without refetching an unchanged asset', async () => {
    const resolver = vi.fn(async () => new Blob(['first']));
    const editor = mountEditor(resolver);
    await settle();
    image(editor).dispatchEvent(new Event('load'));
    changeAsset(editor, '9007199254741201', '<b>新的说明</b>');
    await settle();

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(image(editor).alt).toBe('<b>新的说明</b>');
    expect(mediaDom(editor).getAttribute('aria-label')).toBe('<b>新的说明</b>');
    expect(mediaDom(editor).querySelector('b')).toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('keeps identical assets in separate editors independent', async () => {
    const first = mountEditor(async () => new Blob(['one']));
    const second = mountEditor(async () => new Blob(['two']));
    await settle();
    expect(image(first).getAttribute('src')).toBe('blob:controlled-media-1');
    expect(image(second).getAttribute('src')).toBe('blob:controlled-media-2');
    first.destroy();

    expect(revokeObjectURL.mock.calls).toEqual([['blob:controlled-media-1']]);
    expect(image(second).getAttribute('src')).toBe('blob:controlled-media-2');
    image(second).dispatchEvent(new Event('load'));
    expect(mediaDom(second).dataset.controlledMediaPlaceholder).toBe('false');
  });

  it('does not pass an invalid asset ID to the resolver', async () => {
    const resolver = vi.fn(async () => new Blob(['unused']));
    const editor = mountEditor(resolver, mediaDocument('https://example.invalid/image'));
    await settle();

    expect(resolver).not.toHaveBeenCalled();
    expect(mediaDom(editor).textContent).toContain('无效资源');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('passes the host resolver through the real readonly Tiptap component without document writes', async () => {
    const resolver = vi.fn(async (_assetId: string) => new Blob(['image']));
    const wrapper = mount(TiptapEditor, {
      props: {
        modelValue: mediaDocument(),
        mediaResolver: resolver,
        profile: 'rich',
        mode: 'preview',
        presentation: 'inline',
        showToolbar: false,
        showPanels: false,
      },
      global: { plugins: [ElementPlus] },
    });
    wrappers.push(wrapper);
    await settle();
    const editor = wrapper.findComponent(EditorContent).props('editor') as Editor;
    const before = editor.getJSON();
    const resolvedImage = wrapper.find('[data-media-id] img');
    expect(resolvedImage.exists()).toBe(true);
    await resolvedImage.trigger('load');

    // EditorContent recreates NodeViews when attaching its DOM to the editor.
    expect(resolver.mock.calls.length).toBeGreaterThan(0);
    expect(resolver.mock.calls.every(([assetId]) => assetId === '9007199254741201')).toBe(true);
    expect(wrapper.find('[data-controlled-media-placeholder="false"] img').exists()).toBe(true);
    expect(editor.isEditable).toBe(false);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.getHTML()).not.toContain('blob:');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    const allocated = createObjectURL.mock.results.map((result) => result.value as string);
    wrapper.unmount();
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining(allocated));
    expect(revokeObjectURL).toHaveBeenCalledTimes(allocated.length);
  });
});
