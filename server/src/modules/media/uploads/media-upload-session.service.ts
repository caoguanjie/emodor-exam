import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import { Errors } from '../../../common/errors';
import { AppConfig } from '../../../config/configuration';
import { MediaUploadSession } from '../../../entities/media-upload-session.entity';
import { MediaService } from '../media.service';
import { CosMediaStorage } from '../storage/cos-media-storage';
import type { StoredObject, UploadedPart } from '../storage/media-storage.port';
import { normalizeUploadInit } from './media-upload.dto';
import { isMissingObject, uploadConflict } from './media-upload.errors';
import type { UploadInit, UploadSessionView } from './media-upload.contract';

const INITIALIZING='UPLOAD_INITIALIZING';
const COMPLETING='UPLOAD_COMPLETING';

@Injectable()
export class MediaUploadSessionService {
  constructor(private readonly source:DataSource,private readonly media:MediaService,private readonly config:AppConfig,
    @Inject(CosMediaStorage) private readonly cos:CosMediaStorage|null) {}

  private direct():CosMediaStorage {
    if(this.config.cosMedia?.provider!=='cos' || !this.cos) throw Errors.serviceUnavailable('当前存储模式未启用对象直传');
    return this.cos;
  }

  private normalizeState(row:MediaUploadSession,now=new Date()):boolean {
    if(row.state==='uploading' && row.expiresAt<=now) {
      row.state='expired';row.reasonCode='UPLOAD_EXPIRED';row.claimId=null;return true;
    }
    if(row.state==='completed' && row.receiptExpiresAt && row.receiptExpiresAt<=now) {
      row.state='expired';row.reasonCode='UPLOAD_RECEIPT_EXPIRED';row.receipt=null;return true;
    }
    return false;
  }

  async assertCurrent(actor:AuthUser,row:MediaUploadSession):Promise<void> {
    if(String(row.uploadedBy)!==String(actor.id)) throw Errors.dataForbidden('无权访问该上传会话');
    await this.media.assertUploadAllowed(actor,row.purpose,row.ownerId);
  }

  async loadOwned(actor:AuthUser,id:string):Promise<MediaUploadSession> {
    if(!/^[a-f0-9-]{36}$/i.test(id)) throw Errors.notFound('上传会话不存在');
    const row=await this.source.getRepository(MediaUploadSession).findOne({where:{id}});
    if(!row) throw Errors.notFound('上传会话不存在');
    await this.assertCurrent(actor,row);
    return row;
  }

  private async locked(manager:EntityManager,id:string):Promise<MediaUploadSession> {
    const row=await manager.getRepository(MediaUploadSession).findOne({where:{id},lock:{mode:'pessimistic_write'}});
    if(!row) throw Errors.notFound('上传会话不存在');
    return row;
  }

  async begin(actor:AuthUser,raw:UploadInit):Promise<UploadSessionView> {
    this.direct();
    const input=normalizeUploadInit(raw,this.config);
    const {ownerId}=await this.media.assertUploadAllowed(actor,input.purpose,input.owner_id);
    const digest=createHash('sha256').update(JSON.stringify([ownerId,input.purpose,input.filename,input.mime_type,input.size_bytes,input.fingerprint_sha256])).digest('hex');
    const repo=this.source.getRepository(MediaUploadSession);
    let row=await repo.findOne({where:{uploadedBy:String(actor.id),clientRequestId:input.client_request_id}});
    if(!row) {
      const id=randomUUID(); const options=this.config.mediaUpload; const now=new Date();
      const created=repo.create({id,ownerId,uploadedBy:String(actor.id),clientRequestId:input.client_request_id,requestDigest:digest,
        purpose:input.purpose,originalName:input.filename,mimeType:input.mime_type,sizeBytes:String(input.size_bytes),fingerprintSha256:input.fingerprint_sha256,
        mode:input.purpose!=='avatar'&&input.size_bytes>=options.multipartThresholdBytes?'multipart':'simple',partSize:options.partSizeBytes,parallelLimit:options.parallelLimit,
        stagingLocator:{provider:'cos',bucket:this.config.cosMedia.bucket,region:this.config.cosMedia.region,key:`${this.config.cosMedia.keyPrefix}staging/${id}.upload`,versionId:null},
        uploadId:null,state:'uploading',expiresAt:new Date(now.getTime()+options.sessionTtlSeconds*1000),lastCredentialExpiresAt:null,claimId:null,leaseUntil:null,
        finalizeAttempts:0,candidateObjects:[],assetId:null,receipt:null,receiptExpiresAt:null,reasonCode:null,errorMessage:null,finalizedAt:null,cleanedAt:null});
      try { await repo.insert(created); row=created; }
      catch(error) {
        if((error as any)?.code!=='ER_DUP_ENTRY' && (error as any)?.driverError?.code!=='ER_DUP_ENTRY') throw error;
        row=await repo.findOne({where:{uploadedBy:String(actor.id),clientRequestId:input.client_request_id}});
        if(!row) throw Errors.internal('上传会话创建结果待确认');
      }
    }
    if(row.requestDigest!==digest) throw uploadConflict('UPLOAD_REQUEST_CONFLICT','同一上传请求标识不能更换文件或用途');
    return this.status(actor,row.id);
  }

  private async claim(id:string,state:'uploading'|'finalizing',reason:string):Promise<MediaUploadSession|null> {
    return this.source.transaction(async manager=>{
      const repo=manager.getRepository(MediaUploadSession);const row=await this.locked(manager,id); const now=new Date();
      if(this.normalizeState(row,now)) await repo.save(row);
      if(row.state!==state || (row.leaseUntil && row.leaseUntil>now)) return null;
      if(state==='finalizing' && row.reasonCode!==COMPLETING) return null;
      row.claimId=randomUUID();row.leaseUntil=new Date(now.getTime()+this.config.mediaUpload.leaseSeconds*1000);row.reasonCode=reason;
      if(state==='finalizing') row.finalizeAttempts++;
      return repo.save(row);
    });
  }

  private async pending(row:MediaUploadSession,reason:string):Promise<void> {
    await this.source.transaction(async manager=>{
      const repo=manager.getRepository(MediaUploadSession); const current=await this.locked(manager,row.id);
      if(current.claimId!==row.claimId || current.state!==row.state) return;
      current.reasonCode=reason;current.claimId=null;current.leaseUntil=new Date(Date.now()+2000);
      if(current.state==='finalizing' && current.finalizeAttempts>=this.config.mediaUpload.maxAttempts) {
        current.state='failed';current.reasonCode='UPLOAD_COMPLETION_FAILED';current.leaseUntil=null;current.finalizedAt=new Date();
      }
      await repo.save(current);
    });
  }

  private async initialize(id:string):Promise<void> {
    const claimed=await this.claim(id,'uploading',INITIALIZING);
    if(!claimed) return;
    const cos=this.direct();
    try {
      if(!claimed.stagingLocator) throw new Error('缺少临时对象');
      let tasks=await cos.listMultipartUploads(claimed.stagingLocator);
      if(!tasks.length) {
        const created=await cos.begin(claimed.stagingLocator,claimed.mimeType);
        tasks=[{uploadId:created.uploadId,initiatedAt:new Date().toISOString()}];
      }
      tasks.sort((a,b)=>(a.initiatedAt||'').localeCompare(b.initiatedAt||'') || a.uploadId.localeCompare(b.uploadId));
      await this.source.transaction(async manager=>{
        const repo=manager.getRepository(MediaUploadSession);const row=await this.locked(manager,id);
        // Register even a stale initializer's result so a later cleanup owns it.
        const candidates=row.candidateObjects||[];
        for(const task of tasks) if(!candidates.some(item=>item.kind==='multipart' && item.uploadId===task.uploadId)) candidates.push({kind:'multipart',uploadId:task.uploadId,claimId:claimed.claimId!,locator:claimed.stagingLocator!,createdAt:new Date().toISOString()});
        row.candidateObjects=candidates;row.cleanedAt=null;
        if(row.claimId===claimed.claimId && row.state==='uploading' && row.leaseUntil && row.leaseUntil>new Date()) {
          row.uploadId=row.uploadId||tasks[0].uploadId;row.claimId=null;row.leaseUntil=null;row.reasonCode=null;
        }
        await repo.save(row);
      });
    } catch { await this.pending(claimed,INITIALIZING); }
  }

  private validateParts(row:MediaUploadSession,parts:UploadedPart[]):void {
    const size=Number(row.sizeBytes);const count=Math.ceil(size/row.partSize);
    if(parts.length!==count || parts.some((part,index)=>part.partNumber!==index+1 || part.sizeBytes!==(index===count-1?size-index*row.partSize:row.partSize))) {
      throw uploadConflict('UPLOAD_PARTS_INCOMPLETE','分块尚未完整上传，请读取原会话恢复');
    }
  }

  private assertShape(row:MediaUploadSession,object:StoredObject):void {
    if(object.sizeBytes!==Number(row.sizeBytes)) throw uploadConflict('UPLOAD_SIZE_MISMATCH','上传对象长度与声明不符');
  }

  private async publishCompletion(row:MediaUploadSession,object:StoredObject):Promise<void> {
    this.assertShape(row,object);
    await this.source.transaction(async manager=>{
      const current=await this.locked(manager,row.id);
      if(current.state!=='finalizing' || current.claimId!==row.claimId || !current.leaseUntil || current.leaseUntil<=new Date()) return;
      current.stagingLocator=object.locator;current.claimId=null;current.leaseUntil=null;current.reasonCode=null;
      await manager.getRepository(MediaUploadSession).save(current);
    });
  }

  /** Reconcile an unknown merge before any publishing worker consumes bytes. */
  async reconcilePendingCompletion(id:string):Promise<void> {
    if(!this.cos || this.config.cosMedia?.provider!=='cos') return;
    const row=await this.claim(id,'finalizing',COMPLETING);
    if(!row) return;
    try {
      let object:StoredObject;
      try { object=await this.cos.stat({...row.stagingLocator!,versionId:null}); }
      catch(error) {
        if(!isMissingObject(error) || row.mode!=='multipart' || !row.uploadId) throw error;
        const parts=await this.cos.parts(row.stagingLocator!,row.uploadId);this.validateParts(row,parts);
        object=await this.cos.complete(row.stagingLocator!,row.uploadId,parts);
      }
      await this.publishCompletion(row,object);
    } catch { await this.pending(row,COMPLETING); }
  }

  async status(actor:AuthUser,id:string):Promise<UploadSessionView> {
    this.direct();
    let row=await this.loadOwned(actor,id);
    if(row.state==='uploading' && row.mode==='multipart' && !row.uploadId && row.expiresAt>new Date()) await this.initialize(id);
    if(row.state==='finalizing' && row.reasonCode===COMPLETING) await this.reconcilePendingCompletion(id);
    row=await this.source.transaction(async manager=>{
      const current=await this.locked(manager,id);if(this.normalizeState(current)) await manager.getRepository(MediaUploadSession).save(current);return current;
    });
    let parts:UploadedPart[]=[];
    if(row.state==='uploading' && row.mode==='multipart' && row.uploadId && row.stagingLocator) {
      try { parts=await this.cos!.parts(row.stagingLocator,row.uploadId); }
      catch(error) {
        const fresh=await this.loadOwned(actor,id);
        if(fresh.state==='uploading') throw error;
        row=fresh;
      }
    }
    return {session_id:row.id,state:row.state,mode:row.mode,expires_at:row.expiresAt.toISOString(),part_size:row.partSize,parallel_limit:row.parallelLimit,parts,
      result:row.state==='completed'?row.receipt:null,reason_code:row.reasonCode};
  }

  async complete(actor:AuthUser,id:string):Promise<UploadSessionView> {
    const cos=this.direct();const initial=await this.loadOwned(actor,id);
    if(initial.state!=='uploading') return this.status(actor,id);
    if(initial.mode==='multipart' && !initial.uploadId) await this.initialize(id);
    const row=await this.claim(id,'uploading',COMPLETING);
    if(!row) return this.status(actor,id);
    let object:StoredObject|undefined; let parts:UploadedPart[]=[];
    try {
      if(!row.stagingLocator) throw uploadConflict('UPLOAD_EXPIRED');
      if(row.mode==='multipart') {
        if(!row.uploadId) throw uploadConflict('UPLOAD_INITIALIZING');
        parts=await cos.parts(row.stagingLocator,row.uploadId);this.validateParts(row,parts);
      } else { object=await cos.stat(row.stagingLocator);this.assertShape(row,object); }
    } catch(error) {
      await this.source.transaction(async manager=>{
        const current=await this.locked(manager,id);
        if(current.state==='uploading' && current.claimId===row.claimId) {current.claimId=null;current.leaseUntil=null;current.reasonCode=null;await manager.getRepository(MediaUploadSession).save(current);}
      });
      if(isMissingObject(error)) throw uploadConflict('UPLOAD_NOT_PRESENT','尚未收到完整上传对象');
      throw error;
    }
    const entered=await this.source.transaction(async manager=>{
      const current=await this.locked(manager,id);
      if(current.state!=='uploading' || current.claimId!==row.claimId || !current.leaseUntil || current.leaseUntil<=new Date()) return false;
      if(this.normalizeState(current)) {await manager.getRepository(MediaUploadSession).save(current);return false;}
      current.state='finalizing';current.reasonCode=COMPLETING;await manager.getRepository(MediaUploadSession).save(current);return true;
    });
    if(!entered) return this.status(actor,id);
    row.state='finalizing';
    try {
      object=object||await cos.complete(row.stagingLocator!,row.uploadId!,parts);
      await this.publishCompletion(row,object);
    } catch { await this.pending(row,COMPLETING); }
    return this.status(actor,id);
  }

  async cancel(actor:AuthUser,id:string):Promise<UploadSessionView> {
    this.direct();await this.loadOwned(actor,id);
    await this.source.transaction(async manager=>{
      const row=await this.locked(manager,id);
      if(this.normalizeState(row) || row.state==='uploading') {
        if(row.state==='uploading') {row.state='aborted';row.reasonCode='UPLOAD_ABORTED';row.finalizedAt=new Date();}
        row.claimId=null;await manager.getRepository(MediaUploadSession).save(row);
      }
    });
    return this.status(actor,id);
  }

  async reserveGrant(actor:AuthUser,id:string):Promise<{session:MediaUploadSession;expiresAt:Date}> {
    this.direct();let row=await this.loadOwned(actor,id);
    if(row.mode==='multipart' && !row.uploadId) {await this.initialize(id);row=await this.loadOwned(actor,id);}
    return this.source.transaction(async manager=>{
      const current=await this.locked(manager,id);const now=new Date();
      if(this.normalizeState(current,now)) await manager.getRepository(MediaUploadSession).save(current);
      if(current.state!=='uploading') throw uploadConflict(current.reasonCode||'UPLOAD_NOT_WRITABLE');
      if((current.leaseUntil && current.leaseUntil>now) || (current.mode==='multipart' && !current.uploadId)) throw uploadConflict(current.reasonCode||'UPLOAD_BUSY');
      const expiresAt=new Date(Math.min(current.expiresAt.getTime(),now.getTime()+this.config.mediaUpload.grantTtlSeconds*1000));
      if(expiresAt.getTime()<=now.getTime()) throw uploadConflict('UPLOAD_EXPIRED','上传会话已过期');
      if(!current.lastCredentialExpiresAt || current.lastCredentialExpiresAt<expiresAt) current.lastCredentialExpiresAt=expiresAt;
      await manager.getRepository(MediaUploadSession).save(current);
      return {session:current,expiresAt};
    });
  }
}
