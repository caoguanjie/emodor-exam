import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString,
  Matches, Max, MaxLength, Min, MinLength, ValidateBy, ValidateIf, ValidateNested,
} from 'class-validator';
import type { Difficulty, QuestionType } from '../../common/training-contracts';
import type { QuestionContentV2 } from '../../common/training-contracts';
import type { QuestionContentV3 } from '../../common/question-content-v3';
import { assertActiveDifficulty } from '../../common/question-difficulty';

const IdField = () => Matches(/^[1-9]\d*$/, { message: '必须是十进制 ID 字符串' });
const QueryNumber = () => Transform(({ value }) => value === undefined || value === null || value === '' ? undefined : Number(value));
const ActiveDifficultyField = () => ValidateBy({
  name: 'activeDifficulty',
  validator: {
    validate: (value) => { try { assertActiveDifficulty(value); return true; } catch { return false; } },
    defaultMessage: () => '难度未启用，请从当前难度目录选择',
  },
});

export class GenerateQuestionsDto {
  @IsString() @IdField() material_id!: string;
  @IsString() @IdField() material_version_id!: string;
  @IsString() @IdField() category_id!: string;
  @ActiveDifficultyField() difficulty!: Difficulty;
  @IsOptional() @IsInt() @Min(1) @Max(40) question_count_single?: number;
  @IsOptional() @IsInt() @Min(0) @Max(20) question_count_multiple?: number;
}

export class QuestionOptionDto {
  @IsOptional() @IsString() @MaxLength(64) key?: string;
  @IsString() @MinLength(1) @MaxLength(20_000) text!: string;
}

export class CreateQuestionDto {
  @IsOptional() @IsIn([2, 3]) content_schema_version?: number;
  @IsOptional() @IsObject() content_json?: QuestionContentV2 | QuestionContentV3;
  @IsString() @IdField() category_id!: string;
  @ActiveDifficultyField() difficulty!: Difficulty;
  @IsOptional() @IsString() @IdField() concept_id?: string;
  @IsIn(['single', 'multiple', 'judgment']) type!: QuestionType;
  @ValidateIf((input) => ![2, 3].includes(input.content_schema_version) || input.stem !== undefined) @IsString() @MinLength(1) @MaxLength(100_000) stem!: string;
  @ValidateIf((input) => ![2, 3].includes(input.content_schema_version) || input.options !== undefined) @IsArray() @ArrayMaxSize(26) @ValidateNested({ each: true }) @Type(() => QuestionOptionDto) options!: QuestionOptionDto[];
  @ValidateIf((input) => ![2, 3].includes(input.content_schema_version) || input.answer !== undefined) @IsArray() @ArrayMaxSize(26) @IsInt({ each: true }) answer!: number[];
  @IsOptional() @IsString() @MaxLength(100_000) analysis?: string;
}

export class EditQuestionDto {
  @IsOptional() @IsIn([2, 3]) content_schema_version?: number;
  @IsOptional() @IsObject() content_json?: QuestionContentV2 | QuestionContentV3;
  @IsOptional() @IsString() @IdField() expected_version_id?: string | null;
  @IsOptional() @IsString() @IdField() category_id?: string;
  @IsOptional() @ActiveDifficultyField() difficulty?: Difficulty;
  @IsOptional() @IsString() @IdField() concept_id?: string | null;
  @IsOptional() @IsIn(['single', 'multiple', 'judgment']) type?: QuestionType;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100_000) stem?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(26) @ValidateNested({ each: true }) @Type(() => QuestionOptionDto) options?: QuestionOptionDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(26) @IsInt({ each: true }) answer?: number[];
  @IsOptional() @IsString() @MaxLength(100_000) analysis?: string | null;
}

export class ReviewQuestionDto {
  @IsOptional() @IsString() @IdField() expected_version_id?: string | null;
  @IsIn(['approved', 'rejected']) status!: 'approved' | 'rejected';
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class RegenerateQuestionDto {
  @IsOptional() @IsString() @IdField() expected_version_id?: string | null;
}

export class QuestionListQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @IdField() material_id?: string;
  @IsOptional() @IsString() @IdField() category_id?: string;
  @IsOptional() @IsString() @IdField() concept_id?: string;
  @IsOptional() @IsIn(['pending', 'approved', 'rejected']) status?: string;
  @IsOptional() @IsIn(['single', 'multiple', 'judgment']) type?: QuestionType;
  @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: Difficulty;
  @IsOptional() @IsString() @MaxLength(255) keyword?: string;
}

export class QuestionConceptQueryDto {
  @IsString() @IdField() category_id!: string;
  @IsOptional() @IsIn(['single', 'multiple', 'judgment']) type?: QuestionType;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
}

export class QuestionHistoryQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
}

export class QuestionConceptOptionsQueryDto {
  @IsString() @IdField() category_id!: string;
  @IsIn(['single', 'multiple', 'judgment']) type!: QuestionType;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
}

export class CreateQuestionConceptDto {
  @IsString() @IdField() category_id!: string;
  @IsIn(['single', 'multiple', 'judgment']) type!: QuestionType;
  @IsString() @MinLength(1) @MaxLength(128) name!: string;
}

export class CategoryOptionsQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
}

// Legacy score is accepted at the request boundary, then stripped by DTO whitelisting.
export const QUESTION_CREATE_KEYS = [
  'category_id', 'difficulty', 'concept_id', 'type', 'stem', 'options', 'answer', 'analysis', 'score',
  'content_schema_version', 'content_json',
] as const;
export const QUESTION_EDIT_KEYS = ['expected_version_id', ...QUESTION_CREATE_KEYS] as const;
export const QUESTION_LIST_KEYS = [
  'page', 'page_size', 'material_id', 'category_id', 'concept_id', 'status', 'type', 'difficulty', 'keyword',
] as const;
