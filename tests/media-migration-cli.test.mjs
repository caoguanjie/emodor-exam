import test from 'node:test';
import assert from 'node:assert/strict';
import { readMigrationDatabasePassword } from '../scripts/media/migrate-local-to-cos.mjs';

for (const host of ['localhost', '127.0.0.1', '::1']) {
  test(`explicit empty database password is accepted for ${host} development`, () => {
    assert.equal(readMigrationDatabasePassword({ DB_HOST: host, DB_PASSWORD: '', NODE_ENV: 'development' }), '');
  });

  test(`explicit empty database password is accepted for ${host} when NODE_ENV is unset`, () => {
    assert.equal(readMigrationDatabasePassword({ DB_HOST: host, DB_PASSWORD: '' }), '');
  });

  test(`empty database password is rejected for ${host} production`, () => {
    assert.throws(() => readMigrationDatabasePassword({ DB_HOST: host, DB_PASSWORD: '', NODE_ENV: 'production' }),
      { message: 'CONFIG_REQUIRED_DB_PASSWORD' });
  });
}

test('empty database password is rejected for remote or nonexact local hosts', () => {
  for (const host of ['192.0.2.1', 'database.example', 'localhost.example', '127.0.0.2']) {
    assert.throws(() => readMigrationDatabasePassword({ DB_HOST: host, DB_PASSWORD: '', NODE_ENV: 'development' }),
      { message: 'CONFIG_REQUIRED_DB_PASSWORD' });
  }
});

test('missing database password is rejected even for local development', () => {
  assert.throws(() => readMigrationDatabasePassword({ DB_HOST: 'localhost', NODE_ENV: 'development' }),
    { message: 'CONFIG_REQUIRED_DB_PASSWORD' });
  assert.throws(() => readMigrationDatabasePassword({ DB_HOST: 'localhost', DB_PASSWORD: undefined }),
    { message: 'CONFIG_REQUIRED_DB_PASSWORD' });
  assert.throws(() => readMigrationDatabasePassword(Object.assign(Object.create({ DB_PASSWORD: '' }), { DB_HOST: 'localhost' })),
    { message: 'CONFIG_REQUIRED_DB_PASSWORD' });
});

test('empty database password requires development or an unset NODE_ENV', () => {
  for (const environment of ['test', 'staging', '']) {
    assert.throws(() => readMigrationDatabasePassword({ DB_HOST: 'localhost', DB_PASSWORD: '', NODE_ENV: environment }),
      { message: 'CONFIG_REQUIRED_DB_PASSWORD' });
  }
});

test('nonempty database password is preserved without trimming in every environment', () => {
  for (const environment of ['development', 'production']) {
    assert.equal(readMigrationDatabasePassword({ DB_HOST: 'database.example', DB_PASSWORD: ' test-only-noncredential ', NODE_ENV: environment }),
      ' test-only-noncredential ');
  }
});

test('whitespace-only password remains invalid for local development', () => {
  assert.throws(() => readMigrationDatabasePassword({ DB_HOST: 'localhost', DB_PASSWORD: ' ', NODE_ENV: 'development' }),
    { message: 'CONFIG_REQUIRED_DB_PASSWORD' });
});
