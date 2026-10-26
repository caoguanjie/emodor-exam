import { hashFile } from '../workers/media-fingerprint.worker';

export function fingerprintFile(file: File, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(new DOMException('上传已停止', 'AbortError'));
  if (typeof Worker === 'undefined') return hashFile(file, signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/media-fingerprint.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); signal?.removeEventListener('abort', aborted); };
    const aborted = () => { finish(); reject(new DOMException('上传已停止', 'AbortError')); };
    signal?.addEventListener('abort', aborted, { once: true });
    worker.onmessage = (event: MessageEvent<{ fingerprint?: string; error?: string }>) => {
      finish();
      if (event.data.fingerprint && /^[a-f0-9]{64}$/.test(event.data.fingerprint)) resolve(event.data.fingerprint);
      else reject(new Error('无法校验文件内容'));
    };
    worker.onerror = () => { finish(); reject(new Error('无法校验文件内容')); };
    worker.postMessage({ file });
  });
}
