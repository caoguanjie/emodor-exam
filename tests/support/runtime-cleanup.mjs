import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export async function createOwnedAliveChild() {
  const root = await mkdtemp(join(tmpdir(), 'ruleexam-cleanup-safety-'));
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: root,
    stdio: 'ignore',
  });
  const realKill = child.kill.bind(child);
  let blockKill = true;
  child.kill = (signal) => (blockKill ? false : realKill(signal));
  return {
    root,
    child,
    restoreKill() {
      blockKill = false;
      child.kill = realKill;
    },
    async removeDirectory() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function cleanupOwnedProcessDirectory({ child, root, stop, stopOptions }) {
  await stop(child, stopOptions);
  await rm(root, { recursive: true, force: true });
}
