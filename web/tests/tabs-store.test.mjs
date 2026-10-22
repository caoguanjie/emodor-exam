import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPinia } from 'pinia';
import { createServer } from 'vite';

const webRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const unsavedStubId = '\0tabs-unsaved-test';
const unsavedContext = { result: true, calls: [] };
let vite;
let useTabsStore;

before(async () => {
  globalThis.__tabsUnsavedTest = unsavedContext;
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
        return `
          export async function confirmUnsavedChanges(){return true}
          export async function confirmUnsavedRoutes(paths){
            const context=globalThis.__tabsUnsavedTest;
            context.calls.push([...paths]);
            return context.result;
          }
        `;
      },
    }],
  });
  ({ useTabsStore } = await vite.ssrLoadModule('/src/stores/tabs.ts'));
});

after(async () => { delete globalThis.__tabsUnsavedTest; await vite?.close(); });

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

test('bulk tab closing removes only the requested closable routes and persists the survivors', async () => {
  unsavedContext.result = true;
  unsavedContext.calls = [];
  const originalSessionStorage = globalThis.sessionStorage;
  const values = new Map([
    ['re_admin_tabs', JSON.stringify([
      { path: '/admin/dashboard', title: '业务首页', closable: false },
      { path: '/admin/training-categories', title: '培训类别', closable: true },
      { path: '/admin/students', title: '学员管理', closable: true },
      { path: '/admin/courses', title: '课程管理', closable: true },
    ])],
  ]);
  globalThis.sessionStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  try {
    const tabs = useTabsStore(createPinia());
    assert.equal(typeof tabs.closePaths, 'function', 'bulk close is a tabs-store capability');
    const closed = await tabs.closePaths(['/admin/dashboard', '/admin/training-categories', '/admin/courses']);
    assert.equal(closed, true);
    assert.deepEqual(unsavedContext.calls, [['/admin/training-categories', '/admin/courses']]);
    assert.deepEqual(tabs.tabs.map((tab) => tab.path), ['/admin/dashboard', '/admin/students']);
    assert.deepEqual(JSON.parse(values.get('re_admin_tabs')), [
      { path: '/admin/dashboard', title: '业务首页', closable: false },
      { path: '/admin/students', title: '学员管理', closable: true },
    ]);
  } finally {
    if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = originalSessionStorage;
  }
});

test('bulk tab closing is atomic when the one unsaved-routes confirmation is cancelled', async () => {
  unsavedContext.result = false;
  unsavedContext.calls = [];
  const originalSessionStorage = globalThis.sessionStorage;
  const original = [
    { path: '/admin/dashboard', title: '业务首页', closable: false },
    { path: '/admin/training-categories', title: '培训类别', closable: true },
    { path: '/admin/students', title: '学员管理', closable: true },
  ];
  const values = new Map([['re_admin_tabs', JSON.stringify(original)]]);
  globalThis.sessionStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  try {
    const tabs = useTabsStore(createPinia());
    const closed = await tabs.closePaths(['/admin/dashboard', '/admin/training-categories', '/admin/students']);
    assert.equal(closed, false);
    assert.deepEqual(unsavedContext.calls, [['/admin/training-categories', '/admin/students']]);
    assert.deepEqual(tabs.tabs, original);
    assert.deepEqual(JSON.parse(values.get('re_admin_tabs')), original);
  } finally {
    unsavedContext.result = true;
    if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = originalSessionStorage;
  }
});
