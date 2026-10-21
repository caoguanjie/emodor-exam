import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Request } from 'express';
import { CategoryService } from './category.service';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors, RoleEnum } from '../../common/errors';
import { Roles } from '../../common/guards/roles.guard';

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

/** A2 standalone keeps the existing super_admin boundary until A3 permission integration. */
@Controller('admin/training-categories')
@Roles(RoleEnum.SUPER_ADMIN)
export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  private actor(user: AuthUser) {
    return { id: String(user.id), name: user.username };
  }

  @Get()
  list(@Query() query: any) {
    return this.categories.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.categories.detail(id);
  }

  @Post()
  create(@Body(new DtoValidationPipe()) dto: CreateCategoryDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.categories.create(dto, this.actor(user), req.ip || null);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: UpdateCategoryDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.categories.update(id, dto, this.actor(user), req.ip || null);
  }

  @Put(':id/status')
  status(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: CategoryStatusDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (dto.status !== 0 && dto.status !== 1) throw Errors.param('status 取值非法');
    return this.categories.setStatus(id, dto.status as 0 | 1, this.actor(user), req.ip || null);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.categories.remove(id, this.actor(user), req.ip || null);
  }
}
