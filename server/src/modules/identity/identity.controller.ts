import { Body, Controller, Delete, Get, HttpCode, Param, Post, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import { IdentityImageDto, IdentitySessionCreateDto } from './identity.dto';
import { IdentityImageService } from './identity-image.service';
import { IdentityService } from './identity.service';
import { IdentityExceptionFilter } from './identity-exception.filter';
import { MediaService } from '../media/media.service';

@Controller('me/identity-verification')
@UseFilters(IdentityExceptionFilter)
export class IdentityController {
  constructor(private readonly identity: IdentityService, private readonly images: IdentityImageService, private readonly media: MediaService) {}
  private actor(user: AuthUser) { if (user.client !== 'mobile' || user.role !== 'employee') throw Errors.forbidden(); return String(user.id); }
  @Get() view(@CurrentUser() user: AuthUser) { return this.identity.view(this.actor(user)); }
  @Post('images') @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, fieldSize: 128 } }))
  upload(@CurrentUser() user: AuthUser, @Body(new StrictDtoValidationPipe(['image_type'])) dto: IdentityImageDto, @UploadedFile() file?: Express.Multer.File) {
    const id = this.actor(user);
    if (!file?.buffer?.length) throw Errors.param('缺少认证图片');
    return this.images.upload(id, dto.image_type, file.buffer);
  }
  @Delete('images/:assetId')
  async release(@CurrentUser() user: AuthUser, @Param('assetId') id: string) { await this.media.releaseIdentityImage(this.actor(user), id); return null; }
  @Post('sessions') @HttpCode(200)
  create(@CurrentUser() user: AuthUser, @Body(new StrictDtoValidationPipe(['face_asset_id', 'id_card_portrait_asset_id', 'id_card_emblem_asset_id'])) dto: IdentitySessionCreateDto) {
    return this.identity.create(this.actor(user), dto);
  }
  @Get('sessions/:sessionId') get(@CurrentUser() user: AuthUser, @Param('sessionId') id: string) { return this.identity.get(this.actor(user), id); }
}
