import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { MediaStorageRouter } from './storage/media-storage.router';
import type { StorageLocator, StoredObject } from './storage/media-storage.port';

export type PublishMediaFileInput = {
  filePath: string;
  locator: StorageLocator;
  expectedSha256: string;
  mimeType: string;
};

/** A caller retains the exact key even when a cloud write response is unknown. */
export class MediaPublishError extends Error {
  constructor(readonly locator: StorageLocator, readonly object: StoredObject | null) {
    super('媒体发布或完整性核验失败');
  }
}

async function hashStream(stream: Readable, expectedSize: number): Promise<string> {
  const digest = createHash('sha256');
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > expectedSize) throw new Error('媒体正文超过预期大小');
      digest.update(bytes);
    }
    if (size !== expectedSize) throw new Error('媒体正文大小不匹配');
    return digest.digest('hex');
  } finally { stream.destroy(); }
}

@Injectable()
export class MediaPublisher {
  constructor(private readonly storage: MediaStorageRouter) {}

  async publishVerifiedFile(input: PublishMediaFileInput): Promise<StoredObject> {
    const adapter = this.storage.forLocator(input.locator);
    const source = await stat(input.filePath);
    if (!source.isFile() || !Number.isSafeInteger(source.size) || source.size < 0
      || !/^[a-f0-9]{64}$/.test(input.expectedSha256)
      || await hashStream(createReadStream(input.filePath), source.size) !== input.expectedSha256) {
      throw new Error('媒体源文件完整性校验失败');
    }
    const publication: { object: StoredObject | null } = { object: null };
    try {
      let object: StoredObject;
      try { object = await adapter.putFile(input.locator, input.filePath, input.mimeType); }
      catch {
        // A lost cloud response is reconciled on this unique key, never a new key.
        // If HEAD is still unknown the caller must retain the locator for retry.
        if (input.locator.provider !== 'cos') throw new Error('媒体写入失败');
        object = await adapter.stat(input.locator);
      }
      if (object.locator.provider !== input.locator.provider || object.locator.key !== input.locator.key
        || object.locator.bucket !== input.locator.bucket || object.locator.region !== input.locator.region) {
        throw new Error('媒体对象定位不匹配');
      }
      publication.object = object;
      if (object.sizeBytes !== source.size
        || await hashStream(await adapter.open(object.locator), source.size) !== input.expectedSha256) {
        throw new Error('媒体正式正文完整性核验失败');
      }
      return { ...object, mimeType: input.mimeType };
    } catch {
      // A newer claim may already have adopted this exact object. Only the
      // durable owner can arbitrate its deletion against current state/references.
      const failedObject = publication.object;
      throw new MediaPublishError(failedObject?.locator ?? input.locator, failedObject);
    }
  }
}
