import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ImportBatchService } from '../src/modules/imports/import-batch.service';
import { SysUser } from '../src/entities/sys-user.entity';
import { StudentsController } from '../src/modules/users/users.controller';

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
  const category = { id: '7', name: '产业工人', status: 1 };
  const categoryRepo: any = {
    find: async () => [category],
    findOne: async ({ where }: any) => (where.id === '7' || where.name === category.name) ? category : null,
  };
  const service = new ImportBatchService(batchRepo, userRepo, categoryRepo, data, { log: () => undefined } as any, { lockActive: async () => undefined } as any);
  return { service, state };
}

const row = { real_name: '合成学员', phone: '138 0013-8000', source: 'institution', category_id: '7' };

describe('SMS-only managed student import', () => {
  it.each([undefined, null, '', '  '])('previews and commits blank optional category %j as null without assigning any role', async (category_id) => {
    const { service, state } = fixture();
    await expect(service.preview('1', 'students', [{ ...row, category_id }])).resolves.toMatchObject({ valid_rows: [2], errors: [] });
    expect(state.batch.normalizedRows[0].category_id).toBeNull();
    await service.commit('1', '1', [2]);
    expect(state.users[0]).toMatchObject({ categoryId: null, role: 'employee', rolesConfigured: 0, source: 'institution' });
  });

  it.each(['404', 'not-an-id'])('rejects an explicitly supplied invalid category %s', async (category_id) => {
    const { service } = fixture();
    await expect(service.preview('1', 'students', [{ ...row, category_id }])).resolves.toMatchObject({ valid_rows: [], errors: [{ message: '培训类别不存在或已停用' }] });
  });
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

  it('exports usable profile columns, isolated examples and instructions, and rejects a password column', async () => {
    const { service } = fixture();
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await service.buildStudentTemplate() as any);
    const sheet = book.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, '姓名', '年龄', '性别', '培训类别', '手机号', '来源']);
    expect(book.worksheets.map((item) => item.name)).toEqual(['学员导入模板', '填写示例', '填写说明']);
    expect(book.getWorksheet('填写示例')!.actualRowCount).toBeGreaterThan(1);
    expect(JSON.stringify(book.getWorksheet('填写说明')!.getSheetValues())).toContain('产业工人');
    expect(sheet.getCell('D2').dataValidation).toMatchObject({ type: 'list', formulae: ['StudentTrainingCategories'], errorStyle: 'stop', showErrorMessage: true, allowBlank: true });
    expect(book.definedNames.getRanges('StudentTrainingCategories').ranges).toEqual(["'填写说明'!$A$10"]);
    sheet.getRow(2).values = ['合成学员', 28, '男', '产业工人', '13800138000', '本机构'];
    await expect(service.parseStudentWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).resolves.toHaveLength(1);
    const parsed = await service.parseStudentWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    await expect(service.preview('1', 'students', parsed)).resolves.toMatchObject({ valid_rows: [2], errors: [] });
    await service.commit('1', '1', [2]);
    sheet.getCell('G1').value = '初始密码';
    await expect(service.parseStudentWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toMatchObject({ code: 40001 });
  });

  it('persists age and gender and validates invalid profile values per row', async () => {
    const { service, state } = fixture();
    await expect(service.preview('1', 'students', [{ ...row, age: 0, gender: '女' }])).resolves.toMatchObject({ valid_rows: [2] });
    await service.commit('1', '1', [2]);
    expect(state.users[0]).toMatchObject({ age: 0, gender: 'female' });
    for (const profile of [{ age: -1 }, { age: 151 }, { age: 1.5 }, { age: 'abc' }, { gender: '未知值' }]) {
      const fresh = fixture();
      const result = await fresh.service.preview('1', 'students', [{ ...row, ...profile }]);
      expect(result.valid_rows).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
    }
  });

  it('reads the old five-column sheet with institution as the default source', async () => {
    const { service } = fixture();
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Sheet1');
    sheet.addRow(['学生姓名', '年龄', '性别', '培训类别', '手机号']);
    sheet.addRow(['合成学员', 32, '男', '产业工人', '13800138000']);
    const rows: any[] = await service.parseStudentWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(rows).toHaveLength(1);
    await expect(service.preview('1', 'students', rows)).resolves.toMatchObject({ valid_rows: [2], errors: [] });
  });

  it('defaults blank source to institution even with an old page default, while retaining explicit external', async () => {
    const { service, state } = fixture();
    const controller = new StudentsController({} as any, service);
    await controller.preview(undefined, { rows: [{ ...row, source: ' ' }], defaults: { source: 'external' } }, { id: 1 } as any);
    expect(state.batch.normalizedRows[0].source).toBe('institution');
    await service.preview('1', 'students', [{ ...row, source: '外来' }]);
    expect(state.batch.normalizedRows[0].source).toBe('external');
  });

  it('rejects a misspelled category instead of replacing it with the import default', async () => {
    const { service } = fixture();
    const controller = new StudentsController({} as any, service);
    const actor = { id: 1 } as any;
    const defaults = { category_id: '7', source: 'institution' };
    const misspelled = await controller.preview(undefined, { rows: [{ real_name: '合成学员', phone: '13800138000', category_name: '产业公人' }], defaults }, actor);
    expect(misspelled.valid_rows).toEqual([]);
    expect(misspelled.errors[0].message).toContain('培训类别不存在或已停用');
    const blank = await controller.preview(undefined, { rows: [{ real_name: '合成学员', phone: '13800138000', category_name: '' }], defaults }, actor);
    expect(blank.valid_rows).toEqual([2]);
    expect(blank.errors).toEqual([]);
    const trimmed = await controller.preview(undefined, { rows: [{ real_name: '合成学员', phone: '13800138000', category_name: ' 产业工人 ' }], defaults }, actor);
    expect(trimmed.valid_rows).toEqual([2]);
  });
});
