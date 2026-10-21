import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const composePath = fileURLToPath(new URL('../docker-compose.yml', import.meta.url));

function serviceEnvironment(source, serviceName) {
  const lines = source.split(/\r?\n/);
  const serviceStart = lines.findIndex((line) => line === `  ${serviceName}:`);
  assert.notEqual(serviceStart, -1, `service ${serviceName} should exist`);
  const environmentStart = lines.findIndex((line, index) => index > serviceStart && line === '    environment:');
  assert.notEqual(environmentStart, -1, `service ${serviceName} should define environment`);

  const environment = {};
  for (const line of lines.slice(environmentStart + 1)) {
    if (/^  \S/.test(line) || /^    \S/.test(line)) break;
    const match = line.match(/^      ([A-Z][A-Z0-9_]*):\s*(.*)$/);
    if (match) environment[match[1]] = match[2];
  }
  return environment;
}

function resolveComposeDefault(value, environment = {}) {
  const match = value?.match(/^\$\{([A-Z][A-Z0-9_]*):-([^}]*)\}$/);
  assert.ok(match, `expected Compose default interpolation, got ${String(value)}`);
  return environment[match[1]] || match[2];
}

test('api service forwards DB_POOL_SIZE with default 20 and honors an explicit override', () => {
  const compose = readFileSync(composePath, 'utf8');
  const apiEnvironment = serviceEnvironment(compose, 'api');

  assert.equal(resolveComposeDefault(apiEnvironment.DB_POOL_SIZE), '20');
  assert.equal(resolveComposeDefault(apiEnvironment.DB_POOL_SIZE, { DB_POOL_SIZE: '7' }), '7');
});
