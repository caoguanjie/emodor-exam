import test from 'node:test';
import assert from 'node:assert/strict';
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
