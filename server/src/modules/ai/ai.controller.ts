import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Type } from 'class-transformer';
import {
  IsArray, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ArrayMinSize, ValidateNested,
} from 'class-validator';
import { AiConfigService } from './ai-config.service';
import { AiGatewayService } from './ai-gateway.service';
import { QuestionGenerationService } from './question-generation.service';
import { QuestionBankService } from '../questions/question-bank.service';
import { PaperService } from './paper.service';
import { Roles } from '../../common/guards/roles.guard';
import { Errors, RoleEnum } from '../../common/errors';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe, StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CategoryService } from '../training/category.service';
import {
  CategoryOptionsQueryDto,
  CreateQuestionDto,
  EditQuestionDto,
  QUESTION_CREATE_KEYS,
  QUESTION_EDIT_KEYS,
  QUESTION_LIST_KEYS,
  QuestionHistoryQueryDto,
  QuestionListQueryDto,
  SetQuestionEnabledDto,
} from '../questions/question.dto';

class SaveAiConfigDto {
  @IsString() @MinLength(1) base_url!: string;
  // api_key 可选：留空 = 保持已保存的 key（界面「留空保持不变」语义），由服务层校验首次配置必填
  @IsOptional() @IsString() api_key?: string;
  @IsString() @MinLength(1) model!: string;
}

class CreatePaperDto {
  @IsString() regulation_id!: string;
  @IsString() @MinLength(1) @MaxLength(128) title!: string;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) pass_score?: number;
  @IsOptional() @IsInt() @Min(1) duration_minutes?: number;
  @IsOptional() @IsInt() @Min(1) max_attempts?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) partial_credit_ratio?: number;
}

class UpdatePaperDto {
  @IsOptional() @IsString() @MaxLength(128) title?: string;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) pass_score?: number;
  @IsOptional() @IsInt() @Min(1) duration_minutes?: number;
  @IsOptional() @IsInt() @Min(1) max_attempts?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) partial_credit_ratio?: number;
}

class PaperQuestionItemDto {
  @IsInt() @Min(1) question_id!: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) score?: number;
}

class SetPaperQuestionsDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PaperQuestionItemDto) items!: PaperQuestionItemDto[];
}

const REG_ADMIN = [RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN] as const;

function assertRequestKeys(value: unknown, allowed: readonly string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param(`${label} 必须是对象`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`${label} 包含不支持的字段：${unknown.join(',')}`);
}

function assertOptionKeys(value: unknown) {
  const options = (value as any)?.options;
  if (options === undefined) return;
  if (!Array.isArray(options)) throw Errors.param('options 必须是数组');
  for (const option of options) assertRequestKeys(option, ['key', 'text'], '题目选项');
}

function expectedVersionId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, 'expected_version_id')) {
    throw Errors.param('expected_version_id 必须显式提供（遗留未版本化题目请传 null）');
  }
  const expected = (value as Record<string, unknown>).expected_version_id;
  if (expected === null) return null;
  if (typeof expected !== 'string' || !/^[1-9]\d*$/.test(expected)) throw Errors.param('expected_version_id 非法');
  return expected;
}

/** /ai AI 出题模块（04 册 3.5；/ai/config 由 ai_config:read/write 细权限控制） */
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiConfig: AiConfigService,
    private readonly gateway: AiGatewayService,
    private readonly generation: QuestionGenerationService,
    private readonly bank: QuestionBankService,
    private readonly papers: PaperService,
    private readonly categories: CategoryService,
  ) {}

  private async categoryOptions(query: CategoryOptionsQueryDto) {
    const page = await this.categories.list({ ...query, status: 1 });
    return { ...page, items: page.items.map((item) => ({ id: String(item.id), name: item.name })) };
  }

  // ---- AI 配置（ai_config:read/write；super_admin 天然拥有全部权限）----

  @Get('config')
  @Roles(RoleEnum.SUPER_ADMIN)
  async getConfig() {
    const cfg = await this.aiConfig.load();
    return this.aiConfig.mask(cfg);
  }

  @Put('config')
  @Roles(RoleEnum.SUPER_ADMIN)
  async saveConfig(@Body(new DtoValidationPipe()) dto: SaveAiConfigDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    await this.aiConfig.save(dto);
    const cfg = await this.aiConfig.load();
    return this.aiConfig.mask(cfg);
  }

  @Post('config/test')
  @Roles(RoleEnum.SUPER_ADMIN)
  async testConfig() {
    await this.gateway.test();
    return { ok: true };
  }

  @Post('config/test-vision')
  @Roles(RoleEnum.SUPER_ADMIN)
  async testVisionConfig() {
    await this.gateway.testVision();
    return { ok: true };
  }

  // ---- 出题任务 ----

  @Get('generate-status/:taskId')
  @Roles(...REG_ADMIN)
  @Permissions('ai:read')
  generateStatus(@Param('taskId') taskId: string) {
    return this.generation.status(taskId);
  }

  // ---- 题库 ----

  @Get('generation-category-options')
  @Roles(...REG_ADMIN)
  @Permissions('ai:write')
  generationCategoryOptions(@Query(new StrictDtoValidationPipe(['page', 'page_size', 'keyword'])) query: CategoryOptionsQueryDto, @Req() req: Request) {
    assertRequestKeys(req.query, ['page', 'page_size', 'keyword'], '类别选项查询');
    return this.categoryOptions(query);
  }

  @Get('question-category-options')
  @Roles(...REG_ADMIN)
  @Permissions('questions:write')
  questionCategoryOptions(@Query(new StrictDtoValidationPipe(['page', 'page_size', 'keyword'])) query: CategoryOptionsQueryDto, @Req() req: Request) {
    assertRequestKeys(req.query, ['page', 'page_size', 'keyword'], '类别选项查询');
    return this.categoryOptions(query);
  }

  @Get('question-category-filters')
  @Roles(...REG_ADMIN)
  @Permissions('questions:read')
  questionCategoryFilters(@Query(new StrictDtoValidationPipe(['page', 'page_size', 'keyword'])) query: CategoryOptionsQueryDto, @Req() req: Request) {
    assertRequestKeys(req.query, ['page', 'page_size', 'keyword'], '类别筛选查询');
    return this.categoryOptions(query);
  }

  @Get('questions')
  @Roles(...REG_ADMIN)
  @Permissions('questions:read')
  listQuestions(@Query(new StrictDtoValidationPipe(QUESTION_LIST_KEYS)) query: QuestionListQueryDto, @Req() req: Request) {
    assertRequestKeys(req.query, QUESTION_LIST_KEYS, '题库查询');
    return this.bank.list(query);
  }

  @Post('questions')
  @Roles(...REG_ADMIN)
  @Permissions('questions:write')
  createQuestion(@Body(new StrictDtoValidationPipe(QUESTION_CREATE_KEYS)) dto: CreateQuestionDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertRequestKeys(req.body, QUESTION_CREATE_KEYS, '题目请求');
    assertOptionKeys(req.body);
    return this.bank.createManual(
      { ...dto, options: dto.options?.map((o, i) => ({ key: o.key || String.fromCharCode(65 + i), text: o.text })) || [] },
      { id: user.id, name: user.username },
      req.ip || null,
    );
  }

  @Put('questions/:id/enabled')
  @Roles(...REG_ADMIN)
  @Permissions('questions:write')
  setQuestionEnabled(@Param('id') id: string, @Body(new StrictDtoValidationPipe(['expected_version_id', 'enabled'])) dto: SetQuestionEnabledDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertRequestKeys(req.body, ['expected_version_id', 'enabled'], '启停请求');
    return this.bank.setEnabled(id, dto.enabled, expectedVersionId(req.body), { id: user.id, name: user.username }, req.ip || null);
  }

  @Put('questions/:id')
  @Roles(...REG_ADMIN)
  @Permissions('questions:write')
  async editQuestion(@Param('id') id: string, @Body(new StrictDtoValidationPipe(QUESTION_EDIT_KEYS)) dto: EditQuestionDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    assertRequestKeys(req.body, QUESTION_EDIT_KEYS, '题目请求');
    assertOptionKeys(req.body);
    const { expected_version_id: _expectedVersionId, expected_enabled: expectedEnabled, ...patch } = dto;
    return this.bank.edit(
      id,
      { ...patch, options: patch.options?.map((o, i) => ({ key: o.key || String.fromCharCode(65 + i), text: o.text })) } as any,
      { id: user.id, name: user.username },
      req.ip || null,
      expectedVersionId(req.body), expectedEnabled,
    );
  }

  @Get('questions/:id/history')
  @Roles(...REG_ADMIN)
  @Permissions('questions:read')
  questionVersions(
    @Param('id') id: string,
    @Query(new StrictDtoValidationPipe(['page', 'page_size'])) query: QuestionHistoryQueryDto,
    @Req() req: Request,
  ) {
    assertRequestKeys(req.query, ['page', 'page_size'], '题目版本查询');
    return this.bank.history(id, query);
  }

  @Get('questions/:id')
  @Roles(...REG_ADMIN)
  @Permissions('questions:read')
  questionDetail(@Param('id') id: string) {
    return this.bank.getOne(id);
  }

  // ---- 试卷管理（出题工作流的管理面，员工执行面在 /exams）----

  @Get('papers')
  @Roles(...REG_ADMIN)
  listPapers(@Query() query: any) {
    return this.papers.list(query);
  }

  @Post('papers')
  @Roles(...REG_ADMIN)
  createPaper(@Body(new DtoValidationPipe()) dto: CreatePaperDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.papers.create(dto, { id: user.id, name: user.username }, req.ip || null);
  }

  @Get('papers/:id')
  @Roles(...REG_ADMIN)
  paperDetail(@Param('id') id: string) {
    return this.papers.detail(id);
  }

  @Put('papers/:id')
  @Roles(...REG_ADMIN)
  updatePaper(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: UpdatePaperDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.papers.updateStrategy(id, dto, { id: user.id, name: user.username }, req.ip || null);
  }

  @Put('papers/:id/questions')
  @Roles(...REG_ADMIN)
  setPaperQuestions(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: SetPaperQuestionsDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.papers.setQuestions(id, dto.items, { id: user.id, name: user.username }, req.ip || null);
  }

  @Post('papers/:id/publish')
  @Roles(...REG_ADMIN)
  async publishPaper(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.papers.publish(id, { id: user.id, name: user.username }, req.ip || null);
  }

  @Post('papers/:id/copy')
  @Roles(...REG_ADMIN)
  async copyPaper(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertRequestKeys(body, [], '试卷复制请求');
    return this.papers.copy(id, { id: user.id, name: user.username }, req.ip || null);
  }

  @Post('papers/:id/archive')
  @Roles(...REG_ADMIN)
  async archivePaper(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.papers.archive(id, { id: user.id, name: user.username }, req.ip || null);
  }
}
