import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './password-fixture.mjs';
import { applyMigrations } from '../../database/migrate.mjs';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
function assert(value, message) { if (!value) throw new Error(message); }

/** Real HTTP grants and one-shot migration checks in the harness-owned DB. */
export async function verifyRoleMenuManagement(ctx, admin, helpers) {
  const tag = randomBytes(5).toString('hex');
  const { captchaLogin, completeFirstLogin, holdRowLock, waitForLockWaits, closeLock } = helpers;
  async function newRole(name, permissions) {
    const result = await ctx.request(admin.actor, 'POST', '/admin/roles', { name: `${name}_${tag}`, remark: '角色菜单联动隔离回归', ...(permissions ? { permissions } : {}) });
    assert(result.status === 200 && result.data?.id, `role fixture ${name} failed: ${result.status}`);
    return result.data;
  }
  async function newActor(name, permissions) {
    const role = await newRole(name, permissions);
    const username = `${name}_${tag}`;
    const password = randomStrongPassword(username);
    const created = await ctx.request(admin.actor, 'POST', '/admin/administrators', { username, password, role_ids: [role.id] });
    assert(created.status === 200 && created.data?.id, `granular account create failed: ${created.status}`);
    const login = await completeFirstLogin(ctx, await captchaLogin(ctx, username, password), username, password, 'Granular');
    assert(login.result.data.user.permission_schema_version === 2, 'password login did not identify granular permission semantics');
    return { ...login, role, id: created.data.id };
  }
  const reader = ['administrators:read', 'roles:read', 'menus:read'];
  const creator = await newActor('fine_creator', [...reader, 'administrators:create', 'roles:create', 'menus:create']);
  const editor = await newActor('fine_editor', [...reader, 'administrators:update', 'roles:update', 'menus:update']);
  const grantor = await newActor('fine_grantor', ['roles:read', 'roles:permissions']);
  const remover = await newActor('fine_remover', [...reader, 'administrators:delete', 'administrators:reset_password', 'roles:delete', 'menus:delete']);

  const target = await newRole('metadata_target');
  assert(target.code && target.remark === '角色菜单联动隔离回归' && target.created_at, 'role metadata or generated code missing');
  const page = await ctx.request(creator.actor, 'GET', `/admin/roles?page=1&page_size=1&keyword=metadata_target_${tag}`);
  assert(page.status === 200 && page.data.total === 1 && page.data.items[0]?.id === target.id, 'role Page keyword lookup failed');
  const duplicate = await ctx.request(creator.actor, 'POST', '/admin/roles', { name: target.name });
  assert(duplicate.status === 400, 'duplicate role name was accepted');
  const grantThroughCreate = await ctx.request(creator.actor, 'POST', '/admin/roles', { name: `forbidden_grant_${tag}`, permissions: ['menus:delete'] });
  assert(grantThroughCreate.status === 403, 'role creator smuggled permission assignment through create');
  const creatorRole = await ctx.request(creator.actor, 'POST', '/admin/roles', { name: `created_without_grants_${tag}`, remark: '可以先创建后授权' });
  assert(creatorRole.status === 200, 'create-only role operator could not create metadata');
  const grant = await ctx.request(grantor.actor, 'PUT', `/admin/roles/${target.id}/permissions`, { permissions: ['menus:read', 'menus:update'] });
  assert(grant.status === 200, `dedicated role grant failed: ${grant.status}`);
  const edited = await ctx.request(editor.actor, 'PUT', `/admin/roles/${target.id}`, { name: target.name, remark: '只改备注' });
  assert(edited.status === 200 && edited.data.remark === '只改备注' && edited.data.permissions.includes('menus:update'), 'role metadata edit cleared grants');
  for (const [actor, body] of [
    [editor.actor, { permissions: ['roles:permissions'] }],
    [grantor.actor, { name: '越权改名' }],
    [creator.actor, { remark: '越权修改' }],
  ]) {
    const denied = await ctx.request(actor, 'PUT', `/admin/roles/${target.id}`, body);
    assert(denied.status === 403, 'role metadata and grant permissions were interchangeable');
  }
  const tree = await ctx.request(grantor.actor, 'GET', '/admin/roles/permission-tree');
  assert(tree.status === 200 && tree.data.menus.every((row) => !('route_path' in row) && !('icon' in row)), 'role tree leaked menu configuration or was unavailable');
  assert(tree.data.permissions.some((item) => item.code === 'administrators:reset_password')
    && !tree.data.permissions.some((item) => item.code === 'administrators:assign_roles')
    && !tree.data.permissions.some((item) => item.code === 'administrators:write' || item.code === 'roles:write'), 'role tree retained aggregate-only authorization');
  assert((await ctx.request(grantor.actor, 'GET', '/admin/menus')).status === 403, 'role grantor acquired menu management read access');
  const oldMacro = await ctx.request(grantor.actor, 'PUT', `/admin/roles/${target.id}/permissions`, { permissions: ['administrators:write'] });
  assert(oldMacro.status === 400, 'granular permission endpoint accepted an aggregate administrator grant');

  const directoryPayload = { name: `临时权限目录_${tag}`, type: 'directory', parent_id: null, route_path: null, permission_code: null, icon: 'Setting', sort: 9999, status: 1 };
  const directory = await ctx.request(creator.actor, 'POST', '/admin/menus', directoryPayload);
  assert(directory.status === 200 && directory.data?.id, `menu create-only permission failed: ${directory.status}`);
  const menuPath = `/admin/menus/${directory.data.id}`;
  assert((await ctx.request(editor.actor, 'PUT', menuPath, { ...directoryPayload, name: `${directoryPayload.name}_改` })).status === 200, 'menu update-only permission failed');
  assert((await ctx.request(creator.actor, 'PUT', menuPath, directoryPayload)).status === 403, 'menu creator modified a menu');
  assert((await ctx.request(editor.actor, 'POST', '/admin/menus', directoryPayload)).status === 403, 'menu editor created a menu');
  assert((await ctx.request(creator.actor, 'DELETE', menuPath)).status === 403, 'menu creator deleted a menu');
  assert((await ctx.request(remover.actor, 'DELETE', menuPath)).status === 200, 'menu delete-only permission failed');
  assert((await ctx.request(creator.actor, 'GET', '/admin/menus/permission-options')).status === 200, 'menu creator could not read narrow permission options');
  assert((await ctx.request(remover.actor, 'GET', '/admin/menus/permission-options')).status === 403, 'menu deletion permission read editor options');

  const username = `fine_target_${tag}`;
  const managed = await ctx.request(creator.actor, 'POST', '/admin/administrators', { username, password: randomStrongPassword(username), role_ids: [target.id] });
  assert(managed.status === 200 && managed.data?.id, 'administrator create-only permission failed');
  const adminPath = `/admin/administrators/${managed.data.id}`;
  assert((await ctx.request(creator.actor, 'PUT', adminPath, { real_name: '越权', role_ids: [target.id] })).status === 403, 'administrator creator modified an account');
  assert((await ctx.request(editor.actor, 'PUT', adminPath, { real_name: '细项修改', role_ids: [target.id], status: 1 })).status === 200, 'administrator update-only permission failed');
  assert((await ctx.request(editor.actor, 'POST', `${adminPath}/reset-password`, { password: randomStrongPassword(username) })).status === 403, 'administrator editor reset a password');
  assert((await ctx.request(remover.actor, 'POST', `${adminPath}/reset-password`, { password: randomStrongPassword(username) })).status === 200, 'reset-only permission unexpectedly required update permission');
  assert((await ctx.request(creator.actor, 'DELETE', adminPath)).status === 403, 'administrator creator deleted an account');
  assert((await ctx.request(remover.actor, 'DELETE', adminPath)).status === 200, 'administrator delete-only permission failed');
  assert((await ctx.request(editor.actor, 'GET', '/admin/administrators/candidates')).status === 404, 'retired account-promotion candidate API remained reachable');
  assert((await ctx.request(editor.actor, 'PUT', `${adminPath}/roles`, { role_ids: [target.id] })).status === 404, 'retired account-promotion write API remained reachable');
  const referenced = await ctx.request(remover.actor, 'DELETE', `/admin/roles/${target.id}`);
  assert(referenced.status >= 400 && referenced.status < 500, 'role linked to an archived administrator was deleted');
  assert((await ctx.request(remover.actor, 'DELETE', `/admin/roles/${creatorRole.data.id}`)).status === 200, 'unassigned role delete-only permission failed');

  // Preserve new explicit revocation when one-time compatibility migrations run again.
  const compatibilityRole = await newRole('legacy_system_write', ['system_settings:write']);
  assert(compatibilityRole.permissions.includes('menus:create'), 'legacy role input did not retain former menu maintenance');
  const strict = await ctx.request(grantor.actor, 'PUT', `/admin/roles/${compatibilityRole.id}/permissions`, { permissions: ['system_settings:write'] });
  assert(strict.status === 200 && !strict.data.permissions.some((code) => code.startsWith('menus:')), 'granular save implicitly regranted menu maintenance');
  const connection = await mysql.createConnection({ host: ctx.env.DB_HOST, port: Number(ctx.env.DB_PORT), user: ctx.env.DB_USERNAME, password: ctx.env.DB_PASSWORD, database: ctx.env.DB_DATABASE });
  try { await applyMigrations({ connection, database: ctx.env.DB_DATABASE }); } finally { await connection.end(); }
  const afterRepeat = await ctx.request(admin.actor, 'GET', `/admin/roles/${compatibilityRole.id}`);
  assert(afterRepeat.status === 200 && !afterRepeat.data.permissions.some((code) => code.startsWith('menus:')), 'migration replay restored revoked menu grants');

  // A role deletion queued behind an owned row lock must serialize with administrator creation.
  const racing = await newRole('delete_race_role', ['statistics:read']);
  const racingUsername = `role_delete_race_${tag}`;
  let lock = await holdRowLock(ctx, 'SELECT id FROM sys_role WHERE id=? FOR UPDATE', [racing.id]);
  let deletion; let creation;
  try {
    deletion = ctx.request(remover.actor, 'DELETE', `/admin/roles/${racing.id}`);
    await waitForLockWaits(ctx, 1, 'role deletion');
    creation = ctx.request(admin.actor, 'POST', '/admin/administrators', {
      username: racingUsername, password: randomStrongPassword(racingUsername), role_ids: [racing.id],
    });
    await waitForLockWaits(ctx, 2, 'deleted role administrator creation');
    await closeLock(lock); lock = null;
    const [deleted, created] = await Promise.all([deletion, creation]);
    assert(deleted.status === 200 && created.status === 400, `role deletion/creation race failed: ${deleted.status}/${created.status}`);
    const rows = await ctx.queryTestDb('SELECT user_id FROM sys_user_role WHERE role_id=?', [racing.id]);
    assert(rows.length === 0, 'role deletion race left a dangling account link');
  } finally {
    await closeLock(lock);
    await Promise.allSettled([deletion, creation].filter(Boolean));
  }
}
