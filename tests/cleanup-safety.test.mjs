import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';

import { stopApi, waitForChildExit } from './support/training-harness.mjs';
import { stopProcess, waitForProcessExit } from './support/ephemeral-services.mjs';
import { cleanupOwnedProcessDirectory, createOwnedAliveChild } from './support/runtime-cleanup.mjs';

function liveFakeChild({ onKill = () => false } = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = onKill;
  return child;
}

test('child error is not treated as a successful exit', async () => {
  const child = liveFakeChild();
  const waiting = waitForChildExit(child, 100);
  const error = new Error('spawn failed');
  child.emit('error', error);
  await assert.rejects(waiting, error);
});

test('ephemeral process error is not treated as a successful exit', async () => {
  const child = liveFakeChild();
  const waiting = waitForProcessExit(child, 100);
  const error = new Error('process error');
  child.emit('error', error);
  await assert.rejects(waiting, error);
});

test('live API process prevents cleanup from removing its directory', async () => {
  const child = liveFakeChild();
  await assert.rejects(
    stopApi(child, { termTimeoutMs: 5, killTimeoutMs: 5 }),
    /refusing to remove its task directory/,
  );
});

test('live ephemeral process prevents cleanup from removing its directory', async () => {
  const child = liveFakeChild();
  await assert.rejects(
    stopProcess(child, { termTimeoutMs: 5, killTimeoutMs: 5 }),
    /refusing to remove its task directory/,
  );
});

test('real owned process failure keeps its PID alive and directory present until recovery', async () => {
  const fixture = await createOwnedAliveChild();
  try {
    await assert.rejects(
      cleanupOwnedProcessDirectory({
        child: fixture.child,
        root: fixture.root,
        stop: stopApi,
        stopOptions: { termTimeoutMs: 5, killTimeoutMs: 5 },
      }),
      /refusing to remove its task directory/,
    );
    assert.equal(existsSync(fixture.root), true);
    assert.doesNotThrow(() => process.kill(fixture.child.pid, 0));
    fixture.restoreKill();
    await cleanupOwnedProcessDirectory({
      child: fixture.child,
      root: fixture.root,
      stop: stopApi,
      stopOptions: { termTimeoutMs: 5_000, killTimeoutMs: 5_000 },
    });
    assert.equal(existsSync(fixture.root), false);
  } finally {
    fixture.restoreKill();
    if (fixture.child.exitCode === null && fixture.child.signalCode === null) {
      fixture.child.kill('SIGKILL');
      await waitForChildExit(fixture.child, 2_000).catch(() => undefined);
    }
    if (existsSync(fixture.root)) await fixture.removeDirectory();
  }
});
