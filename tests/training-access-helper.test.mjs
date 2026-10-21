import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomStrongPassword } from './training-access.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { validatePasswordStrength } = require('../server/dist/common/password-policy.js');

test('randomStrongPassword stays compatible with the production 3-character personal-field rule', () => {
  const username = 'race_employee_abcdef12';
  const realName = '并发员工';

  for (let attempt = 0; attempt < 256; attempt += 1) {
    const password = randomStrongPassword(username, realName);
    assert.doesNotThrow(() => validatePasswordStrength(
      password,
      { username, realName },
      'fixture password',
    ));
  }
});
