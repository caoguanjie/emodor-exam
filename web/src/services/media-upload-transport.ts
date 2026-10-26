import type { UploadGrant } from '../api/media';

function stopped(): DOMException { return new DOMException('上传已停止', 'AbortError'); }

/** No business cookie or Bearer header is copied to the storage service. */
export function putSimpleMedia(grant: Extract<UploadGrant, { mode: 'simple' }>, file: Blob, signal: AbortSignal, progress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(stopped()); return; }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    xhr.open('PUT', grant.url);
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(grant.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => progress(event.loaded);
    xhr.onload = () => { finish(); if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(Object.assign(new Error('文件直传失败'), { statusCode: xhr.status })); };
    xhr.onerror = () => { finish(); reject(new Error('文件直传失败，请检查网络')); };
    xhr.onabort = () => { finish(); reject(stopped()); };
    xhr.send(file);
  });
}

export async function putMediaPart(grant: Extract<UploadGrant, { mode: 'multipart' }>, partNumber: number, file: Blob, signal: AbortSignal, progress: (loaded: number) => void): Promise<void> {
  if (signal.aborted) throw stopped();
  const { default: COS } = await import('cos-js-sdk-v5');
  const cos = new COS({
    Protocol: 'https:',
    getAuthorization(_options, callback) {
      callback({ TmpSecretId: grant.credentials.tmp_secret_id, TmpSecretKey: grant.credentials.tmp_secret_key,
        SecurityToken: grant.credentials.token, StartTime: grant.start_time, ExpiredTime: grant.expired_time });
    },
  });
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(stopped());
    signal.addEventListener('abort', abort, { once: true });
    // Direct UploadPart has no public task handle. Pausing stops scheduling and
    // ignores late replies; an already issued part may finish and is reconciled
    // through the backend's ListParts on resume. It never causes Complete here.
    const params = {
      Bucket: grant.bucket, Region: grant.region, Key: grant.key, UploadId: grant.upload_id,
      PartNumber: partNumber, Body: file, ContentLength: file.size,
      onProgress: (event: { loaded: number }) => { if (!signal.aborted) progress(event.loaded); },
    };
    cos.multipartUpload(params, error => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) { reject(stopped()); return; }
      if (error) reject(Object.assign(new Error('视频分块上传失败'), { statusCode: error.statusCode }));
      else resolve();
    });
    if (signal.aborted) abort();
  });
}
