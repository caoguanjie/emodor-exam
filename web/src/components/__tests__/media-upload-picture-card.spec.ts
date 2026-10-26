import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import MediaUpload from '../MediaUpload.vue';

const mocks = vi.hoisted(() => ({ limits: vi.fn(), metadata: vi.fn(), image: vi.fn(), video: vi.fn(), upload: vi.fn(), ticket: vi.fn(), task: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn() }));
vi.mock('../../api/media', () => ({ getMediaLimits: mocks.limits, getMediaMetadata: mocks.metadata, getMediaImageContent: mocks.image, getMediaVideoContent: mocks.video, uploadMedia: mocks.upload }));
vi.mock('../../services/media-content', () => ({ resolvePcMedia: mocks.ticket, invalidatePcMedia: vi.fn() }));
vi.mock('../../services/media-upload', () => ({ createMediaUploadTask: mocks.task }));
const remoteUrl = '/api/v1/media/preview-tickets/fixture.signature/content';
const wrappers: VueWrapper[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  mocks.limits.mockResolvedValue({ image_max_bytes: 10485760, video_max_bytes: 536870912, allowed_image_types: ['image/png'], allowed_video_types: ['video/mp4'] });
  mocks.metadata.mockImplementation(async (assetId: string) => ({ asset_id: assetId, purpose: 'course_cover', media_kind: 'image', original_name: '课程封面.png', status: 'ready', duration_ms: null }));
  mocks.image.mockResolvedValue(new Blob(['cover'], { type: 'image/png' }));
  mocks.ticket.mockResolvedValue({ content_url: remoteUrl, expires_at: '2099-01-01T00:00:00.000Z' });
  mocks.upload.mockResolvedValue({ asset_id: '22', status: 'ready', duration_ms: null });
  mocks.createUrl.mockReturnValue('blob:preview');
  const BrowserUrl = globalThis.URL;
  vi.stubGlobal('URL', class extends BrowserUrl { static createObjectURL = mocks.createUrl; static revokeObjectURL = mocks.revokeUrl; });
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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
  it('keeps a ready unbound video previewable without issuing a forbidden metadata read', async () => {
    mocks.upload.mockResolvedValue({ asset_id: '15', status: 'ready', duration_ms: 12000 });
    mocks.metadata.mockRejectedValue(Object.assign(new Error('无权访问该数据'), { code: 40302 }));
    const wrapper = await render({ purpose: 'video', listType: 'drag' });
    await select(wrapper, new File(['video'], '课程.mp4', { type: 'video/mp4' }));
    expect(wrapper.text()).toContain('课程.mp4');
    expect(wrapper.text()).toContain('已就绪');
    expect(wrapper.text()).toContain('时长 0:12');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['15']);
    expect(mocks.metadata).not.toHaveBeenCalled();
    expect(wrapper.get('video.media-upload__video-thumbnail').attributes('src')).toBe('blob:preview');
    expect(wrapper.find('img.media-upload__preview').exists()).toBe(false);
    await wrapper.get('button[aria-label="播放预览"]').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('.media-upload__video-player')?.getAttribute('src')).toBe('blob:preview');
    expect(mocks.video).not.toHaveBeenCalled();
  });

  it('loads an existing course video only when preview is requested and never changes the form binding', async () => {
    const wrapper = await render({ purpose: 'video', listType: 'drag', currentAssetId: '12' });
    expect(mocks.video).not.toHaveBeenCalled();
    await wrapper.get('button[aria-label="播放预览"]').trigger('click');
    await flushPromises();
    expect(mocks.ticket).toHaveBeenCalledWith('12', expect.any(AbortSignal));
    expect(mocks.video).not.toHaveBeenCalled();
    expect(document.body.querySelector('.media-upload__video-player')?.getAttribute('src')).toBe(remoteUrl);
    expect(wrapper.get('video.media-upload__video-thumbnail').attributes('src')).toBe(remoteUrl);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('renews a saved video before its five-minute URL expires and restores position and playing intent', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    mocks.ticket.mockResolvedValueOnce({ content_url: `${remoteUrl}?first-fixture`, expires_at: new Date(Date.now() + 300000).toISOString() })
      .mockResolvedValue({ content_url: `${remoteUrl}?renewed-fixture`, expires_at: new Date(Date.now() + 600000).toISOString() });
    const wrapper = await render({ purpose: 'video', listType: 'drag', currentAssetId: '12' });
    await wrapper.get('button[aria-label="播放预览"]').trigger('click'); await flushPromises();
    const first = document.body.querySelector('.media-upload__video-player') as HTMLVideoElement;
    first.currentTime = 123; Object.defineProperty(first, 'paused', { configurable: true, value: false });
    await vi.advanceTimersByTimeAsync(290000); await flushPromises();
    const renewed = document.body.querySelector('.media-upload__video-player') as HTMLVideoElement;
    expect(renewed.getAttribute('src')).toBe(`${remoteUrl}?renewed-fixture`);
    renewed.dispatchEvent(new Event('loadedmetadata')); await flushPromises();
    expect(renewed.currentTime).toBe(123); expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(mocks.ticket).toHaveBeenCalledTimes(2); expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
  it.each([1000, 5000, 300000].flatMap(ttl => [0, 200, 800].map(latency => ({ ttl, latency }))))('starts renewing before a $ttl ms ticket expires after $latency ms response latency', async ({ ttl, latency }) => {
    vi.useFakeTimers(); const started = Date.now(), calls: number[] = [];
    mocks.ticket.mockImplementation(() => {
      const issued = Date.now(); calls.push(issued);
      return new Promise(resolve => setTimeout(() => resolve({ content_url: `${remoteUrl}?fixture=${calls.length}`, expires_at: new Date(issued + ttl).toISOString() }), latency));
    });
    const wrapper = await render({ purpose: 'video', listType: 'drag', currentAssetId: '12' });
    await wrapper.get('button[aria-label="播放预览"]').trigger('click'); await flushPromises();
    await vi.advanceTimersByTimeAsync(ttl - 1); await flushPromises();
    expect(calls.length).toBeGreaterThanOrEqual(2); expect(calls[1]).toBeLessThan(started + ttl);
  });

  it('retries a transient preview renewal once and retains the captured position across the failed request', async () => {
    vi.useFakeTimers();
    mocks.ticket.mockResolvedValueOnce({ content_url: remoteUrl, expires_at: new Date(Date.now() + 60000).toISOString() })
      .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 0 }))
      .mockResolvedValue({ content_url: `${remoteUrl}?renewed-fixture`, expires_at: new Date(Date.now() + 600000).toISOString() });
    const wrapper = await render({ purpose: 'video', listType: 'drag', currentAssetId: '12' });
    await wrapper.get('button[aria-label="播放预览"]').trigger('click'); await flushPromises();
    (document.body.querySelector('.media-upload__video-player') as HTMLVideoElement).currentTime = 123;
    await vi.advanceTimersByTimeAsync(51000); await flushPromises();
    expect(mocks.ticket).toHaveBeenCalledTimes(3);
    const renewed = document.body.querySelector('.media-upload__video-player') as HTMLVideoElement;
    expect(renewed).not.toBeNull(); renewed.dispatchEvent(new Event('loadedmetadata')); await flushPromises();
    expect(renewed.currentTime).toBe(123); expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('bounds preview address failures to one automatic retry and stops when the dialog closes', async () => {
    vi.useFakeTimers();
    mocks.ticket.mockRejectedValue(Object.assign(new Error('offline'), { code: 0 }));
    const wrapper = await render({ purpose: 'video', listType: 'drag', currentAssetId: '12' });
    await wrapper.get('button[aria-label="播放预览"]').trigger('click'); await flushPromises();
    await vi.advanceTimersByTimeAsync(60000); await flushPromises();
    expect(mocks.ticket).toHaveBeenCalledTimes(2); expect(document.body.textContent).toContain('offline');
    (document.body.querySelector('.el-dialog__headerbtn') as HTMLButtonElement).click(); await flushPromises();
    await vi.advanceTimersByTimeAsync(60000); expect(mocks.ticket).toHaveBeenCalledTimes(2);
  });

  it('does not adopt a late existing-video response after the user selects a replacement', async () => {
    let resolveVideo!: (value: { content_url: string; expires_at: string }) => void;
    mocks.ticket.mockImplementation(() => new Promise(resolve => { resolveVideo = resolve; }));
    const wrapper = await render({ purpose: 'video', listType: 'drag', currentAssetId: '12' });
    await wrapper.get('button[aria-label="播放预览"]').trigger('click');
    await flushPromises();
    const signal = mocks.ticket.mock.calls[0][1] as AbortSignal;
    mocks.upload.mockResolvedValue({ asset_id: '15', status: 'ready', duration_ms: 12000 });
    await select(wrapper, new File(['replacement'], 'new.mp4', { type: 'video/mp4' }));
    expect(signal.aborted).toBe(true);
    const createdBeforeLateResponse = mocks.createUrl.mock.calls.length;
    resolveVideo({ content_url: remoteUrl, expires_at: '2099-01-01T00:00:00.000Z' });
    await flushPromises();
    expect(mocks.createUrl).toHaveBeenCalledTimes(createdBeforeLateResponse);
    expect(wrapper.text()).toContain('new.mp4');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['15']);
    expect(wrapper.get('video.media-upload__video-thumbnail').attributes('src')).toBe('blob:preview');
  });

  it('cancels a loading preview when closed and ignores its late response', async () => {
    let resolveVideo!: (value: { content_url: string; expires_at: string }) => void;
    mocks.ticket.mockImplementation(() => new Promise(resolve => { resolveVideo = resolve; }));
    const wrapper = await render({ purpose: 'video', listType: 'drag', currentAssetId: '12' });
    await wrapper.get('button[aria-label="播放预览"]').trigger('click');
    await flushPromises();
    const signal = mocks.ticket.mock.calls[0][1] as AbortSignal;
    const close = document.body.querySelector('.el-dialog__headerbtn') as HTMLButtonElement;
    close.click();
    await flushPromises();
    expect(signal.aborted).toBe(true);
    resolveVideo({ content_url: remoteUrl, expires_at: '2099-01-01T00:00:00.000Z' });
    await flushPromises();
    expect(mocks.createUrl).not.toHaveBeenCalled();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('pauses playback and releases the video URL when the uploader is destroyed', async () => {
    const wrapper = await render({ purpose: 'video', listType: 'drag' });
    await select(wrapper, new File(['video'], '课程.mp4', { type: 'video/mp4' }));
    await wrapper.get('button[aria-label="播放预览"]').trigger('click');
    await flushPromises();
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:preview');
    expect(document.body.querySelector('.media-upload__video-player')).toBeNull();
  });

  it('shows a preview failure without clearing the current video and permits a deliberate retry', async () => {
    mocks.ticket.mockRejectedValueOnce(new Error('视频预览加载失败'));
    const wrapper = await render({ purpose: 'video', listType: 'drag', currentAssetId: '12' });
    await wrapper.get('button[aria-label="播放预览"]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('视频预览加载失败');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    const retry = [...document.body.querySelectorAll('button')].find(button => button.textContent?.includes('重试预览'));
    expect(retry).toBeDefined();
    retry!.click();
    await flushPromises();
    expect(document.body.querySelector('.media-upload__video-player')?.getAttribute('src')).toBe(remoteUrl);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

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
    expect(wrapper.find('img').attributes('src')).toBe(remoteUrl);
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
  it('keeps the form pending through finalization and exposes pause and resume before binding a ready asset', async () => {
    mocks.limits.mockResolvedValue({ upload_mode: 'direct', image_max_bytes: 10485760, video_max_bytes: 536870912, allowed_image_types: ['image/png'], allowed_video_types: ['video/mp4'] });
    let notify!: (snapshot: { state: string; progress: number }) => void;
    let complete!: (value: { asset_id: string; status: string; duration_ms: number }) => void;
    const pause = vi.fn(() => notify({ state: 'paused', progress: 40 }));
    const resume = vi.fn(async () => { notify({ state: 'uploading', progress: 40 }); });
    const cancel = vi.fn(async () => {});
    mocks.task.mockReturnValue({ result: new Promise(resolve => { complete = resolve; }),
      subscribe(listener: typeof notify) { notify = listener; listener({ state: 'hashing', progress: 0 }); return () => {}; }, pause, resume, cancel });
    const wrapper = await render({ purpose: 'video', currentAssetId: '12', listType: 'drag' });
    await select(wrapper, new File(['video'], 'lesson.mp4', { type: 'video/mp4' }));
    expect(wrapper.text()).toContain('校验文件中');
    await wrapper.findAll('button').find(button => button.text() === '暂停上传')!.trigger('click');
    expect(pause).toHaveBeenCalled(); expect(wrapper.text()).toContain('已暂停');
    await wrapper.findAll('button').find(button => button.text() === '继续上传')!.trigger('click');
    expect(resume).toHaveBeenCalled();
    notify({ state: 'finalizing', progress: 100 }); await flushPromises();
    expect(wrapper.text()).toContain('处理中'); expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    complete({ asset_id: '33', status: 'ready', duration_ms: 5000 }); await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['33']);
  });

});
