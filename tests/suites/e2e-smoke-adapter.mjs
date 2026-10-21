import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const LEGACY_SMOKE = join(ROOT, 'tests', 'e2e-smoke.mjs');

/**
 * The legacy smoke suite keeps its 94 explicit assertions and fetch helpers.
 * This adapter is the registered suite boundary; new suites receive ctx and
 * export run(ctx) without turning arbitrary paths into child processes.
 */
export async function run(ctx) {
  const result = spawnSync(process.execPath, [LEGACY_SMOKE], {
    cwd: ROOT,
    env: { ...ctx.env, BASE_URL: ctx.baseUrl },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`测试套件失败：e2e-smoke (${result.status ?? 'signal'})`);
}
