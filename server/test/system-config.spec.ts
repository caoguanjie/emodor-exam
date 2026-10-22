import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditService } from '../src/common/audit.service';
import { AuditQueryService } from '../src/modules/system/audit-query.service';
import {
  SystemService,
  assertMenuDefinition,
  normalizeSiteConfig,
} from '../src/modules/system/system.service';
import { MediaService } from '../src/modules/media/media.service';
import { SiteSetting } from '../src/entities/site-setting.entity';
import { SysMenu } from '../src/entities/sys-menu.entity';
import { COURSE_ROUTE_PERMISSIONS, QUESTION_ROUTE_PERMISSIONS, routeAccessAllowed } from '../../web/src/router/access';
import { invalidateTabCache, tabCacheKey } from '../../web/src/stores/tab-cache';

function config(logDir: string) {
  return { logDir } as any;
}

describe('A5 audit redaction and bounded query', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruleexam-system-audit-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('redacts nested credentials in the normal JSONL write', async () => {
    const secret = 'A5-normal-secret-9327';
    const cookieSecret = 'sid=A5-normal-cookie-1927';
    const spacedSecret = 'A5 normal password with spaces';
    const prefixedSecret = 'redaction-fixture-marker';
    const audit = new AuditService(config(root));
    audit.log({
      actor_id: 7,
      actor_name: 'admin',
      action: 'system.settings.update',
      object_type: 'site_setting',
      object_id: 'branding',
      detail: {
        password: secret,
        nested: { api_key: secret },
        encoded: `{"password":"${secret}"}`,
        legacy_blob_a: JSON.stringify({ cookie: cookieSecret }),
        legacy_blob_b: JSON.stringify({ password: spacedSecret }),
        legacy_line: `cookie="${cookieSecret}"; note=diagnostic`,
        prefixed_assignment: `payload={"password":"${prefixedSecret}"}`,
        kept: 'diagnostic',
      },
      result: 'success',
      source_ip: '127.0.0.1',
    });

    const day = new Date().toISOString().slice(0, 10);
    const line = await readFile(join(root, 'audit', `audit-${day}.log`), 'utf8');
    expect(line).not.toContain(secret);
    expect(line).not.toContain(cookieSecret);
    expect(line).not.toContain(spacedSecret);
    expect(line).not.toContain(prefixedSecret);
    expect(line).toContain('system.settings.update');
    expect(line).toContain('diagnostic');
    expect(JSON.parse(line).detail).toEqual({
      password: '[REDACTED]',
      nested: { api_key: '[REDACTED]' },
      encoded: '{"password":"[REDACTED]"}',
      legacy_blob_a: '{"cookie":"[REDACTED]"}',
      legacy_blob_b: '{"password":"[REDACTED]"}',
      legacy_line: 'cookie=[REDACTED]; note=diagnostic',
      prefixed_assignment: 'payload={"password":[REDACTED]}',
      kept: 'diagnostic',
    });
  });

  it('redacts credentials in fallback output while preserving the failed action', () => {
    const secret = 'A5-fallback-secret-8441';
    const cookieSecret = 'sid=A5-fallback-cookie-7441';
    const spacedSecret = 'A5 fallback password with spaces';
    const prefixedSecret = 'redaction-fixture-marker';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const audit = new AuditService(config('/dev/null/not-a-directory'));
    audit.log({
      actor_id: null,
      actor_name: 'anonymous',
      action: 'auth.login',
      object_type: 'sys_user',
      object_id: null,
      detail: {
        old_password: secret,
        legacy_blob_a: JSON.stringify({ cookie: cookieSecret }),
        legacy_blob_b: JSON.stringify({ password: spacedSecret }),
        legacy_line: `authorization="Bearer ${spacedSecret}"; note=bad_credentials`,
        prefixed_assignment: `payload={"password":"${prefixedSecret}"}`,
        reason: 'bad_credentials',
      },
      result: 'failure',
      source_ip: null,
    });

    const rendered = JSON.stringify(error.mock.calls);
    expect(rendered).not.toContain(secret);
    expect(rendered).not.toContain(cookieSecret);
    expect(rendered).not.toContain(spacedSecret);
    expect(rendered).not.toContain(prefixedSecret);
    expect(rendered).toContain('auth.login');
    expect(rendered).toContain('bad_credentials');
    expect(JSON.parse(error.mock.calls[0][1] as string).detail.prefixed_assignment)
      .toBe('payload={"password":[REDACTED]}');
  });

  it('queries only regular audit files inside the configured root and filters again on output', async () => {
    const secret = 'legacy-unredacted-password';
    const cookieSecret = 'sid=legacy-unredacted-cookie';
    const spacedSecret = 'legacy password with spaces';
    const prefixedSecret = 'redaction-fixture-marker';
    const auditDir = join(root, 'audit');
    const audit = new AuditService(config(root));
    audit.log({
      actor_id: 7,
      actor_name: 'admin',
      action: 'system.menu.update',
      object_type: 'sys_menu',
      object_id: '11',
      detail: { route: '/admin/system/menus' },
      result: 'success',
      source_ip: '127.0.0.1',
    });
    await writeFile(join(auditDir, 'audit-2026-10-20.log'), JSON.stringify({
      ts: '2026-10-20T08:00:00.000Z', actor_id: 9, actor_name: 'tester',
      action: 'auth.password.change', object_type: 'sys_user', object_id: '9',
      detail: {
        password: secret,
        legacy_blob_a: JSON.stringify({ cookie: cookieSecret }),
        legacy_blob_b: JSON.stringify({ password: spacedSecret }),
        legacy_line: `credential="${spacedSecret}"; note=diagnostic`,
        prefixed_assignment: `payload={"password":"${prefixedSecret}"}`,
      }, result: 'failure', source_ip: null,
      unexpected_legacy_payload: secret,
    }) + '\n', 'utf8');
    await writeFile(join(auditDir, 'not-an-audit.log'), secret, 'utf8');
    const linkedSecret = 'symlinked-audit-secret';
    const outside = join(root, 'outside-audit.log');
    await writeFile(outside, JSON.stringify({
      ts: '2026-10-20T09:00:00.000Z', actor_id: 9, actor_name: 'tester',
      action: 'auth.password.change', object_type: 'sys_user', object_id: '9',
      detail: { password: linkedSecret }, result: 'failure', source_ip: null,
    }) + '\n', 'utf8');
    await symlink(outside, join(auditDir, 'audit-2026-10-19.log'));

    const service = new AuditQueryService(config(root));
    const page = await service.list({
      date_from: '2026-10-20', date_to: new Date().toISOString().slice(0, 10),
      actor: 'tester', action: 'auth.password', page: 1, page_size: 20,
    });

    expect(page).toMatchObject({ total: 1, page: 1, page_size: 20 });
    expect(page.items).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain(secret);
    expect(JSON.stringify(page)).not.toContain(cookieSecret);
    expect(JSON.stringify(page)).not.toContain(spacedSecret);
    expect(JSON.stringify(page)).not.toContain(prefixedSecret);
    expect(JSON.stringify(page)).not.toContain(linkedSecret);
    expect(page.items[0].detail).toEqual({
      password: '[REDACTED]',
      legacy_blob_a: '{"cookie":"[REDACTED]"}',
      legacy_blob_b: '{"password":"[REDACTED]"}',
      legacy_line: 'credential=[REDACTED]; note=diagnostic',
      prefixed_assignment: 'payload={"password":[REDACTED]}',
    });
  });

  it('returns an empty first page only when the audit directory does not exist yet', async () => {
    const page = await new AuditQueryService(config(join(root, 'fresh-install'))).list({ page: 1, page_size: 20 });
    expect(page).toEqual({ items: [], total: 0, page: 1, page_size: 20 });
  });

  it('surfaces an invalid audit storage root as a safe service-unavailable error', async () => {
    const configuredRoot = join(root, 'invalid-root');
    await mkdir(configuredRoot);
    await writeFile(join(configuredRoot, 'audit'), 'not-a-directory', 'utf8');

    await expect(new AuditQueryService(config(configuredRoot)).list({ page: 1, page_size: 20 }))
      .rejects.toMatchObject({ code: 50004, httpStatus: 503, message: '审计日志读取失败' });
  });

  it('surfaces an unreadable audit file instead of returning a partial success page', async () => {
    const auditDir = join(root, 'unreadable-file', 'audit');
    await mkdir(auditDir, { recursive: true });
    const file = join(auditDir, 'audit-2026-10-21.log');
    await writeFile(file, '{"ts":"2026-10-21T08:00:00.000Z"}\n', 'utf8');
    await chmod(file, 0o000);
    try {
      await expect(new AuditQueryService(config(join(root, 'unreadable-file'))).list({ page: 1, page_size: 20 }))
        .rejects.toMatchObject({ code: 50004, httpStatus: 503, message: '审计日志读取失败' });
    } finally {
      await chmod(file, 0o600);
    }
  });

  it('does not follow a symlink used as the audit root directory', async () => {
    const configuredRoot = join(root, 'configured');
    const outsideAudit = join(root, 'outside-audit');
    await mkdir(configuredRoot);
    await mkdir(outsideAudit);
    await writeFile(join(outsideAudit, 'audit-2026-10-21.log'), JSON.stringify({
      ts: '2026-10-21T08:00:00.000Z', actor_id: 9, actor_name: 'outside',
      action: 'outside.read', object_type: 'secret', object_id: '9', detail: {},
      result: 'success', source_ip: null,
    }) + '\n', 'utf8');
    await symlink(outsideAudit, join(configuredRoot, 'audit'));

    await expect(new AuditQueryService(config(configuredRoot)).list({ page: 1, page_size: 20 }))
      .rejects.toMatchObject({ code: 50004, httpStatus: 503, message: '审计日志读取失败' });
  });
});

describe('A5 system configuration safety contracts', () => {
  it('invalidates only the refreshed or closed fullPath cache', () => {
    const versions: Record<string, number> = {};
    const questions = '/admin/questions?page=2';
    const menus = '/admin/system/menus?keyword=制度';
    const firstQuestions = tabCacheKey(questions, versions);
    const firstMenus = tabCacheKey(menus, versions);

    invalidateTabCache(versions, [questions]);
    expect(tabCacheKey(questions, versions)).not.toBe(firstQuestions);
    expect(tabCacheKey(menus, versions)).toBe(firstMenus);

    invalidateTabCache(versions, [menus, menus]);
    expect(versions[menus]).toBe(1);
  });

  it('allows the Questions route for read-only or write-only grants, but not unrelated grants', () => {
    const meta = { permissionAny: [...QUESTION_ROUTE_PERMISSIONS] };
    expect(routeAccessAllowed(meta, (code) => code === 'questions:read', false)).toBe(true);
    expect(routeAccessAllowed(meta, (code) => code === 'questions:write', false)).toBe(true);
    expect(routeAccessAllowed(meta, (code) => code === 'papers:read', false)).toBe(false);
  });

  it('allows the Courses entrance for read-only or write-only grants, while its detail stays read-only', () => {
    const entrance = { permissionAny: [...COURSE_ROUTE_PERMISSIONS] };
    const detail = { permission: 'courses:read' };
    expect(routeAccessAllowed(entrance, (code) => code === 'courses:read', false)).toBe(true);
    expect(routeAccessAllowed(entrance, (code) => code === 'courses:write', false)).toBe(true);
    expect(routeAccessAllowed(entrance, (code) => code === 'papers:read', false)).toBe(false);
    expect(routeAccessAllowed(detail, (code) => code === 'courses:write', false)).toBe(false);
    expect(routeAccessAllowed(detail, (code) => code === 'courses:read', false)).toBe(true);
  });

  it('opens only ready branding assets currently bound to site config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-public-branding-'));
    try {
      const storageKey = 'media/brand.png';
      await mkdir(join(root, 'media'), { recursive: true });
      await writeFile(join(root, storageKey), Buffer.from('public-branding'));
      const asset = {
        id: '41', ownerId: '1', uploadedBy: '1', purpose: 'branding', mediaKind: 'image',
        originalName: 'brand.png', mimeType: 'image/png', storageKey, sizeBytes: '15',
        sha256: 'a'.repeat(64), status: 'ready', durationMs: null, probeError: null,
        createdAt: new Date('2026-10-21T00:00:00.000Z'), updatedAt: new Date('2026-10-21T00:00:00.000Z'),
      };
      let referenced = true;
      const assets = { async findOne() { return asset; } };
      const references = { async count() { return referenced ? 1 : 0; } };
      const service = new MediaService(
        assets as any, references as any, {} as any,
        { upload: { dir: root } } as any, {} as any,
      );

      await expect(service.assertPublicBrandingCandidate('41')).resolves.toBeUndefined();
      await expect(service.openPublicBrandingContent('41')).resolves.toMatchObject({
        asset, path: join(root, storageKey), size: 15, range: null,
      });
      referenced = false;
      await expect(service.openPublicBrandingContent('41')).rejects.toMatchObject({ code: 40401 });
      asset.purpose = 'avatar';
      await expect(service.assertPublicBrandingCandidate('41')).rejects.toMatchObject({ code: 40001 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects executable or unregistered menu routes and invalid type fields', () => {
    expect(() => assertMenuDefinition({
      name: '恶意入口', type: 'menu', route_path: 'javascript:alert(1)',
      permission_code: 'system_settings:read', sort: 1, status: 1,
    })).toThrowError(expect.objectContaining({ code: 40001 }));
    expect(() => assertMenuDefinition({
      name: '未知入口', type: 'menu', route_path: '/admin/not-registered',
      permission_code: 'system_settings:read', sort: 1, status: 1,
    })).toThrowError(expect.objectContaining({ code: 40001 }));
    expect(() => assertMenuDefinition({
      name: '错误按钮', type: 'button', route_path: '/admin/system/menus',
      permission_code: 'system_settings:write', sort: 1, status: 1,
    })).toThrowError(expect.objectContaining({ code: 40001 }));
  });

  it('accepts the registered Courses menu with a null permission for frontend read-or-write filtering', () => {
    expect(() => assertMenuDefinition({
      name: '课程管理', type: 'menu', route_path: '/admin/courses',
      permission_code: null, icon: 'Notebook', sort: 85, status: 1,
    })).not.toThrow();
  });

  it('saves the independent question import menu and exposes it only to question writers', async () => {
    const rows: any[] = [{ id: '77', parentId: null, name: '考试管理', type: 'directory', routePath: null, permissionCode: null, icon: 'Tickets', sort: 30, status: 1 }];
    const menus = {
      async find() { return rows; },
      async findOne({ where }: any) { return rows.find((row) => row.id === where.id) || null; },
      create(value: any) { return { ...value }; },
      async save(value: any) { const row = { id: '91', ...value }; rows.push(row); return row; },
    };
    const manager = {
      getRepository(entity: any) { return entity === SiteSetting ? { async findOne() { return { id: '1' }; } } : menus; },
    };
    const service = new SystemService(
      menus as any, {} as any, {} as any, {} as any, {} as any,
      { async transaction(work: any) { return work(manager); } } as any,
      { registerOwnerPolicy() {} } as any, {} as any, { log() {} } as any,
    );
    const saved = await service.createMenu({
      parent_id: '77', name: '试题导入', type: 'menu', route_path: '/admin/questions/import',
      permission_code: 'questions:write', icon: 'Upload', sort: 30, status: 1,
    }, { id: '1', name: 'admin' }, null);
    expect(saved).toMatchObject({ id: '91', parent_id: '77', route_path: '/admin/questions/import', permission_code: 'questions:write' });
    const writable = await service.menuTree({ permissions: ['questions:write'], activeOnly: true });
    expect(writable[0].children).toEqual([expect.objectContaining({ id: '91', name: '试题导入', route_path: '/admin/questions/import' })]);
    const readable = await service.menuTree({ permissions: ['questions:read'], activeOnly: true });
    expect(readable[0].children).toEqual([]);
  });

  it('does not allow canceled management and monitoring routes to be recreated as menus', () => {
    for (const route_path of [
      '/admin/departments', '/admin/users', '/admin/regulations',
      '/admin/exam-monitor', '/admin/grading', '/admin/statistics',
    ]) {
      expect(() => assertMenuDefinition({
        name: '已取消入口', type: 'menu', route_path,
        permission_code: null, sort: 1, status: 1,
      })).toThrowError(expect.objectContaining({ code: 40001 }));
    }
  });

  it('normalizes a public site config to the exact two-key whitelist and at most three sorted banners', () => {
    expect(normalizeSiteConfig({
      logo_asset_id: '17',
      banners: [{ asset_id: '22', sort: 20 }, { asset_id: '21', sort: 10 }],
      api_key: 'must-never-leak',
    } as any)).toEqual({
      logo_asset_id: '17',
      banners: [{ asset_id: '21', sort: 10 }, { asset_id: '22', sort: 20 }],
    });
    expect(() => normalizeSiteConfig({
      logo_asset_id: null,
      banners: [1, 2, 3, 4].map((id) => ({ asset_id: String(id), sort: id })),
    })).toThrowError(expect.objectContaining({ code: 40001 }));
  });

  it('publicConfig ignores arbitrary setting rows instead of serializing the repository', async () => {
    const settings = {
      async find() {
        return [
          { key: 'logo_asset_id', value: '31' },
          { key: 'banners', value: [{ asset_id: '33', sort: 2 }, { asset_id: '32', sort: 1 }] },
          { key: 'ai_api_key', value: 'private-key' },
        ];
      },
    };
    const media = { registerOwnerPolicy() {} };
    const service = new SystemService(
      {} as any, {} as any, settings as any, {} as any, {} as any,
      {} as any, media as any, {} as any, {} as any,
    );

    const result = await service.publicConfig();
    expect(Object.keys(result).sort()).toEqual(['banners', 'logo_asset_id']);
    expect(result).toEqual({
      logo_asset_id: '31',
      banners: [{ asset_id: '32', sort: 1 }, { asset_id: '33', sort: 2 }],
    });
    expect(JSON.stringify(result)).not.toContain('private-key');
  });

  it('reuses the registered permission catalog for menu permission options', async () => {
    const options = [
      { code: 'system_settings:read', name: '读取系统配置' },
      { code: 'system_settings:write', name: '维护系统配置' },
    ];
    const access = { catalog: vi.fn().mockResolvedValue(options) };
    const media = { registerOwnerPolicy() {} };
    const service = new SystemService(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, media as any, access as any, {} as any,
    );

    await expect(service.permissionOptions()).resolves.toEqual(options);
    expect(access.catalog).toHaveBeenCalledTimes(1);
  });

  it('fails closed before touching the menu tree when the seeded mutex row is missing', async () => {
    const menuTransactionRepo = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => ({ id: '91', ...value })),
    };
    const settingTransactionRepo = { findOne: vi.fn().mockResolvedValue(null) };
    const manager = {
      getRepository: vi.fn((entity) => entity === SiteSetting ? settingTransactionRepo : menuTransactionRepo),
    };
    const dataSource = { transaction: vi.fn(async (work) => work(manager)) };
    const media = { registerOwnerPolicy() {} };
    const service = new SystemService(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      dataSource as any, media as any, {} as any, { log() {} } as any,
    );

    await expect(service.createMenu({
      parent_id: null,
      name: '缺失互斥行',
      type: 'directory',
      route_path: null,
      permission_code: null,
      icon: null,
      sort: 1,
      status: 1,
    }, { id: '1', name: 'admin' }, null)).rejects.toMatchObject({
      code: 50004,
      httpStatus: 503,
      message: '菜单结构锁不可用',
    });
    expect(manager.getRepository).toHaveBeenNthCalledWith(1, SiteSetting);
    expect(manager.getRepository).not.toHaveBeenCalledWith(SysMenu);
    expect(menuTransactionRepo.save).not.toHaveBeenCalled();
  });
});
