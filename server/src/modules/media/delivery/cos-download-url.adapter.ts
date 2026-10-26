import COS from 'cos-nodejs-sdk-v5';
import { AppConfig } from '../../../config/configuration';
import { Errors } from '../../../common/errors';
import { MediaAsset } from '../../../entities/media-asset.entity';
import { mediaDeliverySettings, MediaTicketView } from './media-delivery.contract';

/** Locally signs an already-authorized asset. This class never reads object bytes. */
export class CosDownloadUrlAdapter {
  private client?: COS;
  constructor(private readonly config: AppConfig) {}

  issue(asset: MediaAsset, options: { branding?: boolean } = {}): MediaTicketView | null {
    const settings = mediaDeliverySettings(this.config);
    if (settings.mode === 'proxy' || (asset.storageProvider || 'local') === 'local' || asset.purpose.startsWith('identity_')) return null;
    try {
      const cos = this.config.cosMedia;
      if (!cos?.bucket || !cos.region || !cos.keyPrefix || !cos.secretId || !cos.secretKey
        || !/^[a-z0-9][a-z0-9-]*-\d+$/.test(cos.bucket) || !/^[a-z][a-z0-9-]+$/.test(cos.region)
        || !/^(?:[A-Za-z0-9_-]+\/)+$/.test(cos.keyPrefix)) throw new Error();
      if (asset.storageProvider !== 'cos' || asset.status !== 'ready' || !['image', 'video'].includes(asset.mediaKind)
        || asset.cosBucket !== cos.bucket || asset.cosRegion !== cos.region
        || (asset.cosVersionId !== null && (typeof asset.cosVersionId !== 'string' || !asset.cosVersionId || /[\x00-\x1f\x7f]/.test(asset.cosVersionId)))) throw new Error();
      const key = asset.storageKey;
      if (typeof key !== 'string' || !key.startsWith(`${cos.keyPrefix}media/`) || !/^[A-Za-z0-9_./-]+$/.test(key)
        || key.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error();
      if (options.branding && (asset.purpose !== 'branding' || asset.mediaKind !== 'image')) throw new Error();
      const ttl = options.branding ? Math.min(settings.readUrlTtlSeconds, 300)
        : asset.mediaKind === 'video' ? settings.videoUrlTtlSeconds : settings.readUrlTtlSeconds;
      const host = `${cos.bucket}.cos.${cos.region}.myqcloud.com`;
      const query: Record<string, string> = { 'response-cache-control': options.branding ? `public, max-age=${ttl}` : 'private, no-store',
        ...(asset.cosVersionId === null ? {} : { versionId: asset.cosVersionId }) };
      this.client ??= new COS({
        SecretId: cos.secretId, SecretKey: cos.secretKey,
        ...(cos.sessionToken ? { SecurityToken: cos.sessionToken } : {}),
        // SDK v3 uses round(seconds)-1. Half a second aligns it to floor(seconds)
        // so the supported one-second TTL cannot be expired at issuance.
        SystemClockOffset: 500,
      });
      // SDK getObjectUrl does not copy VersionId into Query. Include a real
      // version (even the provider's literal "null" version) explicitly. An
      // unversioned object instead uses its unique, never-overwritten formal key.
      const contentUrl = this.client.getObjectUrl({
        Bucket: cos.bucket, Region: cos.region, Key: key, Method: 'GET',
        Protocol: 'https:', Domain: host, UseAccelerate: false, Sign: true,
        Expires: ttl, Query: query,
      });
      const url = new URL(contentUrl);
      const expectedKeys = ['q-sign-algorithm', 'q-ak', 'q-sign-time', 'q-key-time', 'q-header-list', 'q-url-param-list', 'q-signature',
        ...(asset.cosVersionId === null ? [] : ['versionId']), 'response-cache-control', ...(cos.sessionToken ? ['x-cos-security-token'] : [])];
      if (url.protocol !== 'https:' || url.host !== host || url.username || url.password || url.hash || url.pathname !== `/${key}`
        || [...url.searchParams.keys()].length !== expectedKeys.length
        || !expectedKeys.every((name) => url.searchParams.getAll(name).length === 1)
        || url.searchParams.get('q-sign-algorithm') !== 'sha1' || url.searchParams.get('q-header-list') !== 'host'
        || url.searchParams.get('q-url-param-list') !== (asset.cosVersionId === null ? 'response-cache-control' : 'response-cache-control;versionid')
        || url.searchParams.get('versionId') !== asset.cosVersionId
        || url.searchParams.get('response-cache-control') !== query['response-cache-control']) throw new Error();
      const interval = url.searchParams.get('q-sign-time')!;
      const [start, end] = interval.split(';').map(Number);
      if (!/^\d+;\d+$/.test(interval) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || end - start !== ttl || end * 1000 <= Date.now() || end * 1000 > Date.now() + ttl * 1000
        || url.searchParams.get('q-key-time') !== interval) throw new Error();
      return { content_url: contentUrl, expires_at: new Date(end * 1000).toISOString() };
    } catch {
      // SDK errors may contain request/credential details; expose only this stable error.
      throw Errors.serviceUnavailable('媒体读取链接暂不可用');
    }
  }
}
