import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { LocalMediaStorage } from '../src/modules/media/storage/local-media-storage';
import { CosMediaStorage } from '../src/modules/media/storage/cos-media-storage';
import { MediaStorageRouter } from '../src/modules/media/storage/media-storage.router';
import { readCosMediaConfig } from '../src/modules/media/storage/cos-media.config';
import type { StorageLocator } from '../src/modules/media/storage/media-storage.port';

const roots: string[] = [];
async function root() { const path = await mkdtemp(join(tmpdir(), 'ruleexam-storage-')); roots.push(path); return path; }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function bytes(stream: Readable) { const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString(); }
const config = () => readCosMediaConfig({ MEDIA_STORAGE_PROVIDER: 'cos', COS_BUCKET: 'fixture-1234567890', COS_REGION: 'ap-guangzhou', COS_KEY_PREFIX: 'ruleexam/test/', COS_SECRET_ID: 'unusable-id', COS_SECRET_KEY: 'unusable-key' });
const cosLocator = (key='ruleexam/test/media/file.mp4', versionId:string|null='version-7'):StorageLocator => ({ provider:'cos', bucket:'fixture-1234567890',region:'ap-guangzhou',key,versionId });
const localLocator = (key='media/legacy.png'):StorageLocator => ({ provider:'local',key,bucket:null,region:null,versionId:null });

describe('local media storage', () => {
  it('streams a legacy relative key and an exact byte range', async () => {
    const dir=await root(); await mkdir(join(dir,'media')); await writeFile(join(dir,'media/legacy.png'),'0123456789');
    const local=new LocalMediaStorage(dir);
    expect((await local.stat(localLocator())).sizeBytes).toBe(10);
    expect(await bytes(await local.open(localLocator(),{start:2,end:5}))).toBe('2345');
    await local.remove(localLocator()); await local.remove(localLocator());
  });
  it('rejects traversal, absolute keys and symlinks escaping the storage root', async () => {
    const dir=await root(); const outside=await root(); await writeFile(join(outside,'secret'),'private');
    await symlink(outside,join(dir,'escape'));
    const local=new LocalMediaStorage(dir);
    for (const key of ['../secret','/tmp/secret','media/../../secret','escape/secret']) {
      await expect(local.open(localLocator(key))).rejects.toThrow();
      await expect(local.remove(localLocator(key))).rejects.toThrow();
    }
    expect(await readFile(join(outside,'secret'),'utf8')).toBe('private');
  });
  it('copies a file as a stream and refuses an existing final key', async () => {
    const dir=await root(); const source=join(await root(),'source'); await writeFile(source,'published bytes');
    const local=new LocalMediaStorage(dir);
    const stored=await local.putFile(localLocator(),source,'image/png');
    expect(stored).toMatchObject({sizeBytes:15,mimeType:'image/png',locator:localLocator()});
    await expect(local.putFile(localLocator(),source,'image/png')).rejects.toThrow();
    expect(await bytes(await local.open(localLocator()))).toBe('published bytes');
  });
});

describe('COS media storage', () => {
  it('pins stat/open/delete to the exact version and streams Range without buffering', async () => {
    const head=vi.fn(async () => ({headers:{'content-length':'10','content-type':'video/mp4','x-cos-hash-crc64ecma':'123'},ETag:'"etag"',VersionId:'version-7'}));
    const get=vi.fn((params:any,done:any) => { queueMicrotask(() => { params.Output.end('2345'); done(null,{}); }); });
    const del=vi.fn(async () => ({}));
    const storage=new CosMediaStorage(config(),{headObject:head,getObject:get,deleteObject:del} as any);
    expect(await storage.stat(cosLocator())).toMatchObject({sizeBytes:10,mimeType:'video/mp4',crc64:'123'});
    expect(await bytes(await storage.open(cosLocator(),{start:2,end:5}))).toBe('2345');
    await storage.remove(cosLocator());
    for (const call of [head.mock.calls[0],get.mock.calls[0],del.mock.calls[0]]) expect(call[0]).toMatchObject({Bucket:'fixture-1234567890',Region:'ap-guangzhou',Key:'ruleexam/test/media/file.mp4',VersionId:'version-7'});
    expect(get.mock.calls[0][0]).toMatchObject({Range:'bytes=2-5',Output:expect.anything()});
  });
  it('rejects foreign keys, buckets and regions before sending any SDK request', async () => {
    const head=vi.fn(); const del=vi.fn(); const storage=new CosMediaStorage(config(),{headObject:head,deleteObject:del} as any);
    for (const locator of [cosLocator('gooodwork/photo'),cosLocator('ruleexam/test-other/photo'),cosLocator('ruleexam/test/media/../photo'),cosLocator('ruleexam/test/media/%2fother'),{...cosLocator(),bucket:'other-1234567890'},{...cosLocator(),region:'ap-beijing'}]) {
      await expect(storage.stat(locator)).rejects.toThrow();
      await expect(storage.remove(locator)).rejects.toThrow();
    }
    expect(head).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled();
  });
  it('redacts SDK stream errors and aborts its private output when the consumer disconnects', async () => {
    const raw = Object.assign(new Error('signed URL contains unusable-secret-fixture'), { statusCode: 403, code: 'AccessDenied' });
    let aborted = false;
    const get = vi.fn((input:any, done:any) => {
      input.Output.on('error', () => { aborted = true; });
      if (get.mock.calls.length === 1) setImmediate(() => { input.Output.emit('error', raw); done(raw); });
    });
    const storage = new CosMediaStorage(config(), { getObject: get } as any);
    await expect(bytes(await storage.open(cosLocator()))).rejects.toThrow(/^COS 媒体正文读取失败$/);
    const next = await storage.open(cosLocator());
    aborted = false;
    next.destroy();
    await new Promise(resolve => setImmediate(resolve));
    expect(aborted).toBe(true);
  });
  it('treats only actual missing objects as successful deletion', async () => {
    const del=vi.fn().mockRejectedValueOnce({statusCode:404,code:'NoSuchKey'}).mockRejectedValueOnce({statusCode:403,code:'AccessDenied'});
    const storage=new CosMediaStorage(config(),{deleteObject:del} as any);
    await expect(storage.remove(cosLocator())).resolves.toBeUndefined();
    await expect(storage.remove(cosLocator())).rejects.toThrow();
  });
  it('paginates multipart parts and refuses a stalled pagination marker', async () => {
    const list=vi.fn().mockResolvedValueOnce({Part:[{PartNumber:'1',ETag:'a',Size:'8'}],IsTruncated:'true',NextPartNumberMarker:'1'}).mockResolvedValueOnce({Part:[{PartNumber:'2',ETag:'b',Size:'3'}],IsTruncated:'false'});
    const storage=new CosMediaStorage(config(),{multipartListPart:list} as any);
    const staging=cosLocator('ruleexam/test/staging/session.upload',null);
    expect(await storage.parts(staging,'upload-1')).toEqual([{partNumber:1,etag:'a',sizeBytes:8},{partNumber:2,etag:'b',sizeBytes:3}]);
    expect(list.mock.calls[1][0]).toMatchObject({PartNumberMarker:'1',UploadId:'upload-1'});
    list.mockReset().mockResolvedValue({Part:[],IsTruncated:'true',NextPartNumberMarker:'0'});
    await expect(storage.parts(staging,'upload-1')).rejects.toThrow(/分页/);
  });
  it('removes only exact staging-key versions including delete markers across pages', async () => {
    const key='ruleexam/test/staging/session.upload';
    const list=vi.fn().mockResolvedValueOnce({Versions:[{Key:key,VersionId:'v1'},{Key:key+'-other',VersionId:'foreign'}],DeleteMarkers:[],IsTruncated:'true',NextKeyMarker:key,NextVersionIdMarker:'v1'}).mockResolvedValueOnce({Versions:[{Key:key,VersionId:'v2'}],DeleteMarkers:[{Key:key,VersionId:'deleted'}],IsTruncated:'false'});
    const del=vi.fn(async () => ({}));
    const storage=new CosMediaStorage(config(),{listObjectVersions:list,deleteObject:del} as any);
    await storage.removeStagingVersions(cosLocator(key,null));
    expect(del.mock.calls.map(call => [call[0].Key,call[0].VersionId])).toEqual([[key,'v1'],[key,'v2'],[key,'deleted']]);
    expect(list.mock.calls[1][0]).toMatchObject({Prefix:key,KeyMarker:key,VersionIdMarker:'v1'});
    await expect(storage.removeStagingVersions(cosLocator())).rejects.toThrow(/staging/);
  });
  it('reconciles only multipart tasks for the exact session key across pages', async () => {
    const key = 'ruleexam/test/staging/session.upload';
    const list = vi.fn().mockResolvedValueOnce({ Upload:[{Key:key,UploadId:'u1',Initiated:'2026-01-01T00:00:00Z'},{Key:key+'-foreign',UploadId:'foreign'}],IsTruncated:'true',NextKeyMarker:key,NextUploadIdMarker:'u1' }).mockResolvedValueOnce({ Upload:[{Key:key,UploadId:'u2'}],IsTruncated:'false' });
    const storage = new CosMediaStorage(config(), { multipartList:list } as any);
    expect(await storage.listMultipartUploads(cosLocator(key,null))).toEqual([{uploadId:'u1',initiatedAt:'2026-01-01T00:00:00Z'},{uploadId:'u2',initiatedAt:null}]);
    expect(list.mock.calls[1][0]).toMatchObject({Prefix:key,KeyMarker:key,UploadIdMarker:'u1'});
    await expect(storage.listMultipartUploads(cosLocator())).rejects.toThrow(/staging/);
  });
  it('records the written version and uses it for readback metadata', async () => {
    const source=join(await root(),'source.mp4'); await writeFile(source,'0123456789');
    const put=vi.fn(async (input:any) => { expect(input.Body).toBeInstanceOf(Readable); expect(input.ContentLength).toBe(10); return {VersionId:'new-version',headers:{'x-cos-version-id':'new-version'}}; });
    const head=vi.fn(async () => ({headers:{'content-length':'10','content-type':'video/mp4'},ETag:'e'}));
    const storage=new CosMediaStorage(config(),{putObject:put,headObject:head} as any);
    expect((await storage.putFile(cosLocator('ruleexam/test/media/unique.mp4',null),source,'video/mp4')).locator.versionId).toBe('new-version');
    expect(head.mock.calls[0][0]).toMatchObject({VersionId:'new-version'});
  });
});

it('routes by each row so historical local data survives a COS default', async () => {
  const local=new LocalMediaStorage(await root()); const cos=new CosMediaStorage(config(),{} as any);
  const router=new MediaStorageRouter(config(),local,cos);
  expect(router.forLocator(localLocator())).toBe(local);
  expect(router.forLocator(cosLocator())).toBe(cos);
  expect(() => new MediaStorageRouter(readCosMediaConfig({}),local).forLocator(cosLocator())).toThrow();
});
