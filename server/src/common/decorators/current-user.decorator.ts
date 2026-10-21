import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: number;
  username: string;
  realName?: string;
  role: string;
  jti: string;
  iat: number;
  pwdPending?: boolean;
}

/** 取当前认证用户（JwtAuthGuard 注入 req.user，05 册 2.4.2） */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
