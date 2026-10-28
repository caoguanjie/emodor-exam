import { createUuid } from '../utils/uuid';
import type { MediaPurpose, MediaUploadOptions, MediaUploadResponse, UploadSessionView } from '../api/media';
import { beginMediaUpload, getMediaLimits, getMediaUploadSession, getMediaUploadGrant, completeMediaUpload, cancelMediaUpload, uploadMediaProxy } from '../api/media';
import { validateMediaFile } from '../components/media-upload-state';
import { fingerprintFile } from './media-fingerprint';
import { isMediaContextCurrent, mediaContext, onMediaContextChange } from './media-context';
import { mediaResumeStore, type ResumeRecord } from './media-upload-resume';
import { putMediaPart, putSimpleMedia } from './media-upload-transport';

export type UploadTaskSnapshot = { state: 'hashing' | 'uploading' | 'paused' | 'finalizing' | 'ready' | 'error' | 'cancelled'; progress: number };
export interface MediaUploadTask {
  result: Promise<MediaUploadResponse>;
  pause(): void; resume(): Promise<void>; cancel(): Promise<void>;
  subscribe(listener: (value: UploadTaskSnapshot) => void): () => void;
}

function aborted(): DOMException { return new DOMException('上传已停止', 'AbortError'); }

export function createMediaUploadTask(file: File, purpose: MediaPurpose, options: MediaUploadOptions = {}): MediaUploadTask {
  const context = mediaContext();
  let snapshot: UploadTaskSnapshot = { state: 'hashing', progress: 0 };
  const subscribers = new Set<(value: UploadTaskSnapshot) => void>();
  let controller = new AbortController();
  let serial = 0;
  let settled = false;
  let direct = false;
  let record: ResumeRecord | null = null;
  let view: UploadSessionView | null = null;
  let resolveResult!: (value: MediaUploadResponse) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<MediaUploadResponse>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });

  const emit = (state: UploadTaskSnapshot['state'], progress = snapshot.progress) => {
    snapshot = { state, progress: Math.min(100, Math.max(0, Math.round(progress))) };
    for (const listener of subscribers) listener({ ...snapshot });
    options.onProgress?.(snapshot.progress);
  };
  const assertCurrent = (generation: number) => {
    if (generation !== serial || controller.signal.aborted || !isMediaContextCurrent(context)) throw aborted();
  };
  const checked = async <T>(promise: Promise<T>, generation: number): Promise<T> => {
    assertCurrent(generation);
    const signal = controller.signal;
    const value = await new Promise<T>((resolve, reject) => {
      const stop = () => reject(aborted());
      signal.addEventListener('abort', stop, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
      if (signal.aborted) stop();
    });
    assertCurrent(generation);
    return value;
  };
  const save = async (generation: number) => {
    if (!record) return;
    const saving = { ...record };
    await mediaResumeStore.put(saving);
    if (generation !== serial || !isMediaContextCurrent(context)) {
      await mediaResumeStore.remove(context.userId, saving.sessionId);
      throw aborted();
    }
  };
  const cleanup = () => { unsubscribeContext(); options.signal?.removeEventListener('abort', abortLocal); };
  const finish = (value: MediaUploadResponse) => {
    settled = true;
    emit(value.status === 'ready' ? 'ready' : 'finalizing', 100);
    cleanup();
    resolveResult(value);
  };
  const abortLocal = () => {
    if (settled) return;
    serial += 1;
    controller.abort();
    settled = true;
    emit('cancelled');
    cleanup();
    rejectResult(aborted());
  };
  const unsubscribeContext = onMediaContextChange(() => {
    if (record) void mediaResumeStore.remove(context.userId, record.sessionId).catch(() => {});
    abortLocal();
  });
  options.signal?.addEventListener('abort', abortLocal, { once: true });

  async function publishSession(generation: number): Promise<void> {
    if (!view) throw new Error('缺少上传会话');
    while (view.state === 'uploading' || view.state === 'finalizing') {
      emit('finalizing', 100);
      view = await checked(getMediaUploadSession(view.session_id, controller.signal), generation);
      if (view.state === 'uploading' || view.state === 'finalizing') {
        await checked(new Promise<void>(resolve => setTimeout(resolve, 1000)), generation);
      }
    }
    if (view.state !== 'completed' || !view.result || view.result.status !== 'ready' || !view.result.asset_id) {
      if (['failed', 'aborted', 'expired'].includes(view.state)) {
        await checked(mediaResumeStore.remove(context.userId, view.session_id), generation);
        record = null;
      }
      throw new Error(view.state === 'expired' ? '上传会话已过期，请重新选择文件' : '文件内容处理失败，请重新选择文件');
    }
    assertCurrent(generation);
    await mediaResumeStore.remove(context.userId, view.session_id);
    assertCurrent(generation);
    finish(view.result);
  }

  async function transfer(generation: number): Promise<void> {
    if (!view || view.state !== 'uploading') return;
    const sessionId = view.session_id;
    let grant = await checked(getMediaUploadGrant(sessionId, controller.signal), generation);
    let grantRefresh: ReturnType<typeof getMediaUploadGrant> | null = null;
    const refreshGrant = async () => {
      if (!grantRefresh) grantRefresh = getMediaUploadGrant(sessionId, controller.signal).finally(() => { grantRefresh = null; });
      grant = await checked(grantRefresh, generation);
    };
    emit('uploading');
    if (view.mode === 'simple') {
      if (grant.mode !== 'simple') throw new Error('上传授权模式不匹配');
      for (let attempt = 0; ; attempt += 1) {
        const current = grant;
        if (current.mode !== 'simple') throw new Error('上传授权模式不匹配');
        try {
          await checked(putSimpleMedia(current, file, controller.signal, loaded => {
            if (generation === serial && !controller.signal.aborted) emit('uploading', loaded / Math.max(1, file.size) * 100);
          }), generation);
          break;
        } catch (error) {
          assertCurrent(generation);
          if (attempt > 0 || ![401, 403].includes(Number((error as { statusCode?: number }).statusCode))) throw error;
          await refreshGrant();
        }
      }
      return;
    }
    const partSize = view.part_size;
    if (!Number.isSafeInteger(partSize) || partSize < 1 || !Number.isInteger(view.parallel_limit) || view.parallel_limit < 1) throw new Error('服务端分块参数无效');
    const partCount = Math.ceil(file.size / partSize);
    if (partCount > 10000) throw new Error('视频分块数量超过限制');
    const progress = new Map<number, number>();
    for (const part of view.parts) {
      const expected = Math.min(partSize, file.size - (part.partNumber - 1) * partSize);
      if (Number.isInteger(part.partNumber) && part.partNumber >= 1 && part.partNumber <= partCount && part.sizeBytes === expected && part.etag) progress.set(part.partNumber, expected);
    }
    const missing = Array.from({ length: partCount }, (_, index) => index + 1).filter(number => !progress.has(number));
    const showProgress = () => emit('uploading', [...progress.values()].reduce((sum, value) => sum + value, 0) / Math.max(1, file.size) * 100);
    showProgress();
    let index = 0;
    const uploadNext = async () => {
      while (index < missing.length) {
        assertCurrent(generation);
        const partNumber = missing[index++];
        const part = file.slice((partNumber - 1) * partSize, partNumber * partSize);
        for (let attempt = 0; ; attempt += 1) {
          if (grant.mode !== 'multipart') throw new Error('上传授权模式不匹配');
          if (grant.expired_time <= Date.now() / 1000 + 10) await refreshGrant();
          const current = grant;
          if (current.mode !== 'multipart') throw new Error('上传授权模式不匹配');
          try {
            await checked(putMediaPart(current, partNumber, part, controller.signal, loaded => {
              if (generation !== serial || controller.signal.aborted) return;
              progress.set(partNumber, Math.min(part.size, loaded)); showProgress();
            }), generation);
            progress.set(partNumber, part.size); showProgress();
            break;
          } catch (error) {
            assertCurrent(generation);
            if (attempt > 0 || ![401, 403].includes(Number((error as { statusCode?: number }).statusCode))) throw error;
            await refreshGrant();
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(view.parallel_limit, 6, missing.length) }, uploadNext));
    assertCurrent(generation);
  }

  async function run(): Promise<void> {
    const generation = ++serial;
    controller = new AbortController();
    try {
      assertCurrent(generation);
      const limits = await checked(getMediaLimits(), generation);
      const validation = validateMediaFile(file, purpose, limits);
      if (!validation.ok) throw new Error(validation.message);
      direct = limits.upload_mode === 'direct';
      if (!direct) {
        emit('uploading', 0);
        const response = await checked(uploadMediaProxy(file, purpose, { ...options, signal: controller.signal, onProgress: progress => emit('uploading', progress) }), generation);
        finish(response);
        return;
      }
      if (!context.userId) throw new Error('请重新登录后上传');
      if (!record) {
        emit('hashing', 0);
        const fingerprint = await checked(fingerprintFile(file, controller.signal), generation);
        const previous = await checked(mediaResumeStore.get(context.userId, fingerprint), generation);
        const reusable = previous && previous.sizeBytes === file.size && previous.purpose === purpose && (previous.ownerId || '') === (options.ownerId || '');
        record = reusable ? previous : {
          userId: context.userId, sessionId: '', requestId: createUuid(), fingerprint, sizeBytes: file.size,
          expiresAt: new Date(Date.now() + (limits.upload_session_ttl_seconds || 86400) * 1000).toISOString(), purpose,
          ...(options.ownerId ? { ownerId: options.ownerId } : {}),
        };
        // Save the request id before POST: an unknown begin response must replay it.
        await save(generation);
      }
      if (record.sessionId) view = await checked(getMediaUploadSession(record.sessionId, controller.signal), generation);
      else {
        view = await checked(beginMediaUpload({ client_request_id: record.requestId, purpose, filename: file.name,
          mime_type: file.type, size_bytes: file.size, fingerprint_sha256: record.fingerprint,
          ...(options.ownerId ? { owner_id: options.ownerId } : {}),
        }, controller.signal), generation);
        record = { ...record, sessionId: view.session_id, expiresAt: view.expires_at };
        await save(generation);
      }
      if (view.state === 'uploading') {
        await transfer(generation);
        assertCurrent(generation);
        emit('finalizing', 100);
        try { view = await checked(completeMediaUpload(view.session_id, controller.signal), generation); }
        catch {
          assertCurrent(generation);
          // A lost reply is not evidence of a failed write. Read the same session first.
          view = await checked(getMediaUploadSession(view.session_id, controller.signal), generation);
          if (view.state === 'uploading') view = await checked(completeMediaUpload(view.session_id, controller.signal), generation);
        }
      }
      await publishSession(generation);
    } catch (error) {
      if (generation !== serial || settled || snapshot.state === 'paused') return;
      settled = true;
      controller.abort();
      emit('error'); cleanup(); rejectResult(error);
    }
  }
  const task: MediaUploadTask = {
    result,
    pause() {
      if (settled || !direct || !['hashing', 'uploading'].includes(snapshot.state)) return;
      serial += 1; controller.abort(); emit('paused');
    },
    async resume() {
      if (settled || snapshot.state !== 'paused') return;
      await run();
    },
    async cancel() {
      if (settled) return;
      const sessionId = record?.sessionId;
      abortLocal();
      if (record) await mediaResumeStore.remove(context.userId, record.sessionId);
      if (sessionId) await cancelMediaUpload(sessionId);
    },
    subscribe(listener) { subscribers.add(listener); listener({ ...snapshot }); return () => subscribers.delete(listener); },
  };
  queueMicrotask(() => { if (options.signal?.aborted) abortLocal(); else if (!settled) void run(); });
  return task;
}
