import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { DtoValidationPipe, StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { AccessService } from './access.service';
import { SessionService } from '../auth/session.service';

class CreateRoleDto {
  @IsString() @MinLength(2) @MaxLength(64) code!: string;
  @IsString() @MinLength(1) @MaxLength(128) name!: string;
  @IsArray() @IsString({ each: true }) permissions!: string[];
}

class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) permissions?: string[];
  @IsOptional() @IsInt() status?: number;
}

class AssignRoleDto {
  @IsArray() @IsString({ each: true }) role_ids!: string[];
}

const QueryNumber = () => Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : Number(value)));

class AdministratorCandidateQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(1_000_000) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
}

@Controller('admin')
export class AccessController {
  constructor(private readonly access: AccessService, private readonly sessionService: SessionService) {}

  @Get('permissions')
  @Permissions('roles:read')
  catalog() {
    return this.access.catalog();
  }

  @Get('roles')
  @Permissions('roles:read')
  roles() {
    return this.access.listRoles();
  }

  @Post('roles')
  @Permissions('roles:write')
  createRole(@Body(new DtoValidationPipe()) dto: CreateRoleDto, @CurrentUser() user: AuthUser) {
    return this.access.createRole(dto, user.id);
  }

  @Put('roles/:id')
  @Permissions('roles:write')
  updateRole(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: UpdateRoleDto, @CurrentUser() user: AuthUser) {
    return this.access.updateRole(id, dto, user.id);
  }

  @Get('administrators')
  @Permissions('administrators:read')
  administrators() {
    return this.access.listAdministrators();
  }

  @Get('administrators/candidates')
  @Permissions('administrators:write')
  administratorCandidates(@Query(new StrictDtoValidationPipe(['page', 'page_size', 'keyword'])) query: AdministratorCandidateQueryDto) {
    return this.access.listAssignableUsers(query);
  }

  @Get('administrators/assignable-roles')
  @Permissions('administrators:write')
  assignableRoles() {
    return this.access.listAssignableRoles();
  }

  @Put('administrators/:id/roles')
  @Permissions('administrators:write')
  async assignRoles(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: AssignRoleDto, @CurrentUser() user: AuthUser) {
    await this.access.assignRoles(id, dto.role_ids, user.id);
    return null;
  }

  @Get('sessions')
  @Permissions('sessions:read')
  sessions(@Query() query: any) {
    return this.sessionService.list(query.page, query.page_size);
  }

  @Post('sessions/:id/revoke')
  @Permissions('sessions:write')
  async revokeSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.sessionService.revoke(id, user.id);
    return null;
  }
}
