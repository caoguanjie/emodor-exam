import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const composePath = fileURLToPath(new URL('../docker-compose.yml', import.meta.url));

function serviceConfiguration(source, serviceName) {
  const lines = source.split(/\r?\n/);
  const serviceStart = lines.findIndex((line) => line === `  ${serviceName}:`);
  assert.notEqual(serviceStart, -1, `service ${serviceName} should exist`);
  const serviceEnd = lines.findIndex((line, index) => index > serviceStart && /^  \S/.test(line));
  return lines.slice(serviceStart + 1, serviceEnd === -1 ? lines.length : serviceEnd);
}

function serviceEnvironment(source, serviceName) {
  const lines = serviceConfiguration(source, serviceName);
  const environmentStart = lines.findIndex((line) => line === '    environment:');
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

test('api service forwards media storage, upload and signed delivery settings with their existing defaults', () => {
  const compose = readFileSync(composePath, 'utf8');
  const apiEnvironment = serviceEnvironment(compose, 'api');
  const cases = [
    ['MEDIA_STORAGE_PROVIDER', 'local', 'cos'],
    ['COS_BUCKET', '', 'compose-test-1000000000'],
    ['COS_REGION', '', 'ap-guangzhou'],
    ['COS_KEY_PREFIX', 'ruleexam/dev/', 'ruleexam/compose-test/'],
    ['COS_SECRET_ID', '', 'test-only-id'],
    ['COS_SECRET_KEY', '', 'test-only-key'],
    ['COS_SESSION_TOKEN', '', 'test-only-session'],
    ['MEDIA_UPLOAD_SESSION_TTL_SECONDS', '86400', '172800'],
    ['MEDIA_UPLOAD_RECEIPT_TTL_SECONDS', '2592000', '5184000'],
    ['MEDIA_MULTIPART_THRESHOLD_BYTES', '16777216', '33554432'],
    ['MEDIA_UPLOAD_PART_SIZE_BYTES', '8388608', '16777216'],
    ['MEDIA_UPLOAD_PARALLEL_LIMIT', '3', '4'],
    ['MEDIA_UPLOAD_GRANT_TTL_SECONDS', '1800', '3600'],
    ['MEDIA_FINALIZER_CONCURRENCY', '2', '4'],
    ['MEDIA_FINALIZER_LEASE_SECONDS', '120', '180'],
    ['MEDIA_FINALIZER_RENEW_SECONDS', '30', '45'],
    ['MEDIA_FINALIZER_MAX_ATTEMPTS', '5', '8'],
    ['MEDIA_ORPHAN_GRACE_SECONDS', '86400', '172800'],
    ['MEDIA_DELIVERY_MODE', 'proxy', 'cos-signed'],
    ['MEDIA_READ_URL_TTL_SECONDS', '300', '600'],
    ['MEDIA_VIDEO_URL_TTL_SECONDS', '300', '900'],
  ];

  for (const [name, defaultValue, overrideValue] of cases) {
    assert.ok(Object.hasOwn(apiEnvironment, name), `api should forward ${name}`);
    assert.equal(resolveComposeDefault(apiEnvironment[name]), defaultValue, `${name} default`);
    assert.equal(resolveComposeDefault(apiEnvironment[name], { [name]: '' }), defaultValue, `${name} empty value`);
    assert.equal(resolveComposeDefault(apiEnvironment[name], { [name]: overrideValue }), overrideValue, `${name} override`);
  }
});

test('frontend service does not receive COS credentials through build or runtime configuration', () => {
  const compose = readFileSync(composePath, 'utf8');
  const nginxConfiguration = serviceConfiguration(compose, 'nginx').join('\n');

  assert.doesNotMatch(nginxConfiguration, /\bCOS_(?:SECRET_ID|SECRET_KEY|SESSION_TOKEN)\b/);
  assert.doesNotMatch(nginxConfiguration, /^    env_file:/m);
});
