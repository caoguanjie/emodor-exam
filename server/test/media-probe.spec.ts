import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MediaProbeService,
  MediaProbeUnavailableError,
} from '../src/modules/media/media-probe.service';

const MIB = 1024 * 1024;
const TOOL_TIMEOUT_MS = 15_000;
const TOOL_OUTPUT_MAX_BYTES = 256 * 1024;

let fixtureRoot: string;
let jpegPath: string;
let pngPath: string;
let webpPath: string;
let silentMp4Path: string;
let aacMp4Path: string;
let mp3Mp4Path: string;
let subtitleMp4Path: string;
let mpeg4Mp4Path: string;
let threeGpPath: string;
let movPath: string;
let mkvVideoPath: string;
let aviImagePath: string;
let mkvImagePath: string;
let svgPath: string;

function probeConfig(overrides: Record<string, unknown> = {}) {
  return {
    media: {
      videoMaxBytes: 512 * MIB,
      imageMaxBytes: 10 * MIB,
      imageMaxPixels: 25_000_000,
      probeTimeoutMs: 30_000,
      ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
      ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
      allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
      allowedVideoTypes: ['video/mp4'],
      ...overrides,
    },
  } as any;
}

function runFixtureTool(args: string[]): Promise<void> {
  const command = process.env.FFMPEG_PATH || 'ffmpeg';
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let stderrBytes = 0;
    let settled = false;
    let stopReason: Error | undefined;
    const requestStop = (error: Error) => {
      if (settled || stopReason) return;
      stopReason = error;
      child.kill('SIGKILL');
    };
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > TOOL_OUTPUT_MAX_BYTES) {
        requestStop(new Error('ffmpeg fixture output exceeded limit'));
        return;
      }
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(stopReason || error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stopReason) reject(stopReason);
      else if (code === 0) resolve();
      else reject(new Error(stderr.slice(0, 500) || `ffmpeg fixture exited ${code}`));
    });
    const timer = setTimeout(() => requestStop(new Error('ffmpeg fixture timed out')), TOOL_TIMEOUT_MS);
  });
}

async function makeExecutable(name: string, source: string): Promise<string> {
  const path = join(fixtureRoot, name);
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, 'utf8');
  await chmod(path, 0o755);
  return path;
}

function expectProcessExited(pid: number): void {
  try {
    process.kill(pid, 0);
  } catch (error: any) {
    expect(error?.code).toBe('ESRCH');
    return;
  }
  throw new Error(`probe child ${pid} is still running`);
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'ruleexam-media-probe-test-'));
  jpegPath = join(fixtureRoot, 'valid.jpg');
  pngPath = join(fixtureRoot, 'valid.png');
  webpPath = join(fixtureRoot, 'valid.webp');
  silentMp4Path = join(fixtureRoot, 'silent.mp4');
  aacMp4Path = join(fixtureRoot, 'aac.mp4');
  mp3Mp4Path = join(fixtureRoot, 'mp3.mp4');
  subtitleMp4Path = join(fixtureRoot, 'subtitle.mp4');
  mpeg4Mp4Path = join(fixtureRoot, 'mpeg4.mp4');
  threeGpPath = join(fixtureRoot, 'video.3gp');
  movPath = join(fixtureRoot, 'video.mov');
  mkvVideoPath = join(fixtureRoot, 'video.mkv');
  aviImagePath = join(fixtureRoot, 'image.avi');
  mkvImagePath = join(fixtureRoot, 'image.mkv');
  svgPath = join(fixtureRoot, 'image.svg');
  const subtitlePath = join(fixtureRoot, 'subtitle.srt');

  const common = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=red:s=4x2:d=0.04', '-frames:v', '1', '-threads', '1', jpegPath]);
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=green:s=4x2:d=0.04', '-frames:v', '1', '-threads', '1', pngPath]);
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=blue:s=4x2:d=0.04', '-frames:v', '1', '-c:v', 'libwebp', webpPath]);
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=black:s=32x24:r=25:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-f', 'mp4', silentMp4Path]);
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=black:s=32x24:r=25:d=0.2', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', '-f', 'mp4', aacMp4Path]);
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=black:s=32x24:r=25:d=0.2', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100:duration=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-shortest', '-movflags', '+faststart', '-f', 'mp4', mp3Mp4Path]);
  await writeFile(subtitlePath, '1\n00:00:00,000 --> 00:00:00,180\nnot allowed\n', 'utf8');
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=black:s=32x24:r=25:d=0.2', '-i', subtitlePath, '-map', '0:v:0', '-map', '1:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:s', 'mov_text', '-t', '0.2', '-movflags', '+faststart', '-f', 'mp4', subtitleMp4Path]);
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=black:s=32x24:r=25:d=0.2', '-c:v', 'mpeg4', '-an', '-f', 'mp4', mpeg4Mp4Path]);
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=black:s=32x24:r=25:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-f', '3gp', threeGpPath]);
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=black:s=32x24:r=25:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-f', 'mov', movPath]);
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=black:s=32x24:r=25:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-f', 'matroska', mkvVideoPath]);
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=yellow:s=4x2:d=0.04', '-frames:v', '1', '-c:v', 'mjpeg', '-f', 'avi', aviImagePath]);
  await runFixtureTool([...common, '-f', 'lavfi', '-i', 'color=c=yellow:s=4x2:d=0.04', '-frames:v', '1', '-c:v', 'png', '-f', 'matroska', mkvImagePath]);
  await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="4" height="2"/></svg>', 'utf8');
}, 60_000);

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

describe('media image probe', () => {
  it.each([
    ['JPEG', () => jpegPath, 'image/jpeg'],
    ['PNG', () => pngPath, 'image/png'],
    ['WebP', () => webpPath, 'image/webp'],
  ])('accepts a decoded %s image with structured dimensions', async (_label, getPath, mimeType) => {
    const service = new MediaProbeService(probeConfig());
    await expect(service.probeImage(getPath())).resolves.toEqual({ mimeType, width: 4, height: 2 });
  });

  it('accepts a real JPEG supplied as a buffer', async () => {
    const service = new MediaProbeService(probeConfig());
    await expect(service.probeImage(await readFile(jpegPath))).resolves.toEqual({
      mimeType: 'image/jpeg', width: 4, height: 2,
    });
  });

  it.each([
    ['AVI image container', () => aviImagePath],
    ['Matroska image container', () => mkvImagePath],
    ['SVG', () => svgPath],
  ])('rejects %s even when ffmpeg can inspect it', async (_label, getPath) => {
    const service = new MediaProbeService(probeConfig());
    await expect(service.probeImage(getPath())).rejects.toThrowError();
  });

  it('rejects a valid image whose decoded pixels exceed the configured limit', async () => {
    const service = new MediaProbeService(probeConfig({ imageMaxPixels: 7 }));
    await expect(service.probeImage(pngPath)).rejects.toThrowError('图片像素超过上限');
  });

  it('rejects metadata-only JPEG and WebP inputs without a decoded frame', async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x01, 0x00, 0x01, 0xff, 0xd9]);
    const fakeWebp = Buffer.alloc(30);
    fakeWebp.write('RIFF', 0, 'ascii');
    fakeWebp.writeUInt32LE(22, 4);
    fakeWebp.write('WEBP', 8, 'ascii');
    fakeWebp.write('VP8X', 12, 'ascii');
    fakeWebp.writeUInt32LE(10, 16);
    const service = new MediaProbeService(probeConfig());
    await expect(service.probeImage(fakeJpeg)).rejects.toThrowError();
    await expect(service.probeImage(fakeWebp)).rejects.toThrowError();
  });
});

describe('media video probe', () => {
  it('accepts H.264 MP4 without an audio track', async () => {
    const service = new MediaProbeService(probeConfig());
    const result = await service.probeVideo(silentMp4Path);
    expect(result.mimeType).toBe('video/mp4');
    expect(result.codecs).toEqual(['h264']);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('accepts H.264/AAC MP4', async () => {
    const service = new MediaProbeService(probeConfig());
    const result = await service.probeVideo(aacMp4Path);
    expect(result.codecs).toEqual(['h264', 'aac']);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it.each([
    ['3GP', () => threeGpPath],
    ['QuickTime MOV', () => movPath],
    ['Matroska', () => mkvVideoPath],
  ])('rejects an actual %s container', async (_label, getPath) => {
    const service = new MediaProbeService(probeConfig());
    await expect(service.probeVideo(getPath())).rejects.toThrowError();
  });

  it('rejects an MP4 whose video codec is not H.264', async () => {
    const service = new MediaProbeService(probeConfig());
    await expect(service.probeVideo(mpeg4Mp4Path)).rejects.toThrowError('视频必须包含 H.264 视频流');
  });

  it('rejects a non-AAC audio codec in an otherwise valid H.264 MP4', async () => {
    const service = new MediaProbeService(probeConfig());
    await expect(service.probeVideo(mp3Mp4Path)).rejects.toThrowError();
  });

  it('rejects subtitle and other non-audio/video tracks', async () => {
    const service = new MediaProbeService(probeConfig());
    await expect(service.probeVideo(subtitleMp4Path)).rejects.toThrowError();
  });
});

describe('media probe process bounds', () => {
  it('reports missing and non-executable tools as a stable availability error without a private path', async () => {
    const missingPath = join(fixtureRoot, 'missing-ffprobe-private-name');
    const nonExecutablePath = join(fixtureRoot, 'non-executable-ffprobe-private-name');
    await writeFile(nonExecutablePath, '#!/bin/sh\nexit 0\n', { mode: 0o600 });

    for (const ffprobePath of [missingPath, nonExecutablePath]) {
      const service = new MediaProbeService(probeConfig({ ffprobePath }));
      let caught: unknown;
      try {
        await service.probeVideo(silentMp4Path);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MediaProbeUnavailableError);
      expect((caught as Error).message).toBe('媒体探测工具不可用');
      expect((caught as Error).message).not.toContain(ffprobePath);
    }

    const missingFfmpegPath = join(fixtureRoot, 'missing-ffmpeg-private-name');
    const imageService = new MediaProbeService(probeConfig({ ffmpegPath: missingFfmpegPath }));
    let imageError: unknown;
    try {
      await imageService.probeImage(pngPath);
    } catch (error) {
      imageError = error;
    }
    expect(imageError).toBeInstanceOf(MediaProbeUnavailableError);
    expect((imageError as Error).message).toBe('媒体探测工具不可用');
    expect((imageError as Error).message).not.toContain(missingFfmpegPath);
  });

  it('waits for a timed-out decode child to exit before deleting its temporary input', async () => {
    const recordPath = join(fixtureRoot, 'timeout-child.json');
    const executable = await makeExecutable('timeout-ffmpeg.cjs', `
      const fs = require('node:fs');
      const inputIndex = process.argv.indexOf('-i');
      fs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ pid: process.pid, input: process.argv[inputIndex + 1] }));
      setInterval(() => {}, 1000);
    `);
    const service = new MediaProbeService(probeConfig({ ffmpegPath: executable, probeTimeoutMs: 1_000 }));

    await expect(service.probeImage(await readFile(pngPath))).rejects.toThrowError('图片解码超时');
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as { pid: number; input: string };
    expectProcessExited(record.pid);
    await expect(stat(record.input)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('kills an output-flooding probe and rejects only after the child exits', async () => {
    const pidPath = join(fixtureRoot, 'output-child.pid');
    const executable = await makeExecutable('output-ffprobe.cjs', `
      const fs = require('node:fs');
      fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
      process.stdout.write(Buffer.alloc(300 * 1024, 65));
      setInterval(() => {}, 1000);
    `);
    const service = new MediaProbeService(probeConfig({ ffprobePath: executable, probeTimeoutMs: 2_000 }));

    await expect(service.probeVideo(silentMp4Path)).rejects.toThrowError('视频探测输出超过上限');
    expectProcessExited(Number(await readFile(pidPath, 'utf8')));
  });
});
