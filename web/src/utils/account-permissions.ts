interface PermissionAccount {
  role?: string;
  permissions?: string[];
  permission_schema_version?: number;
}

// Only a saved, pre-upgrade browser profile needs these UI aliases. The API
// still checks current database grants for every request. Version 2 profiles
// must keep system configuration and menu editing independent.
const LEGACY_BUTTONS: Record<string, readonly string[]> = {
  'administrators:write': ['administrators:create', 'administrators:update', 'administrators:delete', 'administrators:reset_password'],
  'roles:write': ['roles:create', 'roles:update', 'roles:delete', 'roles:permissions'],
  'system_settings:read': ['menus:read'],
  'system_settings:write': ['menus:create', 'menus:update', 'menus:delete'],
};

export function hasAccountPermission(user: PermissionAccount | null | undefined, code: string): boolean {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const permissions = user.permissions || [];
  if (permissions.includes(code)) return true;
  if (Number(user.permission_schema_version || 0) >= 2) return false;
  return permissions.some((permission) => LEGACY_BUTTONS[permission]?.includes(code));
}
