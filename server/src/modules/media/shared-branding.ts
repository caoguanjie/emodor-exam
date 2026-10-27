import type { MediaAsset } from '../../entities/media-asset.entity';
import type { StorageLocator } from './storage/media-storage.port';

// Shared, immutable defaults used by database/init.sql. Never delete the cloud
// originals when one environment removes its own config/reference/asset rows.
const SHARED_KEYS = new Set([
  'ruleexam/dev/media/migration/6/de77ed07-6aba-420d-8bc8-5c12aa9051ec.png',
  'ruleexam/dev/media/migration/9/6583438b-1b8f-4b61-b0cd-66eebfd467f4.png',
  'ruleexam/dev/media/migration/7/c08dc7f0-8e36-4c5b-8239-0b69164d86e6.png',
  'ruleexam/dev/media/migration/10/e243e889-ab54-46d0-9136-75fa6c76fc5f.png',
]);

export function isSharedBrandingObject(asset: Pick<MediaAsset, 'storageProvider' | 'cosBucket' | 'cosRegion' | 'storageKey'>): boolean {
  return isSharedBrandingLocator({ provider: asset.storageProvider, bucket: asset.cosBucket, region: asset.cosRegion, key: asset.storageKey });
}

export function isSharedBrandingLocator(locator: Pick<StorageLocator, 'provider' | 'bucket' | 'region' | 'key'>): boolean {
  return locator.provider === 'cos'
    && locator.bucket === 'emodor-education-1256460867'
    && locator.region === 'ap-guangzhou'
    && SHARED_KEYS.has(locator.key);
}
