import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Type } from 'class-transformer';
import {
  IsArray, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ArrayMinSize, ValidateNested,
} from 'class-validator';
import { AiConfigService } from './ai-config.service';
import { AiGatewayService } from './ai-gateway.service';
import { QuestionGenerationService } from './question-generation.service';
import { QuestionReviewService } from './question-review.service';
import { PaperService } from './paper.service';
import { Roles } from '../../common/guards/roles.guard';
import { Errors, RoleEnum } from '../../common/errors';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { DtoValidationPipe } from '../../common/dto-validation.pipe';

class SaveAiConfigDto {
  @IsString() @MinLength(1) base_url!: string;
  // api_key 可选：留空 = 保持已保存的 key（界面「留空保持不变」语义），由服务层校验首次配置必填
  @IsOptional() @IsString() api_key?: string;
  @IsString() @MinLength(1) model!: string;
}

class GenerateQuestionsDto {
  @IsString() regulation_id!: string;
  @IsOptional() @IsInt() @Min(1) @Max(40) question_count_single?: number;
  @IsOptional() @IsInt() @Min(0) @Max(20) question_count_multiple?: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) score_single?: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) score_multiple?: number;
}

class OptionDto {
  @IsOptional() @IsString() key?: string;
  @IsString() @MinLength(1) text!: string;
}

class CreateQuestionDto {
  @IsString() regulation_id!: string;
  @IsOptional() @IsString() version_id?: string;
  @IsString() type!: string;
  @IsString() @MinLength(1) stem!: string;
  // @IsArray 只校验外层：嵌套元素须经 @ValidateNested + @Type 递归校验，否则恶意载荷穿透 DTO 层
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => OptionDto) options!: OptionDto[];
  @IsArray() @ArrayMinSize(1) @IsInt({ each: true }) @Min(0, { each: true }) answer!: number[];
  @IsOptional() @IsString() analysis?: string;
  @IsNumber() @Min(0.01) @Max(100) score!: number;
}

class ReviewDto {
  @IsString() status!: string;
  @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

class EditQuestionDto {
  @IsOptional() @IsString() stem?: string;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => OptionDto) options?: OptionDto[];
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) answer?: number[];
  @IsOptional() @IsString() analysis?: string;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) score?: number;
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

/** /ai AI 出题模块（04 册 3.5；/ai/config 由 ai_config:read/write 细权限控制） */
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiConfig: AiConfigService,
    private readonly gateway: AiGatewayService,
    private readonly generation: QuestionGenerationService,
    private readonly review: QuestionReviewService,
    private readonly papers: PaperService,
  ) {}

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

  @Post('generate-questions')
  @Roles(...REG_ADMIN)
  async generate(@Body(new DtoValidationPipe()) dto: GenerateQuestionsDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.generation.start({
      regulationId: dto.regulation_id,
      questionCountSingle: dto.question_count_single ?? 20,
      questionCountMultiple: dto.question_count_multiple ?? 5,
      scoreSingle: dto.score_single ?? 3.0,
      scoreMultiple: dto.score_multiple ?? 8.0,
      actor: { id: user.id, name: user.username },
    });
  }

  @Get('generate-status/:taskId')
  @Roles(...REG_ADMIN)
  generateStatus(@Param('taskId') taskId: string) {
    return this.generation.status(taskId);
  }

  // ---- 题库 ----

  @Get('questions')
  @Roles(...REG_ADMIN)
  listQuestions(@Query() query: any) {
    return this.review.list(query);
  }

  @Post('questions')
  @Roles(...REG_ADMIN)
  createQuestion(@Body(new DtoValidationPipe()) dto: CreateQuestionDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.review.createManual(
      { ...dto, options: dto.options.map((o, i) => ({ key: o.key || String.fromCharCode(65 + i), text: o.text })) },
      { id: user.id, name: user.username },
      req.ip || null,
    );
  }

  @Put('questions/:id/review')
  @Roles(...REG_ADMIN)
  async reviewQuestion(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: ReviewDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    if (dto.status !== 'approved' && dto.status !== 'rejected') throw Errors.param('审核状态非法（approved / rejected）');
    return this.review.review(id, dto.status, dto.reason, { id: user.id, name: user.username }, req.ip || null);
  }

  @Put('questions/:id')
  @Roles(...REG_ADMIN)
  async editQuestion(@Param('id') id: string, @Body(new DtoValidationPipe()) dto: EditQuestionDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.review.edit(
      id,
      { ...dto, options: dto.options?.map((o, i) => ({ key: o.key || String.fromCharCode(65 + i), text: o.text })) } as any,
      { id: user.id, name: user.username },
      req.ip || null,
    );
  }

  @Post('questions/:id/regenerate')
  @Roles(...REG_ADMIN)
  async regenerate(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.review.regenerate(id, { id: user.id, name: user.username }, req.ip || null);
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

  @Post('papers/:id/archive')
  @Roles(...REG_ADMIN)
  async archivePaper(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.papers.archive(id, { id: user.id, name: user.username }, req.ip || null);
  }
}
