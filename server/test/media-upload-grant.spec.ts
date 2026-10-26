import { afterEach, describe, expect, it, vi } from 'vitest';
import { CosUploadGrantAdapter, multipartUploadPolicy } from '../src/modules/media/storage/cos-upload-grant.adapter';
afterEach(()=>vi.useRealTimers());

describe('browser multipart grant boundary', () => {
  it('allows only uploading/listing parts for one staging key', () => {
    expect(multipartUploadPolicy({provider:'cos',bucket:'fixture-1234567890',region:'ap-guangzhou',key:'ruleexam/test/staging/session.upload',versionId:null})).toEqual({
      version:'2.0', statement:[{ effect:'allow', action:['name/cos:UploadPart','name/cos:ListParts'],resource:['qcs::cos:ap-guangzhou:uid/1234567890:fixture-1234567890/ruleexam/test/staging/session.upload'] }],
    });
  });
  it('rejects wildcard and non-staging policy scopes', () => {
    for (const key of ['ruleexam/test/staging/*','ruleexam/test/media/final.mp4','ruleexam/test/staging/../media/final.mp4']) expect(() => multipartUploadPolicy({provider:'cos',bucket:'fixture-1234567890',region:'ap-guangzhou',key,versionId:null})).toThrow();
  });
  it('signs simple PUT with temporary credentials and never includes the shared long-term pair', async () => {
    const now=Math.floor(Date.now()/1000);let requested:any;
    const config={provider:'cos' as const,bucket:'fixture-1234567890',region:'ap-guangzhou',keyPrefix:'ruleexam/test/',secretId:'unusable-shared-id',secretKey:'unusable-shared-key',sessionToken:null};
    const adapter=new CosUploadGrantAdapter(config,async options=>{requested=options;return{startTime:now,expiredTime:now+1200,requestId:'fixture',credentials:{tmpSecretId:'unusable-temporary-id',tmpSecretKey:'unusable-temporary-key',sessionToken:'unusable-token'}};});
    const locator={provider:'cos' as const,bucket:config.bucket,region:config.region,key:'ruleexam/test/staging/session.upload',versionId:null};
    const grant=await adapter.issue({mode:'simple',locator,uploadId:null,mimeType:'image/png',expiresAt:new Date((now+1800)*1000)});
    expect(requested.policy.statement).toEqual([{effect:'allow',action:['name/cos:PutObject'],resource:['qcs::cos:ap-guangzhou:uid/1234567890:fixture-1234567890/ruleexam/test/staging/session.upload']}]);
    expect(grant).toMatchObject({mode:'simple',method:'PUT',headers:{'Content-Type':'image/png'}});
    const text=decodeURIComponent(JSON.stringify(grant));
    expect(text).toContain('unusable-temporary-id');
    expect(text).not.toContain(config.secretId);expect(text).not.toContain(config.secretKey);expect(text).not.toContain('unusable-temporary-key');
  });
  it('refuses an expired or foreign-prefix grant before requesting credentials', async () => {
    let calls=0;const config={provider:'cos' as const,bucket:'fixture-1234567890',region:'ap-guangzhou',keyPrefix:'ruleexam/test/',secretId:'unusable-id',secretKey:'unusable-key',sessionToken:null};
    const adapter=new CosUploadGrantAdapter(config,async()=>{calls++;throw new Error('must not reach provider');});
    const base={mode:'multipart' as const,locator:{provider:'cos' as const,bucket:config.bucket,region:config.region,key:'ruleexam/test/staging/session.upload',versionId:null},uploadId:'fixture-upload',mimeType:'video/mp4',expiresAt:new Date(Date.now()-1_000)};
    await expect(adapter.issue(base)).rejects.toThrow(/有效期/);
    await expect(adapter.issue({...base,expiresAt:new Date(Date.now()+1800_000),locator:{...base.locator,key:'other/test/staging/session.upload'}})).rejects.toThrow(/范围/);
    expect(calls).toBe(0);
  });
  it('accepts 600 seconds and truncates a near-expiry simple signature to the original deadline', async () => {
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-26T10:00:00.000Z'));
    const config={provider:'cos' as const,bucket:'fixture-1234567890',region:'ap-guangzhou',keyPrefix:'ruleexam/test/',secretId:'unusable-id',secretKey:'unusable-key',sessionToken:null};
    const requested:number[]=[];
    const adapter=new CosUploadGrantAdapter(config,async options=>{requested.push(options.durationSeconds!);const now=Math.floor(Date.now()/1000);return{startTime:now,expiredTime:now+options.durationSeconds!,requestId:'fixture',credentials:{tmpSecretId:'unusable-temp-id',tmpSecretKey:'unusable-temp-key',sessionToken:'unusable-temp-token'}};});
    const locator={provider:'cos' as const,bucket:config.bucket,region:config.region,key:'ruleexam/test/staging/session.upload',versionId:null};
    for(const seconds of [600,12]) {
      const expiresAt=new Date(Date.now()+seconds*1000);
      const grant=await adapter.issue({mode:'simple',locator,uploadId:null,mimeType:'image/png',expiresAt});
      expect(grant.mode).toBe('simple');
      if(grant.mode==='simple') {
        expect(Date.parse(grant.expires_at)).toBe(expiresAt.getTime());
        const signedUntil=Number(new URL(grant.url).searchParams.get('q-key-time')?.split(';')[1]);
        expect(signedUntil).toBeLessThanOrEqual(expiresAt.getTime()/1000);
        expect(signedUntil).toBeGreaterThan(Date.now()/1000);
      }
    }
    expect(requested).toEqual([600,12]);
  });
});
