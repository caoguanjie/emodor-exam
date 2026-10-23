import { describe, expect, it } from 'vitest';
import { UsersService } from '../src/modules/users/users.service';
import { Errors } from '../src/common/errors';
describe('identity authoritative profile name', () => {
  it('does not let the legacy self-profile name field overwrite a verified learner', async () => {
    const row = { id: '7', realName: '合成认证主体', role: 'employee', status: 1 };
    const repo = { findOne: async () => row, save: async (value) => value };
    const manager = { getRepository: () => repo };
    const identity = { assertNameEditable: async (_manager, _id, before, after) => { if (before !== after) throw Errors.param('认证姓名不可修改'); } };
    const service = new (UsersService as any)(repo, { transaction: async (fn) => fn(manager) }, {}, {}, {}, {}, {}, {}, { registerOwnerPolicy: () => {} }, identity);
    await expect(service.updateSelfProfile('7', { real_name: '未经核验的新名字' })).rejects.toMatchObject({ code: 40001 });
    expect(row.realName).toBe('合成认证主体');
  });
});
