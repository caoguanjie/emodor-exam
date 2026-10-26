import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DataSource } from 'typeorm';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import { AppConfig } from '../../../config/configuration';
import { MediaUploadSession } from '../../../entities/media-upload-session.entity';
import { MediaService } from '../media.service';
import { mediaKindForPurpose, DEFAULT_MEDIA_LIMITS } from '../media-policy';
import { MediaProbeService, MediaProbeUnavailableError } from '../media-probe.service';
import { MediaPublisher, MediaPublishError } from '../media-publisher.service';
import { CosMediaStorage } from '../storage/cos-media-storage';
import type { StorageLocator, StoredObject } from '../storage/media-storage.port';
import { MediaUploadSessionService } from './media-upload-session.service';
import { isMissingObject } from './media-upload.errors';
import type { MediaUploadCandidate } from './media-upload.contract';

class UploadValidationError extends Error {}
class UploadClaimLost extends Error {}
type Claim={row:MediaUploadSession;candidate:MediaUploadCandidate};

@Injectable()
export class MediaUploadFinalizerService {
  private active=0;
  constructor(private readonly source:DataSource,private readonly media:MediaService,private readonly config:AppConfig,
    @Inject(CosMediaStorage) private readonly cos:CosMediaStorage|null,private readonly publisher:MediaPublisher,
    private readonly probe:MediaProbeService,private readonly sessions:MediaUploadSessionService) {}

  async runOnce(limit=this.config.mediaUpload?.finalizerConcurrency||2):Promise<{completed:number;failed:number}> {
    if(this.config.cosMedia?.provider!=='cos' || !this.cos) return {completed:0,failed:0};
    const maximum=this.config.mediaUpload.finalizerConcurrency;
    const slots=Math.max(0,Math.min(Math.floor(limit),maximum-this.active));
    if(!slots) return {completed:0,failed:0};
    // A merge whose reply was lost is resolved before a publishing claim is taken.
    const pending=await this.source.getRepository(MediaUploadSession).createQueryBuilder('s').where('s.state = :state',{state:'finalizing'})
      .andWhere('s.reason_code = :reason',{reason:'UPLOAD_COMPLETING'}).andWhere('(s.lease_until IS NULL OR s.lease_until <= :now)',{now:new Date()}).orderBy('s.created_at','ASC').take(slots).getMany();
    for(const row of pending) await this.sessions.reconcilePendingCompletion(row.id);
    const jobs:Promise<{completed:number;failed:number}>[]=[];
    for(let index=0;index<slots && this.active<maximum;index++) {
      this.active++;
      jobs.push(this.processOne().finally(()=>{this.active--;}));
    }
    const results=await Promise.all(jobs);
    return results.reduce((total,next)=>({completed:total.completed+next.completed,failed:total.failed+next.failed}),{completed:0,failed:0});
  }

  private async claim():Promise<Claim|'exhausted'|null> {
    return this.source.transaction(async manager=>{
      const repo=manager.getRepository(MediaUploadSession);const now=new Date();
      const row=await repo.createQueryBuilder('s').setLock('pessimistic_write').setOnLocked('skip_locked')
        .where('s.state=:state',{state:'finalizing'}).andWhere('s.reason_code IS NULL')
        .andWhere('(s.lease_until IS NULL OR s.lease_until<=:now)',{now}).orderBy('s.created_at','ASC').getOne();
      if(!row) return null;
      if(row.finalizeAttempts>=this.config.mediaUpload.maxAttempts) {
        row.state='failed';row.reasonCode='UPLOAD_RETRY_EXHAUSTED';row.finalizedAt=now;row.claimId=null;row.leaseUntil=null;await repo.save(row);return 'exhausted';
      }
      const claimId=randomUUID();const kind=mediaKindForPurpose(row.purpose);const ext=kind==='video'?'mp4':row.mimeType==='image/png'?'png':row.mimeType==='image/webp'?'webp':'jpg';
      const candidate:MediaUploadCandidate={kind:'formal',claimId,createdAt:now.toISOString(),locator:{provider:'cos',bucket:this.config.cosMedia.bucket,region:this.config.cosMedia.region,
        key:`${this.config.cosMedia.keyPrefix}media/${row.id}/${claimId}.${ext}`,versionId:null}};
      row.claimId=claimId;row.leaseUntil=new Date(now.getTime()+this.config.mediaUpload.leaseSeconds*1000);row.finalizeAttempts++;
      row.candidateObjects=[...(row.candidateObjects||[]),candidate];await repo.save(row);
      return {row,candidate};
    });
  }

  private async remember(claim:Claim,object:StoredObject|null,locator=object?.locator||claim.candidate.locator,sha256?:string):Promise<void> {
    await this.source.transaction(async manager=>{
      const repo=manager.getRepository(MediaUploadSession);const row=await repo.findOne({where:{id:claim.row.id},lock:{mode:'pessimistic_write'}});
      if(!row) return;
      const candidates=row.candidateObjects||[];
      let candidate=candidates.find(item=>item.kind!=='multipart' && item.claimId===claim.candidate.claimId);
      if(!candidate) {candidate={...claim.candidate};candidates.push(candidate);}
      candidate.locator=locator;if(object) candidate.object=object;if(sha256) candidate.sha256=sha256;
      row.candidateObjects=candidates;row.cleanedAt=null;
      await repo.save(row);
    });
  }

  private async spool(locator:StorageLocator,row:MediaUploadSession,claimId:string,assertClaim:()=>void):Promise<{filePath:string;sha256:string;dispose:()=>Promise<void>}> {
    const root=join(this.config.upload.dir,'tmp','cos-finalize');await mkdir(root,{recursive:true,mode:0o700});
    const directory=await mkdtemp(join(root,`${claimId}-`));const filePath=join(directory,'input');
    const dispose=()=>rm(directory,{recursive:true,force:true});
    const digest=createHash('sha256');let bytes=0;
    const kind=mediaKindForPurpose(row.purpose);
    const max=kind==='video'?(this.config.media?.videoMaxBytes||DEFAULT_MEDIA_LIMITS.videoMaxBytes):(this.config.media?.imageMaxBytes||DEFAULT_MEDIA_LIMITS.imageMaxBytes);
    const declared=Number(row.sizeBytes);
    const bounded=new Transform({transform(chunk,_,done){
      try {assertClaim();bytes+=chunk.length;if(bytes>declared || bytes>max) throw new UploadValidationError('上传正文超过大小上限');digest.update(chunk);done(null,chunk);}
      catch(error){done(error as Error);}
    }});
    const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),300_000);timeout.unref();
    try {
      assertClaim();await pipeline(await this.cos!.open(locator),bounded,createWriteStream(filePath,{flags:'wx',mode:0o600}),{signal:abort.signal});
      if(bytes!==declared) throw new UploadValidationError('上传正文大小与声明不符');
      const sha256=digest.digest('hex');if(sha256!==row.fingerprintSha256) throw new UploadValidationError('上传正文与原文件指纹不符');
      return {filePath,sha256,dispose};
    } catch(error) {await dispose();throw error;}
    finally {clearTimeout(timeout);}
  }

  private async processOne():Promise<{completed:number;failed:number}> {
    const claim=await this.claim();if(!claim) return {completed:0,failed:0};if(claim==='exhausted') return {completed:0,failed:1};
    let lost=false;let renewing=false;let spool:{filePath:string;sha256:string;dispose:()=>Promise<void>}|null=null;
    const assertClaim=()=>{if(lost) throw new UploadClaimLost();};
    const renew=async()=>{
      if(renewing||lost) return;renewing=true;
      try {
        const now=new Date();const result=await this.source.getRepository(MediaUploadSession).createQueryBuilder().update()
          .set({leaseUntil:new Date(now.getTime()+this.config.mediaUpload.leaseSeconds*1000)})
          .where('id=:id AND state=:state AND claim_id=:claim AND lease_until>:now',{id:claim.row.id,state:'finalizing',claim:claim.row.claimId,now}).execute();
        if(result.affected!==1) lost=true;
      } catch {lost=true;} finally {renewing=false;}
    };
    const timer=setInterval(()=>void renew(),this.config.mediaUpload.renewSeconds*1000);timer.unref();
    try {
      const actor={id:claim.row.uploadedBy} as unknown as AuthUser;
      await this.media.assertUploadAllowed(actor,claim.row.purpose,claim.row.ownerId);assertClaim();
      let object:StoredObject|null=null;
      // Reconcile a prior claim's exact candidate before inventing another cloud write.
      for(const previous of (claim.row.candidateObjects||[]).filter(item=>item.kind!=='multipart' && item.claimId!==claim.candidate.claimId).reverse()) {
        try {
          object=await this.cos!.stat(previous.object?.locator||previous.locator);
          if(object.sizeBytes!==Number(claim.row.sizeBytes)) {object=null;continue;}
          spool=await this.spool(object.locator,claim.row,claim.candidate.claimId,assertClaim);break;
        } catch(error) {if(error instanceof UploadClaimLost) throw error;object=null;if(!isMissingObject(error) && !(error instanceof UploadValidationError)) throw error;}
      }
      if(!spool) {
        if(!claim.row.stagingLocator) throw new UploadValidationError('缺少上传正文定位');
        spool=await this.spool(claim.row.stagingLocator,claim.row,claim.candidate.claimId,assertClaim);
      }
      assertClaim();let probed:any;
      try {probed=await this.probe.probe(spool.filePath,mediaKindForPurpose(claim.row.purpose));}
      catch(error) {if(error instanceof MediaProbeUnavailableError) throw error;throw new UploadValidationError('媒体正文格式校验失败');}
      const kind=mediaKindForPurpose(claim.row.purpose);const limits={...DEFAULT_MEDIA_LIMITS,...this.config.media};
      if(!(kind==='video'?limits.allowedVideoTypes:limits.allowedImageTypes).includes(probed.mimeType)
        || (kind==='video' && (!Number.isSafeInteger(probed.durationMs)||probed.durationMs<=0))) throw new UploadValidationError('媒体探测结果无效');
      assertClaim();
      if(!object) {
        try {object=await this.publisher.publishVerifiedFile({filePath:spool.filePath,locator:claim.candidate.locator,expectedSha256:spool.sha256,mimeType:probed.mimeType});}
        catch(error) {if(error instanceof MediaPublishError) await this.remember(claim,error.object,error.locator);throw error;}
      }
      object={...object,mimeType:probed.mimeType};await this.remember(claim,object,object.locator,spool.sha256);assertClaim();
      // Permission checks use their existing repositories. Do not borrow another
      // connection while holding a session transaction in a small DB pool.
      await this.media.assertUploadAllowed(actor,claim.row.purpose,claim.row.ownerId);assertClaim();
      const committed=await this.source.transaction(async manager=>{
        const repo=manager.getRepository(MediaUploadSession);const row=await repo.findOne({where:{id:claim.row.id},lock:{mode:'pessimistic_write'}});
        const now=new Date();
        if(!row || row.state!=='finalizing' || row.claimId!==claim.row.claimId || !row.leaseUntil || row.leaseUntil<=now) return false;
        const asset=await this.media.createReadyAsset(manager,{ownerId:row.ownerId,uploadedBy:row.uploadedBy,purpose:row.purpose,mediaKind:kind,
          originalName:row.originalName,object:object!,sha256:spool!.sha256,durationMs:kind==='video'?probed.durationMs:null});
        row.assetId=String(asset.id);row.receipt={asset_id:String(asset.id),status:'ready',duration_ms:kind==='video'?probed.durationMs:null};
        row.receiptExpiresAt=new Date(now.getTime()+this.config.mediaUpload.receiptTtlSeconds*1000);row.state='completed';row.reasonCode=null;row.errorMessage=null;row.finalizedAt=now;row.claimId=null;row.leaseUntil=null;
        await repo.save(row);return true;
      });
      return {completed:committed?1:0,failed:0};
    } catch(error) {
      if(error instanceof UploadClaimLost || lost) return {completed:0,failed:0};
      const terminal=error instanceof UploadValidationError || (error as any)?.httpStatus===403;
      const failed=await this.source.transaction(async manager=>{
        const repo=manager.getRepository(MediaUploadSession);const row=await repo.findOne({where:{id:claim.row.id},lock:{mode:'pessimistic_write'}});
        if(!row || row.state!=='finalizing' || row.claimId!==claim.row.claimId || !row.leaseUntil || row.leaseUntil<=new Date()) return false;
        if(terminal || row.finalizeAttempts>=this.config.mediaUpload.maxAttempts) {row.state='failed';row.reasonCode=terminal?'UPLOAD_VALIDATION_FAILED':'UPLOAD_RETRY_EXHAUSTED';row.finalizedAt=new Date();}
        else {row.reasonCode=null;}
        row.errorMessage=terminal?'媒体上传校验未通过':'媒体处理暂时失败，等待后台恢复';row.claimId=null;row.leaseUntil=null;await repo.save(row);return row.state==='failed';
      });
      return {completed:0,failed:failed?1:0};
    } finally {clearInterval(timer);if(spool) await spool.dispose();}
  }
}
