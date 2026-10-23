import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../../common/guards/public.decorator';
import { MOBILE_REFRESH_COOKIE } from '../../common/guards/jwt-auth.guard';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';
import { MobileAuthService } from './mobile-auth.service';
import { MobilePhoneDto, MobileSmsLoginDto } from './mobile-auth.dto';

@Controller('mobile/auth')
export class MobileAuthController {
  constructor(private readonly auth: MobileAuthService) {}

  @Public() @Post('sms/send') @HttpCode(200)
  send(@Body(new DtoValidationPipe()) dto: MobilePhoneDto, @Req() req: Request) {
    return this.auth.send(dto.phone, req.ip || 'unknown');
  }

  @Public() @Post('sms/login') @HttpCode(200)
  login(@Body(new DtoValidationPipe()) dto: MobileSmsLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto.phone, dto.challenge_id, dto.code, req.ip || null, req.get('user-agent') || null, res);
  }

  @Public() @Post('refresh') @HttpCode(200)
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.refresh(req.cookies?.[MOBILE_REFRESH_COOKIE], req.ip || null, res);
  }

  @Public() @Post('logout') @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(req.cookies?.[MOBILE_REFRESH_COOKIE], req.ip || null, res);
  }
}
