import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import CourseCover from '../CourseCover.vue';
import { invalidateMediaContext } from '../../services/media-context';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), invalidate: vi.fn() }));
vi.mock('../../services/media-content', () => ({ resolvePcMedia: mocks.resolve, invalidatePcMedia: mocks.invalidate }));
const wrappers = new Set<VueWrapper>();
const url = (id: string) => `/api/v1/media/preview-tickets/asset${id}.signature/content`;
const ticket = (id: string) => ({ content_url: url(id), expires_at: '2099-01-01T00:00:00.000Z' });
function deferred() {
  let resolve!: (value: ReturnType<typeof ticket>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ReturnType<typeof ticket>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function render(assetId?: string | null) {
  const wrapper = mount(CourseCover, { props: { assetId, alt: '建筑施工安全封面' }, attachTo: document.body, global: { plugins: [ElementPlus] } });
  wrappers.add(wrapper); return wrapper;
}
beforeEach(() => { vi.resetAllMocks(); mocks.resolve.mockImplementation(async id => ticket(id)); });
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.clear(); });

describe('CourseCover controlled URL display', () => {
  it.each([undefined, null, ''])('keeps an empty cover out of the network (%s)', async assetId => {
    const wrapper = render(assetId); await flushPromises();
    expect(wrapper.text()).toBe('暂无封面'); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('opens the controlled URL directly in the image viewer', async () => {
    const wrapper = render('21'); await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe(url('21'));
    expect(wrapper.get('img').attributes('alt')).toBe('建筑施工安全封面');
    await wrapper.get('img').trigger('load'); await wrapper.get('img').trigger('click'); await flushPromises();
    expect(document.body.querySelector('.el-image-viewer__wrapper img')?.getAttribute('src')).toBe(url('21'));
  });
  it.each(['before', 'after'])('ignores a previous asset response arriving %s its replacement', async order => {
    const previous = deferred(); const current = deferred();
    mocks.resolve.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    const wrapper = render('21'); await wrapper.setProps({ assetId: '22' });
    if (order === 'before') { previous.resolve(ticket('21')); await flushPromises(); expect(wrapper.find('img').exists()).toBe(false); current.resolve(ticket('22')); }
    else { current.resolve(ticket('22')); await flushPromises(); previous.resolve(ticket('21')); }
    await flushPromises(); expect(wrapper.get('img').attributes('src')).toBe(url('22'));
  });
  it('ignores late rejection and cancels the previous ticket request on replacement', async () => {
    const previous = deferred(); mocks.resolve.mockReturnValueOnce(previous.promise);
    const wrapper = render('21'); const signal = mocks.resolve.mock.calls[0][1] as AbortSignal;
    await wrapper.setProps({ assetId: '22' }); previous.reject(new Error('old denied')); await flushPromises();
    expect(signal.aborted).toBe(true); expect(wrapper.get('img').attributes('src')).toBe(url('22'));
  });
  it('does not show a response after clearing the asset or unmounting', async () => {
    const request = deferred(); mocks.resolve.mockReturnValueOnce(request.promise);
    const wrapper = render('21'); await wrapper.setProps({ assetId: null }); request.resolve(ticket('21')); await flushPromises();
    expect(wrapper.text()).toBe('暂无封面'); expect(wrapper.find('img').exists()).toBe(false);
    await wrapper.setProps({ assetId: '22' }); const signal = mocks.resolve.mock.calls.at(-1)![1] as AbortSignal;
    wrapper.unmount(); wrappers.delete(wrapper); expect(signal.aborted).toBe(true);
  });
  it('reports a denied ticket and refreshes an address once when image loading fails', async () => {
    mocks.resolve.mockRejectedValueOnce(new Error('denied'));
    const wrapper = render('21'); await flushPromises(); expect(wrapper.text()).toBe('加载失败');
    await wrapper.setProps({ assetId: '22' }); await flushPromises();
    await wrapper.get('img').trigger('error'); await flushPromises();
    expect(mocks.invalidate).toHaveBeenCalledWith('22'); expect(mocks.resolve).toHaveBeenCalledTimes(3);
    await wrapper.get('img').trigger('error'); await flushPromises(); expect(wrapper.text()).toBe('加载失败');
  });
  it('clears an old account image immediately before applying any new ticket', async () => {
    const wrapper = render('21'); await flushPromises();
    invalidateMediaContext();
    await flushPromises(); expect(wrapper.find('img').exists()).toBe(false);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ assetId: '22' }); await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe(url('22'));
  });
});
