import { Injectable, SetMetadata, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleEnum, Role, Errors } from '../errors';

export const ROLES_KEY = 'roles';
/**
 * 声明式角色守卫装饰器（05 册 2.4.2）。
 * 未声明角色的接口默认「任一已认证用户」。
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);

/** super_admin 天然拥有 regulation_admin 的全部能力（01 册第 3 章权限矩阵） */
export function roleHas(userRole: string, required: Role[]): boolean {
  if (required.length === 0) return true;
  if (required.includes(userRole as Role)) return true;
  if (userRole === RoleEnum.SUPER_ADMIN && required.includes(RoleEnum.REGULATION_ADMIN)) return true;
  return false;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required || required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { role: string } | undefined;
    if (!user || !roleHas(user.role, required)) {
      const finePermissionAuthorized = req.permission_authorized === true;
      if (finePermissionAuthorized) return true;
      // FR-ORG-05：越权访问统一 40301（04 册 5.2）
      throw Errors.forbidden();
    }
    return true;
  }
}
