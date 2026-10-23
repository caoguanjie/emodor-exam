import {
  Body, Controller, Get, Param, Patch, Post, Put, Req, Res, UploadedFile, UseInterceptors, Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response, Request } from 'express';
import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { UsersService } from './users.service';
import { ImportBatchService } from '../imports/import-batch.service';
import { Roles } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { SkipEnvelope } from '../../common/response.interceptor';
import { Errors, RoleEnum } from '../../common/errors';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import type { LearnerSource } from '../../common/training-contracts';

const QueryNumber = () => Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : Number(value)));

// 初始/重置口令与首次改密策略对齐（07 册 2.2.3）：≥8 位且同时包含字母与数字，
// 避免出现「初始口令可登录却永远通不过强制改密校验」的口径裂缝
const INITIAL_PASSWORD = () => Matches(/^(?=.*[A-Za-z])(?=.*\d)\S{8,128}$/, { message: 'password 至少 8 位，且同时包含字母与数字' });

class CreateStudentDto {
  @IsString() @MinLength(1) @MaxLength(64) username!: string;
  @IsString() @MinLength(8) @MaxLength(128) @INITIAL_PASSWORD() password!: string;
  @IsString() @MinLength(1) @MaxLength(64) real_name!: string;
  @IsString() @MinLength(1) @MaxLength(32) category_id!: string;
  @IsIn(['institution', 'external']) source!: 'institution' | 'external';
  @IsOptional() @IsString() @MaxLength(32) employee_no?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(128) email?: string;
}

class UpdateStudentDto {
  @IsOptional() @IsString() @MaxLength(64) real_name?: string;
  @IsOptional() @IsString() @MaxLength(32) employee_no?: string;
  @IsOptional() @IsString() @MaxLength(32) category_id?: string;
  @IsOptional() @IsIn(['institution', 'external']) source?: 'institution' | 'external';
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(128) email?: string;
}

class StudentStatusDto {
  @IsInt() status!: number;
}

class StudentResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(128) @INITIAL_PASSWORD() password!: string;
}

class SelfProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) real_name?: string;
  @IsOptional() @IsString() @MaxLength(128) email?: string | null;
  @IsOptional() @IsString() @MaxLength(32) avatar_id?: string | null;
  @IsOptional() @IsString() occupation?: string | null;
  @IsOptional() @IsIn(['male', 'female']) gender?: 'male' | 'female' | null;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) birthday?: string | null;
}

const SELF_PROFILE_FIELDS = ['real_name', 'email', 'avatar_id', 'occupation', 'gender', 'birthday'] as const;

class StudentAvatarDto {
  @IsOptional() @IsString() @MaxLength(32) avatar_id?: string | null;
}

class StudentListQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(1_000_000) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(64) keyword?: string;
  @IsOptional() @IsString() @MaxLength(32) category_id?: string;
  @IsOptional() @IsIn(['institution', 'external']) source?: LearnerSource;
  @IsOptional() @QueryNumber() @IsInt() @IsIn([0, 1]) status?: number;
}

class StudentImportCommitDto {
  @IsArray() @ArrayMinSize(1) @IsInt({ each: true }) row_numbers!: number[];
}

interface StudentImportDefaults {
  source?: LearnerSource;
  category_id?: string;
}

interface StudentImportPreviewBody {
  rows?: unknown[] | string;
  defaults?: StudentImportDefaults | string;
}

const STUDENT_IMPORT_ROW_KEYS = [
  'row', 'username', 'real_name', 'realName', 'employee_no', 'employeeNo', 'phone', 'email',
  'source', 'category_id', 'categoryId', 'category', 'password', 'initial_password',
  '用户名', '姓名', '工号', '手机号', '邮箱', '来源', '培训类别ID', '初始密码',
] as const;

function assertImportObject(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param(`${label} 必须是对象`);
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`${label} 包含不支持的字段：${unknown.join(',')}`);
  return record;
}

function parseImportRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      throw Errors.param('rows 必须是合法 JSON 数组');
    }
  }
  throw Errors.param('rows 必须是数组');
}

function parseImportDefaults(value: unknown): StudentImportDefaults {
  if (value === undefined || value === null || value === '') return {};
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw Errors.param('defaults 必须是合法 JSON 对象');
    }
  }
  const record = assertImportObject(parsed, ['source', 'category_id'], 'defaults');
  if (record.source !== undefined && record.source !== 'institution' && record.source !== 'external') {
    throw Errors.param('defaults.source 来源枚举非法');
  }
  if (record.category_id !== undefined && typeof record.category_id !== 'string') {
    throw Errors.param('defaults.category_id 必须是字符串');
  }
  return record as StudentImportDefaults;
}

/** /admin/students：新培训学员接口；A3 接入后将权限标识收敛为 students:*。 */
@Controller('admin/students')
@Roles(RoleEnum.SUPER_ADMIN)
export class StudentsController {
  constructor(
    private readonly users: UsersService,
    private readonly importer: ImportBatchService,
  ) {}

  private actor(user: AuthUser) {
    return { id: user.id, name: user.username };
  }

  @Get()
  @Permissions('students:read')
  list(@Query(new StrictDtoValidationPipe(['page', 'page_size', 'keyword', 'category_id', 'source', 'status'])) query: StudentListQueryDto, @Req() req: Request) {
    assertImportObject(req.query, ['page', 'page_size', 'keyword', 'category_id', 'source', 'status'], '查询参数');
    return this.users.listStudents(query);
  }

  @Get('import-template')
  @Permissions('students:write')
  @SkipEnvelope()
  async template(@Res() res: Response) {
    const buffer = await this.importer.buildStudentTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.xlsx"');
    res.end(buffer);
  }

  @Get('import-batches/:id')
  @Permissions('students:write')
  batchStatus(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.importer.status(String(user.id), id);
  }

  @Post('import-preview')
  @Permissions('students:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async preview(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: StudentImportPreviewBody,
    @CurrentUser() user: AuthUser,
  ) {
    const bodyRecord = assertImportObject(body || {}, ['rows', 'defaults'], '导入请求');
    let rows: unknown[] = file ? await this.importer.parseStudentWorkbook(file.buffer) : parseImportRows(bodyRecord.rows);
    const defaults = parseImportDefaults(bodyRecord.defaults);
    rows = rows.map((row: unknown) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const rowRecord = assertImportObject(row, STUDENT_IMPORT_ROW_KEYS, '导入行');
      return {
        ...rowRecord,
        source: rowRecord.source || defaults.source,
        category_id: rowRecord.category_id || defaults.category_id,
      };
    });
    return this.importer.preview(String(user.id), 'students', rows);
  }

  @Post('import-batches/:id/commit')
  @Permissions('students:write')
  async commit(@Param('id') id: string, @Body(new StrictDtoValidationPipe(['row_numbers'])) body: StudentImportCommitDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertImportObject(req.body, ['row_numbers'], '导入确认请求');
    return this.importer.commit(String(user.id), id, body.row_numbers);
  }

  @Get(':id')
  @Permissions('students:read')
  detail(@Param('id') id: string) {
    return this.users.studentDetail(id);
  }

  @Post()
  @Permissions('students:write')
  create(@Body(new StrictDtoValidationPipe(['username', 'password', 'real_name', 'category_id', 'source', 'employee_no', 'phone', 'email'])) dto: CreateStudentDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertImportObject(req.body, ['username', 'password', 'real_name', 'category_id', 'source', 'employee_no', 'phone', 'email'], '学员请求');
    return this.users.createStudent(dto, this.actor(user), req.ip || null);
  }

  @Put(':id')
  @Permissions('students:write')
  update(@Param('id') id: string, @Body(new StrictDtoValidationPipe(['real_name', 'employee_no', 'category_id', 'source', 'phone', 'email'])) dto: UpdateStudentDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertImportObject(req.body, ['real_name', 'employee_no', 'category_id', 'source', 'phone', 'email'], '学员请求');
    return this.users.updateStudent(id, dto, this.actor(user), req.ip || null);
  }

  @Put(':id/status')
  @Permissions('students:write')
  status(@Param('id') id: string, @Body(new StrictDtoValidationPipe(['status'])) dto: StudentStatusDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertImportObject(req.body, ['status'], '学员状态请求');
    if (dto.status !== 0 && dto.status !== 1) throw Errors.param('status 取值非法');
    return this.users.setStudentStatus(id, dto.status as 0 | 1, this.actor(user), req.ip || null);
  }

  @Put(':id/avatar')
  @Permissions('students:write')
  updateAvatar(@Param('id') id: string, @Body(new StrictDtoValidationPipe(['avatar_id'])) dto: StudentAvatarDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertImportObject(req.body, ['avatar_id'], '学员头像请求');
    return this.users.updateStudentAvatar(id, dto.avatar_id || null, this.actor(user), req.ip || null);
  }

  @Put(':id/password')
  @Permissions('students:write')
  async resetPassword(@Param('id') id: string, @Body(new StrictDtoValidationPipe(['password'])) dto: StudentResetPasswordDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertImportObject(req.body, ['password'], '学员密码请求');
    await this.users.resetStudentPassword(id, dto.password, this.actor(user), req.ip || null);
    return null;
  }
}

/** 学员与管理员共用的本人资料；source/category/role 永远不由本人接口接受。 */
@Controller('me')
export class MeProfileController {
  constructor(private readonly users: UsersService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.users.selfProfile(String(user.id));
  }

  @Patch('profile')
  update(
    @Body(new StrictDtoValidationPipe(SELF_PROFILE_FIELDS)) dto: SelfProfileDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertImportObject(req.body, SELF_PROFILE_FIELDS, '本人资料请求');
    return this.users.updateSelfProfile(String(user.id), dto);
  }

  /** 微信小程序 request 不支持 PATCH，使用相同的受控资料保存契约。 */
  @Post('profile')
  updateViaPost(
    @Body(new StrictDtoValidationPipe(SELF_PROFILE_FIELDS)) dto: SelfProfileDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.update(dto, user, req);
  }
}
