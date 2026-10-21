import {
  Body, Controller, Get, Param, Patch, Post, Put, Req, Res, UploadedFile, UseInterceptors, Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response, Request } from 'express';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { UsersService } from './users.service';
import { UserImportService } from './user-import.service';
import { ImportBatchService } from '../imports/import-batch.service';
import { Roles } from '../../common/guards/roles.guard';
import { SkipEnvelope } from '../../common/response.interceptor';
import { Errors, RoleEnum } from '../../common/errors';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';

// 部门 id 统一按字符串校验；列表接口返回 number（sanitize Number()），容忍客户端原样回传
const NormalizeDeptId = () => Transform(({ value }) => (value === undefined || value === null || value === '' ? value : String(value)));

// 初始/重置口令与首次改密策略对齐（07 册 2.2.3）：≥8 位且同时包含字母与数字，
// 避免出现「初始口令可登录却永远通不过强制改密校验」的口径裂缝
const INITIAL_PASSWORD = () => Matches(/^(?=.*[A-Za-z])(?=.*\d)\S{8,128}$/, { message: 'password 至少 8 位，且同时包含字母与数字' });

class CreateUserDto {
  @IsString() @MinLength(1) @MaxLength(64) username!: string;
  @IsString() @MinLength(8) @MaxLength(128) @INITIAL_PASSWORD() password!: string;
  @IsString() @MinLength(1) @MaxLength(64) real_name!: string;
  @IsOptional() @IsString() @MaxLength(32) employee_no?: string;
  @IsOptional() @IsString() @MaxLength(32) @NormalizeDeptId() department_id?: string;
  @IsString() role!: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(128) email?: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(64) real_name?: string;
  @IsOptional() @IsString() @MaxLength(32) employee_no?: string;
  @IsOptional() @IsString() @MaxLength(32) @NormalizeDeptId() department_id?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(128) email?: string;
}

class StatusDto {
  @IsInt() status!: number;
}

class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(128) @INITIAL_PASSWORD() password!: string;
}

class CreateStudentDto {
  @IsString() @MinLength(1) @MaxLength(64) username!: string;
  @IsString() @MinLength(8) @MaxLength(128) @INITIAL_PASSWORD() password!: string;
  @IsString() @MinLength(1) @MaxLength(64) real_name!: string;
  @IsString() @MinLength(1) @MaxLength(32) category_id!: string;
  @IsIn(['institution', 'external']) source!: 'institution' | 'external';
  @IsOptional() @IsString() @MaxLength(32) employee_no?: string;
  @IsOptional() @IsString() @MaxLength(32) @NormalizeDeptId() department_id?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(128) email?: string;
}

class UpdateStudentDto {
  @IsOptional() @IsString() @MaxLength(64) real_name?: string;
  @IsOptional() @IsString() @MaxLength(32) employee_no?: string;
  @IsOptional() @IsString() @MaxLength(32) @NormalizeDeptId() department_id?: string;
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
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(128) email?: string;
}

/** /users 员工管理（04 册 3.2，全部 super_admin） */
@Controller('users')
@Roles(RoleEnum.SUPER_ADMIN)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly importer: UserImportService,
  ) {}

  @Get()
  list(@Query() query: any) {
    return this.users.list(query);
  }

  @Get('import-template')
  @SkipEnvelope()
  async template(@Res() res: Response) {
    const buf = await this.importer.buildTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="user-import-template.xlsx"');
    res.end(buf);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async import(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (!file) throw Errors.param('缺少上传文件');
    return this.importer.import(file, { id: user.id, name: user.username }, req.ip || null);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.users.detail(id);
  }

  @Post()
  async create(@Body(new DtoValidationPipe()) dto: CreateUserDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.users.create({ ...dto, department_id: dto.department_id || null }, { id: user.id, name: user.username }, req.ip || null);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: UpdateUserDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.users.update(id, dto, { id: user.id, name: user.username }, req.ip || null);
  }

  @Put(':id/status')
  async status(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: StatusDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (dto.status !== 0 && dto.status !== 1) throw Errors.param('status 取值非法');
    return this.users.setStatus(id, dto.status as 0 | 1, { id: user.id, name: user.username }, req.ip || null);
  }

  @Put(':id/password')
  async resetPassword(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: ResetPasswordDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.users.resetPassword(id, dto.password, { id: user.id, name: user.username }, req.ip || null);
    return null;
  }
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
  list(@Query() query: any) {
    return this.users.listStudents(query);
  }

  @Get('import-template')
  @SkipEnvelope()
  async template(@Res() res: Response) {
    const buffer = await this.importer.buildStudentTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.xlsx"');
    res.end(buffer);
  }

  @Get('import-batches/:id')
  batchStatus(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.importer.status(String(user.id), id);
  }

  @Post('import-preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async preview(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: any,
    @CurrentUser() user: AuthUser,
  ) {
    let rows: unknown[];
    if (file) rows = await this.importer.parseStudentWorkbook(file.buffer);
    else {
      try {
        rows = Array.isArray(body?.rows) ? body.rows : typeof body?.rows === 'string' ? JSON.parse(body.rows) : [];
      } catch {
        throw Errors.param('rows 必须是合法 JSON 数组');
      }
    }
    if (!Array.isArray(rows)) throw Errors.param('rows 必须是数组');
    let defaults: any;
    try {
      defaults = typeof body?.defaults === 'string' ? JSON.parse(body.defaults) : body?.defaults || {};
    } catch {
      throw Errors.param('defaults 必须是合法 JSON 对象');
    }
    const withDefaults = rows.map((row: any) => ({
      ...(row && typeof row === 'object' ? row : {}),
      source: row?.source || defaults.source,
      category_id: row?.category_id || defaults.category_id,
    }));
    return this.importer.preview(String(user.id), 'students', withDefaults);
  }

  @Post('import-batches/:id/commit')
  async commit(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    if (!Array.isArray(body?.row_numbers)) throw Errors.param('row_numbers 必须是数组');
    return this.importer.commit(String(user.id), id, body.row_numbers);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.users.studentDetail(id);
  }

  @Post()
  create(@Body(new DtoValidationPipe()) dto: CreateStudentDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'role')) throw Errors.param('学员角色固定为 employee');
    return this.users.createStudent({ ...dto, department_id: dto.department_id || null }, this.actor(user), req.ip || null);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: UpdateStudentDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'role')) throw Errors.param('学员角色不可修改');
    return this.users.updateStudent(id, dto, this.actor(user), req.ip || null);
  }

  @Put(':id/status')
  status(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: StudentStatusDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (dto.status !== 0 && dto.status !== 1) throw Errors.param('status 取值非法');
    return this.users.setStudentStatus(id, dto.status as 0 | 1, this.actor(user), req.ip || null);
  }

  @Put(':id/password')
  async resetPassword(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: StudentResetPasswordDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
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
    @Body(new DtoValidationPipe()) dto: SelfProfileDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const forbidden = ['source', 'category_id', 'categoryId', 'role', 'avatar_id', 'avatarId'];
    if (forbidden.some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key))) {
      throw Errors.param('本人资料不允许修改来源、培训类别、角色或头像');
    }
    return this.users.updateSelfProfile(String(user.id), dto);
  }
}
