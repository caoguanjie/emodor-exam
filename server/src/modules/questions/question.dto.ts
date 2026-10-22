import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString,
  Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import type { Difficulty, QuestionType } from '../../common/training-contracts';

const IdField = () => Matches(/^[1-9]\d*$/, { message: '必须是十进制 ID 字符串' });
const QueryNumber = () => Transform(({ value }) => value === undefined || value === null || value === '' ? undefined : Number(value));

export class GenerateQuestionsDto {
  @IsString() @IdField() material_id!: string;
  @IsString() @IdField() material_version_id!: string;
  @IsString() @IdField() category_id!: string;
  @IsIn(['easy', 'medium', 'hard']) difficulty!: Difficulty;
  @IsOptional() @IsInt() @Min(1) @Max(40) question_count_single?: number;
  @IsOptional() @IsInt() @Min(0) @Max(20) question_count_multiple?: number;
  @IsOptional() @IsNumber() @Min(0.01) score_single?: number;
  @IsOptional() @IsNumber() @Min(0.01) score_multiple?: number;
}

export class QuestionOptionDto {
  @IsOptional() @IsString() @MaxLength(16) key?: string;
  @IsString() @MinLength(1) @MaxLength(20_000) text!: string;
}

export class CreateQuestionDto {
  @IsString() @IdField() category_id!: string;
  @IsIn(['easy', 'medium', 'hard']) difficulty!: Difficulty;
  @IsOptional() @IsString() @IdField() concept_id?: string;
  @IsIn(['single', 'multiple', 'judgment']) type!: QuestionType;
  @IsString() @MinLength(1) @MaxLength(100_000) stem!: string;
  @IsArray() @ArrayMaxSize(26) @ValidateNested({ each: true }) @Type(() => QuestionOptionDto) options!: QuestionOptionDto[];
  @IsArray() @ArrayMaxSize(26) @IsInt({ each: true }) answer!: number[];
  @IsOptional() @IsString() @MaxLength(100_000) analysis?: string;
  @IsNumber() @Min(0.01) @Max(100) score!: number;
}

export class EditQuestionDto {
  @IsOptional() @IsString() @IdField() expected_version_id?: string | null;
  @IsOptional() @IsString() @IdField() category_id?: string;
  @IsOptional() @IsIn(['easy', 'medium', 'hard']) difficulty?: Difficulty;
  @IsOptional() @IsString() @IdField() concept_id?: string | null;
  @IsOptional() @IsIn(['single', 'multiple', 'judgment']) type?: QuestionType;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100_000) stem?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(26) @ValidateNested({ each: true }) @Type(() => QuestionOptionDto) options?: QuestionOptionDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(26) @IsInt({ each: true }) answer?: number[];
  @IsOptional() @IsString() @MaxLength(100_000) analysis?: string | null;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) score?: number;
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

export const QUESTION_CREATE_KEYS = [
  'category_id', 'difficulty', 'concept_id', 'type', 'stem', 'options', 'answer', 'analysis', 'score',
] as const;
export const QUESTION_EDIT_KEYS = ['expected_version_id', ...QUESTION_CREATE_KEYS] as const;
export const QUESTION_LIST_KEYS = [
  'page', 'page_size', 'material_id', 'category_id', 'concept_id', 'status', 'type', 'difficulty', 'keyword',
] as const;
