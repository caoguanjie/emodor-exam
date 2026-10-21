import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyFfmpegFixtureTimeoutCleanup } from './training-media.mjs';

test('ffmpeg timeout cleanup waits for the owned process tree to become observable', { timeout: 15_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-media-startup-delay-'));
  const startupDelay = join(root, 'startup-delay.cjs');
  const previousNodeOptions = process.env.NODE_OPTIONS;
  try {
    await writeFile(startupDelay, `
      const gate = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(gate, 0, 0, 1250);
    `, 'utf8');
    const requireDelay = `--require=${startupDelay}`;
    process.env.NODE_OPTIONS = previousNodeOptions
      ? `${previousNodeOptions} ${requireDelay}`
      : requireDelay;

    await verifyFfmpegFixtureTimeoutCleanup();
  } finally {
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    await rm(root, { recursive: true, force: true });
  }
});
