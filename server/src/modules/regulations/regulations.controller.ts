import {
  Body, Controller, Get, Param, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { RegulationService } from './regulation.service';
import { RegulationVersionService } from './regulation-version.service';
import { RegulationScopeService } from './regulation-scope.service';
import { ContentService } from './content.service';
import { ParsePipelineService } from './parse-pipeline.service';
import { Roles, roleHas } from '../../common/guards/roles.guard';
import { SkipEnvelope } from '../../common/response.interceptor';
import { Errors, RoleEnum } from '../../common/errors';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe, StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { SysUser } from '../../entities/sys-user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessService } from '../access/access.service';
import { CategoryService } from '../training/category.service';
import { Permissions } from '../../common/decorators/permissions.decorator';

class CreateRegulationDto {
  @IsString() @MinLength(1) @MaxLength(128) title!: string;
  @IsString() @MinLength(1) @MaxLength(32) category!: string;
  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsString() @Matches(/^[1-9]\d*$/) category_id?: string | null;
  @IsOptional() @IsString() @MaxLength(512) description?: string;
}

class UpdateRegulationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(32) category?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsString() @Matches(/^[1-9]\d*$/) category_id?: string | null;
  @IsOptional() @IsString() @MaxLength(512) description?: string;
}

class LearningConfigDto {
  @IsInt() @Min(1) required_minutes!: number;
  @IsInt() @Min(1) scroll_segments!: number;
}

class ScopeDto {
  @IsOptional() is_all?: boolean;
  // 与 GET 详情出参对称：department_ids 统一字符串（部门树节点键与回显均为字符串）
  @IsOptional() @IsArray() @IsString({ each: true }) department_ids?: string[];
}

class CurrentVersionDto {
  @IsString() version_id!: string;
}

const QueryNumber = () => Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : Number(value)));

class RegulationCategoryOptionsDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(1_000_000) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
}

function assertOptionQueryKeys(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param('类别选项查询必须是对象');
  const unknown = Object.keys(value).filter((key) => !['page', 'page_size', 'keyword'].includes(key));
  if (unknown.length) throw Errors.param(`类别选项查询包含不支持的字段：${unknown.join(',')}`);
}

const REG_ADMIN = [RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN] as const;

/** /regulations 制度文件管理模块（04 册 3.4：15 个管理侧接口 + content 员工侧） */
@Controller('regulations')
export class RegulationsController {
  constructor(
    private readonly regulations: RegulationService,
    private readonly versions: RegulationVersionService,
    private readonly scopeService: RegulationScopeService,
    private readonly content: ContentService,
    private readonly parsePipeline: ParsePipelineService,
    @InjectRepository(SysUser) private readonly userRepo: Repository<SysUser>,
    private readonly access: AccessService,
    private readonly categories: CategoryService,
  ) {}

  private async withDepartment(user: AuthUser): Promise<{ id: number; role: string; departmentId: string | null }> {
    const permissions = await this.access.permissions(user.id);
    const canReadAsAdmin = user.role === RoleEnum.SUPER_ADMIN
      || (user.role === RoleEnum.REGULATION_ADMIN && permissions.includes('regulations:read'));
    if (canReadAsAdmin) {
      return { id: user.id, role: user.role, departmentId: null };
    }
    const u = await this.userRepo.findOne({ where: { id: String(user.id) } });
    // A regulation_admin with explicit business roles cleared is still a
    // legacy system identity, but it must not retain the unrestricted content
    // data scope. ContentService uses employee semantics for this path so the
    // published scope is enforced from the current account/department state.
    return { id: user.id, role: RoleEnum.EMPLOYEE, departmentId: u?.departmentId ?? null };
  }

  // ---- 3.4.1 管理侧（制度管理角色）----

  @Get()
  @Roles(...REG_ADMIN)
  list(@Query() query: any) {
    return this.regulations.list(query);
  }

  @Get('category-options')
  @Roles(...REG_ADMIN)
  @Permissions('regulations:write')
  async categoryOptions(
    @Query(new StrictDtoValidationPipe(['page', 'page_size', 'keyword'])) query: RegulationCategoryOptionsDto,
    @Req() req: Request,
  ) {
    assertOptionQueryKeys(req.query);
    const page = await this.categories.list({ ...query, status: 1 });
    return { ...page, items: page.items.map((item) => ({ id: String(item.id), name: item.name })) };
  }

  @Get(':id')
  @Roles(...REG_ADMIN)
  detail(@Param('id') id: string) {
    return this.regulations.detail(id);
  }

  @Post()
  @Roles(...REG_ADMIN)
  async create(@Body(new DtoValidationPipe()) dto: CreateRegulationDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.regulations.create(dto, { id: user.id, name: user.username }, req.ip || null);
  }

  @Put(':id')
  @Roles(...REG_ADMIN)
  async update(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: UpdateRegulationDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.regulations.update(id, dto, { id: user.id, name: user.username }, req.ip || null);
  }

  @Put(':id/learning-config')
  @Roles(...REG_ADMIN)
  async learningConfig(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: LearningConfigDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.regulations.updateLearningConfig(id, dto, { id: user.id, name: user.username }, req.ip || null);
  }

  @Put(':id/scope')
  @Roles(...REG_ADMIN)
  async scope(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: ScopeDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (dto.is_all && dto.department_ids?.length) {
      throw Errors.param('「按部门圈定」与「面向全员」互斥，仅可选其一');
    }
    await this.scopeService.saveScope(id, {
      isAll: !!dto.is_all,
      departmentIds: (dto.department_ids || []).map(String),
    });
    return this.regulations.detail(id);
  }

  @Post(':id/versions')
  @Roles(...REG_ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async uploadVersion(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (!file) throw Errors.param('缺少上传文件');
    const result = await this.versions.upload(id, file, { id: user.id, name: user.username }, req.ip || null);
    // 事务提交后投递异步解析（AD-03 双通道触发）
    this.parsePipeline.enqueue(String(result.version_id));
    return result;
  }

  @Get(':id/versions')
  @Roles(...REG_ADMIN)
  listVersions(@Param('id') id: string) {
    return this.versions.listVersions(id);
  }

  @Get(':id/versions/:versionId')
  @Roles(...REG_ADMIN)
  versionDetail(@Param('id') id: string, @Param('versionId') versionId: string) {
    return this.versions.versionDetail(id, versionId);
  }

  @Post(':id/versions/:versionId/retry')
  @Roles(...REG_ADMIN)
  async retryParse(@Param('id') id: string, @Param('versionId') versionId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const result = await this.versions.retryParse(id, versionId, { id: user.id, name: user.username }, req.ip || null);
    this.parsePipeline.enqueue(versionId);
    return result;
  }

  @Get(':id/versions/:versionId/file')
  @Roles(...REG_ADMIN)
  @SkipEnvelope()
  async downloadVersionFile(@Param('id') id: string, @Param('versionId') versionId: string, @Res() res: Response) {
    const { stream, size, fileType } = await this.versions.openFileStream(id, versionId);
    res.setHeader('Content-Type', fileType === 'pdf' ? 'application/pdf' : 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    this.pipeFileStream(res, stream);
  }

  @Put(':id/current-version')
  @Roles(...REG_ADMIN)
  async switchVersion(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: CurrentVersionDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.versions.switchCurrentVersion(id, dto.version_id, { id: user.id, name: user.username }, req.ip || null);
    return this.regulations.detail(id);
  }

  @Post(':id/publish')
  @Roles(...REG_ADMIN)
  async publish(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.regulations.publish(id, { id: user.id, name: user.username }, req.ip || null);
  }

  @Post(':id/archive')
  @Roles(...REG_ADMIN)
  async archive(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.regulations.archive(id, { id: user.id, name: user.username }, req.ip || null);
  }

  @Get(':id/preview')
  @Roles(...REG_ADMIN)
  async preview(@Param('id') id: string, @Query('versionId') versionId: string | undefined, @CurrentUser() user: AuthUser) {
    // 管理端预览：跳过 status=published 校验、仅角色校验（FR-REG-03 验收④）
    // A custom employee identity with regulations:read is a delegated
    // management principal for this route, not a learner whose department
    // scope should hide an unpublished/out-of-scope preview.
    const permissions = await this.access.permissions(user.id);
    const canPreview = user.role === RoleEnum.SUPER_ADMIN || permissions.includes('regulations:read');
    return this.content.readingContent(
      id,
      { id: user.id, role: canPreview ? RoleEnum.REGULATION_ADMIN : RoleEnum.EMPLOYEE, departmentId: null },
      true,
      versionId,
    );
  }

  // ---- 3.4.2 员工侧（限发布范围内的本人）----

  @Get(':id/content')
  async readContent(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const ctx = await this.withDepartment(user);
    return this.content.readingContent(id, ctx, false);
  }

  @Get(':id/content/file')
  @SkipEnvelope()
  async readFile(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const ctx = await this.withDepartment(user);
    const meta = await this.content.readingContent(id, ctx, false);
    if (!meta.file_download_url) throw Errors.contentInvisible('该版本无 PDF 文件');
    const { stream, size } = await this.versions.openFileStream(id, String(meta.version_id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(size));
    this.pipeFileStream(res, stream);
  }

  /**
   * 受控流式下发：必须挂流错误监听——existsSync 与实际读取之间文件被清理/磁盘 IO 错误时，
   * ReadStream 的无监听 'error' 事件会以 uncaughtException 击穿进程（全局无 uncaughtException 处理器）；
   * 客户端中断时销毁源流，防文件句柄滞留
   */
  private pipeFileStream(res: Response, stream: Readable) {
    res.on('close', () => stream.destroy());
    stream.on('error', () => {
      if (res.headersSent) {
        res.destroy();
      } else {
        res.status(500).json({ code: 50001, message: '文件读取失败', data: null });
      }
    });
    stream.pipe(res);
  }
}
