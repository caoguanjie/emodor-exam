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
      { path: '/my/exams/42', title: '旧PC考试页', closable: true },
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
    tabs.visit('/my/exams?continue=1', '我的考试');
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

function withStoredTabs(initial, run) {
  const originalSessionStorage = globalThis.sessionStorage;
  const values = new Map([['re_admin_tabs', JSON.stringify(initial)]]);
  globalThis.sessionStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  try { run(useTabsStore(createPinia()), () => JSON.parse(values.get('re_admin_tabs'))); }
  finally {
    if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = originalSessionStorage;
  }
}

test('exam record filter and page changes reuse one list tab and persist its latest full URL', () => {
  unsavedContext.calls = [];
  withStoredTabs([{ path: '/admin/dashboard', title: '业务首页', closable: false }], (tabs, persisted) => {
    tabs.visit('/admin/exam-records?paper_id=7', '考试记录');
    tabs.visit('/admin/exam-records?paper_id=8&result_status=failed', '考试记录');
    const current = '/admin/exam-records?paper_id=8&result_status=failed&page=2&page_size=50';
    tabs.visit(current, '考试记录');
    assert.deepEqual(tabs.tabs, [
      { path: '/admin/dashboard', title: '业务首页', closable: false },
      { path: current, title: '考试记录', closable: true },
    ]);
    assert.deepEqual(persisted(), tabs.tabs);
    assert.deepEqual(unsavedContext.calls, []);
  });
});

test('different record details and other page queries stay separate while the same readonly record keeps its latest return URL', () => {
  withStoredTabs([], (tabs, persisted) => {
    tabs.visit('/admin/exam-records/42?return_to=%2Fadmin%2Fexam-records%3Fpaper_id%3D7', '答卷甲');
    const secondRecord = '/admin/exam-records/43?return_to=%2Fadmin%2Fexam-records%3Fpaper_id%3D7';
    tabs.visit(secondRecord, '答卷乙');
    const updatedRecord = '/admin/exam-records/42?return_to=%2Fadmin%2Fexam-records%3Fpaper_id%3D8%26page%3D2';
    tabs.visit(updatedRecord, '答卷甲');
    tabs.visit('/admin/papers/7?designer=1', '编辑试卷');
    tabs.visit('/admin/papers/7?designer=1&scope=training', '培训试卷');
    assert.deepEqual(tabs.tabs.map(tab => tab.path), [
      updatedRecord, secondRecord, '/admin/papers/7?designer=1', '/admin/papers/7?designer=1&scope=training',
    ]);
    assert.deepEqual(persisted(), tabs.tabs);
  });
});

test('restoration and the next record visit converge old duplicate record tabs without merging other tabs', () => {
  withStoredTabs([
    { path: '/admin/exam-records?paper_id=7', title: '考试记录', closable: true },
    { path: '/admin/papers/7?designer=1', title: '编辑试卷', closable: true },
    { path: '/admin/exam-records?paper_id=8&page=3', title: '考试记录', closable: true },
    { path: '/admin/exam-records/42?return_to=old', title: '旧答卷标题', closable: true },
    { path: '/admin/exam-records/43', title: '另一答卷', closable: true },
    { path: '/admin/exam-records/42?return_to=new', title: '答卷详情', closable: true },
    { path: '/admin/papers/7?designer=1&scope=training', title: '培训试卷', closable: true },
  ], (tabs, persisted) => {
    assert.deepEqual(tabs.tabs.map(tab => tab.path), [
      '/admin/exam-records?paper_id=8&page=3', '/admin/papers/7?designer=1',
      '/admin/exam-records/42?return_to=new', '/admin/exam-records/43', '/admin/papers/7?designer=1&scope=training',
    ]);
    assert.equal(tabs.tabs[2].title, '答卷详情');
    assert.deepEqual(persisted(), tabs.tabs);
    tabs.tabs.push({ path: '/admin/exam-records?user_id=9', title: '重复考试记录', closable: true });
    tabs.visit('/admin/exam-records?user_id=10&page=2', '考试记录');
    assert.equal(tabs.tabs.length, 5);
    assert.equal(tabs.tabs[0].path, '/admin/exam-records?user_id=10&page=2');
    assert.deepEqual(persisted(), tabs.tabs);
  });
});
