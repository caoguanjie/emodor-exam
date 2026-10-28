import { Transform, Type } from 'class-transformer';
import type { ArgumentMetadata } from '@nestjs/common';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional,
  IsString, Matches, Max, MaxLength, Min, MinLength, Validate, ValidateIf, ValidateNested,
  ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface,
} from 'class-validator';
import type { Difficulty, PoolScope, QuestionType } from '../../common/training-contracts';
import type { DesignerLayoutV1 } from '../../common/question-authoring';
import { Errors } from '../../common/errors';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';

const ID_PATTERN = /^[1-9]\d*$/;
const QueryNumber = () => Transform(({ value }) => value === undefined || value === null || value === '' ? undefined : Number(value));

function layoutObject(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Errors.param(`${path} 必须是对象`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw Errors.param(`${path} 字段不完整或包含不支持的字段`);
  }
  return value as Record<string, unknown>;
}

/** Rebuild a whitelisted layout; never persist arbitrary designer JSON. */
export function parseDesignerLayout(input: unknown): DesignerLayoutV1 {
  const layout = layoutObject(input, 'designer_layout', ['schema_version', 'settings']);
  if (layout.schema_version !== 1) throw Errors.param('designer_layout.schema_version 仅支持 1');
  const settings = layoutObject(layout.settings, 'designer_layout.settings', ['templateName', 'pageSize', 'pageOrientation', 'pageSizeReduce']);
  if (typeof settings.templateName !== 'string' || !settings.templateName.trim()
    || Array.from(settings.templateName).length > 128) {
    throw Errors.param('designer_layout.settings.templateName 必须为 1–128 字符');
  }
  if (settings.pageSize !== 'A4' && settings.pageSize !== 'A5') throw Errors.param('designer_layout.settings.pageSize 仅支持 A4/A5');
  if (settings.pageOrientation !== 1 && settings.pageOrientation !== 2) throw Errors.param('designer_layout.settings.pageOrientation 仅支持 1/2');
  const margins = layoutObject(settings.pageSizeReduce, 'designer_layout.settings.pageSizeReduce', ['top', 'bottom', 'left', 'right']);
  for (const [side, value] of Object.entries(margins)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 99) {
      throw Errors.param(`designer_layout.settings.pageSizeReduce.${side} 必须为 0–99 整数毫米`);
    }
  }
  return {
    schema_version: 1,
    settings: {
      templateName: settings.templateName,
      pageSize: settings.pageSize,
      pageOrientation: settings.pageOrientation,
      pageSizeReduce: { top: margins.top as number, bottom: margins.bottom as number, left: margins.left as number, right: margins.right as number },
    },
  };
}

/** Read-time fallback only: old rows stay NULL until an explicit layout save. */
export function defaultDesignerLayout(title: string): DesignerLayoutV1 {
  return {
    schema_version: 1,
    settings: { templateName: title, pageSize: 'A4', pageOrientation: 1, pageSizeReduce: { top: 15, bottom: 15, left: 15, right: 15 } },
  };
}

/** Validate raw JSON before class-transformer can strip prototype-shaped keys. */
export class TrainingPaperDtoValidationPipe extends StrictDtoValidationPipe {
  async transform(value: any, metadata: ArgumentMetadata) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(value, 'designer_layout')) {
      parseDesignerLayout(value.designer_layout);
    }
    return super.transform(value, metadata);
  }
}

@ValidatorConstraint({ name: 'designerLayout', async: false })
class DesignerLayoutValidator implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    try { parseDesignerLayout(value); return true; }
    catch { return false; }
  }

  defaultMessage(): string {
    return 'designer_layout 必须为 schema_version=1 的完整受控布局，不允许未知字段';
  }
}

export class PaperRuleDto {
  @IsIn(['single', 'multiple', 'judgment']) type!: QuestionType;
  @IsInt() @Min(1) @Max(500) count!: number;
  @IsInt() @Min(1) @Max(99999) score_cents!: number;
}

@ValidatorConstraint({ name: 'paperPoolScope', async: false })
class PaperPoolScopeValidator implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const input = args.object as { mode?: string; category_id?: string | null };
    return value !== 'public' || ((input.mode === undefined || input.mode === 'random') && input.category_id == null);
  }

  defaultMessage(): string { return '公共题池仅支持随机卷，培训类别必须为空'; }
}

export class CreateTrainingPaperDto {
  @IsString() @MinLength(1) @MaxLength(128) title!: string;
  @IsIn(['fixed', 'random']) mode!: 'fixed' | 'random';
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['category', 'public']) @Validate(PaperPoolScopeValidator) pool_scope?: PoolScope;
  @ValidateIf((object, value) => object.pool_scope !== 'public' || value != null) @IsString() @Matches(ID_PATTERN) category_id?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @Matches(ID_PATTERN, { each: true }) regulation_ids?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @Matches(ID_PATTERN, { each: true }) course_ids?: string[];
  @IsOptional() @IsBoolean() requires_learning?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) required_learning_minutes?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) remark?: string | null;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) sort_order?: number;
  @ValidateIf((_object, value) => value !== undefined) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999.99) total_score?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999.99) pass_score?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) duration_minutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) max_attempts?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) partial_credit_ratio?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaperRuleDto) rules?: PaperRuleDto[];
  @ValidateIf((_object, value) => value !== undefined) @Validate(DesignerLayoutValidator) designer_layout?: DesignerLayoutV1;
}

export class UpdateTrainingPaperDto {
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() preserve_questions?: boolean;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) title?: string;
  @IsOptional() @IsIn(['fixed', 'random']) mode?: 'fixed' | 'random';
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['category', 'public']) @Validate(PaperPoolScopeValidator) pool_scope?: PoolScope;
  @IsOptional() @IsString() @Matches(ID_PATTERN) category_id?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @Matches(ID_PATTERN, { each: true }) regulation_ids?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @Matches(ID_PATTERN, { each: true }) course_ids?: string[];
  @IsOptional() @IsBoolean() requires_learning?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(2147483647) required_learning_minutes?: number | null;
  @IsOptional() @IsString() @MaxLength(1000) remark?: string | null;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) sort_order?: number;
  @ValidateIf((_object, value) => value !== undefined) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999.99) total_score?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999.99) pass_score?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) duration_minutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) max_attempts?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) partial_credit_ratio?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaperRuleDto) rules?: PaperRuleDto[];
  @ValidateIf((_object, value) => value !== undefined) @Validate(DesignerLayoutValidator) designer_layout?: DesignerLayoutV1;
}

export class FixedQuestionDto {
  @IsString() @Matches(ID_PATTERN) question_version_id!: string;
  @IsInt() @Min(0) @Max(99999) score_cents!: number;
}

export class SetTrainingQuestionsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => FixedQuestionDto)
  items!: FixedQuestionDto[];
}

export class TrainingPaperListQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
  @IsOptional() @IsString() @Matches(ID_PATTERN) category_id?: string;
  @IsOptional() @IsIn(['fixed', 'random']) mode?: 'fixed' | 'random';
  @IsOptional() @IsIn(['draft', 'published', 'withdrawn', 'archived']) status?: string;
}

export class PaperCandidateQueryDto {
  @IsOptional() @IsIn(['single', 'multiple', 'judgment']) type?: QuestionType;
  @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: Difficulty;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
}

export class PaperOptionQueryDto {
  @IsOptional() @IsString() @Matches(ID_PATTERN) category_id?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['category', 'public']) pool_scope?: PoolScope;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
}

export class PaperPreviewQueryDto {
  @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: Difficulty;
}

export const PAPER_CREATE_KEYS = [
  'title', 'mode', 'pool_scope', 'category_id', 'regulation_ids', 'course_ids', 'requires_learning',
  'required_learning_minutes', 'remark', 'sort_order',
  'total_score', 'pass_score', 'duration_minutes', 'max_attempts', 'partial_credit_ratio', 'rules', 'designer_layout',
] as const;
export const PAPER_UPDATE_KEYS = [...PAPER_CREATE_KEYS, 'preserve_questions'] as const;
export const PAPER_LIST_KEYS = ['page', 'page_size', 'keyword', 'category_id', 'mode', 'status'] as const;
export const PAPER_CANDIDATE_KEYS = ['type', 'difficulty', 'page', 'page_size'] as const;
export const PAPER_OPTION_KEYS = ['category_id', 'pool_scope', 'page', 'page_size'] as const;
export const PAPER_PREVIEW_KEYS = ['difficulty'] as const;
