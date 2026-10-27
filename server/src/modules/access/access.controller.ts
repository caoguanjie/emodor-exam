import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import {
  ArrayMinSize, ArrayUnique, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions, PermissionsAny } from '../../common/decorators/permissions.decorator';
import { AccessService } from './access.service';
import { SessionService } from '../auth/session.service';
import { assertSessionListQueryRequest, SessionListQueryDto, SESSION_LIST_QUERY_KEYS } from '../auth/session-query.dto';
import { Errors } from '../../common/errors';
import { Request } from 'express';

class CreateRoleDto {
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(2) @MaxLength(64) code?: string;
  @IsString() @MinLength(1) @MaxLength(128) name!: string;
  @IsOptional() @IsString() @MaxLength(500) remark?: string | null;
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayUnique() @IsString({ each: true }) permissions?: string[];
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(1) status?: number;
}

class UpdateRoleDto {
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(128) name?: string;
  @IsOptional() @IsString() @MaxLength(500) remark?: string | null;
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayUnique() @IsString({ each: true }) permissions?: string[];
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(1) status?: number;
}

class SetRolePermissionsDto {
  @IsArray() @ArrayUnique() @IsString({ each: true }) permissions!: string[];
}

class CreateAdministratorDto {
  @IsString() @MinLength(1) @MaxLength(64) username!: string;
  @IsString() @MinLength(8) @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)\S{8,128}$/, { message: 'password 至少 8 位，且同时包含字母与数字' })
  password!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(64) real_name?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(128) email?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(1) status?: number;
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsString({ each: true })
  @Matches(/^[1-9]\d*$/, { each: true, message: 'role_ids 必须是十进制 ID 字符串' })
  role_ids!: string[];
}

class UpdateAdministratorDto {
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(64) real_name?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsString({ each: true })
  @Matches(/^[1-9]\d*$/, { each: true, message: 'role_ids 必须是十进制 ID 字符串' })
  role_ids?: string[];
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(1) status?: number;
}

class ResetAdministratorPasswordDto {
  @IsString() @MinLength(8) @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)\S{8,128}$/, { message: 'password 至少 8 位，且同时包含字母与数字' })
  password!: string;
}

const QueryNumber = () => Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : Number(value)));

class PagedKeywordQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(1_000_000) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
}

const PAGED_KEYWORD_QUERY_KEYS = ['page', 'page_size', 'keyword'] as const;
const CREATE_ADMINISTRATOR_KEYS = ['username', 'password', 'real_name', 'phone', 'email', 'role_ids', 'status'] as const;
const UPDATE_ADMINISTRATOR_KEYS = ['real_name', 'phone', 'role_ids', 'status'] as const;
const CREATE_ROLE_KEYS = ['code', 'name', 'remark', 'permissions', 'status'] as const;
const UPDATE_ROLE_KEYS = ['name', 'remark', 'permissions', 'status'] as const;

function assertRequestKeys(value: unknown, allowed: readonly string[], label = '管理员') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`${label}请求包含不支持的字段：${unknown.join(',')}`);
}

@Controller('admin')
export class AccessController {
  constructor(private readonly access: AccessService, private readonly sessionService: SessionService) {}

  @Get('permissions')
  @PermissionsAny('roles:read', 'roles:permissions')
  catalog() {
    return this.access.catalog();
  }

  @Get('roles')
  @Permissions('roles:read')
  roles(
    @Query(new StrictDtoValidationPipe(PAGED_KEYWORD_QUERY_KEYS)) query: PagedKeywordQueryDto,
    @Req() request: Request,
  ) {
    assertRequestKeys(request.query, PAGED_KEYWORD_QUERY_KEYS, '角色');
    return Object.keys(request.query || {}).length ? this.access.listRolePage(query) : this.access.listRoles();
  }

  @Post('roles')
  @Permissions('roles:create')
  async createRole(@Body(new StrictDtoValidationPipe(CREATE_ROLE_KEYS)) dto: CreateRoleDto, @CurrentUser() user: AuthUser, @Req() request: Request) {
    assertRequestKeys(request?.body, CREATE_ROLE_KEYS, '角色');
    if (dto.permissions?.length) await this.access.assertAllowed(user.id, 'roles:permissions');
    return this.access.createRole(dto, { id: user.id, name: user.username, sourceIp: request.ip || null });
  }

  @Get('roles/permission-tree')
  @PermissionsAny('roles:read', 'roles:permissions')
  rolePermissionTree() {
    return this.access.rolePermissionTree();
  }

  @Get('roles/:id')
  @PermissionsAny('roles:update', 'roles:permissions')
  role(@Param('id') id: string) {
    return this.access.getRole(id);
  }

  @Put('roles/:id')
  @PermissionsAny('roles:update', 'roles:permissions')
  async updateRole(@Param('id') id: string, @Body(new StrictDtoValidationPipe(UPDATE_ROLE_KEYS)) dto: UpdateRoleDto, @CurrentUser() user: AuthUser, @Req() request: Request) {
    assertRequestKeys(request?.body, UPDATE_ROLE_KEYS, '角色');
    if (dto.name !== undefined || dto.remark !== undefined || dto.status !== undefined) await this.access.assertAllowed(user.id, 'roles:update');
    if (dto.permissions !== undefined) await this.access.assertAllowed(user.id, 'roles:permissions');
    return this.access.updateRole(id, dto, { id: user.id, name: user.username, sourceIp: request.ip || null });
  }

  @Put('roles/:id/permissions')
  @Permissions('roles:permissions')
  setRolePermissions(@Param('id') id: string, @Body(new StrictDtoValidationPipe(['permissions'])) dto: SetRolePermissionsDto, @CurrentUser() user: AuthUser, @Req() request: Request) {
    assertRequestKeys(request.body, ['permissions'], '角色权限');
    return this.access.setRolePermissions(id, dto.permissions, { id: user.id, name: user.username, sourceIp: request.ip || null });
  }

  @Delete('roles/:id')
  @Permissions('roles:delete')
  async deleteRole(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    assertRequestKeys(request.body, [], '角色');
    await this.access.deleteRole(id, { id: user.id, name: user.username, sourceIp: request.ip || null });
    return null;
  }

  @Get('administrators')
  @Permissions('administrators:read')
  administrators(
    @Query(new StrictDtoValidationPipe(PAGED_KEYWORD_QUERY_KEYS)) query: PagedKeywordQueryDto,
    @Req() request: Request,
  ) {
    assertRequestKeys(request.query, PAGED_KEYWORD_QUERY_KEYS);
    return this.access.listAdministrators(query);
  }

  @Post('administrators')
  @Permissions('administrators:create')
  createAdministrator(
    @Body(new StrictDtoValidationPipe(CREATE_ADMINISTRATOR_KEYS)) body: CreateAdministratorDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    assertRequestKeys(request.body, CREATE_ADMINISTRATOR_KEYS);
    return this.access.createAdministrator(body, { id: user.id, name: user.username }, request.ip || null);
  }

  @Get('administrators/assignable-roles')
  @PermissionsAny('administrators:create', 'administrators:update')
  assignableRoles() {
    return this.access.listAssignableRoles();
  }

  @Get('administrators/:id')
  @Permissions('administrators:update')
  administrator(@Param('id') id: string) {
    return this.access.getAdministrator(id);
  }

  @Put('administrators/:id')
  @Permissions('administrators:update')
  updateAdministrator(
    @Param('id') id: string,
    @Body(new StrictDtoValidationPipe(UPDATE_ADMINISTRATOR_KEYS)) body: UpdateAdministratorDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    assertRequestKeys(request.body, UPDATE_ADMINISTRATOR_KEYS);
    return this.access.updateAdministrator(id, body, { id: user.id, name: user.username, role: user.role }, request.ip || null);
  }

  @Post('administrators/:id/reset-password')
  @Permissions('administrators:reset_password')
  async resetAdministratorPassword(
    @Param('id') id: string,
    @Body(new StrictDtoValidationPipe(['password'])) body: ResetAdministratorPasswordDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    assertRequestKeys(request.body, ['password']);
    await this.access.resetAdministratorPassword(id, body, { id: user.id, name: user.username, role: user.role }, request.ip || null);
    return null;
  }

  @Delete('administrators/:id')
  @Permissions('administrators:delete')
  async deleteAdministrator(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    assertRequestKeys(request.body, []);
    await this.access.deleteAdministrator(id, { id: user.id, name: user.username, role: user.role }, request.ip || null);
    return null;
  }

  @Get('sessions')
  @Permissions('sessions:read')
  sessions(
    @Query(new StrictDtoValidationPipe(SESSION_LIST_QUERY_KEYS)) query: SessionListQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    assertSessionListQueryRequest(request.query, request.originalUrl);
    return this.sessionService.list(query.page, query.page_size, { keyword: query.keyword, status: query.status }, user.sid);
  }

  @Post('sessions/:id/revoke')
  @Permissions('sessions:write')
  async revokeSession(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() request: Request) {
    await this.sessionService.revoke(id, { id: user.id, name: user.username, sourceIp: request.ip || null });
    return null;
  }
}
