import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { applyMigrations, getMigrationChecksum } from '../../database/migrate.mjs';
import { isSafeTestDatabase } from './test-target.mjs';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const mysql = require('mysql2/promise');
const MIGRATION_ID = '036_role_menu_button_permissions';
const REMOVAL_MIGRATION_ID = '038_remove_administrator_role_assignment';
const STEPS = [
  'register_button_permissions', 'copy_legacy_management_grants', 'remove_aggregate_role_grants',
  'bind_menu_read_permission', 'seed_management_buttons',
];
const BUTTONS = [
  ['/admin/administrators', 'administrators:create'],
  ['/admin/administrators', 'administrators:update'],
  ['/admin/administrators', 'administrators:delete'],
  ['/admin/administrators', 'administrators:reset_password'],
  ['/admin/roles', 'roles:create'], ['/admin/roles', 'roles:update'],
  ['/admin/roles', 'roles:delete'], ['/admin/roles', 'roles:permissions'],
  ['/admin/system/menus', 'menus:create'], ['/admin/system/menus', 'menus:update'],
  ['/admin/system/menus', 'menus:delete'],
];
const FINE_CODES = [...BUTTONS.map(([, code]) => code), 'menus:read'];
const OLD_CODES = ['administrators:write', 'roles:write', 'system_settings:read', 'system_settings:write', 'statistics:read'];

function progressOf(row) {
  const progress = typeof row?.progress === 'string' ? JSON.parse(row.progress) : row?.progress;
  assert.ok(progress === null || progress === undefined || Array.isArray(progress), 'migration progress must be an array');
  return progress || [];
}

/** Establish the first verified 036 checkpoint before API fixtures adopt v2 semantics. */
export async function verifyLegacyRoleMenuUpgrade(ctx) {
  const database = ctx?.env?.DB_DATABASE;
  assert.ok(isSafeTestDatabase(database), 'legacy role upgrade requires the harness-owned ruleexam_test_<suffix> database');
  assert.ok(typeof ctx.env.DB_HOST === 'string' && ctx.env.DB_HOST.length > 0, 'test ctx must explicitly provide its owned database host');
  const port = Number(ctx.env.DB_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'test ctx must explicitly provide its owned database port');
  assert.ok(typeof ctx.env.DB_USERNAME === 'string' && ctx.env.DB_USERNAME.length > 0, 'test ctx must explicitly provide its owned database user');
  assert.ok(typeof ctx.env.DB_PASSWORD === 'string' && ctx.env.DB_PASSWORD.length > 0, 'test ctx must inject its temporary database credential');
  // Keep the migration advisory lock on one connection. No filesystem/global
  // environment fallback is allowed; all parameters come from this test ctx.
  const connection = await mysql.createConnection({
    host: ctx.env.DB_HOST, port, user: ctx.env.DB_USERNAME,
    password: ctx.env.DB_PASSWORD, database, timezone: 'Z', multipleStatements: false,
  });
  let roleId = null;
  const tag = randomBytes(6).toString('hex');
  const roleCode = `legacy_upgrade_${tag}`;
  try {
    const [[actual]] = await connection.query('SELECT DATABASE() AS database_name');
    assert.equal(actual.database_name, database, 'migration connection must match the owned test database');
    const [registry] = await connection.execute('SELECT status,progress FROM schema_migration WHERE migration_id=?', [MIGRATION_ID]);
    assert.ok(!registry[0] || registry[0].status !== 'applied', 'legacy upgrade fixture must run before the first 036 application');
    assert.ok(!progressOf(registry[0]).includes('copy_legacy_management_grants'), 'legacy upgrade fixture cannot run after its verified copy checkpoint');

    const [generationsBefore] = await connection.execute('SELECT id,auth_version FROM sys_user ORDER BY id');
    const [permissions] = await connection.execute('SELECT code FROM sys_permission WHERE code IN (?,?,?,?,?)', OLD_CODES);
    assert.deepEqual(permissions.map((row) => row.code).sort(), [...OLD_CODES].sort(), 'runtime seed must register legacy inputs before the upgrade fixture');

    const now = new Date();
    const [created] = await connection.execute(
      'INSERT INTO sys_role (code,name,remark,is_system,status,created_at,updated_at) VALUES (?,?,?,0,1,?,?)',
      [roleCode, `旧授权升级_${tag}`, '仅自有隔离库的迁移夹具，不关联账号', now, now],
    );
    roleId = String(created.insertId);
    // Raw links intentionally bypass createRole's legacy input expansion.
    const [inserted] = await connection.execute(
      'INSERT INTO sys_role_permission (role_id,permission_id) SELECT ?,id FROM sys_permission WHERE code IN (?,?,?,?,?)',
      [roleId, ...OLD_CODES],
    );
    assert.equal(inserted.affectedRows, 5, 'legacy fixture must contain four old management grants and one unrelated grant');
    const [[references]] = await connection.execute('SELECT COUNT(*) AS count FROM sys_user_role WHERE role_id=?', [roleId]);
    assert.equal(Number(references.count), 0, 'upgrade fixture role must not be assigned to an account');

    // Confirm current template rows before simulating the former menu binding
    // and one missing default button. No fixed menu IDs are assumed.
    const routes = ['/admin/administrators', '/admin/roles', '/admin/system/menus'];
    const [menus] = await connection.execute(
      'SELECT id,route_path,permission_code FROM sys_menu WHERE type=? AND route_path IN (?,?,?)',
      ['menu', ...routes],
    );
    assert.equal(menus.length, 3, 'migration fixture requires the three current management menus');
    const byRoute = new Map(menus.map((menu) => [menu.route_path, String(menu.id)]));
    assert.equal(byRoute.size, 3, 'management menu routes must be unambiguous');
    const menuId = byRoute.get('/admin/system/menus');
    const [existingButtons] = await connection.execute(
      "SELECT id FROM sys_menu WHERE parent_id=? AND type='button' AND permission_code='menus:create' AND name='新增菜单' AND route_path IS NULL",
      [menuId],
    );
    assert.ok(existingButtons.length <= 1, 'default menu-create button must be unambiguous');
    if (existingButtons[0]) {
      const [[children]] = await connection.execute('SELECT COUNT(*) AS count FROM sys_menu WHERE parent_id=?', [String(existingButtons[0].id)]);
      assert.equal(Number(children.count), 0, 'only a leaf default button can be removed by this fixture');
      await connection.execute('DELETE FROM sys_menu WHERE id=?', [String(existingButtons[0].id)]);
    }
    await connection.execute("UPDATE sys_menu SET permission_code='system_settings:read' WHERE id=? AND type='menu'", [menuId]);

    const result = await applyMigrations({ connection, database });
    assert.ok(result.applied.includes(MIGRATION_ID), 'fixture must exercise the first 036 application');
    assert.ok(result.applied.includes(REMOVAL_MIGRATION_ID), 'fixture must apply the account-promotion cleanup after 036');
    const [grants] = await connection.execute(
      'SELECT code FROM sys_permission WHERE id IN (SELECT permission_id FROM sys_role_permission WHERE role_id=?) ORDER BY code',
      [roleId],
    );
    const expected = [...FINE_CODES, 'system_settings:read', 'system_settings:write', 'statistics:read'].sort();
    assert.deepEqual(grants.map((row) => row.code), expected, '036+038 must retain current independent grants and remove retired account promotion');
    const [[aggregateLinks]] = await connection.execute(
      "SELECT COUNT(*) AS count FROM sys_role_permission WHERE permission_id IN (SELECT id FROM sys_permission WHERE code IN ('administrators:write','roles:write'))",
    );
    assert.equal(Number(aggregateLinks.count), 0, 'no role may retain deprecated administrator or role aggregate links');
    const [[orphanedLinks]] = await connection.execute(
      'SELECT COUNT(*) AS count FROM sys_role_permission LEFT JOIN sys_permission ON sys_permission.id=sys_role_permission.permission_id WHERE sys_permission.id IS NULL',
    );
    assert.equal(Number(orphanedLinks.count), 0, 'permission migration must not leave dangling role-permission links');
    const [legacyDictionary] = await connection.execute("SELECT code FROM sys_permission WHERE code IN ('administrators:write','roles:write') ORDER BY code");
    assert.deepEqual(legacyDictionary.map((row) => row.code), ['administrators:write', 'roles:write'], 'legacy input dictionary entries must remain registered');
    const [[retiredPermission]] = await connection.execute("SELECT COUNT(*) AS count FROM sys_permission WHERE code='administrators:assign_roles'");
    assert.equal(Number(retiredPermission.count), 0, '038 must remove the retired account-promotion permission');
    const [[menuAfter]] = await connection.execute('SELECT permission_code FROM sys_menu WHERE id=?', [menuId]);
    assert.equal(menuAfter.permission_code, 'menus:read', '036 must migrate the menu-management read binding');
    const [buttonsAfter] = await connection.execute("SELECT parent_id,permission_code FROM sys_menu WHERE type='button' AND parent_id IN (?,?,?)", [...byRoute.values()]);
    for (const [route, permission] of BUTTONS) {
      assert.ok(buttonsAfter.some((button) => String(button.parent_id) === byRoute.get(route) && button.permission_code === permission), `036 must seed independent button ${permission}`);
    }
    const [[applied]] = await connection.execute('SELECT status,checksum,progress FROM schema_migration WHERE migration_id=?', [MIGRATION_ID]);
    assert.equal(applied.status, 'applied');
    assert.equal(applied.checksum, getMigrationChecksum(MIGRATION_ID));
    assert.deepEqual([...progressOf(applied)].sort(), [...STEPS].sort(), '036 must retain all verified checkpoints even for initially satisfied probes');
    const [generationsAfter] = await connection.execute('SELECT id,auth_version FROM sys_user ORDER BY id');
    assert.deepEqual(generationsAfter, generationsBefore, 'equivalent permission conversion must not revoke user generations');
    return { converted_permissions: FINE_CODES.length, verified_steps: STEPS.length };
  } finally {
    try {
      if (roleId) {
        await connection.execute('DELETE FROM sys_role_permission WHERE role_id=?', [roleId]);
        await connection.execute('DELETE FROM sys_role WHERE id=? AND code=?', [roleId, roleCode]);
      }
    } finally {
      await connection.end();
    }
  }
}
