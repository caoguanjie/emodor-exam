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
  } finally { await vite.close(); }
});
