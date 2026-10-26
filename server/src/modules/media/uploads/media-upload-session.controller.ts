import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { StrictDtoValidationPipe } from '../../../common/dto-validation.pipe';
import { Errors } from '../../../common/errors';
import { EmptyUploadDto, MediaUploadInitDto, UPLOAD_INIT_FIELDS } from './media-upload.dto';
import { MediaUploadSessionService } from './media-upload-session.service';
import { MediaUploadGrantService } from './media-upload-grant.service';

function assertKeys(value:unknown,allowed:readonly string[],optional=false):void {
  if(optional && value===undefined) return;
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key))) throw Errors.param('上传请求包含无效或不支持的字段');
}

@Controller('media/upload-sessions')
export class MediaUploadSessionController {
  constructor(private readonly sessions:MediaUploadSessionService,private readonly grants:MediaUploadGrantService) {}
  @Post()
  begin(@CurrentUser() actor:AuthUser,@Body(new StrictDtoValidationPipe(UPLOAD_INIT_FIELDS)) input:MediaUploadInitDto,@Req() req:Request) {assertKeys(req.body,UPLOAD_INIT_FIELDS);return this.sessions.begin(actor,input);}
  @Get(':id')
  status(@CurrentUser() actor:AuthUser,@Param('id') id:string) {return this.sessions.status(actor,id);}
  @Post(':id/credentials')
  credentials(@CurrentUser() actor:AuthUser,@Param('id') id:string,@Body(new StrictDtoValidationPipe([])) _:EmptyUploadDto,@Req() req:Request) {assertKeys(req.body,[],true);return this.grants.issue(actor,id);}
  @Post(':id/complete')
  complete(@CurrentUser() actor:AuthUser,@Param('id') id:string,@Body(new StrictDtoValidationPipe([])) _:EmptyUploadDto,@Req() req:Request) {assertKeys(req.body,[],true);return this.sessions.complete(actor,id);}
  @Delete(':id')
  cancel(@CurrentUser() actor:AuthUser,@Param('id') id:string) {return this.sessions.cancel(actor,id);}
}
