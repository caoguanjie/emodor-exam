import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { IsString, Matches, MaxLength } from 'class-validator';
import { Request, Response } from 'express';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/guards/public.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { SkipEnvelope } from '../../common/response.interceptor';
import { MediaTicketService } from './media-ticket.service';
import { Errors } from '../../common/errors';
class MediaTicketDto {
  @IsString() @MaxLength(64) owner_type!: string;
  @IsString() @Matches(/^[1-9]\d{0,19}$/) owner_id!: string;
}
@Controller('media')
export class MediaTicketController {
  constructor(private readonly tickets: MediaTicketService) {}
  @Post(':assetId/tickets') @HttpCode(200)
  issue(@Param('assetId') assetId: string, @Body(new StrictDtoValidationPipe(['owner_type', 'owner_id'])) dto: MediaTicketDto, @CurrentUser() user: AuthUser) {
    if (user.client !== 'mobile') throw Errors.forbidden();
    return this.tickets.issue(String(user.id), assetId, dto.owner_type, dto.owner_id);
  }
  @Public() @Get('tickets/:ticket/content') @SkipEnvelope()
  async content(@Param('ticket') ticket: string, @Req() req: Request, @Res() res: Response) {
    const descriptor = await this.tickets.open(ticket, req.headers.range);
    const start = descriptor.range?.start || 0; const end = descriptor.range?.end ?? descriptor.size - 1;
    res.status(descriptor.range ? 206 : 200);
    res.setHeader('Content-Type', descriptor.asset.mimeType);
    res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Length', String(end - start + 1));
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (descriptor.range) res.setHeader('Content-Range', `bytes ${start}-${end}/${descriptor.size}`);
    res.sendFile(descriptor.path, { acceptRanges: true }, (error) => { if (error && !res.headersSent) res.status(404).end(); });
  }
}
