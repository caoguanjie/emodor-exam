import { Injectable } from '@nestjs/common';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfig } from '../../config/configuration';
import type { MediaKind } from './media-policy';
import { DEFAULT_MEDIA_IMAGE_MAX_PIXELS } from './media-policy';

const MIB = 1024 * 1024;
const COMMAND_OUTPUT_MAX_BYTES = 256 * 1024;
const PROBE_MAX_ALLOC_BYTES = 64 * MIB;
const ABSOLUTE_MAX_DECODE_PIXELS = 100_000_000;
const IMAGE_FORMATS = {
  jpeg_pipe: { codec: 'mjpeg', mimeType: 'image/jpeg' },
  png_pipe: { codec: 'png', mimeType: 'image/png' },
  webp_pipe: { codec: 'webp', mimeType: 'image/webp' },
} as const;
const MP4_MAJOR_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6',
  'avc1', 'mp41', 'mp42', 'm4v', 'dash', 'cmfc', 'cmfs',
]);

export class MediaProbeUnavailableError extends Error {
  constructor() {
    super('媒体探测工具不可用');
    this.name = 'MediaProbeUnavailableError';
  }
}

export interface ImageProbeResult {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
}

export interface VideoProbeResult {
  durationMs: number;
  mimeType: 'video/mp4';
  codecs: string[];
}

@Injectable()
export class MediaProbeService {
  constructor(private readonly config: AppConfig) {}

  async probeImage(input: Buffer | string): Promise<ImageProbeResult> {
    const maxBytes = this.config.media?.imageMaxBytes || 10 * 1024 * 1024;
    if (Buffer.isBuffer(input)) {
      if (input.length > maxBytes) throw new Error('图片超过大小上限');
      const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-image-'));
      const path = join(root, 'input');
      try {
        await writeFile(path, input);
        return await this.probeImagePath(path);
      } finally {
        // probeImagePath only resolves after the child close event, so this
        // cannot remove a file still being read by ffmpeg.
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    const fileStat = await stat(input);
    if (fileStat.size > maxBytes) throw new Error('图片超过大小上限');
    return this.probeImagePath(input);
  }

  async probe(filePath: string, kind: MediaKind): Promise<ImageProbeResult | VideoProbeResult> {
    if (kind === 'image') return this.probeImage(filePath);
    return this.probeVideo(filePath);
  }

  async probeVideo(filePath: string): Promise<VideoProbeResult> {
    const maxBytes = this.config.media?.videoMaxBytes || 512 * MIB;
    const fileStat = await stat(filePath);
    if (fileStat.size > maxBytes) throw new Error('视频超过大小上限');
    const args = [
      '-v', 'error',
      '-max_alloc', String(PROBE_MAX_ALLOC_BYTES),
      '-max_pixels', String(ABSOLUTE_MAX_DECODE_PIXELS),
      '-protocol_whitelist', 'file,pipe',
      '-format_whitelist', 'mov',
      '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,format_name:format_tags=major_brand',
      '-of', 'json', '-i', filePath,
    ];
    const { stdout } = await this.runCommand(this.config.media?.ffprobePath || 'ffprobe', args, '视频探测');
    const parsed = this.parseProbeJson(stdout, '视频探测');
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
    const videoStreams = streams.filter((stream: any) => stream.codec_type === 'video');
    const audioStreams = streams.filter((stream: any) => stream.codec_type === 'audio');
    const otherStreams = streams.filter((stream: any) => stream.codec_type !== 'video' && stream.codec_type !== 'audio');
    const majorBrand = String(parsed?.format?.tags?.major_brand || '').trim().toLowerCase();
    if (!MP4_MAJOR_BRANDS.has(majorBrand)) throw new Error('视频容器必须是 MP4');
    if (videoStreams.length !== 1 || videoStreams[0].codec_name !== 'h264') throw new Error('视频必须包含 H.264 视频流');
    if (audioStreams.length > 1 || audioStreams.some((stream: any) => stream.codec_name !== 'aac')) {
      throw new Error('视频音轨仅支持单个 AAC');
    }
    if (otherStreams.length > 0) throw new Error('视频包含不支持的轨道');
    const width = Number(videoStreams[0].width);
    const height = Number(videoStreams[0].height);
    if (!this.isValidDimension(width, height) || width > Math.floor(ABSOLUTE_MAX_DECODE_PIXELS / height)) {
      throw new Error('视频尺寸无效');
    }
    const duration = Number(parsed?.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('视频时长无效');
    await this.decodeFirstVideoFrame(filePath, 'mov', '视频解码', width * height);
    const codecs = [...new Set<string>(streams.map((stream: any) => String(stream.codec_name || '')))];
    return { durationMs: Math.round(duration * 1000), mimeType: 'video/mp4', codecs };
  }

  private async probeImagePath(filePath: string): Promise<ImageProbeResult> {
    const maxPixels = this.config.media?.imageMaxPixels || DEFAULT_MEDIA_IMAGE_MAX_PIXELS;
    const probeArgs = [
      '-v', 'error',
      '-max_alloc', String(PROBE_MAX_ALLOC_BYTES),
      '-max_pixels', String(ABSOLUTE_MAX_DECODE_PIXELS),
      '-protocol_whitelist', 'file,pipe',
      '-format_whitelist', Object.keys(IMAGE_FORMATS).join(','),
      '-show_entries', 'stream=codec_type,codec_name,width,height:format=format_name',
      '-of', 'json', '-i', filePath,
    ];
    const { stdout } = await this.runCommand(this.config.media?.ffprobePath || 'ffprobe', probeArgs, '图片探测');
    const parsed = this.parseProbeJson(stdout, '图片探测');
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
    const formatName = String(parsed?.format?.format_name || '').trim() as keyof typeof IMAGE_FORMATS;
    const format = IMAGE_FORMATS[formatName];
    if (!format || streams.length !== 1 || streams[0]?.codec_type !== 'video' || streams[0]?.codec_name !== format.codec) {
      throw new Error('图片类型不支持');
    }
    const width = Number(streams[0].width);
    const height = Number(streams[0].height);
    if (!this.isValidDimension(width, height)) {
      throw new Error('图片尺寸无效');
    }
    if (width > Math.floor(maxPixels / height)) throw new Error('图片像素超过上限');
    // FFmpeg accounts for aligned decoder strides (for example a 4 px PNG may
    // allocate a 16 px row), so keep the configured pixel ceiling here after
    // enforcing the exact width*height limit above.
    await this.decodeFirstVideoFrame(filePath, formatName, '图片解码', maxPixels);
    return { mimeType: format.mimeType, width, height };
  }

  private parseProbeJson(stdout: string, label: string): any {
    try {
      const parsed = JSON.parse(stdout);
      if (!parsed || typeof parsed !== 'object') throw new Error();
      return parsed;
    } catch {
      throw new Error(`${label}结果无效`);
    }
  }

  private isValidDimension(width: number, height: number): boolean {
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0;
  }

  private async decodeFirstVideoFrame(
    filePath: string,
    inputFormat: string,
    label: string,
    maxPixels = ABSOLUTE_MAX_DECODE_PIXELS,
  ): Promise<void> {
    const maxAllocBytes = Math.min(512 * MIB, Math.max(64 * MIB, maxPixels * 4 + 16 * MIB));
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-xerror', '-abort_on', 'empty_output',
      '-max_alloc', String(maxAllocBytes), '-max_pixels', String(maxPixels),
      '-threads', '1', '-protocol_whitelist', 'file,pipe', '-format_whitelist', inputFormat,
      '-i', filePath, '-map', '0:v:0', '-frames:v', '1', '-an', '-sn', '-dn',
      '-f', 'null', 'pipe:1',
    ];
    await this.runCommand(this.config.media?.ffmpegPath || 'ffmpeg', args, label);
  }

  private runCommand(command: string, args: string[], label: string): Promise<{ stdout: string; stderr: string }> {
    const timeoutMs = this.config.media?.probeTimeoutMs || 30_000;
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let stopReason: Error | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const requestStop = (reason: Error) => {
        if (settled || stopReason) return;
        stopReason = reason;
        child.kill('SIGKILL');
      };
      const append = (current: string, bytes: number, chunk: Buffer): { value: string; bytes: number } | null => {
        if (bytes + chunk.length > COMMAND_OUTPUT_MAX_BYTES) return null;
        return { value: `${current}${chunk.toString('utf8')}`, bytes: bytes + chunk.length };
      };
      child.stdout.on('data', (chunk: Buffer) => {
        if (settled || stopReason) return;
        const next = append(stdout, stdoutBytes, chunk);
        if (!next) {
          requestStop(new Error(`${label}输出超过上限`));
          return;
        }
        stdout = next.value;
        stdoutBytes = next.bytes;
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (settled || stopReason) return;
        const next = append(stderr, stderrBytes, chunk);
        if (!next) {
          requestStop(new Error(`${label}输出超过上限`));
          return;
        }
        stderr = next.value;
        stderrBytes = next.bytes;
      });
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(stopReason || new MediaProbeUnavailableError());
      });
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (stopReason) reject(stopReason);
        else if (code !== 0) reject(new Error(`${label}失败`));
        else resolve({ stdout, stderr });
      });
      timer = setTimeout(() => requestStop(new Error(`${label}超时`)), timeoutMs);
    });
  }
}
