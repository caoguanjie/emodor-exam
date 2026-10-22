export const QUESTION_ROUTE_PERMISSIONS = ['questions:read', 'questions:write'] as const;
export const COURSE_ROUTE_PERMISSIONS = ['courses:read', 'courses:write'] as const;
export const LEARNER_HOME_PATH = '/my/regulations';
export const ADMIN_HOME_PATH = '/admin/dashboard';

const RETIRED_ADMIN_PATHS = [
  '/admin/departments',
  '/admin/users',
  '/admin/regulations',
  '/admin/exam-monitor',
  '/admin/grading',
  '/admin/statistics',
] as const;

export function isRetiredAdminPath(value: string): boolean {
  const path = String(value || '').split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  return RETIRED_ADMIN_PATHS.some((retired) => path === retired || path.startsWith(retired + '/'));
}

export function defaultHomePath(isAdmin: boolean): string {
  return isAdmin ? ADMIN_HOME_PATH : LEARNER_HOME_PATH;
}

/** Only same-origin application paths may survive the login/password flow. */
export function validPostAuthRedirect(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\/(?!\/)[^\\\s]*$/.test(value)) return null;
  const path = value.split(/[?#]/, 1)[0];
  return path === '/login' || path === '/change-password' ? null : value;
}

export function postAuthPath(isAdmin: boolean, redirect: unknown): string {
  return validPostAuthRedirect(redirect) || defaultHomePath(isAdmin);
}

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
