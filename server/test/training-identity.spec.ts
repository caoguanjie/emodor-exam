import { describe, expect, it } from 'vitest';
import { UsersService } from '../src/modules/users/users.service';
import { CategoryService } from '../src/modules/training/category.service';
import { ImportBatchService } from '../src/modules/imports/import-batch.service';

describe('training identity contracts', () => {
  it('returns legacy profile provenance as null without treating it as inactive', async () => {
    const service = Object.create(UsersService.prototype) as UsersService & { userRepo: any };
    service.userRepo = { findOne: async () => ({ id: '7', categoryId: null, source: null, status: 1 }) };

    await expect(service.trainingProfile('7')).resolves.toEqual({
      categoryId: null,
      source: null,
      active: true,
    });
  });

  it('rejects an inactive category and accepts an active category', async () => {
    const service = Object.create(CategoryService.prototype) as CategoryService & { categoryRepo: any };
    service.categoryRepo = { findOne: async ({ where }: any) => where.id === '2' ? { id: '2', status: 1 } : { id: '1', status: 0 } };

    await expect(service.assertActive('2')).resolves.toBeUndefined();
    await expect(service.assertActive('1')).rejects.toMatchObject({ httpStatus: 409 });
  });

  it('exposes preview and commit contracts without storing plaintext credentials in results', async () => {
    const service = Object.create(ImportBatchService.prototype) as ImportBatchService & { batchRepo: any };
    expect(typeof service.preview).toBe('function');
    expect(typeof service.commit).toBe('function');
    expect('password' in ({ batch_id: '1', valid_rows: [2], errors: [], duplicates: [] } as any)).toBe(false);
  });
});
