import COS from 'cos-nodejs-sdk-v5';
import { createReadStream } from 'node:fs';
import { stat as fileStat } from 'node:fs/promises';
import { PassThrough, type Readable } from 'node:stream';
import type { CosMediaConfig } from './cos-media.config';
import type { CosUploadPort } from './cos-upload.port';
import type { MediaStoragePort, StorageLocator, StoredObject, UploadedPart } from './media-storage.port';

export type CosSdkClient = Pick<COS, 'headObject' | 'getObject' | 'putObject' | 'deleteObject'
  | 'multipartInit' | 'multipartListPart' | 'multipartComplete' | 'multipartAbort' | 'multipartList' | 'listObjectVersions'>;

function truncated(value: unknown): boolean { return value === true || value === 'true'; }
function missing(error: any): boolean {
  return error?.statusCode === 404 && ['NoSuchKey', 'NoSuchVersion', 'NoSuchUpload', 'NotFound'].includes(error?.code);
}
function failure(operation: string, source: any): Error {
  // SDK errors can contain a signed request URL and credentials. Never propagate them.
  const error = new Error(`COS 媒体${operation}失败`) as Error & { statusCode?: number; code?: string };
  if (Number.isInteger(source?.statusCode)) error.statusCode = source.statusCode;
  if (typeof source?.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(source.code)) error.code = source.code;
  return error;
}

export class CosMediaStorage implements MediaStoragePort, CosUploadPort {
  private readonly sdk: CosSdkClient;

  constructor(readonly config: CosMediaConfig, sdk?: CosSdkClient) {
    for (const field of ['bucket', 'region', 'keyPrefix', 'secretId', 'secretKey'] as const) {
      if (!config[field]) throw new Error('COS 媒体存储配置不完整');
    }
    this.sdk = sdk || new COS({ SecretId: config.secretId!, SecretKey: config.secretKey!,
      ...(config.sessionToken ? { SecurityToken: config.sessionToken } : {}), Protocol: 'https:', Timeout: 30_000 });
  }

  private target(locator: StorageLocator): { Bucket: string; Region: string; Key: string; VersionId?: string } {
    if (locator.provider !== 'cos' || locator.bucket !== this.config.bucket || locator.region !== this.config.region
      || !locator.key.startsWith(this.config.keyPrefix!) || locator.key === this.config.keyPrefix
      || !/^[A-Za-z0-9_./-]+$/.test(locator.key)
      || locator.key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('COS 媒体对象超出当前项目范围');
    if (locator.versionId !== null && (!locator.versionId || /[\s\0]/.test(locator.versionId))) throw new Error('COS 媒体版本无效');
    return { Bucket: locator.bucket!, Region: locator.region!, Key: locator.key, ...(locator.versionId !== null ? { VersionId: locator.versionId } : {}) };
  }

  private staging(locator: StorageLocator) {
    const target = this.target(locator);
    if (!locator.key.startsWith(`${this.config.keyPrefix}staging/`)) throw new Error('COS 操作仅允许准确 staging 对象');
    return target;
  }

  async stat(locator: StorageLocator): Promise<StoredObject> {
    const target = this.target(locator);
    let result: COS.HeadObjectResult;
    try { result = await this.sdk.headObject(target); }
    catch (error) { throw failure('元数据读取', error); }
    const headers = result.headers || {};
    const sizeBytes = Number(headers['content-length']);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error('COS 媒体长度无效');
    return {
      locator: { ...locator, versionId: locator.versionId ?? result.VersionId ?? headers['x-cos-version-id'] ?? null },
      sizeBytes, mimeType: headers['content-type'] || 'application/octet-stream',
      etag: result.ETag || headers.etag || null, crc64: headers['x-cos-hash-crc64ecma'] || null,
    };
  }

  async open(locator: StorageLocator, range?: { start: number; end: number }): Promise<Readable> {
    const target = this.target(locator);
    if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start)) throw new RangeError('invalid byte range');
    const output = new PassThrough();
    const source = new PassThrough();
    // Output tells SDK 3 to pipe HTTP bytes instead of collecting the response body.
    // SDK aborts its HTTP sender on Output's error; close on a disconnected consumer does likewise.
    output.on('error', () => {});
    source.on('error', error => output.destroy(failure('正文读取', error)));
    source.pipe(output);
    output.once('close', () => {
      if (!source.destroyed && !source.readableEnded) source.destroy(new Error('媒体读取已取消'));
    });
    try {
      this.sdk.getObject({ ...target, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}), Output: source }, error => {
        if (error) output.destroy(failure('正文读取', error));
      });
    } catch (error) { source.destroy(); output.destroy(); throw failure('正文读取', error); }
    return output;
  }

  async putFile(locator: StorageLocator, filePath: string, mimeType: string): Promise<StoredObject> {
    const target = this.target(locator);
    if (locator.versionId !== null) throw new Error('不能覆盖已登记的 COS 版本');
    const sourceInfo = await fileStat(filePath);
    if (!sourceInfo.isFile()) throw new Error('媒体源文件无效');
    const body = createReadStream(filePath);
    let result: COS.PutObjectResult;
    try { result = await this.sdk.putObject({ ...target, Body: body, ContentLength: sourceInfo.size, ContentType: mimeType, ACL: 'private' }); }
    catch (error) { throw failure('写入', error); }
    finally { body.destroy(); }
    const versionId = result.VersionId || result.headers?.['x-cos-version-id'] || null;
    return this.stat({ ...locator, versionId });
  }

  async remove(locator: StorageLocator): Promise<void> {
    const target = this.target(locator);
    try { await this.sdk.deleteObject(target); }
    catch (error) { if (!missing(error)) throw failure('删除', error); }
  }

  async begin(locator: StorageLocator, mimeType: string): Promise<{ uploadId: string }> {
    const target = this.staging(locator);
    try {
      const result = await this.sdk.multipartInit({ ...target, ContentType: mimeType, ACL: 'private' });
      if (!result.UploadId) throw new Error('缺少上传标识');
      return { uploadId: result.UploadId };
    } catch (error) { throw failure('分块初始化', error); }
  }

  async parts(locator: StorageLocator, uploadId: string): Promise<UploadedPart[]> {
    const target = this.staging(locator);
    const parts: UploadedPart[] = [];
    let marker = '0';
    do {
      let page: COS.MultipartListPartResult;
      try { page = await this.sdk.multipartListPart({ ...target, UploadId: uploadId, MaxParts: 1000, PartNumberMarker: marker }); }
      catch (error) { throw failure('分块列表', error); }
      for (const part of page.Part || []) {
        const partNumber = Number(part.PartNumber); const sizeBytes = Number(part.Size);
        if (!Number.isSafeInteger(partNumber) || partNumber < 1 || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || !part.ETag) throw new Error('COS 分块结果无效');
        parts.push({ partNumber, sizeBytes, etag: part.ETag });
      }
      if (!truncated(page.IsTruncated)) break;
      const next = String(page.NextPartNumberMarker ?? '');
      if (!/^\d+$/.test(next) || Number(next) <= Number(marker)) throw new Error('COS 分块分页标记无效');
      marker = next;
    } while (true);
    parts.sort((a, b) => a.partNumber - b.partNumber);
    if (parts.some((part, index) => index > 0 && part.partNumber === parts[index - 1].partNumber)) throw new Error('COS 分块结果重复');
    return parts;
  }

  async complete(locator: StorageLocator, uploadId: string, parts: UploadedPart[]): Promise<StoredObject> {
    const target = this.staging(locator);
    if (!parts.length || parts.some((part, index) => part.partNumber !== index + 1 || !part.etag || !Number.isSafeInteger(part.sizeBytes) || part.sizeBytes < 0)) throw new Error('COS 分块清单无效');
    let result: COS.MultipartCompleteResult;
    try { result = await this.sdk.multipartComplete({ ...target, UploadId: uploadId, Parts: parts.map(part => ({ PartNumber: part.partNumber, ETag: part.etag })) }); }
    catch (error) { throw failure('分块合并', error); }
    return this.stat({ ...locator, versionId: result.VersionId || result.headers?.['x-cos-version-id'] || null });
  }

  async abort(locator: StorageLocator, uploadId: string): Promise<void> {
    const target = this.staging(locator);
    try { await this.sdk.multipartAbort({ ...target, UploadId: uploadId }); }
    catch (error) { if (!missing(error)) throw failure('分块取消', error); }
  }

  async listMultipartUploads(locator: StorageLocator): Promise<{ uploadId: string; initiatedAt: string | null }[]> {
    const target = this.staging(locator);
    const uploads: { uploadId: string; initiatedAt: string | null }[] = [];
    const seen = new Set<string>();
    let marker = ''; let uploadMarker = '';
    do {
      let page: COS.MultipartListResult;
      try { page = await this.sdk.multipartList({ Bucket: target.Bucket, Region: target.Region, Prefix: target.Key, Delimiter: '', MaxUploads: 1000, KeyMarker: marker, UploadIdMarker: uploadMarker }); }
      catch (error) { throw failure('上传任务对账', error); }
      for (const item of page.Upload || []) if (item.Key === target.Key && item.UploadId) uploads.push({ uploadId: item.UploadId, initiatedAt: item.Initiated || null });
      if (!truncated(page.IsTruncated)) break;
      const next = page.NextKeyMarker || ''; const nextUpload = page.NextUploadIdMarker || '';
      const pair = JSON.stringify([next, nextUpload]);
      if (!next || seen.has(pair) || (next === marker && nextUpload === uploadMarker)) throw new Error('COS 上传任务分页标记无效');
      seen.add(pair); marker = next; uploadMarker = nextUpload;
    } while (true);
    return uploads;
  }

  async removeStagingVersions(locator: StorageLocator): Promise<void> {
    const target = this.staging(locator);
    const versions: StorageLocator[] = [];
    let marker = ''; let versionMarker = '';
    const seen = new Set<string>();
    do {
      let page: COS.ListObjectVersionsResult;
      try { page = await this.sdk.listObjectVersions({ Bucket: target.Bucket, Region: target.Region, Prefix: target.Key, MaxKeys: '1000', Marker: marker, VersionIdMarker: versionMarker }); }
      catch (error) { throw failure('版本列表', error); }
      for (const item of [...(page.Versions || []), ...(page.DeleteMarkers || [])]) {
        if (item.Key === target.Key) versions.push({ ...locator, versionId: item.VersionId || null });
      }
      if (!truncated(page.IsTruncated)) break;
      const nextMarker = page.NextMarker || ''; const nextVersion = page.NextVersionIdMarker || '';
      const pair = JSON.stringify([nextMarker, nextVersion]);
      if (!nextMarker || seen.has(pair) || (nextMarker === marker && nextVersion === versionMarker)) throw new Error('COS 版本分页标记无效');
      seen.add(pair); marker = nextMarker; versionMarker = nextVersion;
    } while (true);
    // Finish listing before deleting so removals cannot invalidate the pagination cursor.
    for (const version of versions) await this.remove(version);
  }
}
