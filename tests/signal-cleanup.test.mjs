import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error('run-e2e did not exit after signal'));
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve([code, signal]);
    };
    child.once('exit', onExit);
  });
}

function waitForMessage(child, predicate, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('message', onMessage);
      reject(new Error('run-e2e did not publish the expected owned-runtime metadata'));
    }, timeoutMs);
    const onMessage = (message) => {
      if (!predicate(message)) return;
      clearTimeout(timer);
      child.removeListener('message', onMessage);
      resolve(message);
    };
    child.on('message', onMessage);
  });
}

function waitForOutput(getOutput, predicate, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate(getOutput())) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error(`run-e2e did not produce the expected suite output; tail=${getOutput().slice(-1500)}`));
      setTimeout(poll, 50);
    };
    poll();
  });
}

async function assertExited(pids) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const alive = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return error?.code === 'EPERM';
      }
    });
    if (!alive.length) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`owned processes still alive: ${pids.join(', ')}`);
}

function startRunE2e(probeStage = undefined) {
  const child = spawn(process.execPath, ['tests/run-e2e.mjs', '--ephemeral', '--suite', 'smoke'], {
    cwd: ROOT,
    env: { ...process.env, ...(probeStage ? { A1_LIFECYCLE_PROBE: probeStage } : {}) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { child, getOutput: () => output };
}

async function stopAndAssertOwnedRuntime({ child, metadata, signal, expectedCode, output }) {
  try {
    if (signal) child.kill(signal);
    const [code, exitSignal] = await waitForChildExit(child, 30_000);
    assert.equal(exitSignal, null, output());
    assert.equal(code, expectedCode, output());
    const ownedPids = [metadata.apiPid, metadata.mysqlPid, metadata.redisPid, metadata.suitePid]
      .filter((pid) => Number.isInteger(pid) && pid > 0);
    await assertExited(ownedPids);
    if (metadata.harnessRoot) assert.equal(existsSync(metadata.harnessRoot), false, `harness root remains: ${metadata.harnessRoot}`);
    assert.equal(existsSync(metadata.servicesRoot), false, `services root remains: ${metadata.servicesRoot}`);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await waitForChildExit(child, 2_000).catch(() => undefined);
    }
  }
}

test('run-e2e SIGTERM during suite startup exits 143 and releases every owned process', { concurrency: false }, async () => {
  const run = startRunE2e();
  try {
    const metadata = await waitForMessage(run.child, (message) => message?.type === 'owned-runtime' && message.stage === 'suite-child-started');
    assert.ok(metadata.apiPid > 0);
    assert.ok(metadata.mysqlPid > 0);
    assert.ok(metadata.redisPid > 0);
    assert.ok(metadata.suitePid > 0);
    await stopAndAssertOwnedRuntime({ child: run.child, metadata, signal: 'SIGTERM', expectedCode: 143, output: run.getOutput });
  } finally {
    if (run.child.exitCode === null) {
      run.child.kill('SIGKILL');
      await waitForChildExit(run.child, 2_000).catch(() => undefined);
    }
  }
});

test('run-e2e SIGINT while services are ready but harness creation has not started exits 130 and releases services', { concurrency: false }, async () => {
  const run = startRunE2e('services-ready');
  try {
    const metadata = await waitForMessage(run.child, (message) => message?.type === 'owned-runtime' && message.stage === 'services-ready');
    assert.equal(metadata.apiPid, null);
    assert.equal(metadata.harnessRoot, null);
    assert.ok(metadata.mysqlPid > 0);
    assert.ok(metadata.redisPid > 0);
    assert.ok(metadata.servicesRoot);
    await stopAndAssertOwnedRuntime({ child: run.child, metadata, signal: 'SIGINT', expectedCode: 130, output: run.getOutput });
  } finally {
    if (run.child.exitCode === null) {
      run.child.kill('SIGKILL');
      await waitForChildExit(run.child, 2_000).catch(() => undefined);
    }
  }
});

test('run-e2e SIGTERM after harness paths exist but before API start exits 143 and releases late-arriving harness', { concurrency: false }, async () => {
  const run = startRunE2e('harness-created');
  try {
    const metadata = await waitForMessage(run.child, (message) => message?.type === 'owned-runtime' && message.stage === 'harness-created');
    assert.equal(metadata.apiPid, null);
    assert.ok(metadata.mysqlPid > 0);
    assert.ok(metadata.redisPid > 0);
    assert.ok(metadata.harnessRoot);
    assert.ok(metadata.servicesRoot);
    run.child.kill('SIGTERM');
    await waitForMessage(run.child, (message) => message?.type === 'owned-runtime' && message.stage === 'signal-received');
    await stopAndAssertOwnedRuntime({ child: run.child, metadata, signal: undefined, expectedCode: 143, output: run.getOutput });
  } finally {
    if (run.child.exitCode === null) {
      run.child.kill('SIGKILL');
      await waitForChildExit(run.child, 2_000).catch(() => undefined);
    }
  }
});

test('run-e2e SIGINT after suite starts exits 130 and releases every owned process', { concurrency: false }, async () => {
  const run = startRunE2e();
  try {
    const metadata = await waitForMessage(run.child, (message) => message?.type === 'owned-runtime' && message.stage === 'suite-child-started');
    await waitForOutput(run.getOutput, (output) => output.includes('== 0. 健康检查 =='));
    await stopAndAssertOwnedRuntime({ child: run.child, metadata, signal: 'SIGINT', expectedCode: 130, output: run.getOutput });
  } finally {
    if (run.child.exitCode === null) {
      run.child.kill('SIGKILL');
      await waitForChildExit(run.child, 2_000).catch(() => undefined);
    }
  }
});
