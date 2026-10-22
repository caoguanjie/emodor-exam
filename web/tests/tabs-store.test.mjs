import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPinia } from 'pinia';
import { createServer } from 'vite';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const unsavedStubId = '\0tabs-unsaved-test';
let vite;
let useTabsStore;

before(async () => {
  vite = await createServer({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    plugins: [{
      name: 'tabs-store-test-stubs',
      enforce: 'pre',
      resolveId(source) {
        if (source === '../composables/useUnsavedChanges' || source === '/src/composables/useUnsavedChanges.ts') return unsavedStubId;
        return undefined;
      },
      load(id) {
        if (id !== unsavedStubId) return undefined;
        return 'export async function confirmUnsavedChanges(){return true} export async function confirmUnsavedRoutes(){return true}';
      },
    }],
  });
  ({ useTabsStore } = await vite.ssrLoadModule('/src/stores/tabs.ts'));
});

after(async () => { await vite?.close(); });

test('restored business tabs discard retired routes and refuse to recreate them', () => {
  const originalSessionStorage = globalThis.sessionStorage;
  const values = new Map([
    ['re_admin_tabs', JSON.stringify([
      { path: '/admin/regulations/7', title: '制度详情', closable: true },
      { path: '/admin/statistics', title: '统计报表', closable: true },
      { path: '/admin/questions', title: '题库管理', closable: true },
    ])],
  ]);
  globalThis.sessionStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  try {
    const tabs = useTabsStore(createPinia());
    assert.deepEqual(tabs.tabs.map((tab) => tab.path), ['/admin/questions']);
    tabs.visit('/admin/grading/9', '人工阅卷');
    assert.deepEqual(tabs.tabs.map((tab) => tab.path), ['/admin/questions']);
    assert.deepEqual(JSON.parse(values.get('re_admin_tabs')), [
      { path: '/admin/questions', title: '题库管理', closable: true },
    ]);
  } finally {
    if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = originalSessionStorage;
  }
});
