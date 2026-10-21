import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { loadConfig } from '../src/config/configuration';

const MIB = 1024 * 1024;
const MEDIA_ENV_NAMES = [
  'MEDIA_VIDEO_MAX_BYTES',
  'MEDIA_IMAGE_MAX_BYTES',
  'MEDIA_IMAGE_MAX_PIXELS',
  'MEDIA_PROBE_TIMEOUT_MS',
] as const;

const deployCheckPath = resolve(__dirname, '../../deploy/check-media-limits.mjs');
const defaultNginxPath = resolve(__dirname, '../../deploy/nginx/default.conf');
let fixtureRoot: string;
let availableToolPath: string;

async function withMediaEnvironment<T>(
  values: Partial<Record<(typeof MEDIA_ENV_NAMES)[number], string | undefined>>,
  action: () => T | Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const name of MEDIA_ENV_NAMES) {
    previous.set(name, process.env[name]);
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await action();
  } finally {
    for (const name of MEDIA_ENV_NAMES) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function runDeployCheck(
  nginxPath: string,
  overrides: Record<string, string | undefined> = {},
) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of MEDIA_ENV_NAMES) delete env[name];
  Object.assign(env, {
    FFPROBE_PATH: availableToolPath,
    FFMPEG_PATH: availableToolPath,
    DB_PASSWORD: 'deployment-check-must-not-print-this-secret',
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return spawnSync(process.execPath, [deployCheckPath, nginxPath], {
    cwd: resolve(__dirname, '../..'),
    env,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 256 * 1024,
  });
}

function expectProcessExited(pid: number): void {
  try {
    process.kill(pid, 0);
  } catch (error: any) {
    expect(error?.code).toBe('ESRCH');
    return;
  }
  throw new Error(`deployment-check child ${pid} is still running`);
}

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'ruleexam-media-config-test-'));
  availableToolPath = join(fixtureRoot, 'available-tool.cjs');
  await writeFile(availableToolPath, '#!/usr/bin/env node\nprocess.stdout.write("fixture tool version 1\\n");\n', 'utf8');
  await chmod(availableToolPath, 0o755);
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

describe('strict media configuration', () => {
  it('uses the approved media defaults when media variables are absent', async () => {
    await withMediaEnvironment({}, () => {
      const config = loadConfig();
      expect(config.media.videoMaxBytes).toBe(512 * MIB);
      expect(config.media.imageMaxBytes).toBe(10 * MIB);
      expect(config.media.imageMaxPixels).toBe(25_000_000);
      expect(config.media.probeTimeoutMs).toBe(30_000);
    });
  });

  it.each([
    ['MEDIA_VIDEO_MAX_BYTES', 'not-an-integer'],
    ['MEDIA_VIDEO_MAX_BYTES', '1.5'],
    ['MEDIA_VIDEO_MAX_BYTES', '0'],
    ['MEDIA_VIDEO_MAX_BYTES', String(512 * MIB + 1)],
    ['MEDIA_IMAGE_MAX_BYTES', ''],
    ['MEDIA_IMAGE_MAX_BYTES', String(100 * MIB + 1)],
    ['MEDIA_IMAGE_MAX_PIXELS', '100000001'],
    ['MEDIA_PROBE_TIMEOUT_MS', '999'],
  ] as const)('rejects an explicit invalid %s value', async (name, value) => {
    await withMediaEnvironment({ [name]: value }, () => {
      expect(() => loadConfig()).toThrowError(name);
    });
  });

  it('preserves legacy clamping semantics for non-media integer configuration', async () => {
    const previous = process.env.AI_MULTIMODAL_DPI;
    process.env.AI_MULTIMODAL_DPI = '999';
    try {
      expect(loadConfig().ai.multimodalDpi).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.AI_MULTIMODAL_DPI;
      else process.env.AI_MULTIMODAL_DPI = previous;
    }
  });
});

describe('media deployment check', () => {
  it('accepts default limits, a 513 MiB nginx cap, and available tools', () => {
    const result = runDeployCheck(defaultNginxPath);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('媒体部署检查通过');
  });

  it('accepts a custom quota only when nginx equals the transport maximum plus 1 MiB', async () => {
    const nginxPath = join(fixtureRoot, 'custom-nginx.conf');
    await writeFile(nginxPath, 'server { client_max_body_size 101m; }\n', 'utf8');
    const result = runDeployCheck(nginxPath, { MEDIA_VIDEO_MAX_BYTES: String(100 * MIB) });
    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects a quota mismatch and unsupported nginx size syntax', async () => {
    const mismatch = runDeployCheck(defaultNginxPath, { MEDIA_VIDEO_MAX_BYTES: String(100 * MIB) });
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain('client_max_body_size');

    const unsupportedPath = join(fixtureRoot, 'unsupported-nginx.conf');
    await writeFile(unsupportedPath, 'server { client_max_body_size 513mb; }\n', 'utf8');
    const unsupported = runDeployCheck(unsupportedPath);
    expect(unsupported.status).not.toBe(0);
    expect(unsupported.stderr).toContain('client_max_body_size');
  });

  it('rejects malformed media configuration without printing its value or unrelated secrets', () => {
    const invalidValue = 'private-malformed-limit';
    const result = runDeployCheck(defaultNginxPath, { MEDIA_IMAGE_MAX_BYTES: invalidValue });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MEDIA_IMAGE_MAX_BYTES');
    expect(result.stderr).not.toContain(invalidValue);
    expect(result.stderr).not.toContain('deployment-check-must-not-print-this-secret');
  });

  it('rejects a missing tool without printing its configured path', () => {
    const missingPath = join(fixtureRoot, 'private-missing-ffprobe');
    const result = runDeployCheck(defaultNginxPath, { FFPROBE_PATH: missingPath });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('FFPROBE_PATH');
    expect(result.stderr).not.toContain(missingPath);
    expect(result.stderr).not.toContain('deployment-check-must-not-print-this-secret');
  });

  it('does not interpret shell metacharacters in a configured tool path', async () => {
    const markerPath = join(fixtureRoot, 'shell-marker');
    const shellPayload = `${availableToolPath};touch ${markerPath};#`;
    const result = runDeployCheck(defaultNginxPath, { FFPROBE_PATH: shellPayload });
    expect(result.status).not.toBe(0);
    await expect(stat(markerPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('bounds tool output and waits for the killed tool process to exit', async () => {
    const pidPath = join(fixtureRoot, 'deployment-output-child.pid');
    const noisyToolPath = join(fixtureRoot, 'noisy-tool.cjs');
    await writeFile(noisyToolPath, `#!/usr/bin/env node
      const fs = require('node:fs');
      fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
      process.stdout.write(Buffer.alloc(80 * 1024, 65));
      setInterval(() => {}, 1000);
    `, 'utf8');
    await chmod(noisyToolPath, 0o755);

    const result = runDeployCheck(defaultNginxPath, { FFPROBE_PATH: noisyToolPath });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('FFPROBE_PATH 工具输出超过上限');
    expectProcessExited(Number(await readFile(pidPath, 'utf8')));
  });
});
