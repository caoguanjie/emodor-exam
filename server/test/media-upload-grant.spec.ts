import { afterEach, describe, expect, it, vi } from 'vitest';
import COS from 'cos-nodejs-sdk-v5';
import { CosUploadGrantAdapter, multipartUploadPolicy } from '../src/modules/media/storage/cos-upload-grant.adapter';
afterEach(()=>vi.useRealTimers());

const grantConfig={provider:'cos' as const,bucket:'fixture-1234567890',region:'ap-guangzhou',keyPrefix:'ruleexam/test/',secretId:'unusable-id',secretKey:'unusable-key',sessionToken:null};
const grantInput=()=>({mode:'multipart' as const,locator:{provider:'cos' as const,bucket:grantConfig.bucket,region:grantConfig.region,key:'ruleexam/test/staging/session.upload',versionId:null},uploadId:'fixture-upload',mimeType:'video/mp4',expiresAt:new Date(Date.now()+1800_000)});
const issuedAt=(startTime:number,duration:number)=>({startTime,expiredTime:startTime+duration,requestId:'fixture',credentials:{tmpSecretId:'unusable-temporary-id',tmpSecretKey:'unusable-temporary-key',sessionToken:'unusable-temporary-token'}});

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
  it('binds simple PUT to a private object ACL without granting separate ACL write permission', async () => {
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(1700000000000);
    const credentials=issuedAt(Math.floor(Date.now()/1000),600);let requested:any;
    const adapter=new CosUploadGrantAdapter(grantConfig,async options=>{requested=options;return credentials;});
    const input={...grantInput(),mode:'simple' as const,uploadId:null,mimeType:'image/png'};
    const grant=await adapter.issue(input);
    expect(grant.mode).toBe('simple');
    if(grant.mode!=='simple')throw new Error('expected a simple grant');
    expect(grant.headers).toEqual({'Content-Type':'image/png','x-cos-acl':'private'});
    expect(requested.policy.statement).toEqual([{effect:'allow',action:['name/cos:PutObject'],resource:['qcs::cos:ap-guangzhou:uid/1234567890:fixture-1234567890/ruleexam/test/staging/session.upload']}]);
    const signed=new URL(grant.url);
    expect(signed.searchParams.get('q-header-list')?.split(';')).toContain('x-cos-acl');
    const signature=(headers:Record<string,string>)=>new URLSearchParams(COS.getAuthorization({
      SecretId:credentials.credentials.tmpSecretId,SecretKey:credentials.credentials.tmpSecretKey,
      Bucket:input.locator.bucket,Region:input.locator.region,Key:input.locator.key,Method:'PUT',Headers:headers,KeyTime:signed.searchParams.get('q-key-time')!,
    })).get('q-signature');
    expect(signature(grant.headers)).toBe(signed.searchParams.get('q-signature'));
    expect(signature({...grant.headers,'x-cos-acl':'public-read'})).not.toBe(signed.searchParams.get('q-signature'));
    const withoutAcl={...grant.headers};delete withoutAcl['x-cos-acl'];
    expect(signature(withoutAcl)).not.toBe(signed.searchParams.get('q-signature'));
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
        expect(Date.parse(grant.expires_at)).toBeLessThanOrEqual(expiresAt.getTime());
        const signedUntil=Number(new URL(grant.url).searchParams.get('q-key-time')?.split(';')[1]);
        expect(signedUntil).toBeLessThanOrEqual(expiresAt.getTime()/1000);
        expect(signedUntil).toBeGreaterThan(Date.now()/1000);
      }
    }
    expect(requested.every(seconds=>Number.isInteger(seconds)&&seconds>0&&seconds<=600)).toBe(true);
  });

  it('accepts a provider duration that starts after a request crosses the next second', async () => {
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(1700000000900);
    for(const mode of ['simple','multipart'] as const) {
      vi.setSystemTime(1700000000900);
      const input={...grantInput(),mode};
      const adapter=new CosUploadGrantAdapter(grantConfig,async options=>{
        vi.setSystemTime(Date.now()+200);
        return issuedAt(Math.floor(Date.now()/1000),options.durationSeconds!);
      });
      const grant=await adapter.issue(input);
      const expiredAt=grant.mode==='multipart'?grant.expired_time*1000:Date.parse(grant.expires_at);
      expect(grant.mode).toBe(mode);
      expect(expiredAt).toBeLessThanOrEqual(input.expiresAt.getTime());
      expect(expiredAt).toBeGreaterThan(Date.now());
    }
  });

  it('allows bounded provider clock skew but withholds credentials beyond the reserved deadline', async () => {
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(1700000000900);
    for(const skew of [-20,20]) {
      const input=grantInput();
      const adapter=new CosUploadGrantAdapter(grantConfig,async options=>issuedAt(Math.floor(Date.now()/1000)+skew,options.durationSeconds!));
      await expect(adapter.issue(input)).resolves.toMatchObject({mode:'multipart'});
    }
    const input=grantInput();
    const beyond=new CosUploadGrantAdapter(grantConfig,async()=>issuedAt(Math.floor(Date.now()/1000),1801));
    await expect(beyond.issue(input)).rejects.toThrow(/有效期/);
  });

  it('does not request a new credential with at most one second left', async () => {
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(1700000000000);
    const provider=vi.fn(async()=>issuedAt(1700000000,1));
    const adapter=new CosUploadGrantAdapter(grantConfig,provider);
    await expect(adapter.issue({...grantInput(),expiresAt:new Date(Date.now()+1000)})).rejects.toThrow(/有效期/);
    expect(provider).not.toHaveBeenCalled();
  });

  it('never returns an already-expired simple URL when the remaining grant is very short', async () => {
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(1700000000000);
    const adapter=new CosUploadGrantAdapter(grantConfig,async options=>issuedAt(Math.floor(Date.now()/1000),options.durationSeconds!));
    const input={...grantInput(),mode:'simple' as const,uploadId:null,mimeType:'image/png',expiresAt:new Date(Date.now()+1500)};
    const grant=await adapter.issue(input);
    expect(grant.mode).toBe('simple');
    if(grant.mode==='simple') {
      const signedUntil=Number(new URL(grant.url).searchParams.get('q-key-time')?.split(';')[1])*1000;
      expect(signedUntil).toBeGreaterThan(Date.now());
      expect(signedUntil).toBeLessThanOrEqual(input.expiresAt.getTime());
    }
  });

  it('stops waiting at the nearer session deadline and ignores a late credential response', async () => {
    vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout','performance']});vi.setSystemTime(1700000000000);
    let release:((value:ReturnType<typeof issuedAt>)=>void)|undefined;
    const adapter=new CosUploadGrantAdapter(grantConfig,()=>new Promise(resolve=>{release=resolve;}));
    let state='pending';
    const request=adapter.issue({...grantInput(),expiresAt:new Date(Date.now()+1200)}).then(()=>{state='issued';},()=>{state='rejected';});
    try {
      await vi.advanceTimersByTimeAsync(1200);
      const atDeadline=state;
      release?.(issuedAt(Math.floor(Date.now()/1000),1));
      await request;
      expect(atDeadline).toBe('rejected');
      expect(state).toBe('rejected');
    } finally {release?.(issuedAt(Math.floor(Date.now()/1000),1));await request;}
  });

  it('limits waiting to ten seconds and retains at most eight real provider requests until they settle', async () => {
    vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout','performance']});vi.setSystemTime(1700000000000);
    const pending:{resolve:(value:ReturnType<typeof issuedAt>)=>void;duration:number}[]=[];
    const provider=vi.fn(async options=>{
      if(pending.length>=8) return issuedAt(Math.floor(Date.now()/1000),options.durationSeconds!);
      return new Promise<ReturnType<typeof issuedAt>>(resolve=>pending.push({resolve,duration:options.durationSeconds!}));
    });
    const adapter=new CosUploadGrantAdapter(grantConfig,provider);
    const states:string[]=[];
    const requests=Array.from({length:8},(_,index)=>adapter.issue(grantInput()).then(()=>{states[index]='issued';},()=>{states[index]='rejected';}));
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      const afterTimeout=[...states];
      const overflow=adapter.issue(grantInput()).then(()=> 'issued',()=> 'rejected');
      await vi.advanceTimersByTimeAsync(0);
      const callsAtLimit=provider.mock.calls.length;
      pending.forEach(item=>item.resolve(issuedAt(Math.floor(Date.now()/1000),item.duration)));
      await Promise.all(requests);
      const overflowResult=await overflow;
      expect(afterTimeout).toEqual(Array(8).fill('rejected'));
      expect(callsAtLimit).toBe(8);
      expect(overflowResult).toBe('rejected');
      await expect(adapter.issue(grantInput())).resolves.toMatchObject({mode:'multipart'});
      expect(provider).toHaveBeenCalledTimes(9);
    } finally {
      pending.forEach(item=>item.resolve(issuedAt(Math.floor(Date.now()/1000),item.duration)));
      await Promise.all(requests);
    }
  });
});
