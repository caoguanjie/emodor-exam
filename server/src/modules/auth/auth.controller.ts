import { Body, Controller, Get, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { Public } from '../../common/guards/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';
import { REFRESH_COOKIE } from '../../common/guards/jwt-auth.guard';

class LoginDto {
  @IsString() @MinLength(1) @MaxLength(64) username!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
  @IsOptional() @IsString() @MaxLength(64) captcha_id?: string;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(16) captcha_code?: string;
}

class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(128) old_password!: string;
  @IsString() @MinLength(8) @MaxLength(128) new_password!: string;
}

/** /auth 认证模块（04 册 3.1）：登录、刷新、个人信息、改密、登出 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly captcha: CaptchaService) {}

  @Public()
  @HttpCode(200)
  @Post('captcha')
  async captchaImage(@Req() req: Request) {
    return this.captcha.issue(req.ip || 'unknown');
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  async login(@Body(new DtoValidationPipe()) dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto.username, dto.password, req.ip || null, req, res, dto.captcha_id, dto.captcha_code);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // refresh token 经 HttpOnly Cookie 读取，不走 body（04 册 3.1）
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    return this.auth.refresh(token, req.ip || null, res);
  }

  @Get('profile')
  async profile(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user.id);
  }

  @HttpCode(200)
  @Put('password')
  async changePassword(
    @Body(new DtoValidationPipe()) dto: ChangePasswordDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.changePassword(user.id, dto.old_password, dto.new_password, req.ip || null, res, user, req.cookies?.[REFRESH_COOKIE], req);
  }

  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // 传入 refresh Cookie：登出时一并吊销，防止已持有 Cookie 的会话继续轮换
    return this.auth.logout(user, req.ip || null, res, req.cookies?.[REFRESH_COOKIE]);
  }
}
