import { Injectable } from '@nestjs/common';
import { normalizeChinaMobile } from '../auth/phone';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { ImportBatch } from '../../entities/import-batch.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { TrainingCategory } from '../../entities/training-category.entity';
import { ImportPreview, ImportResult, Id, LearnerSource } from '../../common/training-contracts';
import { Errors } from '../../common/errors';
import { AuditService } from '../../common/audit.service';
import { CategoryService } from '../training/category.service';

export type ImportKind = 'students' | 'questions' | 'questions_ai';

export interface ImportAdapter {
  preview(ownerId: Id, rows: unknown[]): Promise<ImportPreview>;
  commit(ownerId: Id, batchId: Id, rowNumbers: number[]): Promise<ImportResult>;
}

interface StudentRow {
  row: number;
  username: string;
  real_name: string;
  employee_no: string | null;
  phone: string;
  email: string | null;
  source: LearnerSource;
  category_id: Id;
  category_name: string;
  age: number | null;
  gender: string | null;
}

const STUDENT_HEADERS = ['姓名', '年龄', '性别', '培训类别', '手机号', '来源'];
const OLD_STUDENT_HEADERS = ['学生姓名', '年龄', '性别', '培训类别', '手机号'];
const LEGACY_STUDENT_HEADERS = ['用户名', '姓名', '工号', '手机号', '邮箱', '来源', '培训类别ID'];
const STUDENT_FIELDS = new Set(['row', 'username', 'real_name', 'realName', 'employee_no', 'employeeNo', 'phone', 'email', 'source', 'category_id', 'categoryId', 'category', 'category_name', 'age', 'gender', ...STUDENT_HEADERS, ...OLD_STUDENT_HEADERS, ...LEGACY_STUDENT_HEADERS]);
const LEGACY_CREDENTIAL_FIELDS = ['password', 'initial_password', '初始密码', 'password_hash', 'passwordHash'];
const SOURCES = new Set<LearnerSource>(['institution', 'external']);

function safeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value && 'text' in value) return String((value as any).text).trim();
  return String(value).trim();
}

function inputHash(rows: unknown[]): string {
  // The hash intentionally excludes credentials. It is an audit/idempotency
  // hint, not a credential digest, and never becomes an import response field.
  const safeRows = rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const copy = { ...(row as Record<string, unknown>) };
    delete copy.password;
    delete copy.initial_password;
    delete copy['初始密码'];
    return copy;
  });
  return createHash('sha256').update(JSON.stringify(safeRows)).digest('hex');
}

function responsePreview(batch: ImportBatch): ImportPreview {
  return {
    batch_id: String(batch.id),
    valid_rows: Array.isArray(batch.validRows) ? batch.validRows : [],
    errors: Array.isArray(batch.errors) ? batch.errors : [],
    duplicates: Array.isArray(batch.duplicates) ? batch.duplicates : [],
  };
}

@Injectable()
export class ImportBatchService {
  private readonly adapters = new Map<ImportKind, ImportAdapter>();

  constructor(
    @InjectRepository(ImportBatch) private readonly batchRepo: Repository<ImportBatch>,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    @InjectRepository(TrainingCategory) private readonly categoryRepo: Repository<TrainingCategory>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly categories: CategoryService,
  ) {}

  /** B4 registers its question adapter without making this service depend on AI/question modules. */
  registerAdapter(kind: ImportKind, adapter: ImportAdapter) {
    if (kind === 'students') throw Errors.param('学生导入适配器由系统内置');
    this.adapters.set(kind, adapter);
  }

  async preview(ownerId: Id, kind: ImportKind, rows: unknown[]): Promise<ImportPreview> {
    if (!Array.isArray(rows) || rows.length === 0) throw Errors.param('导入数据不能为空');
    if (rows.length > 1000) throw Errors.param('单次导入上限 1000 行');
    if (kind === 'questions' || kind === 'questions_ai') {
      const adapter = this.adapters.get(kind);
      if (!adapter) throw Errors.param('题库导入适配器尚未注册');
      return adapter.preview(String(ownerId), rows);
    }
    return this.previewStudents(String(ownerId), rows);
  }

  async commit(ownerId: Id, batchId: Id, rowNumbers: number[]): Promise<ImportResult> {
    const batch = await this.batchRepo.findOne({
      where: { id: String(batchId), ownerId: String(ownerId), kind: 'students' },
    });
    if (!batch) throw Errors.notFound('导入批次不存在');
    return this.commitStudents(String(ownerId), batch, rowNumbers);
  }

  /**
   * Question routes must not be usable as a confused-deputy entry point for a
   * student batch. Unlike the legacy student route, a known question batch
   * owned by somebody else is an authenticated data-scope violation (40302).
   */
  async commitQuestions(ownerId: Id, batchId: Id, rowNumbers: number[]): Promise<ImportResult> {
    const batch = await this.batchRepo.findOne({ where: { id: String(batchId) } });
    if (!batch) throw Errors.notFound('导入批次不存在');
    if (String(batch.ownerId) !== String(ownerId) || batch.kind !== 'questions') throw Errors.dataForbidden();
    const adapter = this.adapters.get('questions');
    if (!adapter) throw Errors.param('题库导入适配器尚未注册');
    return adapter.commit(String(ownerId), String(batchId), rowNumbers);
  }

  async status(ownerId: Id, batchId: Id): Promise<ImportPreview | ImportResult> {
    const batch = await this.batchRepo.findOne({ where: { id: String(batchId), ownerId: String(ownerId) } });
    if (!batch) throw Errors.notFound('导入批次不存在');
    if (batch.status === 'committed') {
      return {
        batch_id: String(batch.id),
        created_ids: Array.isArray(batch.createdIds) ? batch.createdIds : [],
        committed_rows: Array.isArray(batch.committedRows) ? batch.committedRows : [],
      };
    }
    return responsePreview(batch);
  }

  async questionStatus(ownerId: Id, batchId: Id): Promise<ImportPreview | ImportResult> {
    const batch = await this.batchRepo.findOne({ where: { id: String(batchId) } });
    if (!batch) throw Errors.notFound('导入批次不存在');
    if (String(batch.ownerId) !== String(ownerId) || batch.kind !== 'questions') throw Errors.dataForbidden();
    if (batch.status === 'committed') {
      return {
        batch_id: String(batch.id),
        created_ids: Array.isArray(batch.createdIds) ? batch.createdIds : [],
        committed_rows: Array.isArray(batch.committedRows) ? batch.committedRows : [],
      };
    }
    return responsePreview(batch);
  }

  async buildStudentTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const categories = await this.categoryRepo.find({ where: { status: 1 }, order: { name: 'ASC' } });
    const worksheet = workbook.addWorksheet('学员导入模板');
    worksheet.addRow(STUDENT_HEADERS);
    worksheet.columns = STUDENT_HEADERS.map((header, index) => ({ header, width: [20, 12, 12, 30, 24, 18][index] }));
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = 'A1:F1';
    worksheet.getColumn(5).numFmt = '@';
    for (let row = 2; row <= 1001; row++) {
      worksheet.getCell(row, 2).dataValidation = { type: 'whole', operator: 'between', formulae: [0, 150], allowBlank: true, showErrorMessage: true, errorTitle: '年龄格式不正确', error: '请填写 0—150 的整数，或留空。' };
      worksheet.getCell(row, 3).dataValidation = { type: 'list', formulae: ['"男,女"'], allowBlank: true, showErrorMessage: true, error: '请选择男或女，或留空。' };
      worksheet.getCell(row, 4).dataValidation = { type: 'list', formulae: ['StudentTrainingCategories'], allowBlank: false, showErrorMessage: true, errorStyle: 'stop', errorTitle: '培训类别不正确', error: '培训类别必填，请从下拉列表选择；类别有更新时请重新下载模板。' };
      worksheet.getCell(row, 6).dataValidation = { type: 'list', formulae: ['"本机构,外来"'], allowBlank: true, showErrorMessage: true, error: '请选择本机构或外来；留空时默认本机构。' };
    }
    const examples = workbook.addWorksheet('填写示例');
    examples.addRow(STUDENT_HEADERS);
    examples.getColumn(5).numFmt = '@';
    examples.addRow(['示例学员甲', 28, '男', categories[0]?.name || '请先创建启用培训类别', '138XXXXXXXX', '本机构']);
    examples.addRow(['示例学员乙', 35, '女', categories[1]?.name || categories[0]?.name || '请先创建启用培训类别', '139XXXXXXXX', '外来']);
    examples.addRow([]);
    examples.addRow(['以上为合成示例，不参与导入。手机号必须替换为真实学员本人手机号；请在第一个工作表填写真实数据。']);
    examples.mergeCells('A5:F5');
    examples.getRow(5).height = 48;
    examples.getCell('A5').alignment = { wrapText: true, vertical: 'middle' };
    examples.columns.forEach((column, index) => { column.width = [20, 12, 12, 30, 24, 18][index] || 20; });
    const instructions = workbook.addWorksheet('填写说明');
    instructions.columns = [{ width: 28 }, { width: 110 }];
    [
      ['项目', '填写要求'],
      ['导入范围', '仅导入第一个工作表；填写示例和本说明不会导入。请勿更改表头，空行自动跳过，最多 1000 条学员。'],
      ['姓名 / 手机号', '姓名、本人手机号必填；手机号按文本填写11位大陆手机号码。138XXXXXXXX、139XXXXXXXX是无效占位示例，必须替换。'],
      ['年龄 / 性别', '可留空；年龄为 0—150 整数，性别填写男/女（也兼容 male/female）。年龄不会反推生日。'],
      ['培训类别', '每行必填，请从下拉列表选择下载时启用的类别；类别有更新时请重新下载模板。导入时仍检查，留空、未知或停用类别会报错，不使用默认类别。'],
      ['来源', '填写本机构/外来（兼容 institution/external）；留空时默认本机构。'],
      ['登录方式', '学员通过手机验证码登录；不填写用户名或密码，不接受密码列。'],
      ['旧模板', '兼容旧5列：学生姓名/年龄/性别/培训类别/手机号；来源默认本机构。也兼容旧7列无密码模板。'],
      ['当前启用培训类别', categories.length ? '以下类别来自下载时数据库；实际导入时会重新检查是否启用。' : '当前没有启用类别，请先在培训类别管理中创建或启用，再下载模板。'],
      ...categories.map((category) => [category.name, '可填写的培训类别名称']),
    ].forEach((row) => instructions.addRow(row));
    workbook.definedNames.add(`'填写说明'!$A$10:$A$${9 + Math.max(categories.length, 1)}`, 'StudentTrainingCategories');
    instructions.eachRow((row) => { row.alignment = { wrapText: true, vertical: 'middle' }; row.height = 34; });
    for (const sheet of [worksheet, examples, instructions]) {
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.getRow(1).height = 30;
      sheet.getRow(1).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3156D3' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
    }
    return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
  }

  async parseStudentWorkbook(buffer: Buffer): Promise<unknown[]> {
    if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw Errors.fileFormat('仅支持 .xlsx Excel 文件');
    }
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw Errors.fileFormat('仅支持 .xlsx Excel 文件');
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw Errors.param('文件为空或无数据行');
    const header = worksheet.getRow(1).values as unknown[];
    const headers = [STUDENT_HEADERS, OLD_STUDENT_HEADERS, LEGACY_STUDENT_HEADERS].find((candidate) => (
      candidate.every((expected, index) => safeText(header[index + 1]) === expected)
      && !header.slice(candidate.length + 1).some((value) => safeText(value))
    ));
    if (!headers) {
      throw Errors.param('模板表头不符，请下载最新导入模板填写；学员导入不接受密码列');
    }
    const rows: unknown[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (!(row.values as unknown[]).some((value) => safeText(value))) return;
      if ((row.values as unknown[]).slice(headers.length + 1).some((value) => safeText(value))) {
        throw Errors.param('导入行含模板外数据，请下载最新导入模板填写');
      }
      if (headers !== LEGACY_STUDENT_HEADERS) {
        rows.push({ row: rowNumber, real_name: safeText(row.getCell(1).value), age: safeText(row.getCell(2).value), gender: safeText(row.getCell(3).value), category_name: safeText(row.getCell(4).value), phone: safeText(row.getCell(5).value), source: headers === STUDENT_HEADERS ? safeText(row.getCell(6).value) : '' });
      } else rows.push({
        row: rowNumber,
        username: safeText(row.getCell(1).value),
        real_name: safeText(row.getCell(2).value),
        employee_no: safeText(row.getCell(3).value),
        phone: safeText(row.getCell(4).value),
        email: safeText(row.getCell(5).value),
        source: safeText(row.getCell(6).value),
        category_id: safeText(row.getCell(7).value),
      });
    });
    if (!rows.length) throw Errors.param('文件为空或无数据行');
    if (rows.length > 1000) throw Errors.param('单次导入上限 1000 行');
    return rows;
  }

  private toStudentRow(raw: unknown, index: number): StudentRow {
    const source = raw && typeof raw === 'object'
      ? (raw as any).source ?? (raw as any)['来源']
      : undefined;
    const category = raw && typeof raw === 'object'
      ? (raw as any).category_id ?? (raw as any).categoryId ?? (raw as any)['培训类别ID']
      : undefined;
    const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const age = safeText(record.age ?? record['年龄']);
    const gender = safeText(record.gender ?? record['性别']);
    const row = raw && typeof raw === 'object' ? (raw as any).row : undefined;
    return {
      row: Number.isInteger(Number(row)) && Number(row) > 0 ? Number(row) : index + 2,
      username: safeText(raw && typeof raw === 'object' ? (raw as any).username ?? (raw as any)['用户名'] : '') || `m_${randomBytes(20).toString('hex')}`,
      real_name: safeText(record.real_name ?? record.realName ?? record['姓名'] ?? record['学生姓名']),
      employee_no: safeText(raw && typeof raw === 'object' ? (raw as any).employee_no ?? (raw as any).employeeNo ?? (raw as any)['工号'] : '') || null,
      phone: safeText(raw && typeof raw === 'object' ? (raw as any).phone ?? (raw as any)['手机号'] : ''),
      email: safeText(raw && typeof raw === 'object' ? (raw as any).email ?? (raw as any)['邮箱'] : '') || null,
      source: ({ 本机构: 'institution', 外来: 'external' }[safeText(source)] || safeText(source) || 'institution') as LearnerSource,
      category_id: safeText(category),
      category_name: safeText(record.category_name ?? record['培训类别'] ?? record.category),
      age: age === '' ? null : /^\d+$/.test(age) ? Number(age) : NaN,
      gender: gender === '' ? null : ({ 男: 'male', 女: 'female' }[gender] || gender),
    };
  }

  private async resolveCategory(row: StudentRow): Promise<TrainingCategory | null> {
    if (row.category_name) return this.categoryRepo.findOne({ where: { name: row.category_name } });
    if (!/^[1-9]\d*$/.test(row.category_id)) return null;
    return this.categoryRepo.findOne({ where: { id: row.category_id } });
  }

  /** Match the schema's utf8mb4_0900_ai_ci equality, including case/accent rules. */
  private async duplicateRowsByDbCollation(rows: StudentRow[], field: 'username' | 'employee_no' | 'phone'): Promise<Set<number>> {
    const candidates = rows.filter((row) => Boolean(row[field]));
    if (candidates.length < 2) return new Set();
    const selects = candidates.map(() => 'SELECT CAST(? AS CHAR CHARACTER SET utf8mb4) AS candidate_value, CAST(? AS UNSIGNED) AS row_no').join(' UNION ALL ');
    const params = candidates.flatMap((row) => [row[field], row.row]);
    const duplicateRows = await this.dataSource.query(
      `SELECT row_no FROM (SELECT row_no, COUNT(*) OVER (PARTITION BY candidate_value COLLATE utf8mb4_0900_ai_ci) AS duplicate_count FROM (${selects}) AS candidates) AS grouped WHERE duplicate_count > 1`,
      params,
    );
    return new Set(duplicateRows.map((row: { row_no: number | string }) => Number(row.row_no)));
  }

  private async previewStudents(ownerId: Id, rows: unknown[]): Promise<ImportPreview> {
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Errors.param('学员导入行必须是对象');
      if (Object.keys(raw).some((key) => !STUDENT_FIELDS.has(key))) throw Errors.param('学员导入包含不支持的字段；请使用最新模板，不接受密码字段');
    }
    const errors: Array<{ row: number; message: string }> = [];
    const duplicates: number[] = [];
    const validRows: number[] = [];
    const normalizedRows: Record<string, unknown>[] = [];
    const studentRows = rows.map((raw, index) => this.toStudentRow(raw, index));
    const invalidPhones = new Set<number>();
    for (const row of studentRows) {
      try { row.phone = normalizeChinaMobile(row.phone); }
      catch { invalidPhones.add(row.row); }
    }
    const duplicateUsernames = await this.duplicateRowsByDbCollation(studentRows, 'username');
    const duplicateEmployeeNos = await this.duplicateRowsByDbCollation(studentRows, 'employee_no');
    const duplicatePhones = await this.duplicateRowsByDbCollation(studentRows, 'phone');

    for (const row of studentRows) {
      const reasons: string[] = [];
      if (!row.username) reasons.push('用户名必填');
      else if (row.username.length > 64) reasons.push('用户名超长');
      if (!row.real_name) reasons.push('姓名必填');
      else if (row.real_name.length > 64) reasons.push('姓名超长');
      if (row.employee_no && row.employee_no.length > 32) reasons.push('工号超长');
      if (invalidPhones.has(row.row)) reasons.push('手机号格式不正确');
      if (!SOURCES.has(row.source)) reasons.push('来源必须是 institution 或 external');
      if (!row.category_id && !row.category_name) reasons.push('培训类别必填');
      if (row.age !== null && (!Number.isInteger(row.age) || row.age < 0 || row.age > 150)) reasons.push('年龄须为 0—150 的整数或留空');
      if (row.gender !== null && row.gender !== 'male' && row.gender !== 'female') reasons.push('性别须为男/女或留空');
      if (duplicateUsernames.has(row.row)) reasons.push('用户名在文件内重复');
      if (duplicateEmployeeNos.has(row.row)) reasons.push('工号在文件内重复');
      if (duplicatePhones.has(row.row)) reasons.push('手机号在文件内重复');
      if ((duplicateUsernames.has(row.row) || duplicateEmployeeNos.has(row.row) || duplicatePhones.has(row.row)) && !duplicates.includes(row.row)) duplicates.push(row.row);

      let category: TrainingCategory | null = null;
      if (row.category_id || row.category_name) {
        category = await this.resolveCategory(row);
        if (!category || Number(category.status) !== 1) reasons.push('培训类别不存在或已停用');
        if (category) row.category_id = String(category.id);
      }

      if (!reasons.length && row.username) {
        const existingUsername = await this.userRepo.findOne({ where: { username: row.username } });
        if (existingUsername) reasons.push('用户名已存在');
      }
      if (!reasons.length && row.employee_no) {
        const existingEmployee = await this.userRepo.findOne({ where: { employeeNo: row.employee_no } });
        if (existingEmployee) reasons.push('工号已存在');
      }
      if (!reasons.length && row.phone && await this.userRepo.findOne({ where: { phone: row.phone } })) reasons.push('手机号已存在');

      if (reasons.length) {
        errors.push({ row: row.row, message: reasons.join('；') });
        continue;
      }

      normalizedRows.push({
        row: row.row,
        username: row.username,
        real_name: row.real_name,
        employee_no: row.employee_no,
        phone: row.phone,
        email: row.email,
        source: row.source,
        category_id: row.category_id,
        age: row.age,
        gender: row.gender,
      });
      validRows.push(row.row);
    }

    const batch = await this.batchRepo.save(this.batchRepo.create({
      ownerId: String(ownerId),
      kind: 'students',
      inputHash: inputHash(rows),
      status: 'previewed',
      normalizedRows,
      validRows,
      errors,
      duplicates,
      committedRows: null,
      createdIds: null,
    }));
    this.audit.log({
      actor_id: Number(ownerId), actor_name: `user:${ownerId}`, action: 'student.import.preview',
      object_type: 'import_batch', object_id: batch.id, detail: {
        kind: 'students', valid_rows: validRows.length, error_rows: errors.length, duplicate_rows: duplicates.length,
      }, result: errors.length ? 'failure' : 'success', source_ip: null,
    });
    return responsePreview(batch);
  }

  private async commitStudents(ownerId: Id, batch: ImportBatch, rowNumbers: number[]): Promise<ImportResult> {
    const requested = [...new Set((rowNumbers || []).map((row) => Number(row)))].sort((a, b) => a - b);
    // SMS-only accounts cannot authenticate with this undisclosed placeholder.
    // Hash once per batch before taking locks; administrator promotion sets a
    // separate explicit password. Never run per-row bcrypt work under row locks.
    const placeholderHash = await bcrypt.hash(randomBytes(48).toString('base64'), 12);
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        // The owner+id row lock serializes first confirmation and retry. A
        // second request waits, then observes the committed result instead of
        // creating another set of users.
        const locked = await manager.findOne(ImportBatch, {
          where: { id: String(batch.id), ownerId: String(ownerId) },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) throw Errors.notFound('导入批次不存在');
        const valid = [...new Set((locked.validRows || []).map(Number))].sort((a, b) => a - b);
        if (!requested.length || requested.some((row) => !valid.includes(row))) throw Errors.param('只能确认预检查通过的行');
        if (locked.status === 'committed') {
          const committed = [...(locked.committedRows || [])].sort((a, b) => a - b);
          if (JSON.stringify(committed) !== JSON.stringify(requested)) throw Errors.importBatchConflict();
          return {
            batch_id: String(locked.id),
            created_ids: locked.createdIds || [],
            committed_rows: committed,
          };
        }
        if (locked.status === 'committing') throw Errors.importBatchConflict('导入批次正在确认，请稍后查询状态');
        if ((locked.normalizedRows || []).some((row) => LEGACY_CREDENTIAL_FIELDS.some((key) => key in row))) {
          throw Errors.importBatchConflict('旧版学员导入批次已失效，请使用无密码模板重新预检查');
        }
        const rows = (locked.normalizedRows || []).filter((row) => requested.includes(Number(row.row)));
        if (rows.length !== requested.length) throw Errors.importBatchConflict('导入批次数据已不完整');
        const categoryIds = [...new Set(rows.map((row) => String(row.category_id)))].sort((left, right) => left.localeCompare(right));
        for (const categoryId of categoryIds) await this.categories.lockActive(manager, categoryId);
        locked.status = 'committing';
        await manager.save(locked);
        const repo = manager.getRepository(SysUser);
        const entities = rows.map((row) => repo.create({
          username: String(row.username),
          passwordHash: placeholderHash,
          realName: String(row.real_name),
          employeeNo: row.employee_no ? String(row.employee_no) : null,
          departmentId: null,
          categoryId: String(row.category_id),
          source: String(row.source) as LearnerSource,
          role: 'employee',
          phone: normalizeChinaMobile(typeof row.phone === 'string' ? row.phone : ''),
          email: row.email ? String(row.email) : null,
          age: row.age === undefined || row.age === null ? null : Number(row.age),
          gender: row.gender === 'male' || row.gender === 'female' ? row.gender : null,
          status: 1,
          forcePasswordChange: 0,
          loginCount: 0,
          lastLoginAt: null,
          lastLoginIp: null,
          rolesConfigured: 0,
        }));
        const saved = await repo.save(entities, { chunk: 200 });
        const createdIds = saved.map((user) => String(user.id));
        locked.status = 'committed';
        locked.committedRows = requested;
        locked.createdIds = createdIds;
        await manager.save(locked);
        return { batch_id: String(locked.id), created_ids: createdIds, committed_rows: requested };
      });
      this.audit.log({
        actor_id: Number(ownerId), actor_name: `user:${ownerId}`, action: 'student.import.commit',
        object_type: 'import_batch', object_id: result.batch_id, detail: { committed_rows: result.committed_rows.length },
        result: 'success', source_ip: null,
      });
      return result;
    } catch (error: any) {
      if (String(error?.code) === 'ER_DUP_ENTRY') throw Errors.importBatchConflict('导入数据与现有学员重复，请重新预检查');
      throw error;
    }
  }
}
