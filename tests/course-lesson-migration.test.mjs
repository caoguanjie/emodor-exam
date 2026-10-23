import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listMigrations } from '../database/migrate.mjs';

test('023 ships a resumable additive step and inherits the complete 005 lesson invariant', async () => {
  const catalog = await listMigrations();
  const migration = catalog.find((item) => item.id === '023_course_lesson_soft_delete');
  assert.ok(migration, '023 lesson soft-delete migration is required');
  assert.equal(migration.steps.length, 1);
  const [step] = migration.steps;
  assert.equal(step.id, 'lesson_soft_delete');
  assert.equal(step.replacesCheck, '005_courses/create_course_lesson');
  assert.match(step.sql, /^ALTER TABLE `?course_lesson`? ADD COLUMN `?deleted_at`? DATETIME\(3\) NULL/i);
  assert.doesNotMatch(step.sql, /\b(?:DROP|DELETE|UPDATE|INSERT)\b/i);
  const original = catalog.find((item) => item.id === '005_courses').steps.find((item) => item.id === 'create_course_lesson');
  const addedColumn = " OR (COLUMN_NAME = 'deleted_at' AND DATA_TYPE = 'datetime' AND COLUMN_TYPE = 'datetime(3)' AND IS_NULLABLE = 'YES' AND COLUMN_DEFAULT IS NULL AND EXTRA = '')";
  // Retaining all old predicates is essential: replacing 005 with a weak
  // column-exists check would hide drift in its columns and indexes.
  assert.equal(step.checkSql.replace(addedColumn, '').replaceAll('= 11', '= 10'), original.checkSql);
  const init = await readFile(new URL('../database/init.sql', import.meta.url), 'utf8');
  const lessonDdl = init.match(/CREATE TABLE IF NOT EXISTS `course_lesson` \(([\s\S]*?)\) ENGINE/)[1];
  assert.match(lessonDdl, /`deleted_at`\s+DATETIME\(3\) NULL/);
});
