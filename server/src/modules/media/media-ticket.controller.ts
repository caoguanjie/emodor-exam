import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { IsString, Matches, MaxLength } from 'class-validator';
import { Request, Response } from 'express';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/guards/public.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { SkipEnvelope } from '../../common/response.interceptor';
import { MediaTicketService } from './media-ticket.service';
import { sendMediaContent } from './media-content.response';
import { Errors } from '../../common/errors';
import { assertMediaBodyKeys } from './delivery/media-delivery.dto';
class MediaTicketDto {
  @IsString() @MaxLength(64) owner_type!: string;
  @IsString() @Matches(/^[1-9]\d{0,19}$/) owner_id!: string;
}
@Controller('media')
export class MediaTicketController {
  constructor(@Inject(MediaTicketService) private readonly tickets: MediaTicketService) {}
  @Post(':assetId/tickets') @HttpCode(200)
  issue(@Param('assetId') assetId: string, @Body(new StrictDtoValidationPipe(['owner_type', 'owner_id'])) dto: MediaTicketDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertMediaBodyKeys(req.body, ['owner_type', 'owner_id']);
    if (user.client !== 'mobile') throw Errors.forbidden();
    return this.tickets.issue(String(user.id), assetId, dto.owner_type, dto.owner_id);
  }
  @Public() @Get('tickets/:ticket/content') @SkipEnvelope()
  async content(@Param('ticket') ticket: string, @Req() req: Request, @Res() res: Response) {
    const descriptor = await this.tickets.open(ticket, req.headers.range);
    sendMediaContent(res, descriptor);
  }
}
