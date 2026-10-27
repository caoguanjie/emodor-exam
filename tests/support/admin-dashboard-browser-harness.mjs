import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { getFreePort } from './ephemeral-services.mjs';

const webRoot = fileURLToPath(new URL('../../web', import.meta.url));

export async function startAdminDashboardBrowserServer(ctx) {
  assert.match(ctx.env.DB_DATABASE, /^ruleexam_test_[A-Za-z0-9_]+$/);
  const api = new URL(ctx.baseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(api.hostname));
  const { createServer } = await import(pathToFileURL(join(webRoot, 'node_modules/vite/dist/node/index.js')).href);
  const server = await createServer({
    root: webRoot, configFile: join(webRoot, 'vite.config.ts'),
    server: { host: '127.0.0.1', port: await getFreePort(), strictPort: true, open: false,
      proxy: { '/api/v1': { target: api.origin, changeOrigin: true } } },
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    return { baseUrl: `http://127.0.0.1:${address.port}`, close: () => server.close() };
  } catch (error) { await server.close(); throw error; }
}
