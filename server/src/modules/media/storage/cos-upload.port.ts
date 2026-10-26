import type { StorageLocator, StoredObject, UploadedPart } from './media-storage.port';

export interface CosUploadPort {
  begin(locator: StorageLocator, mimeType: string): Promise<{ uploadId: string }>;
  parts(locator: StorageLocator, uploadId: string): Promise<UploadedPart[]>;
  complete(locator: StorageLocator, uploadId: string, parts: UploadedPart[]): Promise<StoredObject>;
  abort(locator: StorageLocator, uploadId: string): Promise<void>;
  listMultipartUploads(locator: StorageLocator): Promise<{ uploadId: string; initiatedAt: string | null }[]>;
  /** Only an exact session staging key may have all of its versions removed. */
  removeStagingVersions(locator: StorageLocator): Promise<void>;
}
