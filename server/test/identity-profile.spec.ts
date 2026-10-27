import { describe, expect, it } from 'vitest';
import { UsersService } from '../src/modules/users/users.service';
import { Errors } from '../src/common/errors';
import { StrictDtoValidationPipe } from '../src/common/dto-validation.pipe';
import { SelfProfileDto } from '../src/modules/users/users.controller';
describe('identity authoritative profile name', () => {
  it('validates the trimmed name length at the HTTP DTO boundary', async () => {
    const pipe = new StrictDtoValidationPipe(['real_name']);
    const dto = await pipe.transform({ real_name: `  ${'学'.repeat(64)}  ` }, { type: 'body', metatype: SelfProfileDto });
    expect(dto.real_name).toBe('学'.repeat(64));
    await expect(pipe.transform({ real_name: '   ' }, { type: 'body', metatype: SelfProfileDto })).rejects.toThrow();
  });
  function unverifiedProfile() {
    const row = { id: '7', realName: '', role: 'employee', status: 1 };
    let saves = 0;
    const repo = { findOne: async () => row, save: async (value) => { saves++; return value; } };
    const manager = { getRepository: () => repo };
    const service = new (UsersService as any)(repo, { transaction: async (fn) => fn(manager) }, {}, {}, {}, {}, {}, {}, { registerOwnerPolicy: () => {} }, { assertNameEditable: async () => {} });
    return { service, row, saves: () => saves };
  }
  it('lets an unverified SMS learner save and correct a trimmed name without requiring an avatar', async () => {
    const f = unverifiedProfile();
    expect(await f.service.updateSelfProfile('7', { real_name: '  合成学员  ' })).toMatchObject({ real_name: '合成学员', avatar_id: null });
    expect(f.row.realName).toBe('合成学员');
    expect(await f.service.updateSelfProfile('7', { real_name: ' 修正姓名 ' })).toMatchObject({ real_name: '修正姓名' });
    expect(f.saves()).toBe(2);
  });
  it.each([null, '', '   ', 7, {}, '学'.repeat(65)])('rejects invalid self-profile name %j before writing', async (value) => {
    const f = unverifiedProfile();
    await expect(f.service.updateSelfProfile('7', { real_name: value })).rejects.toMatchObject({ code: 40001 });
    expect(f.row.realName).toBe(''); expect(f.saves()).toBe(0);
  });

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
