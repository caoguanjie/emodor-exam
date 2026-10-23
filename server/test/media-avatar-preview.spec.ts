import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaService } from '../src/modules/media/media.service';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixture(overrides: Record<string, unknown> = {}, root = '.') {
  const asset = {
    id: '14', ownerId: '20', uploadedBy: '1', purpose: 'avatar', mediaKind: 'image',
    status: 'ready', storageKey: 'avatar.png', originalName: 'photo.png', mimeType: 'image/png',
    sizeBytes: '3', sha256: 'fixture', durationMs: null, probeError: null,
    createdAt: new Date(), ...overrides,
  };
  let authorized = true;
  const media = new MediaService(
    { findOne: async () => asset } as any,
    { find: async () => [] } as any,
    {} as any,
    { upload: { dir: root } } as any,
    {} as any,
  );
  media.registerOwnerPolicy('user_avatar', {
    allowedPurposes: ['avatar'],
    authorizeRead: (actor, owner, assetId) => authorized && actor === '1' && owner === '20' && assetId === '14',
  });
  return { media, revoke: () => { authorized = false; } };
}

describe('unbound managed-student avatar preview', () => {
  it('lets the authorized delegate read metadata before saving the avatar binding', async () => {
    const { media, revoke } = fixture();
    await expect(media.metadata('1', '14')).resolves.toMatchObject({ asset_id: '14', status: 'ready' });
    revoke();
    await expect(media.metadata('1', '14')).rejects.toMatchObject({ code: 40302 });
  });

  it('lets the same authorized delegate preview the uploaded content before binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-avatar-preview-'));
    roots.push(root);
    await writeFile(join(root, 'avatar.png'), Buffer.from('png'));
    const { media } = fixture({}, root);
    await expect(media.openContent('1', '14')).resolves.toMatchObject({ size: 3, range: null });
  });

  it('does not give other administrators access to an unbound upload', async () => {
    const { media } = fixture({ uploadedBy: '2' });
    await expect(media.metadata('1', '14')).rejects.toMatchObject({ code: 40302 });
  });

  it.each(['video', 'identity_face', 'question', 'course_cover', 'branding'])(
    'does not grant uploader preview access for %s', async (purpose) => {
      const { media } = fixture({ purpose });
      await expect(media.metadata('1', '14')).rejects.toMatchObject({ code: 40302 });
    },
  );

  it('denies unbound avatars without an applicable registered business policy', async () => {
    const { media } = fixture();
    media.registerOwnerPolicy('user_avatar', { allowedPurposes: ['question'], authorizeRead: () => true });
    await expect(media.metadata('1', '14')).rejects.toMatchObject({ code: 40302 });
  });
});
