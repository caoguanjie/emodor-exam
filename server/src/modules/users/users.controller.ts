import {
  Body, Controller, Get, Param, Post, Put, Req, Res, UploadedFile, UseInterceptors, Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response, Request } from 'express';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { UsersService } from './users.service';
import { UserImportService } from './user-import.service';
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
