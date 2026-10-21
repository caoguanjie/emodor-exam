import { describe, it, expect } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { SchemaMigration } from '../src/entities/schema-migration.entity';

describe('schema_migration entity contract', () => {
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
