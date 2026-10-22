import test from 'node:test';
import assert from 'node:assert/strict';
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
    '/admin/students', '/admin/questions', '/admin/exam-records/88', '/admin/training-statistics',
    '/my/regulations', '/my/exams',
  ]) assert.equal(isRetiredAdminPath?.(path), false, path);
});
