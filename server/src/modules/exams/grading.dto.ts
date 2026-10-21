import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { TRAINING_DEFAULTS } from '../../common/training-contracts';

export class ManualScoreDto {
  @Type(() => Number) @IsInt() @Min(0)
  score_cents!: number;

  @IsString() @MaxLength(2000)
  comment!: string;

  @Type(() => Number) @IsInt() @Min(0)
  expected_version!: number;
}

export class HistoryPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(TRAINING_DEFAULTS.maxPageSize)
  page_size?: number;
}

export class GradingQueueDto extends HistoryPageDto {
  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/)
  paper_id?: string;

  @IsOptional() @IsIn(['institution', 'external'])
  source?: 'institution' | 'external';

  @IsOptional() @IsIn(['pending_manual', 'finalized'])
  status?: 'pending_manual' | 'finalized';
}
