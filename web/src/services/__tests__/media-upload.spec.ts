import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMediaUploadTask } from '../media-upload';
import { mediaResumeStore } from '../media-upload-resume';
import { invalidateMediaContext } from '../media-context';
import type { UploadSessionView } from '../../api/media';

const mocks = vi.hoisted(() => ({ limits: vi.fn(), begin: vi.fn(), status: vi.fn(), grant: vi.fn(), complete: vi.fn(), cancel: vi.fn(), proxy: vi.fn(), fingerprint: vi.fn(), part: vi.fn(), simple: vi.fn() }));
vi.mock('../../api/media', () => ({ getMediaLimits: mocks.limits, beginMediaUpload: mocks.begin, getMediaUploadSession: mocks.status, getMediaUploadGrant: mocks.grant,
  completeMediaUpload: mocks.complete, cancelMediaUpload: mocks.cancel, uploadMediaProxy: mocks.proxy }));
vi.mock('../media-fingerprint', () => ({ fingerprintFile: mocks.fingerprint }));
vi.mock('../media-upload-transport', () => ({ putMediaPart: mocks.part, putSimpleMedia: mocks.simple }));
const fingerprint = 'a'.repeat(64);
const file = () => new File(['123456789'], 'same-name.mp4', { type: 'video/mp4' });
const session = (change: Partial<UploadSessionView> = {}): UploadSessionView => ({ session_id: 'session-1', state: 'uploading', mode: 'multipart', expires_at: '2099-01-01T00:00:00.000Z', part_size: 3, parallel_limit: 2, parts: [], result: null, reason_code: null, ...change });
const completed = () => session({ state: 'completed', result: { asset_id: '25', status: 'ready', duration_ms: 5000 } });
const grant = () => ({ mode: 'multipart', bucket: 'fixture-1234567890', region: 'ap-guangzhou', key: 'ruleexam/test/staging/session-1', upload_id: 'upload-1', credentials: { tmp_secret_id: 'unusable', tmp_secret_key: 'unusable', token: 'unusable' }, start_time: 1, expired_time: 4_000_000_000 });

beforeEach(async () => {
  vi.resetAllMocks();
  sessionStorage.setItem('re_user', JSON.stringify({ id: 11 }));
  invalidateMediaContext();
  await mediaResumeStore.clearUser('11');
  mocks.limits.mockResolvedValue({ upload_mode: 'direct', upload_session_ttl_seconds: 86400, video_max_bytes: 536870912, image_max_bytes: 10485760, allowed_image_types: ['image/png'], allowed_video_types: ['video/mp4'] });
  mocks.fingerprint.mockResolvedValue(fingerprint);
  mocks.begin.mockResolvedValue(session());
  mocks.status.mockResolvedValue(completed());
  mocks.grant.mockResolvedValue(grant());
  mocks.complete.mockResolvedValue(completed());
  mocks.part.mockResolvedValue(undefined);
  mocks.simple.mockResolvedValue(undefined);
});
afterEach(() => { invalidateMediaContext(); sessionStorage.clear(); });

describe('resumable upload task', () => {
  it('restores the exact file after refresh and uploads only backend-confirmed missing parts', async () => {
    await mediaResumeStore.put({ userId: '11', sessionId: 'session-1', requestId: 'request-1', fingerprint, sizeBytes: 9, expiresAt: '2099-01-01T00:00:00.000Z', purpose: 'video' });
    mocks.status.mockResolvedValue(session({ parts: [{ partNumber: 1, etag: 'saved-etag', sizeBytes: 3 }] }));
    const result = await createMediaUploadTask(file(), 'video').result;
    expect(result.asset_id).toBe('25');
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.part.mock.calls.map(call => call[1]).sort()).toEqual([2, 3]);
    expect(mocks.part.mock.calls.every(call => call[2].size === 3)).toBe(true);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
  it('does not restore the same filename with different bytes or a different purpose', async () => {
    await mediaResumeStore.put({ userId: '11', sessionId: 'old-session', requestId: 'old-request', fingerprint: 'b'.repeat(64), sizeBytes: 9, expiresAt: '2099-01-01T00:00:00.000Z', purpose: 'video' });
    await createMediaUploadTask(file(), 'video').result;
    expect(mocks.begin).toHaveBeenCalledTimes(1);
    expect(mocks.begin.mock.calls[0][0].fingerprint_sha256).toBe(fingerprint);
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it('refreshes expired credentials within the same session and preserves existing parts', async () => {
    mocks.part.mockRejectedValueOnce(Object.assign(new Error('expired'), { statusCode: 403 })).mockResolvedValue(undefined);
    await createMediaUploadTask(file(), 'video').result;
    expect(mocks.grant).toHaveBeenCalledTimes(2);
    expect(mocks.grant.mock.calls.every(call => call[0] === 'session-1')).toBe(true);
    expect(mocks.begin).toHaveBeenCalledTimes(1);
    expect(mocks.part).toHaveBeenCalledTimes(4);
  });
  it('queries an unknown complete response before considering another write', async () => {
    mocks.complete.mockRejectedValueOnce(new Error('reply lost'));
    mocks.status.mockResolvedValue(completed());
    expect((await createMediaUploadTask(file(), 'video').result).asset_id).toBe('25');
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.status).toHaveBeenCalledWith('session-1', expect.any(AbortSignal));
    expect(mocks.begin).toHaveBeenCalledTimes(1);
  });
  it('keeps 100 percent upload pending until the server publishes a ready resource', async () => {
    let finish!: (value: UploadSessionView) => void;
    mocks.complete.mockResolvedValue(session({ state: 'finalizing' }));
    mocks.status.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const task = createMediaUploadTask(file(), 'video');
    const states: string[] = [];
    task.subscribe(value => states.push(value.state));
    let resolved = false;
    void task.result.then(() => { resolved = true; });
    await flushPromises();
    expect(states.at(-1)).toBe('finalizing');
    expect(resolved).toBe(false);
    finish(completed());
    await task.result;
    expect(states.at(-1)).toBe('ready');
  });
  it('rejects a late result after logout and never recreates persisted recovery state', async () => {
    let finish!: (value: UploadSessionView) => void;
    mocks.begin.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const task = createMediaUploadTask(file(), 'video');
    const rejected = expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
    await flushPromises();
    invalidateMediaContext();
    finish(completed());
    await rejected;
    await flushPromises();
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(await mediaResumeStore.get('11', fingerprint)).toBeNull();
  });
  it('pauses before completion and resumes the same session after reconciling parts', async () => {
    mocks.part.mockImplementation(() => new Promise(() => {}));
    const task = createMediaUploadTask(file(), 'video');
    await flushPromises();
    task.pause();
    expect(mocks.complete).not.toHaveBeenCalled();
    mocks.status.mockResolvedValue(session({ parts: [{ partNumber: 1, etag: 'saved', sizeBytes: 3 }] }));
    mocks.part.mockResolvedValue(undefined);
    await task.resume();
    expect((await task.result).asset_id).toBe('25');
    expect(mocks.begin).toHaveBeenCalledTimes(1);
    expect(mocks.part.mock.calls.slice(2).map(call => call[1]).sort()).toEqual([2, 3]);
  });
  it('cancels the upload session without deleting any saved business asset', async () => {
    mocks.part.mockImplementation(() => new Promise(() => {}));
    const task = createMediaUploadTask(file(), 'video');
    const rejected = expect(task.result).rejects.toMatchObject({ name: 'AbortError' });
    await flushPromises();
    await task.cancel();
    await rejected;
    expect(mocks.cancel).toHaveBeenCalledWith('session-1');
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('replays the same client request after an unknown begin response without creating a second session', async () => {
    mocks.begin.mockRejectedValueOnce(new Error('reply lost')).mockResolvedValueOnce(completed());
    await expect(createMediaUploadTask(file(), 'video').result).rejects.toThrow('reply lost');
    const first = mocks.begin.mock.calls[0][0].client_request_id;
    expect((await createMediaUploadTask(file(), 'video').result).asset_id).toBe('25');
    expect(mocks.begin.mock.calls[1][0].client_request_id).toBe(first);
    expect(mocks.part).not.toHaveBeenCalled();
  });
  it('keeps local-mode uploads on the controlled compatibility transport', async () => {
    mocks.limits.mockResolvedValue({ upload_mode: 'proxy', allowed_video_types: ['video/mp4'], allowed_image_types: ['image/png'], video_max_bytes: 536870912, image_max_bytes: 10485760 });
    mocks.proxy.mockResolvedValue({ asset_id: '26', status: 'ready', duration_ms: 1200 });
    expect((await createMediaUploadTask(file(), 'video').result).asset_id).toBe('26');
    expect(mocks.fingerprint).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.proxy).toHaveBeenCalledTimes(1);
  });
  it('uses the simple PUT instruction for images and leaves final content approval to the server', async () => {
    mocks.begin.mockResolvedValue(session({ mode: 'simple' }));
    mocks.grant.mockResolvedValue({ mode: 'simple', method: 'PUT', url: 'https://fixture.example.test/temporary', headers: { 'Content-Type': 'image/png' }, expires_at: '2099-01-01T00:00:00.000Z' });
    const image = new File(['image'], 'cover.png', { type: 'image/png' });
    expect((await createMediaUploadTask(image, 'course_cover').result).status).toBe('ready');
    expect(mocks.simple.mock.calls[0][1]).toBe(image);
    expect(mocks.part).not.toHaveBeenCalled(); expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

});
