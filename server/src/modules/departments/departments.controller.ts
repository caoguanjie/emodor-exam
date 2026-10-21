import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { DepartmentService } from './department.service';
import { Roles } from '../../common/guards/roles.guard';
import { RoleEnum } from '../../common/errors';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';
import { Request } from 'express';

class CreateDepartmentDto {
  @IsOptional() @IsString() parent_id?: string | null;
  @IsString() @MaxLength(64) name!: string;
  @IsOptional() @IsInt() @Min(0) sort?: number;
}

class UpdateDepartmentDto {
  @IsOptional() @IsString() @MaxLength(64) name?: string;
  @IsOptional() @IsInt() @Min(0) sort?: number;
}

class MoveDepartmentDto {
  @IsOptional() @IsString() parent_id?: string | null;
}

class SetStatusDto {
  @IsInt() @IsIn([0, 1]) status!: number;
}

/** /departments 部门树管理（04 册 3.3；tree 登录可读，其余 super_admin） */
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentService) {}

  @Get('tree')
  async tree() {
    return { list: await this.departments.tree() };
  }

  @Post()
  @Roles(RoleEnum.SUPER_ADMIN)
  async create(@Body(new DtoValidationPipe()) dto: CreateDepartmentDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const dept = await this.departments.create(
      dto.parent_id ? String(dto.parent_id) : null,
      dto.name,
      dto.sort ?? 0,
      user.id, user.username, req.ip || null,
    );
    return { id: dept.id, name: dept.name };
  }

  @Put(':id')
  @Roles(RoleEnum.SUPER_ADMIN)
  async update(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: UpdateDepartmentDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const dept = await this.departments.update(id, dto, user.id, user.username, req.ip || null);
    return { id: dept.id, name: dept.name, sort: dept.sort };
  }

  @Put(':id/parent')
  @Roles(RoleEnum.SUPER_ADMIN)
  async move(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: MoveDepartmentDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const dept = await this.departments.moveParent(id, dto.parent_id ? String(dto.parent_id) : null, user.id, user.username, req.ip || null);
    return { id: dept.id, parent_id: dept.parentId };
  }

  @Put(':id/status')
  @Roles(RoleEnum.SUPER_ADMIN)
  async setStatus(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: SetStatusDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const dept = await this.departments.setStatus(id, dto.status === 1 ? 1 : 0, user.id, user.username, req.ip || null);
    return { id: dept.id, name: dept.name, status: dept.status };
  }

  @Delete(':id')
  @Roles(RoleEnum.SUPER_ADMIN)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.departments.remove(id, user.id, user.username, req.ip || null);
    return null;
  }
}
