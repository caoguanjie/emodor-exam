import { Body, Controller, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors } from '../../common/errors';
import { MediaUploadInterceptor } from '../media/media-upload.interceptor';
import { AnswerDraftService } from './answer-draft.service';
import { AnswerImageDto } from './attempt.dto';

@Controller('me/exam-records')
export class AnswerMediaController {
  constructor(private readonly drafts: AnswerDraftService) {}

  @Post(':id/answer-images')
  @UseInterceptors(MediaUploadInterceptor())
  async upload(
    @Param('id') recordId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new StrictDtoValidationPipe(['item_id'])) dto: AnswerImageDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw Errors.param('缺少上传文件');
    const result = await this.drafts.uploadImage(String(user.id), String(recordId), String(dto.item_id), file);
    return { asset_id: result.assetId, status: result.status, duration_ms: result.durationMs };
  }
}
