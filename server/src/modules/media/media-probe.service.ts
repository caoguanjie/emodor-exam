import { Injectable } from '@nestjs/common';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfig } from '../../config/configuration';
import type { MediaKind } from './media-policy';
import { DEFAULT_MEDIA_IMAGE_MAX_PIXELS } from './media-policy';

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
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name:format=duration,format_name:format_tags=major_brand',
      '-of', 'json', filePath,
    ];
    const { stdout } = await this.runCommand(this.config.media?.ffprobePath || 'ffprobe', args, '视频探测');
    let parsed: any;
    try { parsed = JSON.parse(stdout); } catch { throw new Error('视频探测结果无效'); }
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
    const videoStreams = streams.filter((stream: any) => stream.codec_type === 'video');
    const audioStreams = streams.filter((stream: any) => stream.codec_type === 'audio');
    const formatNames = String(parsed?.format?.format_name || '').split(',').map((value: string) => value.trim());
    const majorBrand = String(parsed?.format?.tags?.major_brand || '').trim();
    if (!formatNames.includes('mp4') || majorBrand.startsWith('qt')) throw new Error('视频容器必须是 MP4');
    if (videoStreams.length !== 1 || videoStreams[0].codec_name !== 'h264') throw new Error('视频必须包含 H.264 视频流');
    if (audioStreams.some((stream: any) => stream.codec_name !== 'aac')) throw new Error('视频音轨仅支持 AAC');
    const duration = Number(parsed?.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('视频时长无效');
    const codecs = [...new Set<string>(streams.map((stream: any) => String(stream.codec_name || '')))];
    return { durationMs: Math.round(duration * 1000), mimeType: 'video/mp4', codecs };
  }

  private async probeImagePath(filePath: string): Promise<ImageProbeResult> {
    const maxPixels = this.config.media?.imageMaxPixels || DEFAULT_MEDIA_IMAGE_MAX_PIXELS;
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'info', '-xerror', '-abort_on', 'empty_output',
      '-max_alloc', String(64 * 1024 * 1024), '-max_pixels', String(maxPixels),
      '-protocol_whitelist', 'file,pipe', '-i', filePath,
      '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-',
    ];
    const { stderr } = await this.runCommand(this.config.media?.ffmpegPath || 'ffmpeg', args, '图片解码');
    const match = /Video:\s*([^,\s]+),[^\n]*?,\s*(\d+)x(\d+)(?:[,\s]|$)/i.exec(stderr);
    if (!match) throw new Error('图片解码未返回有效尺寸');
    const codec = match[1].toLowerCase();
    const width = Number(match[2]);
    const height = Number(match[3]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw new Error('图片尺寸无效');
    }
    if (width * height > maxPixels) throw new Error('图片像素超过上限');
    const mimeType = ({ mjpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const)[codec];
    if (!mimeType) throw new Error('图片类型不支持');
    return { mimeType, width, height };
  }

  private runCommand(command: string, args: string[], label: string): Promise<{ stdout: string; stderr: string }> {
    const timeoutMs = this.config.media?.probeTimeoutMs || 30_000;
    const maxOutputBytes = 256 * 1024;
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
        if (bytes + chunk.length > maxOutputBytes) return null;
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
        reject(error);
      });
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (stopReason) reject(stopReason);
        else if (code !== 0) reject(new Error(stderr.slice(0, 300) || `${label}进程退出 ${code}`));
        else resolve({ stdout, stderr });
      });
      timer = setTimeout(() => requestStop(new Error(`${label}超时`)), timeoutMs);
    });
  }
}
