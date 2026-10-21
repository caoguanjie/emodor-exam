import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';

const ID_PATTERN = /^[1-9]\d*$/;
const QueryNumber = () => Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : Number(value)));

export class CourseListQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(1_000_000) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(255) keyword?: string;
  @IsOptional() @IsString() @Matches(ID_PATTERN) category_id?: string;
  @IsOptional() @IsString() @IsIn(['draft', 'published', 'offline']) status?: 'draft' | 'published' | 'offline';
}

export class CategoryOptionsQueryDto {
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(1_000_000) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
}

export class CreateCourseDto {
  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @IsString() @Matches(ID_PATTERN) category_id!: string;
  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsString() @Matches(ID_PATTERN) cover_asset_id?: string | null;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @Matches(ID_PATTERN, { each: true }) regulation_ids?: string[] | null;
  @IsOptional() @IsBoolean() is_recommended?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(2_147_483_647) sort_order?: number;
}

export class UpdateCourseDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) title?: string;
  @IsOptional() @IsString() @Matches(ID_PATTERN) category_id?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsString() @Matches(ID_PATTERN) cover_asset_id?: string | null;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @Matches(ID_PATTERN, { each: true }) regulation_ids?: string[] | null;
  @IsOptional() @IsBoolean() is_recommended?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(2_147_483_647) sort_order?: number;
}

export class CreateChapterDto {
  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @IsOptional() @IsInt() @Min(0) @Max(2_147_483_647) sort_order?: number;
}

export class UpdateChapterDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) title?: string;
  @IsOptional() @IsInt() @Min(0) @Max(2_147_483_647) sort_order?: number;
}

export class CreateLessonDto {
  @IsString() @Matches(ID_PATTERN) chapter_id!: string;
  @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @IsString() @IsIn(['video']) lesson_type!: 'video';
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(2_147_483_647) sort_order?: number;
  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsString() @Matches(ID_PATTERN) asset_id?: string | null;
}

export class UpdateLessonDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) title?: string;
  @IsOptional() @IsString() @IsIn(['video']) lesson_type?: 'video';
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(2_147_483_647) sort_order?: number;
}

export class ReplaceVideoDto {
  @IsString() @Matches(ID_PATTERN) asset_id!: string;
}

export const COURSE_KEYS = ['title', 'category_id', 'cover_asset_id', 'description', 'regulation_ids', 'is_recommended', 'sort_order'] as const;
export const CHAPTER_KEYS = ['title', 'sort_order'] as const;
export const LESSON_CREATE_KEYS = ['chapter_id', 'title', 'lesson_type', 'required', 'sort_order', 'asset_id'] as const;
export const LESSON_UPDATE_KEYS = ['title', 'lesson_type', 'required', 'sort_order'] as const;
