export interface RolePermissionMenu {
  id: string | number;
  parent_id: string | number | null;
  name: string;
  type: 'directory' | 'menu' | 'button';
  permission_code: string | null;
  sort: number;
  status: number;
}

export interface RolePermissionTreeResponse {
  menus: RolePermissionMenu[];
  permissions: { code: string; name: string }[];
}

export interface RolePermissionNode {
  id: string;
  label: string;
  permissionCode?: string;
  status?: number;
  disabled?: boolean;
  children?: RolePermissionNode[];
}

/** Menu containers organize grants; only registered permission leaves are selectable grants. */
export function buildRolePermissionTree(response: RolePermissionTreeResponse): RolePermissionNode[] {
  const registry = new Map(response.permissions.map((permission) => [permission.code, permission.name]));
  const menus = [...response.menus].sort((left, right) => left.sort - right.sort || String(left.id).localeCompare(String(right.id), 'en', { numeric: true }));
  const menuById = new Map(menus.map((menu) => [String(menu.id), menu]));
  const nodeByMenuId = new Map<string, RolePermissionNode>();
  const modules = new Map<string, RolePermissionNode>();
  const represented = new Set<string>();
  const roots: RolePermissionNode[] = [];

  for (const menu of menus) {
    const code = menu.permission_code || '';
    const registered = registry.has(code);
    if (menu.type === 'button' && !registered) continue;
    const node: RolePermissionNode = { id: `menu:${menu.id}`, label: menu.name, status: menu.status };
    if (menu.type === 'button') {
      node.permissionCode = code;
      represented.add(code);
    } else {
      node.children = [];
      if (menu.type === 'menu' && registered) {
        // A menu's read grant must not cascade into all its action grants on initial selection.
        node.children.push({ id: `menu-permission:${menu.id}`, label: registry.get(code)!, permissionCode: code, status: menu.status });
        represented.add(code);
        if (!modules.has(code.split(':')[0]!)) modules.set(code.split(':')[0]!, node);
      }
    }
    nodeByMenuId.set(String(menu.id), node);
  }

  for (const menu of menus) {
    const node = nodeByMenuId.get(String(menu.id));
    if (!node) continue;
    const parent = menu.parent_id === null ? undefined : nodeByMenuId.get(String(menu.parent_id));
    if (parent?.children && parent !== node) parent.children.push(node);
    else roots.push(node);

    const code = node.permissionCode;
    if (!code || modules.has(code.split(':')[0]!)) continue;
    const seen = new Set<string>();
    let ancestor = menu.parent_id === null ? undefined : menuById.get(String(menu.parent_id));
    while (ancestor && !seen.has(String(ancestor.id))) {
      seen.add(String(ancestor.id));
      if (ancestor.type === 'menu') {
        modules.set(code.split(':')[0]!, nodeByMenuId.get(String(ancestor.id))!);
        break;
      }
      ancestor = ancestor.parent_id === null ? undefined : menuById.get(String(ancestor.parent_id));
    }
  }

  const others: RolePermissionNode = { id: 'other-permissions', label: '其它权限', children: [] };
  for (const [code, name] of registry) {
    if (represented.has(code)) continue;
    const parent = modules.get(code.split(':')[0]!) || others;
    parent.children!.push({ id: `registered:${code}`, label: name, permissionCode: code });
  }
  if (others.children!.length) roots.push(others);

  const markEmpty = (node: RolePermissionNode): void => {
    node.children?.forEach(markEmpty);
    node.disabled = !node.permissionCode && !node.children?.some((child) => !child.disabled);
  };
  roots.forEach(markEmpty);
  return roots;
}

function visit(nodes: RolePermissionNode[], callback: (node: RolePermissionNode) => void): void {
  for (const node of nodes) {
    callback(node);
    if (node.children) visit(node.children, callback);
  }
}

export function getRolePermissionCheckedKeys(nodes: RolePermissionNode[], permissions: string[]): string[] {
  const selected = new Set(permissions);
  const keys: string[] = [];
  visit(nodes, (node) => { if (node.permissionCode && selected.has(node.permissionCode)) keys.push(node.id); });
  return keys;
}

/** Apply the clicked subtree to codes, then reflect those codes at every duplicate menu leaf. */
export function updateRolePermissionSelection(nodes: RolePermissionNode[], permissions: string[], nodeId: string, checked: boolean): string[] {
  const selected = new Set(permissions);
  let target: RolePermissionNode | undefined;
  visit(nodes, (node) => { if (node.id === nodeId) target = node; });
  if (target) visit([target], (node) => {
    if (!node.permissionCode) return;
    if (checked) selected.add(node.permissionCode);
    else selected.delete(node.permissionCode);
  });
  return [...selected].sort();
}
