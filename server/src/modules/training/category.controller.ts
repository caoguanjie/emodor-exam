import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { Request } from 'express';
import { CategoryService } from './category.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors, RoleEnum } from '../../common/errors';
import { Roles } from '../../common/guards/roles.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

class CreateCategoryDto {
  @IsString() @MinLength(1) @MaxLength(128) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

class CategoryStatusDto {
  @IsInt() @Min(0) status!: number;
}

const QueryNumber = () => Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : Number(value)));

class CategoryListQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(1_000_000) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
  @IsOptional() @QueryNumber() @IsInt() @Min(0) @Max(1) status?: number;
}

function assertRequestKeys(value: unknown, allowed: readonly string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param(`${label} 必须是对象`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`${label} 包含不支持的字段：${unknown.join(',')}`);
}

/** A2 standalone keeps the existing super_admin boundary until A3 permission integration. */
@Controller('admin/training-categories')
@Roles(RoleEnum.SUPER_ADMIN)
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  private actor(user: AuthUser) {
    return { id: String(user.id), name: user.username };
  }

  @Get()
  @Permissions('training_categories:read')
  list(@Query(new StrictDtoValidationPipe(['page', 'page_size', 'keyword', 'status'])) query: CategoryListQueryDto, @Req() req: Request) {
    assertRequestKeys(req.query, ['page', 'page_size', 'keyword', 'status'], '查询参数');
    return this.categories.list(query);
  }

  @Get(':id')
  @Permissions('training_categories:read')
  detail(@Param('id') id: string) {
    return this.categories.detail(id);
  }

  @Post()
  @Permissions('training_categories:write')
  create(@Body(new StrictDtoValidationPipe(['name', 'description'])) dto: CreateCategoryDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertRequestKeys(req.body, ['name', 'description'], '类别请求');
    return this.categories.create(dto, this.actor(user), req.ip || null);
  }

  @Put(':id')
  @Permissions('training_categories:write')
  update(@Param('id') id: string, @Body(new StrictDtoValidationPipe(['name', 'description'])) dto: UpdateCategoryDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertRequestKeys(req.body, ['name', 'description'], '类别请求');
    return this.categories.update(id, dto, this.actor(user), req.ip || null);
  }

  @Put(':id/status')
  @Permissions('training_categories:write')
  status(@Param('id') id: string, @Body(new StrictDtoValidationPipe(['status'])) dto: CategoryStatusDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertRequestKeys(req.body, ['status'], '类别状态请求');
    if (dto.status !== 0 && dto.status !== 1) throw Errors.param('status 取值非法');
    return this.categories.setStatus(id, dto.status as 0 | 1, this.actor(user), req.ip || null);
  }

  @Delete(':id')
  @Permissions('training_categories:write')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.categories.remove(id, this.actor(user), req.ip || null);
  }
}
