import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { MediaTicketService } from '../src/modules/media/media-ticket.service';
import { assertMediaPurpose, assertPublicMediaPurpose } from '../src/modules/media/media-policy';
import { MediaService } from '../src/modules/media/media.service';
import { MediaAsset } from '../src/entities/media-asset.entity';
import { MediaReference } from '../src/entities/media-reference.entity';
import { IdentityVerificationSession } from '../src/entities/identity-verification-session.entity';
import { SysUser } from '../src/entities/sys-user.entity';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('short lived media tickets', () => {
  afterEach(() => vi.useRealTimers());
  function fixture() {
    const asset = { id: '41', ownerId: '7', purpose: 'identity_id_portrait', status: 'ready' };
    const media = { authorizeTicket: vi.fn(async (user, assetId, type, owner) => {
      if (user !== '7' || assetId !== '41' || type !== 'identity_verification_user' || owner !== '7') throw new Error('denied');
      return asset;
    }), openTicketContent: vi.fn(async (claims, range) => ({ asset, range, size: 100 })) };
    const service = new MediaTicketService(media as any, { mediaTicket: { secret: randomBytes(32).toString('base64'), ttlSeconds: 300 } } as any);
    return { service, media, asset };
  }
  it('keeps identity purposes private to the dedicated upload path', () => {
    for (const purpose of ['identity_id_portrait', 'identity_id_emblem', 'identity_face']) {
      expect(() => assertMediaPurpose(purpose)).not.toThrow();
      expect(() => assertPublicMediaPurpose(purpose)).toThrow();
    }
  });
  it('issues a relative content URL without a JWT or private path and binds all owner claims', async () => {
    const { service } = fixture();
    const result = await service.issue('7', '41', 'identity_verification_user', '7');
    expect(result.content_url).toMatch(/^\/api\/v1\/media\/tickets\/[^/]+\/content$/);
    const ticket = result.content_url.split('/')[5];
    expect(service.verify(ticket)).toMatchObject({ v: 1, asset: '41', user: '7', purpose: 'identity_id_portrait', ownerType: 'identity_verification_user', ownerId: '7' });
    expect(result.content_url).not.toMatch(/access_token|refresh|uploads|Bearer|eyJhbGci/);
    await expect(service.issue('8', '41', 'identity_verification_user', '7')).rejects.toThrow();
    await expect(service.issue('7', '41', 'unknown', '7')).rejects.toThrow();
  });
  it('rejects changed signature and expired tickets and forwards Range for authorized content', async () => {
    vi.useFakeTimers();
    const { service, media } = fixture();
    const { content_url } = await service.issue('7', '41', 'identity_verification_user', '7');
    const ticket = content_url.split('/')[5];
    expect(() => service.verify(ticket.slice(0, -2) + 'XX')).toThrow();
    await service.open(ticket, 'bytes=10-19');
    expect(media.openTicketContent).toHaveBeenCalledWith(expect.objectContaining({ user: '7', asset: '41' }), 'bytes=10-19');
    await vi.advanceTimersByTimeAsync(300_000);
    expect(() => service.verify(ticket)).toThrow();
  });
  it('checks the exact reference and current policy again on content reads, including Range', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-ticket-'));
    try {
      await writeFile(join(root, 'synthetic.mp4'), Buffer.alloc(100));
      const asset: any = { id: '41', ownerId: '7', purpose: 'video', status: 'ready', storageKey: 'synthetic.mp4' };
      let bound = true; let authorized = true;
      const media = new MediaService({ findOne: async () => asset } as any, { findOne: async ({ where }) => bound && where.assetId === '41' && where.ownerType === 'lesson_version_video' && where.ownerId === '21' ? {} : null } as any, { getRepository: () => ({ findOne: async () => ({ id: '7', status: 1 }) }) } as any, { upload: { dir: root } } as any, {} as any);
      media.registerOwnerPolicy('lesson_version_video', { allowedPurposes: ['video'], authorizeRead: () => authorized, authorizeTicket: () => authorized });
      const tickets = new MediaTicketService(media, { mediaTicket: { secret: randomBytes(32).toString('base64'), ttlSeconds: 300 } } as any);
      const issued = await tickets.issue('7', '41', 'lesson_version_video', '21'); const token = issued.content_url.split('/')[5];
      expect(await tickets.open(token, 'bytes=10-19')).toMatchObject({ size: 100, range: { start: 10, end: 19 } });
      await expect(tickets.issue('7', '41', 'lesson_version_video', '22')).rejects.toMatchObject({ code: 40302 });
      bound = false; await expect(tickets.open(token)).rejects.toMatchObject({ code: 40302 });
      bound = true; authorized = false; await expect(tickets.open(token)).rejects.toMatchObject({ code: 40302 });
      authorized = true; asset.status = 'deleting'; await expect(tickets.open(token)).rejects.toMatchObject({ code: 40401 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each([
    ['identity_id_portrait', 'identity_verification_user'], ['avatar', 'user_avatar'], ['course_cover', 'training_course_cover'], ['video', 'lesson_version_video'],
  ])('denies old %s content tickets after account disablement or deletion', async (purpose, ownerType) => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-ticket-account-'));
    try {
      await writeFile(join(root, 'synthetic'), Buffer.alloc(32));
      let user: any = { id: '7', status: 1 };
      const asset = { id: '41', purpose, status: 'ready', storageKey: 'synthetic' };
      const media = new MediaService({ findOne: async () => asset } as any, { findOne: async () => ({ assetId: '41', ownerType, ownerId: '7' }) } as any,
        { getRepository: (type) => { expect(type).toBe(SysUser); return { findOne: async ({ where }) => { expect(where.id).toBe('7'); return user; } }; } } as any, { upload: { dir: root } } as any, {} as any);
      media.registerOwnerPolicy(ownerType, { allowedPurposes: [purpose as any], authorizeRead: () => true, authorizeTicket: () => true });
      const tickets = new MediaTicketService(media, { mediaTicket: { secret: randomBytes(32).toString('base64'), ttlSeconds: 300 } } as any);
      const url = await tickets.issue('7', '41', ownerType, '7'); const token = url.content_url.split('/')[5];
      expect(await tickets.open(token)).toMatchObject({ size: 32 });
      user.status = 0; await expect(tickets.open(token)).rejects.toMatchObject({ code: 40302 });
      user = null; await expect(tickets.open(token)).rejects.toMatchObject({ code: 40302 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('releases only unused identity material and preserves session-bound assets', async () => {
    let used = true; let reference = true; let deleted = false;
    const asset: any = { id: '41', ownerId: '7', uploadedBy: '7', purpose: 'identity_face', status: 'ready', storageKey: 'synthetic.jpg' };
    const refs = { findOne: async () => reference ? {} : null, count: async () => reference ? 1 : 0, delete: async () => { reference = false; } };
    const manager: any = { getRepository: (entity) => {
      if (entity === SysUser) return { findOne: async () => ({ id: '7' }) };
      if (entity === MediaAsset) return { findOne: async () => deleted ? null : asset, save: async (value) => value, delete: async () => { deleted = true; } };
      if (entity === MediaReference) return refs;
      if (entity === IdentityVerificationSession) return { createQueryBuilder: () => { const b: any = { where: () => b, andWhere: () => b, getCount: async () => used ? 1 : 0 }; return b; } };
      throw new Error('unexpected repo');
    } };
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-identity-release-'));
    try {
      const media = new MediaService({} as any, refs as any, { transaction: async (work) => work(manager) } as any, { upload: { dir: root } } as any, {} as any);
      await expect(media.releaseIdentityImage('7', '41')).rejects.toMatchObject({ code: 40913 });
      expect(reference).toBe(true); expect(deleted).toBe(false);
      used = false; await media.releaseIdentityImage('7', '41');
      expect(deleted).toBe(true); expect(reference).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('uses learner-only ticket policy on both signing and reading while preserving ordinary Bearer policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-video-ticket-policy-'));
    try {
      await writeFile(join(root, 'synthetic.mp4'), Buffer.alloc(32));
      let learnerAllowed = false;
      const asset: any = { id: '41', ownerId: '7', purpose: 'video', status: 'ready', storageKey: 'synthetic.mp4' };
      const refs: any = { findOne: async () => ({ assetId: '41', ownerType: 'lesson_version_video', ownerId: '21' }), find: async () => [{ ownerType: 'lesson_version_video', ownerId: '21' }] };
      const media = new MediaService({ findOne: async () => asset } as any, refs, { getRepository: () => ({ findOne: async () => ({ id: '7', status: 1 }) }) } as any, { upload: { dir: root } } as any, {} as any);
      media.registerOwnerPolicy('lesson_version_video', { allowedPurposes: ['video'], authorizeRead: () => true, authorizeTicket: () => learnerAllowed } as any);
      const tickets = new MediaTicketService(media, { mediaTicket: { secret: randomBytes(32).toString('base64'), ttlSeconds: 300 } } as any);
      expect((await media.openContent('7', '41')).size).toBe(32);
      await expect(tickets.issue('7', '41', 'lesson_version_video', '21')).rejects.toMatchObject({ code: 40302 });
      learnerAllowed = true;
      const issued = await tickets.issue('7', '41', 'lesson_version_video', '21');
      learnerAllowed = false;
      await expect(tickets.open(issued.content_url.split('/')[5])).rejects.toMatchObject({ code: 40302 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('does not authorize video content from uploader ownership without a valid lesson-version policy', async () => {
    const asset: any = { id: '41', ownerId: '7', purpose: 'video', status: 'ready' };
    const refs = { find: async () => [] };
    const media = new MediaService({ findOne: async () => asset } as any, refs as any, {} as any, {} as any, {} as any);
    await expect(media.metadata('7', '41')).rejects.toMatchObject({ code: 40302 });
  });
  it('maintenance deletes 24-hour unused identity uploads while keeping recent, active and bound material', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000); const recent = new Date();
    const assets = new Map(['unused', 'active', 'bound', 'recent'].map((label, index) => [String(index + 1), { id: String(index + 1), ownerId: '7', uploadedBy: '7', purpose: 'identity_face', status: 'ready', storageKey: `synthetic-${index}.jpg`, createdAt: label === 'recent' ? recent : old }]));
    const references = new Set(assets.keys()); const sessionAssets = new Set(['2', '3']);
    const assetRepo: any = { createQueryBuilder: () => { let cutoff: Date; const builder: any = { where: () => builder, andWhere: (_sql, params) => { cutoff = params.cutoff; return builder; }, getMany: async () => [...assets.values()].filter((asset) => asset.createdAt < cutoff) }; return builder; } };
    const manager: any = { getRepository: (entity) => {
      if (entity === SysUser) return { findOne: async () => ({ id: '7' }) };
      if (entity === MediaAsset) return { findOne: async ({ where }) => assets.get(where.id) || null, save: async (value) => value, delete: async ({ id }) => assets.delete(id) };
      if (entity === MediaReference) return { findOne: async ({ where }) => references.has(where.assetId) ? {} : null, count: async ({ where }) => references.has(where.assetId) ? 1 : 0, delete: async ({ assetId }) => references.delete(assetId) };
      if (entity === IdentityVerificationSession) return { createQueryBuilder: () => { let id; const builder: any = { where: () => builder, andWhere: (_sql, params) => { id = params.assetId; return builder; }, getCount: async () => sessionAssets.has(id) ? 1 : 0 }; return builder; } };
      throw new Error('unexpected repository');
    } };
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-identity-maintenance-'));
    try {
      const media = new MediaService(assetRepo, {} as any, { transaction: async (work) => work(manager) } as any, { upload: { dir: root } } as any, {} as any);
      expect(await media.cleanupTemporaryIdentityImages()).toBe(1);
      expect([...assets.keys()]).toEqual(['2', '3', '4']);
      expect([...references]).toEqual(['2', '3', '4']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
