import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import {
  DEFAULT_MEDIA_LIMITS,
  mediaKindForPurpose,
  assertMediaPurpose,
  assertPublicMediaPurpose,
  assertOwnerTypeRegistered,
  parseRange,
} from '../src/modules/media/media-policy';
import { MediaProbeService } from '../src/modules/media/media-probe.service';

describe('media policy', () => {
  it('rejects the cancelled answer attachment purpose on internal and public boundaries', () => {
    expect(() => assertMediaPurpose('answer')).toThrowError();
    expect(() => assertPublicMediaPurpose('answer')).toThrowError();
    expect(() => assertMediaPurpose('question')).not.toThrow();
  });

  it('keeps the configured upload limits bounded and reports media kinds', () => {
    expect(DEFAULT_MEDIA_LIMITS.videoMaxBytes).toBe(512 * 1024 * 1024);
    expect(DEFAULT_MEDIA_LIMITS.imageMaxBytes).toBe(10 * 1024 * 1024);
    expect(DEFAULT_MEDIA_LIMITS.probeTimeoutMs).toBe(30_000);
    expect(mediaKindForPurpose('avatar')).toBe('image');
    expect(mediaKindForPurpose('video')).toBe('video');
  });

  it('uses default deny for an owner type that has no registered authorizer', () => {
    expect(() => assertOwnerTypeRegistered(undefined, 'future_course')).toThrowError();
  });

  it('parses byte ranges without reading a media file into memory', () => {
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(() => parseRange('bytes=100-101', 100)).toThrowError();
  });
});

describe('media probe', () => {
  it('rejects a fake image with a PNG header but no decodable payload', async () => {
    const service = new MediaProbeService({ media: DEFAULT_MEDIA_LIMITS } as any);
    await expect(service.probeImage(Buffer.from('\x89PNG\r\n\x1a\n'))).rejects.toThrowError();
  });

  it('rejects JPEG data that only contains a SOF marker without a scan', async () => {
    const service = new MediaProbeService({ media: DEFAULT_MEDIA_LIMITS } as any);
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x01, 0x00, 0x01, 0xff, 0xd9]);
    await expect(service.probeImage(fakeJpeg)).rejects.toThrowError();
  });

  it('rejects a WebP container that has VP8X metadata but no image frame', async () => {
    const fakeWebp = Buffer.alloc(30);
    fakeWebp.write('RIFF', 0, 'ascii');
    fakeWebp.writeUInt32LE(22, 4);
    fakeWebp.write('WEBP', 8, 'ascii');
    fakeWebp.write('VP8X', 12, 'ascii');
    fakeWebp.writeUInt32LE(10, 16);
    const service = new MediaProbeService({ media: DEFAULT_MEDIA_LIMITS } as any);
    await expect(service.probeImage(fakeWebp)).rejects.toThrowError();
  });

  it('enforces the decoded image pixel limit before accepting a valid image', async () => {
    const chunk = (type: string, data: Buffer) => {
      const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      let crc = 0xffffffff;
      for (const byte of crcInput) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      const result = Buffer.alloc(12 + data.length);
      result.writeUInt32BE(data.length, 0);
      Buffer.from(type, 'ascii').copy(result, 4);
      data.copy(result, 8);
      result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
      return result;
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const scanline = Buffer.from([0, 255, 0, 0, 255, 255, 0, 0, 255]);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanline)), chunk('IEND', Buffer.alloc(0)),
    ]);
    const service = new MediaProbeService({
      media: { ...DEFAULT_MEDIA_LIMITS, imageMaxPixels: 1, ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg' },
    } as any);
    await expect(service.probeImage(png)).rejects.toThrowError();
  });
});
