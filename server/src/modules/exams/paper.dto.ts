import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional,
  IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import type { Difficulty, QuestionType } from '../../common/training-contracts';

const ID_PATTERN = /^[1-9]\d*$/;
const QueryNumber = () => Transform(({ value }) => value === undefined || value === null || value === '' ? undefined : Number(value));

export class PaperRuleDto {
  @IsIn(['single', 'multiple', 'judgment']) type!: QuestionType;
  @IsInt() @Min(1) @Max(500) count!: number;
  @IsInt() @Min(1) @Max(10000) score_cents!: number;
}

export class CreateTrainingPaperDto {
  @IsString() @MinLength(1) @MaxLength(128) title!: string;
  @IsIn(['fixed', 'random']) mode!: 'fixed' | 'random';
  @IsString() @Matches(ID_PATTERN) category_id!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @Matches(ID_PATTERN, { each: true }) regulation_ids?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @Matches(ID_PATTERN, { each: true }) course_ids?: string[];
  @IsOptional() @IsBoolean() requires_learning?: boolean;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) pass_score?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) duration_minutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) max_attempts?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) partial_credit_ratio?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaperRuleDto) rules?: PaperRuleDto[];
}

export class UpdateTrainingPaperDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) title?: string;
  @IsOptional() @IsIn(['fixed', 'random']) mode?: 'fixed' | 'random';
  @IsOptional() @IsString() @Matches(ID_PATTERN) category_id?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @Matches(ID_PATTERN, { each: true }) regulation_ids?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @Matches(ID_PATTERN, { each: true }) course_ids?: string[];
  @IsOptional() @IsBoolean() requires_learning?: boolean;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) pass_score?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) duration_minutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) max_attempts?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1) partial_credit_ratio?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaperRuleDto) rules?: PaperRuleDto[];
}

export class FixedQuestionDto {
  @IsString() @Matches(ID_PATTERN) question_version_id!: string;
  @IsInt() @Min(1) @Max(10000) score_cents!: number;
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
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
}

export class PaperPreviewQueryDto {
  @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: Difficulty;
}

export const PAPER_CREATE_KEYS = [
  'title', 'mode', 'category_id', 'regulation_ids', 'course_ids', 'requires_learning',
  'pass_score', 'duration_minutes', 'max_attempts', 'partial_credit_ratio', 'rules',
] as const;
export const PAPER_UPDATE_KEYS = PAPER_CREATE_KEYS;
export const PAPER_LIST_KEYS = ['page', 'page_size', 'keyword', 'category_id', 'mode', 'status'] as const;
export const PAPER_CANDIDATE_KEYS = ['type', 'difficulty', 'page', 'page_size'] as const;
export const PAPER_OPTION_KEYS = ['category_id', 'page', 'page_size'] as const;
export const PAPER_PREVIEW_KEYS = ['difficulty'] as const;
