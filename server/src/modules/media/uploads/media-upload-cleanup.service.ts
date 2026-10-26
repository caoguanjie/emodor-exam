import { Inject, Injectable } from '@nestjs/common';
import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, IsNull } from 'typeorm';
import { AppConfig } from '../../../config/configuration';
import { MediaAsset } from '../../../entities/media-asset.entity';
import { MediaUploadSession } from '../../../entities/media-upload-session.entity';
import { CosMediaStorage } from '../storage/cos-media-storage';
import type { StorageLocator } from '../storage/media-storage.port';
import { isMissingObject } from './media-upload.errors';

@Injectable()
export class MediaUploadCleanupService {
  constructor(private readonly source:DataSource,private readonly config:AppConfig,@Inject(CosMediaStorage) private readonly cos:CosMediaStorage|null) {}

  private async protected(locator:StorageLocator):Promise<boolean> {
    const scope={storageProvider:'cos' as const,storageKey:locator.key,cosBucket:locator.bucket!,cosRegion:locator.region!};
    // A legacy null version is an unpinned locator. It must conservatively
    // protect that key if versioning was enabled after the asset was written.
    return (await this.source.getRepository(MediaAsset).count({where:locator.versionId===null?{...scope,cosVersionId:IsNull()}:
      [{...scope,cosVersionId:locator.versionId},{...scope,cosVersionId:IsNull()}]}))>0;
  }

  async runOnce(now:Date):Promise<{cleaned:number;deferred:number}> {
    if(this.config.cosMedia?.provider!=='cos' || !this.cos) return {cleaned:0,deferred:0};
    const repo=this.source.getRepository(MediaUploadSession);
    // Expiration and cancellation arbitrate under the same row lock as complete.
    const expiring=await repo.createQueryBuilder('s').where('s.state=:state',{state:'uploading'}).andWhere('s.expires_at<=:now',{now}).take(100).getMany();
    for(const candidate of expiring) await this.source.transaction(async manager=>{
      const locked=await manager.getRepository(MediaUploadSession).findOne({where:{id:candidate.id},lock:{mode:'pessimistic_write'}});
      if(locked?.state==='uploading' && locked.expiresAt<=now) {locked.state='expired';locked.reasonCode='UPLOAD_EXPIRED';locked.claimId=null;await manager.getRepository(MediaUploadSession).save(locked);}
    });
    const rows=await repo.createQueryBuilder('s').where('s.state IN (:...states)',{states:['completed','failed','aborted','expired']})
      .andWhere('(s.cleaned_at IS NULL OR s.receipt_expires_at<=:now)',{now}).orderBy('s.created_at','ASC').take(100).getMany();
    let cleaned=0;let deferred=0;
    for(const snapshot of rows) {
      if((snapshot.leaseUntil && snapshot.leaseUntil>now) || (snapshot.lastCredentialExpiresAt && snapshot.lastCredentialExpiresAt>=now)) {deferred++;continue;}
      try {
        let waiting=false;
        if(snapshot.stagingLocator) {
          // Never delete any live media row, even if a corrupted locator points at staging.
          if(await repo.manager.getRepository(MediaAsset).count({where:{storageProvider:'cos',storageKey:snapshot.stagingLocator.key,cosBucket:snapshot.stagingLocator.bucket!,cosRegion:snapshot.stagingLocator.region!}})) {deferred++;continue;}
          for(const task of await this.cos.listMultipartUploads(snapshot.stagingLocator)) await this.cos.abort(snapshot.stagingLocator,task.uploadId);
          await this.cos.removeStagingVersions(snapshot.stagingLocator);
        }
        for(const candidate of snapshot.candidateObjects||[]) {
          if(candidate.kind==='multipart') {
            if(candidate.uploadId && candidate.locator.key!==snapshot.stagingLocator?.key) {
              const live=await this.source.getRepository(MediaAsset).count({where:{storageProvider:'cos',storageKey:candidate.locator.key,cosBucket:candidate.locator.bucket!,cosRegion:candidate.locator.region!}});
              if(live) {waiting=true;continue;}
              await this.cos.abort(candidate.locator,candidate.uploadId);await this.cos.removeStagingVersions(candidate.locator);
            }
            continue;
          }
          if(!candidate.locator.key.startsWith(`${this.config.cosMedia.keyPrefix}media/`)) {waiting=true;continue;}
          if(new Date(candidate.createdAt).getTime()+this.config.mediaUpload.orphanGraceSeconds*1000>now.getTime()) {waiting=true;continue;}
          let locator=candidate.object?.locator||candidate.locator;
          if(locator.versionId===null) {
            try {locator=(await this.cos.stat(locator)).locator;}
            catch(error) {if(isMissingObject(error)) continue;throw error;}
          }
          if(await this.protected(locator)) continue;
          await this.cos.remove(locator);
        }
        const gate=(snapshot.lastCredentialExpiresAt||snapshot.finalizedAt||snapshot.expiresAt).getTime()+this.config.mediaUpload.orphanGraceSeconds*1000;
        // Scan once after expiry and again after the late-write grace interval.
        if(gate>now.getTime()) waiting=true;
        const done=await this.source.transaction(async manager=>{
          const sessions=manager.getRepository(MediaUploadSession);const row=await sessions.findOne({where:{id:snapshot.id},lock:{mode:'pessimistic_write'}});
          if(!row || !['completed','failed','aborted','expired'].includes(row.state) || (row.leaseUntil&&row.leaseUntil>now)
            || (row.lastCredentialExpiresAt&&row.lastCredentialExpiresAt>=now)) return false;
          // A stale process may register an exact late object while this scan is
          // in progress. Keep its durable locator for the next scan.
          if(JSON.stringify(row.candidateObjects)!==JSON.stringify(snapshot.candidateObjects)) return false;
          if(waiting) return false;
          row.cleanedAt=now;
          if(row.state==='completed' && row.receiptExpiresAt && row.receiptExpiresAt<=now) {row.state='expired';row.reasonCode='UPLOAD_RECEIPT_EXPIRED';row.receipt=null;}
          if(row.state!=='completed') {row.originalName=null;row.stagingLocator=null;row.uploadId=null;row.candidateObjects=null;row.receipt=null;row.receiptExpiresAt=null;row.errorMessage=null;row.claimId=null;row.leaseUntil=null;}
          await sessions.save(row);return true;
        });
        if(done) cleaned++;else deferred++;
      } catch {deferred++;}
    }
    await this.cleanupSpool(now);
    return {cleaned,deferred};
  }

  private async cleanupSpool(now:Date):Promise<void> {
    const root=join(this.config.upload.dir,'tmp','cos-finalize');let entries:string[];
    try {entries=await readdir(root);} catch(error) {if((error as any)?.code==='ENOENT') return;throw error;}
    for(const name of entries) {
      const match=/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-[A-Za-z0-9_-]{6}$/.exec(name);
      if(!match) continue;
      const path=join(root,name);const info=await lstat(path).catch(()=>null);
      if(!info || info.isSymbolicLink() || !info.isDirectory() || info.mtimeMs+this.config.mediaUpload.orphanGraceSeconds*1000>now.getTime()) continue;
      const owner=await this.source.getRepository(MediaUploadSession).findOne({where:{claimId:match[1]}});
      if(owner?.leaseUntil && owner.leaseUntil>now) continue;
      await rm(path,{recursive:true,force:true});
    }
  }
}
