import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
import { QUESTION_ROUTE_PERMISSIONS, routeAccessAllowed } from '../../web/src/router/access';
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
        kept: 'diagnostic',
      },
      result: 'success',
      source_ip: '127.0.0.1',
    });

    const day = new Date().toISOString().slice(0, 10);
    const line = await readFile(join(root, 'audit', `audit-${day}.log`), 'utf8');
    expect(line).not.toContain(secret);
    expect(line).toContain('system.settings.update');
    expect(line).toContain('diagnostic');
    expect(JSON.parse(line).detail).toEqual({
      password: '[REDACTED]',
      nested: { api_key: '[REDACTED]' },
      encoded: '{"password":"[REDACTED]"}',
      kept: 'diagnostic',
    });
  });

  it('redacts credentials in fallback output while preserving the failed action', () => {
    const secret = 'A5-fallback-secret-8441';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const audit = new AuditService(config('/dev/null/not-a-directory'));
    audit.log({
      actor_id: null,
      actor_name: 'anonymous',
      action: 'auth.login',
      object_type: 'sys_user',
      object_id: null,
      detail: { old_password: secret, reason: 'bad_credentials' },
      result: 'failure',
      source_ip: null,
    });

    const rendered = JSON.stringify(error.mock.calls);
    expect(rendered).not.toContain(secret);
    expect(rendered).toContain('auth.login');
    expect(rendered).toContain('bad_credentials');
  });

  it('queries only regular audit files inside the configured root and filters again on output', async () => {
    const secret = 'legacy-unredacted-password';
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
      detail: { password: secret }, result: 'failure', source_ip: null,
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
    expect(JSON.stringify(page)).not.toContain(linkedSecret);
    expect(page.items[0].detail).toEqual({ password: '[REDACTED]' });
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

    const page = await new AuditQueryService(config(configuredRoot)).list({ page: 1, page_size: 20 });
    expect(page).toEqual({ items: [], total: 0, page: 1, page_size: 20 });
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
});
