#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const MIB = 1024 * 1024;
const TOOL_TIMEOUT_MS = 5_000;
const TOOL_OUTPUT_MAX_BYTES = 64 * 1024;
const MEDIA_LIMITS = {
  MEDIA_VIDEO_MAX_BYTES: { fallback: 512 * MIB, min: 1, max: 512 * MIB },
  MEDIA_IMAGE_MAX_BYTES: { fallback: 10 * MIB, min: 1, max: 100 * MIB },
  MEDIA_IMAGE_MAX_PIXELS: { fallback: 25_000_000, min: 1, max: 100_000_000 },
  MEDIA_PROBE_TIMEOUT_MS: { fallback: 30_000, min: 1_000, max: 120_000 },
};

function readStrictInteger(name) {
  const definition = MEDIA_LIMITS[name];
  const raw = process.env[name];
  if (raw === undefined) return definition.fallback;
  if (!/^(0|[1-9]\d*)$/.test(raw)) throw new Error(`${name} 必须是整数`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < definition.min || value > definition.max) {
    throw new Error(`${name} 超出支持范围`);
  }
  return value;
}

function parseNginxBodySize(source) {
  const withoutComments = source.replace(/#.*$/gm, '');
  const matches = [...withoutComments.matchAll(/\bclient_max_body_size\s+([^;\s]+)\s*;/g)];
  if (matches.length !== 1) throw new Error('nginx 必须且只能配置一个 client_max_body_size');
  const match = /^(\d+)([kKmMgG]?)$/.exec(matches[0][1]);
  if (!match) throw new Error('nginx client_max_body_size 使用了不支持的格式');
  const multiplier = { '': 1, k: 1024, m: MIB, g: 1024 * MIB }[match[2].toLowerCase()];
  const bytes = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(bytes)) throw new Error('nginx client_max_body_size 超出支持范围');
  return bytes;
}

function checkTool(envName, fallback) {
  const command = process.env[envName] || fallback;
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['-version'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let outputBytes = 0;
    let stopReason;
    let settled = false;
    const requestStop = (reason) => {
      if (settled || stopReason) return;
      stopReason = reason;
      child.kill('SIGKILL');
    };
    const countOutput = (chunk) => {
      if (settled || stopReason) return;
      outputBytes += chunk.length;
      if (outputBytes > TOOL_OUTPUT_MAX_BYTES) requestStop(new Error(`${envName} 工具输出超过上限`));
    };
    child.stdout.on('data', countOutput);
    child.stderr.on('data', countOutput);
    child.once('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`${envName} 指定的工具不可用`));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stopReason) reject(stopReason);
      else if (code !== 0) reject(new Error(`${envName} 指定的工具不可用`));
      else resolve();
    });
    const timer = setTimeout(
      () => requestStop(new Error(`${envName} 工具检查超时`)),
      TOOL_TIMEOUT_MS,
    );
  });
}

async function main() {
  const videoMaxBytes = readStrictInteger('MEDIA_VIDEO_MAX_BYTES');
  const imageMaxBytes = readStrictInteger('MEDIA_IMAGE_MAX_BYTES');
  readStrictInteger('MEDIA_IMAGE_MAX_PIXELS');
  readStrictInteger('MEDIA_PROBE_TIMEOUT_MS');

  const nginxPath = process.argv[2] || new URL('./nginx/default.conf', import.meta.url);
  let nginxSource;
  try {
    nginxSource = await readFile(nginxPath, 'utf8');
  } catch {
    throw new Error('nginx 配置不可读');
  }
  const expectedBodyBytes = Math.max(videoMaxBytes, imageMaxBytes) + MIB;
  const actualBodyBytes = parseNginxBodySize(nginxSource);
  if (actualBodyBytes !== expectedBodyBytes) {
    throw new Error('nginx client_max_body_size 必须等于媒体传输上限加 1 MiB');
  }

  await checkTool('FFPROBE_PATH', 'ffprobe');
  await checkTool('FFMPEG_PATH', 'ffmpeg');
  process.stdout.write('媒体部署检查通过\n');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : '未知错误';
  process.stderr.write(`媒体部署检查失败：${message}\n`);
  process.exitCode = 1;
});
