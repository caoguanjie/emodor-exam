import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import { Errors } from '../../../common/errors';
import { AppConfig } from '../../../config/configuration';
import { MediaService } from '../media.service';
import { CosUploadGrantAdapter } from '../storage/cos-upload-grant.adapter';
import { MediaUploadSessionService } from './media-upload-session.service';
import { uploadConflict } from './media-upload.errors';
import type { UploadGrant } from './media-upload.contract';

@Injectable()
export class MediaUploadGrantService {
  private adapter:CosUploadGrantAdapter|null;
  constructor(private readonly source:DataSource,private readonly media:MediaService,private readonly sessions:MediaUploadSessionService,private readonly config:AppConfig,
    @Optional() adapter?:CosUploadGrantAdapter) {this.adapter=adapter||null;}

  async issue(actor:AuthUser,id:string):Promise<UploadGrant> {
    const {session,expiresAt}=await this.sessions.reserveGrant(actor,id);
    if(!session.stagingLocator) throw uploadConflict('UPLOAD_EXPIRED');
    this.adapter ||= new CosUploadGrantAdapter(this.config.cosMedia);
    let grant:UploadGrant;
    try {grant=await this.adapter.issue({mode:session.mode,locator:session.stagingLocator,uploadId:session.uploadId,mimeType:session.mimeType,expiresAt});}
    catch {throw Errors.serviceUnavailable('上传临时授权暂不可用，请稍后重试');}
    const current=await this.sessions.loadOwned(actor,id);
    if(current.state!=='uploading' || current.expiresAt<=new Date()) throw uploadConflict(current.reasonCode||'UPLOAD_NOT_WRITABLE');
    return grant;
  }
}
