import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TRAINING_DEFAULTS } from '../../common/training-contracts';

export class AnswerInputDto {
  @IsString() @Matches(/^[1-9]\d*$/)
  item_id!: string;

  @IsOptional() @IsArray() @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true })
  selected?: number[];

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(TRAINING_DEFAULTS.imageAssetsPerItem)
  @IsString({ each: true }) @Matches(/^[1-9]\d*$/, { each: true })
  asset_ids?: string[];
}

export class DraftInputDto {
  @Type(() => Number) @IsInt() @Min(1)
  revision!: number;

  @IsArray() @ValidateNested({ each: true }) @Type(() => AnswerInputDto)
  answers!: AnswerInputDto[];
}

export class SubmitAttemptDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  revision?: number;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AnswerInputDto)
  answers?: AnswerInputDto[];

  draft() {
    const hasRevision = this.revision !== undefined;
    const hasAnswers = this.answers !== undefined;
    if (hasRevision !== hasAnswers) return null;
    return hasRevision ? { revision: this.revision!, answers: this.answers! } : undefined;
  }
}

export class AttemptHeartbeatDto {
  @IsOptional() @IsString() @MaxLength(255)
  device_summary?: string;
}

export class AnswerImageDto {
  @IsString() @Matches(/^[1-9]\d*$/)
  item_id!: string;
}
