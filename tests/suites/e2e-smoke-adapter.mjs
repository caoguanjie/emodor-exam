import { spawn } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const LEGACY_SMOKE = join(ROOT, 'tests', 'e2e-smoke.mjs');

/**
 * The legacy smoke suite keeps its 94 explicit assertions and fetch helpers.
 * This adapter is the registered suite boundary; new suites receive ctx and
 * export run(ctx) without turning arbitrary paths into child processes.
 */
export async function run(ctx) {
  if (typeof ctx?.trackChild !== 'function') {
    throw new Error('测试套件需要 runner 提供 trackChild(ctx)');
  }
  const child = spawn(process.execPath, [LEGACY_SMOKE], {
    cwd: ROOT,
    env: { ...ctx.env, BASE_URL: ctx.baseUrl },
    stdio: 'inherit',
  });
  ctx.trackChild(child);
  ctx.reportOwnedRuntime?.({ stage: 'suite-child-started', suitePid: child.pid });
  await new Promise((resolve, reject) => {
    const onExit = (code, signal) => {
      child.removeListener('error', onError);
      if (code === 0) return resolve();
      reject(new Error(`测试套件失败：e2e-smoke (${code ?? signal ?? 'unknown'})`));
    };
    const onError = (error) => {
      child.removeListener('exit', onExit);
      reject(error);
    };
    child.once('exit', onExit);
    child.once('error', onError);
  });
}
