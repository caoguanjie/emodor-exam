import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import type { ExamDifficulty, LearnerSource, StatsFilter } from '../../common/training-contracts';

const ID_PATTERN = /^[1-9]\d*$/;
const QueryNumber = () => Transform(({ value }) => value === undefined || value === null || value === '' ? undefined : Number(value));

export class TrainingStatisticsQueryDto {
  @IsString() @Matches(ID_PATTERN) paper_id!: string;
  @IsOptional() @IsString() @Matches(ID_PATTERN) category_id?: string;
  @IsOptional() @IsIn(['institution', 'external']) source?: LearnerSource;
  @IsOptional() @IsIn(['easy', 'medium', 'hard', 'mixed', 'unknown']) difficulty?: ExamDifficulty;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) page?: number;
  @IsOptional() @QueryNumber() @IsInt() @Min(1) @Max(100) page_size?: number;

  toFilter(): StatsFilter {
    return {
      paperId: this.paper_id,
      categoryId: this.category_id,
      source: this.source,
      difficulty: this.difficulty,
      page: this.page || 1,
      pageSize: this.page_size || 20,
    };
  }
}

export const TRAINING_STATISTICS_QUERY_KEYS = [
  'paper_id', 'category_id', 'source', 'difficulty', 'page', 'page_size',
] as const;
