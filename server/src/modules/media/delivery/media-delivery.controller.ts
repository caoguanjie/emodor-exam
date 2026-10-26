import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/guards/public.decorator';
import { StrictDtoValidationPipe } from '../../../common/dto-validation.pipe';
import { SkipEnvelope } from '../../../common/response.interceptor';
import { sendMediaContent } from '../media-content.response';
import { MediaDeliveryService } from './media-delivery.service';
import { assertMediaBatchBody, assertMediaBodyKeys, MediaTicketBatchDto } from './media-delivery.dto';

@Controller('media')
export class MediaDeliveryController {
  constructor(@Inject(MediaDeliveryService) private readonly delivery: MediaDeliveryService) {}

  @Post(':assetId/preview-ticket') @HttpCode(200)
  preview(@Param('assetId') assetId: string, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    assertMediaBodyKeys(req.body, [], true);
    return this.delivery.issuePreview(actor, assetId);
  }

  @Post('tickets/batch') @HttpCode(200)
  batch(@Body(new StrictDtoValidationPipe(['items'])) dto: MediaTicketBatchDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    assertMediaBatchBody(req.body);
    return this.delivery.issueLearnerBatch(actor, dto.items);
  }

  @Get('preview-tickets/:ticket/content') @Public() @SkipEnvelope()
  async previewContent(@Param('ticket') ticket: string, @Req() req: Request, @Res() res: Response) {
    const content = await this.delivery.openPreview(ticket, req.headers.range);
    sendMediaContent(res, content);
  }
}
