import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import * as access from '../src/router/access.ts';
import {
  defaultHomePath,
  postAuthPath,
  validPostAuthRedirect,
} from '../src/router/access.ts';

test('selects the dashboard for administrators and the learner home otherwise', () => {
  assert.equal(defaultHomePath(true), '/admin/dashboard');
  assert.equal(defaultHomePath(false), '/my/regulations');
});
test('keeps only internal non-auth redirects and gives them priority', () => {
  assert.equal(validPostAuthRedirect('/admin/papers?scope=training'), '/admin/papers?scope=training');
  assert.equal(postAuthPath(true, '/admin/papers'), '/admin/papers');
  assert.equal(validPostAuthRedirect('//outside.example/path'), null);
  assert.equal(validPostAuthRedirect('https://outside.example/path'), null);
  assert.equal(validPostAuthRedirect('/\\outside'), null);
  assert.equal(validPostAuthRedirect('/login'), null);
  assert.equal(validPostAuthRedirect('/change-password?redirect=/admin/papers'), null);
});

test('retires cancelled administration paths while preserving current learner and training routes', () => {
  const isRetiredAdminPath = access.isRetiredAdminPath;
  assert.equal(typeof isRetiredAdminPath, 'function');
  for (const path of [
    '/admin/departments', '/admin/users', '/admin/regulations', '/admin/regulations/99',
    '/admin/exam-monitor', '/admin/grading', '/admin/grading/88', '/admin/statistics',
  ]) assert.equal(isRetiredAdminPath?.(path), true, path);
  for (const path of [
    '/admin/students', '/admin/questions', '/admin/questions/import', '/admin/exam-records/88', '/admin/training-statistics',
    '/my/regulations', '/my/exams',
  ]) assert.equal(isRetiredAdminPath?.(path), false, path);
});

test('recognizes only retired legacy paper detail locations', () => {
  const isRetiredLegacyPaperLocation = access.isRetiredLegacyPaperLocation;
  assert.equal(typeof isRetiredLegacyPaperLocation, 'function');
  assert.equal(isRetiredLegacyPaperLocation?.('/admin/papers/paper-1', 'regulation'), true);
  assert.equal(isRetiredLegacyPaperLocation?.('/admin/papers/paper-1/', 'regulation'), true);
  assert.equal(isRetiredLegacyPaperLocation?.('/admin/papers', 'regulation'), false);
  assert.equal(isRetiredLegacyPaperLocation?.('/admin/papers/paper-1', 'training'), false);
  assert.equal(isRetiredLegacyPaperLocation?.('/admin/papers/paper-1', undefined), false);
});

test('global router guard retires legacy scope on same-path changes and login return', async () => {
  const authId = '\0router-access-auth-test';
  const authState = {
    isLoggedIn: true,
    needChangePassword: false,
    isAdmin: true,
    isSuperAdmin: true,
    can: () => true,
    async restore() { return true; },
    async fetchProfile() {},
  };
  globalThis.__routerAccessAuthTest = authState;
  const vite = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    plugins: [{
      name: 'legacy-paper-route-guard-test',
      enforce: 'pre',
      resolveId(source, importer) {
        if ((source === '../stores/auth' || source === '/src/stores/auth.ts') && importer?.endsWith('/src/router/index.ts')) return authId;
        return undefined;
      },
      load(id) {
        if (id === authId) return 'export function useAuthStore() { return globalThis.__routerAccessAuthTest; }';
        return undefined;
      },
      transform(code, id) {
        if (id.endsWith('/src/router/index.ts')) return code
          .replace('createWebHistory,', 'createMemoryHistory as createWebHistory,')
          .replace(/component: \(\) => import\('[^']+'\)/g, 'component: {}');
        return undefined;
      },
    }],
  });
  try {
    const { router } = await vite.ssrLoadModule('/src/router/index.ts');
    await router.push('/admin/papers/paper-1?scope=training&designer=1');
    assert.equal(router.currentRoute.value.path, '/admin/papers/paper-1');
    assert.deepEqual(router.currentRoute.value.query, { scope: 'training', designer: '1' });

    await router.push('/admin/papers/paper-1?scope=regulation');
    assert.equal(router.currentRoute.value.fullPath, '/admin/papers');

    authState.isLoggedIn = false;
    authState.restore = async () => false;
    await router.push('/admin/papers/legacy-7?scope=regulation');
    assert.equal(router.currentRoute.value.path, '/login');
    assert.equal(router.currentRoute.value.query.redirect, '/admin/papers/legacy-7?scope=regulation');

    authState.isLoggedIn = true;
    await router.push(String(router.currentRoute.value.query.redirect));
    assert.equal(router.currentRoute.value.fullPath, '/admin/papers');
  } finally {
    delete globalThis.__routerAccessAuthTest;
    await vite.close();
  }
});

test('registered question routes cache imports but refresh management on return and enforce separate permissions', async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    plugins: [{
      name: 'question-navigation-memory-history',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/src/router/index.ts')) {
          return code.replace('createWebHistory,', 'createMemoryHistory as createWebHistory,');
        }
      },
    }],
  });
  try {
    const { router } = await vite.ssrLoadModule('/src/router/index.ts');
    const management = router.resolve('/admin/questions');
    const importing = router.resolve('/admin/questions/import');
    assert.equal(management.meta.title, '试题管理');
    assert.notEqual(management.meta.cache, true, 'returning from an import must reload the question list');
    assert.equal(importing.meta.title, '试题导入');
    assert.equal(importing.meta.cache, true);
    assert.equal(access.routeAccessAllowed(management.meta, (code) => code === 'questions:read', false), true);
    assert.equal(access.routeAccessAllowed(management.meta, (code) => code === 'questions:write', false), true);
    assert.equal(access.routeAccessAllowed(importing.meta, (code) => code === 'questions:read', false), false);
    assert.equal(access.routeAccessAllowed(importing.meta, (code) => code === 'questions:write', false), true);
    for (const path of ['/my/exams', '/my/exams/42']) {
      const retired = router.resolve(path);
      assert.equal(retired.meta.title, '页面未找到', path);
      assert.ok(retired.matched.every((route) => !route.path.startsWith('/my/exams')), path);
    }
    for (const path of ['/admin/papers', '/admin/papers/42', '/admin/exam-records', '/admin/exam-records/42']) {
      assert.equal(router.resolve(path).meta.admin, true, path);
    }
  } finally { await vite.close(); }
});
