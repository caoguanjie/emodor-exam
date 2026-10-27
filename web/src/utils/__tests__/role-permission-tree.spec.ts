import { describe, expect, it } from 'vitest';
import {
  buildRolePermissionTree,
  getRolePermissionCheckedKeys,
  updateRolePermissionSelection,
  type RolePermissionNode,
  type RolePermissionTreeResponse,
} from '../role-permission-tree';

const response: RolePermissionTreeResponse = {
  menus: [
    { id: 'system', parent_id: null, name: '系统设置', type: 'directory', permission_code: 'system_settings:write', sort: 10, status: 1 },
    { id: 'roles', parent_id: 'system', name: '角色管理', type: 'menu', permission_code: 'roles:read', sort: 20, status: 1 },
    { id: 'create', parent_id: 'roles', name: '新增', type: 'button', permission_code: 'roles:create', sort: 1, status: 1 },
    { id: 'update', parent_id: 'roles', name: '修改', type: 'button', permission_code: 'roles:update', sort: 2, status: 0 },
    { id: 'roles-copy', parent_id: 'system', name: '另一角色入口', type: 'menu', permission_code: 'roles:read', sort: 30, status: 0 },
    { id: 'legacy-write', parent_id: 'roles', name: '旧聚合维护', type: 'button', permission_code: 'roles:write', sort: 4, status: 1 },
  ],
  permissions: [
    { code: 'roles:read', name: '查看角色' },
    { code: 'roles:create', name: '新增角色' },
    { code: 'roles:update', name: '修改角色' },
    { code: 'roles:delete', name: '删除角色' },
    { code: 'statistics:export', name: '导出统计' },
    { code: 'system_settings:write', name: '维护系统配置' },
  ],
};

function flatten(nodes: RolePermissionNode[]): RolePermissionNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children || [])]);
}

describe('role permission menu tree', () => {
  it('keeps menu hierarchy and inactive nodes while directories never grant a permission', () => {
    const tree = buildRolePermissionTree(response);
    const system = tree.find((node) => node.label === '系统设置')!;
    expect(system.permissionCode).toBeUndefined();
    expect(system.children?.map((node) => node.label)).toEqual(['角色管理', '另一角色入口']);
    expect(system.children?.[1]?.status).toBe(0);
    expect(flatten(tree).find((node) => node.label === '修改')?.status).toBe(0);
    expect(flatten(tree).some((node) => node.label === '旧聚合维护')).toBe(false);
    expect(flatten(tree).filter((node) => node.permissionCode === 'system_settings:write')).toHaveLength(1);
  });

  it('checks every menu occurrence of the same permission with unique node keys', () => {
    const tree = buildRolePermissionTree(response);
    const checked = getRolePermissionCheckedKeys(tree, ['roles:read', 'roles:read']);
    const readNodes = flatten(tree).filter((node) => node.permissionCode === 'roles:read');
    expect(readNodes).toHaveLength(2);
    expect(new Set(flatten(tree).map((node) => node.id)).size).toBe(flatten(tree).length);
    expect(checked).toEqual(readNodes.map((node) => node.id));
    expect(checked).toHaveLength(2);
  });

  it('unchecks a shared permission everywhere without restoring it from another checked copy', () => {
    const tree = buildRolePermissionTree(response);
    const readNodes = flatten(tree).filter((node) => node.permissionCode === 'roles:read');
    const selected = updateRolePermissionSelection(tree, ['roles:read', 'statistics:export'], readNodes[0]!.id, false);
    expect(selected).toEqual(['statistics:export']);
    const checked = getRolePermissionCheckedKeys(tree, selected);
    expect(checked.some((id) => readNodes.some((node) => node.id === id))).toBe(false);
  });

  it('checks a whole module and removes only its subtree when the parent is unchecked', () => {
    const tree = buildRolePermissionTree(response);
    const roleModule = flatten(tree).find((node) => node.label === '角色管理')!;
    const selected = updateRolePermissionSelection(tree, ['statistics:export'], roleModule.id, true);
    expect(selected).toEqual(['roles:create', 'roles:delete', 'roles:read', 'roles:update', 'statistics:export']);
    expect(updateRolePermissionSelection(tree, selected, roleModule.id, false)).toEqual(['statistics:export']);
  });

  it('keeps a menu read permission separate from its action children', () => {
    const tree = buildRolePermissionTree(response);
    const roleModule = flatten(tree).find((node) => node.label === '角色管理')!;
    const create = flatten(tree).find((node) => node.permissionCode === 'roles:create')!;
    expect(roleModule.permissionCode).toBeUndefined();
    expect(updateRolePermissionSelection(tree, ['roles:read'], create.id, true)).toEqual(['roles:create', 'roles:read']);
    expect(getRolePermissionCheckedKeys(tree, ['roles:read'])).not.toContain(roleModule.id);
  });

  it('adds unconfigured registered actions to the matching module and preserves unrelated permissions', () => {
    const tree = buildRolePermissionTree(response);
    const roleModule = flatten(tree).find((node) => node.label === '角色管理')!;
    expect(flatten(roleModule.children || []).find((node) => node.permissionCode === 'roles:delete')?.label).toBe('删除角色');
    const others = tree.find((node) => node.label === '其它权限')!;
    expect(flatten(others.children || []).map((node) => node.permissionCode)).toEqual(['statistics:export', 'system_settings:write']);
    const checked = getRolePermissionCheckedKeys(tree, ['roles:delete', 'statistics:export']);
    expect(checked).toHaveLength(2);
  });

  it('allows clearing every permission without directory keys or stale duplicate grants', () => {
    const tree = buildRolePermissionTree(response);
    expect(getRolePermissionCheckedKeys(tree, [])).toEqual([]);
    expect(updateRolePermissionSelection(tree, ['roles:read'], tree[0]!.id, false)).toEqual([]);
  });
});
