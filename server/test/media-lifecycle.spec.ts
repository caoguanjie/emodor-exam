import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_MEDIA_LIMITS, assertPublicMediaPurpose } from '../src/modules/media/media-policy';
import { MediaAsset } from '../src/entities/media-asset.entity';
import { MediaReference } from '../src/entities/media-reference.entity';
import { MediaService } from '../src/modules/media/media.service';
import { MediaProbeUnavailableError } from '../src/modules/media/media-probe.service';

const roots: string[] = [];

function serviceFor(root: string, probe: unknown = { probe: async () => ({ mimeType: 'image/png', width: 1, height: 1 }) }) {
  const assetRepo: any = {
    create: (value: any) => ({ ...value, id: '99', createdAt: new Date(), updatedAt: new Date() }),
    save: async (value: any) => value,
  };
  const referenceRepo: any = { find: async () => [] };
  const config: any = { upload: { dir: root }, media: DEFAULT_MEDIA_LIMITS };
  return new MediaService(assetRepo, referenceRepo, {} as any, config, probe as any);
}

function managerFor(asset: any) {
  const inserted: any[] = [];
  const refs: any = {
    findOne: async () => null,
    insert: async (value: any) => { inserted.push(value); },
  };
  const manager: any = {
    getRepository(entity: unknown) {
      if (entity === MediaAsset) return { findOne: async () => asset };
      if (entity === MediaReference) return refs;
      throw new Error('unexpected repository');
    },
  };
  return { manager, inserted };
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

describe('media lifecycle contracts', () => {
  it('validates a usable asset through the caller transaction manager when supplied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-lifecycle-'));
    roots.push(root);
    const asset = { id: '99', ownerId: '7', purpose: 'question', mediaKind: 'image', status: 'ready' };
    const globalFindOne = vi.fn().mockResolvedValue(asset);
    const managerFindOne = vi.fn().mockResolvedValue(asset);
    const media = new MediaService(
      { findOne: globalFindOne } as any,
      { find: async () => [] } as any,
      {} as any,
      { upload: { dir: root }, media: DEFAULT_MEDIA_LIMITS } as any,
      {} as any,
    );
    const manager = {
      getRepository(entity: unknown) {
        if (entity !== MediaAsset) throw new Error('unexpected repository');
        return { findOne: managerFindOne };
      },
    } as any;

    await (media.assertUsable as any)('7', '99', 'question', undefined, manager);

    expect(managerFindOne).toHaveBeenCalledWith({ where: { id: '99' } });
    expect(globalFindOne).not.toHaveBeenCalled();
  });

  it('keeps answer upload internal while rejecting the generic public purpose', async () => {
    expect(() => assertPublicMediaPurpose('answer')).toThrowError();
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-lifecycle-'));
    roots.push(root);
    const media = serviceFor(root);
    const result = await media.uploadAnswer('7', {
      buffer: Buffer.from('answer fixture'),
      originalname: 'answer.bin',
      mimetype: 'application/octet-stream',
    } as any);
    expect(result.status).toBe('ready');
    expect(result.assetId).toBe('99');
    const tempEntries = await readdir(join(root, 'tmp', 'media'));
    expect(tempEntries).toEqual([]);
    const storedEntries = await readdir(join(root, 'media', new Date().toISOString().slice(0, 10)));
    expect(storedEntries).toHaveLength(1);
  });

  it('binds a registered business reference without assuming business id equals asset owner id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-lifecycle-'));
    roots.push(root);
    const media = serviceFor(root);
    media.registerOwnerPolicy('answer_attempt', {
      allowedPurposes: ['answer'],
      authorizeRead: () => true,
    });
    const asset = { id: '99', ownerId: '7', purpose: 'answer', mediaKind: 'image', status: 'ready' };
    const { manager, inserted } = managerFor(asset);
    await media.bind(manager, '99', 'answer_attempt', 'attempt-123');
    expect(inserted).toEqual([{ assetId: '99', ownerType: 'answer_attempt', ownerId: 'attempt-123' }]);
  });

  it('lets the final owner policy reject a video masquerading as an avatar', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-lifecycle-'));
    roots.push(root);
    const media = serviceFor(root);
    media.registerOwnerPolicy('user_avatar', {
      allowedPurposes: ['avatar'],
      authorizeRead: () => true,
      validateBinding: (_manager, asset) => {
        if (asset.mediaKind !== 'image') throw new Error('avatar must be image');
      },
    });
    const { manager } = managerFor({ id: '99', ownerId: '7', purpose: 'avatar', mediaKind: 'video', status: 'ready' });
    await expect(media.bind(manager, '99', 'user_avatar', '7')).rejects.toThrowError('avatar must be image');
  });

  it('passes the exact asset id to owner authorization while preserving two-argument policies', async () => {
    const authorizeRead = vi.fn(async (actorId: string, businessId: string) => (
      actorId === '8' && businessId === '701'
    ));
    const referenceRepo: any = {
      find: vi.fn(async () => [{ assetId: '99', ownerType: 'question_version', ownerId: '701' }]),
    };
    const media = new MediaService(
      {} as any,
      referenceRepo,
      {} as any,
      { media: DEFAULT_MEDIA_LIMITS } as any,
      {} as any,
    );
    media.registerOwnerPolicy('question_version', {
      allowedPurposes: ['question'],
      authorizeRead,
    });

    const allowed = await (media as any).canRead('8', {
      id: '99', ownerId: '7', purpose: 'question', mediaKind: 'image', status: 'ready',
    });

    expect(allowed).toBe(true);
    expect(authorizeRead).toHaveBeenCalledWith('8', '701', '99');
  });

  it('maps an unavailable probe tool to the stable 50004 service error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-lifecycle-'));
    roots.push(root);
    const media = serviceFor(root, { probe: async () => { throw new MediaProbeUnavailableError(); } });
    await expect(media.upload('7', 'avatar', {
      buffer: Buffer.from('probe tool fixture'),
      originalname: 'avatar.bin',
      mimetype: 'application/octet-stream',
    } as any)).rejects.toMatchObject({ code: 50004, httpStatus: 503, message: '媒体探测工具不可用' });
  });
});
