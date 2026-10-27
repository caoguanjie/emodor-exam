import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/** Convert only a single integer token; arrays/objects must fail validation. */
const QueryInteger = () => Transform(({ value }) => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
  ? Number(value) : value);

export const DASHBOARD_TREND_QUERY_KEYS = ['days'] as const;

export class DashboardTrendQueryDto {
  @QueryInteger() @IsIn([7, 30]) days: 7 | 30 = 7;
}

const IfPresent = () => ValidateIf((_object, value) => value !== undefined);
const ID_PATTERN = /^[1-9]\d*$/;

export const DASHBOARD_LEARNING_OPTIONS_QUERY_KEYS = ['keyword', 'page', 'page_size'] as const;
export const DASHBOARD_LEARNING_SUMMARY_QUERY_KEYS = ['paper_id', 'release_id'] as const;

export class DashboardLearningOptionsQueryDto {
  @IfPresent() @IsString() @MaxLength(128) keyword?: string;
  @QueryInteger() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) page = 1;
  @QueryInteger() @IsInt() @Min(1) @Max(100) page_size = 20;

  toFilter() {
    return { keyword: this.keyword, page: this.page, pageSize: this.page_size };
  }
}

export class DashboardLearningSummaryQueryDto {
  @IsString() @Matches(ID_PATTERN) paper_id!: string;
  @IsString() @Matches(ID_PATTERN) release_id!: string;
}
