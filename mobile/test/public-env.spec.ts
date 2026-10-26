// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, loadEnv } from 'vite';
import { describe, expect, it } from 'vitest';
import { publicEnvFallbackDefines } from '../build/public-env';

describe('root public environment defaults', () => {
  it('keeps explicit web and runtime values, including intentionally empty values', () => {
    expect(publicEnvFallbackDefines(
      { VITE_MEDIA_ORIGIN: 'https://media.example.test', VITE_DEMO_MODE: 'root', VITE_API_URL: 'root', VITE_EMPTY: 'root', COS_SECRET_KEY: 'unusable-private-fixture' },
      { VITE_DEMO_MODE: 'legacy', VITE_EMPTY: '' },
      { VITE_API_URL: 'runtime' },
    )).toEqual({ 'import.meta.env.VITE_MEDIA_ORIGIN': '"https://media.example.test"' });
  });
  it('builds with root public defaults and web mode values without embedding private COS credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ruleexam-public-env-'));
    const web = join(root, 'web');
    try {
      await mkdir(web);
      await writeFile(join(root, '.env'), 'VITE_MEDIA_ORIGIN=https://media.example.test\nVITE_DEMO_MODE=root\nCOS_SECRET_ID=unusable-private-id-fixture\nCOS_SECRET_KEY=unusable-private-key-fixture\n');
      await writeFile(join(web, '.env.production'), 'VITE_DEMO_MODE=legacy\n');
      await writeFile(join(web, 'entry.js'), 'globalThis.publicFixture = { media: import.meta.env.VITE_MEDIA_ORIGIN, demo: import.meta.env.VITE_DEMO_MODE, key: import.meta.env.COS_SECRET_KEY };');
      const result = await build({ root: web, configFile: false, logLevel: 'silent',
        define: publicEnvFallbackDefines(loadEnv('production', root, 'VITE_'), loadEnv('production', web, 'VITE_'), process.env),
        build: { write: false, minify: false, rollupOptions: { input: join(web, 'entry.js') } },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const code = outputs.flatMap(output => 'output' in output ? output.output : [])
        .flatMap(output => 'code' in output ? [output.code] : []).join('\n');
      expect(code).toContain('https://media.example.test');
      expect(code).toContain('legacy');
      expect(code).not.toContain('unusable-private-id-fixture');
      expect(code).not.toContain('unusable-private-key-fixture');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
