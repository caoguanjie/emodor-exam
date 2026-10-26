import { describe, it, expect } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { SchemaMigration } from '../src/entities/schema-migration.entity';
import { Question } from '../src/entities/question.entity';

describe('schema_migration entity contract', () => {
  it('maps deletion as an ordinary nullable timestamp so historical reads are never implicitly filtered', () => {
    const column = getMetadataArgsStorage().columns.find((item) => item.target === Question && item.propertyName === 'deletedAt');
    expect(column?.mode).toBe('regular');
    expect(column?.options).toMatchObject({ name: 'deleted_at', type: 'datetime', precision: 3, nullable: true });
  });
  it('maps a separate enabled identity fact without replacing historical review columns', () => {
    const columns = getMetadataArgsStorage().columns.filter((item) => item.target === Question);
    expect(columns.find((item) => item.propertyName === 'isEnabled')?.options).toMatchObject({ name: 'is_enabled', type: 'tinyint', width: 1, default: true });
    expect(columns.map((item) => item.propertyName)).toEqual(expect.arrayContaining(['status', 'conceptId', 'score', 'currentVersionId']));
  });
  it('maps the migration registry columns without widening business entities', () => {
    const table = getMetadataArgsStorage().tables.find((item) => item.target === SchemaMigration);
    expect(table?.name).toBe('schema_migration');
    const columns = getMetadataArgsStorage().columns
      .filter((item) => item.target === SchemaMigration)
      .map((item) => item.options.name || item.propertyName);
    expect(columns.sort()).toEqual([
      'applied_at', 'attempts', 'checksum', 'error_message', 'migration_id', 'progress', 'started_at', 'status',
    ]);
  });
});
