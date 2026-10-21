import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateTestTarget, renderSchemaForDatabase } from './support/test-target.mjs';

const ROOT = join(import.meta.dirname, '..');
const schema = readFileSync(join(ROOT, 'database', 'init.sql'), 'utf8');

test('rejects the development database before schema execution', () => {
  assert.throws(() => validateTestTarget({ database: 'ruleexam', sql: schema }), /test database/i);
});

test('rewrites the known schema database to the isolated target', () => {
  const target = validateTestTarget({ database: 'ruleexam_test_training', sql: schema });

  assert.equal(target.database, 'ruleexam_test_training');
  assert.match(target.sql, /USE `ruleexam_test_training`/);
  assert.doesNotMatch(target.sql, /USE `ruleexam`/);
  assert.match(target.sql, /CREATE DATABASE IF NOT EXISTS `ruleexam_test_training`/);
  assert.equal(schema.includes('USE `ruleexam`'), true);
});

test('rejects an unexpected database switch instead of rewriting it', () => {
  assert.throws(
    () => validateTestTarget({ database: 'ruleexam_test_training', sql: schema + '\nUSE `other_db`;' }),
    /database switch|unexpected database/i,
  );
});

test('rejects an unexpected CREATE DATABASE even when it has trailing options', () => {
  assert.throws(
    () => validateTestTarget({ database: 'ruleexam_test_training', sql: 'CREATE DATABASE `other_db` DEFAULT CHARACTER SET utf8mb4;' }),
    /unexpected database/i,
  );
});

test('rejects destructive database statements in a schema payload', () => {
  assert.throws(
    () => validateTestTarget({ database: 'ruleexam_test_training', sql: schema + '\nDROP DATABASE `other_db`;' }),
    /destructive|unexpected database/i,
  );
});

test('rejects unsafe target names and does not permit identifier injection', () => {
  for (const database of ['ruleexam_test', 'ruleexam_test_training; DROP DATABASE ruleexam', 'ruleexam_tmp']) {
    assert.throws(() => validateTestTarget({ database, sql: schema }), /test database|safe|target/i);
  }
});

test('renders only the recognized CREATE DATABASE and USE statements', () => {
  const rendered = renderSchemaForDatabase(schema, 'ruleexam_test_training');

  assert.equal((rendered.match(/`ruleexam_test_training`/g) || []).length, 2);
  assert.doesNotMatch(rendered, /`ruleexam`\s*;/);
});

test('rewrites recognized unquoted database statements without leaving a development switch', () => {
  const rendered = renderSchemaForDatabase('CREATE DATABASE IF NOT EXISTS ruleexam;\nUSE ruleexam;', 'ruleexam_test_training');
  assert.match(rendered, /CREATE DATABASE IF NOT EXISTS `ruleexam_test_training`/);
  assert.match(rendered, /USE `ruleexam_test_training`/);
  assert.doesNotMatch(rendered, /USE\s+ruleexam\s*;/i);
});
