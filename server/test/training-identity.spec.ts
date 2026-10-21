import { describe, expect, it } from 'vitest';
import { UsersService } from '../src/modules/users/users.service';
import { CategoryService } from '../src/modules/training/category.service';
import { ImportBatchService } from '../src/modules/imports/import-batch.service';
import { StrictDtoValidationPipe } from '../src/common/dto-validation.pipe';

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

  it('rejects unknown keys instead of silently stripping them', async () => {
    const pipe = new StrictDtoValidationPipe(['allowed']);
    await expect(pipe.transform({ allowed: 'ok', unexpected: 'reject' }, { type: 'body', metatype: Object } as any))
      .rejects.toMatchObject({ response: { fields: { unexpected: expect.any(Array) } } });
  });

  it('locks and rechecks an active category inside a transaction manager', async () => {
    const service = Object.create(CategoryService.prototype) as CategoryService;
    const calls: any[] = [];
    const manager = {
      findOne: async (...args: any[]) => {
        calls.push(args);
        return { id: '2', status: 1 };
      },
    } as any;
    await expect(service.lockActive(manager, '2')).resolves.toMatchObject({ id: '2', status: 1 });
    expect(calls[0][1].lock).toEqual({ mode: 'pessimistic_write' });
  });

  it('runs a registered question adapter through the batch contract', async () => {
    const service = Object.create(ImportBatchService.prototype) as ImportBatchService & { adapters: Map<string, any>; batchRepo: any };
    service.adapters = new Map();
    service.batchRepo = { findOne: async () => ({ id: '7', kind: 'questions' }) };
    service.registerAdapter('questions', {
      preview: async (_owner: string, rows: unknown[]) => ({ batch_id: '7', valid_rows: rows.map((_row, index) => index + 2), errors: [], duplicates: [] }),
      commit: async (_owner: string, batchId: string, rowNumbers: number[]) => ({ batch_id: batchId, created_ids: ['8'], committed_rows: rowNumbers }),
    });
    await expect(service.preview('1', 'questions', [{ stem: '题目' }])).resolves.toEqual({ batch_id: '7', valid_rows: [2], errors: [], duplicates: [] });
    await expect(service.commit('1', '7', [2])).resolves.toEqual({ batch_id: '7', created_ids: ['8'], committed_rows: [2] });
  });
});
