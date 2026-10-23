import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import MediaUpload from '../MediaUpload.vue';

const mocks = vi.hoisted(() => ({ limits: vi.fn(), metadata: vi.fn(), image: vi.fn(), upload: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn() }));
vi.mock('../../api/media', () => ({ getMediaLimits: mocks.limits, getMediaMetadata: mocks.metadata, getMediaImageContent: mocks.image, uploadMedia: mocks.upload }));
const wrappers: VueWrapper[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.limits.mockResolvedValue({ image_max_bytes: 10485760, video_max_bytes: 536870912, allowed_image_types: ['image/png'], allowed_video_types: ['video/mp4'] });
  mocks.metadata.mockImplementation(async (assetId: string) => ({ asset_id: assetId, purpose: 'course_cover', media_kind: 'image', original_name: '课程封面.png', status: 'ready', duration_ms: null }));
  mocks.image.mockResolvedValue(new Blob(['cover'], { type: 'image/png' }));
  mocks.upload.mockResolvedValue({ asset_id: '22', status: 'ready', duration_ms: null });
  mocks.createUrl.mockReturnValue('blob:preview');
  const BrowserUrl = globalThis.URL;
  vi.stubGlobal('URL', class extends BrowserUrl { static createObjectURL = mocks.createUrl; static revokeObjectURL = mocks.revokeUrl; });
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals(); });
async function render(props: Record<string, unknown> = {}) {
  const wrapper = mount(MediaUpload, { props: { purpose: 'course_cover', listType: 'picture-card', ...props }, attachTo: document.body, global: { plugins: [ElementPlus] } });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
async function select(wrapper: VueWrapper, file: File) {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
  await input.trigger('change'); await flushPromises();
}
describe('MediaUpload picture cards', () => {
  it('uses an Element Plus drag area and the existing validated upload flow for course videos', async () => {
    mocks.upload.mockResolvedValue({ asset_id: '32', status: 'ready', duration_ms: 12000 });
    mocks.metadata.mockResolvedValue({ asset_id: '32', purpose: 'video', media_kind: 'video', original_name: 'lesson.mp4', status: 'ready', duration_ms: 12000 });
    const wrapper = await render({ purpose: 'video', listType: 'drag' });
    expect(wrapper.find('.el-upload-dragger').exists()).toBe(true);
    expect(wrapper.text()).toContain('拖到此处');
    expect(wrapper.text()).toContain('video/mp4');
    const file = new File(['video'], 'lesson.mp4', { type: 'video/mp4' });
    await wrapper.get('.el-upload-dragger').trigger('drop', { dataTransfer: { files: [file] } });
    await flushPromises();
    expect(mocks.upload).toHaveBeenCalledWith(file, 'video', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['32']);
    expect(wrapper.emitted('pending')).toContainEqual([true]);
    expect(wrapper.emitted('pending')?.at(-1)).toEqual([false]);
    expect(wrapper.text()).toContain('已就绪');
    expect(wrapper.text()).toContain('时长 0:12');
    expect(wrapper.find('.el-upload-list--picture-card').exists()).toBe(false);
  });

  it('keeps invalid and disabled drag uploads out of the network', async () => {
    const wrapper = await render({ purpose: 'video', listType: 'drag' });
    await select(wrapper, new File(['bad'], 'bad.txt', { type: 'text/plain' }));
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).not.toBe('');
    expect(wrapper.emitted('pending')?.at(-1)).toEqual([true]);
    await wrapper.setProps({ disabled: true });
    await select(wrapper, new File(['video'], 'lesson.mp4', { type: 'video/mp4' }));
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('hides routine metadata in compact mode while retaining load errors and retry', async () => {
    const wrapper = await render({ purpose: 'avatar', compact: true, modelValue: '21' });
    expect(wrapper.find('.media-upload__hint').exists()).toBe(false);
    expect(wrapper.find('.media-upload__summary').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(true);
    mocks.metadata.mockRejectedValueOnce(new Error('媒体读取失败'));
    await wrapper.setProps({ modelValue: '23' });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('媒体读取失败');
    expect(wrapper.text()).toContain('重新查询');
  });
  it('uses the Element Plus thumbnail, preview and remove actions for an existing cover', async () => {
    const wrapper = await render({ modelValue: '21' });
    expect(wrapper.find('.el-upload-list--picture-card').exists()).toBe(true);
    expect(wrapper.findAll('.el-upload-list__item')).toHaveLength(1);
    expect(wrapper.find('img').attributes('src')).toBe('blob:preview');
    await wrapper.get('button[aria-label="预览文件"]').trigger('click');
    expect(document.body.querySelector('.el-image-viewer__wrapper')).not.toBeNull();
    await wrapper.get('button[aria-label="移除文件"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null]);
    await wrapper.setProps({ modelValue: null });
    await flushPromises();
    expect(wrapper.findAll('.el-upload-list__item')).toHaveLength(0);
    expect(document.body.querySelector('.el-image-viewer__wrapper')).toBeNull();
  });
  it('uploads a selected image through the existing media contract and rejects invalid formats', async () => {
    const wrapper = await render();
    expect(wrapper.find('.el-upload--picture-card').exists()).toBe(true);
    const file = new File(['cover'], 'cover.png', { type: 'image/png' });
    await select(wrapper, file);
    expect(mocks.upload).toHaveBeenCalledWith(file, 'course_cover', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['22']);
    await wrapper.get('button[aria-label="移除文件"]').trigger('click');
    await select(wrapper, new File(['bad'], 'bad.txt', { type: 'text/plain' }));
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[role="alert"]').text()).not.toBe('');
  });
  it('previews a selected local video while retaining server processing and duration status', async () => {
    mocks.upload.mockResolvedValue({ asset_id: '32', status: 'ready', duration_ms: 12000 });
    mocks.metadata.mockResolvedValue({ asset_id: '32', purpose: 'video', media_kind: 'video', original_name: 'lesson.mp4', status: 'ready', duration_ms: 12000 });
    const wrapper = await render({ purpose: 'video' });
    await select(wrapper, new File(['video'], 'lesson.mp4', { type: 'video/mp4' }));
    expect(wrapper.findAll('.el-upload-list__item')).toHaveLength(1);
    expect(wrapper.text()).toContain('时长 0:12');
    await wrapper.get('button[aria-label="预览文件"]').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('.media-upload__video-player')?.getAttribute('src')).toBe('blob:preview');
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it('keeps keyboard removal synchronized with the saved form binding', async () => {
    const wrapper = await render({ modelValue: '21' });
    await wrapper.get('.el-upload-list__item').trigger('keydown', { key: 'Delete' });
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null]);
  });
  it('reclaims Element Plus temporary preview URLs as well as its own local video URL', async () => {
    mocks.createUrl.mockReturnValueOnce('blob:element-temp').mockReturnValueOnce('blob:local-video');
    mocks.metadata.mockResolvedValue({ asset_id: '22', purpose: 'video', media_kind: 'video', original_name: 'lesson.mp4', status: 'ready', duration_ms: 12000 });
    const wrapper = await render({ purpose: 'video' });
    await select(wrapper, new File(['video'], 'lesson.mp4', { type: 'video/mp4' }));
    expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:element-temp');
    await wrapper.get('button[aria-label="移除文件"]').trigger('click');
    expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:local-video');
  });
});
