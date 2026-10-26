import type { CosMediaConfig } from './cos-media.config';
import type { CosMediaStorage } from './cos-media-storage';
import type { LocalMediaStorage } from './local-media-storage';
import type { MediaStoragePort, StorageLocator } from './media-storage.port';

export class MediaStorageRouter {
  constructor(readonly config: CosMediaConfig, private readonly local: LocalMediaStorage, private readonly cos?: CosMediaStorage) {}

  forLocator(locator: StorageLocator): MediaStoragePort {
    if (locator.provider === 'local') return this.local;
    if (locator.provider === 'cos' && this.cos) return this.cos;
    throw new Error('媒体资源存储驱动未配置');
  }
}
