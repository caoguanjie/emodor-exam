import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { ImportBatch } from '../../entities/import-batch.entity';
import { SysUser } from '../../entities/sys-user.entity';
import { TrainingCategory } from '../../entities/training-category.entity';
import { ImportPreview, ImportResult, Id, LearnerSource } from '../../common/training-contracts';
import { Errors } from '../../common/errors';
import { validatePasswordStrength } from '../../common/password-policy';
import { AuditService } from '../../common/audit.service';
import { CategoryService } from '../training/category.service';

export type ImportKind = 'students' | 'questions';

export interface ImportAdapter {
  preview(ownerId: Id, rows: unknown[]): Promise<ImportPreview>;
  commit(ownerId: Id, batchId: Id, rowNumbers: number[]): Promise<ImportResult>;
}

interface StudentRow {
  row: number;
  username: string;
  real_name: string;
  employee_no: string | null;
  phone: string | null;
  email: string | null;
  source: LearnerSource;
  category_id: Id;
  password: string;
}

interface NormalizedStudentRow extends Omit<StudentRow, 'password'> {
  password_hash: string;
}

const STUDENT_HEADERS = ['用户名', '姓名', '工号', '手机号', '邮箱', '来源', '培训类别ID', '初始密码'];
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
    if (kind === 'questions') {
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
    const worksheet = workbook.addWorksheet('学员导入模板');
    worksheet.addRow(STUDENT_HEADERS);
    worksheet.columns.forEach((column) => { column.width = 20; });
    worksheet.getRow(1).font = { bold: true };
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
    if (!worksheet || worksheet.actualRowCount < 2) throw Errors.param('文件为空或无数据行');
    if (worksheet.actualRowCount - 1 > 1000) throw Errors.param('单次导入上限 1000 行');
    const header = worksheet.getRow(1).values as unknown[];
    STUDENT_HEADERS.forEach((expected, index) => {
      if (safeText(header[index + 1]) !== expected) throw Errors.param('模板表头不符，请下载最新导入模板填写');
    });
    const rows: unknown[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      rows.push({
        row: rowNumber,
        username: safeText(row.getCell(1).value),
        real_name: safeText(row.getCell(2).value),
        employee_no: safeText(row.getCell(3).value),
        phone: safeText(row.getCell(4).value),
        email: safeText(row.getCell(5).value),
        source: safeText(row.getCell(6).value),
        category_id: safeText(row.getCell(7).value),
        password: safeText(row.getCell(8).value),
      });
    });
    return rows;
  }

  private toStudentRow(raw: unknown, index: number): StudentRow {
    const source = raw && typeof raw === 'object'
      ? (raw as any).source ?? (raw as any)['来源']
      : undefined;
    const category = raw && typeof raw === 'object'
      ? (raw as any).category_id ?? (raw as any).categoryId ?? (raw as any).category ?? (raw as any)['培训类别ID']
      : undefined;
    const row = raw && typeof raw === 'object' ? (raw as any).row : undefined;
    return {
      row: Number.isInteger(Number(row)) && Number(row) > 0 ? Number(row) : index + 2,
      username: safeText(raw && typeof raw === 'object' ? (raw as any).username ?? (raw as any)['用户名'] : ''),
      real_name: safeText(raw && typeof raw === 'object' ? (raw as any).real_name ?? (raw as any).realName ?? (raw as any)['姓名'] : ''),
      employee_no: safeText(raw && typeof raw === 'object' ? (raw as any).employee_no ?? (raw as any).employeeNo ?? (raw as any)['工号'] : '') || null,
      phone: safeText(raw && typeof raw === 'object' ? (raw as any).phone ?? (raw as any)['手机号'] : '') || null,
      email: safeText(raw && typeof raw === 'object' ? (raw as any).email ?? (raw as any)['邮箱'] : '') || null,
      source: safeText(source) as LearnerSource,
      category_id: safeText(category),
      password: safeText(raw && typeof raw === 'object' ? (raw as any).password ?? (raw as any).initial_password ?? (raw as any)['初始密码'] : ''),
    };
  }

  private async resolveCategory(value: string): Promise<TrainingCategory | null> {
    if (!value) return null;
    const byId = await this.categoryRepo.findOne({ where: { id: value } });
    if (byId) return byId;
    return this.categoryRepo.findOne({ where: { name: value } });
  }

  /** Match the schema's utf8mb4_0900_ai_ci equality, including case/accent rules. */
  private async duplicateRowsByDbCollation(rows: StudentRow[], field: 'username' | 'employee_no'): Promise<Set<number>> {
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
    const errors: Array<{ row: number; message: string }> = [];
    const duplicates: number[] = [];
    const validRows: number[] = [];
    const normalizedRows: Record<string, unknown>[] = [];
    const studentRows = rows.map((raw, index) => this.toStudentRow(raw, index));
    const duplicateUsernames = await this.duplicateRowsByDbCollation(studentRows, 'username');
    const duplicateEmployeeNos = await this.duplicateRowsByDbCollation(studentRows, 'employee_no');

    for (const row of studentRows) {
      const reasons: string[] = [];
      if (!row.username) reasons.push('用户名必填');
      else if (row.username.length > 64) reasons.push('用户名超长');
      if (!row.real_name) reasons.push('姓名必填');
      else if (row.real_name.length > 64) reasons.push('姓名超长');
      if (row.employee_no && row.employee_no.length > 32) reasons.push('工号超长');
      if (!SOURCES.has(row.source)) reasons.push('来源必须是 institution 或 external');
      if (!row.category_id) reasons.push('培训类别必填');
      if (!row.password) reasons.push('初始密码必填');
      else {
        try {
          validatePasswordStrength(row.password, {
            username: row.username,
            employeeNo: row.employee_no,
            realName: row.real_name,
          }, '初始密码');
        } catch (error: any) {
          reasons.push(error?.message || '初始密码不符合要求');
        }
      }
      if (duplicateUsernames.has(row.row)) reasons.push('用户名在文件内重复');
      if (duplicateEmployeeNos.has(row.row)) reasons.push('工号在文件内重复');
      if ((duplicateUsernames.has(row.row) || duplicateEmployeeNos.has(row.row)) && !duplicates.includes(row.row)) duplicates.push(row.row);

      let category: TrainingCategory | null = null;
      if (row.category_id) {
        category = await this.resolveCategory(row.category_id);
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

      if (reasons.length) {
        errors.push({ row: row.row, message: reasons.join('；') });
        continue;
      }

      const hash = await bcrypt.hash(row.password, 12);
      normalizedRows.push({
        row: row.row,
        username: row.username,
        real_name: row.real_name,
        employee_no: row.employee_no,
        phone: row.phone,
        email: row.email,
        source: row.source,
        category_id: row.category_id,
        password_hash: hash,
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
        const rows = (locked.normalizedRows || []).filter((row) => requested.includes(Number(row.row)));
        if (rows.length !== requested.length) throw Errors.importBatchConflict('导入批次数据已不完整');
        const categoryIds = [...new Set(rows.map((row) => String(row.category_id)))].sort((left, right) => left.localeCompare(right));
        for (const categoryId of categoryIds) await this.categories.lockActive(manager, categoryId);
        locked.status = 'committing';
        await manager.save(locked);
        const repo = manager.getRepository(SysUser);
        const entities = rows.map((row) => repo.create({
          username: String(row.username),
          passwordHash: String(row.password_hash),
          realName: String(row.real_name),
          employeeNo: row.employee_no ? String(row.employee_no) : null,
          departmentId: null,
          categoryId: String(row.category_id),
          source: String(row.source) as LearnerSource,
          role: 'employee',
          phone: row.phone ? String(row.phone) : null,
          email: row.email ? String(row.email) : null,
          status: 1,
          forcePasswordChange: 1,
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
