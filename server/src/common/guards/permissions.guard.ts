import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from '../../modules/access/access.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from './roles.guard';
import { PermissionCode } from '../../modules/access/permission-catalog';
import { Errors } from '../errors';

function requestPath(req: any): string {
  return String(req.originalUrl || req.url || '').split('?')[0].replace(/^\/api\/v1/, '') || '/';
}

/** 旧管理接口的集中映射，避免只隐藏按钮而遗漏服务端权限校验。 */
export function legacyPermissionForRequest(req: any): PermissionCode | undefined {
  const path = requestPath(req);
  const method = String(req.method || 'GET').toUpperCase();
  if (path === '/users' || path.startsWith('/users/')) {
    if (path === '/users/import-template') return 'students:write';
    return method === 'GET' ? 'students:read' : 'students:write';
  }
  if (path === '/departments' || path.startsWith('/departments/')) return method === 'GET' ? 'departments:read' : 'departments:write';

  if (path === '/regulations' || path.startsWith('/regulations/')) {
    if (path.includes('/content')) return undefined; // 员工内容阅读接口仍由发布范围收口
    if (path.endsWith('/publish')) return 'regulations:publish';
    return method === 'GET' ? 'regulations:read' : 'regulations:write';
  }

  if (path === '/ai' || path.startsWith('/ai/')) {
    if (path === '/ai/config' && method === 'GET') return 'ai_config:read';
    if (path.startsWith('/ai/config')) return 'ai_config:write';
    if (path.includes('/review')) return 'questions:review';
    if (path.includes('/regenerate') || path === '/ai/questions' && method !== 'GET') return 'questions:write';
    if (path.startsWith('/ai/questions')) return method === 'GET' ? 'questions:read' : 'questions:write';
    if (path.endsWith('/publish')) return 'papers:publish';
    if (path.startsWith('/ai/papers')) return method === 'GET' ? 'papers:read' : 'papers:write';
    return method === 'GET' ? 'ai:read' : 'ai:write';
  }

  if (path === '/statistics' || path.startsWith('/statistics/')) {
    // 个人统计接口保留旧的数据范围守卫：员工可查本人、查他人由
    // StatisticsController 返回 40302；管理员仍须具备 statistics:read。
    if (path.startsWith('/statistics/users/')) {
      return req.user?.role === 'employee' ? undefined : 'statistics:read';
    }
    return path === '/statistics/export' || path.endsWith('/export') ? 'statistics:export' : 'statistics:read';
  }
  return undefined;
}

export const PERMISSION_AUTHORIZED_KEY = 'permission_authorized';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly access: AccessService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<any>();
    const declared = this.reflector.getAllAndOverride<PermissionCode[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    const mapped = legacyPermissionForRequest(req);
    const required = declared?.length ? declared : mapped ? [mapped] : [];
    const legacyRoles = this.reflector.getAllAndOverride<unknown[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    // 带旧 @Roles 的管理接口必须在白名单中显式映射或声明权限，拒绝静默放行。
    if (!required.length && legacyRoles?.length) throw Errors.forbidden();
    if (!required.length) return true;
    const user = req.user as { id: number } | undefined;
    if (!user) throw Errors.unauthenticated();
    for (const code of required) await this.access.assertAllowed(String(user.id), code);
    // RolesGuard runs after this guard. Mark only successfully mapped/declared
    // fine-permission routes so custom business admins can use legacy AI,
    // regulation and statistics APIs without opening system identity APIs.
    (req as any)[PERMISSION_AUTHORIZED_KEY] = true;
    return true;
  }
}
