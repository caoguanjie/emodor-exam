const SOURCE_DATABASE = 'ruleexam';
const SAFE_TEST_DATABASE = /^ruleexam_test_[a-z0-9_]+$/;
const IDENTIFIER = /^[A-Za-z0-9_]+$/;

function assertSafeDatabaseName(database) {
  if (typeof database !== 'string' || !SAFE_TEST_DATABASE.test(database)) {
    throw new Error('database must be an isolated test database named ruleexam_test_<suffix>');
  }
}

function databaseStatements(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('schema SQL is required');
  const switches = [];
  for (const match of sql.matchAll(/\bUSE\s+(`([^`]+)`|([A-Za-z0-9_]+))\s*;/gi)) {
    switches.push({ kind: 'USE', name: match[2] || match[3] });
  }
  for (const match of sql.matchAll(/\bCREATE\s+DATABASE\s+(?:IF\s+NOT\s+EXISTS\s+)?(`([^`]+)`|([A-Za-z0-9_]+))(?=\s|;)/gi)) {
    switches.push({ kind: 'CREATE DATABASE', name: match[2] || match[3] });
  }
  return switches;
}

function assertRecognizedSchema(sql, target) {
  if (/\b(?:DROP|ALTER|RENAME)\s+DATABASE\b/i.test(sql)) {
    throw new Error('unexpected database switch or destructive database statement');
  }
  for (const statement of databaseStatements(sql)) {
    if (!IDENTIFIER.test(statement.name) || (statement.name !== SOURCE_DATABASE && statement.name !== target)) {
      throw new Error(`unexpected database switch: ${statement.kind} ${statement.name}`);
    }
  }
}

export function renderSchemaForDatabase(sql, database) {
  assertSafeDatabaseName(database);
  assertRecognizedSchema(sql, database);
  return sql
    .replace(/\b(CREATE\s+DATABASE\s+(?:IF\s+NOT\s+EXISTS\s+)?)(`ruleexam`|ruleexam)/gi, `$1\`${database}\``)
    .replace(/\b(USE\s+)(`ruleexam`|ruleexam)(?=\s*;)/gi, `$1\`${database}\``);
}

export function validateTestTarget({ database, sql }) {
  assertSafeDatabaseName(database);
  assertRecognizedSchema(sql, database);
  const rendered = renderSchemaForDatabase(sql, database);
  if (/\bUSE\s+`?ruleexam`?\s*;/i.test(rendered)) {
    throw new Error('schema still targets the development database');
  }
  return { database, sql: rendered };
}

export function isSafeTestDatabase(database) {
  return typeof database === 'string' && SAFE_TEST_DATABASE.test(database);
}

export const SOURCE_DATABASE_NAME = SOURCE_DATABASE;
