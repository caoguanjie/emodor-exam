import type { Readable } from 'node:stream';

export type StorageLocator = {
  provider: 'local' | 'cos';
  key: string;
  bucket: string | null;
  region: string | null;
  versionId: string | null;
};

export type StoredObject = {
  locator: StorageLocator;
  sizeBytes: number;
  mimeType: string;
  etag: string | null;
  crc64: string | null;
};

export type UploadedPart = { partNumber: number; etag: string; sizeBytes: number };

export interface MediaStoragePort {
  stat(locator: StorageLocator): Promise<StoredObject>;
  open(locator: StorageLocator, range?: { start: number; end: number }): Promise<Readable>;
  putFile(locator: StorageLocator, filePath: string, mimeType: string): Promise<StoredObject>;
  remove(locator: StorageLocator): Promise<void>;
}
