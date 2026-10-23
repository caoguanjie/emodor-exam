import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ImportBatchService } from '../src/modules/imports/import-batch.service';
import { SysUser } from '../src/entities/sys-user.entity';

function fixture() {
  const state: any = { batch: null, users: [] };
  const batchRepo: any = {
    create: (value: any) => ({ id: '1', ...value }),
    save: async (value: any) => { state.batch = value; return value; },
    findOne: async () => state.batch,
  };
  const userRepo: any = {
    findOne: async ({ where }: any) => state.users.find((row: any) => Object.entries(where).every(([key, value]) => row[key] === value)) || null,
    create: (value: any) => value,
    save: async (values: any[]) => { state.users.push(...values.map((value, index) => ({ id: String(index + 1), ...value }))); return state.users; },
  };
  const manager: any = { findOne: async () => state.batch, save: batchRepo.save, getRepository: (entity: any) => { if (entity !== SysUser) throw new Error('unexpected repository'); return userRepo; } };
  const data: any = {
    transaction: async (callback: any) => callback(manager),
    query: async (_sql: string, params: any[]) => {
      const result: any[] = [];
      for (let index = 0; index < params.length; index += 2) {
        if (params.filter((value, position) => position % 2 === 0 && value === params[index]).length > 1) result.push({ row_no: params[index + 1] });
      }
      return result;
    },
  };
  const service = new ImportBatchService(batchRepo, userRepo, { findOne: async () => ({ id: '7', status: 1 }) } as any, data, { log: () => undefined } as any, { lockActive: async () => undefined } as any);
  return { service, state };
}

const row = { real_name: '合成学员', phone: '138 0013-8000', source: 'institution', category_id: '7' };

describe('SMS-only managed student import', () => {
  it('previews without credentials and commits a normalized SMS learner idempotently', async () => {
    const { service, state } = fixture();
    await expect(service.preview('1', 'students', [row])).resolves.toMatchObject({ valid_rows: [2], errors: [] });
    expect(state.batch.normalizedRows[0]).toMatchObject({ phone: '13800138000', username: expect.stringMatching(/^m_/) });
    expect(Object.keys(state.batch.normalizedRows[0]).some((key) => /password/.test(key))).toBe(false);
    await expect(service.commit('1', '1', [2])).resolves.toMatchObject({ created_ids: ['1'] });
    expect(state.users[0]).toMatchObject({ phone: '13800138000', forcePasswordChange: 0, passwordHash: expect.stringMatching(/^\$2[aby]\$/) });
    await service.commit('1', '1', [2]);
    expect(state.users).toHaveLength(1);
  });

  it('rejects missing, duplicate and existing normalized phones in preview', async () => {
    const { service, state } = fixture();
    await expect(service.preview('1', 'students', [{ ...row, phone: '' }])).resolves.toMatchObject({ valid_rows: [], errors: [{ row: 2, message: expect.stringContaining('手机号') }] });
    await expect(service.preview('1', 'students', [row, { ...row, phone: '13800138000' }])).resolves.toMatchObject({ valid_rows: [], duplicates: [2, 3] });
    state.users.push({ phone: '13800138000' });
    await expect(service.preview('1', 'students', [row])).resolves.toMatchObject({ valid_rows: [], errors: [{ message: '手机号已存在' }] });
  });

  it.each(['password', 'initial_password', '初始密码', 'password_hash'])('rejects incoming and pending legacy credential field %s', async (field) => {
    const { service, state } = fixture();
    await expect(service.preview('1', 'students', [{ ...row, [field]: 'legacy' }])).rejects.toMatchObject({ code: 40001 });
    expect(state.batch).toBeNull();
    await service.preview('1', 'students', [row]);
    state.batch.normalizedRows[0][field] = 'legacy';
    await expect(service.commit('1', '1', [2])).rejects.toMatchObject({ code: 40911 });
    expect(state.users).toHaveLength(0);
  });

  it('exports seven columns and rejects an old password column', async () => {
    const { service } = fixture();
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await service.buildStudentTemplate() as any);
    const sheet = book.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, '用户名', '姓名', '工号', '手机号', '邮箱', '来源', '培训类别ID']);
    sheet.addRow(['', '合成学员', '', '13800138000', '', 'institution', '7']);
    await expect(service.parseStudentWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).resolves.toHaveLength(1);
    sheet.getCell('H1').value = '初始密码';
    await expect(service.parseStudentWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toMatchObject({ code: 40001 });
  });
});
