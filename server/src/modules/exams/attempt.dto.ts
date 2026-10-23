import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEmpty,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class AnswerInputDto {
  @IsString() @Matches(/^[1-9]\d*$/)
  item_id!: string;

  @IsOptional() @IsArray() @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true })
  selected?: number[];

  @IsEmpty({ message: '图片作答已取消' })
  asset_ids?: never;
}

export class DraftInputDto {
  @Type(() => Number) @IsInt() @Min(1)
  revision!: number;

  @IsArray() @ValidateNested({ each: true }) @Type(() => AnswerInputDto)
  answers!: AnswerInputDto[];
}

export class SubmitAttemptDto {
  @IsString() @Matches(/^[1-9]\d*$/)
  record_id!: string;

  // Validated after ownership, the record lock and terminal/deadline arbitration.
  // A controller-level validation pipe would break terminal idempotent replays.
  answers!: Array<{ item_id: string; option_ids: string[] }>;
}
