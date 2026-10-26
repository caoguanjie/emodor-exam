import COS from 'cos-nodejs-sdk-v5';
import { getCredential, type CredentialData, type GetCredentialOptions } from 'qcloud-cos-sts';
import type { CosMediaConfig } from './cos-media.config';
import type { StorageLocator } from './media-storage.port';
import type { UploadGrant } from '../uploads/media-upload.contract';

function assertExactStaging(locator: StorageLocator): void {
  if (locator.provider !== 'cos' || !locator.bucket || !/^[a-z0-9][a-z0-9-]*-\d+$/.test(locator.bucket)
    || !locator.region || !/^[a-z][a-z0-9-]+$/.test(locator.region)
    || !/^[A-Za-z0-9_./-]+$/.test(locator.key) || !locator.key.includes('/staging/')
    || locator.key.split('/').some(part=>!part || part==='.' || part==='..')) throw new Error('上传授权只允许准确 staging 对象');
}
function policy(locator: StorageLocator, actions: string[]) {
  assertExactStaging(locator);
  const appid=locator.bucket!.slice(locator.bucket!.lastIndexOf('-')+1);
  return {version:'2.0',statement:[{effect:'allow',action:actions,resource:[`qcs::cos:${locator.region}:uid/${appid}:${locator.bucket}/${locator.key}`]}]};
}
export function multipartUploadPolicy(locator: StorageLocator) {
  return policy(locator,['name/cos:UploadPart','name/cos:ListParts']);
}
export type UploadGrantInput={mode:'simple'|'multipart';locator:StorageLocator;uploadId:string|null;mimeType:string;expiresAt:Date};

const STS_WAIT_MS=10_000;
const STS_SAFETY_SECONDS=30;
const STS_PENDING_LIMIT=8;

/** Vendor calls live here; application services only receive the constrained grant. */
export class CosUploadGrantAdapter {
  private pendingCredentials=0;
  constructor(private readonly config:CosMediaConfig,private readonly credentials:(options:GetCredentialOptions)=>Promise<CredentialData>=getCredential) {}

  private async requestCredentials(options:GetCredentialOptions,waitMs:number):Promise<CredentialData> {
    if(this.pendingCredentials>=STS_PENDING_LIMIT) throw new Error('上传临时授权供应商繁忙');
    this.pendingCredentials++;
    const pending=Promise.resolve().then(()=>this.credentials(options));
    // SDK 3.1.3 exposes no abort hook. A logical timeout cannot release the
    // resource slot: keep it until the real request settles, with no wait queue.
    void pending.then(()=>{this.pendingCredentials--;},()=>{this.pendingCredentials--;});
    let timer:ReturnType<typeof setTimeout>|undefined;
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('上传临时授权供应商响应超时')),waitMs);});
    try {return await Promise.race([pending,timeout]);}
    finally {if(timer) clearTimeout(timer);}
  }

  async issue(input:UploadGrantInput):Promise<UploadGrant> {
    const {locator}=input;
    assertExactStaging(locator);
    if (locator.bucket!==this.config.bucket || locator.region!==this.config.region || !locator.key.startsWith(`${this.config.keyPrefix}staging/`)) throw new Error('上传授权超出当前项目范围');
    const now=Date.now();const remainingMs=input.expiresAt.getTime()-now;
    const remainingSeconds=Math.floor(remainingMs/1000);
    if (!Number.isSafeInteger(remainingSeconds) || remainingMs<=1000 || remainingSeconds>7200) throw new Error('上传授权剩余有效期无效');
    // STS starts DurationSeconds when it issues the credential, after our durable
    // reservation. Leave room for the round trip, second rounding and clock skew;
    // near expiry shrink the margin, while preserving the original hard deadline.
    // Tencent documents no 900-second minimum; short-duration acceptance is a cloud gate.
    const durationSeconds=Math.max(1,remainingSeconds-Math.min(STS_SAFETY_SECONDS,Math.floor(remainingSeconds/2)));
    const waitMs=Math.min(STS_WAIT_MS,remainingMs);
    const requestStarted=performance.now();
    let data:CredentialData;
    try { data=await this.requestCredentials({secretId:this.config.secretId!,secretKey:this.config.secretKey!,region:this.config.region!,durationSeconds,
      policy:input.mode==='multipart'?multipartUploadPolicy(locator):policy(locator,['name/cos:PutObject'])},waitMs); }
    catch { throw new Error('上传临时授权供应商调用失败'); }
    if (performance.now()-requestStarted>=waitMs || Date.now()>=input.expiresAt.getTime()
      || !data?.credentials?.tmpSecretId || !data.credentials.tmpSecretKey || !data.credentials.sessionToken
      || !Number.isSafeInteger(data.startTime) || !Number.isSafeInteger(data.expiredTime) || data.expiredTime<=Math.floor(Date.now()/1000)
      || data.startTime>=data.expiredTime
      || data.expiredTime*1000>input.expiresAt.getTime()) throw new Error('上传临时授权有效期无效');
    const credentials={tmp_secret_id:data.credentials.tmpSecretId,tmp_secret_key:data.credentials.tmpSecretKey,token:data.credentials.sessionToken};
    if(input.mode==='multipart') {
      if(!input.uploadId) throw new Error('分块上传尚未初始化');
      return {mode:'multipart',bucket:locator.bucket!,region:locator.region!,key:locator.key,upload_id:input.uploadId,credentials,start_time:data.startTime,expired_time:data.expiredTime};
    }
    // Explicit STS start/end avoids SDK's local one-second signing offset, which
    // can otherwise produce an already-expired URL for a very short credential.
    const signer=new COS({Protocol:'https:',getAuthorization:(_options,callback)=>callback({
      TmpSecretId:credentials.tmp_secret_id,TmpSecretKey:credentials.tmp_secret_key,SecurityToken:credentials.token,
      StartTime:data.startTime,ExpiredTime:data.expiredTime,
    })});
    // The shared bucket may be public-read. Bind an explicit private object ACL
    // into the PUT signature so clients cannot omit or replace it.
    const headers={'Content-Type':input.mimeType,'x-cos-acl':'private'};
    const url=await new Promise<string>((resolve,reject)=>signer.getObjectUrl({Bucket:locator.bucket!,Region:locator.region!,Key:locator.key,Method:'PUT',Sign:true,
      Headers:headers,Protocol:'https:'},(error,result)=>error?reject(new Error('上传指令签名失败')):resolve(result.Url)));
    if(Date.now()>=data.expiredTime*1000 || Date.now()>=input.expiresAt.getTime()) throw new Error('上传临时授权已到期');
    return {mode:'simple',method:'PUT',url,headers,expires_at:new Date(data.expiredTime*1000).toISOString()};
  }
}
