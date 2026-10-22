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
