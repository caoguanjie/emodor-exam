import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { Errors, RoleEnum } from '../../common/errors';
import { Roles } from '../../common/guards/roles.guard';
import { PaperService } from '../ai/paper.service';
import { AccessService } from '../access/access.service';
import { CategoryService } from '../training/category.service';
import {
  CreateTrainingPaperDto, PAPER_CANDIDATE_KEYS, PAPER_CREATE_KEYS, PAPER_LIST_KEYS, PAPER_OPTION_KEYS,
  PAPER_PREVIEW_KEYS, PAPER_UPDATE_KEYS, PaperCandidateQueryDto, PaperOptionQueryDto, PaperPreviewQueryDto,
  SetTrainingQuestionsDto, TrainingPaperDtoValidationPipe, TrainingPaperListQueryDto, UpdateTrainingPaperDto,
} from './paper.dto';
import { PaperReleaseService } from './paper-release.service';
import { parseQuestionContent, projectStudentContent } from '../questions/question-content-dispatch';

function assertKeys(value: unknown, allowed: readonly string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param(`${label}必须是对象`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw Errors.param(`${label}包含不支持的字段：${unknown.join(',')}`);
}

function id(value: string, label = 'id'): string {
  const normalized = String(value);
  if (!/^[1-9]\d*$/.test(normalized)) throw Errors.param(`${label}必须是字符串 ID`);
  return normalized;
}

export function paperPreviewView(preview: Awaited<ReturnType<PaperReleaseService['preview']>>, includeAnswers: boolean) {
  return {
    ...preview,
    rule: {
      total_cents: preview.rule.totalCents,
      pass_cents: preview.rule.passCents,
      duration_minutes: preview.rule.durationMinutes,
      max_attempts: preview.rule.maxAttempts,
      partial_credit_ratio: preview.rule.partialCreditRatio,
      rules: preview.rule.rules.map((item) => ({
        type: item.type,
        count: item.count,
        score_cents: item.scoreCents,
      })),
    },
    questions: preview.questions.map((item) => {
      const parsed = item.contentSchemaVersion === 3 ? parseQuestionContent(item) : null;
      const richContent = parsed?.schema === 3
        ? (includeAnswers ? (({ schema: _schema, ...content }) => content)(parsed) : projectStudentContent(parsed))
        : null;
      return ({
      question_id: String(item.questionId),
      question_version_id: String(item.versionId),
      type: item.type,
      difficulty: item.difficulty,
      concept_id: item.conceptId || null,
      regulation_id: item.regulationId || null,
      stem: item.stem,
      options: item.options,
      score: item.scoreCents / 100,
      ...(richContent ? { content_schema_version: 3 as const, content_json: richContent } : {}),
      ...(includeAnswers ? { answer: item.answer, analysis: item.analysis } : {}),
      });
    }),
  };
}

@Controller('admin/papers')
@Roles(RoleEnum.SUPER_ADMIN, RoleEnum.REGULATION_ADMIN)
export class PaperAdminController {
  constructor(
    private readonly papers: PaperService,
    private readonly releases: PaperReleaseService,
    private readonly categories: CategoryService,
    private readonly access: AccessService,
  ) {}

  private actor(user: AuthUser) {
    return { id: String(user.id), name: user.username };
  }

  @Get('category-options')
  @Permissions('papers:read')
  async categoryOptions(@Query(new StrictDtoValidationPipe(['page', 'page_size'])) query: PaperOptionQueryDto, @Req() req: Request) {
    assertKeys(req.query, ['page', 'page_size'], '类别选项查询');
    const page = await this.categories.list({ page: query.page, page_size: query.page_size, status: 1 });
    return { ...page, items: page.items.map((item) => ({ id: String(item.id), name: item.name })) };
  }

  @Get('regulation-options')
  @Permissions('papers:read')
  regulationOptions(@Query(new StrictDtoValidationPipe(PAPER_OPTION_KEYS)) query: PaperOptionQueryDto, @Req() req: Request) {
    assertKeys(req.query, PAPER_OPTION_KEYS, '制度选项查询');
    if (!query.category_id) throw Errors.param('category_id 必填');
    return this.papers.regulationOptions(query.category_id, query.page, query.page_size);
  }

  @Get('course-options')
  @Permissions('papers:read')
  courseOptions(@Query(new StrictDtoValidationPipe(PAPER_OPTION_KEYS)) query: PaperOptionQueryDto, @Req() req: Request) {
    assertKeys(req.query, PAPER_OPTION_KEYS, '课程选项查询');
    if (query.pool_scope === 'public') {
      if (query.category_id) throw Errors.param('公共题池课程选项不接受类别限制');
      return this.papers.courseOptions(null, query.page, query.page_size);
    }
    if (!query.category_id) throw Errors.param('category_id 必填');
    return this.papers.courseOptions(query.category_id, query.page, query.page_size);
  }

  @Get()
  @Permissions('papers:read')
  list(@Query(new StrictDtoValidationPipe(PAPER_LIST_KEYS)) query: TrainingPaperListQueryDto, @Req() req: Request) {
    assertKeys(req.query, PAPER_LIST_KEYS, '试卷查询');
    return this.papers.listTraining(query);
  }

  @Post()
  @Permissions('papers:write')
  create(
    @Body(new TrainingPaperDtoValidationPipe(PAPER_CREATE_KEYS)) dto: CreateTrainingPaperDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, PAPER_CREATE_KEYS, '试卷请求');
    return this.papers.createTraining(dto, this.actor(user), req.ip || null);
  }

  @Get(':id')
  @Permissions('papers:read')
  detail(@Param('id') paperId: string) {
    return this.papers.trainingDetail(id(paperId, 'paper_id'));
  }

  @Put(':id')
  @Permissions('papers:write')
  update(
    @Param('id') paperId: string,
    @Body(new TrainingPaperDtoValidationPipe(PAPER_UPDATE_KEYS)) dto: UpdateTrainingPaperDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, PAPER_UPDATE_KEYS, '试卷请求');
    return this.papers.updateTraining(id(paperId, 'paper_id'), dto, this.actor(user), req.ip || null);
  }

  @Delete(':id')
  @Permissions('papers:write')
  delete(@Param('id') paperId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.papers.deleteTraining(id(paperId, 'paper_id'), this.actor(user), req.ip || null);
  }

  @Get(':id/candidates')
  @Permissions('papers:write')
  candidates(
    @Param('id') paperId: string,
    @Query(new StrictDtoValidationPipe(PAPER_CANDIDATE_KEYS)) query: PaperCandidateQueryDto,
    @Req() req: Request,
  ) {
    assertKeys(req.query, PAPER_CANDIDATE_KEYS, '候选题查询');
    return this.papers.trainingCandidates(id(paperId, 'paper_id'), query);
  }

  @Put(':id/questions')
  @Permissions('papers:write')
  questions(
    @Param('id') paperId: string,
    @Body(new StrictDtoValidationPipe(['items'])) dto: SetTrainingQuestionsDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.body, ['items'], '固定题单请求');
    return this.papers.setTrainingQuestions(id(paperId, 'paper_id'), dto.items, this.actor(user), req.ip || null);
  }

  @Get(':id/preview')
  @Permissions('papers:read')
  async preview(
    @Param('id') paperId: string,
    @Query(new StrictDtoValidationPipe(PAPER_PREVIEW_KEYS)) query: PaperPreviewQueryDto,
    @Req() req: Request,
  ) {
    assertKeys(req.query, PAPER_PREVIEW_KEYS, '试卷预览查询');
    return paperPreviewView(await this.releases.preview(id(paperId, 'paper_id'), query.difficulty || 'easy'), false);
  }

  @Get(':id/preview/answers')
  @Permissions('papers:read')
  async answerPreview(
    @Param('id') paperId: string,
    @Query(new StrictDtoValidationPipe(PAPER_PREVIEW_KEYS)) query: PaperPreviewQueryDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertKeys(req.query, PAPER_PREVIEW_KEYS, '答案预览查询');
    const permissions = await this.access.permissions(String(user.id));
    if (!permissions.some((permission) => ['papers:export', 'questions:read', 'questions:export'].includes(permission))) {
      throw Errors.forbidden('答案版预览需要题库查看或试卷导出权限');
    }
    return paperPreviewView(await this.releases.preview(id(paperId, 'paper_id'), query.difficulty || 'easy'), true);
  }

  @Post(':id/publish')
  @Permissions('papers:publish')
  async publish(@Param('id') paperId: string, @CurrentUser() user: AuthUser) {
    const result = await this.releases.publish(id(paperId, 'paper_id'), String(user.id));
    return { release_id: result.releaseId, pool_scope: result.poolScope ?? 'category' };
  }

  @Post(':id/withdraw')
  @Permissions('papers:publish')
  withdraw(@Param('id') paperId: string, @CurrentUser() user: AuthUser) {
    return this.releases.withdraw(id(paperId, 'paper_id'), String(user.id));
  }

  @Post(':id/copy')
  @Permissions('papers:write')
  copy(@Param('id') paperId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.papers.copyTraining(id(paperId, 'paper_id'), this.actor(user), req.ip || null);
  }
}
