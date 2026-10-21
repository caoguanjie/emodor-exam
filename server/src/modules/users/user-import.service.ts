import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { SysUser } from '../../entities/sys-user.entity';
import { SysDepartment } from '../../entities/sys-department.entity';
import { Errors, RoleEnum, Role } from '../../common/errors';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../../common/audit.service';
import { UsersService } from './users.service';

interface ImportRow {
  rowNumber: number;
  username: string;
  realName: string;
  employeeNo: string;
  deptPath: string;
  role: string;
  password: string;
}

/**
 * Excel 批量导入子服务（05 册 2.4.4 / UC-09）：
 * 模板 6 列（用户名/姓名/工号/部门路径/角色/初始密码）；
 * 两阶段（预校验 + 批量写 + 唯一冲突降级）部分成功策略，非法行整行失败且不影响其他行。
 */
@Injectable()
export class UserImportService {
  private static readonly HEADERS = ['用户名', '姓名', '工号', '部门', '角色', '初始密码'];
  private static readonly VALID_ROLES: Role[] = [RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN, RoleEnum.EMPLOYEE];

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly usersService: UsersService,
  ) {}

  /** 导入模板下载（GET /users/import-template）：单 Sheet 中文表头 + 示例行 */
  async buildTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('员工导入模板');
    ws.addRow(UserImportService.HEADERS);
    ws.columns.forEach((c) => (c.width = 22));
    ws.getRow(1).font = { bold: true };
    // 示例口令须与预检口径一致（≥8 位且同时包含字母与数字），照模板原样导入不得整行失败
    ws.addRow(['zhangsan', '张三', 'E2026001', '集团总部/生产中心', 'employee', 'Zhang@2026']);
    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }

  /** 文件级校验（07 册 4.3.1）：xlsx 魔数（PK 头 + xl/workbook.xml）、大小 ≤ 5MB、行数 ≤ 1000 */
  private async loadWorkbook(file: Express.Multer.File): Promise<ExcelJS.Workbook> {
    if (!file || !file.buffer || file.buffer.length < 4) throw Errors.param('文件为空');
    if (file.buffer.length > this.config.upload.maxImportSizeMb * 1024 * 1024) throw Errors.fileTooLarge('导入文件超过 5MB 上限');
    if (file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) throw Errors.fileFormat('仅支持 .xlsx Excel 文件');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw Errors.fileFormat('仅支持 .xlsx Excel 文件');
    }
    const ws = wb.worksheets[0];
    if (!ws || ws.actualRowCount < 2) throw Errors.param('文件为空或无数据行');
    const dataRows = ws.rowCount - 1;
    if (dataRows > this.config.upload.maxImportRows) {
      throw Errors.param(`单次导入上限 ${this.config.upload.maxImportRows} 行`);
    }
    return wb;
  }

  private resolveDeptPath = new Map<string, string | null>();

  private async resolveDepartment(path: string): Promise<{ id: string | null; error?: string }> {
    if (this.resolveDeptPath.has(path)) return { id: this.resolveDeptPath.get(path) || null };
    const repo = this.dataSource.getRepository(SysDepartment);
    const parts = path.split('/').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return { id: null, error: '部门不存在' };
    let parentId: string | null = null;
    let current: SysDepartment | null = null;
    for (const part of parts) {
      const qb = repo.createQueryBuilder('d').where('d.name = :name', { name: part });
      if (parentId === null) qb.andWhere('d.parent_id IS NULL');
      else qb.andWhere('d.parent_id = :pid', { pid: parentId });
      current = await qb.getOne();
      if (!current) {
        this.resolveDeptPath.set(path, null);
        return { id: null, error: '部门不存在' };
      }
      parentId = current.id;
    }
    if (current && current.status !== 1) {
      this.resolveDeptPath.set(path, null);
      return { id: null, error: '目标部门已停用' };
    }
    this.resolveDeptPath.set(path, current!.id);
    return { id: current!.id };
  }

  async import(file: Express.Multer.File, actor: { id: number; name: string }, ip: string | null) {
    // 每次导入重置路径缓存：进程级缓存会把「部门不存在」的失败结果带到纠正后的重导入中
    this.resolveDeptPath.clear();
    const wb = await this.loadWorkbook(file);
    const ws = wb.worksheets[0];
    const header = (ws.getRow(1).values as unknown[]) || [];
    for (let i = 0; i < UserImportService.HEADERS.length; i++) {
      if (String(header[i + 1] ?? '').trim() !== UserImportService.HEADERS[i]) {
        throw Errors.param('模板表头不符，请下载最新导入模板填写');
      }
    }

    // 阶段一：预校验（纯内存，不写库）——必填 / 枚举 / 部门路径 / 文件内去重
    const failures: { row: number; reason: string }[] = [];
    const validRows: ImportRow[] = [];
    const seenUsernames = new Set<string>();
    const seenEmployeeNos = new Set<string>();

    const rows: ImportRow[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const get = (col: number) => {
        const v = row.getCell(col).value;
        return v == null ? '' : String(typeof v === 'object' && 'text' in (v as any) ? (v as any).text : v).trim();
      };
      rows.push({
        rowNumber,
        username: get(1),
        realName: get(2),
        employeeNo: get(3),
        deptPath: get(4),
        role: get(5),
        password: get(6),
      });
    });

    const deptCache = new Map<string, { id: string | null; error?: string }>();
    for (const r of rows) {
      const reasons: string[] = [];
      if (!r.username) reasons.push('用户名必填');
      else if (r.username.length > 64) reasons.push('用户名超长');
      if (!r.realName) reasons.push('姓名必填');
      else if (r.realName.length > 64) reasons.push('姓名超长');
      if (!r.employeeNo) reasons.push('工号必填');
      else if (r.employeeNo.length > 32) reasons.push('工号超长');
      if (!r.role) reasons.push('角色必填');
      else if (!UserImportService.VALID_ROLES.includes(r.role as Role)) reasons.push('角色枚举非法');
      if (!r.password || r.password.length < 8 || !/[A-Za-z]/.test(r.password) || !/[0-9]/.test(r.password)) {
        reasons.push('初始密码须 ≥8 位且同时包含字母与数字');
      }
      if (r.username && seenUsernames.has(r.username)) reasons.push('用户名在文件内重复');
      if (r.employeeNo && seenEmployeeNos.has(r.employeeNo)) reasons.push('工号在文件内重复');
      seenUsernames.add(r.username);
      seenEmployeeNos.add(r.employeeNo);

      if (r.deptPath) {
        let resolved = deptCache.get(r.deptPath);
        if (!resolved) {
          resolved = await this.resolveDepartment(r.deptPath);
          deptCache.set(r.deptPath, resolved);
        }
        if (!resolved.id) reasons.push(resolved.error || '部门不存在');
        else r['deptId'] = resolved.id;
      } else {
        reasons.push('部门必填');
      }

      if (reasons.length) failures.push({ row: r.rowNumber, reason: reasons.join('；') });
      else validRows.push(r);
    }

    // 阶段二：写入（部分成功）——批量 INSERT，唯一键冲突降级为逐行定位
    const userRepo = this.dataSource.getRepository(SysUser);
    const toEntity = async (r: ImportRow): Promise<SysUser> =>
      userRepo.create({
        username: r.username,
        passwordHash: await bcrypt.hash(r.password, 12),
        realName: r.realName,
        employeeNo: r.employeeNo,
        departmentId: (r as any).deptId || null,
        role: r.role,
        status: 1,
        lastLoginAt: null,
      });

    let successCount = 0;
    if (validRows.length) {
      try {
        const entities = await Promise.all(validRows.map(toEntity));
        await userRepo.save(entities, { chunk: 200 });
        successCount = validRows.length;
      } catch (e: any) {
        if (String(e?.code) === 'ER_DUP_ENTRY') {
          // 降级：逐行 INSERT 定位冲突行，回填行级原因
          successCount = 0;
          for (const r of validRows) {
            try {
              await userRepo.save(await toEntity(r));
              successCount++;
            } catch (e2: any) {
              if (String(e2?.code) === 'ER_DUP_ENTRY') {
                failures.push({
                  row: r.rowNumber,
                  reason: String(e2?.message || '').includes('uk_employee_no') ? '工号已存在' : '用户名已存在',
                });
              } else {
                failures.push({ row: r.rowNumber, reason: '写入失败' });
              }
            }
          }
        } else {
          throw e;
        }
      }
    }

    const result = { success_count: successCount, fail_count: failures.length, failures };
    this.audit.log({
      actor_id: actor.id, actor_name: actor.name, action: 'user.import', object_type: 'sys_user',
      object_id: null, detail: result as any, result: failures.length ? 'failure' : 'success', source_ip: ip,
    });
    return result;
  }
}
