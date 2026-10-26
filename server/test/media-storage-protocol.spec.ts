import COS from 'cos-nodejs-sdk-v5';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { CosMediaStorage } from '../src/modules/media/storage/cos-media-storage';
import { readCosMediaConfig } from '../src/modules/media/storage/cos-media.config';

describe('COS SDK 3 version pagination wire protocol', () => {
  it('sends both XML page cursors and deletes only the exact staging versions after listing', async () => {
    const key = 'ruleexam/test/staging/session.upload';
    const requests: { method: string; url: URL }[] = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url!, 'http://127.0.0.1');
      requests.push({ method: request.method!, url });
      if (request.method === 'DELETE') { response.writeHead(204).end(); return; }
      const page = requests.filter(item => item.method === 'GET').length;
      if (request.method !== 'GET' || !url.searchParams.has('versions') || page > 2
        || (page === 2 && (url.searchParams.get('key-marker') !== key || url.searchParams.get('version-id-marker') !== 'version-1'))) {
        response.writeHead(400, { 'Content-Type': 'application/xml' });
        response.end('<Error><Code>InvalidArgument</Code><Message>Missing exact version cursors</Message></Error>');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/xml' });
      response.end(`<?xml version="1.0" encoding="UTF-8"?>
        <ListVersionsResult xmlns="http://cos.myqcloud.com/doc/2006-03-01/">
          <Name>fixture-1234567890</Name><Prefix>${key}</Prefix><MaxKeys>1000</MaxKeys>
          <IsTruncated>${page === 1}</IsTruncated>
          ${page === 1
            ? `<KeyMarker/><VersionIdMarker/><NextKeyMarker>${key}</NextKeyMarker><NextVersionIdMarker>version-1</NextVersionIdMarker>
               <Version><Key>${key}</Key><VersionId>version-1</VersionId><IsLatest>true</IsLatest><Size>12</Size></Version>`
            : `<KeyMarker>${key}</KeyMarker><VersionIdMarker>version-1</VersionIdMarker>
               <Version><Key>${key}</Key><VersionId>version-2</VersionId><IsLatest>false</IsLatest><Size>12</Size></Version>
               <Version><Key>${key}-neighbor</Key><VersionId>foreign-version</VersionId><Size>12</Size></Version>
               <DeleteMarker><Key>${key}</Key><VersionId>delete-marker</VersionId><IsLatest>false</IsLatest></DeleteMarker>
               <DeleteMarker><Key>${key}-neighbor</Key><VersionId>foreign-delete-marker</VersionId></DeleteMarker>`}
        </ListVersionsResult>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const config = readCosMediaConfig({ MEDIA_STORAGE_PROVIDER: 'cos', COS_BUCKET: 'fixture-1234567890', COS_REGION: 'ap-guangzhou', COS_KEY_PREFIX: 'ruleexam/test/', COS_SECRET_ID: 'unusable-id', COS_SECRET_KEY: 'unusable-key' });
      const sdk = new COS({ SecretId: config.secretId!, SecretKey: config.secretKey!,
        Domain: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, Protocol: 'http:', Timeout: 1000, AutoSwitchHost: false });
      const storage = new CosMediaStorage(config, sdk);
      await storage.removeStagingVersions({ provider: 'cos', bucket: config.bucket, region: config.region, key, versionId: null });
      const pages = requests.filter(item => item.method === 'GET');
      expect(pages).toHaveLength(2);
      expect(pages[0].url.searchParams.get('prefix')).toBe(key);
      expect(pages[0].url.searchParams.get('max-keys')).toBe('1000');
      expect(pages[1].url.searchParams.get('key-marker')).toBe(key);
      expect(pages[1].url.searchParams.get('version-id-marker')).toBe('version-1');
      expect(pages[1].url.searchParams.has('marker')).toBe(false);
      expect(requests.map(item => item.method)).toEqual(['GET', 'GET', 'DELETE', 'DELETE', 'DELETE']);
      expect(requests.filter(item => item.method === 'DELETE').map(item => [item.url.pathname, item.url.searchParams.get('versionId')]))
        .toEqual([[`/${key}`, 'version-1'], [`/${key}`, 'version-2'], [`/${key}`, 'delete-marker']]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
