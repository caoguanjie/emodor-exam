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

/** Vendor calls live here; application services only receive the constrained grant. */
export class CosUploadGrantAdapter {
  constructor(private readonly config:CosMediaConfig,private readonly credentials:(options:GetCredentialOptions)=>Promise<CredentialData>=getCredential) {}

  async issue(input:UploadGrantInput):Promise<UploadGrant> {
    const {locator}=input;
    assertExactStaging(locator);
    if (locator.bucket!==this.config.bucket || locator.region!==this.config.region || !locator.key.startsWith(`${this.config.keyPrefix}staging/`)) throw new Error('上传授权超出当前项目范围');
    // Tencent documents a default/max duration; do not import another cloud's
    // minimum. Actual provider acceptance of short durations remains a cloud gate.
    const durationSeconds=Math.floor(input.expiresAt.getTime()/1000)-Math.floor(Date.now()/1000);
    if (!Number.isSafeInteger(durationSeconds) || durationSeconds<=0 || durationSeconds>7200 || input.expiresAt.getTime()<=Date.now()) throw new Error('上传授权剩余有效期无效');
    let data:CredentialData;
    try { data=await this.credentials({secretId:this.config.secretId!,secretKey:this.config.secretKey!,region:this.config.region!,durationSeconds,
      policy:input.mode==='multipart'?multipartUploadPolicy(locator):policy(locator,['name/cos:PutObject'])}); }
    catch { throw new Error('上传临时授权供应商调用失败'); }
    if (!data?.credentials?.tmpSecretId || !data.credentials.tmpSecretKey || !data.credentials.sessionToken
      || !Number.isSafeInteger(data.startTime) || !Number.isSafeInteger(data.expiredTime) || data.expiredTime<=Math.floor(Date.now()/1000)
      || data.expiredTime*1000>input.expiresAt.getTime()) throw new Error('上传临时授权有效期无效');
    const credentials={tmp_secret_id:data.credentials.tmpSecretId,tmp_secret_key:data.credentials.tmpSecretKey,token:data.credentials.sessionToken};
    if(input.mode==='multipart') {
      if(!input.uploadId) throw new Error('分块上传尚未初始化');
      return {mode:'multipart',bucket:locator.bucket!,region:locator.region!,key:locator.key,upload_id:input.uploadId,credentials,start_time:data.startTime,expired_time:data.expiredTime};
    }
    const remaining=data.expiredTime-Math.floor(Date.now()/1000);
    if(remaining<=0) throw new Error('上传临时授权已到期');
    const signer=new COS({SecretId:credentials.tmp_secret_id,SecretKey:credentials.tmp_secret_key,SecurityToken:credentials.token,Protocol:'https:'});
    const url=await new Promise<string>((resolve,reject)=>signer.getObjectUrl({Bucket:locator.bucket!,Region:locator.region!,Key:locator.key,Method:'PUT',Sign:true,
      Headers:{'Content-Type':input.mimeType},Expires:remaining,Protocol:'https:'},(error,result)=>error?reject(new Error('上传指令签名失败')):resolve(result.Url)));
    return {mode:'simple',method:'PUT',url,headers:{'Content-Type':input.mimeType},expires_at:new Date(data.expiredTime*1000).toISOString()};
  }
}
