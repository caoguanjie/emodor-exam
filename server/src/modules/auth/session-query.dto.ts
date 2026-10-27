import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Errors } from '../../common/errors';

export const SESSION_LIST_QUERY_KEYS = ['page', 'page_size', 'keyword', 'status'] as const;
export type SessionListStatus = 'active' | 'expired' | 'revoked' | 'all';

const QueryInteger = () => Transform(({ value }) => typeof value === 'string' && /^[1-9]\d*$/.test(value)
  ? Number(value) : value);

export class SessionListQueryDto {
  @QueryInteger() @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @QueryInteger() @IsInt() @Min(1) @Max(100) page_size = 20;
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(128) keyword?: string;
  @IsIn(['active', 'expired', 'revoked', 'all']) status: SessionListStatus = 'active';
}

/** Recheck the raw request, including duplicates that a query parser may collapse. */
export function assertSessionListQueryRequest(query: unknown, originalUrl?: string): void {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw Errors.param('会话查询参数格式错误');
  const allowed = new Set<string>(SESSION_LIST_QUERY_KEYS);
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.has(key) || typeof value !== 'string') throw Errors.param('会话查询包含不支持或重复的参数');
  }
  if (originalUrl) {
    const params = new URL(originalUrl, 'http://request.local').searchParams;
    const seen = new Set<string>();
    for (const key of params.keys()) {
      if (!allowed.has(key) || seen.has(key)) throw Errors.param('会话查询包含不支持或重复的参数');
      seen.add(key);
    }
  }
}
