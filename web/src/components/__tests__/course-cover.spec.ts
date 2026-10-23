import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import CourseCover from '../CourseCover.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn() }));
vi.mock('../../api/http', () => ({ default: { get: mocks.get } }));

const wrappers = new Set<VueWrapper>();

function imageResponse(blob: Blob) {
  return {
    data: blob, status: 200, statusText: 'OK', headers: { 'content-type': blob.type },
    config: { headers: {}, responseType: 'blob' },
  };
}

function deferred() {
  let resolve!: (value: ReturnType<typeof imageResponse>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ReturnType<typeof imageResponse>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function render(props: { assetId?: string | null; alt?: string } = {}) {
  const wrapper = mount(CourseCover, {
    props, attachTo: document.body, global: { plugins: [ElementPlus] },
  });
  wrappers.add(wrapper);
  return wrapper;
}

function unmount(wrapper: VueWrapper) {
  wrapper.unmount();
  wrappers.delete(wrapper);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockRejectedValue(new Error('Unexpected image request'));
  mocks.createUrl.mockReturnValue('blob:course-cover');
  const BrowserUrl = globalThis.URL;
  // jsdom does not implement object URLs; keep its URL parsing behavior real.
  vi.stubGlobal('URL', class extends BrowserUrl {
    static createObjectURL = mocks.createUrl;
    static revokeObjectURL = mocks.revokeUrl;
  });
});

afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount());
  wrappers.clear();
  vi.unstubAllGlobals();
});

describe('CourseCover', () => {
  it.each([
    ['omitted', undefined],
    ['null', null],
    ['empty', ''],
  ] as const)('shows the empty cover without requesting media when assetId is %s', async (_label, assetId) => {
    const wrapper = render(assetId === undefined ? {} : { assetId });
    await flushPromises();

    expect(wrapper.text()).toBe('暂无封面');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.createUrl).not.toHaveBeenCalled();
  });

  it('loads a Blob through the controlled image API and opens that image in the viewer', async () => {
    const request = deferred();
    const blob = new Blob(['course cover'], { type: 'image/png' });
    mocks.get.mockReturnValue(request.promise);
    const wrapper = render({ assetId: 'cover/21', alt: '建筑施工安全封面' });

    expect(wrapper.text()).toBe('加载中');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/media/cover%2F21/content', { responseType: 'blob' });

    request.resolve(imageResponse(blob));
    await flushPromises();

    const image = wrapper.get('img');
    expect(image.attributes('src')).toBe('blob:course-cover');
    expect(image.attributes('alt')).toBe('建筑施工安全封面');
    expect(mocks.createUrl).toHaveBeenCalledTimes(1);
    expect(mocks.createUrl.mock.calls[0]![0]).toBe(blob);
    expect(wrapper.text()).not.toContain('加载中');
    expect(document.body.querySelector('.el-image-viewer__wrapper')).toBeNull();

    await image.trigger('load');
    await image.trigger('click');
    await flushPromises();

    const viewer = document.body.querySelector('.el-image-viewer__wrapper');
    expect(viewer).not.toBeNull();
    expect(viewer!.querySelector('img')!.getAttribute('src')).toBe('blob:course-cover');
    expect(wrapper.element.contains(viewer)).toBe(false);
  });

  it('shows a load failure without creating an object URL when the image API rejects', async () => {
    const request = deferred();
    mocks.get.mockReturnValue(request.promise);
    const wrapper = render({ assetId: 'cover-a' });
    expect(wrapper.text()).toBe('加载中');

    request.reject(new Error('Image access denied'));
    await flushPromises();

    expect(wrapper.text()).toBe('加载失败');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(document.body.querySelector('.el-image-viewer__wrapper')).toBeNull();
    expect(mocks.createUrl).not.toHaveBeenCalled();
  });

  it.each(['before', 'after'] as const)(
    'keeps the current asset when the previous response arrives %s the current response',
    async (order) => {
      const previous = deferred();
      const current = deferred();
      const oldBlob = new Blob(['previous cover'], { type: 'image/png' });
      const newBlob = new Blob(['current cover'], { type: 'image/png' });
      mocks.get.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
      mocks.createUrl.mockReturnValue('blob:current-cover');
      const wrapper = render({ assetId: 'cover-a' });

      await wrapper.setProps({ assetId: 'cover-b' });
      expect(wrapper.text()).toBe('加载中');
      expect(wrapper.find('img').exists()).toBe(false);
      expect(mocks.get).toHaveBeenNthCalledWith(2, '/media/cover-b/content', { responseType: 'blob' });

      if (order === 'before') {
        previous.resolve(imageResponse(oldBlob));
        await flushPromises();
        expect(wrapper.text()).toBe('加载中');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(mocks.createUrl).not.toHaveBeenCalled();
        current.resolve(imageResponse(newBlob));
      } else {
        current.resolve(imageResponse(newBlob));
        await flushPromises();
        expect(wrapper.get('img').attributes('src')).toBe('blob:current-cover');
        previous.resolve(imageResponse(oldBlob));
      }
      await flushPromises();

      expect(wrapper.get('img').attributes('src')).toBe('blob:current-cover');
      expect(wrapper.text()).not.toContain('加载失败');
      expect(mocks.createUrl).toHaveBeenCalledTimes(1);
      expect(mocks.createUrl.mock.calls[0]![0]).toBe(newBlob);
      expect(mocks.revokeUrl).not.toHaveBeenCalled();
    },
  );

  it('does not replace the current cover with a failure from the previous asset', async () => {
    const previous = deferred();
    const newBlob = new Blob(['current cover'], { type: 'image/png' });
    mocks.get.mockReturnValueOnce(previous.promise).mockResolvedValueOnce(imageResponse(newBlob));
    const wrapper = render({ assetId: 'cover-a' });

    await wrapper.setProps({ assetId: 'cover-b' });
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('blob:course-cover');

    previous.reject(new Error('Previous image access denied'));
    await flushPromises();

    expect(wrapper.get('img').attributes('src')).toBe('blob:course-cover');
    expect(wrapper.text()).not.toContain('加载失败');
    expect(mocks.createUrl).toHaveBeenCalledTimes(1);
    expect(mocks.createUrl.mock.calls[0]![0]).toBe(newBlob);
  });

  it('reclaims the previous object URL on asset change and the current URL on unmount', async () => {
    const current = deferred();
    mocks.get
      .mockResolvedValueOnce(imageResponse(new Blob(['previous cover'], { type: 'image/png' })))
      .mockReturnValueOnce(current.promise);
    mocks.createUrl.mockReturnValueOnce('blob:previous-cover').mockReturnValueOnce('blob:current-cover');
    const wrapper = render({ assetId: 'cover-a' });
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('blob:previous-cover');
    expect(mocks.revokeUrl).not.toHaveBeenCalled();

    await wrapper.setProps({ assetId: 'cover-b' });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toBe('加载中');
    expect(mocks.revokeUrl).toHaveBeenCalledTimes(1);
    expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:previous-cover');

    current.resolve(imageResponse(new Blob(['current cover'], { type: 'image/png' })));
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('blob:current-cover');
    expect(mocks.revokeUrl).toHaveBeenCalledTimes(1);

    unmount(wrapper);

    expect(mocks.revokeUrl.mock.calls).toEqual([['blob:previous-cover'], ['blob:current-cover']]);
    expect(wrapper.element.isConnected).toBe(false);
  });

  it('clears the displayed cover and reclaims its URL without another request when assetId is removed', async () => {
    mocks.get.mockResolvedValue(imageResponse(new Blob(['cover'], { type: 'image/png' })));
    const wrapper = render({ assetId: 'cover-a' });
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('blob:course-cover');

    await wrapper.setProps({ assetId: null });

    expect(wrapper.text()).toBe('暂无封面');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.revokeUrl).toHaveBeenCalledTimes(1);
    expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:course-cover');

    unmount(wrapper);
    expect(mocks.revokeUrl).toHaveBeenCalledTimes(1);
  });

  it('does not create an object URL when a pending request finishes after unmount', async () => {
    const request = deferred();
    mocks.get.mockReturnValue(request.promise);
    const wrapper = render({ assetId: 'cover-a' });
    expect(wrapper.text()).toBe('加载中');

    unmount(wrapper);
    request.resolve(imageResponse(new Blob(['late cover'], { type: 'image/png' })));
    await flushPromises();

    expect(wrapper.element.isConnected).toBe(false);
    expect(document.body.querySelector('img')).toBeNull();
    expect(mocks.createUrl).not.toHaveBeenCalled();
    expect(mocks.revokeUrl).not.toHaveBeenCalled();
  });

  it('keeps the empty cover when a pending request finishes after assetId is cleared', async () => {
    const request = deferred();
    mocks.get.mockReturnValue(request.promise);
    const wrapper = render({ assetId: 'cover-a' });

    await wrapper.setProps({ assetId: '' });
    expect(wrapper.text()).toBe('暂无封面');

    request.resolve(imageResponse(new Blob(['late cover'], { type: 'image/png' })));
    await flushPromises();

    expect(wrapper.text()).toBe('暂无封面');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.createUrl).not.toHaveBeenCalled();
    expect(mocks.revokeUrl).not.toHaveBeenCalled();
  });
});
