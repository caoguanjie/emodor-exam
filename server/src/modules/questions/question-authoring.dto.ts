import type { ArgumentMetadata } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsObject, IsString, IsUUID, Matches } from 'class-validator';
import type { AuthoringBundle } from '../../common/question-authoring';
import { StrictDtoValidationPipe } from '../../common/dto-validation.pipe';
import { decodeAuthoringBundle } from './question-authoring-codec';

export class AssembleQuestionsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique()
  @IsString({ each: true }) @Matches(/^[1-9]\d{0,19}$/, { each: true }) version_ids!: string[];
}
export class AuthoringCommitDto {
  @IsString() @IsUUID('all') request_id!: string;
  @IsObject() bundle!: AuthoringBundle;
}

/** Validate the raw document before class-transformer can drop dangerous keys. */
export class AuthoringDtoValidationPipe extends StrictDtoValidationPipe {
  async transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.metatype === AuthoringCommitDto && value && typeof value === 'object' && 'bundle' in value) decodeAuthoringBundle(value.bundle);
    return super.transform(value, metadata);
  }
}
