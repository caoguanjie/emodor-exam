import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { ExamDifficulty, LearnerSource, StatsFilter, TrainingStatisticsOverviewFilter } from '../../common/training-contracts';

const ID_PATTERN = /^[1-9]\d*$/;
const QueryNumber = () => Transform(({ value }) => value === undefined || value === null || value === '' ? undefined : Number(value));

export class TrainingStatisticsQueryDto {
  @IsString() @Matches(ID_PATTERN) paper_id!: string;
  @IsOptional() @IsString() @Matches(ID_PATTERN) category_id?: string;
  @IsOptional() @IsIn(['institution', 'external']) source?: LearnerSource;
  @IsOptional() @IsIn(['easy', 'medium', 'hard', 'mixed', 'unknown']) difficulty?: ExamDifficulty;
  @IsOptional() @IsIn(['score', 'duration']) sort_by?: StatsFilter['sort_by'];
  @IsOptional() @IsIn(['asc', 'desc']) sort_order?: StatsFilter['sort_order'];
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;

  toFilter(): StatsFilter {
    return {
      paperId: this.paper_id,
      categoryId: this.category_id,
      source: this.source,
      difficulty: this.difficulty,
      sort_by: this.sort_by,
      sort_order: this.sort_order,
      page: this.page || 1,
      pageSize: this.page_size || 20,
    };
  }
}

export const TRAINING_STATISTICS_QUERY_KEYS = [
  'paper_id', 'category_id', 'source', 'difficulty', 'sort_by', 'sort_order', 'page', 'page_size',
] as const;

export class TrainingStatisticsOverviewQueryDto {
  @IsOptional() @IsString() @MaxLength(128) keyword?: string;
  @IsOptional() @IsString() @Matches(ID_PATTERN) category_id?: string;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;

  toFilter(): TrainingStatisticsOverviewFilter {
    return { keyword: this.keyword, categoryId: this.category_id, page: this.page || 1, pageSize: this.page_size || 20 };
  }
}

export const TRAINING_STATISTICS_OVERVIEW_QUERY_KEYS = ['keyword', 'category_id', 'page', 'page_size'] as const;
