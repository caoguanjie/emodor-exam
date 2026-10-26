import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Errors } from '../../../common/errors';

export class MediaTicketRequestDto {
  @IsString() @Matches(/^[1-9]\d{0,19}$/) asset_id!: string;
  @IsString() @MinLength(1) @MaxLength(64) owner_type!: string;
  @IsString() @Matches(/^[1-9]\d{0,19}$/) owner_id!: string;
}
export class MediaTicketBatchDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => MediaTicketRequestDto)
  items!: MediaTicketRequestDto[];
}

/** Read req.body too: the global whitelist pipe returns a stripped DTO copy. */
export function assertMediaBodyKeys(value: unknown, allowed: readonly string[], absentAllowed = false): asserts value is Record<string, unknown> {
  if (value === undefined && absentAllowed) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw Errors.param('媒体请求包含不支持的字段');
  }
}

export function assertMediaBatchBody(value: unknown): void {
  assertMediaBodyKeys(value, ['items']);
  if (!Array.isArray(value.items) || value.items.length > 50) throw Errors.param('媒体票据批量请求最多 50 项');
  for (const item of value.items) assertMediaBodyKeys(item, ['asset_id', 'owner_type', 'owner_id']);
}
