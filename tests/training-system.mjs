import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { proveMenuStructureSerialization } from './support/system-menu-concurrency-checks.mjs';
import { randomStrongPassword } from './training-access.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const Redis = require('ioredis');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function captchaAnswer(ctx, captchaId) {
  const redis = new Redis({
    host: ctx.env.REDIS_HOST || '127.0.0.1',
    port: Number(ctx.env.REDIS_PORT || 6379),
    password: ctx.env.REDIS_PASSWORD || undefined,
  });
  try { return await redis.get(`${ctx.env.REDIS_KEY_PREFIX || ''}auth:captcha:${captchaId}`); }
  finally { await redis.quit(); }
}

async function loginUser(ctx, username, password, label, ...personalValues) {
  const sequence = (loginUser.sequence = (loginUser.sequence || 250) + 1);
  const headers = { 'X-Forwarded-For': `198.51.100.${sequence}` };
  const issued = await ctx.request(null, 'POST', '/auth/captcha', undefined, headers);
  assert(issued.status === 200 && issued.data?.captcha_id, `${label} captcha failed`);
  const answer = await captchaAnswer(ctx, issued.data.captcha_id);
  const actor = {};
  const login = await ctx.request(actor, 'POST', '/auth/login', {
    username, password,
    captcha_id: issued.data.captcha_id, captcha_code: answer,
  }, headers);
  assert(login.status === 200, `${label} login failed: ${login.status}`);
  actor.accessToken = login.data.access_token;
  if (!login.data.force_change_password) return actor;
  const nextPassword = randomStrongPassword(username, ...personalValues);
  const changed = await ctx.request(actor, 'PUT', '/auth/password', {
    old_password: password, new_password: nextPassword,
  });
  assert(
    changed.status === 200 && changed.data?.access_token,
    `${label} initial password change failed: ${changed.status}/${changed.code}/${changed.message}`,
  );
  actor.accessToken = changed.data.access_token;
  return actor;
}

async function loginAdmin(ctx) {
  return loginUser(ctx, 'admin', ctx.adminPassword, 'A5 admin', '超级管理员');
}

function pngFixture() {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
}

function brandingMultipart(bytes, filename = 'brand.png') {
  const boundary = `----ruleexam-system-${randomBytes(12).toString('hex')}`;
  return {
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbranding\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function uploadBranding(ctx, actor, filename) {
  const multipart = brandingMultipart(pngFixture(), filename);
  const response = await ctx.request(actor, 'POST', '/media/upload', multipart.body, multipart.headers);
  assert(response.status === 200 && response.data?.asset_id, `branding upload failed: ${response.status}`);
  return String(response.data.asset_id);
}

export async function run(ctx) {
  const initialPublic = await ctx.request(null, 'GET', '/site-config');
  assert(initialPublic.status === 200, `public site config failed: ${initialPublic.status}`);
  assert(JSON.stringify(Object.keys(initialPublic.data).sort()) === JSON.stringify(['banners', 'logo_asset_id']), 'public site config leaked keys');

  const concurrencyEvidence = await proveMenuStructureSerialization(ctx);
  console.log(`[training-system] menu serialization ${JSON.stringify(concurrencyEvidence)}`);

  const admin = await loginAdmin(ctx);
  const writerRole = await ctx.request(admin, 'POST', '/admin/roles', {
    code: `a5_menu_writer_${randomBytes(4).toString('hex')}`,
    name: 'A5 菜单维护员',
    permissions: ['system_settings:write'],
  });
  assert(writerRole.status === 200 && writerRole.data?.id, `menu writer role create failed: ${writerRole.status}`);
  const writerUsername = `a5_menu_writer_${randomBytes(4).toString('hex')}`;
  const writerRealName = 'A5 菜单维护员';
  const writerPassword = randomStrongPassword(writerUsername, writerRealName);
  const writerUser = await ctx.request(admin, 'POST', '/admin/administrators', {
    username: writerUsername,
    password: writerPassword,
    real_name: writerRealName,
    role_ids: [String(writerRole.data.id)],
  });
  assert(writerUser.status === 200 && writerUser.data?.id, `menu writer user create failed: ${writerUser.status}`);
  const writerAssigned = await ctx.request(admin, 'PUT', `/admin/administrators/${writerUser.data.id}/roles`, {
    role_ids: [String(writerRole.data.id)],
  });
  assert(writerAssigned.status === 200, `menu writer role assignment failed: ${writerAssigned.status}`);
  const writer = await loginUser(ctx, writerUsername, writerPassword, 'A5 menu writer', writerRealName);
  const rolesCatalogDenied = await ctx.request(writer, 'GET', '/admin/permissions');
  assert(rolesCatalogDenied.status === 403, `menu writer unexpectedly received roles catalog: ${rolesCatalogDenied.status}`);
  const permissionOptions = await ctx.request(writer, 'GET', '/admin/menus/permission-options');
  assert(permissionOptions.status === 200 && Array.isArray(permissionOptions.data), `menu permission options failed: ${permissionOptions.status}`);
  assert(permissionOptions.data.length > 0 && permissionOptions.data.every((item) => (
    Object.keys(item).sort().join(',') === 'code,name'
    && typeof item.code === 'string'
    && typeof item.name === 'string'
  )), 'menu permission options shape is not {code,name}[]');
  assert(permissionOptions.data.some((item) => item.code === 'system_settings:write'), 'menu permission options omitted registered system_settings:write');
  const writerMenu = await ctx.request(writer, 'POST', '/admin/menus', {
    name: 'A5 写权限菜单', type: 'menu', parent_id: null,
    route_path: '/admin/system/menus', permission_code: 'system_settings:write', icon: 'Menu', sort: 890, status: 1,
  });
  assert(writerMenu.status === 200 && writerMenu.data?.id, `write-only menu create failed: ${writerMenu.status}`);
  const writerButton = await ctx.request(writer, 'POST', '/admin/menus', {
    name: 'A5 写权限按钮', type: 'button', parent_id: String(writerMenu.data.id),
    route_path: null, permission_code: 'system_settings:write', icon: null, sort: 1, status: 1,
  });
  assert(writerButton.status === 200 && writerButton.data?.id, `write-only menu button create failed: ${writerButton.status}`);

  const directory = await ctx.request(admin, 'POST', '/admin/menus', {
    name: 'A5 测试目录', type: 'directory', parent_id: null,
    route_path: null, permission_code: null, icon: 'Setting', sort: 900, status: 1,
  });
  assert(directory.status === 200 && directory.data?.id, `menu directory create failed: ${directory.status}`);
  const menu = await ctx.request(admin, 'POST', '/admin/menus', {
    name: '菜单配置', type: 'menu', parent_id: String(directory.data.id),
    route_path: '/admin/system/menus', permission_code: 'system_settings:read', icon: 'Menu', sort: 1, status: 1,
  });
  assert(menu.status === 200 && menu.data?.id, `menu create failed: ${menu.status}`);
  const button = await ctx.request(admin, 'POST', '/admin/menus', {
    name: '保存菜单', type: 'button', parent_id: String(menu.data.id),
    route_path: null, permission_code: 'system_settings:write', icon: null, sort: 1, status: 1,
  });
  assert(button.status === 200 && button.data?.id, `menu button create failed: ${button.status}`);

  const menuCycle = await ctx.request(admin, 'PUT', `/admin/menus/${directory.data.id}`, {
    name: 'A5 测试目录', type: 'directory', parent_id: String(menu.data.id),
    route_path: null, permission_code: null, icon: 'Setting', sort: 900, status: 1,
  });
  assert(menuCycle.status === 400, `menuCycle expected 400, got ${menuCycle.status}`);
  const directoryAfterCycle = await ctx.request(admin, 'GET', `/admin/menus/${directory.data.id}`);
  assert(directoryAfterCycle.status === 200 && directoryAfterCycle.data.parent_id === null, 'failed menu cycle changed original parent');

  const parentToButton = await ctx.request(admin, 'PUT', `/admin/menus/${menu.data.id}`, {
    name: '菜单配置', type: 'button', parent_id: String(directory.data.id),
    route_path: null, permission_code: 'system_settings:write', icon: 'Menu', sort: 1, status: 1,
  });
  assert(parentToButton.status === 409, `menu with child changed to button: ${parentToButton.status}`);
  const menuAfterTypeFailure = await ctx.request(admin, 'GET', `/admin/menus/${menu.data.id}`);
  assert(menuAfterTypeFailure.status === 200 && menuAfterTypeFailure.data.type === 'menu', 'failed button conversion changed original menu');

  const arbitraryScriptRoute = await ctx.request(admin, 'POST', '/admin/menus', {
    name: '恶意路由', type: 'menu', parent_id: null,
    route_path: 'javascript:alert(1)', permission_code: 'system_settings:read', icon: null, sort: 2, status: 1,
  });
  assert(arbitraryScriptRoute.status === 400, `arbitraryScriptRoute expected 400, got ${arbitraryScriptRoute.status}`);

  const dictionaries = await ctx.request(admin, 'GET', '/admin/dictionaries?type=learner_source&page=1&page_size=20');
  assert(dictionaries.status === 200 && Array.isArray(dictionaries.data?.items), 'dictionary list failed');
  const fixed = dictionaries.data.items.find((item) => item.code === 'institution');
  assert(fixed?.id, 'fixed learner_source dictionary missing');
  const referencedDictionaryDelete = await ctx.request(admin, 'DELETE', `/admin/dictionaries/${fixed.id}`);
  assert(referencedDictionaryDelete.status === 409, `referencedDictionaryDelete expected 409, got ${referencedDictionaryDelete.status}`);

  const beforeInvalid = await ctx.request(admin, 'GET', '/admin/site-settings');
  const invalidSettings = await ctx.request(admin, 'PUT', '/admin/site-settings', {
    logo_asset_id: null,
    banners: [1, 2, 3, 4].map((id) => ({ asset_id: String(id), sort: id })),
  });
  assert(invalidSettings.status === 400, `four banners expected 400, got ${invalidSettings.status}`);
  const afterInvalid = await ctx.request(admin, 'GET', '/admin/site-settings');
  assert(JSON.stringify(afterInvalid.data) === JSON.stringify(beforeInvalid.data), 'invalid settings update changed persisted values');

  const logoId = await uploadBranding(ctx, admin, 'logo.png');
  const bannerId = await uploadBranding(ctx, admin, 'banner.png');
  const unconfiguredId = await uploadBranding(ctx, admin, 'private-brand.png');
  const saved = await ctx.request(admin, 'PUT', '/admin/site-settings', {
    logo_asset_id: logoId,
    banners: [{ asset_id: bannerId, sort: 10 }],
  });
  assert(saved.status === 200 && saved.data?.logo_asset_id === logoId, `site settings save failed: ${saved.status}`);

  const publicConfig = await ctx.request(null, 'GET', '/site-config');
  assert(publicConfig.status === 200, `publicConfig failed: ${publicConfig.status}`);
  assert(JSON.stringify(Object.keys(publicConfig.data).sort()) === JSON.stringify(['banners', 'logo_asset_id']), 'publicConfig leaked non-whitelist keys');
  assert(publicConfig.data.logo_asset_id === logoId && publicConfig.data.banners?.[0]?.asset_id === bannerId, 'publicConfig saved values mismatch');
  const publicLogo = await ctx.request(null, 'GET', `/site-config/assets/${logoId}/content`);
  assert(publicLogo.status === 200, `configured public branding failed: ${publicLogo.status}`);
  const arbitraryMedia = await ctx.request(null, 'GET', `/site-config/assets/${unconfiguredId}/content`);
  assert(arbitraryMedia.status === 404, `unconfigured public media expected 404, got ${arbitraryMedia.status}`);

  const testPassword = `A5-secret-${randomBytes(8).toString('hex')}`;
  const failedLogin = await ctx.request(null, 'POST', '/auth/login', { username: 'admin', password: testPassword });
  assert(failedLogin.status === 400 || failedLogin.status === 401, `failed login fixture unexpected: ${failedLogin.status}`);
  const auditLog = await ctx.request(admin, 'GET', '/admin/audit-logs?page=1&page_size=100&action=system.');
  assert(auditLog.status === 200 && Array.isArray(auditLog.data?.items), `audit log query failed: ${auditLog.status}`);
  assert(auditLog.data.items.some((item) => item.action === 'system.settings.update'), 'settings audit record missing');
  assert(JSON.stringify(auditLog.data).includes(testPassword) === false, 'audit query leaked a test password');
}
