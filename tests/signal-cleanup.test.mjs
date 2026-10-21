import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error('run-e2e did not exit after SIGTERM'));
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve([code, signal]);
    };
    child.once('exit', onExit);
  });
}

test('run-e2e SIGTERM exits and releases owned runtime', async () => {
  const child = spawn(process.execPath, ['tests/run-e2e.mjs', '--ephemeral', '--suite', 'smoke'], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  try {
    const deadline = Date.now() + 30_000;
    while (!output.includes('api listening on') && Date.now() < deadline) {
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.match(output, /api listening on/);
    const signalledAt = Date.now();
    child.kill('SIGTERM');
    const [code, signal] = await waitForChildExit(child, 30_000);
    assert.ok(Date.now() - signalledAt < 30_000);
    assert.equal(signal, null);
    assert.notEqual(code, null);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await waitForChildExit(child, 2_000).catch(() => undefined);
    }
  }
});
