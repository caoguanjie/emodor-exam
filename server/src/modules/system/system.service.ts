import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../../common/audit.service';
import { Errors } from '../../common/errors';
import { SiteSetting } from '../../entities/site-setting.entity';
import { SysDictionary } from '../../entities/sys-dictionary.entity';
import { SysMenu } from '../../entities/sys-menu.entity';
import { SysPermission } from '../../entities/sys-permission.entity';
import { SysRolePermission } from '../../entities/sys-role-permission.entity';
import { AccessService } from '../access/access.service';
import { isRegisteredPermission } from '../access/permission-catalog';
import { MediaService, type ContentDescriptor } from '../media/media.service';
import { CosDownloadUrlAdapter } from '../media/delivery/cos-download-url.adapter';

export const REGISTERED_ADMIN_ROUTES = new Set([
  '/admin/dashboard',
  '/admin/students', '/admin/training-categories',
  '/admin/courses', '/admin/questions', '/admin/papers', '/admin/questions/import',
  '/admin/exam-records', '/admin/training-statistics',
  '/admin/ai-config', '/admin/administrators', '/admin/roles', '/admin/sessions',
  '/admin/system/menus', '/admin/system/dictionaries', '/admin/system/site-settings',
  '/admin/system/audit-logs',
]);

const FIXED_DICTIONARY_TYPES = new Set([
  'learner_source', 'difficulty', 'question_type', 'regulation_status',
  'paper_status', 'question_status', 'exam_status',
]);
const SITE_KEYS = ['logo_asset_id', 'banners'] as const;
const SITE_OWNER_TYPE = 'site_config';

type MenuType = 'directory' | 'menu' | 'button';
export interface MenuInput {
  parent_id?: string | null;
  name: string;
  type: MenuType;
  route_path?: string | null;
  permission_code?: string | null;
  icon?: string | null;
  sort: number;
  status: number;
}

export interface DictionaryInput {
  type: string;
  code: string;
  label: string;
  sort: number;
  status: number;
  remark?: string | null;
}

export interface PublicSiteConfig {
  logo_asset_id: string | null;
  banners: { asset_id: string; sort: number }[];
}

type Actor = { id: string; name: string };

function decimalId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) throw Errors.param('ID 格式非法');
  return text;
}

export function assertMenuDefinition(input: MenuInput): void {
  if (!input || typeof input !== 'object') throw Errors.param('菜单请求非法');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 128) throw Errors.param('菜单名称非法');
  if (!['directory', 'menu', 'button'].includes(input.type)) throw Errors.param('菜单类型非法');
  if (!Number.isInteger(input.sort) || input.sort < 0 || input.sort > 100_000) throw Errors.param('菜单排序非法');
  if (input.status !== 0 && input.status !== 1) throw Errors.param('菜单状态非法');
  const route = input.route_path === null || input.route_path === undefined || input.route_path === '' ? null : String(input.route_path);
  const permission = input.permission_code === null || input.permission_code === undefined || input.permission_code === ''
    ? null : String(input.permission_code);
  const icon = input.icon === null || input.icon === undefined || input.icon === '' ? null : String(input.icon);
  if (icon && !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(icon)) throw Errors.param('菜单图标非法');
  if (permission && !isRegisteredPermission(permission)) throw Errors.param('菜单权限未注册');
  if (input.type === 'directory' && (route || permission)) throw Errors.param('目录不能配置路由或按钮权限');
  if (input.type === 'menu' && (!route || !REGISTERED_ADMIN_ROUTES.has(route))) throw Errors.param('菜单路由未注册');
  if (input.type === 'button' && (route || !permission)) throw Errors.param('按钮只能配置已注册权限');
}

export function normalizeSiteConfig(input: Partial<PublicSiteConfig>): PublicSiteConfig {
  const logo = decimalId(input?.logo_asset_id);
  if (input?.banners !== undefined && !Array.isArray(input.banners)) throw Errors.param('轮播配置必须是数组');
  const banners = (input?.banners || []).map((banner) => {
    if (!banner || typeof banner !== 'object' || Array.isArray(banner)) throw Errors.param('轮播项非法');
    const unknown = Object.keys(banner).filter((key) => !['asset_id', 'sort'].includes(key));
    if (unknown.length) throw Errors.param('轮播项包含不支持的字段');
    const assetId = decimalId(banner.asset_id);
    if (!assetId || !Number.isInteger(banner.sort) || banner.sort < 0 || banner.sort > 100_000) throw Errors.param('轮播项非法');
    return { asset_id: assetId, sort: banner.sort };
  });
  if (banners.length > 3) throw Errors.param('轮播图最多 3 张');
  if (new Set(banners.map((item) => item.asset_id)).size !== banners.length) throw Errors.param('轮播图不能重复');
  return { logo_asset_id: logo, banners: banners.sort((a, b) => a.sort - b.sort || a.asset_id.localeCompare(b.asset_id)) };
}

function menuView(menu: SysMenu) {
  return {
    id: String(menu.id), parent_id: menu.parentId === null ? null : String(menu.parentId),
    name: menu.name, type: menu.type, route_path: menu.routePath,
    permission_code: menu.permissionCode, icon: menu.icon, sort: Number(menu.sort),
    status: Number(menu.status), created_at: menu.createdAt, updated_at: menu.updatedAt,
  };
}

function dictionaryView(item: SysDictionary) {
  return {
    id: String(item.id), type: item.type, code: item.code, label: item.label,
    sort: Number(item.sort), status: Number(item.status), is_system: Boolean(item.isSystem),
    remark: item.remark, created_at: item.createdAt, updated_at: item.updatedAt,
  };
}

@Injectable()
export class SystemService {
  constructor(
    @InjectRepository(SysMenu) private readonly menuRepo: Repository<SysMenu>,
    @InjectRepository(SysDictionary) private readonly dictionaryRepo: Repository<SysDictionary>,
    @InjectRepository(SiteSetting) private readonly settingRepo: Repository<SiteSetting>,
    @InjectRepository(SysPermission) private readonly permissionRepo: Repository<SysPermission>,
    @InjectRepository(SysRolePermission) private readonly rolePermissionRepo: Repository<SysRolePermission>,
    private readonly dataSource: DataSource,
    private readonly media: MediaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    @Optional() private readonly urls?: CosDownloadUrlAdapter,
  ) {
    this.media.registerOwnerPolicy(SITE_OWNER_TYPE, {
      allowedPurposes: ['branding'],
      authorizeRead: async (_actorId, settingId) => {
        const setting = await this.settingRepo.findOne({ where: { id: String(settingId) } });
        return Boolean(setting && SITE_KEYS.includes(setting.key as typeof SITE_KEYS[number]));
      },
      validateBinding: async (manager, _asset, settingId) => {
        const setting = await manager.getRepository(SiteSetting).findOne({ where: { id: String(settingId) } });
        if (!setting || !SITE_KEYS.includes(setting.key as typeof SITE_KEYS[number])) throw Errors.dataForbidden('站点配置归属无效');
      },
    });
  }

  private auditLog(actor: Actor, sourceIp: string | null, action: string, objectType: string, objectId: string | null, detail: Record<string, unknown>, result: 'success' | 'failure') {
    this.audit?.log({ actor_id: actor.id, actor_name: actor.name, action, object_type: objectType, object_id: objectId, detail, result, source_ip: sourceIp });
  }

  private async assertParent(repo: Repository<SysMenu>, targetId: string | null, parentId: string | null): Promise<void> {
    if (!parentId) return;
    if (targetId && parentId === targetId) throw Errors.param('菜单父级不能指向自身');
    const seen = new Set<string>(targetId ? [targetId] : []);
    let cursor: string | null = parentId;
    while (cursor) {
      if (seen.has(cursor)) throw Errors.param('菜单父链不能形成循环');
      seen.add(cursor);
      const parent = await repo.findOne({ where: { id: cursor } });
      if (!parent) throw Errors.param('父菜单不存在');
      if (parent.type === 'button') throw Errors.param('按钮不能作为父菜单');
      cursor = parent.parentId === null ? null : String(parent.parentId);
    }
  }

  /**
   * Every menu-tree mutation takes the same real-row mutex before reading any
   * tree state. `logo_asset_id` is created by database initialization and has
   * no business deletion endpoint; site-setting writes already lock it first,
   * so both workflows share one lock order. A missing invariant fails closed
   * instead of falling back to a compatible empty-range gap lock.
   */
  private async lockMenuStructure(manager: EntityManager): Promise<Repository<SysMenu>> {
    const mutex = await manager.getRepository(SiteSetting).findOne({
      where: { key: 'logo_asset_id' },
      lock: { mode: 'pessimistic_write' },
    });
    if (!mutex) throw Errors.serviceUnavailable('菜单结构锁不可用');
    return manager.getRepository(SysMenu);
  }

  private normalizeMenu(input: MenuInput) {
    assertMenuDefinition(input);
    return {
      parentId: decimalId(input.parent_id), name: input.name.trim(), type: input.type,
      routePath: input.route_path ? String(input.route_path) : null,
      permissionCode: input.permission_code ? String(input.permission_code) : null,
      icon: input.icon ? String(input.icon) : null, sort: input.sort, status: input.status,
    };
  }

  async menuTree(options: { permissions?: string[]; includeButtons?: boolean; activeOnly?: boolean } = {}) {
    const rows = await this.menuRepo.find({ order: { sort: 'ASC', id: 'ASC' } });
    const allowed = options.permissions ? new Set(options.permissions) : null;
    const visible = rows.filter((row) => {
      if (!options.includeButtons && row.type === 'button') return false;
      if (!allowed || !row.permissionCode) return true;
      return allowed.has(row.permissionCode);
    });
    const nodes = new Map(visible.map((row) => [String(row.id), { ...menuView(row), children: [] as any[] }]));
    const roots: any[] = [];
    for (const row of visible) {
      const node = nodes.get(String(row.id))!;
      const parent = row.parentId ? nodes.get(String(row.parentId)) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    if (!options.activeOnly) return roots;
    const enabledTree = (items: any[]): any[] => items
      .filter((item) => Number(item.status) === 1)
      .map((item) => ({ ...item, children: enabledTree(item.children || []) }));
    return enabledTree(roots);
  }

  async navigation(userId: string) {
    return this.menuTree({ permissions: await this.access.permissions(userId), includeButtons: false, activeOnly: true });
  }

  async permissionOptions() {
    return this.access.catalog();
  }

  async menuDetail(id: string) {
    const row = await this.menuRepo.findOne({ where: { id: decimalId(id)! } });
    if (!row) throw Errors.notFound('菜单不存在');
    return menuView(row);
  }

  async createMenu(input: MenuInput, actor: Actor, sourceIp: string | null) {
    const normalized = this.normalizeMenu(input);
    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const repo = await this.lockMenuStructure(manager);
        await this.assertParent(repo, null, normalized.parentId);
        return repo.save(repo.create(normalized));
      });
      this.auditLog(actor, sourceIp, 'system.menu.create', 'sys_menu', String(saved.id), { route_path: saved.routePath, permission_code: saved.permissionCode }, 'success');
      return menuView(saved);
    } catch (error: any) {
      this.auditLog(actor, sourceIp, 'system.menu.create', 'sys_menu', null, { reason: error?.message || 'failed' }, 'failure');
      throw error;
    }
  }

  async updateMenu(id: string, input: MenuInput, actor: Actor, sourceIp: string | null) {
    const menuId = decimalId(id)!;
    const normalized = this.normalizeMenu(input);
    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const repo = await this.lockMenuStructure(manager);
        const row = await repo.findOne({ where: { id: menuId }, lock: { mode: 'pessimistic_write' } });
        if (!row) throw Errors.notFound('菜单不存在');
        await this.assertParent(repo, menuId, normalized.parentId);
        if (normalized.type === 'button' && await repo.count({ where: { parentId: menuId } })) {
          throw Errors.systemReferenced('菜单仍有子项，不能改为按钮');
        }
        Object.assign(row, normalized);
        return repo.save(row);
      });
      this.auditLog(actor, sourceIp, 'system.menu.update', 'sys_menu', menuId, { route_path: saved.routePath, permission_code: saved.permissionCode }, 'success');
      return menuView(saved);
    } catch (error: any) {
      this.auditLog(actor, sourceIp, 'system.menu.update', 'sys_menu', menuId, { reason: error?.message || 'failed' }, 'failure');
      throw error;
    }
  }

  async removeMenu(id: string, actor: Actor, sourceIp: string | null) {
    const menuId = decimalId(id)!;
    try {
      await this.dataSource.transaction(async (manager) => {
        const repo = await this.lockMenuStructure(manager);
        const row = await repo.findOne({ where: { id: menuId }, lock: { mode: 'pessimistic_write' } });
        if (!row) throw Errors.notFound('菜单不存在');
        if (await repo.count({ where: { parentId: menuId } })) throw Errors.systemReferenced('菜单仍有子项，不能删除');
        if (row.permissionCode) {
          const permission = await manager.getRepository(SysPermission).findOne({ where: { code: row.permissionCode } });
          if (permission && await manager.getRepository(SysRolePermission).count({ where: { permissionId: permission.id } })) {
            throw Errors.systemReferenced('菜单权限仍被角色引用，不能删除');
          }
        }
        await repo.delete({ id: menuId });
      });
      this.auditLog(actor, sourceIp, 'system.menu.delete', 'sys_menu', menuId, {}, 'success');
      return null;
    } catch (error: any) {
      this.auditLog(actor, sourceIp, 'system.menu.delete', 'sys_menu', menuId, { reason: error?.message || 'failed' }, 'failure');
      throw error;
    }
  }

  async listDictionaries(query: { page?: number; page_size?: number; type?: string; keyword?: string; status?: number }) {
    const page = Number(query.page || 1);
    const pageSize = Number(query.page_size || 20);
    const qb = this.dictionaryRepo.createQueryBuilder('dictionary');
    if (query.type) qb.andWhere('dictionary.type = :type', { type: query.type });
    if (query.status !== undefined) qb.andWhere('dictionary.status = :status', { status: query.status });
    if (query.keyword?.trim()) qb.andWhere('(dictionary.type LIKE :keyword OR dictionary.code LIKE :keyword OR dictionary.label LIKE :keyword)', { keyword: `%${query.keyword.trim()}%` });
    const [rows, total] = await qb.orderBy('dictionary.type', 'ASC').addOrderBy('dictionary.sort', 'ASC').addOrderBy('dictionary.id', 'ASC')
      .skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { items: rows.map(dictionaryView), total, page, page_size: pageSize };
  }

  private normalizeDictionary(input: DictionaryInput) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(input.type) || !/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(input.code)) throw Errors.param('字典 type/code 格式非法');
    if (FIXED_DICTIONARY_TYPES.has(input.type)) throw Errors.systemReferenced('业务固定枚举只读');
    if (!input.label?.trim() || input.label.trim().length > 128) throw Errors.param('字典标签非法');
    if (!Number.isInteger(input.sort) || input.sort < 0 || input.sort > 100_000 || ![0, 1].includes(input.status)) throw Errors.param('字典排序或状态非法');
    return { type: input.type, code: input.code, label: input.label.trim(), sort: input.sort, status: input.status, remark: input.remark?.trim() || null };
  }

  async createDictionary(input: DictionaryInput, actor: Actor, sourceIp: string | null) {
    const normalized = this.normalizeDictionary(input);
    try {
      const saved = await this.dictionaryRepo.save(this.dictionaryRepo.create({ ...normalized, isSystem: 0 }));
      this.auditLog(actor, sourceIp, 'system.dictionary.create', 'sys_dictionary', String(saved.id), { type: saved.type, code: saved.code }, 'success');
      return dictionaryView(saved);
    } catch (error: any) {
      this.auditLog(actor, sourceIp, 'system.dictionary.create', 'sys_dictionary', null, { type: input.type, code: input.code, reason: error?.message || 'failed' }, 'failure');
      if (String(error?.code) === 'ER_DUP_ENTRY') throw Errors.param('字典 type/code 已存在');
      throw error;
    }
  }

  async updateDictionary(id: string, input: DictionaryInput, actor: Actor, sourceIp: string | null) {
    const dictionaryId = decimalId(id)!;
    try {
      const row = await this.dictionaryRepo.findOne({ where: { id: dictionaryId } });
      if (!row) throw Errors.notFound('字典项不存在');
      if (row.isSystem || FIXED_DICTIONARY_TYPES.has(row.type)) throw Errors.systemReferenced('业务固定枚举只读');
      Object.assign(row, this.normalizeDictionary(input));
      const saved = await this.dictionaryRepo.save(row);
      this.auditLog(actor, sourceIp, 'system.dictionary.update', 'sys_dictionary', dictionaryId, { type: saved.type, code: saved.code }, 'success');
      return dictionaryView(saved);
    } catch (error: any) {
      this.auditLog(actor, sourceIp, 'system.dictionary.update', 'sys_dictionary', dictionaryId, { reason: error?.message || 'failed' }, 'failure');
      if (String(error?.code) === 'ER_DUP_ENTRY') throw Errors.param('字典 type/code 已存在');
      throw error;
    }
  }

  async removeDictionary(id: string, actor: Actor, sourceIp: string | null) {
    const dictionaryId = decimalId(id)!;
    try {
      const row = await this.dictionaryRepo.findOne({ where: { id: dictionaryId } });
      if (!row) throw Errors.notFound('字典项不存在');
      if (row.isSystem || FIXED_DICTIONARY_TYPES.has(row.type)) throw Errors.systemReferenced('业务固定枚举只读，不能删除');
      await this.dictionaryRepo.delete({ id: dictionaryId });
      this.auditLog(actor, sourceIp, 'system.dictionary.delete', 'sys_dictionary', dictionaryId, { type: row.type, code: row.code }, 'success');
      return null;
    } catch (error: any) {
      this.auditLog(actor, sourceIp, 'system.dictionary.delete', 'sys_dictionary', dictionaryId, { reason: error?.message || 'failed' }, 'failure');
      throw error;
    }
  }

  async publicConfig(): Promise<PublicSiteConfig> {
    const rows = await this.settingRepo.find();
    const values = new Map(rows.filter((row) => SITE_KEYS.includes(row.key as typeof SITE_KEYS[number])).map((row) => [row.key, row.value]));
    return normalizeSiteConfig({
      logo_asset_id: values.get('logo_asset_id') as string | null | undefined,
      banners: values.get('banners') as PublicSiteConfig['banners'] | undefined,
    });
  }

  async siteSettings() {
    return this.publicConfig();
  }

  private async setting(manager: EntityManager, key: typeof SITE_KEYS[number], actorId: string) {
    const repo = manager.getRepository(SiteSetting);
    let row = await repo.findOne({ where: { key }, lock: { mode: 'pessimistic_write' } });
    if (!row) row = await repo.save(repo.create({ key, value: key === 'banners' ? [] : null, updatedBy: actorId }));
    return row;
  }

  async updateSiteSettings(input: Partial<PublicSiteConfig>, actor: Actor, sourceIp: string | null) {
    const next = normalizeSiteConfig(input);
    try {
      for (const assetId of [next.logo_asset_id, ...next.banners.map((banner) => banner.asset_id)].filter((id): id is string => Boolean(id))) {
        await this.media.assertPublicBrandingCandidate(assetId);
      }
      await this.dataSource.transaction(async (manager) => {
        const logo = await this.setting(manager, 'logo_asset_id', actor.id);
        const banners = await this.setting(manager, 'banners', actor.id);
        const previous = normalizeSiteConfig({ logo_asset_id: logo.value as any, banners: banners.value as any });
        if (next.logo_asset_id) await this.media.bind(manager, next.logo_asset_id, SITE_OWNER_TYPE, String(logo.id));
        for (const banner of next.banners) await this.media.bind(manager, banner.asset_id, SITE_OWNER_TYPE, String(banners.id));
        const nextLogo = new Set(next.logo_asset_id ? [next.logo_asset_id] : []);
        const nextBanners = new Set(next.banners.map((banner) => banner.asset_id));
        if (previous.logo_asset_id && !nextLogo.has(previous.logo_asset_id)) await this.media.unbind(manager, previous.logo_asset_id, SITE_OWNER_TYPE, String(logo.id));
        for (const banner of previous.banners) if (!nextBanners.has(banner.asset_id)) await this.media.unbind(manager, banner.asset_id, SITE_OWNER_TYPE, String(banners.id));
        logo.value = next.logo_asset_id;
        logo.updatedBy = actor.id;
        banners.value = next.banners;
        banners.updatedBy = actor.id;
        await manager.getRepository(SiteSetting).save([logo, banners]);
      });
      this.auditLog(actor, sourceIp, 'system.settings.update', 'site_setting', 'branding', { logo_asset_id: next.logo_asset_id, banner_count: next.banners.length }, 'success');
      return next;
    } catch (error: any) {
      this.auditLog(actor, sourceIp, 'system.settings.update', 'site_setting', 'branding', { reason: error?.message || 'failed' }, 'failure');
      throw error;
    }
  }

  async openPublicAsset(assetId: string, rangeHeader?: string): Promise<ContentDescriptor> {
    const id = decimalId(assetId)!;
    const current = await this.publicConfig();
    const allowed = current.logo_asset_id === id || current.banners.some((banner) => banner.asset_id === id);
    if (!allowed) throw Errors.notFound('公开品牌资源不存在');
    return this.media.openPublicBrandingContent(id, rangeHeader);
  }

  async publicAssetRedirect(assetId: string) {
    if (!this.urls) return null;
    const id = decimalId(assetId)!;
    const current = await this.publicConfig();
    if (current.logo_asset_id !== id && !current.banners.some((banner) => banner.asset_id === id)) throw Errors.notFound('公开品牌资源不存在');
    const asset = await this.media.authorizePublicBrandingAsset(id);
    return this.urls.issue(asset, { branding: true });
  }
}
