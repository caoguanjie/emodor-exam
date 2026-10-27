import { describe, expect, it } from 'vitest';
import { hasAccountPermission } from '../account-permissions';

describe('account permission UI compatibility', () => {
  it('retains the buttons visible to a pre-upgrade administrator session', () => {
    const user = { role: 'employee', permissions: ['administrators:write', 'roles:write', 'system_settings:write', 'system_settings:read'] };
    for (const code of ['administrators:create', 'administrators:reset_password', 'roles:permissions', 'menus:create', 'menus:read']) {
      expect(hasAccountPermission(user, code)).toBe(true);
    }
    expect(hasAccountPermission(user, 'administrators:assign_roles')).toBe(false);
    expect(hasAccountPermission(user, 'students:write')).toBe(false);
  });
  it('does not give an upgraded system-settings editor any menu permissions', () => {
    const user = { role: 'employee', permission_schema_version: 2, permissions: ['system_settings:write', 'system_settings:read'] };
    expect(hasAccountPermission(user, 'system_settings:write')).toBe(true);
    for (const code of ['menus:read', 'menus:create', 'menus:update', 'menus:delete']) expect(hasAccountPermission(user, code)).toBe(false);
  });
  it('never expands a granular grant into other buttons', () => {
    const user = { role: 'employee', permission_schema_version: 2, permissions: ['administrators:create', 'menus:update'] };
    expect(hasAccountPermission(user, 'administrators:create')).toBe(true);
    expect(hasAccountPermission(user, 'administrators:delete')).toBe(false);
    expect(hasAccountPermission(user, 'menus:create')).toBe(false);
    expect(hasAccountPermission(user, 'menus:update')).toBe(true);
  });
  it('retains super administrator authority and rejects missing users', () => {
    expect(hasAccountPermission({ role: 'super_admin' }, 'menus:delete')).toBe(true);
    expect(hasAccountPermission(null, 'menus:delete')).toBe(false);
  });
});
