import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../../common/guards/public.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';
import { MobileAuthService } from './mobile-auth.service';
import { MobilePhoneDto } from './mobile-auth.dto';

@Controller('mobile/auth')
export class DebugMobileAuthController {
  constructor(private readonly auth: MobileAuthService) {}

  @Public() @Post('debug-login') @HttpCode(200)
  login(@Body(new DtoValidationPipe()) dto: MobilePhoneDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.debugLogin(dto.phone, req.ip || null, req.get('user-agent') || null, res);
  }
}
