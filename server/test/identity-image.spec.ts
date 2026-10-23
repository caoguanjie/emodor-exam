import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { sanitizeIdentityImage } from '../src/modules/identity/identity-image.service';
describe('identity image sanitation', () => {
  it('decodes JPEG/PNG, removes metadata, corrects orientation and bounds the final provider image', async () => {
    const source = await sharp({ create: { width: 1800, height: 1000, channels: 3, background: '#2864aa' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const output = await sanitizeIdentityImage(source, 'face');
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe('jpeg'); expect(meta.width).toBeLessThanOrEqual(1600); expect(meta.height).toBeLessThanOrEqual(1600);
    expect(meta.orientation).toBeUndefined(); expect(meta.exif).toBeUndefined(); expect(output.toString('base64').length).toBeLessThanOrEqual(2_800_000);
  });
  it('rejects small, forged, oversized or unsupported image bytes regardless of the declared name', async () => {
    const small = await sharp({ create: { width: 319, height: 500, channels: 3, background: '#2864aa' } }).png().toBuffer();
    await expect(sanitizeIdentityImage(small, 'face')).rejects.toMatchObject({ code: 42201 });
    await expect(sanitizeIdentityImage(Buffer.from('JPEG'), 'face')).rejects.toMatchObject({ code: 42201 });
    await expect(sanitizeIdentityImage(Buffer.alloc(10 * 1024 * 1024 + 1), 'face')).rejects.toMatchObject({ code: 42202 });
    const webp = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#2864aa' } }).webp().toBuffer();
    await expect(sanitizeIdentityImage(webp, 'face')).rejects.toMatchObject({ code: 42201 });
  });
  it('bounds source pixels before decoding document data', async () => {
    const large = await sharp({ create: { width: 5000, height: 4100, channels: 3, background: '#2864aa' } }).png().toBuffer();
    await expect(sanitizeIdentityImage(large, 'id_card_portrait')).rejects.toMatchObject({ code: 42201 });
    await expect(sanitizeIdentityImage(large, 'face')).resolves.toBeInstanceOf(Buffer);
  });
});
