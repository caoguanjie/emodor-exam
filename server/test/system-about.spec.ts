import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { SiteSetting } from '../src/entities/site-setting.entity';
import { SystemService, normalizeSiteConfig } from '../src/modules/system/system.service';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { DtoValidationPipe } from '../src/common/dto-validation.pipe';
import { SystemController } from '../src/modules/system/system.controller';

const actor = { id: '7', name: 'admin' };
const terms = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '请遵守培训安排。', marks: [{ type: 'bold' }] }] }] };
const about = {
  institution_name: '测试培训中心', platform_subtitle: '学习与考试', version: '2.0.0',
  contact_email: 'support@example.com', wechat_account: 'training-center', contact_phone: '123456', service_terms: terms,
};
const branding = { logo_asset_id: '11', banners: [{ asset_id: '12', sort: 10 }] };

function normalized(value: unknown) {
  return (normalizeSiteConfig({ ...branding, about: value } as any) as any).about;
}

function fixture(initialAbout: unknown = about) {
  const rows = new Map<string, any>([
    ['logo_asset_id', { id: '1', key: 'logo_asset_id', value: '11', updatedBy: '5' }],
    ['banners', { id: '2', key: 'banners', value: [{ asset_id: '12', sort: 10 }], updatedBy: '5' }],
  ]);
  if (initialAbout !== undefined) rows.set('about', { id: '3', key: 'about', value: structuredClone(initialAbout), updatedBy: '5' });
  const locks: string[] = [];
  const bindings = new Set(['11:1', '12:2']);
  const assertedAssets: string[] = [];
  let policy: any;
  let transactions = 0;
  const repo = {
    async find() { return [...rows.values()].map(row => structuredClone(row)); },
    async findOne({ where, lock }: any) {
      const row = where.key ? rows.get(where.key) : [...rows.values()].find(row => row.id === where.id);
      if (lock) locks.push(where.key);
      return row ? structuredClone(row) : null;
    },
    create(value: any) { return { ...value }; },
    async save(value: any) {
      if (Array.isArray(value)) return Promise.all(value.map(item => repo.save(item)));
      const row = { id: value.id || String(rows.size + 1), ...value };
      rows.set(row.key, structuredClone(row));
      return structuredClone(row);
    },
  };
  const manager = { getRepository(entity: unknown) { if (entity !== SiteSetting) throw new Error('unexpected repository'); return repo; } };
  const dataSource = { async transaction(work: any) { transactions++; return work(manager); } };
  const media = {
    registerOwnerPolicy(_owner: string, value: unknown) { policy = value; },
    async assertPublicBrandingCandidate(id: string) { assertedAssets.push(id); },
    async bind(_manager: unknown, id: string, _owner: string, ownerId: string) { bindings.add(`${id}:${ownerId}`); },
    async unbind(_manager: unknown, id: string, _owner: string, ownerId: string) { bindings.delete(`${id}:${ownerId}`); },
  };
  const service = new SystemService({} as any, {} as any, repo as any, {} as any, {} as any,
    dataSource as any, media as any, {} as any, { log() {} } as any);
  return { service, rows, locks, bindings, assertedAssets, policy, transactions: () => transactions };
}

describe('site about configuration', () => {
  async function parseBody(input: unknown) {
    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, SystemController, 'updateSiteSettings');
    const body: any = Object.values(metadata).find((item: any) => item.index === 0);
    const globalValue = await new DtoValidationPipe().transform(input, { type: 'body', metatype: Object });
    return body.pipes[0].transform(globalValue, { type: 'body', metatype: Object });
  }

  it('accepts both independent partial requests through the route validation pipe', async () => {
    expect(await parseBody({ about })).toMatchObject({ about });
    expect(await parseBody({ logo_asset_id: null })).toMatchObject({ logo_asset_id: null });
    expect(await parseBody({ banners: [] })).toMatchObject({ banners: [] });
  });

  it('rejects raw nested extras and deeply nested documents at the DTO boundary', async () => {
    for (const input of [{}, { about: null }, { about: { ...about, extra: 'secret' } },
      { banners: [{ asset_id: '12', sort: 0, extra: 'private' }] }, { banners: null }]) {
      await expect(parseBody(input)).rejects.toMatchObject({ code: 40001 });
    }
    let deep: any = { type: 'paragraph' };
    for (let i = 0; i < 10_000; i++) deep = { type: 'blockquote', content: [deep] };
    await expect(parseBody({ about: { ...about, service_terms: { type: 'doc', content: [deep] } } }))
      .rejects.toMatchObject({ code: 40001 });
    await expect(parseBody({ about, api_key: 'unknown' })).rejects.toMatchObject({ status: 400 });
  });

  it('bounds malformed branding fields before the DTO transformer sees them', async () => {
    let deep: any = { nested: null };
    for (let i = 0; i < 10_000; i++) deep = { nested: deep };
    for (const input of [{ logo_asset_id: deep }, { banners: [{ asset_id: deep, sort: 0 }] },
      { banners: [{ asset_id: '12', sort: deep }] }, { banners: Array.from({ length: 4 }, () => ({ asset_id: '12', sort: 0 })) }]) {
      await expect(parseBody(input)).rejects.toMatchObject({ code: 40001 });
    }
    await expect(parseBody({ about, unknown: deep })).rejects.toMatchObject({ status: 400 });
  });

  it('returns the seven accepted about fields with safe schema 3 rich text', () => {
    expect(normalized(about)).toEqual(about);
    expect(normalized({ ...about, institution_name: '  测试培训中心  ', contact_email: '', wechat_account: '', contact_phone: '', service_terms: null }))
      .toEqual({ ...about, institution_name: '测试培训中心', contact_email: '', wechat_account: '', contact_phone: '', service_terms: null });
  });

  it.each(['13800000000', '020-12345678', '+86 (20) 1234-5678', '400 123 4567', '（020）1234-5678', '1'])
  ('accepts flexible phone format %s without requiring an eleven-digit mobile', contact_phone => {
    expect(normalized({ ...about, contact_phone: `  ${contact_phone}  ` }).contact_phone).toBe(contact_phone);
  });

  it.each(['abc', 'https://example.com/123', '+() -', '123+456', '123\t456', '1_2', '+86/20/123', '1'.repeat(33), null, 123])
  ('rejects an invalid contact phone %#', contact_phone => {
    expect(() => normalized({ ...about, contact_phone })).toThrowError(expect.objectContaining({ code: 40001 }));
  });

  it('rejects the retired qq_group key and excludes it from public output', async () => {
    expect(() => normalized({ ...about, qq_group: '123456' })).toThrowError(expect.objectContaining({ code: 40001 }));
    const { service } = fixture({ ...about, qq_group: '123456' });
    expect((await service.publicConfig() as any).about).toEqual(about);
  });

  it.each([
    ['institution_name', '', 128], ['platform_subtitle', '  ', 200], ['version', '', 32],
    ['institution_name', 'x'.repeat(129), 128], ['platform_subtitle', 'x'.repeat(201), 200],
    ['version', 'x'.repeat(33), 32], ['contact_email', 'a'.repeat(243) + '@example.com', 254],
    ['wechat_account', 'x'.repeat(129), 128], ['contact_phone', '1'.repeat(33), 32],
    ['contact_email', 'invalid-mail', 254], ['contact_phone', '123a', 32],
    ['wechat_account', 123, 128], ['version', null, 32],
  ])('rejects invalid %s content %#', (field, value) => {
    expect(() => normalized({ ...about, [field]: value })).toThrowError(expect.objectContaining({ code: 40001 }));
  });

  it('accepts maximum string lengths and rejects incomplete or unknown about keys', () => {
    expect(normalized({ ...about, institution_name: 'x'.repeat(128), platform_subtitle: 'x'.repeat(200), version: 'x'.repeat(32),
      contact_email: '', wechat_account: 'x'.repeat(128), contact_phone: '1'.repeat(32) })).toMatchObject({ contact_phone: '1'.repeat(32) });
    for (const invalid of [null, [], 'html', {}, { ...about, private_key: 'not-public' }, { ...about, service_terms: undefined }]) {
      expect(() => normalized(invalid)).toThrowError(expect.objectContaining({ code: 40001 }));
    }
  });

  it.each([
    '<p>raw HTML</p>',
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { asset_id: '99' } }] }] },
    { type: 'doc', content: [{ type: 'video', attrs: { src: 'https://example.com/media' } }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] },
    { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'left', style: 'background:url(https://example.com)' } }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bad', marks: [{ type: 'textStyle', attrs: { color: 'url(javascript:alert(1))' } }] }] }] },
    { type: 'doc', content: [], management_metadata: 'private' },
  ])('rejects non-whitelisted service terms %#', service_terms => {
    expect(() => normalized({ ...about, service_terms })).toThrowError(expect.objectContaining({ code: 40001 }));
  });

  it('enforces the serialized UTF-8 size, node count and depth before recursive parsing', () => {
    const oversized = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '中'.repeat(34_000) }] }] };
    const tooManyNodes = { type: 'doc', content: Array.from({ length: 2000 }, () => ({ type: 'paragraph' })) };
    let deep: any = { type: 'paragraph' };
    for (let i = 0; i < 10_000; i++) deep = { type: 'blockquote', content: [deep] };
    const cyclic: any = { type: 'doc', content: [] };
    cyclic.content.push(cyclic);
    for (const service_terms of [oversized, tooManyNodes, { type: 'doc', content: [deep] }, cyclic]) {
      expect(() => normalized({ ...about, service_terms })).toThrowError(expect.objectContaining({ code: 40001 }));
    }
  });

  it('keeps both incoming and normalized service terms within the JSON byte limit', () => {
    const doc: any = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '', marks: [{ type: 'highlight', attrs: { color: '#fff' } }] }] }] };
    const overhead = Buffer.byteLength(JSON.stringify(doc), 'utf8');
    doc.content[0].content[0].text = 'x'.repeat(100_000 - overhead);
    expect(() => normalized({ ...about, service_terms: doc })).toThrowError(expect.objectContaining({ code: 40001 }));
    doc.content[0].content[0].text = 'x'.repeat(99_990 - overhead);
    expect(normalized({ ...about, service_terms: doc }).service_terms.content[0].content[0].marks[0].attrs.color).toBe('#ffffff');
  });

  it('supplies the existing H5 defaults when the about row is absent', async () => {
    const { service, rows } = fixture();
    rows.delete('about');
    const result: any = await service.publicConfig();
    expect(result.about).toMatchObject({ institution_name: '海珠区安全教育培训中心', platform_subtitle: '安全教育培训与考试平台', version: '1.2.0', contact_email: '', wechat_account: '', contact_phone: '' });
    const text = JSON.stringify(result.about.service_terms);
    expect(text).toContain('海珠区安全教育培训中心服务使用协议');
    expect(text).toContain('欢迎使用海珠区安全教育培训中心在线教育平台');
    expect(text).toContain('七、法律适用');
    expect(text).toContain('提交平台所在地有管辖权的人民法院诉讼解决。');
  });

  it('only exposes the about whitelist even when arbitrary stored settings exist', async () => {
    const { service, rows } = fixture({ ...about, private_key: 'must-not-leak' });
    rows.set('private_config', { id: '4', key: 'private_config', value: 'must-not-leak' });
    expect(await service.siteSettings()).toEqual({ ...branding, about });
  });

  it('persists about under the logo, banners, about lock order without creating media references', async () => {
    const { service, rows, locks, bindings, policy } = fixture();
    const nextAbout = { ...about, version: '2.1.0', service_terms: null };
    const result = await service.updateSiteSettings({ logo_asset_id: '21', banners: [{ asset_id: '22', sort: 1 }], about: nextAbout } as any, actor, null);
    expect(result).toEqual({ logo_asset_id: '21', banners: [{ asset_id: '22', sort: 1 }], about: nextAbout });
    expect(rows.get('about')).toMatchObject({ value: nextAbout, updatedBy: '7' });
    expect(locks).toEqual(['logo_asset_id', 'banners', 'about']);
    expect([...bindings].sort()).toEqual(['21:1', '22:2']);
    expect(await policy.authorizeRead('7', '3')).toBe(false);
    await expect(policy.validateBinding({ getRepository: () => ({ findOne: async () => rows.get('about') }) }, {}, '3'))
      .rejects.toMatchObject({ code: 40302 });
  });

  it('preserves the stored about value and operator when an older client omits about', async () => {
    const { service, rows } = fixture();
    const result: any = await service.updateSiteSettings(branding, actor, null);
    expect(result.about).toEqual(about);
    expect(rows.get('about')).toMatchObject({ value: about, updatedBy: '5' });
    expect(await service.publicConfig()).toEqual({ ...branding, about });
  });

  it('saves about alone while preserving branding and skipping media validation', async () => {
    const { service, rows, assertedAssets, bindings, locks } = fixture();
    const nextAbout = { ...about, version: '3.0.0' };
    expect(await service.updateSiteSettings({ about: nextAbout } as any, actor, null)).toEqual({ ...branding, about: nextAbout });
    expect(rows.get('logo_asset_id')).toMatchObject({ value: '11', updatedBy: '5' });
    expect(rows.get('banners')).toMatchObject({ value: branding.banners, updatedBy: '5' });
    expect(assertedAssets).toEqual([]);
    expect([...bindings].sort()).toEqual(['11:1', '12:2']);
    expect(locks).toEqual(['logo_asset_id', 'banners', 'about']);
  });

  it('only clears explicitly supplied brand fields', async () => {
    const { service } = fixture();
    expect(await service.updateSiteSettings({ logo_asset_id: null }, actor, null)).toEqual({ logo_asset_id: null, banners: branding.banners, about });
    expect(await service.updateSiteSettings({ banners: [] }, actor, null)).toEqual({ logo_asset_id: null, banners: [], about });
  });

  it('preserves both independent card writes when updates overlap', async () => {
    const { service } = fixture();
    await Promise.all([
      service.updateSiteSettings({ logo_asset_id: '21', banners: [] }, actor, null),
      service.updateSiteSettings({ about: { ...about, version: '4.0.0' } } as any, actor, null),
    ]);
    expect(await service.publicConfig()).toEqual({ logo_asset_id: '21', banners: [], about: { ...about, version: '4.0.0' } });
  });

  it('rejects empty updates instead of clearing the stored branding', async () => {
    const { service, transactions } = fixture();
    await expect(service.updateSiteSettings({}, actor, null)).rejects.toMatchObject({ code: 40001 });
    expect(transactions()).toBe(0);
  });

  it('rejects an invalid about before the branding transaction can change state', async () => {
    const { service, rows, transactions } = fixture();
    await expect(service.updateSiteSettings({ logo_asset_id: '21', banners: [], about: { ...about, contact_phone: 'bad' } } as any, actor, null))
      .rejects.toMatchObject({ code: 40001 });
    expect(transactions()).toBe(0);
    expect(rows.get('logo_asset_id').value).toBe('11');
    expect(rows.get('about').value).toEqual(about);
  });
});
