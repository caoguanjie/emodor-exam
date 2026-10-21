export const QUESTION_ROUTE_PERMISSIONS = ['questions:read', 'questions:write'] as const;
export const COURSE_ROUTE_PERMISSIONS = ['courses:read', 'courses:write'] as const;

export interface RouteAccessMeta {
  superAdminOnly?: unknown;
  permission?: unknown;
  permissionAny?: unknown;
}

/** Shared by the router guard and dynamic navigation; permissionAny is OR. */
export function routeAccessAllowed(
  meta: RouteAccessMeta,
  can: (permission: string) => boolean,
  isSuperAdmin: boolean,
): boolean {
  if (meta.superAdminOnly && !isSuperAdmin) return false;
  if (meta.permission && !can(String(meta.permission))) return false;
  if (Array.isArray(meta.permissionAny) && !meta.permissionAny.some((permission) => can(String(permission)))) return false;
  return true;
}
